'use strict';
/**
 * Historical rulers, leaders, battles and advisors.
 *
 * Four things a mod's history files describe person by person, and the four
 * the wiki-style browser is expected to show as a game-like card:
 *
 *   `history/countries/*.txt`   `monarch` / `heir` / `queen` / `monarch_consort`
 *                              blocks inside a dated block, each of which may
 *                              carry a nested `leader` block (a ruler who also
 *                              commands an army), plus free-standing `leader`
 *                              blocks.
 *   `history/wars/*.txt`        a `battle` block inside a dated block: the two
 *                              sides, their commanders, their troops, their
 *                              losses, and `result` — who won.
 *   `history/advisors/*.txt`    top-level `advisor` blocks, each with the
 *                              province he appears in, his skill, his type and
 *                              the date he becomes available.
 *
 * Everything here is read straight out of the mod's own files: nothing is
 * inferred and nothing is machine-translated. A ruler's `name` is a *literal*
 * in these files (a mod may instead point it at a localisation key), so the
 * card shows the literal text and only records a script↔localisation
 * correspondence row when the value really is a key.
 *
 * ---------------------------------------------------------------------------
 * Why the ids look the way they do
 * ---------------------------------------------------------------------------
 * A history file has no identifiers of its own, so one has to be built from
 * the position of the block: `<tag>@<date>@<slot>` for a ruler,
 * `<ruler id>.leader` for the leader nested in it, `<tag>@<date>@leader` for a
 * free-standing one, `<war file>@<date>#<n>` for a battle and
 * `<advisors file>@<n>` for the n-th advisor of an advisors file. Repeating any
 * of those inside one file appends `#2`, `#3`… Building the id from the block's
 * position means the card can be built again later by walking to the same
 * position, which `locateNode()` does — no parsed block is cached on the ref,
 * so an index stays small enough to keep a whole mod in memory.
 *
 * A ruler's dated block is the day the game applies it (the day he takes the
 * throne), not the day he dies: `1370.1.1 = { monarch = { … } }` means "from
 * 1370 the monarch is this one", which is also how the country timeline in the
 * `countries` tab reads.
 */

const { getEntry, scalarValue } = require('../codec/script.js');
const c = require('./common.js');
const terms = require('../gameterms.js');

const {
  L, pick, makeRef, makeLocRefs, contentCtx, kindLabel, fileStem, cleanTitle, underPrefix, stateLabel,
  usesRawTerms,
} = c;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTRY_DIR = 'history/countries/';
const WAR_DIR = 'history/wars/';
const ADVISOR_DIR = 'history/advisors/';

/** Land and naval units, the two sets a battle's per-side total is built from. */
const LAND_UNITS = ['infantry', 'cavalry', 'artillery'];
const SEA_UNITS = ['heavy_ship', 'light_ship', 'galley'];

/** The four ruler slots the game accepts in a country's history. */
const RULER_SLOTS = ['monarch', 'heir', 'queen', 'monarch_consort'];

/** The ruler slots that map onto a `kind` with its own label. */
const SLOT_KIND = {
  monarch: 'monarch',
  heir: 'heir',
  queen: 'consort',
  monarch_consort: 'consort',
};

/** `type = …` on a leader block; anything else falls back to `general`. */
const LEADER_TYPES = new Set(['general', 'admiral', 'explorer', 'conquistador']);

/** Monarch power, in the game's own order. */
const RULER_PIPS = ['adm', 'dip', 'mil'];
/** Leader pips, in the game's own order (and the game's own misspelling). */
const LEADER_PIPS = ['fire', 'shock', 'manuever', 'siege'];
/** Ruler and leader pips are 0…6 in every vanilla and modded file we have seen. */
const PIP_MAX = 6;
/** An advisor's `skill` is 1…3, and the game prints it as a level. */
const ADVISOR_MAX = 3;

/** A hard ceiling per list, so a pathological mod cannot exhaust memory. */
const MAX_ROWS = 20000;

const DATE_RE = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/;
/** A tag is three characters of `A–Z`/`0–9`, as in `common/country_tags/`. */
const TAG_RE = /^[A-Z0-9]{3}$/;
/**
 * A localisation key is a single identifier-shaped token. Used to decide
 * whether a `name = "…"` value is a key or literal text: a ruler really named
 * `Charles V` must not be looked up as the key `Charles V`, while a mod that
 * writes `name = "MNG_ruler_5_name"` does want the lookup.
 */
const LOC_KEY_RE = /^[A-Za-z0-9_.\-]{2,}$/;

/** Keys of a ruler block that are shown as something other than a plain field. */
const RULER_SPECIAL = new Set([
  'name', 'adm', 'dip', 'mil', 'leader', 'personality', 'trait',
]);

