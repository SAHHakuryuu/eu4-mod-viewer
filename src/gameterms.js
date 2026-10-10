'use strict';
/**
 * Script → "what the game shows".
 *
 * EU4 never displays raw script. A player sees:
 *   • modifiers as `+10.00% 训练度` lines (green = good, red = bad)
 *   • effects as tooltip lines under an event option or decision button
 *   • conditions as a requirement list (green when met, red when not)
 *
 * This module produces that presentation as flat, serialisable "lines":
 *
 *   Line  = { i: indent, k: kind, spans: Span[], note?: string }
 *   Span  = { t: 'text'|'val', s: string, c?: tone }
 *         | { t: 'name', s: string, link?: {kind,id} }
 *         | { t: 'raw',  s: string }
 *
 * The wording comes from two places, both of which stay on the user's own disk:
 *
 *   1. the offline wiki they mounted in Settings (`src/wikigloss.js` parses its
 *      条件 / 命令 / 修正列表 pages at run time — nothing of it is redistributed
 *      with the tool), and
 *   2. the hand-written tables in `src/data/*-curated.js`, which stand alone when
 *      no wiki is mounted.
 *
 * Anything neither source covers is shown verbatim and marked as unverified
 * rather than silently invented. In particular a modifier's *display* convention
 * — whether `0.1` means `+10%` or `+0.1` — is only ever taken from the wiki's own
 * 效果类型 column, never guessed; see `modifierLines` below.
 *
 * Language: every chrome label (field names, scope nouns, operator words,
 * notes) is a `{ zh, en }` pair resolved through `ctx.lang`. Both term sources are
 * Chinese-only, so English mode never machine-translates a term name: it prints
 * the raw script identifier, which is exactly what the English wiki and the game
 * script call it.
 */

const { getEntry } = require('./codec/script.js');
const { EFFECT_NAMES } = require('./data/effects-curated.js');
const { MODIFIER_NAMES } = require('./data/modifiers-curated.js');
const wikigloss = require('./wikigloss.js');
const { L, pick, usesRawTerms } = require('./i18n.js');

/** Chrome labels, resolved once. `undefined`/unknown language degrades to zh. */
function tx(pair, ctx) {
  return pick(pair, ctx && ctx.lang);
}

const NOT_IN_GLOSSARY_MOD = L('词表中未收录的修正，原样显示', 'not in glossary; shown as script');
const NOT_IN_GLOSSARY_EFFECT = L('词表中未收录的命令，按脚本原样显示', 'not in glossary; shown as script');
const NOT_IN_GLOSSARY_TRIGGER = L('词表中未收录的条件，按脚本原样显示', 'not in glossary; shown as script');
const MISSING_EVENT_TITLE = L('（本地化标题缺失）', ' (localisation title missing)');
/** The offline wiki's description column has no English twin. */
const CHINESE_WIKI_NOTE = L('（中文 wiki 说明）', ' (Chinese wiki text)');
/** Suffix of the `ROOT = { … }` header, in every non-Chinese language. */
const SCOPE_MET = L(' 满足：', ' met: ');

// ---------------------------------------------------------------------------
// Glossary loading
// ---------------------------------------------------------------------------

/**
 * The merged tables, rebuilt whenever the set of sources changes. Both halves are
 * cheap to assemble, so there is no invalidation to get wrong: the cache key is
 * the wiki directory the runtime tables were parsed from.
 */
let GLOSS = null;
let GLOSS_KEY = null;

/**
 * Operator / scope-switch keywords. The wiki's trigger and command tables list
 * *conditions* and *effects*, not the control operators, so these are written by
 * hand and marked `curated` — the UI never claims wiki provenance for them.
 */
const CURATED_TRIGGERS = {
  AND: { zh: L('且（全部为真）', 'and (all true)'), source: 'curated' },
  OR: { zh: L('或（至少一个为真）', 'or (at least one true)'), source: 'curated' },
  NOT: { zh: L('非（全部为假）', 'not (all false)'), source: 'curated' },
  all_true: { zh: L('全部为真', 'all true'), source: 'curated' },
  any_true: { zh: L('至少一个为真', 'at least one true'), source: 'curated' },
  always: { zh: L('无条件成立', 'always true'), source: 'curated' },
  overlord: { zh: L('宗主国满足', 'overlord meets'), source: 'curated' },
  owner: { zh: L('拥有者满足', 'owner meets'), source: 'curated' },
  controller: { zh: L('控制者满足', 'controller meets'), source: 'curated' },
  capital_scope: { zh: L('首都所在省份满足', "capital's province meets"), source: 'curated' },
  exists: { zh: L('存在', 'exists'), source: 'curated' },
  ROOT: { zh: L('本国作用域满足', 'root scope meets'), source: 'curated' },
  FROM: { zh: L('来源作用域满足', 'from scope meets'), source: 'curated' },
  PREV: { zh: L('上一作用域满足', 'previous scope meets'), source: 'curated' },
  THIS: { zh: L('当前作用域满足', 'this scope meets'), source: 'curated' },
  is_potential_overlord: { zh: L('可能成为宗主国', 'can be overlord'), source: 'curated' },
  can_be_overlord: { zh: L('可以成为宗主国', 'may be overlord'), source: 'curated' },
  is_free_or_tributary_trigger: { zh: L('是独立国或朝贡国', 'is independent or tributary'), source: 'curated' },
};

const CURATED_EFFECTS = {
  ROOT: { zh: L('对本国作用域执行', 'execute in root scope'), source: 'curated' },
  FROM: { zh: L('对来源作用域执行', 'execute in from scope'), source: 'curated' },
  PREV: { zh: L('对上一作用域执行', 'execute in previous scope'), source: 'curated' },
  THIS: { zh: L('对当前作用域执行', 'execute in this scope'), source: 'curated' },
  owner: { zh: L('对拥有者执行', 'execute on owner'), source: 'curated' },
  controller: { zh: L('对控制者执行', 'execute on controller'), source: 'curated' },
  capital_scope: { zh: L('对首都所在省份执行', "execute in capital's province"), source: 'curated' },
  save_event_target_as: { zh: L('记录事件目标为', 'save event target as'), source: 'curated' },
  save_global_event_target_as: { zh: L('记录全局事件目标为', 'save global event target as'), source: 'curated' },
  clear_event_target: { zh: L('清除事件目标', 'clear event target'), source: 'curated' },
  set_variable: { zh: L('设定变量', 'set variable'), source: 'curated' },
  change_variable: { zh: L('增加变量', 'change variable'), source: 'curated' },
  subtract_variable: { zh: L('减少变量', 'subtract variable'), source: 'curated' },
  multiply_variable: { zh: L('变量乘以', 'multiply variable by'), source: 'curated' },
  divide_variable: { zh: L('变量除以', 'divide variable by'), source: 'curated' },
  clamp_variable: { zh: L('变量限定范围', 'clamp variable'), source: 'curated' },
  export_to_variable: { zh: L('导出到变量', 'export to variable'), source: 'curated' },
  set_local_variable: { zh: L('设定局部变量', 'set local variable'), source: 'curated' },
  add_to_variable: { zh: L('变量累加', 'add to variable'), source: 'curated' },
};

/**
 * The wiki's effects page has no Chinese-name column, so a label is derived from
 * its Chinese description when no hand-written one exists. Anything that cannot
 * yield a short Chinese phrase is left unlabelled rather than guessed.
 */
function labelFromDesc(desc) {
  if (!desc) return null;
  let s = String(desc).replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  if (!s || !/[\u4e00-\u9fff]/.test(s)) return null;
  const sentence = s.split(/[。；;\n]/)[0];
  let label = sentence.split(/[，,（(]/)[0].trim();
  label = label
    .replace(/<\s*[a-z_]+\s*>/gi, '')
    .replace(/\bX\b/g, '')
    .replace(/^(增加或减少|增加或者减少|变更|变化)/, '改变')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || label.length > 16) return null;
  return label;
}

