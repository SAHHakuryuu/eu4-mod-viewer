'use strict';
/**
 * Layout test for mission trees.
 *
 * The point of the mission view is that the grid matches the game, so this test
 * checks the *semantics* the layout is derived from rather than restating the
 * implementation:
 *
 *   - `slot` is the column, `position` the row, and a series that omits
 *     `position` falls back to file order. Verified against the raw text of a
 *     real mission file, read independently of the parser.
 *   - The geometry comes from the mod's own `countrymissionsview.gui`. The title
 *     offset is cross-checked with an independent brace-aware scan, because that
 *     offset is the one a naive forward scan gets wrong (the GUI writes
 *     `position` before `name` for `mission_title`).
 *   - Every prerequisite that resolves inside the tree must produce an arrowhead
 *     in the band directly above its target — the rule the game's arrow sprites
 *     imply.
 *
 * Usage: node tools/test-missions.js [mod name substring]
 */

const fs = require('fs');
const path = require('path');

const modsSvc = require('../src/mods.js');
const gamedata = require('../src/gamedata.js');
const missions = require('../src/content/missions.js');

const WANT = process.argv[2] || '1.37 Celestial empire on which the sun never sets';
const CJK = /[\u4e00-\u9fff\u3000-\u303f]/;
const MAX_SLOTS = missions.MAX_SLOTS;

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; return true; }
  fail++;
  failures.push(`${label}${detail ? '  (' + detail + ')' : ''}`);
  return false;
}

/** Chrome labels anywhere in a card — the only strings that must be translated. */
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

