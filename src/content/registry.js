'use strict';
/**
 * Content-type descriptors for the in-game preview.
 *
 * Each descriptor turns one family of a mod's script files into listable items
 * plus a "card" shaped like what the game shows for it. Most of them are
 * declarative: they name the folders, where the localisation name lives, and let
 * `src/content/common.js` classify every child block. Only the four types whose
 * shape is genuinely different — mission trees, technology levels, countries with
 * their history timeline, the map files, GUI windows and bookmarks — carry a
 * hand-written collector and builder.
 *
 * `category` links a type to the taxonomy category in `src/taxonomy.js`, which is
 * where its wiki page comes from. Nothing here hard-codes a wiki page name, so a
 * link can only point at a page the taxonomy (and `src/wiki.js`) already verified.
 */

const { getEntry, scalarValue } = require('../codec/script.js');
const c = require('./common.js');
const terms = require('../gameterms.js');

const { L, pick, pickVars, underPrefix, underPrefixAny, makeRef, makeLocRefs, contentCtx, fileStem, kindLabel } = c;

// ---------------------------------------------------------------------------
// Navigation groups
// ---------------------------------------------------------------------------

/** The tab bar is grouped so ~30 tabs stay navigable. */
const GROUPS = [
  { id: 'content', zh: '内容', en: 'Content' },
  { id: 'country', zh: '国家', en: 'Country' },
  { id: 'society', zh: '宗教与经济', en: 'Religion & economy' },
  { id: 'military', zh: '军事', en: 'Military' },
  { id: 'world', zh: '世界', en: 'World' },
  { id: 'system', zh: '系统', en: 'System' },
];

const TYPES = [];

function generic(id, group, category, meta, spec) {
  TYPES.push({ id, group, category, meta, spec, generic: true });
}

function custom(id, group, category, meta, collect, build, extra) {
  TYPES.push(Object.assign({ id, group, category, meta, collect, build }, extra || {}));
}

// ---------------------------------------------------------------------------
// Helpers shared by the descriptors
// ---------------------------------------------------------------------------

const YES = new Set(['yes', 'no', 'true', 'false']);

/** A stable textual signature of a script node, used to group slots into trees. */
function nodeSig(node) {
  if (!node) return '';
  if (node.type === 'object') return '{' + node.entries.map((e) => e.key + '=' + nodeSig(e.value)).join(';') + '}';
  if (node.type === 'array') return '[' + node.items.map(nodeSig).join(',') + ']';
  return String(node.value);
}

/** A `{zh, en}` pair for a synthetic title, so both languages read correctly. */
function synth(zh, en) { return { zh, en }; }

/**
 * A synthetic title resolved for one language, with `{name}` placeholders filled.
 *
 * Word order differs between languages (`行政科技 5 级` vs `Administrative
 * technology 5`), so a synthetic title with a number in it must be translated as
 * a template rather than as a prefix glued to a value: the English template is
 * the lookup key in `src/data/locales/<lang>.json`.
 */
const synthText = pickVars;

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

const missionEngine = require('./missions.js');

/**
 * One mission, plus the whole tree it lives in drawn the way the game draws it.
 *
 * The layout work — reading `slot`/`position`/`required_missions`, the geometry
 * from the mod's own GUI, the arrow pieces — lives in `src/content/missions.js`.
 */
custom('missions', 'content', 'missions',
  { zh: '任务', en: 'Missions', icon: '🎯' },
  missionEngine.collectMissions,
  missionEngine.buildMission);

/**
 * The tree as the unit of browsing.
 *
 * A mod's missions folder holds thousands of missions across hundreds of series;
 * the tree is what a reader wants to open. Collected second, so it can group the
 * missions the descriptor above already indexed.
 */
custom('mission_trees', 'content', 'missions',
  { zh: '任务树', en: 'Mission trees', icon: '🎯' },
  missionEngine.collectMissionTrees,
  missionEngine.buildMissionTree);

// ---------------------------------------------------------------------------
// Technology and institutions
// ---------------------------------------------------------------------------

const POWER_LABEL = {
  ADM: L('行政', 'Administrative'),
  DIP: L('外交', 'Diplomatic'),
  MIL: L('军事', 'Military'),
};

/**
 * A technology level's title. The level number sits inside the translatable
 * string because its position moves between languages (`行政科技 5 级`).
 */
const TECH_TITLE = {
  ADM: L('行政科技 {n} 级', 'Administrative technology {n}'),
  DIP: L('外交科技 {n} 级', 'Diplomatic technology {n}'),
  MIL: L('军事科技 {n} 级', 'Military technology {n}'),
};

generic('technology', 'system', 'technology',
  { zh: '科技与思潮', en: 'Technology', icon: '🔬' },
  {
    mode: 'ordinal',
    blockKey: 'technology',
    folders: [
      { prefix: 'common/technologies/', kind: 'technology', mode: 'ordinal', blockKey: 'technology' },
      { prefix: 'common/institutions/', kind: 'institution', mode: 'block' },
    ],
    titlePatterns: [],
    restModifiers: true,
    yesLists: true,
    linkKinds: { enable: 'unit', expects_institution: 'institution' },
    keyedLists: { expects_institution: 'keyWeight' },
    titleFn(index, ref) {
      const power = String(ref.file).split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
      const tpl = TECH_TITLE[power];
      if (!tpl) return null;
      return { tpl, vars: { n: Number(ref.level) || 0 } };
    },
    decorate(card, { node, index: ix, ref, lang, ctx }) {
      const power = String(ref.file).split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
      if (POWER_LABEL[power]) {
        card.power = power;
        card.powerLabel = pick(POWER_LABEL[power], lang);
        card.name = null;
        card.synthName = pickVars(TECH_TITLE[power], lang, { n: ref.level });
      }
      const tree = ix.cache.tree(ref.file);
      const ahead = tree ? getEntry(tree, 'ahead_of_time') : null;
      if (ahead && ahead.type === 'object') {
        const lines = terms.modifierLines(ahead, ctx, { indent: 0 });
        if (lines.length) {
          card.groups.push({
            key: 'ahead_of_time', role: 'mod',
            label: pick(L('超前惩罚修正 ahead_of_time', 'Ahead-of-time modifiers'), lang),
            lines,
          });
        }
      }
      void node;
    },
  });

