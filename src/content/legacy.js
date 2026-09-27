'use strict';
/**
 * The six content types the viewer shipped with, kept as-is.
 *
 * They live here rather than in `gamedata.js` so that the orchestrator stays a
 * pure registry: every content type — these six included — now provides a
 * `collect(index, files)` and a `build(index, ref, lang)`.
 *
 * Their card shapes are bespoke on purpose (the event window, the decision
 * tooltip, the idea group panel, the advisor list, the policy card), so unlike
 * the newer types they do not go through the generic engine.
 */

const { getEntry, scalarValue } = require('../codec/script.js');
const c = require('./common.js');
const terms = require('../gameterms.js');
const i18n = require('../i18n.js');

const {
  underPrefix, makeRef, isTruthy, cleanTitle, collectSimple,
  makeLocRefs, contentCtx, findEntry, findDecision,
} = c;
const { L, pick } = i18n;

const PREFIXES = {
  events: ['events/'],
  decisions: ['decisions/'],
  ideas: ['common/ideas/'],
  advisors: ['common/advisortypes/'],
  policies: ['common/policies/'],
  eventModifiers: ['common/event_modifiers/'],
  estatePrivileges: ['common/estate_privileges/'],
  scriptedTriggers: ['common/scripted_triggers/'],
  scriptedEffects: ['common/scripted_effects/'],
};

/** Script block names that introduce an event. */
const EVENT_KEYS = new Set(['country_event', 'province_event', 'news_event', 'heir_event']);

const EVENT_TYPE = {
  country_event: L('国家事件', 'Country event'),
  province_event: L('省份事件', 'Province event'),
  news_event: L('新闻事件', 'News event'),
  heir_event: L('继承人事件', 'Heir event'),
};

