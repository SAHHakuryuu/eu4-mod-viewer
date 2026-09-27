'use strict';
/**
 * Shared plumbing for the content model (`src/gamedata.js` and the type
 * descriptors in `src/content/registry.js`).
 *
 * Everything in here was originally inside `gamedata.js`. It moved so the new
 * data-driven content types can reuse it without a circular require: `gamedata`
 * and `registry` both depend on this module, and neither depends on the other.
 *
 * The second half of the file is the *generic* card engine. A large part of what
 * an EU4 mod can change has the same shape — a named block with a localisation
 * name, a handful of scalar settings, some modifier keys and a few
 * condition/effect blocks. Instead of writing twenty near-identical builders,
 * a type descriptor declares which folders it reads and where its name lives,
 * and `collectGeneric` / `buildGenericCard` do the rest.
 *
 * Nothing here invents text: an unknown script key is shown as the key itself
 * with a "not in the glossary" note, exactly like `src/gameterms.js` does.
 */

const fs = require('fs');
const path = require('path');

const locCodec = require('../codec/localisation.js');
const { parseScript, getEntry, scalarValue } = require('../codec/script.js');
const gametext = require('../gametext.js');
const terms = require('../gameterms.js');
const i18n = require('../i18n.js');

const { L, pick, normalizeLang, isEn } = i18n;

const MAX_FILE_BYTES = 16 * 1024 * 1024;

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readText(mod, rel) {
  const abs = path.join(mod.root, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
  try { return locCodec.decodeBuffer(fs.readFileSync(abs)); } catch { return null; }
}

function underPrefix(rel, prefixes) {
  const low = rel.toLowerCase().replace(/\\/g, '/');
  return prefixes.some((p) => low.startsWith(p)) && /\.txt$/i.test(low);
}

/** Any text file, including `.gui` — used by the interface and map types. */
function underPrefixAny(rel, prefixes) {
  const low = rel.toLowerCase().replace(/\\/g, '/');
  return prefixes.some((p) => low.startsWith(p)) && /\.(txt|gui|gfx)$/i.test(low);
}

/** Cached per-index file parse so repeated card builds stay cheap. */
class FileCache {
  constructor(mod) { this.mod = mod; this.map = new Map(); }
  tree(rel) {
    if (this.map.has(rel)) return this.map.get(rel);
    const text = readText(this.mod, rel);
    let tree = null;
    if (text !== null) {
      try { tree = parseScript(text); } catch { tree = null; }
    }
    // Bound memory: a mod can have thousands of content files.
    if (this.map.size > 96) this.map.clear();
    this.map.set(rel, tree);
    return tree;
  }
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

/** Lightweight card descriptor: enough to list, search and cross-link. */
function makeRef(type, id, file, line, extra) {
  return Object.assign({ type, id, file, line }, extra || {});
}

function isTruthy(node) {
  const v = scalarValue(node);
  return v === 'yes' || v === 'true';
}

/** Strip §/£/[] markup so list rows show readable titles. */
function cleanTitle(s) {
  if (!s) return s;
  return String(s)
    .replace(/\u00a7./g, '')
    .replace(/\u00a3[^\u00a3]*\u00a3/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Filename stem, used as the item id for one-definition-per-file folders. */
function fileStem(rel) {
  const base = String(rel).replace(/\\/g, '/').split('/').pop();
  return base.replace(/\.[^.]+$/, '');
}

/** Collect top-level ids from a directory of small definition files. */
function collectSimple(index, rel, bucket) {
  const tree = index.cache.tree(rel);
  if (!tree) return;
  index.files[bucket] = (index.files[bucket] || 0) + 1;
  const map = index[bucket];
  if (!map) return;
  for (const e of tree.entries) {
    if (e.value.type !== 'object') continue;
    if (!map.has(e.key)) map.set(e.key, { id: e.key, file: rel, line: e.line });
  }
}

/** Merge scalars from one script block into a Map (later files win only if absent). */
function collectScalars(tree, into) {
  for (const e of tree.entries) {
    if (e.value.type === 'object' || e.value.type === 'array') continue;
    if (!into.has(e.key)) into.set(e.key, scalarValue(e.value));
  }
}

// ---------------------------------------------------------------------------
// Card scaffolding
// ---------------------------------------------------------------------------

/** Build the `locRefs` table for one card. */
function makeLocRefs(resolver, lang) {
  const refs = [];
  const seen = new Set();
  return {
    refs,
    /** Record one script field → localisation key → text mapping. */
    add(field, key, extra) {
      if (!key) return null;
      const dedupe = field + '\u0000' + key;
      if (seen.has(dedupe)) return null;
      seen.add(dedupe);
      const hit = key ? resolver.lookup(key) : null;
      const rec = {
        field,
        key,
        found: !!hit,
        value: hit ? hit.value : null,
        file: hit ? hit.file : null,
        line: hit ? hit.line : null,
        origin: hit ? hit.origin : null,
      };
      if (extra) Object.assign(rec, extra);
      refs.push(rec);
      return rec;
    },
    /** Render a localisation key into rich nodes and record the link. */
    rich(field, key, extra) {
      const rec = this.add(field, key, extra);
      const text = rec && rec.value !== null && rec.value !== undefined ? rec.value : null;
      if (text === null) return null;
      return gametext.renderRich(text, { resolver, lang });
    },
    /** Plain text of a key (markup stripped). */
    plain(field, key, extra) {
      const rec = this.add(field, key, extra);
      return rec && rec.value ? terms.stripMarkup(rec.value) : null;
    },
  };
}

/** The context threaded into `src/gameterms.js` for every line it renders. */
function contentCtx(index, lang) {
  return {
    resolver: index.resolver,
    lang: normalizeLang(lang),
    events: index.eventTitles,
    modifiers: index.modifiers,
    scriptedTriggers: index.scriptedTriggers,
    scriptedEffects: index.scriptedEffects,
    names: index.nameMaps || null,
  };
}

/** Attach the resolved event-modifier definition to the cross-reference context. */
function primeModifierDefs(index) {
  if (index.modifiers.size && !index._modsPrimed) {
    for (const [name, ref] of index.modifiers) {
      const tree = index.cache.tree(ref.file);
      if (!tree) continue;
      const node = getEntry(tree, name);
      if (node) ref.mods = node;
    }
    index._modsPrimed = true;
  }
  // gameterms expects Map<name, { mods }>
  return index.modifiers;
}

function findEntry(tree, id, keys) {
  for (const e of tree.entries) {
    if (!keys.has(e.key)) continue;
    if (e.value.type !== 'object') continue;
    if (scalarValue(getEntry(e.value, 'id')) === id) return e;
  }
  return null;
}

/** Decisions can be nested one level under a container such as `country_decisions`. */
function findDecision(tree, id) {
  for (const e of tree.entries) {
    if (e.key === id && e.value.type === 'object') return e;
    if (e.value.type === 'object' && /decision/i.test(e.key)) {
      const inner = e.value.entries.find((x) => x.key === id && x.value.type === 'object');
      if (inner) return inner;
    }
  }
  return null;
}

/** Resolve the display name for an item, trying every candidate key in order. */
function nameFor(L, field, id, patterns, kind, ctx) {
  for (const pat of patterns || []) {
    const key = pat.replace('{id}', String(id));
    const rec = L.add(field, key);
    if (rec && rec.found && rec.value) {
      return { key, nodes: gametext.renderRich(String(rec.value), { resolver: ctx.resolver, lang: ctx.lang }) };
    }
  }
  // Structural registers know their own names even when the key is unconventional.
  if (kind && ctx.names && ctx.names[kind]) {
    const v = ctx.names[kind].get(String(id));
    if (v) return { key: null, nodes: gametext.renderRich(String(v), { resolver: ctx.resolver, lang: ctx.lang }) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Textures (event pictures, £icon£ escapes)
// ---------------------------------------------------------------------------

const gfxSpriteCache = new Map();

/** Parse every `interface/*.gfx` file for `spriteType = { name = X texturefile = Y }`. */
function spriteIndex(mod, installDir) {
  const key = mod.root + '\u0000' + (installDir || '');
  if (gfxSpriteCache.has(key)) return gfxSpriteCache.get(key);
  const map = new Map();

  const scan = (root, origin) => {
    const dir = path.join(root, 'interface');
    if (!fs.existsSync(dir)) return;
    const stack = [dir];
    let guard = 0;
    while (stack.length && guard++ < 4000) {
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        const abs = path.join(cur, ent.name);
        if (ent.isDirectory()) { stack.push(abs); continue; }
        if (!/\.gfx$/i.test(ent.name)) continue;
        let text;
        try { text = locCodec.decodePlain(fs.readFileSync(abs)); } catch { continue; }
        const re = /spriteType\s*=\s*\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(text))) {
          const body = m[1];
          const nm = /name\s*=\s*"([^"]+)"/.exec(body);
          const tf = /texturefile\s*=\s*"([^"]+)"/.exec(body);
          if (!nm || !tf) continue;
          const sprite = nm[1];
          if (map.has(sprite)) continue;
          // `noOfFrames` marks a horizontal frame strip (EU4's animated buttons and
          // indicators). The decoder returns the whole strip, so a caller that needs
          // one frame must crop to `1/frames` of the width.
          const nf = /noOfFrames\s*=\s*(\d+)/.exec(body);
          map.set(sprite, {
            texture: tf[1],
            origin,
            gfx: path.relative(root, abs).split(path.sep).join('/'),
            frames: nf ? Number(nf[1]) : 1,
          });
        }
      }
    }
  };

  scan(mod.root, 'mod');
  if (installDir) scan(installDir, 'vanilla');

  gfxSpriteCache.set(key, map);
  return map;
}