// ---------------------------------------------------------------------------
// Government, parliament, religion, culture
// ---------------------------------------------------------------------------

generic('government', 'country', 'government',
  { zh: '政府与改革', en: 'Government', icon: '🏛️' },
  {
    folders: [
      { prefix: 'common/governments/', kind: 'government' },
      { prefix: 'common/government_reforms/', kind: 'government_reform' },
      { prefix: 'common/government_mechanics/', kind: 'government_mechanic' },
      { prefix: 'common/government_names/', kind: 'government' },
      { prefix: 'common/government_ranks/', kind: 'government' },
      { prefix: 'common/imperial_reforms/', kind: 'imperial_reform' },
      { prefix: 'common/subject_types/', kind: 'subject_type' },
      { prefix: 'common/factions/', kind: 'faction' },
    ],
    // A government's display name is `<id>_name` in vanilla (`monarchy_name`),
    // while government *reforms* are named by the bare id. Trying both in that
    // order is correct for every folder this type covers: measured on vanilla,
    // `{id}_name` hits 5/6 governments and `{id}` hits the 73/73 reforms.
    titlePatterns: ['{id}_name', '{id}'],
    descPatterns: ['{id}_desc'],
    modBlocks: { emperor: true, member: true, country: true, province: true },
    subBlockPattern: /^conditional$/,
    handledKeys: ['custom_attributes'],
    linkKinds: { government_abilities: 'government_mechanic' },
  });

generic('parliament', 'country', 'government',
  { zh: '议会与法令', en: 'Parliament & edicts', icon: '🗳️', wikiEn: 'Parliament modding' },
  {
    folders: [
      { prefix: 'common/parliament_issues/', kind: 'parliament_issue' },
      { prefix: 'common/decrees/', kind: 'decree' },
      { prefix: 'common/state_edicts/', kind: 'state_edict' },
      { prefix: 'common/trading_policies/', kind: 'trading_policy' },
    ],
    descPatterns: ['{id}_desc'],
  });

generic('religion', 'society', 'religion',
  { zh: '宗教', en: 'Religion', icon: '⛪' },
  {
    mode: 'groupchildren',
    folders: [
      { prefix: 'common/religions/', kind: 'religion', groupKind: 'religion_group' },
      { prefix: 'common/church_aspects/', kind: 'church_aspect', mode: 'block' },
      { prefix: 'common/personal_deities/', kind: 'deity', mode: 'block', spec: { restModifiers: true, handledKeys: ['potential', 'effect', 'ai_will_do', 'sprite', 'icon'] } },
      { prefix: 'common/fetishist_cults/', kind: 'cult', mode: 'block', spec: { restModifiers: true, handledKeys: ['allow', 'ai_will_do', 'sprite', 'icon'] } },
      { prefix: 'common/religious_reforms/', kind: 'church_aspect', mode: 'block' },
      { prefix: 'common/holy_orders/', kind: 'holy_order', mode: 'block' },
      { prefix: 'common/incidents/', kind: 'incident', mode: 'block' },
    ],
    descPatterns: ['{id}_desc'],
    modBlocks: { country: true, province: true, country_as_secondary: true, province_as_secondary: true },
    listBlocks: { religious_schools: true },
    groupChildrenAsList: true,
    childLinkKind: 'religion',
    childListLabel: L('该宗教组包含的宗教', 'Religions in this group'),
    fieldArrays: { flag_emblem_index_range: true },
  });

generic('culture', 'society', 'culture',
  { zh: '文化', en: 'Culture', icon: '🈶' },
  {
    mode: 'groupchildren',
    folders: [{ prefix: 'common/cultures/', kind: 'culture', groupKind: 'culture_group' }],
    descPatterns: [],
    listBlocks: { male_names: true, female_names: true, dynasty_names: true },
    groupChildrenAsList: true,
    childLinkKind: 'culture',
    childListLabel: L('该文化组包含的文化', 'Cultures in this group'),
  });

// ---------------------------------------------------------------------------
// Units, buildings, trade
// ---------------------------------------------------------------------------

const UNIT_STATS = [
  ['maneuver', L('机动', 'Maneuver')],
  ['offensive_morale', L('进攻士气', 'Offensive morale')],
  ['defensive_morale', L('防御士气', 'Defensive morale')],
  ['offensive_fire', L('进攻火力', 'Offensive fire')],
  ['defensive_fire', L('防御火力', 'Defensive fire')],
  ['offensive_shock', L('进攻冲击', 'Offensive shock')],
  ['defensive_shock', L('防御冲击', 'Defensive shock')],
];