/**
 * A glossary label as a `{ zh, en }` pair.
 *
 * The wiki scrape and the curated tables are Chinese-only, so they carry a plain
 * Chinese string. Such a label gets no English slot at all: in English mode the
 * caller then prints the raw script identifier instead of a machine translation.
 * (`pick` degrades `zh -> en -> first non-empty`, so an empty `en` slot would
 * still resolve to the Chinese string — `isEn` is the authoritative check.)
 */
function labelPair(value) {
  if (!value) return null;
  if (typeof value === 'string') return { zh: value };
  return value;                          // already a pair
}

/** A record as a `{ zh, en }` pair, or null when it carries no label. */
function normalizeLabel(rec) {
  if (!rec) return rec;
  const pair = labelPair(rec.zh);
  if (pair) return rec.zh === pair ? rec : Object.assign({}, rec, { zh: pair });
  if (rec.zh) return rec;                // unlabelled: keep the empty/null marker
  return rec;
}

/**
 * The merged dictionaries.
 *
 * The runtime tables come from the user's own wiki (`src/wikigloss.js`) and the
 * curated tables from `src/data/*-curated.js`; whichever is present is merged in,
 * so the tool renders the same way with or without a mounted wiki — it just knows
 * fewer names without one.
 */
function glossaries() {
  const key = wikigloss.cacheKey();
  if (!GLOSS || GLOSS_KEY !== key) {
    const runtime = wikigloss.load();

    const effects = {};
    for (const [k, rec] of Object.entries(runtime.effects)) {
      // The page repeats the key as the name for rows it has not translated.
      effects[k] = normalizeLabel(rec.zh === k ? Object.assign({}, rec, { zh: null }) : rec);
    }
    for (const [k, zh] of Object.entries(EFFECT_NAMES)) {
      effects[k] = Object.assign({}, effects[k] || {}, { zh: labelPair(zh), curated: true });
    }
    for (const [k, rec] of Object.entries(CURATED_EFFECTS)) {
      effects[k] = Object.assign({}, effects[k] || {}, rec);
    }
    for (const rec of Object.values(effects)) {
      if (!rec.zh) {
        const derived = labelFromDesc(rec.desc);
        if (derived) { rec.zh = labelPair(derived); rec.derived = true; }
      }
    }

    // Modifiers: the runtime table is authoritative, because its 效果类型 column
    // is the only statement of how a value prints. The hand-written table fills
    // the keys it does not cover, so a missing wiki can never degrade an idea
    // group or policy into raw script keys.
    const modifiers = {};
    for (const [k, rec] of Object.entries(runtime.modifiers)) {
      modifiers[k] = normalizeLabel(rec);
    }
    for (const [k, spec] of Object.entries(MODIFIER_NAMES)) {
      const [zh, mode] = spec;
      if (modifiers[k] && modifiers[k].zh) continue;
      modifiers[k] = Object.assign({}, modifiers[k] || {}, {
        zh: labelPair(zh),
        mode: mode === 'bool' ? null : mode,
        curated: true,
      });
    }

    const triggers = {};
    for (const [k, rec] of Object.entries(runtime.triggers)) {
      triggers[k] = normalizeLabel(rec);
    }
    for (const [k, rec] of Object.entries(CURATED_TRIGGERS)) {
      triggers[k] = Object.assign({}, triggers[k] || {}, rec);
    }

    GLOSS = { modifiers, triggers, effects };
    GLOSS_KEY = key;
  }
  return GLOSS;
}

/**
 * The human label of a glossary entry, in `ctx.lang`.
 *
 * The glossary itself is Chinese-only and there is no English twin to resolve
 * to, so English mode returns '' and the caller falls back to the raw script
 * identifier. Machine-translating the Chinese name here would invent a term.
 */
function glossLabel(entry, ctx) {
  if (!entry || !entry.zh) return '';
  if (usesRawTerms(ctx && ctx.lang)) return '';
  return tx(labelPair(entry.zh), ctx);
}

/** The wiki's Chinese description. It is the note in Chinese mode only. */
function entryDesc(entry) {
  return entry && entry.desc ? String(entry.desc) : null;
}

/**
 * The `note` of a line for a glossary entry.
 *
 * The wiki's description column is Chinese-only, so English mode marks it as
 * Chinese source text rather than pretending a translation exists. An entry with
 * no description at all yields null, which drops the note entirely — the same
 * shape the Chinese output has always had.
 */
function knownNote(entry, ctx) {
  const desc = entryDesc(entry);
  if (!desc) return null;
  if (usesRawTerms(ctx && ctx.lang)) return tx(CHINESE_WIKI_NOTE, ctx);
  return desc;
}

function unknownNote(pair, ctx) {
  return tx(pair, ctx) || null;
}

// ---------------------------------------------------------------------------
// Small value helpers
// ---------------------------------------------------------------------------

function isYes(v) { return v === 'yes' || v === true; }
function isNo(v) { return v === 'no' || v === false; }

/** Trim trailing zeros: 0.05 -> "5", 0.025 -> "2.5", 1.2345 -> "1.23". */
function trimNum(n, decimals = 2) {
  const s = n.toFixed(decimals);
  return s.replace(/\.?0+$/, '');
}

/** A modifier value as the game prints it: percentages use the ×100 convention. */
function formatModifierValue(mode, num) {
  if (mode === 'mul') return `${num >= 0 ? '+' : '\u2212'}${trimNum(Math.abs(num) * 100)}%`;
  if (Number.isInteger(num)) return `${num >= 0 ? '+' : '\u2212'}${Math.abs(num)}`;
  return `${num >= 0 ? '+' : '\u2212'}${trimNum(Math.abs(num))}`;
}

/**
 * Modifiers where a *negative* number is the good outcome, so the game paints
 * them green (`core_creation = -0.25` → `−25% 造核花费` in green).
 */
const NEGATIVE_IS_GOOD = new Set([
  'idea_cost', 'technology_cost', 'core_creation', 'development_cost', 'build_cost',
  'advisor_cost', 'stability_cost_modifier', 'culture_conversion_cost', 'unrest',
  'global_unrest', 'local_unrest', 'national_unrest', 'war_exhaustion', 'inflation',
  'ae_impact', 'aggressive_expansion_impact', 'revolt_risk', 'interest', 'loan_size',
  'diplomatic_annexation_cost', 'unjustified_demands', 'envoy_travel_time',
  'land_maintenance_modifier', 'naval_maintenance_modifier', 'fort_maintenance_modifier',
  'mercenary_cost', 'regiment_cost', 'infantry_cost', 'cavalry_cost', 'artillery_cost',
  'ship_cost', 'galley_cost', 'transport_cost', 'light_ship_cost', 'heavy_ship_cost',
  'construction_time', 'build_time', 'coring_duration', 'recruitment_time',
  'global_regiment_recruit_speed', 'shipbuilding_time', 'colonist_placement_chance',
  'state_governing_cost', 'governing_capacity', 'governing_capacity_modifier',
  'years_of_nationalism', 'local_autonomy', 'min_autonomy', 'devastation',
  'cost_of_advancing_technology', 'military_tech_cost_modifier', 'adm_tech_cost_modifier',
  'dip_tech_cost_modifier', 'local_build_cost', 'local_development_cost',
  'province_warscore_cost', 'siege_blockade_progress', 'culture_conversion_cost',
  'religious_conversion_cost', 'global_missionary_strength', 'missionary_maintenance_cost',
  'mercenary_maintenance_cost', 'cav_to_inf_ratio', 'land_attrition', 'naval_attrition',
  'hostile_attrition', 'attrition', 'border_friction', 'corruption', 'yearly_corruption',
  'monthly_corruption', 'autonomy', 'local_monthly_devastation', 'trade_company_cost',
  'harsh_treatment_cost', 'assault_fort_cost', 'forced_march_cost', 'army_drill_losses',
  'naval_morale', 'ship_durability',
]);

/** A modifier key that reads better with the sign flipped for display. */
function toneFor(key, value, entry) {
  if (value === 0) return 'neutral';
  let good = value > 0;
  const k = String(key);
  if (NEGATIVE_IS_GOOD.has(k)) good = !good;
  else if (/(_cost|_time|_duration|_maintenance|_expense)$/.test(k)) good = !good;
  else if (entry && entry.good === 'low') good = !good;
  return good ? 'good' : 'bad';
}