function existsIn(root, rel) {
  try { return fs.statSync(path.join(root, rel)).isFile(); } catch { return false; }
}

function texUrl(index, rel, origin) {
  const base = `/api/mod/${encodeURIComponent(index.modId)}/tex?path=${encodeURIComponent(rel)}`;
  return origin === 'vanilla' ? base + '&origin=vanilla' : base;
}

/**
 * A URL that renders the picture for an event, or null.
 *
 * The conventional path is tried first (`gfx/event_pictures/<picture>.dds`) and
 * the gfx sprite index only as a fallback, so we avoid parsing interface files
 * for the common case.
 */
function resolveEventPicture(index, picture) {
  if (!picture) return null;
  const mod = index.mod;
  const installDir = index.installDir;
  const candidates = [
    `gfx/event_pictures/${picture}.dds`,
    `gfx/interface/event_pictures/${picture}.dds`,
  ];

  for (const rel of candidates) {
    if (existsIn(mod.root, rel)) return texUrl(index, rel, 'mod');
  }

  const sprites = spriteIndex(mod, installDir);
  const hit = sprites.get(picture) || sprites.get(`GFX_${picture}`) || sprites.get(`GFX_event_picture_${picture}`);
  if (hit) {
    if (hit.origin === 'mod' && existsIn(mod.root, hit.texture)) return texUrl(index, hit.texture, 'mod');
    if (installDir && existsIn(installDir, hit.texture)) return texUrl(index, hit.texture, 'vanilla');
  }
  if (installDir) {
    for (const rel of candidates) if (existsIn(installDir, rel)) return texUrl(index, rel, 'vanilla');
  }
  return null;
}

/**
 * Resolve a sprite name to a texture URL, across every sprite-naming convention
 * EU4 mods use in practice. Used for event pictures, `£icon£` escapes and the
 * `sprite` / `icon` / `button_gfx` fields of the newer content types.
 */
function resolveSpriteInfo(index, name) {
  if (!name) return null;
  const sprites = spriteIndex(index.mod, index.installDir);
  const bare = String(name).replace(/^GFX_/, '');
  const candidates = [
    name, `GFX_${bare}`, bare,
    `GFX_icon_${bare}`, `icon_${bare}`,
    `GFX_${bare}_icon`, `${bare}_icon`,
    `GFX_${bare}_button`, `GFX_${bare}_btn`,
  ];
  let hit = null;
  for (const c of candidates) { hit = sprites.get(c); if (hit) break; }
  if (!hit) return null;
  const url = (hit.origin === 'mod' && existsIn(index.mod.root, hit.texture))
    ? texUrl(index, hit.texture, 'mod')
    : (index.installDir && existsIn(index.installDir, hit.texture) ? texUrl(index, hit.texture, 'vanilla') : null);
  if (!url) return null;
  return { url, frames: hit.frames || 1, sprite: name, texture: hit.texture, origin: hit.origin };
}

/** A sprite name → texture URL, or null. See `resolveSpriteInfo` for frame strips. */
function resolveSprite(index, name) {
  const info = resolveSpriteInfo(index, name);
  return info ? info.url : null;
}

/** Resolve a `£icon_name£` escape to a texture URL. */
function resolveIcon(index, name) {
  return resolveSprite(index, name);
}

// ---------------------------------------------------------------------------
// Generic engine — block classification
// ---------------------------------------------------------------------------

/** Keys whose object value is a condition block. */
const COND_KEYS = new Set([
  'potential', 'allow', 'trigger', 'can_select', 'is_valid', 'can_start', 'can_stop',
  'can_end', 'build_trigger', 'can_use_modifiers_trigger', 'can_upgrade_trigger',
  'keep_trigger', 'available', 'can_embrace', 'can_hire', 'can_recruit', 'can_use',
  'requirements', 'requirement', 'task_requirements', 'fail_if', 'can_negotiate_trigger',
  'can_enforce_trigger', 'siege_won_trigger', 'nation_designer_trigger', 'is_potential_overlord',
  'potential_on_load', 'can_form_personal_unions', 'can_fight_independence_war',
  'joins_overlords_wars', 'joins_colonial_wars', 'overlord_can_attack', 'takes_diplo_slot',
  'prerequisites', 'prerequisites_self', 'valid_for_nation_designer', 'can_declare_war',
  'possible', 'is_visible', 'requires_is_allowed', 'requires_demand_independence',
  'requires_make_subject', 'can_be_moved', 'has_country_shield', 'can_change_primary_culture',
  'allow_only_primary_culture', 'allow_only_accepted_culture', 'formation_trigger',
  'can_start_election', 'on_condition', 'provinces_to_highlight', 'highlight_provinces',
  'select_trigger', 'completion_trigger', 'valid_trigger', 'ai_will_select',
]);

/** Keys whose object value is an effect block. */
const EFF_KEYS = new Set([
  'effect', 'immediate', 'after', 'immediate_effect', 'hidden_effect', 'on_start', 'on_end',
  'on_monthly', 'on_built', 'on_destroyed', 'on_granted', 'on_revoked', 'on_activation',
  'on_deactivation', 'on_effect', 'off_effect', 'removed_effect', 'pre_effect',
  'task_completed_effect', 'failing_effect', 'on_construction_started',
  'on_construction_canceled', 'on_obsolete', 'on_convert', 'on_progress',
  'demands_enforced_effect', 'per_province_effect', 'per_province_abandon_effect',
  'on_action', 'effect_on_start', 'effect_on_end', 'start_effect', 'end_effect',
  'on_reform', 'effect_of', 'can_use_effect',
  // Control flow only ever appears inside an effect or a trigger block; at the
  // top level of the definition files below it is always an effect.
  'if', 'else', 'else_if', 'while', 'random_list', 'random_owned_province',
  'random_owned_area', 'every_owned_province', 'tooltip',
]);

/** Keys whose object value is a modifier list. */
const MOD_KEYS = new Set([
  'modifier', 'modifiers', 'country_modifier', 'country_modifiers', 'province_modifier',
  'province_modifiers', 'country_modifier_happy', 'country_modifier_neutral',
  'country_modifier_angry', 'land_ownership_modifier', 'modifier_by_land_ownership',
  'bonus', 'penalties', 'benefits', 'harmonized_modifier', 'static_modifier',
  'static_modifiers', 'timed_modifiers', 'loyalty_scaled_conditional_modifier',
  'conditional_modifier', 'tradition', 'ambition', 'secondary_religion_modifier',
  'country_modifier_secondary', 'province_modifier_secondary', 'religion_modifier',
  'ruler_modifier', 'heir_modifier', 'consort_modifier', 'age_modifier',
  'effect_modifier', 'is_scholar_modifier', 'hidden_modifier', 'opinion_modifier',
  'province_triggered_modifier', 'triggered_modifier', 'mission_modifier',
  'estate_modifier', 'government_modifier', 'reform_modifier', 'disaster_modifier',
  'unit_modifier', 'leader_modifier', 'global_modifier', 'local_modifier',
]);

/** Keys whose object value is a weighted-AI block (`factor` + `modifier`s). */
const WEIGHT_KEYS = new Set([
  'ai_will_do', 'ai_chance', 'ai', 'spawn_chance', 'movement_evaluation',
  'selection_weight', 'ai_weight', 'ai_priority', 'ai_trade_score', 'ai_war_score',
  'chance', 'ai_will_accept', 'ai_will_propose', 'chance_of_appearing',
  'mean_time_to_happen', 'mtth', 'ai_will_select',
]);