generic('units', 'military', 'units',
  { zh: '单位与军事', en: 'Units', icon: '⚔️' },
  {
    folders: [
      { prefix: 'common/units/', kind: 'unit', mode: 'file' },
      { prefix: 'common/mercenary_companies/', kind: 'mercenary', mode: 'block' },
      { prefix: 'common/naval_doctrines/', kind: 'naval_doctrine', mode: 'block' },
      { prefix: 'common/flagship_modifications/', kind: 'flagship_modification', mode: 'block' },
    ],
    descPatterns: ['{id}_desc'],
    fieldOmit: UNIT_STATS.map((s) => s[0]).concat(['type', 'unit_type', 'sprites']),
    decorate(card, { node, lang, idShort }) {
      // A unit's whole point is its three-by-two stat table.
      const stats = [];
      for (const [key, pair] of UNIT_STATS) {
        const hit = getEntry(node, key);
        if (!hit || hit.type === 'object' || hit.type === 'array') continue;
        stats.push({ key, label: pick(pair, lang), value: scalarValue(hit) });
      }
      if (stats.length) card.stats = stats;
      const typeNode = getEntry(node, 'type');
      if (typeNode) card.unitCategory = scalarValue(typeNode);
      const utNode = getEntry(node, 'unit_type');
      if (utNode) card.unitType = scalarValue(utNode);
      void idShort;
    },
  });

generic('buildings', 'society', 'buildings',
  { zh: '建筑', en: 'Buildings', icon: '🏗️' },
  {
    folders: [{ prefix: 'common/buildings/', kind: 'building' }],
    descPatterns: ['{id}_desc'],
  });

generic('trade', 'society', 'trade',
  { zh: '贸易', en: 'Trade', icon: '🚢' },
  {
    folders: [
      { prefix: 'common/tradegoods/', kind: 'trade_good' },
      { prefix: 'common/tradenodes/', kind: 'trade_node' },
      { prefix: 'common/trade_companies/', kind: 'trade_company' },
      { prefix: 'common/prices/', kind: 'price' },
    ],
    descPatterns: ['{id}_desc'],
    modBlocks: { province: true, country: true },
    linkKinds: { provinces: 'province' },
  });

// ---------------------------------------------------------------------------
// Estates, disasters, ages, great projects, rebels
// ---------------------------------------------------------------------------

generic('estates', 'country', 'estates',
  { zh: '阶层', en: 'Estates', icon: '👥' },
  {
    folders: [
      {
        prefix: 'common/estates/',
        kind: 'estate',
        spec: {
          entryBlocks: {
            influence_modifier: { render: 'value', labelKey: 'desc', valueKey: 'influence', condKey: 'trigger' },
            loyalty_modifier: { render: 'value', labelKey: 'desc', valueKey: 'loyalty', condKey: 'trigger' },
          },
        },
      },
      { prefix: 'common/estate_privileges/', kind: 'privilege' },
      { prefix: 'common/estate_agendas/', kind: 'estate_agenda' },
    ],
    descPatterns: ['{id}_desc'],
    linkKinds: { privileges: 'privilege', agendas: 'estate_agenda' },
  });

generic('disasters', 'country', 'disasters',
  { zh: '灾难', en: 'Disasters', icon: '🔥' },
  {
    folders: [{ prefix: 'common/disasters/', kind: 'disaster' }],
    descPatterns: ['{id}_desc', 'disaster_{id}_desc'],
  });

generic('ages', 'country', 'ages',
  { zh: '时代', en: 'Ages', icon: '⏳' },
  {
    folders: [
      {
        prefix: 'common/ages/',
        kind: 'age',
        spec: {
          entryBlocks: {
            objectives: { render: 'self' },
            abilities: { render: 'block' },
          },
        },
      },
    ],
    descPatterns: ['{id}_desc'],
  });

generic('great_projects', 'country', 'great_projects',
  { zh: '伟大工程', en: 'Great projects', icon: '🗿' },
  {
    folders: [{ prefix: 'common/great_projects/', kind: 'great_project' }],
    descPatterns: ['{id}_desc'],
    subBlockPattern: /^tier_\d+$/,
  });

generic('rebels', 'country', 'rebels',
  { zh: '叛军', en: 'Rebels', icon: '🏴' },
  {
    folders: [
      { prefix: 'common/rebel_types/', kind: 'rebel' },
      { prefix: 'common/revolt_triggers/', kind: 'revolt_trigger', spec: { wholeNode: 'cond' } },
    ],
    // Rebel types carry `<id>_name` (the display name) and, for the generic
    // religious/cultural rebels, a `<id>_title` that is only a category word
    // ("Religious"). Prefer the specific one.
    titlePatterns: ['{id}_name', '{id}_title', '{id}'],
    descPatterns: ['{id}_desc'],
    modBlocks: { country: true, province: true },
  });

// ---------------------------------------------------------------------------
// Ruler and leader traits
// ---------------------------------------------------------------------------

/**
 * Ruler traits — the personalities the game attaches to a ruler at 15, then after
 * 10 and 25 years of rule. `common/ancestor_personalities/` holds the same shape
 * for the ancestor slot (`ancestor_just_personality`), so it is read here too.
 *
 * The definition is a list of *modifiers* (`meritocracy = -0.5`, `razing = yes`)
 * wrapped in per-slot eligibility blocks:
 *
 *     CE_fatuity_personality = {
 *         ruler_allow = { allow = { … } chance = { modifier = { factor = … } } }
 *         heir_allow  = { … }   consort_allow = { … }
 *         allow = { has_reform = celestial_empire }   # the trait itself
 *         chance = { … }
 *         meritocracy = -0.5
 *     }
 *
 * `restModifiers` is what makes the trailing scalars render as the in-game
 * bonus/malus lines rather than as a settings table.
 *
 * The three `*_allow` wrappers are handed to `subBlockPattern`, which re-runs the
 * normal classification one level down — that is what makes the `allow` inside
 * each wrapper come out as requirements and the `chance` inside it as spawn
 * weights. Rendering a wrapper as a plain condition block instead would present
 * those weights as if they were something the ruler has to satisfy.
 */
