'use strict';
/**
 * Content model orchestrator.
 *
 * Turns a mod's script files plus its localisation into "cards" shaped like the
 * panels the game itself shows. All the per-type knowledge lives in
 * `src/content/`:
 *
 *   legacy.js    the six bespoke types the viewer shipped with
 *   registry.js  the declarative descriptors for everything else
 *   common.js    the shared helpers and the generic card engine
 *
 * This module only wires them together: it owns the type order (which is the tab
 * order in the UI), the merged type metadata, the lazy per-mod index cache and
 * the dispatch from a `(type, id)` request to a card.
 *
 * Every card also carries `locRefs`: the script value → localisation key → text
 * → file:line chain, so the reader can see exactly which localisation file feeds
 * each on-screen string.
 *
 * The index is deliberately light (id + localisation keys + file/line). The full
 * card for one item is built on demand by re-parsing just that file, which keeps
 * memory flat on a mod with tens of thousands of files.
 */

const common = require('./content/common.js');
const legacy = require('./content/legacy.js');
const registry = require('./content/registry.js');
const wiki = require('./wiki.js');
const gameloc = require('./gameloc.js');

const { L, pick } = require('./i18n.js');

const { FileCache, buildGenericCard } = common;

/**
 * Tab order. Grouped so that ~30 tabs stay navigable: the UI shows one group of
 * tabs at a time, and this array is the order within and across groups.
 */
const TYPE_ORDER = [
  // Content
  'events', 'decisions', 'mission_trees', 'missions', 'idea_groups', 'national_ideas', 'advisors', 'policies',
  // Country
  'countries', 'government', 'ruler_traits', 'parliament', 'estates', 'rebels', 'disasters', 'ages', 'great_projects',
  // Religion & economy
  'religion', 'culture', 'buildings', 'trade',
  // Military
  'units', 'leader_traits', 'wars',
  // World
  'bookmarks', 'map', 'interface',
  // System
  'technology', 'modifiers', 'scripted', 'on_actions',
];

/** Metadata for the six original types (the newer ones carry it in registry.js). */
const LEGACY_META = {
  events: { zh: '事件', en: 'Events', icon: '📜', wiki: '事件修改', wikiEn: 'Event modding', category: 'events', group: 'content' },
  decisions: { zh: '决议', en: 'Decisions', icon: '⚖️', wiki: '决议修改', wikiEn: 'Decision modding', category: 'decisions', group: 'content' },
  idea_groups: { zh: '理念组', en: 'Idea groups', icon: '💡', wiki: '理念组修改', wikiEn: 'Idea group modding', category: 'ideas', group: 'content' },
  national_ideas: { zh: '国家理念', en: 'National ideas', icon: '🏛', wiki: '理念组修改', wikiEn: 'Idea group modding', category: 'ideas', group: 'content' },
  advisors: { zh: '顾问', en: 'Advisors', icon: '🎓', wiki: '顾问修改', wikiEn: 'Advisor modding', category: 'advisors', group: 'content' },
  policies: { zh: '政策', en: 'Policies', icon: '📜', wiki: '政策修改', wikiEn: 'Policy modding', category: 'policies', group: 'content' },
};

/** A Chinese offline-wiki page name, without the `.html` suffix. */
function offlinePage(category) {
  const pages = wiki.CATEGORY_PAGES[category];
  if (!pages || !pages.length) return null;
  return pages[0].replace(/\.html$/i, '');
}

/** The English wiki page title, verbatim from that wiki's Modding navbox. */
function onlinePage(category) {
  const rows = wiki.CATEGORY_PAGES_EN[category];
  if (!rows || !rows.length) return null;
  return rows[0][0];
}

/** Every content type, in tab order, with merged metadata. */
const ALL_TYPES = [];
const TYPE_BY_ID = new Map();

(function buildTypeTable() {
  const legacyById = new Map(legacy.TYPES.map((t) => [t.id, t]));
  const registryById = new Map(registry.TYPES.map((t) => [t.id, t]));
  for (const id of TYPE_ORDER) {
    const reg = registryById.get(id);
    const leg = legacyById.get(id);
    if (!reg && !leg) continue;
    const source = reg || leg;
    const meta = reg
      ? {
        zh: reg.meta.zh,
        en: reg.meta.en,
        icon: reg.meta.icon,
        wiki: offlinePage(reg.category),
        wikiEn: reg.meta.wikiEn || onlinePage(reg.category),
        wikiCategory: reg.category,
        wikiEnCategory: reg.category,
        group: reg.group,
      }
      : Object.assign({}, LEGACY_META[id]);
    const type = {
      id,
      group: meta.group,
      meta,
      collect: source.collect || null,
      build: source.build || null,
      spec: source.spec || null,
      legacy: !!leg,
    };
    ALL_TYPES.push(type);
    TYPE_BY_ID.set(id, type);
  }
})();

/** The `{typeId: meta}` map kept for API compatibility with earlier clients. */
const TYPE_META = {};
for (const t of ALL_TYPES) TYPE_META[t.id] = t.meta;

const GROUPS = registry.GROUPS;

// ---------------------------------------------------------------------------