/** Keys whose array/object value is a list of references — never a raw block. */
const LIST_KEYS = new Set([
  'events', 'random_events', 'abilities', 'objectives', 'privileges', 'agendas', 'ideas',
  'missions', 'tiers', 'countries', 'easy_country', 'members', 'provinces', 'areas',
  'enable', 'required_missions', 'slots', 'powers', 'interactions', 'names', 'male_names',
  'female_names', 'dynasty_names', 'sea_starts', 'lakes', 'only_used_for_random',
  'government_abilities', 'subject_type', 'casus_belli', 'province_ids', 'options',
  'custom_attributes', 'sprites', 'traditions', 'potential_on_load', 'expects_institution',
]);

/** Script keys that are structure, not content — never shown as a field. */
const STRUCT_KEYS = new Set([
  'name', 'title', 'desc', 'id', 'namespace', 'picture', 'icon', 'sprite',
  'desc_key', 'mercenary_desc_key',
]);

/**
 * Human labels for block keys. Anything missing falls back to the raw script key,
 * so an unlabelled block is still faithful — just not prettified.
 */
const BLOCK_LABEL = {
  modifier: L('修正', 'Modifiers'),
  modifiers: L('修正', 'Modifiers'),
  country_modifier: L('国家修正', 'Country modifiers'),
  province_modifier: L('省份修正', 'Province modifiers'),
  country_modifier_happy: L('忠诚（满意）时的国家修正', 'Country modifiers while loyal'),
  country_modifier_neutral: L('忠诚（中立）时的国家修正', 'Country modifiers while neutral'),
  country_modifier_angry: L('忠诚（不满）时的国家修正', 'Country modifiers while disloyal'),
  land_ownership_modifier: L('土地占有修正', 'Land ownership modifiers'),
  modifier_by_land_ownership: L('按土地占有的修正', 'Modifiers by land ownership'),
  conditional_modifier: L('条件修正', 'Conditional modifier'),
  loyalty_scaled_conditional_modifier: L('按忠诚缩放的修正', 'Loyalty-scaled modifier'),
  harmonized_modifier: L('和谐修正', 'Harmonised modifier'),
  bonus: L('奖励修正', 'Bonus modifier'),
  penalties: L('惩罚', 'Penalties'),
  benefits: L('收益', 'Benefits'),
  potential: L('生效条件 potential', 'Potential'),
  potential_on_load: L('载入时条件 potential_on_load', 'Potential on load'),
  allow: L('允许条件 allow', 'Allow'),
  trigger: L('触发条件 trigger', 'Trigger'),
  can_select: L('可选条件 can_select', 'Can select'),
  is_valid: L('有效性 is_valid', 'Is valid'),
  can_start: L('可以开始 can_start', 'Can start'),
  can_stop: L('可以停止 can_stop', 'Can stop'),
  can_end: L('可以结束 can_end', 'Can end'),
  build_trigger: L('建造条件 build_trigger', 'Build trigger'),
  can_upgrade_trigger: L('升级条件 can_upgrade_trigger', 'Can upgrade'),
  keep_trigger: L('保留条件 keep_trigger', 'Keep trigger'),
  ruler_allow: L('作为君主时 ruler_allow', 'As ruler'),
  heir_allow: L('作为继承人时 heir_allow', 'As heir'),
  consort_allow: L('作为配偶时 consort_allow', 'As consort'),
  can_use_modifiers_trigger: L('可用修正的条件', 'Can use modifiers'),
  available: L('可用条件 available', 'Available'),
  can_embrace: L('可接纳条件 can_embrace', 'Can embrace'),
  requirements: L('需求 requirements', 'Requirements'),
  task_requirements: L('任务需求 task_requirements', 'Task requirements'),
  fail_if: L('失败条件 fail_if', 'Fail if'),
  prerequisites: L('前置条件 prerequisites', 'Prerequisites'),
  prerequisites_self: L('自身前置条件', 'Prerequisites (self)'),
  progress: L('推进条件 progress', 'Progress'),
  effect: L('效果 effect', 'Effect'),
  immediate: L('立即效果 immediate', 'Immediate'),
  immediate_effect: L('立即效果 immediate_effect', 'Immediate effect'),
  after: L('后续效果 after', 'After'),
  hidden_effect: L('隐藏效果 hidden_effect', 'Hidden effect'),
  removed_effect: L('移除时的效果 removed_effect', 'Effect when removed'),
  on_start: L('开始时 on_start', 'On start'),
  on_end: L('结束时 on_end', 'On end'),
  on_monthly: L('每月 on_monthly', 'On monthly'),
  on_built: L('建成时 on_built', 'On built'),
  on_destroyed: L('拆除时 on_destroyed', 'On destroyed'),
  on_granted: L('授予时 on_granted', 'On granted'),
  on_revoked: L('撤销时 on_revoked', 'On revoked'),
  on_activation: L('激活时 on_activation', 'On activation'),
  on_deactivation: L('失效时 on_deactivation', 'On deactivation'),
  on_effect: L('启用时的效果 on_effect', 'On effect'),
  off_effect: L('停用时的效果 off_effect', 'Off effect'),
  pre_effect: L('前置效果 pre_effect', 'Pre-effect'),
  task_completed_effect: L('任务完成效果', 'Task completed effect'),
  failing_effect: L('任务失败效果', 'Failing effect'),
  per_province_effect: L('每省份效果 per_province_effect', 'Per-province effect'),
  per_province_abandon_effect: L('每省份弃用效果', 'Per-province abandon effect'),
  on_convert: L('皈依时 on_convert', 'On convert'),
  ai_will_do: L('AI 意愿 ai_will_do', 'AI will do'),
  ai_chance: L('AI 选择权重 ai_chance', 'AI chance'),
  spawn_chance: L('出现权重 spawn_chance', 'Spawn chance'),
  movement_evaluation: L('移动评分 movement_evaluation', 'Movement evaluation'),
  selection_weight: L('选取权重 selection_weight', 'Selection weight'),
  ai: L('AI 权重 ai', 'AI weight'),
  chance: L('出现概率 chance', 'Chance'),
  events: L('触发的事件 events', 'Events fired'),
  abilities: L('时代能力 abilities', 'Age abilities'),
  objectives: L('时代目标 objectives', 'Age objectives'),
  privileges: L('阶层特权 privileges', 'Estate privileges'),
  agendas: L('阶层议程 agendas', 'Estate agendas'),
  required_missions: L('前置任务 required_missions', 'Required missions'),
  enable: L('解锁单位 enable', 'Units enabled'),
  names: L('名称表 names', 'Name list'),
  powers: L('政府能力 powers', 'Government powers'),
  interactions: L('互动 interactions', 'Interactions'),
  emperor: L('皇帝修正', "Emperor's modifiers"),
  member: L('成员修正', "Members' modifiers"),
  country: L('国家修正', 'Country modifiers'),
  province: L('省份修正', 'Province modifiers'),
  variables: L('变量 variables', 'Variables'),
  custom_attributes: L('政府属性 custom_attributes', 'Government attributes'),
  superregion: L('大区 superregion', 'Superregions'),
  tier_0: L('0 级', 'Tier 0'),
  tier_1: L('1 级', 'Tier 1'),
  tier_2: L('2 级', 'Tier 2'),
  tier_3: L('3 级', 'Tier 3'),
  tier_4: L('4 级', 'Tier 4'),
};