generic('ruler_traits', 'country', 'traits',
  { zh: '君主特质', en: 'Ruler traits', icon: '👑' },
  {
    folders: [
      { prefix: 'common/ruler_personalities/', kind: 'ruler_trait' },
      { prefix: 'common/ancestor_personalities/', kind: 'ancestor_trait' },
    ],
    titlePatterns: ['{id}'],
    restModifiers: true,
    subBlockPattern: /^(ruler|heir|consort)_allow$/,
  });

/**
 * Leader traits — one personality per general or admiral, with the modifiers
 * applying to the stack it leads. These are flat (`allow` plus modifier keys),
 * so the generic engine needs nothing beyond `restModifiers`; note that generals
 * and admirals live in the same folder and are told apart by `allow =
 * { is_admiral = yes|no }`, which is a condition the card renders as such.
 */
generic('leader_traits', 'military', 'traits',
  { zh: '将领特质', en: 'Leader traits', icon: '🎖' },
  {
    folders: [{ prefix: 'common/leader_personalities/', kind: 'leader_trait' }],
    titlePatterns: ['{id}'],
    restModifiers: true,
  });

// ---------------------------------------------------------------------------
// Modifiers, scripted effects/triggers, on_actions
// ---------------------------------------------------------------------------

generic('modifiers', 'system', 'modifiers',
  { zh: '修正', en: 'Modifiers', icon: '✨' },
  {
    folders: [
      { prefix: 'common/static_modifiers/', kind: 'modifier' },
      { prefix: 'common/event_modifiers/', kind: 'modifier' },
      { prefix: 'common/triggered_modifiers/', kind: 'modifier' },
      { prefix: 'common/province_triggered_modifiers/', kind: 'modifier' },
      { prefix: 'common/opinion_modifiers/', kind: 'modifier' },
    ],
    descPatterns: ['{id}_desc'],
    restModifiers: true,
    modBlocks: { country: true, province: true },
    rawTitle: true,
  });

generic('scripted', 'system', 'scripted',
  { zh: '脚本效果与条件', en: 'Scripted effects & triggers', icon: '🧩' },
  {
    folders: [
      { prefix: 'common/scripted_effects/', kind: 'scripted_effect', spec: { wholeNode: 'eff' } },
      { prefix: 'common/scripted_triggers/', kind: 'scripted_trigger', spec: { wholeNode: 'cond' } },
      { prefix: 'common/scripted_functions/', kind: 'scripted_function' },
    ],
    descPatterns: ['{id}_desc'],
    rawTitle: true,
  });

generic('on_actions', 'system', 'on_actions',
  { zh: '行动指令', en: 'On actions', icon: '🔔' },
  {
    folders: [{ prefix: 'common/on_actions/', kind: 'on_action' }],
    linkKinds: { events: 'event', random_events: 'event' },
    keyedLists: { random_events: 'keyWeight', events: 'value' },
    rawTitle: true,
  });

// ---------------------------------------------------------------------------
// War and peace, bookmarks
// ---------------------------------------------------------------------------

generic('wars', 'military', 'casusbelli',
  { zh: '战争与和平', en: 'War & peace', icon: '📯' },
  {
    folders: [
      { prefix: 'common/cb_types/', kind: 'cb' },
      { prefix: 'common/wargoal_types/', kind: 'wargoal' },
      { prefix: 'common/peace_treaties/', kind: 'peace_treaty' },
    ],
    descPatterns: ['{id}_desc'],
    linkKinds: { casus_belli: 'cb' },
  });

// --- bookmarks: the files define anonymous `bookmark = { name = … }` blocks ---