// ---------------------------------------------------------------------------
// Cross-reference kinds: script key → what the argument names
// ---------------------------------------------------------------------------

const ARG_KIND = {
  // ideas / policies / tech
  has_idea_group: 'idea_group', full_idea_group: 'idea_group', has_idea: 'idea',
  swap_free_idea_group: 'idea_group', add_idea_group: 'idea_group',
  // government
  has_reform: 'government_reform', add_reform: 'government_reform',
  add_government_reform: 'government_reform', remove_government_reform: 'government_reform',
  government: 'government', change_government: 'government',
  has_government_mechanic: 'government_mechanic',
  // religion / culture
  religion: 'religion', change_religion: 'religion', is_religion_enabled: 'religion',
  religion_group: 'religion_group', culture: 'culture', change_culture: 'culture',
  primary_culture: 'culture', change_primary_culture: 'culture', culture_group: 'culture_group',
  accepted_culture: 'culture', has_harmonized_with: 'religion',
  // map
  area: 'area', region: 'region', superregion: 'superregion', continent: 'continent',
  province_id: 'province', capital_scope: 'province', owns: 'province',
  owns_core_province: 'province', is_core: 'province', cede_province: 'province',
  add_core: 'province', remove_core: 'province', add_claim: 'province',
  add_permanent_claim: 'province', add_permanent_province_modifier: 'province',
  set_capital: 'province', has_building: 'building', add_building: 'building',
  remove_building: 'building', change_trade_goods: 'trade_good', trade_goods: 'trade_good',
  // estates
  has_estate: 'estate', estate: 'estate', estate_loyalty: 'estate', estate_influence: 'estate',
  change_estate_land_share: 'estate', add_estate_loyalty: 'estate',
  has_estate_privilege: 'privilege', add_estate_privilege: 'privilege',
  remove_estate_privilege: 'privilege', set_estate_privilege: 'privilege',
  // tags
  tag: 'tag', was_tag: 'tag', change_tag: 'tag', switch_tag: 'tag', original_tag: 'tag',
  // misc content
  has_disaster: 'disaster', disaster: 'disaster', has_institution: 'institution',
  is_institution_enabled: 'institution', has_dlc: 'dlc', cb: 'cb', casus_belli: 'cb',
  add_casus_belli: 'cb', declare_war_with_cb: 'cb', has_ruler_personality: 'personality',
  add_ruler_personality: 'personality', has_personal_deity: 'deity',
  is_subject_of_type: 'subject_type', subject_type: 'subject_type',
  has_active_trade_node: 'trade_node', has_merchant: 'trade_node',
  has_rebel_type: 'rebel', spawn_rebels: 'rebel', has_decret: 'decree',
  has_parliament_issue: 'parliament_issue', has_estate_agenda: 'estate_agenda',
  has_naval_doctrine: 'naval_doctrine', has_center_of_trade_of_level: 'province',
  has_terrain: 'terrain', terrain: 'terrain', trade_node: 'trade_node',
  has_church_aspect: 'church_aspect', has_holy_order: 'holy_order',
  has_faction: 'faction', add_faction: 'faction', remove_faction: 'faction',
  has_incident: 'incident', incident: 'incident', has_great_project: 'great_project',
  great_project: 'great_project', has_mercenary_company: 'mercenary',
  has_idea: 'idea', has_estate_influence_modifier: 'estate',
  has_country_modifier: 'modifier', has_province_modifier: 'modifier',
  has_ruler_modifier: 'modifier', remove_country_modifier: 'modifier',
  remove_province_modifier: 'modifier', remove_ruler_modifier: 'modifier',
  has_country_flag: null, has_global_flag: null, has_province_flag: null,
  has_ruler_flag: null, has_heir_flag: null, has_consort_flag: null,
  check_variable: null, has_variable: null,
  is_emperor_of_china: null, has_unlocked_cult: null, unlock_cult: 'cult',
  school: 'religion', set_religious_school: 'religion', holy_order: 'holy_order',
  reform: 'government_reform', government_reform: 'government_reform',
  age: 'age', current_age: 'age', institution: 'institution',
};

/** Sub-field names inside structured effect/trigger arguments. */
const FIELD_LABEL = {
  name: L('名称', 'name'), duration: L('持续天数', 'duration'),
  value: L('数值', 'value'), amount: L('数量', 'amount'), who: L('目标', 'who'),
  type: L('类型', 'type'), size: L('规模', 'size'), share: L('份额', 'share'),
  estate: L('阶层', 'estate'), skill: L('等级', 'skill'),
  adm: L('行政', 'adm'), dip: L('外交', 'dip'), mil: L('军事', 'mil'),
  adm_power: L('行政点数', 'adm power'), dip_power: L('外交点数', 'dip power'),
  mil_power: L('军事点数', 'mil power'), factor: L('权重', 'factor'),
  years: L('年数', 'years'), days: L('天数', 'days'), months: L('月数', 'months'),
  province: L('省份', 'province'), tag: L('国家', 'tag'), religion: L('宗教', 'religion'),
  culture: L('文化', 'culture'), modifier: L('修正', 'modifier'),
  hidden: L('隐藏', 'hidden'), tooltip: L('提示', 'tooltip'),
  on_trigger: L('触发时', 'on trigger'), trigger: L('条件', 'trigger'), limit: L('限制', 'limit'),
  effect: L('效果', 'effect'), chance: L('概率', 'chance'), scale: L('倍率', 'scale'),
  count: L('数量', 'count'), ids: L('目标列表', 'ids'),
  is_male: L('男性', 'is male'), dynasty: L('王朝', 'dynasty'), regent: L('摄政', 'regent'),
  heir: L('继承人', 'heir'),
  country: L('国家', 'country'), target: L('目标', 'target'), which: L('哪一个', 'which'),
  key: L('键', 'key'), flag: L('标记', 'flag'),
  home: L('母国', 'home'), overlord: L('宗主国', 'overlord'), subject: L('附庸国', 'subject'),
  cb: L('宣战理由', 'casus belli'),
  casus_belli: L('宣战理由', 'casus belli'), years_of_income: L('年收入倍数', 'years of income'),
  percentage: L('百分比', 'percentage'),
  keywords: L('关键词', 'keywords'), random: L('随机', 'random'), capital: L('首都', 'capital'),
  monarch_power: L('君主点数类别', 'monarch power type'),
  advisor: L('顾问', 'advisor'), leader: L('将领', 'leader'), general: L('陆军将领', 'general'),
  admiral: L('海军将领', 'admiral'),
  discovery: L('发现', 'discovery'), prestige: L('威望', 'prestige'),
  legitimacy: L('正统性', 'legitimacy'), stability: L('稳定度', 'stability'),
  primary_culture: L('主流文化', 'primary culture'), religion_group: L('宗教组', 'religion group'),
  culture_group: L('文化组', 'culture group'),
  technology_group: L('科技组', 'technology group'), government: L('政体', 'government'),
  reform: L('改革', 'reform'), area: L('地区', 'area'),
  region: L('区域', 'region'), superregion: L('大区', 'superregion'),
  continent: L('大洲', 'continent'), trade_goods: L('贸易商品', 'trade good'),
  define_ruler: L('设定君主', 'define ruler'), define_heir: L('设定继承人', 'define heir'),
  define_consort: L('设定配偶', 'define consort'),
  custom_tooltip: L('说明', 'custom tooltip'), custom_trigger_tooltip: L('条件说明', 'custom trigger tooltip'),
  event_target: L('事件目标', 'event target'), variable: L('变量', 'variable'),
  max: L('上限', 'max'), min: L('下限', 'min'),
  // History blocks: rulers, heirs, consorts, leaders and battles. These are the
  // field names `history/countries/*.txt` and `history/wars/*.txt` use, and the
  // same names appear in `define_ruler` / `define_heir` effects, so labelling
  // them here also improves how those effects read.
  birth_date: L('出生日期', 'birth date'), death_date: L('逝世日期', 'death date'),
  monarch_name: L('即位后名号', 'regnal name'), claim: L('继承宣称', 'claim'),
  female: L('女性', 'female'), country_of_origin: L('来自国家', 'country of origin'),
  fire: L('火力', 'fire'), shock: L('冲击', 'shock'),
  manuever: L('机动', 'manuever'), maneuver: L('机动', 'maneuver'),
  siege: L('围城', 'siege'), personality: L('特质', 'personality'),
  location: L('地点', 'location'), infantry: L('步兵', 'infantry'),
  cavalry: L('骑兵', 'cavalry'), artillery: L('炮兵', 'artillery'),
  heavy_ship: L('重型船只', 'heavy ship'), light_ship: L('轻型船只', 'light ship'),
  galley: L('桨帆船', 'galley'),
  losses: L('损失', 'losses'), commander: L('指挥官', 'commander'),
  // Advisors (`history/advisors/*.txt`).
  advisor_id: L('顾问编号', 'advisor id'), discount: L('折扣', 'discount'),
  // `result` in a battle block is who won: `yes` is the attacker's victory and
  // `no` the defender's, checked against the battles whose outcome is recorded.
  // (The wiki's comment for the key, "Show result", describes the wrong thing.)
  result: L('战役结果', 'battle result'),
};