/** Labels for scalar script keys promoted to card fields. */
const STATE_LABEL = {
  cost: L('花费', 'Cost'),
  build_cost: L('建造花费', 'Build cost'),
  time: L('耗时', 'Time'),
  months: L('月数', 'Months'),
  duration: L('持续', 'Duration'),
  cooldown_years: L('冷却年数', 'Cooldown (years)'),
  monarch_power: L('君主点数类别', 'Monarch power type'),
  power_type: L('点数类别', 'Power type'),
  cost_type: L('花费类型', 'Cost type'),
  base_price: L('基础价格', 'Base price'),
  price: L('价格', 'Price'),
  start: L('起始年份', 'Start year'),
  date: L('日期', 'Date'),
  year: L('年份', 'Year'),
  level: L('等级', 'Level'),
  starting_tier: L('初始等级', 'Starting tier'),
  max_level: L('最高等级', 'Max level'),
  slot: L('槽位', 'Slot'),
  land_share: L('土地占有比例', 'Land share'),
  max_absolutism: L('绝对主义上限', 'Max absolutism'),
  loyalty: L('忠诚度', 'Loyalty'),
  influence: L('影响力', 'Influence'),
  base_influence: L('基础影响力', 'Base influence'),
  opinion: L('好感度', 'Opinion'),
  yearly_decay: L('每年衰减', 'Yearly decay'),
  type: L('类型', 'Type'),
  unit_type: L('兵种科技组', 'Unit tech group'),
  category: L('类别', 'Category'),
  technology_group: L('科技组', 'Technology group'),
  graphical_culture: L('图形文化', 'Graphical culture'),
  government: L('政体', 'Government'),
  government_rank: L('政府等级', 'Government rank'),
  religion: L('宗教', 'Religion'),
  primary_culture: L('主流文化', 'Primary culture'),
  area: L('扩散范围', 'Spread area'),
  defection: L('叛变', 'Defection'),
  independence: L('独立倾向', 'Independence'),
  unit_transfer: L('转移部队', 'Unit transfer'),
  resilient: L('坚韧', 'Resilient'),
  reinforcing: L('可补充', 'Reinforcing'),
  general: L('自带将领', 'Has general'),
  smart: L('智能', 'Smart'),
  will_relocate: L('会转移', 'Will relocate'),
  dynasty: L('王朝', 'Dynasty'),
  disband_on_leader_death: L('主将阵亡后解散', 'Disbands on leader death'),
  gfx_type: L('图标类型', 'Icon type'),
  artillery: L('炮兵比例', 'Artillery share'),
  infantry: L('步兵比例', 'Infantry share'),
  cavalry: L('骑兵比例', 'Cavalry share'),
  morale: L('士气倍率', 'Morale multiplier'),
  maneuver: L('机动', 'Maneuver'),
  offensive_morale: L('进攻士气', 'Offensive morale'),
  defensive_morale: L('防御士气', 'Defensive morale'),
  offensive_fire: L('进攻火力', 'Offensive fire'),
  defensive_fire: L('防御火力', 'Defensive fire'),
  offensive_shock: L('进攻冲击', 'Offensive shock'),
  defensive_shock: L('防御冲击', 'Defensive shock'),
  width: L('宽度', 'Width'),
  height: L('高度', 'Height'),
  max_provinces: L('最大省份数', 'Max provinces'),
  terrain: L('地形', 'Terrain'),
  movement_cost: L('移动消耗', 'Movement cost'),
  defence: L('防御加成', 'Defence'),
  supply_limit: L('补给上限', 'Supply limit'),
  local_development_cost: L('本地发展度花费', 'Local development cost'),
  local_defensiveness: L('本地防御', 'Local defensiveness'),
  nation_designer_cost_multiplier: L('国家设计器花费倍率', 'Nation designer cost multiplier'),
  local_institution_spread: L('本地思潮传播', 'Local institution spread'),
  sound_type: L('音效类型', 'Sound type'),
  historical_idea_groups: L('历史理念组', 'Historical idea groups'),
  historical_units: L('历史兵种', 'Historical units'),
  default: L('默认书签', 'Default bookmark'),
  center: L('地图中心省份', 'Map centre province'),
  localization: L('本地化键 localization', 'Localisation key'),
  ai_priority: L('AI 优先级', 'AI priority'),
  sprite: L('精灵图 sprite', 'Sprite'),
  button_gfx: L('按钮贴图 button_gfx', 'Button sprite'),
  can_be_moved: L('可以搬迁', 'Can be moved'),
  move_days_per_unit_distance: L('搬迁天数／距离', 'Days per unit of distance'),
  icon: L('图标 icon', 'Icon'),
  is_latent: L('潜藏商品', 'Latent trade good'),
  is_valuable: L('贵重商品', 'Valuable'),
  rnw_latent_chance: L('随机新世界出现概率', 'Random New World latent chance'),
  factor: L('权重系数 factor', 'Factor'),
  harsh_treatment: L('严酷镇压绝对主义', 'Absolutism from harsh treatment'),
  stability: L('稳定度绝对主义', 'Absolutism from stability'),
  war_exhaustion: L('厌战绝对主义', 'Absolutism from war exhaustion'),
  absolutism: L('绝对主义调整', 'Absolutism modifiers'),
  papacy: L('教廷影响力倍率', 'Papal influence multiplier'),
  religious_conflicts: L('宗教冲突', 'Religious conflicts'),
  can_change_primary_culture: L('可改主流文化', 'Can change primary culture'),
  allow_normal_conversion: L('允许常规转教', 'Allows normal conversion'),
  valid_for_nation_designer: L('国家设计器可选', 'Available in nation designer'),
  nation_designer_cost: L('国家设计器花费', 'Nation designer cost'),
  lock_level_when_selected: L('选中后锁定等级', 'Locks level when selected'),
  free_concentrate_development: L('免费集中发展度', 'Free concentrate development'),
  raze_province: L('可掠夺省份', 'Can raze provinces'),
  primary: L('主流文化', 'Primary'),
  is_potential_overlord: L('可成为宗主国', 'Can be overlord'),
  sprite_level: L('兵模等级', 'Sprite level'),
  expects_institution: L('期望已接纳思潮', 'Expects institutions'),
  is_triggered_only: L('仅由脚本触发', 'Triggered only'),
  is_major: L('重大', 'Major'),
  major: L('重大', 'Major'),
  hidden: L('隐藏', 'Hidden'),
  fire_only_once: L('只触发一次', 'Fire only once'),
  allow_only_male: L('仅男性', 'Only male'),
  allow_only_female: L('仅女性', 'Only female'),
  allow_only_primary_culture: L('仅主流文化', 'Only primary culture'),
  allow_only_accepted_culture: L('仅已接受文化', 'Only accepted culture'),
  free: L('免费', 'Free'),
  cost_modifier: L('花费倍率', 'Cost modifier'),
  max_absolutism_increase: L('绝对主义上限增加', 'Max absolutism increase'),
  cooldown: L('冷却', 'Cooldown'),
  ai_importance: L('AI 重要度', 'AI importance'),
  on_progress: L('推进时 on_progress', 'On progress'),
  ended_by_country_breaking_to_rebels: L('因国家崩溃而结束', 'Ends when the country breaks to rebels'),
  regent: L('摄政', 'Regent'),
  heir: L('继承人', 'Heir'),
  consort: L('配偶', 'Consort'),
  ruler: L('君主', 'Ruler'),
  max_possible_parliament_seats: L('议会席位上限', 'Max parliament seats'),
  parliament_effect_duration: L('议会效果时长', 'Parliament effect duration'),
  min_autonomy: L('最低自治度', 'Minimum autonomy'),
  min_autonomy_in_territories: L('领地最低自治度', 'Min autonomy in territories'),
  missionary_strength: L('传教力量', 'Missionary strength'),
  position: L('位置', 'Position'),
  month: L('月份', 'Month'),
  season: L('季节', 'Season'),
  color: L('颜色', 'Colour'),
  flag_emblem_index_range: L('旗帜徽记索引范围', 'Flag emblem index range'),
  allowed_idea_groups: L('可开启理念组数', 'Idea groups available'),
  expire_message_type: L('到期提示类型', 'Expiry message type'),
  religion_sub_modifier: L('宗教类子修正', 'Religion-scoped modifier'),
  is_scholar_modifier: L('学者修正', 'Scholar modifier'),
  hre_religion: L('神罗官方宗教', 'HRE religion'),
  uses_anglican_power: L('使用圣公会力量', 'Uses Anglican power'),
  aspects_name: L('信条名称键', 'Aspects name key'),
  defender_of_faith: L('可成为信仰守护者', 'Defender of the faith'),
  can_form_personal_unions: L('可联姻联合统治', 'Can form personal unions'),
  center_of_religion: L('宗教中心省份', 'Centre of religion'),
  flags_with_emblem_percentage: L('带徽记旗帜比例', 'Flags with emblem (%)'),
  crusade_name: L('十字军名称键', 'Crusade name key'),
  harmonized_modifier: L('和谐修正键', 'Harmonised modifier key'),
  influence_from_dev_modifier: L('发展度带来的影响力', 'Influence per development'),
  is_latent: L('潜藏商品', 'Latent trade good'),
  is_valuable: L('贵重商品', 'Valuable trade good'),
  rnw_latent_chance: L('随机新世界出现概率', 'Random New World latent chance'),
  mercenary_desc_key: L('雇佣兵描述键', 'Mercenary description key'),
  regiments_per_development: L('每点发展度的团数', 'Regiments per development'),
  home_province: L('母省', 'Home province'),
  cavalry_weight: L('骑兵权重', 'Cavalry weight'),
  artillery_weight: L('炮兵权重', 'Artillery weight'),
  cavalry_cap: L('骑兵上限比例', 'Cavalry cap'),
  cost_modifier: L('花费倍率', 'Cost modifier'),
  cost_type: L('花费类型', 'Cost type'),
  per_province_cost: L('每省份花费', 'Cost per province'),
  ai_priority: L('AI 优先级', 'AI priority'),
};