custom('bookmarks', 'world', 'bookmarks',
  { zh: '书签与开局', en: 'Bookmarks', icon: '📖' },
  function collectBookmarks(index, files) {
    index.lists.bookmarks = index.lists.bookmarks || [];
    for (const rel of files) {
      if (!underPrefix(rel, ['common/bookmarks/'])) continue;
      index.counters['common/bookmarks/'] = (index.counters['common/bookmarks/'] || 0) + 1;
      const tree = index.cache.tree(rel);
      if (!tree) continue;
      let n = 0;
      for (const e of tree.entries) {
        if (e.value.type !== 'object') continue;
        if (!getEntry(e.value, 'date') && !getEntry(e.value, 'name')) continue;
        n++;
        const nameKey = scalarValue(getEntry(e.value, 'name'));
        const id = nameKey || fileStem(rel) + (n > 1 ? '#' + n : '');
        index.lists.bookmarks.push(makeRef('bookmarks', id, rel, e.line, {
          blockIndex: n, kind: 'bookmark', folder: 'common/bookmarks/', mode: 'block', nameKey,
        }));
        if (nameKey) {
          const t = index.resolver.text(nameKey);
          if (t) index.titles.set('bookmarks:' + id, c.cleanTitle(t));
        }
      }
    }
  },
  function buildBookmark(index, ref, lang) {
    const tree = index.cache.tree(ref.file);
    if (!tree) return null;
    let n = 0;
    let found = null;
    for (const e of tree.entries) {
      if (e.value.type !== 'object') continue;
      if (!getEntry(e.value, 'date') && !getEntry(e.value, 'name')) continue;
      n++;
      if (n === ref.blockIndex) { found = e; break; }
    }
    if (!found) return null;
    const node = found.value;
    const LR = makeLocRefs(index.resolver, lang);
    const ctx = contentCtx(index, lang);
    const nameKey = scalarValue(getEntry(node, 'name')) || ref.id;
    const descKey = scalarValue(getEntry(node, 'desc')) || `${nameKey}_DESC`;
    const dateNode = getEntry(node, 'date');
    const fields = [];
    if (dateNode) {
      fields.push({ key: 'date', label: c.stateLabel('date', lang), value: scalarValue(dateNode), tone: 'text' });
    }
    const defNode = getEntry(node, 'default');
    if (defNode) fields.push({ key: 'default', label: c.stateLabel('default', lang), value: scalarValue(defNode), tone: defNode.value === 'yes' ? 'yes' : 'no' });
    const centerNode = getEntry(node, 'center');
    if (centerNode) fields.push({ key: 'center', label: c.stateLabel('center', lang), value: scalarValue(centerNode), tone: 'num' });

    const groups = [];
    for (const key of ['country', 'easy_country']) {
      const items = [];
      for (const e of node.entries) {
        if (e.key !== key) continue;
        const tag = scalarValue(e.value);
        if (!tag) continue;
        const name = terms.nameOf('tag', tag, ctx);
        items.push({ id: tag, name: name && name !== tag ? name : null, link: { kind: 'tag', id: tag } });
      }
      if (items.length) {
        groups.push({
          key, role: 'list',
          label: pick(key === 'country' ? L('可选国家 country', 'Playable countries') : L('推荐国家 easy_country', 'Recommended countries'), lang),
          items,
        });
      }
    }
    return {
      type: 'bookmarks',
      id: ref.id,
      kind: 'bookmark',
      kindLabel: kindLabel('bookmark', lang),
      file: ref.file,
      line: found.line,
      sourceLine: found.line,
      nameKey,
      name: LR.rich('name', nameKey),
      descKey,
      desc: LR.rich('desc', descKey),
      fields,
      groups,
      locRefs: LR.refs,
    };
  });

// ---------------------------------------------------------------------------
// Countries: identity + the dated history timeline the game replays at start
// ---------------------------------------------------------------------------

const HISTORY_DIRS = [
  { prefix: 'history/countries/', kind: 'country' },
  { prefix: 'history/diplomacy/', kind: 'dependency' },
  { prefix: 'history/wars/', kind: 'war' },
];

const DATE_RE = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/;
const MAX_TIMELINE = 160;

