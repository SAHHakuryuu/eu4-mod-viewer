'use strict';
/**
 * History types: rulers, leaders, battles and advisors.
 *
 * These types are the only ones whose items have no identifier in the source at
 * all — one is built from the block's position (`MNG@1368.1.23@monarch`) and has
 * to be resolved back to that same block every time the card is built. That
 * round trip is the thing worth testing: a ref that no longer resolves would
 * show up in the UI as an item that opens an empty panel, and a card that
 * resolves to the *wrong* block would silently show another person's dates.
 *
 * What is asserted:
 *   • the ids are unique per type, and the chain/locate round trip finds the
 *     block again for every single record;
 *   • every card builds, in Chinese and in one non-Chinese language, and no
 *     Chinese leaks into the English chrome;
 *   • a nested leader is indexed in the `leaders` list under exactly the id the
 *     ruler's card links to, and a battle's war id is a real `countries` item;
 *   • pips stay inside the scale the card declares, losses are reported exactly
 *     as the file writes them, and every localisation reference resolves (a
 *     history card only records one when it hit);
 *   • a battle's `result` is read as the winner and its two sides are added up
 *     the way the game's own line does, with the ships/regiments distinction
 *     the file's unit keys imply;
 *   • an advisor's type, skill, province and dates all come from his block.
 *
 * Usage: node tools/test-history.js [mod name substring]
 */

const modsSvc = require('../src/mods.js');
const gamedata = require('../src/gamedata.js');
const history = require('../src/content/history.js');
const script = require('../src/codec/script.js');