function blockLabel(key, lang) {
  const pair = BLOCK_LABEL[key];
  if (pair) return pick(pair, lang);
  return String(key);
}

function stateLabel(key, lang) {
  const pair = STATE_LABEL[key] || terms.FIELD_LABEL[key];
  if (pair) return pick(pair, lang);
  return null;
}

// ---------------------------------------------------------------------------
// Generic engine — index collection
// ---------------------------------------------------------------------------

/**
 * How a descriptor finds its items inside a file.
 *
 *   block          one item per top-level object key        (buildings, religions)
 *   file           one item per file, id = filename stem    (units)
 *   ordinal        the Nth block with key `blockKey`        (technologies)
 *   groupchildren  one item per top-level group *and* one per
 *                  object child of that group               (religions, cultures)
 */
function enumerateRefs(mode, tree, rel, folder, opts) {
  const out = [];
  const kind = folder.kind;
  if (mode === 'block') {
    for (const e of tree.entries) {
      if (e.value.type !== 'object') continue;
      if (opts.skipKeys && opts.skipKeys.has(e.key)) continue;
      out.push({ id: e.key, line: e.line, kind });
    }
  } else if (mode === 'file') {
    out.push({ id: fileStem(rel), line: 1, kind });
  } else if (mode === 'ordinal') {
    let n = 0;
    for (const e of tree.entries) {
      if (e.key !== opts.blockKey) continue;
      if (e.value.type !== 'object') continue;
      n++;
      out.push({ id: `${fileStem(rel)}#${n}`, line: e.line, kind, level: n });
    }
  } else if (mode === 'groupchildren') {
    for (const g of tree.entries) {
      if (g.value.type !== 'object') continue;
      if (folder.groupItems !== false && (!opts.skipKeys || !opts.skipKeys.has(g.key))) {
        out.push({ id: g.key, line: g.line, kind: folder.groupKind || (kind + '_group') });
      }
      for (const c of g.value.entries) {
        if (c.value.type !== 'object') continue;
        if (opts.skipKeys && opts.skipKeys.has(c.key)) continue;
        out.push({ id: c.key, line: c.line, kind, parent: g.key });
      }
    }
  }
  return out;
}

function stemOf(rel, opts) {
  if (opts && opts.idPrefix) return opts.idPrefix;
  return fileStem(rel);
}

/** Build the index entry list for one generic descriptor. */
function collectGeneric(index, files, spec, type) {
  const cache = index.cache;
  if (!index.lists[type]) index.lists[type] = [];
  for (const folder of spec.folders) {
    const mode = folder.mode || spec.mode || 'block';
    const opts = { blockKey: folder.blockKey || spec.blockKey, skipKeys: spec.skipKeys };
    const any = folder.anyExt ? underPrefixAny : underPrefix;
    for (const rel of files) {
      if (!any(rel, [folder.prefix])) continue;
      index.counters[folder.prefix] = (index.counters[folder.prefix] || 0) + 1;
      const tree = cache.tree(rel);
      if (!tree) { index.errors.push({ file: rel, error: 'unreadable' }); continue; }
      let refs;
      try { refs = enumerateRefs(mode, tree, rel, folder, opts); } catch { refs = []; }
      for (const r of refs) {
        const ref = makeRef(type, r.id, rel, r.line, {
          kind: r.kind,
          level: r.level,
          parent: r.parent,
          folder: folder.prefix,
          mode,
        });
        index.lists[type].push(ref);
        if (folder.refExtra) { try { folder.refExtra(ref, tree, index); } catch { /* keep the ref */ } }
        indexTitleFor(index, type, ref, spec);
      }
    }
  }
}

/**
 * The display title of one indexed item.
 *
 * `index.titles` holds a plain string resolved from the mod's own localisation —
 * the same language-independent string the existing six types already store, and
 * what the list search matches on. Titles that cannot come from localisation at
 * all (a technology level, a GUI window name) go into `index.synthTitles` as a
 * `{zh, en}` pair so the list endpoint can pick per language.
 */
function indexTitleFor(index, type, ref, spec) {
  if (spec.titleFn) {
    const pair = spec.titleFn(index, ref);
    if (pair) {
      if (!index.synthTitles) index.synthTitles = new Map();
      index.synthTitles.set(type + ':' + ref.id, pair);
      index.titles.set(type + ':' + ref.id, typeof pair === 'string' ? pair : pair.zh);
      return;
    }
  }
  const id = ref.id.includes('#') ? ref.id.split('#').pop() : ref.id;
  const L2 = makeLocRefs(index.resolver, 'zh');
  for (const pat of spec.titlePatterns || ['{id}']) {
    const key = pat.replace('{id}', String(id));
    const rec = L2.add('title', key);
    if (rec && rec.found && rec.value) {
      index.titles.set(type + ':' + ref.id, cleanTitle(String(rec.value)));
      return;
    }
  }
  // Types whose script ids *are* their display names (on_actions, scripted
  // effects) still deserve a readable row.
  if (spec.rawTitle) index.titles.set(type + ':' + ref.id, String(ref.id));
}

// ---------------------------------------------------------------------------
// Generic engine — card building
// ---------------------------------------------------------------------------

const MAX_RAW_ROWS = 400;

/** Labels for a block whose whole body is one script list. */
const WHOLE_LABEL = {
  cond: L('触发条件内容', 'Condition script'),
  eff: L('效果内容', 'Effect script'),
  mod: L('修正', 'Modifiers'),
};

const WEIGHT_BASE = L('基础权重', 'Base weight');
const WEIGHT_WHEN = L('当满足', 'when');

/**
 * A weighted-AI block: `factor` plus any number of `modifier = { factor … }`
 * entries. The game multiplies the base weight by each matching modifier, so the
 * lines read as "×2 when …" followed by that modifier's own conditions — which
 * is what the in-game tooltip shows, and far closer than dumping the raw script.
 */
function weightLines(node, ctx, lang) {
  const out = [];
  if (!node || node.type !== 'object') return out;
  const factor = getEntry(node, 'factor');
  if (factor && factor.type !== 'object' && factor.type !== 'array') {
    out.push({
      i: 0,
      k: 'weight',
      spans: [
        { t: 'text', s: pick(WEIGHT_BASE, lang) },
        { t: 'text', s: ' = ', c: 'muted' },
        { t: 'val', s: scalarValue(factor), c: 'neutral' },
      ],
    });
  }
  const { order, map } = entriesByKey(node);
  void order;
  for (const e of map.get('modifier') || []) {
    if (e.value.type !== 'object') continue;
    const f = getEntry(e.value, 'factor');
    const rest = { type: 'object', entries: e.value.entries.filter((x) => x.key !== 'factor') };
    out.push({
      i: 0,
      k: 'weight',
      spans: [
        { t: 'val', s: '\u00d7' + (f ? scalarValue(f) : '1'), c: 'neutral' },
        { t: 'text', s: ' ' + pick(WEIGHT_WHEN, lang) + '\uff1a' },
      ],
    });
    for (const l of terms.conditionLines(rest, ctx, { indent: 1 })) out.push(l);
  }
  // Anything else in the block (rare) keeps the generic presentation.
  const other = { type: 'object', entries: node.entries.filter((x) => x.key !== 'factor' && x.key !== 'modifier') };
  if (other.entries.length) {
    for (const l of terms.effectLines(other, ctx, { indent: 0 })) out.push(l);
  }
  return out;
}

/** Flatten a script node into indented `{i,k,v}` rows for the raw viewer. */
function rawRows(node, depth, out) {
  if (!node || out.length >= MAX_RAW_ROWS) return out;
  if (node.type === 'object') {
    for (const e of node.entries) {
      if (out.length >= MAX_RAW_ROWS) break;
      if (e.value.type === 'object') {
        out.push({ i: depth, k: e.key, v: '' });
        rawRows(e.value, depth + 1, out);
      } else if (e.value.type === 'array') {
        out.push({ i: depth, k: e.key, v: e.value.items.map((x) => scalarValue(x)).join(' ') });
      } else {
        out.push({ i: depth, k: e.key, v: scalarValue(e.value) });
      }
    }
  } else if (node.type === 'array') {
    for (const it of node.items) {
      if (out.length >= MAX_RAW_ROWS) break;
      if (it.type === 'object') { out.push({ i: depth, k: '', v: '' }); rawRows(it, depth + 1, out); }
      else out.push({ i: depth, k: '', v: scalarValue(it) });
    }
  }
  return out;
}