custom('countries', 'country', 'countries',
  { zh: '国家与政体', en: 'Countries', icon: '🏳️' },
  function collectCountries(index, files) {
    index.lists.countries = index.lists.countries || [];
    index.countryTags = index.countryTags || new Map();

    for (const rel of files) {
      if (!underPrefix(rel, ['common/country_tags/'])) continue;
      index.counters['common/country_tags/'] = (index.counters['common/country_tags/'] || 0) + 1;
      const tree = index.cache.tree(rel);
      if (!tree) continue;
      for (const e of tree.entries) {
        if (e.value.type === 'object' || e.value.type === 'array') continue;
        const target = scalarValue(e.value);
        if (target && !index.countryTags.has(e.key)) {
          index.countryTags.set(e.key, { defFile: 'common/countries/' + String(target).replace(/^countries\//, ''), line: e.line, tagsFile: rel });
        }
      }
    }

    const byTag = new Map();
    for (const dir of HISTORY_DIRS) {
      for (const rel of files) {
        if (!underPrefix(rel, [dir.prefix])) continue;
        index.counters[dir.prefix] = (index.counters[dir.prefix] || 0) + 1;
        const tree = index.cache.tree(rel);
        if (!tree) continue;
        if (dir.kind !== 'country') {
          // history/diplomacy and history/wars: one item per file.
          byTag.set(dir.prefix + fileStem(rel), makeRef('countries', fileStem(rel), rel, 1, {
            kind: dir.kind, folder: dir.prefix, historyFile: rel, mode: 'file',
          }));
          continue;
        }
        const tag = fileStem(rel).split(' - ')[0].trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(tag)) continue;
        byTag.set(tag, makeRef('countries', tag, rel, 1, {
          kind: 'country', folder: dir.prefix, historyFile: rel, mode: 'file',
        }));
      }
    }
    // Every declared tag gets an item even without a history file of its own.
    for (const [tag, info] of index.countryTags) {
      if (byTag.has(tag)) continue;
      byTag.set(tag, makeRef('countries', tag, info.defFile, info.line, {
        kind: 'country', folder: 'common/country_tags/', historyFile: null, mode: 'block', defOnly: true,
      }));
    }
    for (const ref of byTag.values()) {
      index.lists.countries.push(ref);
      const name = index.resolver.text(ref.id);
      if (name) index.titles.set('countries:' + ref.id, c.cleanTitle(name));
    }
  },
  function buildCountry(index, ref, lang) {
    const LR = makeLocRefs(index.resolver, lang);
    const ctx = contentCtx(index, lang);
    if (ref.kind === 'war') return buildWar(index, ref, lang, L, ctx);
    if (ref.kind === 'dependency') return buildDependency(index, ref, lang, L, ctx);

    const fields = [];
    const groups = [];
    const tagsInfo = (index.countryTags || new Map()).get(ref.id);
    const defRel = tagsInfo ? tagsInfo.defFile : null;
    if (defRel) {
      const defTree = index.cache.tree(defRel);
      if (defTree) {
        const colorNode = getEntry(defTree, 'color');
        if (colorNode) {
          const rec = c.fieldRecord('color', colorNode, lang);
          if (rec.color) fields.push(rec);
        }
        for (const key of ['graphical_culture', 'historical_idea_groups', 'historical_units']) {
          const n = getEntry(defTree, key);
          if (!n) continue;
          if (n.type === 'array') {
            const items = n.items.map((x) => String(scalarValue(x)));
            groups.push({
              key, role: 'list', label: c.stateLabel(key, lang) || key,
              items: items.slice(0, 40).map((id) => ({ id })),
            });
          } else {
            fields.push(c.fieldRecord(key, n, lang));
          }
        }
      }
    }

    // The dated blocks are the country's history; everything else is its
    // starting state.
    const initial = [];
    const timeline = [];
    if (ref.historyFile) {
      const tree = index.cache.tree(ref.historyFile);
      if (tree) {
        for (const e of tree.entries) {
          if (DATE_RE.test(e.key)) {
            if (timeline.length >= MAX_TIMELINE) continue;
            if (e.value.type !== 'object') continue;
            timeline.push({ date: e.key, lines: terms.historyLines(e.value, ctx, { indent: 0 }) });
          } else if (e.value.type !== 'object' && e.value.type !== 'array') {
            initial.push({ key: e.key, value: e.value });
          } else if (e.value.type === 'object') {
            initial.push({ key: e.key, value: e.value });
          }
        }
      }
    }
    if (initial.length) {
      const rest = { type: 'object', entries: initial };
      const lines = terms.historyLines(rest, ctx, { indent: 0 });
      if (lines.length) {
        groups.unshift({
          key: 'initial', role: 'eff',
          label: pick(L('开局状态（历史文件中的定点设置）', 'Starting state (the undated entries of the history file)'), lang),
          lines,
        });
      }
    }
    timeline.sort((a, b) => cmpDate(a.date, b.date));

    const links = [];
    for (const [kind, key] of [['religion', 'religion'], ['culture', 'primary_culture'], ['government_reform', 'add_government_reform'], ['tech_group', 'technology_group']]) {
      const n = getEntry(firstObject(index, ref.historyFile), key);
      const v = n ? scalarValue(n) : null;
      if (!v) continue;
      const name = terms.nameOf(kind, v, ctx);
      links.push({ kind, id: v, label: name || v });
    }

    const card = {
      type: 'countries',
      id: ref.id,
      kind: 'country',
      kindLabel: kindLabel('country', lang),
      file: ref.historyFile || ref.file,
      line: ref.line,
      sourceLine: ref.line,
      nameKey: ref.id,
      name: LR.rich('name', ref.id),
      defFile: defRel,
      fields,
      groups,
      timeline,
      timelineTruncated: timeline.length >= MAX_TIMELINE,
      links,
      locRefs: LR.refs,
    };
    if (tagsInfo) card.tagsFile = tagsInfo.tagsFile;
    return card;
  });

function firstObject(index, rel) {
  if (!rel) return null;
  return index.cache.tree(rel);
}

function cmpDate(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function buildWar(index, ref, lang, LR, ctx) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const fields = [];
  const groups = [];
  const nameNode = getEntry(tree, 'name');
  if (nameNode) {
    const key = scalarValue(nameNode);
    fields.push({ key: 'name', label: pick(L('战争名称', 'War name'), lang), value: key, tone: 'text' });
  }
  const wg = getEntry(tree, 'war_goal');
  if (wg && wg.type === 'object') {
    const sf = c.subFields(wg, lang);
    if (sf) groups.push({ key: 'war_goal', role: 'fields', label: pick(L('战争目标 war_goal', 'War goal'), lang), fields: sf });
  }
  const timeline = [];
  for (const e of tree.entries) {
    if (!DATE_RE.test(e.key)) continue;
    if (timeline.length >= MAX_TIMELINE) break;
    if (e.value.type !== 'object') continue;
    timeline.push({ date: e.key, lines: terms.effectLines(e.value, ctx, { indent: 0 }) });
  }
  timeline.sort((a, b) => cmpDate(a.date, b.date));
  return {
    type: 'countries', id: ref.id, kind: 'war',
    kindLabel: kindLabel('war', lang),
    file: ref.file, line: 1, sourceLine: 1,
    nameKey: null, name: null, descKey: null, desc: null,
    synthName: synthText(L('历史战争 ', 'Historical war '), lang) + ref.id,
    fields, groups, timeline, locRefs: LR.refs,
  };
}

function buildDependency(index, ref, lang, LR, ctx) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const items = [];
  for (const e of tree.entries) {
    if (e.value.type !== 'object') continue;
    const st = getEntry(e.value, 'subject_type');
    const first = getEntry(e.value, 'first');
    const second = getEntry(e.value, 'second');
    const a = first ? scalarValue(first) : '';
    const b = second ? scalarValue(second) : '';
    if (!a && !b) continue;
    items.push({
      id: a + '\u2192' + b,
      name: (terms.nameOf('tag', a, ctx) || a) + ' → ' + (terms.nameOf('tag', b, ctx) || b),
      link: { kind: 'dependency', id: st ? scalarValue(st) : '' },
      note: st ? scalarValue(st) : '',
    });
    if (items.length >= 400) break;
  }
  return {
    type: 'countries', id: ref.id, kind: 'dependency',
    kindLabel: kindLabel('dependency', lang),
    file: ref.file, line: 1, sourceLine: 1,
    nameKey: null, name: null, descKey: null, desc: null,
    synthName: synthText(L('附庸与外交关系 ', 'Subjects and diplomacy '), lang) + ref.id,
    fields: [], groups: items.length ? [{ key: 'deps', role: 'list', label: pick(L('关系条目 dependency', 'Relations'), lang), items }] : [],
    locRefs: LR.refs,
  };
}

// ---------------------------------------------------------------------------
// History: the rulers, leaders, battles and advisors a mod's history describes
// ---------------------------------------------------------------------------
//
// `history/countries/*.txt`, `history/wars/*.txt` and `history/advisors/*.txt`
// are read by the collectors in `src/content/history.js`. Each is its own tab
// because each is a different question: who ruled, who fought, where the
// fighting happened, and who could be hired.

const historyEngine = require('./history.js');

custom('monarchs', 'country', 'history',
  { zh: '历史君主', en: 'Historical rulers', icon: '🤴' },
  historyEngine.collectRulers,
  historyEngine.buildRuler);

custom('hist_advisors', 'country', 'history',
  { zh: '历史顾问', en: 'Historical advisors', icon: '🎓' },
  historyEngine.collectHistAdvisors,
  historyEngine.buildHistAdvisor);

custom('leaders', 'military', 'history',
  { zh: '历史将领', en: 'Historical leaders', icon: '🗡' },
  historyEngine.collectLeaders,
  historyEngine.buildLeader);

custom('battles', 'military', 'history',
  { zh: '历史战役', en: 'Historical battles', icon: '💥' },
  historyEngine.collectBattles,
  historyEngine.buildBattle);

// ---------------------------------------------------------------------------
// Map: areas, regions, superregions, continents, climates and terrain
// ---------------------------------------------------------------------------

const MAP_KIND = {
  area: 'area', region: 'region', superregion: 'superregion',
  continent: 'continent', climate: 'climate', terrain: 'terrain',
};

custom('map', 'world', 'map',
  { zh: '地图', en: 'Map', icon: '🧭' },
  function collectMap(index, files) {
    index.lists.map = index.lists.map || [];
    for (const rel of files) {
      if (!underPrefix(rel, ['map/'])) continue;
      const stem = fileStem(rel).toLowerCase();
      const kind = MAP_KIND[stem];
      if (!kind) continue;
      index.counters['map/'] = (index.counters['map/'] || 0) + 1;
      const tree = index.cache.tree(rel);
      if (!tree) continue;
      if (stem === 'terrain') {
        const cats = getEntry(tree, 'categories');
        if (!cats || cats.type !== 'object') continue;
        for (const e of cats.entries) {
          if (e.value.type !== 'object') continue;
          index.lists.map.push(makeRef('map', e.key, rel, e.line, {
            kind: 'terrain', mode: 'groupchildren', parent: 'categories',
            folder: 'map/', tableFile: rel,
          }));
        }
        continue;
      }
      for (const e of tree.entries) {
        if (e.value.type !== 'object' && e.value.type !== 'array') continue;
        index.lists.map.push(makeRef('map', e.key, rel, e.line, {
          kind, mode: 'block', folder: 'map/', tableFile: rel,
        }));
      }
    }
    for (const ref of index.lists.map) {
      const t = index.resolver.text(ref.id);
      // A mod-defined area with no localisation of its own still needs a
      // readable row, so fall back to the script id — the same fallback the
      // game shows when a name key is missing.
      index.titles.set('map:' + ref.id, t ? c.cleanTitle(t) : String(ref.id));
    }
  },
  function buildMap(index, ref, lang) {
    const tree = index.cache.tree(ref.file);
    if (!tree) return null;
    const LR = makeLocRefs(index.resolver, lang);
    const ctx = contentCtx(index, lang);
    let node;
    if (ref.kind === 'terrain') {
      const cats = getEntry(tree, 'categories');
      node = cats ? getEntry(cats, ref.id) : null;
    } else {
      node = getEntry(tree, ref.id);
    }
    if (!node) return null;
    const isList = node.type === 'array';
    const fields = [];
    const groups = [];
    const ids = [];
    if (isList) {
      for (const it of node.items) {
        const v = scalarValue(it);
        if (v) ids.push(v);
        if (ids.length >= 2000) break;
      }
    } else {
      // region.txt / superregion.txt point at their children by name.
      for (const key of ['areas', 'provinces']) {
        const n = getEntry(node, key);
        if (!n) continue;
        const vals = n.type === 'array' ? n.items.map((x) => String(scalarValue(x))) : [];
        if (!vals.length) continue;
        groups.push({
          key, role: 'list',
          label: pick(key === 'areas' ? L('包含地区 areas', 'Contains areas') : L('包含省份 provinces', 'Contains provinces'), lang),
          items: vals.slice(0, 300).map((id) => ({
            id,
            name: terms.nameOf(key === 'areas' ? 'area' : 'province', id, ctx),
            link: { kind: key === 'areas' ? 'area' : 'province', id },
          })),
        });
      }
      const sf = c.subFields(node, lang);
      if (sf) {
        for (const f of sf) {
          if (f.key === 'color' && node.type === 'object') {
            const cn = getEntry(node, 'color');
            const rec = cn ? c.fieldRecord('color', cn, lang) : null;
            if (rec) { fields.push(rec); continue; }
          }
          fields.push(f);
        }
      }
    }
    if (isList) {
      groups.unshift({
        key: 'members', role: 'list',
        label: pick(L('包含的省份', 'Provinces'), lang),
        items: ids.map((id) => ({ id, name: terms.nameOf('province', id, ctx), link: { kind: 'province', id } })),
      });
    }
    const count = isList ? ids.length : 0;
    if (count) {
      fields.unshift({ key: 'province_count', label: pick(L('省份数', 'Provinces'), lang), value: String(count), tone: 'num' });
    }
    return {
      type: 'map', id: ref.id, kind: ref.kind, kindLabel: kindLabel(ref.kind, lang),
      file: ref.file, line: ref.line, sourceLine: ref.line,
      nameKey: ref.id, name: LR.rich('name', ref.id),
      descKey: null, desc: null,
      fields, groups, locRefs: LR.refs,
    };
  });

// ---------------------------------------------------------------------------
// Interface: the widget tree of one GUI window
// ---------------------------------------------------------------------------

const MAX_WIDGETS = 400;
const MAX_DEPTH = 5;

function widgetOf(entry, lang, depth, budget) {
  if (entry.value.type !== 'object') return null;
  if (budget.n++ > MAX_WIDGETS) return null;
  const node = entry.value;
  const w = { type: entry.key, name: null, fields: [], children: [] };
  const nameNode = getEntry(node, 'name');
  if (nameNode && nameNode.type !== 'object') w.name = scalarValue(nameNode);
  for (const key of ['spriteType', 'quadTextureSprite', 'buttonFont', 'buttonText', 'position', 'size', 'orientation', 'maxValue', 'minValue']) {
    const n = getEntry(node, key);
    if (!n) continue;
    if (n.type === 'object') {
      w.fields.push({ key, label: key, value: n.entries.map((x) => x.key + '=' + scalarValue(x.value)).join(' ') });
    } else if (n.type !== 'array') {
      const v = scalarValue(n);
      if (key === 'buttonText') {
        // `buttonText` is a localisation key: the caption the game paints.
        w.buttonTextKey = v;
        budget.texts.push(v);
      }
      w.fields.push({ key, label: key, value: v });
    }
  }
  if (depth < MAX_DEPTH) {
    for (const ch of node.entries) {
      if (ch.value.type !== 'object') continue;
      const kid = widgetOf(ch, lang, depth + 1, budget);
      if (kid) w.children.push(kid);
    }
  }
  return w;
}

custom('interface', 'world', 'interface',
  { zh: '界面与 GUI', en: 'Interface', icon: '🖥️' },
  function collectInterface(index, files) {
    index.lists.interface = index.lists.interface || [];
    for (const rel of files) {
      if (!underPrefixAny(rel, ['interface/'])) continue;
      if (!/\.gui$/i.test(rel)) continue;
      index.counters['interface/'] = (index.counters['interface/'] || 0) + 1;
      const tree = index.cache.tree(rel);
      if (!tree) continue;
      const guiTypes = getEntry(tree, 'guiTypes');
      if (!guiTypes || guiTypes.type !== 'object') continue;
      let n = 0;
      for (const e of guiTypes.entries) {
        if (e.value.type !== 'object') continue;
        n++;
        const nameNode = getEntry(e.value, 'name');
        const name = nameNode && nameNode.type !== 'object' ? scalarValue(nameNode) : null;
        index.lists.interface.push(makeRef('interface', name || fileStem(rel) + '#' + n, rel, e.line, {
          kind: 'gui_window', widgetType: e.key, widgetIndex: n,
          folder: 'interface/', mode: 'block',
        }));
        if (name) index.titles.set('interface:' + name, name);
      }
    }
  },
  function buildInterface(index, ref, lang) {
    const tree = index.cache.tree(ref.file);
    if (!tree) return null;
    const guiTypes = getEntry(tree, 'guiTypes');
    if (!guiTypes) return null;
    let n = 0;
    let found = null;
    for (const e of guiTypes.entries) {
      if (e.value.type !== 'object') continue;
      n++;
      if (n === ref.widgetIndex) { found = e; break; }
    }
    if (!found) return null;
    const LR = makeLocRefs(index.resolver, lang);
    const budget = { n: 0, texts: [] };
    const widget = widgetOf(found, lang, 0, budget);
    // Every `buttonText` in the window is a localisation key the game paints.
    for (const key of budget.texts) LR.add('buttonText', key);
    const countWidgets = (w) => (w ? 1 + (w.children || []).reduce((a, k) => a + countWidgets(k), 0) : 0);
    return {
      type: 'interface', id: ref.id, kind: 'gui_window',
      kindLabel: kindLabel('gui_window', lang),
      file: ref.file, line: found.line, sourceLine: found.line,
      nameKey: null,
      name: null,
      synthName: synthText(L('GUI 窗口 ', 'GUI window '), lang) + ref.id,
      descKey: null, desc: null,
      fields: [
        { key: 'widgetType', label: pick(L('控件类型 widgetType', 'Widget type'), lang), value: ref.widgetType, tone: 'text' },
        { key: 'widgetCount', label: pick(L('控件总数', 'Widgets'), lang), value: String(countWidgets(widget)), tone: 'num' },
        { key: 'file', label: pick(L('所在文件', 'Defined in'), lang), value: ref.file, tone: 'text' },
      ],
      groups: [],
      widgets: widget,
      locRefs: LR.refs,
    };
  });

module.exports = { TYPES, GROUPS };