/** Independent brace-aware read of one GUI entry's position. */
function guiPositionFromText(text, name) {
  const at = text.indexOf(`name = "${name}"`);
  if (at < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{') { if (depth === 0) { start = i; break; } depth--; }
  }
  if (start < 0) return null;
  depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const block = text.slice(start, end + 1);
  const m = /position\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*y\s*=\s*(-?[\d.]+)/.exec(block);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

const userDir = modsSvc.findUserDir();
const installDir = modsSvc.findInstallDir();
const entry = modsSvc.listModDescriptors(userDir)
  .find((d) => (d.meta.name || '').includes(WANT) || d.root.includes(WANT));

(async () => {
  if (!entry) { console.error('mod not found: ' + WANT); process.exit(1); }
  const mod = await modsSvc.scanMod(entry);
  const index = gamedata.buildIndex(mod, installDir);
  const trees = index.missionTrees || [];

  console.log(`mod: ${mod.name}`);
  console.log(`index: ${index.buildMs} ms, ${index.errors.length} file errors`);
  console.log(`missions: ${(index.lists.missions || []).length}, trees: ${trees.length}`);
  check('index built without file errors', index.errors.length === 0,
    index.errors.slice(0, 3).map((e) => `${e.file}: ${e.error}`).join('; '));
  check('mission trees were found', trees.length > 0, `trees=${trees.length}`);
  check('missions were found', (index.lists.missions || []).length > 0);
  // A series that declares only `slot` and `potential` is a leftover placeholder
  // (the workspace mod has one) and must not become a browsable empty tree.
  check('no empty tree is listed', trees.every((t) => t.missions.length > 0),
    trees.filter((t) => !t.missions.length).map((t) => `${t.file}#${t.id}`).join(', '));

  // --- the tree list is addressable and unique -----------------------------
  const treeList = index.lists.mission_trees || [];
  check('every tree has a list row', treeList.length === trees.length,
    `trees=${trees.length} rows=${treeList.length}`);
  check('tree list ids are unique', new Set(treeList.map((r) => r.id)).size === treeList.length);
  check('mission ids are unique',
    new Set((index.lists.missions || []).map((r) => r.id)).size === (index.lists.missions || []).length);
  check('every tree row has a readable title in both languages',
    treeList.every((r) => {
      const zh = gamedata.listTitle(index, 'mission_trees', r.id, 'zh');
      const en = gamedata.listTitle(index, 'mission_trees', r.id, 'en');
      return !!zh && !!en;
    }));

  // --- the GUI geometry ----------------------------------------------------
  const gui = missions.readGui(index);
  console.log(`gui: cell ${gui.cellW}×${gui.cellH}, max_slots_horizontal=${gui.maxSlotsConfigured}, source=${gui.source}`);
  check('cell geometry is plausible', gui.cellW >= 40 && gui.cellH >= 60, `${gui.cellW}×${gui.cellH}`);
  check('column limit is at most ' + MAX_SLOTS, gui.maxSlots <= 64, `maxSlots=${gui.maxSlots}`);
  check('all ten arrow pieces were read from the GUI', gui.piecesMatched === 10, `matched=${gui.piecesMatched}`);
  check('every arrow piece names a sprite',
    Object.values(gui.pieces).every((p) => !!p.sprite && Number.isFinite(p.x) && Number.isFinite(p.y)));

  // Regression guard: `mission_title` writes `position` *before* `name`, so a
  // forward scan picks up the country shield's coordinates instead.
  if (gui.source) {
    const rel = gui.source.replace(/^(mod|vanilla):/, '');
    const root = gui.source.startsWith('mod:') ? mod.root : installDir;
    let text = null;
    try {
      text = require('../src/codec/localisation.js').decodePlain(fs.readFileSync(path.join(root, rel)));
    } catch { text = null; }
    const truth = text ? guiPositionFromText(text, 'mission_title') : null;
    if (truth) {
      check('title offset matches an independent read of the GUI',
        gui.title.x === truth.x && gui.title.y === truth.y,
        `parsed=(${gui.title.x},${gui.title.y}) file=(${truth.x},${truth.y})`);
      check('title offset is the text box, not the country shield',
        gui.title.y > gui.icon.y + 30, `title.y=${gui.title.y} icon.y=${gui.icon.y}`);
    } else {
      console.log('  (no readable GUI text to cross-check the title offset)');
    }
  }

  // --- per-tree structural invariants --------------------------------------
  console.log('');
  console.log(`${'tree'.padEnd(12)}${'file'.padEnd(38)}${'cols'.padStart(5)}${'rows'.padStart(6)}${'n'.padStart(6)}${'arrows'.padStart(8)}`);
  console.log('-'.repeat(80));

  let totalArrows = 0;
  let totalConflicts = 0;
  let totalMissing = 0;
  let totalReversed = 0;
  let iconTotal = 0;
  let iconResolved = 0;
  const badTrees = [];

  for (const tree of trees) {
    const listRef = treeList.find((r) => r.treeId === tree.id);
    const grid = missions.layoutTree(index, tree, gui, 'zh');
    totalArrows += grid.arrows.length;
    totalConflicts += grid.cells.filter((c) => c.conflict).length;
    totalMissing += grid.missingPrereqs.length;
    totalReversed += grid.reversedLinks.length;

    const slotsInMissions = new Set(tree.missions.map((m) => m.slot));
    const maxPos = tree.missions.reduce((a, m) => Math.max(a, m.position), 0);
    const cellsExpected = new Set(tree.missions.map((m) => m.slot + ':' + m.position)).size;

    const ok = []
      .concat([
        ['tree has missions', tree.missions.length > 0],
        ['tree has a list row', !!listRef],
        ['every mission slot is 1..' + MAX_SLOTS, tree.missions.every((m) => m.slot >= 1 && m.slot <= MAX_SLOTS)],
        ['every mission position is >= 1', tree.missions.every((m) => Number.isInteger(m.position) && m.position >= 1)],
        ['slotList equals the slots actually used', grid.slotList.join(',') === [...slotsInMissions].sort((a, b) => a - b).join(',')],
        ['rows equals the largest position', grid.rows === maxPos],
        ['columns equals min(maxSlot, cap)', grid.columns === Math.min(Math.max(...slotsInMissions), MAX_SLOTS)],
        ['one cell per distinct slot/position', grid.cells.length === cellsExpected],
        ['every arrow has coordinates and a texture', grid.arrows.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && !!a.url)],
        ['every arrow band is inside the drawn grid', grid.arrows.every((a) => a.slot >= 1 && a.slot <= grid.columns && a.row >= 1 && a.row <= grid.rows)],
        ['frame and badges resolve', !!grid.art.frame && !!grid.art.trigger && !!grid.art.effect],
        ['effect badge is a 3-frame strip', grid.art.effect.frames === 3],
      ]);

    // Every prerequisite that resolves in-tree must leave an arrowhead in the
    // band directly above the target row. Derived from the cells, not from the
    // arrow generator, so a wrong rule fails here.
    const byId = new Map();
    for (const m of tree.missions) {
      byId.set(m.id, m);
      const bare = m.id.includes('#') ? m.id.split('#')[0] : m.id;
      if (!byId.has(bare)) byId.set(bare, m);
    }
    const arrowAt = new Set(grid.arrows.map((a) => `${a.slot}:${a.row}:${a.y}`));
    let verticalLinks = 0;
    let verticalOk = true;
    let reversedLinks = 0;
    let reversedOk = true;
    let sameCellOk = true;
    for (const m of tree.missions) {
      for (const pid of m.prereqs) {
        const src = byId.get(pid);
        if (!src) continue;
        if (src.slot !== m.slot) continue;
        if (src.position === m.position) {
          // Same cell: no direction exists, so it must be reported, not drawn.
          if (!grid.sameCellLinks.some((l) => l.from === src.id && l.to === m.id)) sameCellOk = false;
          continue;
        }
        if (src.position < m.position) {
          verticalLinks++;
          if (!arrowAt.has(`${m.slot}:${m.position - 1}:${gui.pieces.endCenter.y}`)) verticalOk = false;
        } else if (src.position > m.position) {
          // The game only ships downward heads, so a reversed link must be drawn
          // with the flipped head at the target's band.
          reversedLinks++;
          const flipped = grid.arrows.some(
            (a) => a.slot === m.slot && a.row === m.position && a.flip === 'v',
          );
          if (!flipped) reversedOk = false;
        }
      }
    }
    ok.push([`every same-column prerequisite ends with an arrowhead (${verticalLinks} links)`, verticalOk]);
    ok.push([`every reversed prerequisite gets a flipped head (${reversedLinks} links)`, reversedOk]);
    ok.push(['every same-cell prerequisite is reported, not drawn', sameCellOk]);

    for (const m of tree.missions) {
      if (!m.icon) continue;
      iconTotal++;
      const cell = grid.cells.find((c) => c.missions.some((x) => x.id === m.id));
      const info = cell && cell.missions.find((x) => x.id === m.id);
      if (info && info.iconUrl) iconResolved++;
    }

    const failed = ok.filter(([, v]) => !v);
    if (failed.length) {
      badTrees.push(`${tree.file}#${tree.id}: ${failed.map(([l]) => l).join('; ')}`);
    }
    if (tree.id <= 4 || failed.length) {
      console.log(`${('tree#' + tree.id).padEnd(12)}${tree.file.replace(/^missions\//, '').padEnd(38)}${String(grid.columns).padStart(5)}${String(grid.rows).padStart(6)}${String(tree.missions.length).padStart(6)}${String(grid.arrows.length).padStart(8)}`);
    }
  }

  check('every tree satisfies the layout invariants', badTrees.length === 0,
    badTrees.slice(0, 3).join(' | ').slice(0, 200));

  // --- ground truth from one raw mission file ------------------------------
  const sample = trees.find((t) => /AFR_Ajuuraan_Missions\.txt$/i.test(t.file)) || trees[0];
  if (sample) {
    let text = null;
    try { text = fs.readFileSync(path.join(mod.root, sample.file), 'latin1'); } catch { text = null; }
    if (text) {
      const fileSlots = new Set();
      for (const m of text.matchAll(/^\s*slot\s*=\s*(\d+)/gm)) fileSlots.add(Number(m[1]));
      const filePositions = [...text.matchAll(/^\s*position\s*=\s*(\d+)/gm)].map((m) => Number(m[1]));
      check(`${sample.file}: parsed slot set matches the raw file`,
        [...fileSlots].sort((a, b) => a - b).join(',') ===
        [...new Set(sample.missions.map((m) => m.slot))].sort((a, b) => a - b).join(','),
        `file=${[...fileSlots].join(',')} parsed=${[...new Set(sample.missions.map((m) => m.slot))].join(',')}`);
      if (filePositions.length === sample.missions.length) {
        check(`${sample.file}: rows equals the file's largest position`,
          Math.max(...filePositions) === Math.max(...sample.missions.map((m) => m.position)),
          `file=${Math.max(...filePositions)} parsed=${Math.max(...sample.missions.map((m) => m.position))}`);
      } else {
        check(`${sample.file}: mission count matches the file's position lines`,
          filePositions.length === sample.missions.length,
          `file=${filePositions.length} parsed=${sample.missions.length}`);
      }
    } else {
      console.log('  (sample mission file unreadable; raw cross-check skipped)');
    }
  }

  // --- sprite coverage -----------------------------------------------------
  const rate = iconTotal ? iconResolved / iconTotal : 0;
  check(`mission icons resolve from the game folder (${iconResolved}/${iconTotal})`, rate >= 0.9,
    `${(rate * 100).toFixed(1)}%`);

  console.log('');
  let reversedTotal = 0;
  let sameCellTotal = 0;
  for (const tree of trees) {
    const g = missions.layoutTree(index, tree, gui, 'en');
    reversedTotal += g.reversedLinks.length;
    sameCellTotal += g.sameCellLinks.length;
  }
  console.log(`arrows=${totalArrows}  slot/position conflicts=${totalConflicts}  prereqs pointing outside their tree=${totalMissing}`);
  console.log(`reversed prerequisites (drawn with a flipped head)=${reversedTotal}  same-cell prerequisites (no direction)=${sameCellTotal}`);

  // --- cards ---------------------------------------------------------------
  let carded = 0;
  const cjkLeaks = [];
  for (const t of trees) {
    const row = treeList.find((r) => r.treeId === t.id);
    if (!row) continue;
    const card = gamedata.buildCard(index, 'mission_trees', row.id, 'zh');
    if (!check(`tree#${t.id}: card builds with a grid`,
      !!card && !!card.grid && card.grid.cells.length > 0, card ? `cells=${card.grid && card.grid.cells.length}` : 'null')) break;
    carded++;
    const en = gamedata.buildCard(index, 'mission_trees', row.id, 'en');
    if (en) {
      const leaked = labels(en).filter((s) => CJK.test(s));
      if (leaked.length) cjkLeaks.push(`${row.id}: ${leaked[0]}`);
    }
  }
  check('every mission tree produced a card', carded === trees.length, `${carded}/${trees.length}`);
  check('English tree chrome has no Chinese label', cjkLeaks.length === 0, cjkLeaks.slice(0, 3).join(' | '));

  // A sample of individual missions: each card must carry the tree grid too.
  const sampleMissions = [];
  for (let i = 0; i < (index.lists.missions || []).length && sampleMissions.length < 40; i += Math.max(1, Math.floor((index.lists.missions.length) / 40))) {
    sampleMissions.push(index.lists.missions[i]);
  }
  let missionCards = 0;
  let withGrid = 0;
  for (const ref of sampleMissions) {
    let card = null;
    try { card = gamedata.buildCard(index, 'missions', ref.id, 'zh'); } catch { card = null; }
    if (!card) continue;
    missionCards++;
    if (card.grid && card.grid.cells.length > 0) withGrid++;
    check(`mission ${ref.id}: card marks the selected mission`,
      !card.grid || card.selectedId === ref.id, `selectedId=${card.selectedId}`);
  }
  check('every sampled mission built a card', missionCards === sampleMissions.length, `${missionCards}/${sampleMissions.length}`);
  check('every sampled mission card carries the tree grid', withGrid === missionCards, `${withGrid}/${missionCards}`);

  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures.slice(0, 25)) console.log('  !! ' + f);
    if (failures.length > 25) console.log(`  … and ${failures.length - 25} more`);
  }
  console.log(`\nMISSION LAYOUT TEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