function colorValue(node) {
  const vals = node.type === 'array' ? node.items.map((x) => scalarValue(x)) : [scalarValue(node)];
  const nums = vals.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (nums.length < 3) return null;
  return { r: nums[0], g: nums[1], b: nums[2] };
}

function fieldRecord(key, node, lang) {
  const label = stateLabel(key, lang);
  if (node.type === 'array') {
    const color = colorValue(node);
    const vals = node.items.map((x) => scalarValue(x));
    if (color) {
      return { key, label: label || key, value: vals.join(' '), tone: 'color', color, raw: node.type };
    }
    return { key, label: label || key, value: vals.join(' '), tone: 'text' };
  }
  const v = scalarValue(node);
  const tone = /^(yes|true)$/i.test(v) ? 'yes' : /^(no|false)$/i.test(v) ? 'no' : (/^-?\d+(\.\d+)?$/.test(v) ? 'num' : 'text');
  return { key, label: label || key, value: v, tone };
}

/** Merge several script blocks that share a key into one (the engine does the same). */
function mergeNodes(nodes) {
  const entries = [];
  for (const n of nodes) {
    if (!n) continue;
    if (n.type === 'object') entries.push(...n.entries);
    else if (n.type === 'array') entries.push(...n.items.map((it) => ({ key: '', value: it, line: 0 })));
  }
  return { type: 'object', entries };
}

/**
 * Turn a list block (`events`, `enable`, `abilities`…) into card items.
 *
 * An object value is read three ways, because EU4 uses all three: a nested
 * object means "this key names a thing", `key = yes` means "this key is a flag",
 * and anything else is a value list.
 */
function listItems(key, node, ctx, spec) {
  const items = [];
  const linkKind = (spec.linkKinds && spec.linkKinds[key]) || null;
  const push = (id, extra) => {
    if (id === null || id === undefined || id === '') return;
    const str = String(id);
    const entry = { id: str };
    // The display name of a referenced id is always the id's own localisation
    // key, whatever kind it is, so fall back to a plain lookup when the kind's
    // own candidate list does not hit (a tech that unlocks a building, say).
    let nm = linkKind ? terms.nameOf(linkKind, str, ctx) : null;
    if (!nm && ctx && ctx.resolver) {
      const hit = ctx.resolver.lookup(str);
      if (hit && hit.value) {
        nm = terms.stripMarkup(hit.value);
        if (ctx.used) ctx.used.push({ key: str, value: hit.value, file: hit.file, line: hit.line, origin: hit.origin });
      }
    }
    // Item names are rich nodes everywhere else on a card, so keep them that way.
    if (nm && nm !== str) entry.name = [{ t: 'text', s: nm }];
    if (linkKind) entry.link = { kind: linkKind, id: str };
    if (extra) Object.assign(entry, extra);
    items.push(entry);
  };
  if (node.type === 'array') {
    for (const it of node.items) {
      if (it.type === 'object') {
        const id = scalarValue(getEntry(it, 'id')) || scalarValue(getEntry(it, 'name')) || scalarValue(getEntry(it, 'event'));
        push(id, { weight: scalarValue(getEntry(it, 'factor')) || null });
      } else push(scalarValue(it));
    }
  } else if (node.type === 'object') {
    const keyed = (spec.keyedLists && spec.keyedLists[key]) || null;
    for (const e of node.entries) {
      if (e.value.type === 'object' || e.value.type === 'array') { push(e.key); continue; }
      const v = scalarValue(e.value);
      if (keyed === 'key' || keyed === 'keyWeight') {
        // `random_events = { 1234 = 5 }` — the key is the event, the value a weight.
        push(e.key, keyed === 'keyWeight' ? { weight: v } : undefined);
        continue;
      }
      if (v === '' || v === undefined || v === null) { push(e.key); continue; }
      if (v === 'yes' || v === 'no' || v === 'true' || v === 'false') push(e.key, { state: v });
      else push(v, { key: e.key });
    }
  } else {
    push(scalarValue(node));
  }
  return items;
}

/** All entries of one key, in file order (EU4 repeats keys freely). */
function entriesByKey(node) {
  const order = [];
  const map = new Map();
  for (const e of node.entries) {
    if (!map.has(e.key)) { map.set(e.key, []); order.push(e.key); }
    map.get(e.key).push(e);
  }
  return { order, map };
}

/** A sub-table for an object block whose children are all scalars. */
function subFields(node, lang) {
  const out = [];
  for (const e of node.entries) {
    if (e.value.type === 'object' && e.value.entries.length === 0) continue;
    if (e.value.type === 'object' || e.value.type === 'array') return null;
    const label = stateLabel(e.key, lang) || (terms.FIELD_LABEL[e.key] ? pick(terms.FIELD_LABEL[e.key], lang) : null) || e.key;
    out.push({ key: e.key, label, value: scalarValue(e.value), tone: fieldRecord(e.key, e.value, lang).tone });
  }
  return out;
}

/** One group per significant child block of the definition. */
function buildGroups(node, ctx, spec, lang, LR) {
  const groups = [];
  const handled = new Set(spec.handledKeys || []);
  const { order, map } = entriesByKey(node);
  for (const key of order) {
    if (handled.has(key)) continue;
    if (STRUCT_KEYS.has(key)) continue;
    const entries = map.get(key);
    const label = blockLabel(key, lang);
    const specMod = (spec.modBlocks || {})[key];
    const specCond = (spec.condBlocks || {})[key];
    const specEff = (spec.effBlocks || {})[key];
    const nodes = entries.map((e) => e.value);
    const only = nodes[0];
    const isBlock = nodes.every((n) => n.type === 'object' || n.type === 'array');
    if (!isBlock) continue;   // scalars/lists of scalars are fields

    // A descriptor-declared entry table: repeated records with their own fields.
    const eb = (spec.entryBlocks || {})[key];
    if (eb) {
      const items = [];
      if (eb.render === 'self' || eb.render === 'block') {
        // The outer entries are named groups (`objectives`, `abilities`); the
        // records are their children.
        for (const e of entries) {
          if (e.value.type !== 'object') continue;
          for (const child of e.value.entries) {
            if (child.value.type !== 'object') continue;
            const nm = LR ? LR.rich('entry', child.key) : null;
            const rec = { id: child.key, nameKey: child.key, name: nm };
            if (eb.render === 'self') {
              rec.lines = terms.conditionLines(child.value, ctx, { indent: 0 });
            } else {
              rec.groups = buildGroups(child.value, ctx, spec, lang, LR);
              rec.fields = subFields(child.value, lang) || [];
            }
            items.push(rec);
          }
        }
      } else {
        for (const e of entries) {
          const n = e.value;
          if (n.type !== 'object') continue;
          const nameKey = eb.labelKey ? scalarValue(getEntry(n, eb.labelKey)) : null;
          const value = eb.valueKey ? scalarValue(getEntry(n, eb.valueKey)) : null;
          const condNode = eb.condKey ? getEntry(n, eb.condKey) : null;
          items.push({
            id: nameKey || value || e.key,
            nameKey: nameKey || null,
            name: nameKey && LR ? LR.rich('entry', nameKey) : null,
            value: value || null,
            lines: condNode ? terms.conditionLines(condNode, ctx, { indent: 0 }) : [],
          });
        }
      }
      if (items.length) groups.push({ key, role: 'entries', label, items });
      continue;
    }

    // Repeated definition blocks (great project tiers, government `conditional`).
    if (spec.subBlockPattern && spec.subBlockPattern.test(key) && only.type === 'object') {
      const items = [];
      for (const n of nodes) {
        if (n.type !== 'object') continue;
        items.push({ id: key, groups: buildGroups(n, ctx, spec, lang, LR), fields: subFields(n, lang) || [] });
      }
      if (items.length) groups.push({ key, role: 'blocks', label, items });
      continue;
    }

    const merged = mergeNodes(nodes);

    // Lists: explicit list keys, and every array that is not a flat value row.
    const wantsList = LIST_KEYS.has(key) || (spec.listBlocks || {})[key]
      || (only.type === 'array' && !(spec.fieldArrays || {})[key]);
    if (wantsList && !(spec.rawArrays || {})[key]) {
      const items = listItems(key, merged, ctx, spec);
      if (items.length) {
        groups.push({ key, role: 'list', label, items });
        continue;
      }
    }

    if (only.type === 'object') {
      if (specMod || MOD_KEYS.has(key)) {
        const lines = terms.modifierLines(merged, ctx, { indent: 0 });
        if (lines.length) groups.push({ key, role: 'mod', label, lines });
        continue;
      }
      if (specEff || EFF_KEYS.has(key) || /^(on_.*effect|per_province_.*effect|task_completed_effect|failing_effect)$/.test(key)) {
        const lines = terms.effectLines(merged, ctx, { indent: 0 });
        if (lines.length) groups.push({ key, role: 'eff', label, lines });
        continue;
      }
      if (specCond || COND_KEYS.has(key)
          || /^(can_|is_|allow_only_|potential|trigger|valid_|requires?_|prerequisites?_|available|possible$|fail_if$|select_trigger$|completion_trigger)/.test(key)) {
        const lines = terms.conditionLines(merged, ctx, { indent: 0 });
        if (lines.length) groups.push({ key, role: 'cond', label, lines });
        continue;
      }
      if (WEIGHT_KEYS.has(key)) {
        const lines = weightLines(merged, ctx, lang);
        if (lines.length) groups.push({ key, role: 'weight', label, lines });
        continue;
      }
      // Unknown object block: a table when it is flat, the raw script when it nests.
      const sf = subFields(merged, lang);
      if (sf && sf.length) { groups.push({ key, role: 'fields', label, fields: sf }); continue; }
    }
    const rows = rawRows(merged, 0, []);
    if (rows.length) groups.push({ key, role: 'raw', label, rows });
  }

  // `rest*`: the remaining scalars carry the meaning (technology levels,
  // static modifiers). `restEffects` / `restConditions` on their own mean the
  // *whole* block is an effect or a condition list, handled by `wholeNode`.
  if (spec.restModifiers || spec.restConditions || spec.restEffects || spec.yesLists) {
    const scalars = [];
    for (const e of node.entries) {
      if (handled.has(e.key) || STRUCT_KEYS.has(e.key)) continue;
      if (e.value.type === 'object' || e.value.type === 'array') continue;
      scalars.push(e);
    }
    const extras = scalars.filter((e) => !stateLabel(e.key, lang));
    if (spec.yesLists) {
      const flags = extras.filter((e) => isTruthy(e.value) || scalarValue(e.value) === 'no');
      const rest = extras.filter((e) => !flags.includes(e));
      const items = flags.map((e) => ({ id: e.key, state: scalarValue(e.value) }));
      if (items.length) groups.unshift({ key: 'enable', role: 'list', label: pick(BLOCK_LABEL.enable, lang), items });
      if (rest.length) {
        const lines = terms.modifierLines({ type: 'object', entries: rest }, ctx, { indent: 0 });
        if (lines.length) groups.unshift({ key: 'modifier', role: 'mod', label: pick(BLOCK_LABEL.modifier, lang), lines });
      }
    } else if (extras.length) {
      const rest = { type: 'object', entries: extras };
      const role = spec.restConditions ? 'cond' : spec.restEffects ? 'eff' : 'mod';
      const lines = role === 'cond'
        ? terms.conditionLines(rest, ctx, { indent: 0 })
        : role === 'eff'
          ? terms.effectLines(rest, ctx, { indent: 0 })
          : terms.modifierLines(rest, ctx, { indent: 0 });
      if (lines.length) {
        groups.unshift({
          key: 'rest',
          role,
          label: pick(
            role === 'cond' ? L('触发条件', 'Conditions')
              : role === 'eff' ? L('效果', 'Effects')
                : BLOCK_LABEL.modifier,
            lang,
          ),
          lines,
        });
      }
    }
  }
  return groups;
}