/** A sub-field name in `ctx.lang`, falling back to the raw script key. */
function fieldLabel(key, ctx) {
  const pair = FIELD_LABEL[key];
  return pair ? tx(pair, ctx) : String(key);
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

function line(indent, kind, spans, note) {
  return note ? { i: indent, k: kind, spans, note } : { i: indent, k: kind, spans };
}
function t(s, c) { return c ? { t: 'text', s: String(s), c } : { t: 'text', s: String(s) }; }
function val(s, c) { return { t: 'val', s: String(s), c: c || 'neutral' }; }
function nm(s, link) { return { t: 'name', s: String(s), link: link || null }; }
function raw(s) { return { t: 'raw', s: String(s) }; }

/** Render a scalar node as display text. */
function scalar(node) {
  if (!node) return '';
  if (node.type === 'string' || node.type === 'identifier') return node.value;
  if (node.type === 'number') return node.raw !== undefined ? node.raw : String(node.value);
  return '';
}

function isNumericNode(node) {
  return !!node && (node.type === 'number' || (node.type === 'identifier' && /^-?\d+(\.\d+)?$/.test(node.value)));
}

function numOf(node) {
  if (!node) return null;
  if (node.type === 'number') return node.value;
  if (node.type === 'identifier' && /^-?\d+(\.\d+)?$/.test(node.value)) return Number(node.value);
  return null;
}

// ---------------------------------------------------------------------------
// Name resolution (script id → the name the game prints)
// ---------------------------------------------------------------------------

const NAME_CANDIDATES = {
  idea_group: ['{id}'],
  idea: ['{id}'],
  advisor: ['{id}'],
  policy: ['{id}'],
  modifier: ['{id}'],
  estate: ['{id}'],
  privilege: ['{id}'],
  government_reform: ['{id}'],
  government: ['{id}'],
  government_mechanic: ['{id}'],
  building: ['{id}'],
  religion: ['{id}'],
  religion_group: ['{id}'],
  culture: ['{id}'],
  culture_group: ['{id}'],
  trade_good: ['{id}'],
  trade_node: ['{id}'],
  cb: ['{id}'],
  disaster: ['{id}', 'disaster_{id}'],
  institution: ['{id}'],
  tag: ['{id}'],
  province: ['PROV{id}'],
  area: ['{id}'],
  region: ['{id}'],
  superregion: ['{id}'],
  continent: ['{id}'],
  terrain: ['{id}'],
  rebel: ['{id}'],
  mercenary: ['{id}'],
  deity: ['{id}'],
  church_aspect: ['{id}'],
  holy_order: ['{id}'],
  faction: ['{id}'],
  decree: ['{id}'],
  naval_doctrine: ['{id}'],
  personality: ['{id}'],
  great_project: ['{id}'],
  subject_type: ['{id}'],
  parliament_issue: ['{id}'],
  estate_agenda: ['{id}'],
  age: ['{id}'],
  incident: ['{id}'],
  cult: ['{id}'],
  dlc: ['{id}'],
  unit: ['{id}'],
  tech_group: ['{id}'],
  idea_group_name: ['{id}'],
  mission: ['{id}'],
  trade_company: ['{id}'],
  wargoal: ['{id}'],
  peace_treaty: ['{id}'],
  revolt_trigger: ['{id}'],
  flagship_modification: ['{id}'],
  on_action: ['{id}'],
  price: ['{id}'],
};

/**
 * The display name for a script identifier.
 *
 * Chinese mode resolves the mod's localisation and falls back to the bare id,
 * which is what the game itself does when a key is missing from localisation.
 * English mode never machine-translates: the identifier *is* the English label,
 * so it is returned directly — that is the name the English wiki and the game
 * script use, and it stays searchable.
 */
function nameOf(kind, id, ctx) {
  if (!ctx || !ctx.resolver || !kind || id === null || id === undefined || id === '') return null;
  const cands = NAME_CANDIDATES[kind];
  if (!cands) return null;
  if (usesRawTerms(ctx.lang)) return String(id);
  for (const pattern of cands) {
    const key = pattern.replace('{id}', String(id));
    const hit = ctx.resolver.lookup(key);
    if (hit && hit.value) {
      if (ctx.used) ctx.used.push({ key, value: hit.value, file: hit.file, line: hit.line, origin: hit.origin });
      return stripMarkup(hit.value);
    }
  }
  // Structural registers (events, idea groups, policies, advisors) know their own
  // names even when the localisation key is unconventional.
  if (ctx.names && ctx.names[kind]) {
    const v = ctx.names[kind].get(String(id));
    if (v) return v;
  }
  return null;
}

/** Remove §/£/[ ] markup for places where only flat text fits. */
function stripMarkup(s) {
  if (!s) return s;
  return String(s)
    .replace(/\u00a7./g, '')
    .replace(/\u00a3[^\u00a3]*\u00a3/g, '')
    .replace(/\\n/g, ' ')
    .replace(/\[([^\]]+)\]/g, '[$1]')
    .trim();
}

function argSpan(kind, valueNode, ctx) {
  const rawVal = scalar(valueNode);
  if (!kind) return val(rawVal);
  const pretty = nameOf(kind, rawVal, ctx);
  if (pretty && pretty !== rawVal) return nm(pretty, { kind, id: rawVal });
  return val(rawVal);
}

// ---------------------------------------------------------------------------
// Modifier blocks
// ---------------------------------------------------------------------------

/** Structural keys that appear inside a block but are not modifiers. */
const NON_MODIFIER_KEYS = new Set([
  'trigger', 'potential', 'allow', 'effect', 'immediate', 'option', 'name', 'title',
  'desc', 'picture', 'id', 'ai_chance', 'ai_will_do', 'factor', 'limit', 'start',
  'bonus', 'major', 'hidden', 'after', 'chance', 'ai_importance', 'free',
  'skill_scaled_modifier', 'modifier', 'on_trigger', 'on_granted', 'on_revoked',
  'on_change', 'can_select', 'custom_tooltip', 'condition', 'custom_trigger_tooltip',
  'which', 'size', 'icon', 'color', 'power_type', 'monarch_power', 'cooldown_years',
  'is_major', 'allow_only_male', 'allow_only_female', 'allow_only_primary_culture',
  'allow_only_accepted_culture', 'allowed_to_be_female', 'is_valid', 'allow_only_male',
  'bonus', 'timeout', 'timeout_days', 'province', 'country', 'type',
]);

/**
 * Render a block of modifier keys as the in-game modifier list.
 * @returns {Array} lines
 */