/** Country-specific idea sets are keyed by TAG (e.g. `MNG_ideas`) or gated on a tag. */
function isNationalIdeas(key, node) {
  if (/^[A-Z]{3}_/.test(key)) return true;
  const trigger = getEntry(node, 'trigger');
  if (trigger && trigger.type === 'object') {
    for (const e of trigger.entries) {
      if (e.key === 'tag' || e.key === 'has_country_flag' || e.key === 'was_tag') return true;
      if (e.key === 'OR' || e.key === 'AND') {
        if (e.value.type === 'object' && e.value.entries.some((x) => x.key === 'tag')) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cross-reference targets (event modifiers, privileges, scripted effects)
// ---------------------------------------------------------------------------

function collectCrossRefs(index, files) {
  for (const rel of files) {
    if (underPrefix(rel, PREFIXES.eventModifiers)) collectSimple(index, rel, 'modifiers');
    else if (underPrefix(rel, PREFIXES.estatePrivileges)) collectSimple(index, rel, 'privileges');
    else if (underPrefix(rel, PREFIXES.scriptedTriggers)) collectSimple(index, rel, 'scriptedTriggers');
    else if (underPrefix(rel, PREFIXES.scriptedEffects)) collectSimple(index, rel, 'scriptedEffects');
  }
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function collectEvents(index, files) {
  for (const rel of files) {
    if (!underPrefix(rel, PREFIXES.events)) continue;
    const tree = index.cache.tree(rel);
    if (!tree) { index.errors.push({ file: rel, error: 'unreadable' }); continue; }
    index.counters.events = (index.counters.events || 0) + 1;
    for (const e of tree.entries) {
      if (!EVENT_KEYS.has(e.key) || e.value.type !== 'object') continue;
      const id = scalarValue(getEntry(e.value, 'id'));
      if (!id) continue;
      const ref = makeRef('events', id, rel, e.line, {
        eventType: e.key,
        eventTypeZh: pick(EVENT_TYPE[e.key], 'zh') || e.key,
        titleKey: scalarValue(getEntry(e.value, 'title')) || `${id}.t`,
        descKey: scalarValue(getEntry(e.value, 'desc')) || `${id}.d`,
        picture: scalarValue(getEntry(e.value, 'picture')),
        hidden: isTruthy(getEntry(e.value, 'hidden')),
      });
      index.lists.events.push(ref);
      const title = index.resolver.text(ref.titleKey);
      if (title) index.eventTitles.set(id, cleanTitle(title));
    }
  }
}

function collectDecisions(index, files) {
  for (const rel of files) {
    if (!underPrefix(rel, PREFIXES.decisions)) continue;
    const tree = index.cache.tree(rel);
    if (!tree) { index.errors.push({ file: rel, error: 'unreadable' }); continue; }
    index.counters.decisions = (index.counters.decisions || 0) + 1;
    for (const wrapper of tree.entries) {
      if (wrapper.value.type !== 'object') continue;
      const isDecisionContainer = /decision/i.test(wrapper.key);
      const body = wrapper.value;
      const entries = isDecisionContainer ? body.entries : [{ key: wrapper.key, value: wrapper.value, line: wrapper.line }];
      for (const d of entries) {
        if (d.value.type !== 'object') continue;
        index.lists.decisions.push(makeRef('decisions', d.key, rel, d.line, {
          titleKey: `${d.key}_title`,
          descKey: `${d.key}_desc`,
          major: isTruthy(getEntry(d.value, 'major')),
        }));
      }
    }
  }
}

function collectIdeas(index, files) {
  for (const rel of files) {
    if (!underPrefix(rel, PREFIXES.ideas)) continue;
    const tree = index.cache.tree(rel);
    if (!tree) { index.errors.push({ file: rel, error: 'unreadable' }); continue; }
    index.counters.ideas = (index.counters.ideas || 0) + 1;
    for (const g of tree.entries) {
      if (g.value.type !== 'object') continue;
      const national = isNationalIdeas(g.key, g.value);
      const ref = makeRef(national ? 'national_ideas' : 'idea_groups', g.key, rel, g.line, { national });
      index.lists[national ? 'national_ideas' : 'idea_groups'].push(ref);
      const t = index.resolver.text(g.key);
      if (t) index.titles.set(ref.type + ':' + g.key, t);
    }
  }
}

function collectAdvisors(index, files) {
  for (const rel of files) {
    if (!underPrefix(rel, PREFIXES.advisors)) continue;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    index.counters.advisors = (index.counters.advisors || 0) + 1;
    for (const a of tree.entries) {
      if (a.value.type !== 'object') continue;
      index.lists.advisors.push(makeRef('advisors', a.key, rel, a.line, {
        monarchPower: scalarValue(getEntry(a.value, 'monarch_power')),
      }));
    }
  }
}

function collectPolicies(index, files) {
  for (const rel of files) {
    if (!underPrefix(rel, PREFIXES.policies)) continue;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    index.counters.policies = (index.counters.policies || 0) + 1;
    for (const p of tree.entries) {
      if (p.value.type !== 'object') continue;
      index.lists.policies.push(makeRef('policies', p.key, rel, p.line, {
        monarchPower: scalarValue(getEntry(p.value, 'monarch_power')),
      }));
    }
  }
}

/** Titles for the list rows; events already carry theirs. */
function collectLegacyTitles(index) {
  for (const list of ['decisions', 'idea_groups', 'national_ideas', 'advisors', 'policies']) {
    for (const ref of index.lists[list] || []) {
      const key = ref.titleKey || (list === 'decisions' ? `${ref.id}_title` : ref.id);
      const t = index.resolver.text(key) || index.resolver.text(ref.id) || index.resolver.text(`${ref.id}_title`);
      if (t) index.titles.set(list + ':' + ref.id, cleanTitle(t));
    }
  }
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

function buildEventCard(index, ref, lang) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const found = findEntry(tree, ref.id, EVENT_KEYS);
  if (!found) return null;
  const node = found.value;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);

  const titleKey = scalarValue(getEntry(node, 'title')) || `${ref.id}.t`;
  const descKey = scalarValue(getEntry(node, 'desc')) || `${ref.id}.d`;

  const options = [];
  let n = 0;
  for (const e of node.entries) {
    if (e.key !== 'option' || e.value.type !== 'object') continue;
    n++;
    const letter = String.fromCharCode(96 + n);      // a, b, c…
    const nameKey = scalarValue(getEntry(e.value, 'name')) || `${ref.id}.${letter}`;
    const effects = e.value.entries.filter((x) => !['name', 'ai_chance', 'trigger', 'highlight', 'hidden'].includes(x.key));
    const effectsNode = { type: 'object', entries: effects };
    const aiChance = getEntry(e.value, 'ai_chance');
    options.push({
      index: n,
      letter,
      nameKey,
      name: L.rich(`option.${letter}.name`, nameKey),
      effects: terms.effectLines(effectsNode, ctx, { indent: 0 }),
      aiChance: aiChance ? terms.effectLines(aiChance, ctx, { indent: 0 }) : [],
    });
  }

  const mtthNode = getEntry(node, 'mtth') || getEntry(node, 'mean_time_to_happen');
  let mtth = null;
  if (mtthNode && mtthNode.type === 'object') {
    for (const unit of ['days', 'months', 'years']) {
      const v = getEntry(mtthNode, unit);
      if (v) { mtth = { unit, value: scalarValue(v) }; break; }
    }
  }

  return {
    type: 'events',
    id: ref.id,
    eventType: ref.eventType,
    eventTypeZh: pick(EVENT_TYPE[ref.eventType], lang) || ref.eventTypeZh,
    file: ref.file,
    line: ref.line,
    titleKey,
    title: L.rich('title', titleKey),
    descKey,
    desc: L.rich('desc', descKey),
    picture: ref.picture || null,
    flags: {
      hidden: isTruthy(getEntry(node, 'hidden')),
      fireOnlyOnce: isTruthy(getEntry(node, 'fire_only_once')),
      major: isTruthy(getEntry(node, 'major')),
      isTriggeredOnly: isTruthy(getEntry(node, 'is_triggered_only')),
    },
    mtth,
    conditions: terms.conditionLines(getEntry(node, 'trigger'), ctx, { indent: 0 }),
    immediate: terms.effectLines(getEntry(node, 'immediate'), ctx, { indent: 0 }),
    after: terms.effectLines(getEntry(node, 'after'), ctx, { indent: 0 }),
    options,
    locRefs: L.refs,
    sourceLine: found.line,
  };
}

function buildDecisionCard(index, ref, lang) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const found = findDecision(tree, ref.id);
  if (!found) return null;
  const node = found.value;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);

  const titleKey = `${ref.id}_title`;
  const descKey = `${ref.id}_desc`;

  return {
    type: 'decisions',
    id: ref.id,
    file: ref.file,
    line: found.line,
    titleKey,
    title: L.rich('title', titleKey),
    descKey,
    desc: L.rich('desc', descKey),
    major: isTruthy(getEntry(node, 'major')),
    monarchPower: scalarValue(getEntry(node, 'monarch_power')),
    potential: terms.conditionLines(getEntry(node, 'potential'), ctx, { indent: 0 }),
    allow: terms.conditionLines(getEntry(node, 'allow'), ctx, { indent: 0 }),
    effect: terms.effectLines(getEntry(node, 'effect'), ctx, { indent: 0 }),
    aiWillDo: terms.effectLines(getEntry(node, 'ai_will_do'), ctx, { indent: 0 }),
    locRefs: L.refs,
  };
}

function buildIdeaCard(index, ref, lang) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const group = getEntry(tree, ref.id);
  if (!group || group.type !== 'object') return null;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);

  const startKey = `${ref.id}_start`;
  const bonusKey = `${ref.id}_bonus`;

  const ideas = [];
  for (const e of group.entries) {
    if (e.value.type !== 'object') continue;
    if (['start', 'bonus', 'trigger', 'potential', 'allow', 'ai_will_do'].includes(e.key)) continue;
    ideas.push({
      id: e.key,
      nameKey: e.key,
      name: L.rich(`idea.${e.key}`, e.key),
      descKey: `${e.key}_desc`,
      desc: L.rich(`idea.${e.key}.desc`, `${e.key}_desc`),
      mods: terms.modifierLines(e.value, ctx, { indent: 0 }),
      line: e.line,
    });
  }

  return {
    type: ref.type,
    id: ref.id,
    isNational: !!ref.national,
    file: ref.file,
    line: ref.line,
    nameKey: ref.id,
    name: L.rich('name', ref.id),
    startKey,
    startName: L.rich('start', startKey),
    bonusKey,
    bonusName: L.rich('bonus', bonusKey),
    traditions: terms.modifierLines(getEntry(group, 'start'), ctx, { indent: 0 }),
    ambition: terms.modifierLines(getEntry(group, 'bonus'), ctx, { indent: 0 }),
    trigger: terms.conditionLines(getEntry(group, 'trigger'), ctx, { indent: 0 }),
    ideas,
    locRefs: L.refs,
  };
}