/** Resolve the script node a ref points at. */
function resolveNode(tree, ref, spec) {
  const mode = ref.mode || spec.mode || 'block';
  if (mode === 'file') return { node: tree, line: 1 };
  if (mode === 'ordinal') {
    let n = 0;
    for (const e of tree.entries) {
      if (e.key !== spec.blockKey) continue;
      if (e.value.type !== 'object') continue;
      n++;
      if (n === ref.level) return { node: e.value, line: e.line };
    }
    return null;
  }
  // A descriptor may attach the parsed block to the ref directly. Mission trees
  // need this: a mission lives inside a series block that `parent` cannot always
  // name (a `_mission_slot` wrapper nests one level deeper).
  if (ref.node && ref.node.type === 'object') return { node: ref.node, line: ref.line };

  if (mode === 'groupchildren' && ref.parent) {
    const group = getEntry(tree, ref.parent);
    if (!group || group.type !== 'object') return null;
    const child = getEntry(group, ref.id);
    if (!child || child.type !== 'object') return null;
    return { node: child, line: ref.line };
  }
  const node = getEntry(tree, ref.id);
  if (!node || node.type !== 'object') return null;
  return { node, line: ref.line };
}

/** Merge the type-level spec with its per-folder and per-kind overrides. */
function specForRef(spec, ref) {
  let out = spec;
  const folder = (spec.folders || []).find((f) => f.prefix === ref.folder);
  if (folder && folder.spec) out = Object.assign({}, out, folder.spec);
  if (ref.kind && spec.byKind && spec.byKind[ref.kind]) out = Object.assign({}, out, spec.byKind[ref.kind]);
  return out;
}

/**
 * Build the card for a generic content type.
 *
 * The result is deliberately data, not HTML: the client decides how to draw a
 * modifier list, a condition list or a raw block, and both languages share it.
 */