function modifierLines(node, ctx, opts = {}) {
  const out = [];
  if (!node) return out;
  const indent = opts.indent || 0;
  const gloss = glossaries().modifiers;

  if (node.type !== 'object') return out;

  for (const e of node.entries) {
    if (NON_MODIFIER_KEYS.has(e.key)) continue;
    const v = e.value;
    if (v.type === 'object' || v.type === 'array') continue;

    const rawVal = scalar(v);
    const entry = gloss[e.key];
    const label = glossLabel(entry, ctx);

    if (isYes(rawVal) || isNo(rawVal)) {
      const on = isYes(rawVal);
      if (on) {
        out.push(line(indent, 'mod', [t('\u2713 ' + (label || e.key))],
          knownNote(entry, ctx) || (label ? undefined : unknownNote(NOT_IN_GLOSSARY_MOD, ctx))));
      } else {
        out.push(line(indent, 'mod', [t('\u2717 ' + tx(L('非 ', 'not '), ctx), 'bad'), t(label || e.key)],
          knownNote(entry, ctx) || (label ? undefined : unknownNote(NOT_IN_GLOSSARY_MOD, ctx))));
      }
      continue;
    }

    const num = numOf(v);
    if (num === null) {
      out.push(line(indent, 'mod', [label ? t(label) : raw(e.key), t(' = ', 'muted'), raw(rawVal)]));
      continue;
    }

    // `mode` decides whether the script value prints as a percentage. It is only
    // ever taken from a source that states it (the wiki's 效果类型 column, or the
    // curated table); an unknown modifier is printed exactly as written, because
    // applying the ×100 convention to a flat value would not lose a label, it
    // would print a false number (`prestige = 10` as `+1000%`).
    const mode = entry && entry.mode ? entry.mode : null;
    const tone = toneFor(e.key, num, entry);
    const valueText = mode ? formatModifierValue(mode, num) : rawVal;
    if (label) {
      out.push(line(indent, 'mod', [mode ? val(valueText, tone) : raw(valueText), t(' ' + label)],
        knownNote(entry, ctx) || undefined));
    } else {
      out.push(line(indent, 'mod', [raw(e.key), t(' = ', 'muted'), mode ? val(valueText, tone) : raw(valueText)],
        knownNote(entry, ctx) || unknownNote(NOT_IN_GLOSSARY_MOD, ctx)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const AND_KEYS = new Set(['AND', 'all', 'all_true']);
const OR_KEYS = new Set(['OR', 'any', 'any_true']);
const NOT_KEYS = new Set(['NOT', 'not', 'none']);

/** Control-flow keys that must not be printed as conditions themselves. */
const COND_CONTROL = new Set(['limit', 'hidden_trigger', 'custom_trigger_tooltip', 'tooltip', 'if', 'else', 'else_if']);

// ---------------------------------------------------------------------------
// Scope blocks: `every_country`, `any_owned_province`, `random_neighbor_country`
// ---------------------------------------------------------------------------

const SCOPE_RE = /^(every|any|random)_(.+)$/;

const SCOPE_PREFIX = {
  every: L('对每个', 'for every '),
  any: L('任意一个', 'any '),
  random: L('随机一个', 'a random '),
};

const SCOPE_NOUN = {
  country: L('国家', 'country'), province: L('省份', 'province'),
  owned_province: L('拥有的省份', 'owned province'),
  core_province: L('核心省份', 'core province'),
  controlled_province: L('控制的省份', 'controlled province'),
  neighbor_country: L('邻国', 'neighbouring country'),
  neighbor_province: L('相邻省份', 'neighbouring province'),
  subject_country: L('附庸国', 'subject country'),
  known_country: L('已知国家', 'known country'), ally: L('盟友', 'ally'),
  rival: L('宿敌', 'rival'),
  active_trade_node: L('活跃贸易节点', 'active trade node'),
  trade_node: L('贸易节点', 'trade node'),
  owned_trade_node: L('拥有的贸易节点', 'owned trade node'),
  estate: L('阶层', 'estate'), active_estate: L('活跃阶层', 'active estate'),
  great_project: L('伟大工程', 'great project'),
  unit: L('部队', 'unit'), army: L('陆军', 'army'), navy: L('海军', 'navy'),
  leader: L('将领', 'leader'), general: L('陆军将领', 'general'),
  admiral: L('海军将领', 'admiral'), explorer: L('探险家', 'explorer'),
  conquistador: L('征服者', 'conquistador'),
  heir: L('继承人', 'heir'), consort: L('配偶', 'consort'),
  monarch: L('君主', 'monarch'), ruler: L('君主', 'ruler'),
  active_war: L('进行中的战争', 'active war'), war: L('战争', 'war'),
  disaster: L('灾难', 'disaster'), incident: L('事件', 'incident'),
  loan: L('贷款', 'loan'), mercenary_company: L('雇佣兵团', 'mercenary company'),
  area: L('地区', 'area'), region: L('区域', 'region'),
  state: L('州', 'state'), owned_state: L('拥有的州', 'owned state'),
  colonial_region: L('殖民区域', 'colonial region'),
  accepted_culture: L('已接受文化', 'accepted culture'), religion: L('宗教', 'religion'),
  center_of_trade: L('贸易中心', 'centre of trade'),
  capital: L('首都', 'capital'), neighbor: L('邻居', 'neighbour'),
  province_of: L('省份', 'province'), country_of: L('国家', 'country'),
  faction: L('派系', 'faction'), holy_order: L('修会', 'holy order'),
  personal_deity: L('个人神祇', 'personal deity'),
  parliament_issue: L('议会提案', 'parliament issue'), rebel: L('叛军', 'rebel'),
  regiment: L('团', 'regiment'), ship: L('船只', 'ship'),
};

/**
 * A label for a scope iterator key, or null when the key is an ordinary command.
 * Keys that the glossaries define, and keys whose value is not a block, are never
 * treated as scopes — `all_power_cost` is a modifier, not a scope.
 *
 * The English prefixes carry their own trailing space (`for every ` + `country`),
 * which Chinese does not need (`对每个` + `国家`).
 */
function scopeLabel(key, valueNode, glossHas, lang) {
  if (glossHas) return null;
  const m = SCOPE_RE.exec(key);
  if (!m) return null;
  if (!valueNode || valueNode.type !== 'object') return null;
  const noun = SCOPE_NOUN[m[2]];
  if (!noun) return null;
  return pick(SCOPE_PREFIX[m[1]], lang) + pick(noun, lang);
}

/** The `… 满足：` header of a scope block, in `lang`. */
function scopeHead(scope, lang) {
  return scope + pick(SCOPE_MET, lang);
}

/** Look up a `common/scripted_triggers` / `scripted_effects` definition. */
function scriptedDef(key, ctx, which) {
  if (!ctx) return null;
  const map = which === 'trigger' ? ctx.scriptedTriggers : ctx.scriptedEffects;
  if (!map || !map.get) return null;
  return map.get(key) || null;
}

/**
 * Render a trigger/condition block as a readable requirement list.
 */
function conditionLines(node, ctx, opts = {}) {
  const out = [];
  if (!node) return out;
  const indent = opts.indent || 0;
  const gloss = glossaries().triggers;
  const maxDepth = opts.maxDepth === undefined ? 8 : opts.maxDepth;

  const walk = (n, ind, joiner) => {
    if (!n || ind > maxDepth) return;

    if (n.type === 'array') { for (const it of n.items) walk(it, ind, joiner); return; }
    if (n.type !== 'object') { out.push(line(ind, 'cond', [raw(scalar(n))])); return; }

    for (const e of n.entries) {
      const key = e.key;
      const v = e.value;

      if (AND_KEYS.has(key)) {
        out.push(line(ind, 'group', [t(key === 'AND' ? tx(L('且（全部满足）', 'and (all met)'), ctx) : tx(L('全部满足', 'all met'), ctx), 'head')]));
        walk(v, ind + 1, 'AND');
        continue;
      }
      if (OR_KEYS.has(key)) {
        out.push(line(ind, 'group', [t(key === 'OR' ? tx(L('或（满足其一）', 'or (one of)'), ctx) : tx(L('满足其一', 'one of'), ctx), 'head')]));
        walk(v, ind + 1, 'OR');
        continue;
      }
      if (NOT_KEYS.has(key)) {
        out.push(line(ind, 'group', [t(tx(L('非（不满足）', 'not (not met)'), ctx), 'head')]));
        walk(v, ind + 1, 'NOT');
        continue;
      }
      if (key === 'hidden_trigger') { walk(v, ind, joiner); continue; }
      if (key === 'custom_trigger_tooltip' || key === 'tooltip') {
        const keyName = scalar(v.type === 'object' ? getEntry(v, 'tooltip') : v);
        const hit = ctx && ctx.resolver ? ctx.resolver.lookup(keyName) : null;
        out.push(line(ind, 'note', [t(tx(L('条件说明：', 'custom trigger tooltip: '), ctx)), hit ? t(stripMarkup(hit.value), 'text') : raw(keyName)]));
        continue;
      }
      if (key === 'if' && v.type === 'object') {
        const limit = getEntry(v, 'limit');
        if (limit) { out.push(line(ind, 'group', [t(tx(L('如果满足', 'if met'), ctx), 'head')])); walk(limit, ind + 1, 'AND'); }
        for (const sub of v.entries) {
          if (sub.key === 'limit') continue;
          walk({ type: 'object', entries: [sub] }, ind + 1, 'AND');
        }
        continue;
      }
      if (key === 'else' || key === 'else_if') { walk(v, ind, joiner); continue; }

      // A real condition.
      const entry = gloss[key];
      const label = glossLabel(entry, ctx);
      const scope = scopeLabel(key, v, !!entry, ctx && ctx.lang);
      if (scope) {
        out.push(line(ind, 'group', [t(scopeHead(scope, ctx && ctx.lang), 'head')]));
        walk(v, ind + 1, 'AND');
        continue;
      }
      const kind = ARG_KIND[key];
      const spans = [];

      if (joiner === 'NOT') spans.push(t('\u2717 ', 'bad'));
      else spans.push(t('\u2022 ', 'muted'));

      const scripted = label ? null : scriptedDef(key, ctx, 'trigger');
      if (scripted) spans.push(nm(tx(L(`自定义触发器「${key}」`, `custom trigger "${key}"`), ctx)));
      else spans.push(label ? t(label) : raw(key));

      if (v.type === 'object' || v.type === 'array') {
        const kids = v.type === 'object' ? v.entries : v.items.map((it) => ({ key: null, value: it }));
        const inline = kids.filter((k) => k.value && k.value.type !== 'object' && k.value.type !== 'array');
        if (inline.length) {
          spans.push(t(tx(L('：', ': '), ctx)));
          let first = true;
          for (const k of inline) {
            if (!first) spans.push(t(tx(L('、', ', '), ctx), 'muted'));
            first = false;
            if (k.key) { spans.push(t(fieldLabel(k.key, ctx) + ' = ', 'muted')); }
            spans.push(argSpan(kind, k.value, ctx));
          }
        }
        out.push(line(ind, 'cond', spans,
          scripted
            ? tx(L(`定义于 ${scripted.file}:${scripted.line}`, `defined at ${scripted.file}:${scripted.line}`), ctx)
            : (label ? knownNote(entry, ctx) : undefined)));
        const nested = kids.filter((k) => k.value && (k.value.type === 'object' || k.value.type === 'array'));
        for (const k of nested) walk({ type: 'object', entries: [k] }, ind + 1, 'AND');
        continue;
      }

      const rawVal = scalar(v);
      if (label) {
        if (isYes(rawVal)) {
          // A flag-style condition: `has_country_flag = yes` reads as the label.
        } else if (isNo(rawVal)) {
          spans.length = 0;
          spans.push(t('\u2022 ', 'muted'), t(tx(L('非 ', 'not '), ctx), 'bad'), t(label));
        } else {
          spans.push(t(' '));
          spans.push(argSpan(kind, v, ctx));
        }
      } else if (isYes(rawVal) || isNo(rawVal)) {
        if (isNo(rawVal)) {
          spans.length = 0;
          spans.push(t('\u2022 ', 'muted'), t(tx(L('非 ', 'not '), ctx), 'bad'), scripted ? nm(tx(L(`自定义触发器「${key}」`, `custom trigger "${key}"`), ctx)) : raw(key));
        }
      } else {
        spans.push(t(' '));
        spans.push(argSpan(kind, v, ctx));
      }
      out.push(line(ind, 'cond', spans,
        scripted ? tx(L(`定义于 ${scripted.file}:${scripted.line}`, `defined at ${scripted.file}:${scripted.line}`), ctx) : knownNote(entry, ctx) || (label ? undefined : unknownNote(NOT_IN_GLOSSARY_TRIGGER, ctx))));
    }
  };

  walk(node, indent, opts.joiner || 'AND');
  return out;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Look up an event's title by id through the content registry. */
function eventTitle(id, ctx) {
  if (!ctx || !ctx.events) return null;
  const hit = ctx.events.get(String(id));
  return hit ? hit.title : null;
}

/** Look up a modifier definition's own modifier list. */
function modifierDef(name, ctx) {
  if (!ctx || !ctx.modifiers) return null;
  return ctx.modifiers.get(String(name)) || null;
}

const EVENT_EFFECTS = {
  country_event: L('国家事件', 'country event'),
  province_event: L('省份事件', 'province event'),
  news_event: L('新闻事件', 'news event'),
  heir_event: L('继承人事件', 'heir event'),
};

/**
 * Render an effect block as the tooltip lines the game would show.
 */
function effectLines(node, ctx, opts = {}) {
  const out = [];
  if (!node) return out;
  const indent = opts.indent || 0;
  const gloss = glossaries().effects;
  const maxDepth = opts.maxDepth === undefined ? 6 : opts.maxDepth;

  const emitEntry = (e, ind) => {
    const key = e.key;
    const v = e.value;

    if (ind > maxDepth) { out.push(line(ind, 'eff', [raw(key + ' = \u2026')])); return; }

    if (key === 'hidden_effect') {
      out.push(line(ind, 'group', [t(tx(L('隐藏效果（不在游戏提示中显示）', 'hidden effect (not shown in game tooltip)'), ctx), 'muted')]));
      walk(v, ind + 1);
      return;
    }
    if (key === 'custom_tooltip' || key === 'tooltip') {
      const keyName = scalar(v.type === 'object' ? (getEntry(v, 'tooltip') || getEntry(v, 'custom_tooltip')) : v);
      const hit = ctx && ctx.resolver ? ctx.resolver.lookup(keyName) : null;
      out.push(line(ind, 'note', [t(tx(L('提示：', 'tooltip: '), ctx)), hit ? t(stripMarkup(hit.value), 'text') : raw(keyName)]));
      return;
    }
    if (key === 'if' || key === 'else_if' || key === 'else') {
      const label = key === 'if' ? L('如果满足', 'if met')
        : key === 'else_if' ? L('否则如果满足', 'else if met') : L('否则', 'else');
      const limit = v.type === 'object' ? getEntry(v, 'limit') : null;
      out.push(line(ind, 'group', [t(tx(label, ctx), 'head')]));
      if (limit) conditionLines(limit, ctx, { indent: ind + 1 }).forEach((l) => out.push(l));
      if (v.type === 'object') {
        for (const sub of v.entries) {
          if (sub.key === 'limit') continue;
          emitEntry(sub, ind + 1);
        }
      }
      return;
    }
    if (key === 'random_list' || key === 'random') {
      out.push(line(ind, 'group', [t(tx(L('随机结果', 'random outcome'), ctx), 'head')]));
      if (v.type === 'object') {
        for (const branch of v.entries) {
          const weight = Number(branch.key);
          const label = Number.isFinite(weight)
            ? tx(L(`权重 ${trimNum(weight)}`, `weight ${trimNum(weight)}`), ctx)
            : branch.key;
          out.push(line(ind + 1, 'group', [t(label + tx(L(' 分支', ' branch'), ctx), 'head')]));
          walk(branch.value, ind + 2);
        }
      }
      return;
    }
    if (key === 'trigger_switch' || key === 'switch') {
      out.push(line(ind, 'group', [t(tx(L('按条件分支', 'switch on trigger'), ctx), 'head')]));
      walk(v, ind + 1);
      return;
    }

    // --- scope iterators --------------------------------------------------
    {
      const glossed = !!(gloss[key]);
      const scope = scopeLabel(key, v, glossed, ctx && ctx.lang);
      if (scope) {
        out.push(line(ind, 'group', [t(scope, 'head')]));
        if (v.type === 'object') {
          const limit = getEntry(v, 'limit');
          if (limit) {
            out.push(line(ind + 1, 'group', [t(tx(L('限制条件', 'limit'), ctx), 'head')]));
            conditionLines(limit, ctx, { indent: ind + 2 }).forEach((l) => out.push(l));
          }
          for (const sub of v.entries) {
            if (sub.key === 'limit') continue;
            emitEntry(sub, ind + 1);
          }
        }
        return;
      }
    }

    // --- event triggers --------------------------------------------------
    if (EVENT_EFFECTS[key]) {
      const idNode = v.type === 'object' ? getEntry(v, 'id') : v;
      const id = scalar(idNode);
      const title = eventTitle(id, ctx);
      const days = v.type === 'object' ? numOf(getEntry(v, 'days')) : null;
      const daysSpan = days !== null
        ? [t(tx(L('，延迟 ', ', delayed '), ctx)), val(String(days)), t(tx(L(' 天', ' days'), ctx))]
        : [];
      out.push(line(ind, 'eff', [
        t(tx(L('触发', 'trigger '), ctx) + tx(EVENT_EFFECTS[key], ctx) + tx(L('：', ': '), ctx)),
        title ? nm(stripMarkup(title), { kind: 'event', id }) : val(id),
        ...daysSpan,
      ], tx(L(`事件 ${id}`, `event ${id}`), ctx) + (title ? '' : tx(MISSING_EVENT_TITLE, ctx))));
      if (v.type === 'object') {
        const others = v.entries.filter((x) => !['id', 'days'].includes(x.key));
        for (const o of others) emitEntry(o, ind + 1);
      }
      return;
    }

    // --- timed modifiers --------------------------------------------------
    if (key === 'add_country_modifier' || key === 'add_province_modifier'
        || key === 'add_ruler_modifier' || key === 'add_heir_modifier'
        || key === 'add_consort_modifier' || key === 'add_permanent_province_modifier') {
      const label = tx({
        add_country_modifier: L('获得国家修正', 'add country modifier'),
        add_province_modifier: L('获得省份修正', 'add province modifier'),
        add_ruler_modifier: L('获得君主修正', 'add ruler modifier'),
        add_heir_modifier: L('获得继承人修正', 'add heir modifier'),
        add_consort_modifier: L('获得配偶修正', 'add consort modifier'),
        add_permanent_province_modifier: L('获得永久省份修正', 'add permanent province modifier'),
      }[key], ctx);
      let nameNode = v;
      let durationNode = null;
      if (v.type === 'object') {
        nameNode = getEntry(v, 'name');
        durationNode = getEntry(v, 'duration');
      }
      const name = scalar(nameNode);
      const duration = numOf(durationNode);
      const spans = [t(label + tx(L('：', ': '), ctx)), argSpan('modifier', nameNode, ctx)];
      if (duration !== null && duration >= 0) {
        spans.push(t(tx(L('，持续 ', ', for '), ctx)), val(String(duration)), t(tx(L(' 天', ' days'), ctx)));
        if (duration >= 365) spans.push(t(tx(L(`（约 ${trimNum(duration / 365, 1)} 年）`, ` (about ${trimNum(duration / 365, 1)} years)`), ctx), 'muted'));
      } else if (duration === -1) {
        spans.push(t(tx(L('，永久', ', permanently'), ctx)));
      }
      out.push(line(ind, 'eff', spans));
      const def = modifierDef(name, ctx);
      if (def && def.mods) {
        out.push(line(ind + 1, 'group', [t(tx(L('修正效果', 'modifier effects'), ctx), 'head')]));
        modifierLines(def.mods, ctx, { indent: ind + 2 }).forEach((l) => out.push(l));
      }
      return;
    }

    if (key === 'remove_country_modifier' || key === 'remove_province_modifier'
        || key === 'remove_ruler_modifier' || key === 'remove_heir_modifier') {
      const label = tx(key.startsWith('remove_country') ? L('移除国家修正', 'remove country modifier')
        : key.startsWith('remove_province') ? L('移除省份修正', 'remove province modifier')
          : L('移除君主修正', 'remove ruler modifier'), ctx);
      out.push(line(ind, 'eff', [t(label + tx(L('：', ': '), ctx)), argSpan('modifier', v, ctx)]));
      return;
    }

    // --- estates ----------------------------------------------------------
    if (key === 'add_estate_privilege' || key === 'remove_estate_privilege' || key === 'set_estate_privilege') {
      const label = tx(key === 'add_estate_privilege' ? L('授予阶层特权', 'grant estate privilege')
        : key === 'remove_estate_privilege' ? L('撤销阶层特权', 'revoke estate privilege')
          : L('设定阶层特权', 'set estate privilege'), ctx);
      out.push(line(ind, 'eff', [t(label + tx(L('：', ': '), ctx)), argSpan('privilege', v, ctx)]));
      return;
    }
    if (key === 'change_estate_land_share') {
      const estate = scalar(v.type === 'object' ? getEntry(v, 'estate') : null);
      const share = numOf(v.type === 'object' ? getEntry(v, 'share') : null);
      const estateLabel = estate === 'all' ? tx(L('所有阶层', 'all estates'), ctx) : (nameOf('estate', estate, ctx) || estate);
      out.push(line(ind, 'eff', [
        t(tx(L('调整阶层土地份额：', 'change estate land share: '), ctx)), nm(estateLabel),
        share !== null ? val(`${share >= 0 ? '+' : '\u2212'}${Math.abs(share)}%`, share >= 0 ? 'good' : 'bad') : t(''),
      ]));
      return;
    }
    if (key === 'add_estate_loyalty') {
      const estate = scalar(getEntry(v, 'estate'));
      const amount = numOf(getEntry(v, 'amount'));
      const spans = [t(tx(L('阶层忠诚度：', 'estate loyalty: '), ctx)), nm(nameOf('estate', estate, ctx) || estate)];
      if (amount !== null) {
        spans.push(t(' '));
        spans.push(val(`${amount >= 0 ? '+' : '\u2212'}${Math.abs(amount)}`, amount >= 0 ? 'good' : 'bad'));
      }
      out.push(line(ind, 'eff', spans));
      return;
    }
    if (key === 'add_estate_influence_modifier') {
      out.push(line(ind, 'eff', [t(tx(L('阶层影响力修正：', 'estate influence modifier: '), ctx)), raw(JSON.stringify(scalar(v)))]));
      const kids = v.type === 'object' ? v.entries : [];
      for (const k of kids) {
        out.push(line(ind + 1, 'eff', [t(fieldLabel(k.key, ctx) + tx(L('：', ': '), ctx), 'muted'), argSpan(ARG_KIND[k.key], k.value, ctx)]));
      }
      return;
    }

    // --- flags ------------------------------------------------------------
    if (/^(set|add)_country_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('设置国家标记：', 'set country flag: '), ctx)), raw(scalar(v))])); return;
    }
    if (/^clr_country_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('清除国家标记：', 'clear country flag: '), ctx)), raw(scalar(v))])); return;
    }
    if (/^(set|add)_global_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('设置全局标记：', 'set global flag: '), ctx)), raw(scalar(v))])); return;
    }
    if (/^clr_global_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('清除全局标记：', 'clear global flag: '), ctx)), raw(scalar(v))])); return;
    }
    if (/^(set|add)_province_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('设置省份标记：', 'set province flag: '), ctx)), raw(scalar(v))])); return;
    }
    if (/^(set|add)_ruler_flag$/.test(key)) {
      out.push(line(ind, 'eff', [t(tx(L('设置君主标记：', 'set ruler flag: '), ctx)), raw(scalar(v))])); return;
    }

    // --- characters -------------------------------------------------------
    if (key === 'define_ruler' || key === 'define_heir' || key === 'define_consort') {
      const label = tx(key === 'define_ruler' ? L('设定君主', 'define ruler')
        : key === 'define_heir' ? L('设定继承人', 'define heir') : L('设定配偶', 'define consort'), ctx);
      const spans = [t(label + tx(L('：', ': '), ctx))];
      if (v.type === 'object') {
        const name = scalar(getEntry(v, 'name'));
        if (name) spans.push(nm(name));
        for (const stat of ['adm', 'dip', 'mil']) {
          const n = numOf(getEntry(v, stat));
          if (n !== null) spans.push(t(`\u3000${fieldLabel(stat, ctx)} `), val(String(n)));
        }
        const dyn = scalar(getEntry(v, 'dynasty'));
        if (dyn) spans.push(t('\u3000' + tx(L('王朝 ', 'dynasty '), ctx)), nm(dyn));
      }
      out.push(line(ind, 'eff', spans));
      return;
    }
    if (key === 'create_advisor' || key === 'define_advisor') {
      const label = tx(key === 'create_advisor' ? L('生成顾问', 'create advisor') : L('设定顾问', 'define advisor'), ctx);
      const spans = [t(label + tx(L('：', ': '), ctx))];
      if (v.type === 'object') {
        const name = scalar(getEntry(v, 'name'));
        const type = scalar(getEntry(v, 'type'));
        const skill = numOf(getEntry(v, 'skill'));
        if (name) spans.push(nm(name));
        if (type) spans.push(t('\u3000' + tx(L('类型 ', 'type '), ctx)), argSpan('advisor', getEntry(v, 'type'), ctx));
        if (skill !== null) spans.push(t('\u3000' + tx(L('等级 ', 'skill '), ctx)), val(String(skill)));
      } else {
        spans.push(argSpan('advisor', v, ctx));
      }
      out.push(line(ind, 'eff', spans));
      return;
    }
    if (key === 'kill_ruler' || key === 'kill_heir' || key === 'kill_consort' || key === 'kill_advisor') {
      const label = tx({
        kill_ruler: L('君主死亡', 'ruler dies'),
        kill_heir: L('继承人死亡', 'heir dies'),
        kill_consort: L('配偶死亡', 'consort dies'),
        kill_advisor: L('顾问死亡', 'advisor dies'),
      }[key], ctx);
      out.push(line(ind, 'eff', [t(label)]));
      return;
    }
    if (key === 'create_general' || key === 'create_admiral' || key === 'create_explorer' || key === 'create_conquistador') {
      const label = tx({
        create_general: L('生成陆军将领', 'create general'),
        create_admiral: L('生成海军将领', 'create admiral'),
        create_explorer: L('生成探险家', 'create explorer'),
        create_conquistador: L('生成征服者', 'create conquistador'),
      }[key], ctx);
      const spans = [t(label)];
      if (v.type === 'object') {
        const name = scalar(getEntry(v, 'name'));
        if (name) spans.push(t(tx(L('：', ': '), ctx)), nm(name));
        for (const statKey of ['fire', 'shock', 'manuever', 'siege']) {
          const n = numOf(getEntry(v, statKey));
          if (n !== null) spans.push(t(`\u3000${statKey} `), val(String(n)));
        }
      }
      out.push(line(ind, 'eff', spans));
      return;
    }

    // --- variables --------------------------------------------------------
    if (key === 'set_variable' || key === 'change_variable' || key === 'subtract_variable' || key === 'check_variable') {
      const which = scalar(getEntry(v, 'which'));
      const value = numOf(getEntry(v, 'value'));
      const label = tx({
        set_variable: L('设定变量', 'set variable'),
        change_variable: L('增加变量', 'change variable'),
        subtract_variable: L('减少变量', 'subtract variable'),
        check_variable: L('变量至少为', 'variable at least'),
      }[key], ctx);
      out.push(line(ind, 'eff', [
        t(label + tx(L('：', ': '), ctx)), raw(which),
        value !== null ? t(' = ') : t(''),
        value !== null ? val(String(value)) : t(''),
      ]));
      return;
    }

    // --- generic ----------------------------------------------------------
    const entry = gloss[key];
    const label = glossLabel(entry, ctx);
    const kind = ARG_KIND[key];
    const scripted = label ? null : scriptedDef(key, ctx, 'effect');
    const labelSpan = scripted
      ? nm(tx(L(`自定义效果「${key}」`, `custom effect "${key}"`), ctx))
      : (label ? t(label) : raw(key));
    const noteText = scripted
      ? tx(L(`定义于 ${scripted.file}:${scripted.line}`, `defined at ${scripted.file}:${scripted.line}`), ctx)
      : (knownNote(entry, ctx) || (label ? undefined : unknownNote(NOT_IN_GLOSSARY_EFFECT, ctx)));

    if (v.type === 'object' || v.type === 'array') {
      const kids = v.type === 'object' ? v.entries : v.items.map((it) => ({ key: null, value: it }));
      const scalarKids = kids.filter((k) => k.value && k.value.type !== 'object' && k.value.type !== 'array');
      const spans = [labelSpan];
      if (scalarKids.length) {
        spans.push(t(tx(L('：', ': '), ctx)));
        let first = true;
        for (const k of scalarKids) {
          if (!first) spans.push(t(tx(L('\u3000', '  '), ctx), 'muted'));
          first = false;
          if (k.key) spans.push(t(fieldLabel(k.key, ctx) + ' = ', 'muted'));
          spans.push(argSpan(kind || ARG_KIND[k.key], k.value, ctx));
        }
      }
      out.push(line(ind, 'eff', spans, noteText));
      const nested = kids.filter((k) => k.value && (k.value.type === 'object' || k.value.type === 'array'));
      for (const k of nested) {
        if (k.key) out.push(line(ind + 1, 'group', [t(fieldLabel(k.key, ctx) + tx(L('：', ': '), ctx), 'head')]));
        walk(k.value, ind + 2);
      }
      return;
    }

    if (key === 'add_power' || key === 'add_monarch_power') {
      out.push(line(ind, 'eff', [labelSpan, t(' '), val(scalar(v))]));
      return;
    }

    const spans = [labelSpan];
    const rawVal = scalar(v);
    if (!(isYes(rawVal) && (label || scripted))) {
      spans.push(t(' '));
      spans.push(argSpan(kind, v, ctx));
    }
    out.push(line(ind, 'eff', spans, noteText));
  };

  const walk = (n, ind) => {
    if (!n) return;
    if (n.type === 'array') { for (const it of n.items) walk(it, ind); return; }
    if (n.type !== 'object') { out.push(line(ind, 'eff', [raw(scalar(n))])); return; }
    for (const e of n.entries) emitEntry(e, ind);
  };

  walk(node, indent);
  return out;
}

