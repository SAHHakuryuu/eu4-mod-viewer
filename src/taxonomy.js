'use strict';
/**
 * Taxonomy of everything an EU4 mod can change.
 *
 * Each category maps a set of game paths to a human label (Chinese + English),
 * an icon, and — where one exists — the corresponding page in the offline
 * Chinese EU4 wiki, so the viewer can deep-link into it.
 *
 * `match` entries are path prefixes relative to the mod root, using forward
 * slashes. `fileMatch` entries match a basename anywhere in the tree.
 */

const CATEGORIES = [
  {
    id: 'countries',
    zh: '国家与政体',
    en: 'Countries',
    icon: '🏳️',
    wiki: '国家.html',
    match: ['common/countries/', 'common/country_tags/', 'common/country_colors/', 'common/custom_country_colors/', 'common/client_states/', 'history/countries/'],
    desc: '国家标签、配色、历史开局与可成立国家',
    descEn: 'Country tags, colours, starting history and formable nations',
  },
  {
    id: 'provinces',
    zh: '省份',
    en: 'Provinces',
    icon: '🗺️',
    wiki: '省份修改.html',
    match: ['history/provinces/', 'common/province_names/'],
    fileMatch: ['definition.csv', 'positions.txt'],
    desc: '省份历史、名称、归属、宗教与文化',
    descEn: 'Province history, names, ownership, religion and culture',
  },
  {
    id: 'map',
    zh: '地图',
    en: 'Map',
    icon: '🧭',
    wiki: '地图修改.html',
    match: ['map/'],
    desc: '地图图像、地区、区域、地形、气候与地形定义',
    descEn: 'Map images, areas, regions, terrain, climate and terrain definitions',
  },
  {
    id: 'decisions',
    zh: '决议',
    en: 'Decisions',
    icon: '📜',
    wiki: '决议修改.html',
    match: ['decisions/'],
    desc: '国家决议：条件、效果与 AI 权重',
    descEn: 'Country decisions: conditions, effects and AI weight',
  },
  {
    id: 'events',
    zh: '事件',
    en: 'Events',
    icon: '⚡',
    wiki: '事件修改.html',
    match: ['events/'],
    desc: '事件：触发条件、选项与图片',
    descEn: 'Events: trigger conditions, options and pictures',
  },
  {
    id: 'missions',
    zh: '任务树',
    en: 'Missions',
    icon: '🎯',
    wiki: '任务树修改.html',
    match: ['missions/'],
    desc: '任务树与任务序列',
    descEn: 'Mission trees and mission sequences',
  },
  {
    id: 'ideas',
    zh: '理念',
    en: 'Ideas',
    icon: '💡',
    wiki: '理念组修改.html',
    match: ['common/ideas/', 'common/custom_ideas/'],
    desc: '理念组、国家理念与自定义理念',
    descEn: 'Idea groups, national ideas and custom ideas',
  },
  {
    id: 'policies',
    zh: '政策',
    en: 'Policies',
    icon: '⚖️',
    wiki: '政策修改.html',
    match: ['common/policies/'],
    desc: '政策及其解锁条件与修正',
    descEn: 'Policies with their unlock conditions and modifiers',
  },
  {
    id: 'government',
    zh: '政府与改革',
    en: 'Government',
    icon: '🏛️',
    wiki: '政府修改.html',
    match: ['common/governments/', 'common/government_reforms/', 'common/government_names/', 'common/government_ranks/', 'common/government_mechanics/'],
    desc: '政体、政府改革、政府等级与名称',
    descEn: 'Governments, government reforms, ranks and names',
  },
  {
    id: 'traits',
    zh: '君主与将领特质',
    en: 'Traits & personalities',
    icon: '👑',
    wiki: '君主特质.html',
    match: [
      'common/ruler_personalities/', 'common/ancestor_personalities/',
      'common/leader_personalities/', 'common/ai_personalities/',
    ],
    desc: '君主/先祖/将领特质与 AI 性格',
    descEn: 'Ruler, ancestor and leader traits, plus AI personalities',
  },
  {
    id: 'religion',
    zh: '宗教',
    en: 'Religion',
    icon: '⛪',
    wiki: '宗教修改.html',
    match: ['common/religions/', 'common/personal_deities/', 'common/church_aspects/', 'common/fervor/', 'common/fetishist_cults/', 'common/religious_reforms/', 'common/incidents/', 'common/isolationism/'],
    desc: '宗教、信条、教会面向与宗教机制',
    descEn: 'Religions, aspects, church aspects and religious mechanics',
  },
  {
    id: 'culture',
    zh: '文化',
    en: 'Culture',
    icon: '🈶',
    wiki: '文化修改.html',
    match: ['common/cultures/'],
    desc: '文化组与文化交流',
    descEn: 'Culture groups and culture mechanics',
  },
  {
    id: 'technology',
    zh: '科技与思潮',
    en: 'Technology',
    icon: '🔬',
    wiki: '科技修改.html',
    match: ['common/technologies/', 'common/institutions/'],
    fileMatch: ['technology.txt'],
    desc: '科技等级、科技组与思潮',
    descEn: 'Technology levels, technology groups and institutions',
  },
  {
    id: 'units',
    zh: '单位与军事',
    en: 'Units',
    icon: '⚔️',
    wiki: '单位修改.html',
    match: ['common/units/', 'common/mercenary_companies/'],
    desc: '陆军/海军单位、兵模与雇佣兵团',
    descEn: 'Army and navy units, unit models and mercenary companies',
  },
  {
    id: 'buildings',
    zh: '建筑',
    en: 'Buildings',
    icon: '🏗️',
    wiki: '建筑修改.html',
    match: ['common/buildings/'],
    desc: '建筑、其前置与效果',
    descEn: 'Buildings with their prerequisites and effects',
  },
  {
    id: 'trade',
    zh: '贸易',
    en: 'Trade',
    icon: '🚢',
    wiki: '贸易节点修改.html',
    match: ['common/tradenodes/', 'common/trade_companies/', 'common/tradegoods/', 'common/prices/'],
    desc: '贸易节点、贸易公司、商品与价格',
    descEn: 'Trade nodes, trade companies, trade goods and prices',
  },
  {
    id: 'estates',
    zh: '阶层',
    en: 'Estates',
    icon: '👥',
    wiki: '阶层修改.html',
    match: ['common/estates/', 'common/estate_privileges/', 'common/estate_agendas/'],
    desc: '阶层、阶层特权与议程',
    descEn: 'Estates, estate privileges and agendas',
  },
  {
    id: 'disasters',
    zh: '灾难',
    en: 'Disasters',
    icon: '🔥',
    wiki: '灾难修改.html',
    match: ['common/disasters/'],
    desc: '灾难的触发条件、进程与结束效果',
    descEn: 'Disaster triggers, progress and end effects',
  },
  {
    id: 'ages',
    zh: '时代',
    en: 'Ages',
    icon: '⏳',
    wiki: '时代修改.html',
    match: ['common/ages/'],
    desc: '时代能力与时代定义',
    descEn: 'Age abilities and age definitions',
  },
  {
    id: 'modifiers',
    zh: '修正',
    en: 'Modifiers',
    icon: '✨',
    wiki: '修正修改.html',
    match: ['common/static_modifiers/', 'common/timed_modifiers/', 'common/event_modifiers/', 'common/triggered_modifiers/', 'common/province_triggered_modifiers/', 'common/opinion_modifiers/'],
    desc: '静态/事件/触发/观点修正',
    descEn: 'Static, event, triggered and opinion modifiers',
  },
  {
    id: 'scripted',
    zh: '脚本效果与条件',
    en: 'Scripted effects & triggers',
    icon: '🧩',
    wiki: 'Mod文件结构.html',
    match: ['common/scripted_effects/', 'common/scripted_triggers/', 'common/scripted_functions/'],
    desc: '可复用的脚本效果、触发条件与函数',
    descEn: 'Reusable scripted effects, triggers and functions',
  },
  {
    id: 'on_actions',
    zh: '行动指令',
    en: 'On actions',
    icon: '🔔',
    wiki: '事件修改.html',
    match: ['common/on_actions/'],
    desc: '游戏事件挂钩（on_actions）',
    descEn: 'Game event hooks (on_actions)',
  },
  {
    id: 'casusbelli',
    zh: '宣战理由与战争',
    en: 'Casus belli & war',
    icon: '📯',
    wiki: '宣战理由修改.html',
    match: ['common/cb_types/', 'common/wargoal_types/', 'common/peace_treaties/'],
    desc: '宣战理由、战争目标与和平条约',
    descEn: 'Casus belli, war goals and peace treaties',
  },
  {
    id: 'advisors',
    zh: '顾问',
    en: 'Advisors',
    icon: '🎓',
    wiki: '顾问修改.html',
    match: ['common/advisortypes/', 'history/advisors/'],
    desc: '顾问类型与历史顾问',
    descEn: 'Advisor types and historical advisors',
  },
  {
    id: 'great_projects',
    zh: '伟大工程',
    en: 'Great projects',
    icon: '🏛️',
    wiki: '伟大工程修改.html',
    match: ['common/great_projects/'],
    desc: '伟大工程及其阶段效果',
    descEn: 'Great projects and their stage effects',
  },
  {
    id: 'rebels',
    zh: '叛军',
    en: 'Rebels',
    icon: '🏴',
    wiki: '叛军修改.html',
    match: ['common/rebel_types/', 'common/revolt_triggers/'],
    desc: '叛军类型与叛乱触发',
    descEn: 'Rebel types and revolt triggers',
  },
  {
    id: 'bookmarks',
    zh: '书签与开局',
    en: 'Bookmarks',
    icon: '📖',
    wiki: '书签修改.html',
    match: ['common/bookmarks/'],
    desc: '开局书签与起始剧本',
    descEn: 'Start bookmarks and scenarios',
  },
  {
    id: 'history',
    zh: '历史',
    en: 'History',
    icon: '📅',
    wiki: '历史修改.html',
    match: ['history/'],
    desc: '国家、省份、外交与战争历史',
    descEn: 'Country, province, diplomacy and war history',
  },
  {
    id: 'localisation',
    zh: '本地化',
    en: 'Localisation',
    icon: '🔤',
    wiki: '本地化.html',
    match: ['localisation/', 'localization/', 'customizable_localization/', 'localisation_zh_optional/'],
    desc: '文本与翻译；支持 EU4 转义编码自动解码',
    descEn: 'Text and translations; EU4 escape encoding is decoded automatically',
  },
  {
    id: 'interface',
    zh: '界面与 GUI',
    en: 'Interface',
    icon: '🖥️',
    wiki: '界面修改.html',
    match: ['interface/', 'common/custom_gui/'],
    desc: 'GUI 布局、精灵定义与自定义窗口',
    descEn: 'GUI layouts, sprite definitions and custom windows',
  },
  {
    id: 'gfx',
    zh: '图形与模型',
    en: 'Graphics',
    icon: '🎨',
    wiki: '贴图库修改.html',
    match: ['gfx/'],
    desc: '贴图、模型、旗帜、字体与特效',
    descEn: 'Textures, models, flags, fonts and effects',
  },
  {
    id: 'audio',
    zh: '音乐与音效',
    en: 'Music & sound',
    icon: '🎵',
    wiki: '音乐修改.html',
    match: ['music/', 'sound/'],
    desc: '音乐与音效资源',
    descEn: 'Music and sound assets',
  },
  {
    id: 'dlc',
    zh: 'DLC 元数据',
    en: 'DLC metadata',
    icon: '📦',
    wiki: 'DLC.html',
    match: ['dlc/', 'dlc_metadata/', 'ebook/'],
    desc: 'DLC 与配套元数据',
    descEn: 'DLC and companion metadata',
  },
  {
    id: 'setup',
    zh: '模组定义',
    en: 'Mod definition',
    icon: '📄',
    wiki: 'Mod文件结构.html',
    match: [],
    fileMatch: ['descriptor.mod', 'thumbnail.png'],
    desc: '模组描述文件与封面',
    descEn: 'Mod descriptor and thumbnail',
  },
];