function buildAdvisorCard(index, ref, lang) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const node = getEntry(tree, ref.id);
  if (!node || node.type !== 'object') return null;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);

  const modsNode = { type: 'object', entries: node.entries.filter((e) => e.value.type !== 'object' && e.value.type !== 'array') };
  const skillScaled = [];
  for (const e of node.entries) {
    if (e.key !== 'skill_scaled_modifier' || e.value.type !== 'object') continue;
    skillScaled.push({
      trigger: terms.conditionLines(getEntry(e.value, 'trigger'), ctx, { indent: 0 }),
      mods: terms.modifierLines(getEntry(e.value, 'modifier'), ctx, { indent: 0 }),
    });
  }

  return {
    type: 'advisors',
    id: ref.id,
    file: ref.file,
    line: ref.line,
    nameKey: ref.id,
    name: L.rich('name', ref.id),
    descKey: `${ref.id}_desc`,
    desc: L.rich('desc', `${ref.id}_desc`),
    monarchPower: scalarValue(getEntry(node, 'monarch_power')),
    mods: terms.modifierLines(modsNode, ctx, { indent: 0 }),
    skillScaled,
    allowOnlyMale: scalarValue(getEntry(node, 'allow_only_male')),
    allowOnlyFemale: scalarValue(getEntry(node, 'allow_only_female')),
    chance: terms.effectLines(getEntry(node, 'chance'), ctx, { indent: 0 }),
    locRefs: L.refs,
  };
}