/** Build the content index for a mod. */
function buildIndex(mod, installDir) {
  const resolver = gameloc.resolverFor(mod, installDir);
  const cache = new FileCache(mod);
  const started = Date.now();

  const index = {
    modId: mod.id,
    mod,
    installDir: installDir || null,
    resolver,
    cache,
    lists: {},
    titles: new Map(),          // `<type>:<id>` → plain title (from the mod's loc)
    synthTitles: new Map(),     // `<type>:<id>` → { zh, en } for non-loc titles
    eventTitles: new Map(),
    modifiers: new Map(),       // event_modifier name → { file, line }
    privileges: new Map(),
    scriptedTriggers: new Map(),
    scriptedEffects: new Map(),
    counters: {},               // folder prefix → file count
    files: {
      events: 0, decisions: 0, ideas: 0, advisors: 0, policies: 0,
      modifiers: 0, privileges: 0, scriptedTriggers: 0, scriptedEffects: 0,
    },
    errors: [],
    builtAt: null,
    buildMs: 0,
    stats: null,
  };

  for (const t of ALL_TYPES) index.lists[t.id] = [];

  const files = (mod.files || []).map((f) => f.rel).filter((r) => /\.(txt|gui)$/i.test(r));

  // Cross-reference targets first: event modifiers, estate privileges and
  // scripted effects are needed while rendering other types' cards.
  try { legacy.collectCrossRefs(index, files); } catch (e) { index.errors.push({ file: '<cross-refs>', error: String(e && e.message) }); }

  const skipCollect = new Set();
  for (const t of ALL_TYPES) {
    if (skipCollect.has(t.id)) continue;
    try {
      if (t.collect) t.collect(index, files);
      else if (t.spec) common.collectGeneric(index, files, t.spec, t.id);
    } catch (e) {
      index.errors.push({ file: '<' + t.id + '>', error: String(e && e.message) });
    }
    // The idea collector fills both idea lists.
    if (t.id === 'idea_groups') skipCollect.add('national_ideas');
  }

  try { legacy.collectLegacyTitles(index); } catch { /* titles are best-effort */ }

  index.builtAt = new Date().toISOString();
  index.buildMs = Date.now() - started;

  const byType = {};
  for (const t of ALL_TYPES) byType[t.id] = (index.lists[t.id] || []).length;

  index.stats = {
    events: byType.events || 0,
    decisions: byType.decisions || 0,
    ideaGroups: byType.idea_groups || 0,
    nationalIdeas: byType.national_ideas || 0,
    advisors: byType.advisors || 0,
    policies: byType.policies || 0,
    eventModifiers: index.modifiers.size,
    estatePrivileges: index.privileges.size,
    scriptedTriggers: index.scriptedTriggers.size,
    scriptedEffects: index.scriptedEffects.size,
    locModKeys: index.resolver.modIndex.size,
    buildMs: index.buildMs,
    byType,
    total: Object.values(byType).reduce((a, b) => a + b, 0),
  };
  return index;
}

/** The label for one type in one language. */
function typeLabel(type, lang) {
  const meta = TYPE_META[type];
  if (!meta) return type;
  return pick(meta, lang) || meta.zh || type;
}

/**
 * The ordered type list the UI renders its tabs from: id, both labels, icon,
 * wiki targets, group and the item count for this mod.
 */
function typeList(index, lang) {
  return ALL_TYPES.map((t) => ({
    id: t.id,
    label: typeLabel(t.id, lang),
    zh: t.meta.zh,
    en: t.meta.en,
    icon: t.meta.icon,
    group: t.group,
    wiki: t.meta.wiki,
    wikiEn: t.meta.wikiEn,
    count: (index && index.lists[t.id] ? index.lists[t.id].length : 0),
  }));
}

/** Group descriptors with their localised labels. */
function groupList(lang) {
  return GROUPS.map((g) => ({ id: g.id, label: pick(g, lang), zh: g.zh, en: g.en }));
}

/** The list-row title for an item, in the requested language. */
function listTitle(index, type, id, lang) {
  const synth = index.synthTitles.get(type + ':' + id);
  if (synth) return pick(synth, lang);
  return index.titles.get(type + ':' + id) || index.eventTitles.get(id) || null;
}

/** Build the full card for one item. */
function buildCard(index, type, id, lang) {
  const entry = TYPE_BY_ID.get(type);
  if (!entry) return null;
  if (!entry.build && !entry.spec) return null;
  const ref = (index.lists[type] || []).find((r) => r.id === id);
  if (!ref) return null;
  common.primeModifierDefs(index);
  const card = entry.build
    ? entry.build(index, ref, lang)
    : buildGenericCard(index, ref, lang, entry.spec);
  if (!card) return null;
  // The engine's default type-level fields.
  card.typeLabel = typeLabel(type, lang);
  if (card.type === 'events') {
    card.pictureUrl = card.picture ? common.resolveEventPicture(index, card.picture) : null;
  }
  return card;
}

module.exports = {
  TYPE_META,
  TYPE_ORDER,
  ALL_TYPES,
  GROUPS,
  EVENT_TYPE: legacy.EVENT_TYPE,
  PREFIXES: legacy.PREFIXES,
  buildIndex,
  buildCard,
  typeList,
  groupList,
  listTitle,
  typeLabel,
  kindLabel: common.kindLabel,
  spriteIndex: common.spriteIndex,
  resolveEventPicture: common.resolveEventPicture,
  resolveIcon: common.resolveIcon,
  resolveSprite: common.resolveSprite,
  L,
};