function buildGenericCard(index, ref, lang, specIn) {
  const spec = specForRef(specIn, ref);
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const found = resolveNode(tree, ref, spec);
  if (!found || !found.node) return null;
  const node = found.node;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);
  // `gameterms.nameOf()` records every name it resolves here; see the end of
  // this function for how they reach the correspondence table.
  ctx.used = [];

  const idShort = ref.id.includes('#') ? ref.id.split('#').pop() : ref.id;

  // Probe candidate keys with `has()` and only then record the one that hit.
  // Resolving each candidate in turn would leave a `found:false` entry in the
  // correspondence table for every pattern that missed, so a type that resolves
  // no localisation at all (an on_action, a scripted effect) would show a table
  // full of keys that are not really missing.
  const nameKeyCandidates = (spec.titlePatterns || ['{id}']).map((p) => p.replace('{id}', String(idShort)));
  let nameKey = null;
  let name = null;
  for (const k of nameKeyCandidates) {
    if (!resolver.has(k)) continue;
    name = L.rich('name', k);
    nameKey = k;
    break;
  }
  const descKeyCandidates = (spec.descPatterns || []).map((p) => p.replace('{id}', String(idShort)));
  let descKey = null;
  let desc = null;
  for (const k of descKeyCandidates) {
    if (!resolver.has(k)) continue;
    desc = L.rich('desc', k);
    descKey = k;
    break;
  }
  // A type whose id *is* its display name still needs the missing key reported
  // when the id looks like a name key (`building_name`), so the reader can see
  // that the localisation is absent. `rawTitle` types are the opposite: their
  // ids are script identifiers and no key is expected.
  if (!nameKey && !spec.rawTitle) nameKey = nameKeyCandidates[0] || null;
  if (!descKey && descKeyCandidates.length) descKey = descKeyCandidates[0];

  // Fields: every scalar the descriptor did not claim as a block or a modifier.
  const handled = new Set(spec.handledKeys || []);
  const fieldOmit = new Set([...(spec.fieldOmit || []), ...(spec.handledKeys || [])]);
  const fields = [];
  if (!spec.wholeNode) {
    for (const e of node.entries) {
      if (fieldOmit.has(e.key)) continue;
      if (STRUCT_KEYS.has(e.key)) continue;
      if (spec.extraFields && spec.extraFields[e.key]) {
        const v = e.value.type === 'object' || e.value.type === 'array'
          ? (e.value.entries ? e.value.entries.map((x) => scalarValue(x.value)).join(' ') : '')
          : scalarValue(e.value);
        fields.push({ key: e.key, label: pick(spec.extraFields[e.key], lang), value: v, tone: 'text' });
        continue;
      }
      if (e.value.type === 'object') continue;
      if (e.value.type === 'array') {
        // A colour or a labelled short array is a setting, not a list.
        const colour = colorValue(e.value);
        const label = stateLabel(e.key, lang);
        if (!colour && !(label && (spec.fieldArrays || {})[e.key])) continue;
        fields.push(fieldRecord(e.key, e.value, lang));
        continue;
      }
      if (spec.restModifiers || spec.restConditions || spec.restEffects || spec.yesLists) {
        // In these types the unlabelled scalars are modifiers, not settings.
        if (!stateLabel(e.key, lang)) continue;
      } else if (spec.omitUnknownFields && !stateLabel(e.key, lang)) {
        continue;
      }
      fields.push(fieldRecord(e.key, e.value, lang));
    }
  }

  // A key already shown as a setting must not be repeated as a list or a block.
  const consumed = new Set([...(spec.handledKeys || []), ...fields.map((f) => f.key)]);
  const specGroups = consumed.size === (spec.handledKeys || []).length
    ? spec
    : Object.assign({}, spec, { handledKeys: [...consumed] });

  let groups;
  if (spec.wholeNode) {
    const role = spec.wholeNode;
    const lines = role === 'cond'
      ? terms.conditionLines(node, ctx, { indent: 0 })
      : role === 'eff'
        ? terms.effectLines(node, ctx, { indent: 0 })
        : terms.modifierLines(node, ctx, { indent: 0 });
    groups = lines.length
      ? [{
        key: 'body',
        role,
        label: pick(
          role === 'cond' ? WHOLE_LABEL.cond
            : role === 'eff' ? WHOLE_LABEL.eff
              : BLOCK_LABEL.modifier,
          lang,
        ),
        lines,
      }]
      : [];
  } else {
    // A group item in a two-level file (a religion group, a culture group) is
    // listed by its members rather than by dumping every member's script.
    let spec2 = specGroups;
    if (spec.groupChildrenAsList && !ref.parent) {
      const childKeys = [];
      const items = [];
      for (const e of node.entries) {
        if (e.value.type !== 'object') continue;
        childKeys.push(e.key);
        const nm = L.rich('entry', e.key);
        items.push({
          id: e.key,
          nameKey: e.key,
          name: nm,
          link: spec.childLinkKind ? { kind: spec.childLinkKind, id: e.key } : null,
        });
      }
      if (items.length) {
        spec2 = Object.assign({}, specGroups, { handledKeys: [...(specGroups.handledKeys || []), ...childKeys] });
        groups = [{
          key: 'children', role: 'list',
          label: pick(spec.childListLabel || L('包含的成员', 'Members'), lang),
          items,
        }].concat(buildGroups(node, ctx, spec2, lang, L));
      } else {
        groups = buildGroups(node, ctx, specGroups, lang, L);
      }
    } else {
      groups = buildGroups(node, ctx, specGroups, lang, L);
    }
  }

  // The sprite the game paints for this entry, when it names one. Estate and
  // religion `icon` fields are numeric sprite *indices*, not names, so only a
  // named sprite is worth resolving.
  let spriteName = null;
  for (const k of ['icon', 'sprite', 'button_gfx', 'picture', 'alert_icon_gfx']) {
    const hit = getEntry(node, k);
    if (hit && hit.type !== 'object' && hit.type !== 'array') {
      const v = scalarValue(hit);
      if (v && !/^\d+$/.test(v)) spriteName = v;
      break;
    }
  }
  const spriteUrl = spriteName ? resolveSprite(index, spriteName) : null;

  const card = {
    type: ref.type,
    id: ref.id,
    kind: ref.kind || null,
    kindLabel: ref.kind ? kindLabel(ref.kind, lang) : null,
    file: ref.file,
    line: found.line,
    sourceLine: found.line,
    nameKey,
    name,
    descKey,
    desc: desc || null,
    spriteName,
    spriteUrl,
    fields,
    groups,
    locRefs: L.refs,
  };
  if (spec.decorate) spec.decorate(card, { node, index, ref, lang, ctx, L, idShort, spec });

  // Names resolved through the glossary while the groups were rendered (the
  // units a tech unlocks, the religions in a group) are localisation the reader
  // should see in the correspondence table too, so fold them in.
  const seen = new Set(L.refs.map((r) => r.key));
  for (const u of ctx.used || []) {
    if (!u || !u.key || seen.has(u.key)) continue;
    seen.add(u.key);
    L.refs.push({
      field: 'name', key: u.key, found: true,
      value: u.value, file: u.file, line: u.line, origin: u.origin,
    });
  }
  return card;
}

const KIND_LABEL = {
  building: L('建筑', 'Building'),
  religion: L('宗教', 'Religion'),
  religion_group: L('宗教组', 'Religion group'),
  culture: L('文化', 'Culture'),
  culture_group: L('文化组', 'Culture group'),
  trade_good: L('贸易商品', 'Trade good'),
  trade_node: L('贸易节点', 'Trade node'),
  trade_company: L('贸易公司', 'Trade company'),
  price: L('商品价格', 'Trade good price'),
  cb: L('宣战理由', 'Casus belli'),
  wargoal: L('战争目标', 'War goal'),
  peace_treaty: L('和平条约', 'Peace treaty'),
  government: L('政体', 'Government'),
  government_reform: L('政府改革', 'Government reform'),
  government_mechanic: L('政府机制', 'Government mechanic'),
  imperial_reform: L('帝国改革', 'Imperial reform'),
  subject_type: L('附庸类型', 'Subject type'),
  faction: L('派系', 'Faction'),
  parliament_issue: L('议会议题', 'Parliament issue'),
  decree: L('法令', 'Decree'),
  state_edict: L('省份诏令', 'State edict'),
  trading_policy: L('贸易政策', 'Trading policy'),
  church_aspect: L('教会面向', 'Church aspect'),
  deity: L('个人神祇', 'Personal deity'),
  cult: L('拜物教派', 'Fetishist cult'),
  holy_order: L('圣骑士团', 'Holy order'),
  incident: L('事件链', 'Incident'),
  technology: L('科技等级', 'Technology level'),
  institution: L('思潮', 'Institution'),
  unit: L('兵种', 'Unit'),
  mercenary: L('雇佣兵团', 'Mercenary company'),
  naval_doctrine: L('海军学说', 'Naval doctrine'),
  flagship_modification: L('旗舰改装', 'Flagship modification'),
  estate: L('阶层', 'Estate'),
  privilege: L('阶层特权', 'Estate privilege'),
  estate_agenda: L('阶层议程', 'Estate agenda'),
  disaster: L('灾难', 'Disaster'),
  age: L('时代', 'Age'),
  modifier: L('修正', 'Modifier'),
  scripted_effect: L('脚本效果', 'Scripted effect'),
  scripted_trigger: L('脚本条件', 'Scripted trigger'),
  scripted_function: L('脚本函数', 'Scripted function'),
  on_action: L('行动指令', 'On action'),
  great_project: L('伟大工程', 'Great project'),
  rebel: L('叛军', 'Rebel type'),
  revolt_trigger: L('叛乱触发', 'Revolt trigger'),
  bookmark: L('书签', 'Bookmark'),
  country: L('国家', 'Country'),
  country_tag: L('国家标签', 'Country tag'),
  war: L('战争', 'War'),
  dependency: L('附庸关系', 'Subject relation'),
  area: L('地区', 'Area'),
  region: L('区域', 'Region'),
  superregion: L('大区', 'Superregion'),
  continent: L('大洲', 'Continent'),
  climate: L('气候带', 'Climate'),
  terrain: L('地形', 'Terrain'),
  gui_window: L('GUI 窗口', 'GUI window'),
  mission: L('任务', 'Mission'),
  mission_tree: L('任务树', 'Mission tree'),
  ruler_trait: L('君主特质', 'Ruler trait'),
  ancestor_trait: L('先祖特质', 'Ancestor trait'),
  leader_trait: L('将领特质', 'Leader trait'),
};

function kindLabel(kind, lang) {
  const pair = KIND_LABEL[kind];
  return pair ? pick(pair, lang) : String(kind || '');
}

module.exports = {
  MAX_FILE_BYTES,
  readText,
  underPrefix,
  underPrefixAny,
  FileCache,
  makeRef,
  isTruthy,
  cleanTitle,
  fileStem,
  collectSimple,
  collectScalars,
  makeLocRefs,
  contentCtx,
  primeModifierDefs,
  findEntry,
  findDecision,
  nameFor,
  spriteIndex,
  existsIn,
  texUrl,
  resolveEventPicture,
  resolveSprite,
  resolveSpriteInfo,
  resolveIcon,
  // generic engine
  collectGeneric,
  indexTitleFor,
  buildGenericCard,
  specForRef,
  mergeNodes,
  entriesByKey,
  fieldRecord,
  rawRows,
  subFields,
  listItems,
  kindLabel,
  blockLabel,
  stateLabel,
  colorValue,
  L,
  pick,
  normalizeLang,
  isEn,
  COND_KEYS,
  EFF_KEYS,
  MOD_KEYS,
  WEIGHT_KEYS,
  LIST_KEYS,
  STRUCT_KEYS,
  BLOCK_LABEL,
  STATE_LABEL,
  KIND_LABEL,
};