function buildPolicyCard(index, ref, lang) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  const node = getEntry(tree, ref.id);
  if (!node || node.type !== 'object') return null;
  const resolver = index.resolver;
  const L = makeLocRefs(resolver, lang);
  const ctx = contentCtx(index, lang);

  const modsNode = { type: 'object', entries: node.entries.filter((e) => e.value.type !== 'object' && e.value.type !== 'array') };

  // A policy's description key is a *prefix*: `desc_<id>`, unlike every other
  // content type, which uses the `_desc` suffix. Verified against vanilla
  // (203/203) and this mod (134/135).
  const descKey = resolver.has(`desc_${ref.id}`) ? `desc_${ref.id}` : `${ref.id}_desc`;

  return {
    type: 'policies',
    id: ref.id,
    file: ref.file,
    line: ref.line,
    nameKey: ref.id,
    name: L.rich('name', ref.id),
    descKey,
    desc: L.rich('desc', descKey),
    monarchPower: scalarValue(getEntry(node, 'monarch_power')),
    mods: terms.modifierLines(modsNode, ctx, { indent: 0 }),
    potential: terms.conditionLines(getEntry(node, 'potential'), ctx, { indent: 0 }),
    allow: terms.conditionLines(getEntry(node, 'allow'), ctx, { indent: 0 }),
    locRefs: L.refs,
  };
}

// ---------------------------------------------------------------------------

const TYPES = [
  { id: 'events', collect: collectEvents, build: buildEventCard },
  { id: 'decisions', collect: collectDecisions, build: buildDecisionCard },
  { id: 'idea_groups', collect: collectIdeas, build: buildIdeaCard },
  // National ideas live in the same files as idea groups; the collector above
  // fills both lists, so this entry only contributes a list and a builder.
  { id: 'national_ideas', collect: null, build: buildIdeaCard },
  { id: 'advisors', collect: collectAdvisors, build: buildAdvisorCard },
  { id: 'policies', collect: collectPolicies, build: buildPolicyCard },
];

module.exports = {
  PREFIXES,
  EVENT_KEYS,
  EVENT_TYPE,
  TYPES,
  collectCrossRefs,
  collectLegacyTitles,
  isNationalIdeas,
};
