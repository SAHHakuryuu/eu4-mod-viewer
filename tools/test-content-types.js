'use strict';
/**
 * Coverage test for the game-format preview: every registered content type must
 * index records, build a card from one of them, and hand the front end a
 * non-empty, renderable payload.
 *
 * This is the guard against the failure mode that matters most for this view —
 * a type that appears in the sidebar but opens an empty panel.
 *
 * Usage: node tools/test-content-types.js [mod name substring]
 */

const modsSvc = require('../src/mods.js');
const gamedata = require('../src/gamedata.js');
const gametext = require('../src/gametext.js');

const WANT = process.argv[2] || '1.37 Celestial empire on which the sun never sets';
const CJK = /[\u4e00-\u9fff\u3000-\u303f]/;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? '  (' + detail + ')' : ''}`);
}

/** How many renderable pieces a card carries. */
function payloadParts(card) {
  let n = 0;
  const add = (arr) => { if (Array.isArray(arr)) n += arr.length; };
  add(card.facts); add(card.flags); add(card.sections); add(card.entries);
  add(card.groups); add(card.lines); add(card.fields); add(card.stats);
  add(card.links); add(card.badges); add(card.timeline); add(card.siblings);
  for (const s of card.sections || []) { add(s.lines); add(s.fields); }
  for (const e of card.entries || []) { add(e.facts); add(e.lines); add(e.sections); add(e.badges); }
  for (const g of card.groups || []) add(g.lines);
  for (const nameish of [card.name, card.title]) if (Array.isArray(nameish) && nameish.length) n++;
  if (Array.isArray(card.desc) && card.desc.length) n++;
  if (card.synthName) n++;
  if (card.widgets) n++;
  return n;
}

function titleOf(card) {
  const nodes = card.title || card.name;
  if (Array.isArray(nodes) && nodes.length) return gametext.displayText(nodes);
  if (card.synthName) return card.synthName.zh || card.synthName.en || '';
  return '';
}

/** Every chrome `label` anywhere in a card.
 *
 * Only labels are checked for language correctness: the *values* are the mod's
 * own localisation, and a Chinese mod legitimately has Chinese text in its
 * `l_english` files, so a CJK value is data, not a translation bug.
 */
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

const userDir = modsSvc.findUserDir();
const installDir = modsSvc.findInstallDir();
const entry = modsSvc.listModDescriptors(userDir)
  .find((d) => (d.meta.name || '').includes(WANT) || d.root.includes(WANT));

(async () => {
  if (!entry) { console.error('mod not found: ' + WANT); process.exit(1); }
  const mod = await modsSvc.scanMod(entry);
  const index = gamedata.buildIndex(mod, installDir);

  console.log(`mod: ${mod.name}`);
  console.log(`index: ${index.buildMs} ms, ${index.errors.length} file errors`);
  check('index built without file errors', index.errors.length === 0,
    index.errors.slice(0, 3).map((e) => `${e.file}: ${e.error}`).join('; '));

  const types = gamedata.ALL_TYPES;
  check('more than the original six content types are registered', types.length >= 25, `types=${types.length}`);
  check('every type belongs to a known group',
    types.every((t) => gamedata.GROUPS.some((g) => g.id === t.group)),
    types.filter((t) => !gamedata.GROUPS.some((g) => g.id === t.group)).map((t) => t.id).join(','));
  check('type ids are unique', new Set(types.map((t) => t.id)).size === types.length);

  console.log('');
  console.log(`${'type'.padEnd(16)}${'group'.padEnd(10)}${'count'.padStart(7)}  card`);
  console.log('-'.repeat(78));

  const kindSeen = new Set();
  for (const t of types) {
    const list = index.lists[t.id] || [];
    check(`${t.id}: index produced records`, list.length > 0);

    // Try a few records: one malformed file must not fail the whole type.
    let card = null;
    let err = null;
    let used = null;
    for (const ref of list.slice(0, 12)) {
      try { card = gamedata.buildCard(index, t.id, ref.id); } catch (ex) { err = ex; card = null; }
      if (card) { used = ref; break; }
    }

    if (!card) {
      check(`${t.id}: a card can be built`, false, err ? err.message : 'no card for the first 12 records');
      console.log(`${t.id.padEnd(16)}${t.group.padEnd(10)}${String(list.length).padStart(7)}  !! ${err ? err.message : 'null'}`);
      continue;
    }

    const parts = payloadParts(card);
    const title = titleOf(card);
    const kind = card.kind || card.type;
    kindSeen.add(kind);

    check(`${t.id}: card carries renderable content`, parts > 0, `parts=${parts}`);
    check(`${t.id}: card has an id and source file`, card.id === used.id && !!card.file);
    check(`${t.id}: card declares its type`, card.type === t.id, `card.type=${card.type}`);

    // Every list row must carry *something* the user can read: the localised
    // title when there is one, otherwise the script id.
    const listTitle = gamedata.listTitle(index, t.id, used.id, 'zh');
    check(`${t.id}: list row is readable`, !!listTitle && String(listTitle).length > 0, `id=${used.id}`);
    check(`${t.id}: list row is readable in English too`,
      !!gamedata.listTitle(index, t.id, used.id, 'en'), `id=${used.id}`);

    // The script↔localisation table drives the "where does this text come
    // from" column. A handful of records legitimately resolve nothing — a mod
    // ships an override for some buildings and not others, so the description
    // key simply does not exist anywhere. What must never happen is a *pattern*
    // that is wrong for the whole type, which shows up as a near-zero hit rate.
    let refTotal = 0;
    let refFound = 0;
    for (const ref of list.slice(0, 8)) {
      let c2 = null;
      try { c2 = gamedata.buildCard(index, t.id, ref.id); } catch { c2 = null; }
      if (!c2) continue;
      for (const r of c2.locRefs || []) { refTotal++; if (r.found) refFound++; }
    }
    if (refTotal) {
      const rate = refFound / refTotal;
      check(`${t.id}: localisation references mostly resolve (${refFound}/${refTotal})`, rate >= 0.5,
        `hit rate ${(rate * 100).toFixed(0)}% over the first 8 records`);
    }

    // English mode must never leak Chinese into the chrome (fact labels,
    // section headings, badges). Values are the mod's own data and are exempt.
    let en = null;
    try { en = gamedata.buildCard(index, t.id, used.id, 'en'); } catch (ex) { err = ex; }
    if (!en) {
      check(`${t.id}: card can also be built in English`, false, err ? err.message : 'null');
    } else {
      const leaked = labels(en).filter((s) => CJK.test(s));
      check(`${t.id}: English chrome has no Chinese label`, leaked.length === 0,
        leaked.slice(0, 3).join(' | ').slice(0, 90));
    }

    console.log(`${t.id.padEnd(16)}${t.group.padEnd(10)}${String(list.length).padStart(7)}  ${kind} · ${parts} parts · ${title.slice(0, 34)}`);
  }

  console.log('');
  console.log(`kinds exercised: ${[...kindSeen].sort().join(', ')}`);

  // -------------------------------------------------------------------------
  // A country's history is a set of *assignments*, not effects
  // -------------------------------------------------------------------------
  //
  // `history/countries/*.txt` mixes assignments (`government = monarchy`,
  // `capital = 739`, `monarch = { … }`) with real commands
  // (`add_army_tradition`). Rendering it through the effect glossary printed the
  // assignments as "not in glossary" script keys — the exact complaint this
  // guards against: a labelled field must never come back as a raw key.
  console.log('\n--- country history fields ---');
  {
    const FIELD_KEYS = new Set([
      'monarch', 'heir', 'queen', 'consort', 'regent', 'leader', 'capital', 'government',
      'technology_group', 'primary_culture', 'religion', 'government_rank', 'historical_rival',
      'historical_friend', 'name', 'adm', 'dip', 'mil', 'fire', 'shock', 'manuever', 'siege',
      'personality', 'type', 'birth_date', 'death_date', 'dynasty', 'claim', 'add_government_reform',
    ]);
    const rawKeys = (card) => {
      const out = [];
      const walk = (v) => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') {
          if (v.t === 'raw' && typeof v.s === 'string' && FIELD_KEYS.has(v.s)) out.push(v.s);
          for (const k of Object.keys(v)) walk(v[k]);
        }
      };
      for (const g of card.groups || []) walk(g.lines);
      for (const t of card.timeline || []) walk(t.lines);
      return out;
    };

    const list = index.lists.countries || [];
    let checkedCards = 0;
    let labelled = 0;
    let withPerson = 0;
    let withEffect = 0;
    let offenders = 0;
    for (const ref of list.slice(0, 40)) {
      let card = null;
      try { card = gamedata.buildCard(index, 'countries', ref.id); } catch { card = null; }
      if (!card) continue;
      checkedCards++;
      const flat = JSON.stringify(card.groups || []) + JSON.stringify(card.timeline || []);
      if (/首都|政体|科技组/.test(flat)) labelled++;
      if (/"k":"group"[^}]*君主|"k":"group"[^}]*继承人/.test(flat)) withPerson++;
      if (/增加陆军传统|设定阶层特权|添加君主特质/.test(flat)) withEffect++;
      offenders += rawKeys(card).length;
    }
    check('history: country cards were built', checkedCards > 0, `cards=${checkedCards}`);
    check('history: assignment fields carry a Chinese label', labelled > 0, `labelled=${labelled}/${checkedCards}`);
    check('history: a person block is drawn as a named group', withPerson > 0, `withPerson=${withPerson}/${checkedCards}`);
    check('history: real commands still use the effect tooltip path', withEffect > 0, `withEffect=${withEffect}/${checkedCards}`);
    check('history: no labelled field comes back as a raw key', offenders === 0, `raw=${offenders}`);
  }

  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log('  !! ' + f);
  }
  console.log(`\nCONTENT TYPE TEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