const WANT = process.argv[2] || '1.37 Celestial empire on which the sun never sets';
const DATE_RE = /^\d{1,4}\.\d{1,2}\.\d{1,2}$/;
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
/** How many cards to build per type: thousands of ruler cards would dominate. */
const CARD_BUDGET = 400;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? '  (' + detail + ')' : ''}`);
}

/** Every chrome `label` in a card (values are the mod's own data, labels are not). */
function labels(v, out = []) {
  if (Array.isArray(v)) { for (const x of v) labels(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'label' && typeof x === 'string') out.push(x);
      else labels(x, out);
    }
  }
  return out;
}

/** A spread sample, so the budget covers the whole list rather than its head. */
function sample(list, n) {
  if (list.length <= n) return list.slice();
  const step = list.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]);
  return out;
}

const userDir = modsSvc.findUserDir();
const installDir = modsSvc.findInstallDir();
const entry = modsSvc.listModDescriptors(userDir)
  .find((d) => (d.meta.name || '').includes(WANT) || d.root.includes(WANT));

(async () => {
  if (!entry) { console.error('mod not found: ' + WANT); process.exit(1); }
  const mod = await modsSvc.scanMod(entry);
  const started = Date.now();
  const index = gamedata.buildIndex(mod, installDir);
  console.log(`mod: ${mod.name}`);
  console.log(`index: ${index.buildMs} ms, ${index.errors.length} file errors`);

  // ---- the id scheme, as pure functions -----------------------------------
  check('tagOf reads the `TAG - Name.txt` convention',
    history.tagOf('history/countries/MNG - Ming.txt') === 'MNG',
    history.tagOf('history/countries/MNG - Ming.txt'));
  check('tagOf falls back to the whole stem',
    history.tagOf('history/countries/AM0 - AM0.txt') === 'AM0',
    history.tagOf('history/countries/AM0 - AM0.txt'));

  const wars = new Map((index.lists.countries || [])
    .filter((r) => r.kind === 'war')
    .map((r) => [r.id, r]));

  for (const type of ['monarchs', 'leaders', 'battles', 'hist_advisors']) {
    const list = index.lists[type] || [];
    check(`${type}: records indexed`, list.length > 0, `n=${list.length}`);
    check(`${type}: ids are unique`, new Set(list.map((r) => r.id)).size === list.length,
      `${list.length - new Set(list.map((r) => r.id)).size} duplicate id(s)`);

    // The round trip every card depends on.
    let resolved = 0;
    for (const ref of list) {
      const found = history.locateNode(index, ref);
      if (found && found.node) resolved++;
    }
    check(`${type}: every ref resolves back to its block`, resolved === list.length,
      `${resolved}/${list.length}`);

    // Dates and the list row.
    check(`${type}: every ref carries a date or the undated top level`,
      list.every((r) => r.date === null || DATE_RE.test(r.date)),
      (list.find((r) => r.date !== null && !DATE_RE.test(r.date)) || {}).date || '');
    check(`${type}: every ref carries a list-row note`, list.every((r) => !!r.note));
    for (const lang of ['zh', 'en']) {
      const missing = list.filter((r) => {
        const t = gamedata.listTitle(index, type, r.id, lang);
        return !t || !String(t).trim();
      });
      check(`${type}: every list row is titled in ${lang}`, missing.length === 0,
        missing.length ? `${missing.length} untitled, e.g. ${missing[0].id}` : '');
    }
  }

  // ---- cards --------------------------------------------------------------
  const leaderIds = new Set((index.lists.leaders || []).map((r) => r.id));
  const stats = { cards: 0, nested: 0, sides: 0, pips: 0, locRefs: 0 };
  let nullCards = 0;
  let badLink = 0;
  let badWar = 0;
  let badPips = 0;
  let unresolvedLoc = 0;
  let enLeak = 0;
  let badLoc = 0;

  for (const type of ['monarchs', 'leaders', 'battles', 'hist_advisors']) {
    for (const ref of sample(index.lists[type] || [], CARD_BUDGET)) {
      let card = null;
      try { card = gamedata.buildCard(index, type, ref.id, 'zh'); } catch { card = null; }
      if (!card) { nullCards++; continue; }
      stats.cards++;
      if (card.id !== ref.id || card.type !== type || !card.file) badLoc++;
      if (!Array.isArray(card.locRefs)) badLoc++;
      else {
        stats.locRefs += card.locRefs.length;
        unresolvedLoc += card.locRefs.filter((r) => !r.found).length;
      }

      // Pips are drawn against `max`, so a value above it would render as a
      // full row with a number that no row of dots can show.
      const pipSets = [card.pips, card.leader && card.leader.pips].filter(Boolean);
      for (const p of pipSets) {
        stats.pips++;
        if (!(p.max > 0)) badPips++;
        for (const row of p.rows) {
          if (!(row.value >= 0 && row.value <= p.max)) badPips++;
        }
      }

      // A battle's two sides and its province.
      if (type === 'battles') {
        stats.sides += (card.sides || []).filter(Boolean).length;
        if (card.war && card.war.id && !wars.has(card.war.id)) badWar++;
      }
      // A ruler who leads armies links to a leader item that must exist.
      if (card.leader) {
        stats.nested++;
        if (!leaderIds.has(card.leader.id)) badLink++;
      }
      for (const l of card.links || []) {
        if (l.kind === 'leader' && !leaderIds.has(l.id)) badLink++;
      }

      // English chrome must be English; the mod's own names are data.
      let en = null;
      try { en = gamedata.buildCard(index, type, ref.id, 'en'); } catch { en = null; }
      if (!en) nullCards++;
      else if (labels(en).some((s) => CJK.test(s))) enLeak++;
    }
  }

  console.log(`cards built: ${stats.cards} (${stats.nested} with a nested leader, ${stats.sides} battle sides, ${stats.pips} pip rows)`);
  check('every sampled card builds', nullCards === 0, `${nullCards} null`);
  check('every card keeps its ref id, type and file', badLoc === 0, `${badLoc} malformed`);
  check('every localisation reference resolves', unresolvedLoc === 0, `${unresolvedLoc} missed`);
  check('pip values stay inside the declared scale', badPips === 0, `${badPips} out of range`);
  check('a ruler that leads armies links to an indexed leader', badLink === 0, `${badLink} dangling`);
  check('a battle links to the war item it belongs to', badWar === 0, `${badWar} dangling`);
  check('English chrome carries no Chinese labels', enLeak === 0, `${enLeak} card(s)`);
  check('the sample covered all three types', stats.cards > 0 && stats.sides > 0 && stats.nested > 0,
    JSON.stringify(stats));

  // ---- the nested leader is indexed under the id the ruler links to --------
  let linked = 0;
  let nestedRulers = 0;
  for (const ref of sample(index.lists.monarchs || [], 200)) {
    const card = gamedata.buildCard(index, 'monarchs', ref.id, 'zh');
    if (!card || !card.leader) continue;
    nestedRulers++;
    if (leaderIds.has(card.leader.id)) linked++;
  }
  check('nested leaders are indexed in the leaders list', nestedRulers === 0 || linked === nestedRulers,
    `${linked}/${nestedRulers}`);

  // ---- battle totals come from the file, never invented --------------------
  const withTroops = [];
  let zeroed = 0;
  for (const ref of sample(index.lists.battles || [], 60)) {
    const card = gamedata.buildCard(index, 'battles', ref.id, 'zh');
    for (const s of (card && card.sides) || []) {
      if (!s) continue;
      if (s.troops.length) withTroops.push(s);
      // `Number(null)` is 0: a parser mismatch would report every side as
      // having lost nothing, which is exactly what this guards against.
      const sum = s.troops.reduce((a, b) => a + b.value, 0);
      if (s.troops.length && s.total !== sum) zeroed++;
    }
  }
  check('battle troop totals equal the sum of the file\'s troop fields', zeroed === 0, `${zeroed} wrong`);
  check('at least one battle side reports troops from the file',
    withTroops.some((s) => s.troops.some((t) => t.value > 0)),
    `${withTroops.length} side(s) with troop fields`);
  console.log(`battle sides with troop fields: ${withTroops.length} (e.g. `
    + withTroops.slice(0, 2).map((s) => s.troops.map((t) => `${t.key}=${t.value}`).join(' ')).join(' | ') + ')');

  // ---- battles: the winner, the game's own line, and the loss figure -------
  //
  // `result = yes|no` is read as the winner, the line adds the two sides up the
  // way the game's own WAR_OVERVIEW_BATTLE_VS_* strings do, and `losses` is
  // reported exactly as the file writes it — it is already a percentage, so any
  // arithmetic on it here would be the bug this test exists to catch.
  let checked = 0;
  let withOutcome = 0;
  let badOutcome = 0;
  let badLoss = 0;
  let badLine = 0;
  let badKind = 0;
  const kinds = { land: 0, sea: 0, units: 0 };
  const unitKeysSeen = new Set();
  for (const ref of sample(index.lists.battles || [], 90)) {
    const card = gamedata.buildCard(index, 'battles', ref.id, 'zh');
    const found = history.locateNode(index, ref);
    if (!card || !found) { badLine++; continue; }
    checked++;

    const raw = script.scalarValue(script.getEntry(found.node, 'result'));
    const want = String(raw) === 'yes' ? 'attacker' : String(raw) === 'no' ? 'defender' : null;
    if (card.outcome) withOutcome++;
    if ((card.outcome ? card.outcome.winner : null) !== want) badOutcome++;
    // The outcome label is chrome, so it must follow the requested language.
    const en = gamedata.buildCard(index, 'battles', ref.id, 'en');
    if (want && (!en || !en.outcome || en.outcome.label === card.outcome.label)) badOutcome++;

    // A line and the "no unit counts" note are mutually exclusive.
    if (Boolean(card.line) === Boolean(card.noTroops)) badLine++;
    if (card.line) {
      kinds[card.line.kind] = (kinds[card.line.kind] || 0) + 1;
      const tpl = String(card.line.tpl || '');
      if (['{n1}', '{n2}', '{tag1}', '{tag2}'].some((ph) => !tpl.includes(ph))) badLine++;
      const [a, d] = card.sides || [];
      if (!a || !d) badLine++;
      else if (card.line.vars.n1 !== a.total || card.line.vars.n2 !== d.total) badLine++;
    }

    for (const s of card.sides || []) {
      if (!s) continue;
      const b = script.getEntry(found.node, s.role);
      const rawLoss = b ? script.scalarValue(script.getEntry(b, 'losses')) : null;
      const wantLoss = (rawLoss === null || rawLoss === undefined || rawLoss === '')
        ? null : Number(rawLoss);
      if (s.losses !== wantLoss) badLoss++;

      // The unit keys the file actually wrote decide land vs sea.
      let land = 0;
      let sea = 0;
      const keys = [];
      for (const e of (b ? b.entries : [])) {
        if (e.value.type === 'object' || e.value.type === 'array') continue;
        const v = script.scalarValue(e.value);
        if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) continue;
        if (history.LAND_UNITS.includes(e.key)) { land++; keys.push(e.key); }
        else if (history.SEA_UNITS.includes(e.key)) { sea++; keys.push(e.key); }
      }
      const wantKind = !land && sea ? 'sea' : (land ? 'land' : null);
      if (s.unitKind !== wantKind) badKind++;
      if (s.troops.length !== keys.length) badKind++;
      for (const k of keys) unitKeysSeen.add(k);
    }
  }
  console.log(`battle cards inspected: ${checked}; lines by kind ${JSON.stringify(kinds)};`
    + ` unit keys seen: ${[...unitKeysSeen].sort().join(', ')}`);
  check('battle cards build and resolve', checked > 0 && badLine === 0, `${checked} checked, ${badLine} bad line`);
  check('every battle with a `result` shows the side the file says won',
    withOutcome > 0 && badOutcome === 0, `${withOutcome} with an outcome, ${badOutcome} wrong`);
  check('battle losses are reported exactly as the file writes them',
    badLoss === 0, `${badLoss} altered`);
  check('a side\'s unit kind follows the unit keys in the file',
    badKind === 0, `${badKind} mismatched`);
  check('the fleet/army distinction is exercised by the sample',
    kinds.land > 0, JSON.stringify(kinds));

  // ---- advisors: the type, the skill, the province and the two dates -------
  const advList = index.lists.hist_advisors || [];
  let advCards = 0;
  let advBad = 0;
  let advKindMissing = 0;
  const advSkill = new Set();
  const advFields = new Set();
  for (const ref of sample(advList, 60)) {
    let card = null;
    try { card = gamedata.buildCard(index, 'hist_advisors', ref.id, 'zh'); } catch { card = null; }
    if (!card) { advBad++; continue; }
    advCards++;
    if (card.kind !== 'advisor' || !card.kindLabel) advBad++;
    // An advisor belongs to a province, not to a country.
    if (card.tag) advBad++;
    if (!card.subKind || !card.subKind.length) advKindMissing++;
    if (!card.pips || card.pips.max !== history.ADVISOR_MAX) advBad++;
    for (const r of (card.pips ? card.pips.rows : [])) {
      advSkill.add(r.value);
      if (!(r.value >= 1 && r.value <= card.pips.max)) advBad++;
    }
    for (const f of card.fields) advFields.add(f.key);
    const found = history.locateNode(index, ref);
    const rawDate = found ? script.scalarValue(script.getEntry(found.node, 'date')) : null;
    if (rawDate && card.date !== rawDate) advBad++;
  }
  console.log(`advisor cards inspected: ${advCards}; skills seen: ${[...advSkill].sort().join(',')};`
    + ` fields: ${[...advFields].sort().join(', ')}`);
  check('advisor records are indexed', advList.length > 0, `n=${advList.length}`);
  check('every sampled advisor card builds and is kind-labelled', advCards > 0 && advBad === 0,
    `${advCards} checked, ${advBad} bad`);
  check('every advisor\'s type resolves through the localisation resolver',
    advKindMissing === 0, `${advKindMissing} without a type`);
  check('advisor skill pips stay on the 1–3 scale',
    advSkill.size > 0 && [...advSkill].every((v) => v >= 1 && v <= history.ADVISOR_MAX),
    [...advSkill].join(','));
  check('an advisor card carries his id, province and start date',
    ['advisor_id', 'location', 'date'].every((k) => advFields.has(k)),
    [...advFields].join(','));

  // ---- what the game will print: the stray 0xBF byte ----------------------
  // The double-byte patch's decoder (`convertEscapedTextToWideText`) maps a raw
  // 0xBF byte through CP1252 to U+00BF and the encoder never emits it as a
  // marker, so a field carrying one is printed by the game with a `¿` in it.
  // The viewer therefore keeps it: it shows what the mod actually says. This
  // counts how often that happens, so the number is visible rather than a
  // surprise in the middle of a ruler's name.
  let rawByte = 0;
  let totalFields = 0;
  let titlesWithByte = 0;
  for (const ref of sample(index.lists.monarchs || [], 300)) {
    const card = gamedata.buildCard(index, 'monarchs', ref.id, 'zh');
    if (!card) continue;
    if (card.name && JSON.stringify(card.name).includes('\u00bf')) titlesWithByte++;
    for (const f of card.fields || []) {
      totalFields++;
      if (String(f.value).includes('\u00bf')) rawByte++;
    }
  }
  console.log(`raw 0xBF ("¿" in game) in a sample of ${totalFields} ruler fields: ${rawByte};`
    + ` in card names: ${titlesWithByte}`);
  console.log('(reported, not a failure: the viewer shows what the mod says, and '
    + 'tools/test-codec.js proves the bytes survive decoding verbatim)');

  console.log(`\nhistory test finished in ${Date.now() - started} ms`);
  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log('  !! ' + f);
  }
  console.log(`\nHISTORY TEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