/** Labels this file needs that no shared table already carries. */
const HIST_LABEL = {
  date: L('日期', 'Date'),
  pipsRuler: L('君主能力', 'Monarch skills'),
  pipsLeader: L('将领能力', 'Leader skills'),
  traits: L('特质', 'Traits'),
  other: L('同一日期块中的其他改动', 'Other changes in the same dated block'),
  asLeader: L('该君主同时是一名将领', 'This ruler is also a military leader'),
  battlefield: L('战场', 'Battlefield'),
  attacker: L('进攻方', 'Attacker'),
  defender: L('防守方', 'Defender'),
  troops: L('兵力', 'Troops'),
  total: L('合计', 'Total'),
  war: L('所属战争', 'War'),
  warGoal: L('战争目标 war_goal', 'War goal'),
  unnamed: L('（未命名）', '(unnamed)'),
  // `result = yes|no` is who won, not a "show the result" switch: checked
  // against the battles whose outcome is a matter of record (El Bruc, Cabezón,
  // Zaragoza…), `yes` is the attacker's victory and `no` the defender's.
  outcome: L('战役结果', 'Outcome'),
  attackerWon: L('进攻方获胜', 'The attacker won'),
  defenderWon: L('防守方获胜', 'The defender won'),
  // The game's own battle lines: WAR_OVERVIEW_BATTLE_VS_L (land), _VS_N (naval)
  // and _VS (no unit counts on record). `{n1}`/`{tag1}` are the attacker's, and
  // the number's position differs per language, so these are templates.
  lineLand: L('{tag1} 的 {n1} 名士兵 攻击了 {tag2} 的 {n2} 名士兵',
    '{n1} {tag1} soldiers attacked {n2} {tag2} soldiers'),
  lineSea: L('{tag1} 的 {n1} 艘船 与 {tag2} 的 {n2} 艘船 交战',
    'A fleet of {n1} ships flying the flag of {tag1} engaged {n2} {tag2} ships'),
  lineUnits: L('{tag1} 以 {n1} 个单位 攻击了 {tag2} 的 {n2} 个单位',
    '{tag1} attacked with {n1} units against {n2} units of {tag2}'),
  noTroops: L('该战役未记载兵力数量。', 'This battle records no unit counts.'),
  lossNote: L('游戏记录的是该方兵力的损失百分比，不是人数。',
    'The files record this as a percentage of that side\'s strength, not a head count.'),
  // Advisors: `date` is the day he starts being offered, `death_date` the day
  // he stops — neither is a birthday, and the block itself is not dated.
  appointed: L('可用日期', 'Available from'),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The country tag a `history/countries` filename belongs to. */
function tagOf(rel) {
  const stem = fileStem(rel);
  const first = stem.split(' - ')[0].trim().toUpperCase();
  return TAG_RE.test(first) ? first : first;
}

/**
 * Every dated block of a history file, with the occurrence index of that date.
 *
 * A file may repeat a date key — the engine applies both blocks in order, and
 * 64 of them do it in the mod this was written against — so the index of the
 * *block* is what makes it identifiable again, and the occurrence of the *date*
 * is what keeps the two ids apart.
 */
function eachDatedBlock(tree, fn) {
  const byDate = new Map();
  let dateIdx = -1;
  for (const e of tree.entries) {
    if (e.value.type !== 'object') continue;
    if (!DATE_RE.test(e.key)) continue;
    dateIdx++;
    const nth = byDate.get(e.key) || 0;
    byDate.set(e.key, nth + 1);
    fn(e.key, dateIdx, e.value, nth);
  }
}

/** The undated top level of a file, read as one pseudo block. */
function topLevelBlock(tree) {
  return { type: 'object', entries: tree.entries.filter((e) => e.value.type === 'object') };
}

/** Both kinds of block, in file order: every dated block, then the top level. */
function eachBlock(tree, fn) {
  eachDatedBlock(tree, fn);
  const top = topLevelBlock(tree);
  if (top.entries.length) fn(null, -1, top, 0);
}

/** The `#n` suffix an id gets for its 2nd, 3rd… occurrence. */
function occSuffix(idx) {
  return idx > 0 ? '#' + (idx + 1) : '';
}

/**
 * The `#n` a *date* gets when a file repeats it, so `BYZ@1341.6.15#2@monarch` is
 * the monarch of the second `1341.6.15 = { … }` block in the Byzantine file.
 */
function dateSuffix(nth) {
  return occSuffix(nth);
}

function rulerBase(tag, date, slot, nth) {
  return tag + '@' + (date || '-') + dateSuffix(nth) + '@' + slot;
}

/**
 * The dated block a ref points into: the `dateIdx`-th occurrence of `date`, or
 * the file's top level when the ref has no date.
 */
function dateContainer(tree, date, dateIdx) {
  if (!date) return tree;
  let n = -1;
  for (const e of tree.entries) {
    if (e.value.type !== 'object') continue;
    if (!DATE_RE.test(e.key)) continue;
    n++;
    if (e.key === date && n === dateIdx) return e.value;
  }
  return null;
}

/**
 * Walk a ref's `chain` again and return the block it names.
 *
 * The chain is one step per nested key — `[{monarch,0},{leader,0}]` for the
 * leader inside the first monarch block of that date — so a card is always
 * built from the mod's current file, never from a stale copy. A `dateIdx` below
 * zero means the block has no dated container at all (the undated top level of
 * a file, which is where every advisor lives), so the walk starts there.
 */
function locateNode(index, ref) {
  const tree = index.cache.tree(ref.file);
  if (!tree) return null;
  let node = ref.dateIdx < 0 ? tree : dateContainer(tree, ref.date, ref.dateIdx);
  if (!node) return null;
  let line = ref.line;
  for (const step of ref.chain || []) {
    let n = -1;
    let hit = null;
    for (const e of node.entries) {
      if (e.key !== step.key || e.value.type !== 'object') continue;
      n++;
      if (n === step.idx) { hit = e; break; }
    }
    if (!hit) return null;
    node = hit.value;
    line = hit.line;
  }
  return { node, line };
}

/**
 * A history `name` value: a localisation key when one exists, else literal text.
 *
 * Returns `{ nodes, key, title }`; `nodes` is what the card renders, `title` is
 * the flat text a list row shows. `LR` may be null while collecting, when no
 * correspondence table is being built.
 */
function historyName(index, LR, field, node, rawIn) {
  const raw = rawIn === undefined ? scalarValue(node) : rawIn;
  if (raw === null || raw === undefined || raw === '') return { nodes: null, key: null, title: null };
  const s = String(raw);
  if (LOC_KEY_RE.test(s) && index.resolver.has(s)) {
    const hit = index.resolver.lookup(s);
    const value = hit && hit.value ? hit.value : null;
    let nodes = null;
    if (LR) {
      nodes = LR.rich(field, s);
      if (!nodes) nodes = [{ t: 'text', s }];
    }
    return { nodes, key: s, title: value ? cleanTitle(terms.stripMarkup(value)) : s };
  }
  return { nodes: [{ t: 'text', s }], key: null, title: cleanTitle(s) };
}

/** The list-row title of a ref, from its own `name` field. */
function setTitle(index, type, ref, node) {
  const nm = historyName(index, null, 'name', null, scalarValue(getEntry(node, 'name')));
  index.titles.set(type + ':' + ref.id, nm.title || ref.note || ref.id);
}

/** The flat name of a block, used for a battle's `commander` and the like. */
function plainName(index, raw) {
  const nm = historyName(index, null, 'name', null, raw);
  return nm.title || (raw === null || raw === undefined ? null : String(raw));
}

/** `type = …` on a leader block, defaulting to `general` the way the game does. */
function leaderKind(node) {
  const t = (scalarValue(getEntry(node, 'type')) || '').toLowerCase();
  return LEADER_TYPES.has(t) ? t : 'general';
}

/**
 * A script number, or null when the field is absent or not numeric.
 *
 * `Number(scalarValue(…))` alone is a trap: `scalarValue` answers `null` for a
 * node it does not recognise and `Number(null)` is `0`, which would quietly
 * report every battle as having lost nothing.
 */
function numOf(node) {
  const s = scalarValue(node);
  if (s === null || s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 0…6 pips for the keys the block actually carries. */
function pipRows(node, keys, lang) {
  const rows = [];
  let max = PIP_MAX;
  for (const k of keys) {
    const e = getEntry(node, k);
    if (!e || e.type === 'object' || e.type === 'array') continue;
    const v = numOf(e);
    if (v === null) continue;
    if (v > max) max = v;
    rows.push({
      key: k,
      label: stateLabel(k, lang) || k,
      value: v,
      cls: k === 'manuever' ? 'maneuver' : k,
    });
  }
  return rows.length ? { max, rows } : null;
}

/**
 * `personality = …` entries as chips.
 *
 * The trait a general carries lives in `common/leader_personalities/` while a
 * ruler's lives in `common/ruler_personalities/`, so the link kind follows the
 * block the trait was found in rather than the identifier's spelling.
 */
function traitItems(node, ctx, kind) {
  const items = [];
  const seen = new Set();
  for (const e of node.entries) {
    if (e.key !== 'personality' && e.key !== 'trait') continue;
    if (e.value.type === 'object' || e.value.type === 'array') continue;
    const id = scalarValue(e.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item = { id, link: { kind, id } };
    const nm = terms.nameOf('personality', id, ctx);
    if (nm && nm !== id) item.name = [{ t: 'text', s: nm }];
    items.push(item);
  }
  return items;
}

/**
 * One field of a person block, with religion/culture/country resolved through
 * the mod's own localisation the way every other card resolves a name.
 */
function personField(index, LR, ctx, key, node, lang) {
  const NAME_KIND = { religion: 'religion', culture: 'culture', country_of_origin: 'tag' };
  const kind = NAME_KIND[key];
  const rec = c.fieldRecord(key, node, lang);
  if (kind) {
    const id = String(rec.value);
    const nm = terms.nameOf(kind, id, ctx);
    if (nm && nm !== id) {
      rec.value = nm;
      rec.id = id;
      if (kind === 'tag') rec.link = { kind: 'tag', id };
    }
  }
  return rec;
}

/** Fold the names resolved while rendering into the correspondence table. */
function foldUsed(LR, ctx) {
  const seen = new Set(LR.refs.map((r) => r.key));
  for (const u of ctx.used || []) {
    if (!u || !u.key || seen.has(u.key)) continue;
    seen.add(u.key);
    LR.refs.push({
      field: 'name', key: u.key, found: true,
      value: u.value, file: u.file, line: u.line, origin: u.origin,
    });
  }
}

/**
 * The rest of a dated block: everything that is not one of the slots this file
 * already turned into its own card. It is what else the mod does on that day,
 * and it reads through the effect glossary like any other effect list.
 */
function datedExtras(block, ctx) {
  if (!block) return [];
  const rest = block.entries.filter((e) => !RULER_SLOTS.includes(e.key) && e.key !== 'battle');
  if (!rest.length) return [];
  return terms.effectLines({ type: 'object', entries: rest }, ctx, { indent: 0 });
}

/** A person's card header, shared by rulers and leaders. */
function personCard(index, type, ref, found, lang, LR, ctx) {
  const nm = historyName(index, LR, 'name', getEntry(found.node, 'name'));
  const tag = ref.tag || null;
  const country = tag ? terms.nameOf('tag', tag, ctx) : null;
  return {
    type,
    id: ref.id,
    kind: ref.kind,
    kindLabel: ref.kind ? kindLabel(ref.kind, lang) : null,
    file: ref.file,
    line: found.line,
    sourceLine: found.line,
    nameKey: nm.key,
    name: nm.nodes,
    synthName: nm.nodes ? null : { zh: ref.id, en: ref.id },
    descKey: null,
    desc: null,
    date: ref.date || null,
    rulerSlot: ref.rulerSlot || null,
    tag,
    countryName: country || tag,
    fields: [],
    groups: [],
    links: [],
    pips: null,
    locRefs: LR.refs,
  };
}

/** The country chip every person card carries. */
function tagLink(card, ref, ctx) {
  if (!ref.tag) return;
  const label = terms.nameOf('tag', ref.tag, ctx) || ref.tag;
  card.links.push({ kind: 'tag', id: ref.tag, label });
}

/**
 * The label of a chip that points at another history item.
 *
 * A history item's name is the mod's own text and exists in no localisation
 * file, so it has no translation to look up. The house rule for that case is
 * `gameterms.nameOf`'s: outside Chinese the identifier itself is the label, so
 * an English or Korean reader sees `MNG@1368.1.23@monarch` — which is also what
 * makes the chip's target unambiguous — while Chinese keeps the mod's name.
 */
function chipLabel(index, type, id, lang, titleIn) {
  if (usesRawTerms(lang)) return id;
  return titleIn || index.titles.get(type + ':' + id) || id;
}

// ---------------------------------------------------------------------------
// Rulers
// ---------------------------------------------------------------------------

/** One `monarch`/`heir`/`queen`/`monarch_consort` block per dated entry. */
function collectRulers(index, files) {
  const list = (index.lists.monarchs = index.lists.monarchs || []);
  for (const rel of files) {
    if (!underPrefix(rel, [COUNTRY_DIR])) continue;
    if (list.length >= MAX_ROWS) break;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    const tag = tagOf(rel);
    eachBlock(tree, (date, dateIdx, block, nth) => {
      const seen = new Map();
      for (const e of block.entries) {
        if (!RULER_SLOTS.includes(e.key)) continue;
        if (e.value.type !== 'object') continue;
        const idx = seen.get(e.key) || 0;
        seen.set(e.key, idx + 1);
        if (list.length >= MAX_ROWS) return;
        const id = rulerBase(tag, date, e.key, nth) + occSuffix(idx);
        const ref = makeRef('monarchs', id, rel, e.line, {
          kind: SLOT_KIND[e.key] || 'monarch',
          // Named `rulerSlot`, not `slot`: a submission's `slot` is a *number*
          // the mission list prints, and the list row renders any `slot` it is
          // given as one.
          rulerSlot: e.key,
          tag,
          date: date || null,
          dateIdx,
          chain: [{ key: e.key, idx }],
          note: date ? tag + ' \u00b7 ' + date : tag,
        });
        list.push(ref);
        setTitle(index, 'monarchs', ref, e.value);
      }
    });
  }
}

/**
 * A leader block: the pips, the traits and the handful of dates the game reads.
 *
 * Shared by the `leaders` list and by the nested leader shown on a ruler's card.
 */
function leaderBody(index, node, LR, ctx, lang, id) {
  const kind = leaderKind(node);
  const fields = [];
  for (const e of node.entries) {
    if (e.value.type === 'object' || e.value.type === 'array') continue;
    if (e.key === 'name' || e.key === 'type' || e.key === 'personality' || e.key === 'trait') continue;
    if (LEADER_PIPS.includes(e.key)) continue;
    fields.push(c.fieldRecord(e.key, e.value, lang));
  }
  const nm = historyName(index, LR, 'name', getEntry(node, 'name'));
  return {
    id: id || null,
    kind,
    kindLabel: kindLabel(kind, lang),
    name: nm.nodes,
    nameKey: nm.key,
    pips: pipRows(node, LEADER_PIPS, lang),
    fields,
    traits: traitItems(node, ctx, 'leader_trait'),
    link: id ? { kind: 'leader', id } : null,
  };
}

/** Every ruler block of the mod, labelled the way the game window labels them. */
function buildRuler(index, ref, lang) {
  const found = locateNode(index, ref);
  if (!found) return null;
  const node = found.node;
  const LR = makeLocRefs(index.resolver, lang);
  const ctx = contentCtx(index, lang);
  ctx.used = [];
  const card = personCard(index, 'monarchs', ref, found, lang, LR, ctx);

  // Monarch power, the three numbers the game prints on the ruler's portrait.
  card.pips = pipRows(node, RULER_PIPS, lang);

  // Everything else the block says about the person.
  for (const e of node.entries) {
    if (RULER_SPECIAL.has(e.key)) continue;
    if (e.value.type === 'object') continue;
    if (e.value.type === 'array') { card.fields.push(c.fieldRecord(e.key, e.value, lang)); continue; }
    card.fields.push(personField(index, LR, ctx, e.key, e.value, lang));
  }
  if (!card.fields.length) card.fields = [];

  // Traits sit next to the pips, not in the settings table.
  const traits = traitItems(node, ctx, 'ruler_trait');
  if (traits.length) {
    card.groups.push({
      key: 'traits', role: 'list',
      label: pick(HIST_LABEL.traits, lang), items: traits,
    });
  }

  // A ruler who also commands troops carries a whole leader block, indexed as
  // its own item, so the card links to it instead of duplicating it silently.
  let leaderIdx = 0;
  for (const e of node.entries) {
    if (e.key !== 'leader' || e.value.type !== 'object') continue;
    const id = ref.id + '.leader' + occSuffix(leaderIdx);
    leaderIdx++;
    if (card.leader) break;
    card.leader = leaderBody(index, e.value, LR, ctx, lang, id);
    card.leader.label = pick(HIST_LABEL.asLeader, lang);
    // The leader is indexed in its own tab, so the chip names its target rather
    // than repeating an id the reader has never seen.
    card.links.push({ kind: 'leader', id, label: chipLabel(index, 'leaders', id, lang) });
  }

  // What else happens in the same dated block — the rest of that day's history.
  const block = dateContainer(index.cache.tree(ref.file), ref.date, ref.dateIdx < 0 ? 0 : ref.dateIdx);
  const lines = datedExtras(block, ctx);
  if (lines.length) {
    card.groups.push({
      key: 'dated', role: 'eff',
      label: pick(HIST_LABEL.other, lang), lines,
    });
  }

  tagLink(card, ref, ctx);
  foldUsed(LR, ctx);
  return card;
}

// ---------------------------------------------------------------------------
// Leaders
// ---------------------------------------------------------------------------

/**
 * Both places a leader can appear: its own `leader` block in a dated entry, and
 * the `leader` block nested inside a ruler's (a monarch-general or heir-general).
 *
 * The nested ones are indexed here as well as linked from the ruler's card, so
 * the `leaders` tab is a complete list rather than a partial one.
 */
function collectLeaders(index, files) {
  const list = (index.lists.leaders = index.lists.leaders || []);
  for (const rel of files) {
    if (!underPrefix(rel, [COUNTRY_DIR])) continue;
    if (list.length >= MAX_ROWS) break;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    const tag = tagOf(rel);
    eachBlock(tree, (date, dateIdx, block, nth) => {
      const seen = new Map();
      for (const e of block.entries) {
        if (e.value.type !== 'object') continue;
        const idx = seen.get(e.key) || 0;
        seen.set(e.key, idx + 1);
        const occ = occSuffix(idx);
        if (RULER_SLOTS.includes(e.key)) {
          // The ruler itself is the rulers collector's business; only its
          // nested `leader` child is a leader item, and its id is derived from
          // the ruler's so the two cards cross-link.
          const rulerId = rulerBase(tag, date, e.key, nth) + occ;
          let li = 0;
          for (const l of e.value.entries) {
            if (l.key !== 'leader' || l.value.type !== 'object') continue;
            const lid = rulerId + '.leader' + occSuffix(li);
            li++;
            if (list.length >= MAX_ROWS) return;
            const ref = makeRef('leaders', lid, rel, l.line, {
              kind: leaderKind(l.value),
              source: 'ruler',
              rulerId,
              rulerSlot: e.key,
              tag,
              date: date || null,
              dateIdx,
              chain: [{ key: e.key, idx }, { key: 'leader', idx: li - 1 }],
              note: (date ? tag + ' \u00b7 ' + date : tag),
            });
            list.push(ref);
            setTitle(index, 'leaders', ref, l.value);
          }
        } else if (e.key === 'leader') {
          if (list.length >= MAX_ROWS) return;
          const id = rulerBase(tag, date, 'leader', nth) + occ;
          const ref = makeRef('leaders', id, rel, e.line, {
            kind: leaderKind(e.value),
            source: 'country',
            tag,
            date: date || null,
            dateIdx,
            chain: [{ key: 'leader', idx }],
            note: (date ? tag + ' \u00b7 ' + date : tag),
          });
          list.push(ref);
          setTitle(index, 'leaders', ref, e.value);
        }
      }
    });
  }
}

function buildLeader(index, ref, lang) {
  const found = locateNode(index, ref);
  if (!found) return null;
  const LR = makeLocRefs(index.resolver, lang);
  const ctx = contentCtx(index, lang);
  ctx.used = [];
  const body = leaderBody(index, found.node, LR, ctx, lang, ref.id);
  const card = personCard(index, 'leaders', ref, found, lang, LR, ctx);
  // leaderBody() owns the name: it is the same lookup personCard() would do.
  card.name = body.name;
  card.nameKey = body.nameKey;
  card.synthName = body.name ? null : { zh: ref.id, en: ref.id };
  card.kind = body.kind;
  card.kindLabel = body.kindLabel;
  card.pips = body.pips;
  card.fields = body.fields;
  if (body.traits.length) {
    card.groups.push({
      key: 'traits', role: 'list',
      label: pick(HIST_LABEL.traits, lang), items: body.traits,
    });
  }
  if (ref.rulerId) {
    card.links.push({
      kind: 'ruler', id: ref.rulerId,
      label: chipLabel(index, 'monarchs', ref.rulerId, lang),
    });
    card.rulerId = ref.rulerId;
  }

  const block = dateContainer(index.cache.tree(ref.file), ref.date, ref.dateIdx < 0 ? 0 : ref.dateIdx);
  const lines = datedExtras(block, ctx);
  if (lines.length) {
    card.groups.push({
      key: 'dated', role: 'eff',
      label: pick(HIST_LABEL.other, lang), lines,
    });
  }

  tagLink(card, ref, ctx);
  foldUsed(LR, ctx);
  return card;
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

/**
 * One `battle` block per dated entry of `history/wars/*.txt`.
 *
 * `result` is who won: `yes` is the attacker's victory, `no` the defender's.
 * That reading is checked against the battles whose outcome is a matter of
 * record — El Bruc and Zaragoza (`no`: the French attacked and lost), Cabezón
 * (`yes`: the French attacked and won) — rather than taken from the wiki's
 * comment on the key, which describes the wrong thing.
 *
 * `losses` is a *percentage* of that side's strength, as the vanilla files
 * themselves say in a trailing `# percent` comment, so the card prints it with
 * a percent sign and never as a head count.
 */
function collectBattles(index, files) {
  const list = (index.lists.battles = index.lists.battles || []);
  for (const rel of files) {
    if (!underPrefix(rel, [WAR_DIR])) continue;
    if (list.length >= MAX_ROWS) break;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    const stem = fileStem(rel);
    const warTitle = plainName(index, scalarValue(getEntry(tree, 'name'))) || stem;
    eachBlock(tree, (date, dateIdx, block, nth) => {
      let n = 0;
      for (const e of block.entries) {
        if (e.key !== 'battle' || e.value.type !== 'object') continue;
        n++;
        if (list.length >= MAX_ROWS) return;
        const id = stem + '@' + (date || '-') + dateSuffix(nth) + '#' + n;
        const ref = makeRef('battles', id, rel, e.line, {
          kind: 'battle',
          tag: null,
          warId: stem,
          warTitle,
          date: date || null,
          dateIdx,
          chain: [{ key: 'battle', idx: n - 1 }],
          note: warTitle + (date ? ' \u00b7 ' + date : ''),
        });
        list.push(ref);
        setTitle(index, 'battles', ref, e.value);
      }
    });
  }
}

/**
 * A battle unit's label.
 *
 * `FIELD_LABEL` first: a battle's `infantry = 38000` is a count of men, while
 * `STATE_LABEL`'s "Infantry share" describes `common/units/*.txt`, where the
 * same key holds a fraction of a regiment.
 */
function unitLabel(key, lang) {
  const pair = terms.FIELD_LABEL[key];
  return pair ? pick(pair, lang) : key;
}

/** One side of a battle: who fought, under whom, with what, and what it lost. */
function battleSide(index, node, role, LR, ctx, lang) {
  const b = getEntry(node, role);
  if (!b || b.type !== 'object') return null;
  const tag = scalarValue(getEntry(b, 'country')) || null;
  const side = {
    role,
    label: pick(role === 'attacker' ? HIST_LABEL.attacker : HIST_LABEL.defender, lang),
    tag,
    countryName: tag ? (terms.nameOf('tag', tag, ctx) || tag) : null,
    link: tag ? { kind: 'tag', id: tag } : null,
    commander: null,
    commanderKey: null,
    troops: [],
    losses: null,
    total: 0,
    /** 'land' when the side is made of regiments, 'sea' when of ships. */
    unitKind: null,
    extra: [],
  };
  const cm = historyName(index, LR, role + '.commander', getEntry(b, 'commander'));
  side.commander = cm.nodes;
  side.commanderKey = cm.key;

  let land = 0;
  let sea = 0;
  for (const e of b.entries) {
    if (e.value.type === 'object' || e.value.type === 'array') continue;
    if (e.key === 'country' || e.key === 'commander') continue;
    // `e` is an entry; the scalar lives on its value node.
    const v = numOf(e.value);
    if (e.key === 'losses') {
      if (v !== null) side.losses = v;
      continue;
    }
    if (LAND_UNITS.includes(e.key) || SEA_UNITS.includes(e.key)) {
      if (v === null) continue;
      side.troops.push({ key: e.key, label: unitLabel(e.key, lang), value: v });
      side.total += v;
      if (SEA_UNITS.includes(e.key)) sea++;
      else land++;
      continue;
    }
    side.extra.push(c.fieldRecord(e.key, e.value, lang));
  }
  side.unitKind = !land && sea ? 'sea' : (land ? 'land' : null);
  return side;
}

/** `result` read as the winner, or null when the block does not say. */
function resultWinner(node) {
  const raw = scalarValue(getEntry(node, 'result'));
  if (raw === null || raw === undefined) return null;
  const v = String(raw).toLowerCase();
  if (v === 'yes' || v === 'true') return 'attacker';
  if (v === 'no' || v === 'false') return 'defender';
  return null;
}

/**
 * The game's own "N soldiers attacked M soldiers" line.
 *
 * It is a template plus its values rather than a finished sentence, because the
 * number and the country swap places between languages; the client formats the
 * numbers and substitutes them.
 */
function battleLine(att, def, lang) {
  if (!att || !def || !att.total || !def.total) return null;
  const kind = att.unitKind === 'sea' || def.unitKind === 'sea'
    ? 'sea'
    : (att.unitKind || def.unitKind || 'units');
  const tpl = kind === 'sea' ? HIST_LABEL.lineSea
    : kind === 'land' ? HIST_LABEL.lineLand : HIST_LABEL.lineUnits;
  return {
    kind,
    tpl: pick(tpl, lang),
    vars: {
      tag1: att.countryName || att.tag || '',
      n1: att.total,
      tag2: def.countryName || def.tag || '',
      n2: def.total,
    },
  };
}

function buildBattle(index, ref, lang) {
  const found = locateNode(index, ref);
  if (!found) return null;
  const node = found.node;
  const LR = makeLocRefs(index.resolver, lang);
  const ctx = contentCtx(index, lang);
  ctx.used = [];
  const nm = historyName(index, LR, 'name', getEntry(node, 'name'));

  // The province is named through the same localisation the map tab uses.
  const locNode = getEntry(node, 'location');
  const locId = locNode ? scalarValue(locNode) : null;
  const location = locId
    ? { id: String(locId), name: terms.nameOf('province', String(locId), ctx) || String(locId), link: null }
    : null;

  // `result` is rendered as the outcome, never as a field of its own.
  const fields = [];
  for (const e of node.entries) {
    if (e.value.type === 'object') continue;
    if (e.key === 'name' || e.key === 'location' || e.key === 'attacker' || e.key === 'defender') continue;
    if (e.key === 'result') continue;
    fields.push(c.fieldRecord(e.key, e.value, lang));
  }

  const attacker = battleSide(index, node, 'attacker', LR, ctx, lang);
  const defender = battleSide(index, node, 'defender', LR, ctx, lang);
  const winner = resultWinner(node);
  const line = battleLine(attacker, defender, lang);

  const card = {
    type: 'battles',
    id: ref.id,
    kind: 'battle',
    kindLabel: kindLabel('battle', lang),
    file: ref.file,
    line: found.line,
    sourceLine: found.line,
    nameKey: nm.key,
    name: nm.nodes,
    synthName: nm.nodes ? null : { zh: ref.id, en: ref.id },
    descKey: null,
    desc: null,
    date: ref.date || null,
    location,
    war: { id: ref.warId, name: ref.warTitle || ref.warId },
    // Who won, the way the war screen shows it, plus the game's own line.
    outcome: winner ? {
      winner,
      label: pick(winner === 'attacker' ? HIST_LABEL.attackerWon : HIST_LABEL.defenderWon, lang),
    } : null,
    outcomeLabel: pick(HIST_LABEL.outcome, lang),
    line,
    noTroops: line ? null : pick(HIST_LABEL.noTroops, lang),
    lossNote: pick(HIST_LABEL.lossNote, lang),
    sides: [attacker, defender],
    fields,
    groups: [],
    links: [{
      kind: 'war', id: ref.warId,
      label: chipLabel(index, 'countries', ref.warId, lang, ref.warTitle),
    }],
    locRefs: LR.refs,
  };

  const block = dateContainer(index.cache.tree(ref.file), ref.date, ref.dateIdx < 0 ? 0 : ref.dateIdx);
  const lines = datedExtras(block, ctx);
  if (lines.length) {
    card.groups.push({
      key: 'dated', role: 'eff',
      label: pick(HIST_LABEL.other, lang), lines,
    });
  }

  foldUsed(LR, ctx);
  return card;
}

// ---------------------------------------------------------------------------
// Advisors
// ---------------------------------------------------------------------------

/**
 * Every `advisor` block of `history/advisors/*.txt`.
 *
 * These are the odd one out: the block is *not* wrapped in a dated entry, and
 * the date lives inside it (`date = 1389.1.1` is the day the advisor becomes
 * available, `death_date` the day he stops being offerable). So the id is the
 * block's position in its file, `<file>@<n>`, which is also what makes the card
 * findable again by walking the same file.
 *
 * The tab is `hist_advisors`, not `advisors`: `common/advisortypes/*.txt`
 * already owns that name and lists advisor *definitions* — a different
 * question from "who was this man the game can offer you".
 */
function collectHistAdvisors(index, files) {
  const list = (index.lists.hist_advisors = index.lists.hist_advisors || []);
  for (const rel of files) {
    if (!underPrefix(rel, [ADVISOR_DIR])) continue;
    if (list.length >= MAX_ROWS) break;
    const tree = index.cache.tree(rel);
    if (!tree) continue;
    const stem = fileStem(rel);
    let n = 0;
    for (const e of tree.entries) {
      if (e.key !== 'advisor' || e.value.type !== 'object') continue;
      n++;
      if (list.length >= MAX_ROWS) break;
      const date = scalarValue(getEntry(e.value, 'date'));
      const ref = makeRef('hist_advisors', stem + '@' + n, rel, e.line, {
        kind: 'advisor',
        date: date || null,
        // No dated container: `locateNode` starts at the file's top level.
        dateIdx: -1,
        chain: [{ key: 'advisor', idx: n - 1 }],
        note: date ? date + ' \u00b7 ' + stem : stem,
      });
      list.push(ref);
      setTitle(index, 'hist_advisors', ref, e.value);
    }
  }
}

/**
 * An advisor: a name, the type of advice he gives, his skill, the province he
 * shows up in and the two dates the game reads.
 *
 * `type` is a localisation key of its own — `common/advisor_types` has no names
 * in it, the game prints `text_l_*.yml`'s `philosopher`, `theologian`… — so it
 * goes through the same resolver every other name does and needs no table here.
 */
function buildHistAdvisor(index, ref, lang) {
  const found = locateNode(index, ref);
  if (!found) return null;
  const node = found.node;
  const LR = makeLocRefs(index.resolver, lang);
  const ctx = contentCtx(index, lang);
  ctx.used = [];
  const card = personCard(index, 'hist_advisors', ref, found, lang, LR, ctx);
  card.kind = 'advisor';
  card.kindLabel = kindLabel('advisor', lang);

  const ty = historyName(index, LR, 'type', getEntry(node, 'type'));
  card.subKind = ty.nodes;
  card.subKindKey = ty.key;

  // `skill` is 1…3 levels; the same pips a ruler's skills use, on a 3-point
  // scale rather than the 6-point one (a modded file above 3 still fits).
  const skill = numOf(getEntry(node, 'skill'));
  if (skill !== null) {
    card.pips = {
      max: Math.max(ADVISOR_MAX, skill),
      rows: [{
        key: 'skill',
        label: pick(terms.FIELD_LABEL.skill, lang),
        value: skill,
        cls: 'skill',
      }],
    };
  }

  for (const e of node.entries) {
    if (e.key === 'name' || e.key === 'type' || e.key === 'skill') continue;
    if (e.value.type === 'object') continue;
    if (e.key === 'location') {
      const id = String(scalarValue(e.value));
      const nm = terms.nameOf('province', id, ctx);
      card.fields.push({
        key: 'location',
        label: pick(terms.FIELD_LABEL.location, lang),
        value: nm || id,
        id: nm && nm !== id ? id : undefined,
        tone: 'text',
      });
      continue;
    }
    if (e.key === 'date') {
      card.fields.push({
        key: 'date',
        label: pick(HIST_LABEL.appointed, lang),
        value: String(scalarValue(e.value) || ''),
        tone: 'text',
      });
      continue;
    }
    if (e.value.type === 'array') { card.fields.push(c.fieldRecord(e.key, e.value, lang)); continue; }
    card.fields.push(personField(index, LR, ctx, e.key, e.value, lang));
  }

  foldUsed(LR, ctx);
  return card;
}

// ---------------------------------------------------------------------------

module.exports = {
  collectRulers,
  buildRuler,
  collectLeaders,
  buildLeader,
  collectBattles,
  buildBattle,
  collectHistAdvisors,
  buildHistAdvisor,
  // Exported for the test suite.
  RULER_SLOTS,
  SLOT_KIND,
  LEADER_PIPS,
  LAND_UNITS,
  SEA_UNITS,
  ADVISOR_MAX,
  resultWinner,
  tagOf,
  locateNode,
};