// ---------------------------------------------------------------------------
// Tooltips for the reader: what does an unknown key mean?
// ---------------------------------------------------------------------------

function describeTrigger(key) {
  const g = glossaries().triggers[key];
  return g || null;
}
function describeEffect(key) {
  const g = glossaries().effects[key];
  return g || null;
}
function describeModifier(key) {
  const g = glossaries().modifiers[key];
  return g || null;
}

/** Keys the hand-written tables cover on their own, with no wiki mounted. */
const CURATED_COUNTS = {
  modifiers: Object.keys(MODIFIER_NAMES).length,
  triggers: Object.keys(CURATED_TRIGGERS).length,
  effects: new Set([...Object.keys(EFFECT_NAMES), ...Object.keys(CURATED_EFFECTS)]).size,
};

/**
 * What the term tables currently hold, and where they came from. The UI prints
 * this verbatim, so it has to distinguish "read out of your wiki just now" from
 * "no wiki mounted, hand-written tables only" rather than always implying the
 * bigger number.
 */
function glossaryStats() {
  const g = glossaries();
  const runtime = wikigloss.stats();
  return {
    modifiers: Object.keys(g.modifiers).length,
    triggers: Object.keys(g.triggers).length,
    effects: Object.keys(g.effects).length,
    fromWiki: runtime.wiki,
    wikiDir: runtime.dir,
    wikiError: runtime.error,
    runtime: runtime.counts,
    curated: CURATED_COUNTS,
  };
}

/** Drop the merged tables; the mounted wiki or its contents changed. */
function clearGlossary() {
  GLOSS = null;
  GLOSS_KEY = null;
  wikigloss.clear();
}

module.exports = {
  glossaries,
  glossaryStats,
  clearGlossary,
  formatModifierValue,
  modifierLines,
  conditionLines,
  effectLines,
  nameOf,
  stripMarkup,
  trimNum,
  describeTrigger,
  describeEffect,
  describeModifier,
  FIELD_LABEL,
  ARG_KIND,
};