const FALLBACK = {
  id: 'other',
  zh: '其他改动',
  en: 'Other',
  icon: '📁',
  wiki: 'Mod文件结构.html',
  desc: '未归类的改动',
    descEn: 'Uncategorised changes',
};

// Directories that hold binary assets; we surface them but never parse them.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.bmp', '.tga', '.dds', '.gif',
  '.ogg', '.wav', '.mp3',
  '.mesh', '.anim', '.asset', '.bin', '.exe', '.dll',
  '.ttf', '.otf', '.fnt', '.zip', '.7z', '.pdf',
]);

const TEXT_EXT = new Set(['.txt', '.yml', '.yaml', '.csv', '.gui', '.gfx', '.lua', '.md', '.json', '.mod']);

/** Longest-prefix match of a mod-relative path against the taxonomy. */
function classify(relPath) {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  const base = p.split('/').pop();

  let best = null;
  let bestLen = -1;

  for (const cat of CATEGORIES) {
    for (const prefix of cat.match) {
      const pl = prefix.toLowerCase();
      // "history/" must not shadow "history/countries/"
      if (p.startsWith(pl) || p + '/' === pl) {
        if (pl.length > bestLen) { best = cat; bestLen = pl.length; }
      }
    }
    if (cat.fileMatch) {
      for (const fm of cat.fileMatch) {
        if (base === fm.toLowerCase() && bestLen < 0) best = cat;
      }
    }
  }

  return best || FALLBACK;
}

function isBinary(relPath) {
  const p = relPath.toLowerCase();
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = p.slice(dot);
  if (TEXT_EXT.has(ext)) return false;
  return BINARY_EXT.has(ext);
}

function isText(relPath) {
  const p = relPath.toLowerCase();
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXT.has(p.slice(dot));
}

/** Which parser should handle this file. */
function parserKind(relPath) {
  const p = relPath.toLowerCase();
  if (/\.(yml|yaml)$/.test(p)) return 'localisation';
  if (/\.csv$/.test(p)) return 'csv';
  if (/\.mod$/.test(p)) return 'descriptor';
  if (/\.(txt|gui|gfx|lua)$/.test(p)) return 'script';
  return 'none';
}

module.exports = {
  CATEGORIES,
  FALLBACK,
  BINARY_EXT,
  TEXT_EXT,
  classify,
  isBinary,
  isText,
  parserKind,
};
