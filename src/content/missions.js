'use strict';
/**
 * Mission trees, laid out the way the game lays them out.
 *
 * Two things decide the in-game shape of a mission tree, and neither is a
 * convention this file invented:
 *
 *   1. `slot = N` on a mission *series* picks the column; `position = N` on a
 *      mission picks the row. A series that omits `position` (many vanilla files
 *      do) falls back to the order its missions appear in the file.
 *      `required_missions` is what the game draws an arrow for.
 *   2. Every size and offset comes from `interface/countrymissionsview.gui`,
 *      read from the **mod first** because a mod is allowed to override it
 *      (`1.37 Celestial empire…` does) and from the install second.
 *
 * The arrows are the game's own `gfx_arrow_*` sprites, resolved through the
 * user's own installation, so nothing here redistributes art. When a sprite
 * cannot be resolved the piece is simply left out and the card says so, rather
 * than substituting an approximation that would misrepresent the mod.
 *
 * `max_slots_horizontal` in that GUI is what the game uses for the column count,
 * but the workspace owner asked for a hard ceiling of 11 (the column count is
 * modifiable, and a mod may widen its own panel without raising the GUI value),
 * so a tree is rendered across `min(maxSlotUsed, 11)` columns.
 */

const fs = require('fs');
const path = require('path');

const locCodec = require('../codec/localisation.js');
const { getEntry, scalarValue } = require('../codec/script.js');
const c = require('./common.js');
const terms = require('../gameterms.js');

const {
  L, pick, underPrefix, makeRef, contentCtx, fileStem, kindLabel, resolveSpriteInfo,
} = c;

/** Column ceiling: the GUI value is modifiable, so cap what we are willing to draw. */
const MAX_SLOTS = 11;
/** A tree larger than this is truncated with a note rather than shipping a huge card. */
const MAX_CELLS = 400;

const GUI_REL = 'interface/countrymissionsview.gui';

/**
 * Vanilla defaults, each of which `readGui` also looks for by the same GUI key,
 * so a readable file always wins. Positions may be negative: `skip_slot` and
 * `left_branch_in` are drawn hanging off the left edge of their cell.
 */
const GUI_FALLBACK = {
  cellW: 104,
  cellH: 152,
  maxSlots: 5,
  title: { x: 8, y: 84, w: 90 },
  icon: { x: 22, y: 20 },
  shield: { x: 35, y: 3 },
  trigger: { x: 0, y: 7 },
  effect: { x: 70, y: 7 },
  pieces: {
    tile: { x: 46, y: 121, sprite: 'gfx_arrow_verticall_tile' },
    endCenter: { x: 38, y: 141, sprite: 'gfx_arrow_end' },
    endLeft: { x: 15, y: 141, sprite: 'gfx_arrow_end' },
    endRight: { x: 61, y: 141, sprite: 'gfx_arrow_end' },
    skipTier: { x: 46, y: 141, sprite: 'gfx_arrow_verticall_skip_tier' },
    skipSlot: { x: -6, y: 127, sprite: 'gfx_arrow_horizontal_skip_slot' },
    leftOut: { x: 4, y: 122, sprite: 'gfx_arrow_left_out' },
    leftIn: { x: 69, y: 125, sprite: 'gfx_arrow_left_in' },
    rightOut: { x: 60, y: 122, sprite: 'gfx_arrow_right_out' },
    rightIn: { x: -5, y: 127, sprite: 'gfx_arrow_right_in' },
  },
};

/** The GUI's own `name = "…"` for each piece, so the parse stays traceable. */
const PIECE_GUI_NAMES = {
  tile: 'arrow_half_top',
  endCenter: 'arrow_half_bottom_center',
  endLeft: 'arrow_half_bottom_left',
  endRight: 'arrow_half_bottom_right',
  skipTier: 'skip_tier',
  skipSlot: 'skip_slot',
  leftOut: 'left_branch_out',
  leftIn: 'right_branch_in',
  rightOut: 'right_branch_out',
  rightIn: 'left_branch_in',
};

/** Keys on a series block that are settings, not missions. */
const MISSION_STRUCT = new Set([
  'slot', 'generic', 'ai', 'potential', 'potential_on_load', 'has_country_shield',
  'is_mission_tree', 'mission_tree_key', 'weight',
]);

// ---------------------------------------------------------------------------
// Reading the GUI
// ---------------------------------------------------------------------------

/** Decoded text of the effective GUI file, mod first. */
function guiText(index) {
  const roots = [];
  if (index.mod && index.mod.root) roots.push([index.mod.root, 'mod']);
  if (index.installDir) roots.push([index.installDir, 'vanilla']);
  for (const [root, label] of roots) {
    try {
      const abs = path.join(root, GUI_REL);
      if (!fs.existsSync(abs)) continue;
      return { text: locCodec.decodePlain(fs.readFileSync(abs)), source: label + ':' + GUI_REL };
    } catch { /* try the next root */ }
  }
  return null;
}

/**
 * The `{ … }` block enclosing the field at `idx`.
 *
 * Needed because the GUI does not put `position` after `name` consistently —
 * `mission_title` writes `position` first — so scanning forward from the name
 * would read the *next* entry's coordinates.
 */
function blockAround(text, idx) {
  let depth = 0;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** `name = "X"` → the block that declares it, parsed for position/sprite/width. */
function guiEntry(text, name) {
  const at = text.indexOf(`name = "${name}"`);
  if (at < 0) return null;
  const block = blockAround(text, at) || text.slice(Math.max(0, at - 400), at + 400);
  const pos = /position\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*y\s*=\s*(-?[\d.]+)/.exec(block);
  const spr = /quadTextureSprite\s*=\s*"([^"]+)"/.exec(block);
  const w = /maxWidth\s*=\s*(\d+)/.exec(block);
  return {
    x: pos ? Number(pos[1]) : null,
    y: pos ? Number(pos[2]) : null,
    sprite: spr ? spr[1] : null,
    maxWidth: w ? Number(w[1]) : null,
  };
}

/**
 * The geometry the game will actually use for this mod: cell size, column limit,
 * title/icon offsets and every arrow piece.
 */
function readGui(index) {
  if (index._missionGui) return index._missionGui;
  const gui = JSON.parse(JSON.stringify(GUI_FALLBACK));
  gui.source = null;
  gui.maxSlotsConfigured = null;
  gui.panelSlots = null;

  const found = guiText(index);
  if (found) {
    gui.source = found.source;
    const t = found.text;
    const ss = /slotsize\s*=\s*\{\s*width\s*=\s*(\d+)\s*height\s*=\s*(\d+)/.exec(t);
    if (ss) { gui.cellW = Number(ss[1]); gui.cellH = Number(ss[2]); }
    const ms = /max_slots_horizontal\s*=\s*(\d+)/.exec(t);
    if (ms) { gui.maxSlotsConfigured = Number(ms[1]); gui.maxSlots = Number(ms[1]); }
    // A mod that widens the mission listbox without raising max_slots_horizontal
    // still visibly fits more columns; record what the panel was widened for.
    const lb = /name\s*=\s*"countrymissionsview_missions_gridbox_listbox"[\s\S]{0,240}?size\s*=\s*\{\s*x\s*=\s*(\d+)/.exec(t);
    if (lb && gui.cellW) gui.panelSlots = Math.floor(Number(lb[1]) / gui.cellW);

    const named = {
      icon: 'mission_icon',
      title: 'mission_title',
      trigger: 'mission_entry_conditions',
      effect: 'mission_entry_rewards',
    };
    for (const [key, guiName] of Object.entries(named)) {
      const e = guiEntry(t, guiName);
      if (!e || e.x === null) continue;
      // `mission_title` is an instantTextBox: its width comes from maxWidth.
      if (key === 'title') gui.title = { x: e.x, y: e.y, w: e.maxWidth || gui.title.w };
      else gui[key] = { x: e.x, y: e.y };
    }
    let matched = 0;
    for (const [key, guiName] of Object.entries(PIECE_GUI_NAMES)) {
      const e = guiEntry(t, guiName);
      if (e && e.x !== null) {
        gui.pieces[key] = { x: e.x, y: e.y, sprite: e.sprite || GUI_FALLBACK.pieces[key].sprite };
        matched++;
      }
    }
    gui.piecesMatched = matched;
  }

  index._missionGui = gui;
  return gui;
}

// ---------------------------------------------------------------------------
// Collecting series into trees
// ---------------------------------------------------------------------------

/** A stable textual signature of a script node, used to group series into trees. */
function nodeSig(node) {
  if (!node) return '';
  if (node.type === 'object') return '{' + node.entries.map((e) => e.key + '=' + nodeSig(e.value)).join(';') + '}';
  if (node.type === 'array') return '[' + node.items.map(nodeSig).join(',') + ']';
  return String(node.value);
}

/** The missions of one series, with their row taken from `position` or file order. */
function seriesMissions(node) {
  const out = [];
  let ordinal = 0;
  for (const e of node.entries) {
    if (e.value.type !== 'object') continue;
    if (MISSION_STRUCT.has(e.key)) continue;
    ordinal++;
    const raw = scalarValue(getEntry(e.value, 'position'));
    const pos = raw !== undefined && raw !== null && raw !== '' ? Number(raw) : NaN;
    out.push({
      key: e.key,
      node: e.value,
      line: e.line,
      position: Number.isFinite(pos) && pos > 0 ? pos : ordinal,
      explicit: Number.isFinite(pos) && pos > 0,
    });
  }
  return out;
}

/** `required_missions` as a list of ids, however the mod wrote it. */
function prereqIds(node) {
  const e = getEntry(node, 'required_missions') || getEntry(node, 'required_missions_self');
  if (!e) return [];
  const out = [];
  const add = (v) => { if (v !== undefined && v !== null && v !== '') out.push(String(v)); };
  if (e.type === 'array') {
    for (const it of e.items) add(it.type === 'identifier' ? it.value : scalarValue(it));
  } else if (e.type === 'object') {
    for (const child of e.entries) add(child.key);
  } else {
    add(scalarValue(e));
  }
  return out;
}

/** Every `tag = XXX` (or `tag = { A B }`) inside a series' `potential`. */
function collectTags(node, out = [], depth = 0) {
  if (!node || depth > 6 || out.length > 12) return out;
  if (node.type === 'object') {
    for (const e of node.entries) {
      if (e.key === 'tag') {
        if (e.value.type === 'array') {
          for (const it of e.value.items) {
            const v = it.type === 'identifier' ? it.value : scalarValue(it);
            if (v && /^[A-Z0-9]{3}$/.test(v) && !out.includes(v)) out.push(v);
          }
        } else {
          const v = scalarValue(e.value);
          if (v && /^[A-Z0-9]{3}$/.test(v) && !out.includes(v)) out.push(v);
        }
      }
      collectTags(e.value, out, depth + 1);
    }
  } else if (node.type === 'array') {
    for (const it of node.items) collectTags(it, out, depth + 1);
  }
  return out;
}

/** DLC names mentioned by a series' `potential`, for the tree header note. */
function collectDlc(node, out = [], depth = 0) {
  if (!node || depth > 6 || out.length > 6) return out;
  if (node.type === 'object') {
    for (const e of node.entries) {
      if (e.key === 'has_dlc') {
        const v = scalarValue(e.value);
        if (v && !out.includes(v)) out.push(v);
      }
      collectDlc(e.value, out, depth + 1);
    }
  } else if (node.type === 'array') {
    for (const it of node.items) collectDlc(it, out, depth + 1);
  }
  return out;
}

/** Plain, markup-free mission name — the same lookup the mission list already used. */
function missionTitle(index, id) {
  const r = index.resolver;
  const t = r.text(id + '_title') || r.text(id);
  return t ? terms.stripMarkup(t) : String(id);
}

/** Human label for a tree: its file plus the tags its `potential` names. */
function treeLabel(tree) {
  const stem = fileStem(tree.file);
  return tree.tags.length ? stem + ' · ' + tree.tags.join('/') : stem;
}

/**
 * One series block → tree + mission refs.
 *
 * Series that share a `potential` are the same tree: the game shows them at the
 * same time, each filling its own column, which is exactly how a multi-column
 * tree is written (`aragonese_missions_1` slot 1 and `aragonese_missions_2`
 * slot 5 carry identical potential blocks).
 */
function addSeries(index, trees, usedIds, rel, node, seriesKey, slot) {
  const missions = seriesMissions(node);
  // A series with no missions is a placeholder a mod left behind (the workspace
  // mod has one: `DS_dongsong_missions_7_yangzhou` is `slot` and `potential`
  // only). It has nothing to browse, so it does not become a tree.
  if (!missions.length) return;

  const potEntry = getEntry(node, 'potential');
  const sig = rel + '\u0001' + nodeSig(potEntry);
  let tree = trees.get(sig);
  if (!tree) {
    tree = {
      id: trees.size + 1,
      file: rel,
      seriesKeys: [],
      potentialNode: potEntry || null,
      missions: [],
      rowCount: 0,
      maxSlot: 0,
      slotsUsed: new Set(),
      tags: collectTags(potEntry),
      dlc: collectDlc(potEntry),
    };
    trees.set(sig, tree);
    index.missionTrees.push(tree);
  }
  if (!tree.seriesKeys.includes(seriesKey)) tree.seriesKeys.push(seriesKey);

  for (const m of missions) {
    // A mission id is the block key, but the same key can appear in two series
    // of one mod; qualify the later one so list ids stay unique.
    let id = m.key;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(id + '#' + n)) n++;
      id = id + '#' + n;
    }
    usedIds.add(id);

    const ref = makeRef('missions', id, rel, m.line, {
      kind: 'mission',
      folder: 'missions/',
      // `node` lets the generic card builder find the block whatever shape the
      // series nesting takes; `parent`/`mode` keep it working the usual way.
      node: m.node,
      mode: 'groupchildren',
      parent: seriesKey,
      slot,
      position: m.position,
      explicitPosition: m.explicit,
      treeId: tree.id,
      icon: scalarValue(getEntry(m.node, 'icon')) || null,
      hasTrigger: !!getEntry(m.node, 'trigger'),
      hasEffect: !!getEntry(m.node, 'effect'),
      hasHighlight: !!getEntry(m.node, 'provinces_to_highlight'),
      prereqs: prereqIds(m.node),
    });
    index.lists.missions.push(ref);
    tree.missions.push(ref);
    tree.slotsUsed.add(slot);
    if (slot > tree.maxSlot) tree.maxSlot = slot;
    if (m.position > tree.rowCount) tree.rowCount = m.position;
    index.titles.set('missions:' + id, missionTitle(index, m.key));
  }
}

function collectMissions(index, files) {
  // The mission-tree descriptor is collected first (it is the earlier tab) but
  // reads what this one builds, so make the pass idempotent instead of depending
  // on descriptor order.
  if (index._missionsCollected) return;
  index._missionsCollected = true;
  index.lists.missions = index.lists.missions || [];
  index.missionTrees = [];
  const trees = new Map();
  const usedIds = new Set();

  for (const rel of files) {
    if (!underPrefix(rel, ['missions/'])) continue;
    index.counters['missions/'] = (index.counters['missions/'] || 0) + 1;
    const tree = index.cache.tree(rel);
    if (!tree) { index.errors.push({ file: rel, error: 'unreadable' }); continue; }

    for (const top of tree.entries) {
      if (top.value.type !== 'object') continue;
      const own = scalarValue(getEntry(top.value, 'slot'));
      if (own !== undefined && own !== null && own !== '') {
        addSeries(index, trees, usedIds, rel, top.value, top.key, Number(own) || 0);
      } else if (/_mission_slot$/i.test(top.key)) {
        // Wrapper form: each child block is a series.
        for (const child of top.value.entries) {
          if (child.value.type !== 'object') continue;
          const s = scalarValue(getEntry(child.value, 'slot'));
          addSeries(index, trees, usedIds, rel, child.value, top.key + '.' + child.key, Number(s) || 0);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Laying a tree out
// ---------------------------------------------------------------------------

/** Resolve a sprite once per card and reuse the result for every duplicate piece. */
function makeSpriteCache(index) {
  const cache = new Map();
  let missing = 0;
  return {
    info(sprite) {
      if (!sprite) return null;
      if (cache.has(sprite)) return cache.get(sprite);
      const info = resolveSpriteInfo(index, sprite);
      if (!info) missing++;
      cache.set(sprite, info || null);
      return info || null;
    },
    url(sprite) {
      const info = this.info(sprite);
      return info ? info.url : null;
    },
    get missing() { return missing; },
  };
}

/**
 * The whole tree as a grid: which mission sits in which cell, and every arrow
 * piece with the coordinates the game's own GUI gives it.
 *
 * Arrows leave the bottom of the required mission and enter the top of the
 * mission that requires it. A same-column pair is drawn with the vertical tile
 * plus an arrowhead; a pair in another column turns in the band above the target
 * row and uses the out/in/tile pieces for that direction.
 */
function layoutTree(index, tree, gui, lang) {
  const columns = Math.max(1, Math.min(tree.maxSlot || 1, MAX_SLOTS));
  const rows = Math.max(1, tree.rowCount || 1);
  const sprites = makeSpriteCache(index);

  const cellOf = new Map();
  for (const ref of tree.missions) {
    const key = ref.slot + ':' + ref.position;
    if (!cellOf.has(key)) cellOf.set(key, []);
    cellOf.get(key).push(ref);
  }

  const byId = new Map();
  for (const ref of tree.missions) {
    const bare = ref.id.includes('#') ? ref.id.split('#')[0] : ref.id;
    if (!byId.has(ref.id)) byId.set(ref.id, ref);
    if (!byId.has(bare)) byId.set(bare, ref);
  }

  // Who requires whom, so a cell can be highlighted as part of the chain.
  const dependents = new Map();
  for (const ref of tree.missions) {
    for (const pid of ref.prereqs) {
      if (!dependents.has(pid)) dependents.set(pid, []);
      dependents.get(pid).push(ref.id);
    }
  }

  const arrows = [];
  const missingPrereqs = [];
  const reversedLinks = [];
  const sameCellLinks = [];
  const seenArrows = new Set();
  const pushArrow = (slot, row, piece) => {
    const url = sprites.url(piece.sprite);
    if (!url) return;
    const flip = piece.flip || '';
    const dedupe = slot + ':' + row + ':' + piece.sprite + ':' + piece.x + ':' + piece.y + ':' + flip;
    if (seenArrows.has(dedupe)) return;
    seenArrows.add(dedupe);
    arrows.push({ slot, row, url, x: piece.x, y: piece.y, flip: flip || null });
  };

  const P = gui.pieces;
  // Where the mission frame ends and the arrow band begins, taken from where the
  // GUI puts the vertical tile rather than hard-coded.
  const frameBottom = P.tile.y;
  for (const ref of tree.missions) {
    for (const pid of ref.prereqs) {
      const src = byId.get(pid);
      if (!src) { missingPrereqs.push({ from: ref.id, to: pid }); continue; }
      const sc = src.slot; const sr = src.position;
      const tc = ref.slot; const tr = ref.position;
      const rightward = tc > sc;
      // A prerequisite in the mission's *own* cell has no direction to draw; it
      // happens where two missions share a slot and a position and one needs the
      // other. Counted so the card can say so rather than drawing a stray arrow.
      if (sc === tc && tr === sr) { sameCellLinks.push({ from: src.id, to: ref.id }); continue; }
      // The game only ships downward arrowheads, so a script whose prerequisite
      // sits *below* the mission that needs it (vanilla Byzantine and several
      // mod trees do this) gets the same head turned over. Either way the link is
      // recorded as reversed, because that is a property of the script.
      const reversed = tr < sr;
      if (reversed) reversedLinks.push({ from: src.id, to: ref.id });

      if (sc === tc) {
        if (tr > sr) {
          for (let b = sr; b <= tr - 1; b++) {
            pushArrow(sc, b, P.tile);
            if (b < tr - 1) pushArrow(sc, b, P.skipTier);
            else pushArrow(sc, b, P.endCenter);
          }
        } else {
          for (let b = sr - 1; b >= tr + 1; b--) {
            pushArrow(sc, b, P.tile);
            pushArrow(sc, b, P.skipTier);
          }
          pushArrow(sc, tr, { x: P.endCenter.x, y: frameBottom, sprite: P.endCenter.sprite, flip: 'v' });
        }
        continue;
      }

      // Cross-column: a forward link turns in the band directly above the target
      // row, having dropped down the source column; a reversed one turns in the
      // target's own band and runs back up.
      const turn = reversed ? tr : (sr === tr ? sr : tr - 1);
      const lineFrom = reversed ? turn + 1 : sr;
      const lineTo = reversed ? sr - 1 : turn - 1;
      for (let b = lineFrom; b <= lineTo; b++) {
        pushArrow(sc, b, P.tile);
        pushArrow(sc, b, P.skipTier);
      }
      pushArrow(sc, turn, rightward ? P.rightOut : P.leftOut);
      const lo = Math.min(sc, tc) + 1;
      const hi = Math.max(sc, tc) - 1;
      for (let mid = lo; mid <= hi; mid++) pushArrow(mid, turn, P.skipSlot);
      pushArrow(tc, turn, rightward ? P.rightIn : P.leftIn);
      const head = rightward ? P.endLeft : P.endRight;
      pushArrow(tc, turn, reversed
        ? { x: head.x, y: frameBottom, sprite: head.sprite, flip: 'v' }
        : head);
    }
  }

  const total = tree.missions.length;
  const cells = [];
  for (const [key, list] of cellOf) {
    if (cells.length >= MAX_CELLS) break;
    const [slot, row] = key.split(':').map(Number);
    cells.push({
      slot,
      row,
      conflict: list.length > 1,
      missions: list.map((ref) => {
        const iconUrl = ref.icon ? sprites.url(ref.icon) : null;
        return {
          id: ref.id,
          title: missionTitle(index, ref.id),
          icon: ref.icon,
          iconUrl,
          missingIcon: !!(ref.icon && !iconUrl),
          hasTrigger: !!ref.hasTrigger,
          hasEffect: !!ref.hasEffect,
          prereqs: ref.prereqs.slice(),
          dependents: (dependents.get(ref.id) || []).slice(0, 12),
          explicitPosition: !!ref.explicitPosition,
        };
      }),
    });
  }
  cells.sort((a, b) => (a.row - b.row) || (a.slot - b.slot));

  // The chrome the game draws around and on top of every mission. `frames` lets
  // the client crop a strip sprite (`gfx_mission_effect` is 3 frames wide) to
  // the one frame the game would show.
  //
  // `GFX_shield_small` is deliberately not drawn: it is only the empty shield
  // frame, and the flag the engine paints inside it depends on which country the
  // mission is for, which cannot be known without evaluating `potential`.
  const artOf = (sprite) => {
    const info = sprites.info(sprite);
    return info ? { url: info.url, frames: info.frames } : null;
  };
  const missingSprites = sprites.missing;

  return {
    gui: {
      cellW: gui.cellW,
      cellH: gui.cellH,
      title: gui.title,
      icon: gui.icon,
      shield: gui.shield,
      trigger: gui.trigger,
      effect: gui.effect,
      source: gui.source,
      maxSlots: gui.maxSlots,
      maxSlotsConfigured: gui.maxSlotsConfigured,
      panelSlots: gui.panelSlots,
      piecesMatched: gui.piecesMatched === undefined ? null : gui.piecesMatched,
    },
    art: {
      frame: artOf('GFX_mission_icons_frame'),
      trigger: artOf('gfx_mission_trigger'),
      effect: artOf('gfx_mission_effect'),
    },
    // `columns` is how many columns we are willing to draw backplates for;
    // `boardColumns` is how wide the board must be so a slot past the cap is
    // still placed where the script put it instead of being clipped away.
    columns,
    boardColumns: Math.max(columns, tree.maxSlot || 1),
    beyondCap: Array.from(tree.slotsUsed).filter((s) => s > MAX_SLOTS).sort((a, b) => a - b),
    rows,
    slotList: Array.from(tree.slotsUsed).sort((a, b) => a - b),
    cells,
    arrows,
    truncated: total > MAX_CELLS,
    missingSprites,
    missingPrereqs,
    reversedLinks,
    sameCellLinks,
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Fold names the glossary resolved while rendering into the card's table. */
function mergeUsed(card, ctx, field) {
  const refs = card.locRefs || (card.locRefs = []);
  const seen = new Set(refs.map((r) => r.key));
  for (const u of ctx.used || []) {
    if (!u || !u.key || seen.has(u.key)) continue;
    seen.add(u.key);
    refs.push({
      field, key: u.key, found: true, value: u.value,
      file: u.file, line: u.line, origin: u.origin,
    });
  }
}

/** The tree a mission ref belongs to. */
function treeOf(index, ref) {
  return (index.missionTrees || []).find((t) => t.id === ref.treeId) || null;
}

const MISSION_SPEC = {
  titlePatterns: ['{id}_title', '{id}'],
  descPatterns: ['{id}_desc'],
  handledKeys: ['icon', 'has_country_shield', 'generic', 'ai', 'weight', 'is_mission_tree'],
  fieldOmit: ['slot', 'position', 'potential_on_load'],
  linkKinds: { required_missions: 'mission' },
};

/** Attach the game-shaped grid to a card. */
function decorateWithGrid(index, ref, card, lang) {
  const tree = treeOf(index, ref);
  if (!tree) return card;
  const gui = readGui(index);
  const grid = layoutTree(index, tree, gui, lang);
  card.grid = grid;
  card.selectedId = ref.id;
  card.treeName = treeLabel(tree);
  card.treeTags = tree.tags.slice();
  card.treeDlc = tree.dlc.slice();
  card.treeSeries = tree.seriesKeys.slice();
  card.treeFile = tree.file;
  card.treeMissions = tree.missions.length;
  card.treeSlotCount = grid.slotList.length;

  if (tree.potentialNode) {
    const ctx = contentCtx(index, lang);
    ctx.used = [];
    try {
      card.treeConditions = terms.conditionLines(tree.potentialNode, ctx, { indent: 0 });
    } catch { card.treeConditions = null; }
    mergeUsed(card, ctx, 'tree');
  }
  return card;
}

/**
 * One mission: its own conditions and rewards, plus the whole tree it lives in
 * drawn the way the game draws it, with this mission marked as selected.
 */
function buildMission(index, ref, lang) {
  const card = c.buildGenericCard(index, ref, lang, MISSION_SPEC);
  if (!card) return null;
  card.kind = 'mission';
  card.kindLabel = kindLabel('mission', lang);
  card.fields = [
    { key: 'slot', label: pick(L('槽位（列）', 'Slot (column)'), lang), value: String(ref.slot), tone: 'num' },
    {
      key: 'position',
      label: pick(L('位置（行）', 'Position (row)'), lang),
      value: String(ref.position) + (ref.explicitPosition ? '' : pick(L('（按出现次序）', ' (file order)'), lang)),
      tone: 'num',
    },
    ...(card.fields || []),
  ];
  const info = ref.icon ? resolveSpriteInfo(index, ref.icon) : null;
  card.iconUrl = info ? info.url : null;
  card.iconSprite = ref.icon || null;
  card.iconMissing = !!(ref.icon && !info);
  card.prereqIds = ref.prereqs.slice();
  return decorateWithGrid(index, ref, card, lang);
}

/**
 * One tree: the whole grid on its own, with no single mission selected. Used by
 * the "mission trees" tab, where the unit a reader wants is the tree itself.
 */
function buildTree(index, ref, lang) {
  const tree = treeOf(index, ref);
  if (!tree) return null;

  const gui = readGui(index);
  const grid = layoutTree(index, tree, gui, lang);
  const ctx = contentCtx(index, lang);
  ctx.used = [];
  const L2 = c.makeLocRefs(index.resolver, lang);
  const treeConditions = tree.potentialNode
    ? terms.conditionLines(tree.potentialNode, ctx, { indent: 0 })
    : null;

  // The missions as ordinary rows too, so the tree can be read as a list and any
  // one of them can be opened as its own card.
  const missions = tree.missions.slice(0, MAX_CELLS).map((m) => ({
    id: m.id,
    title: missionTitle(index, m.id),
    slot: m.slot,
    position: m.position,
    prereqs: m.prereqs.slice(),
    hasTrigger: !!m.hasTrigger,
    hasEffect: !!m.hasEffect,
    iconMissing: !!(m.icon && !resolveSpriteInfo(index, m.icon)),
  }));

  const refs = L2.refs;
  const seen = new Set(refs.map((r) => r.key));
  for (const u of ctx.used || []) {
    if (!u || !u.key || seen.has(u.key)) continue;
    seen.add(u.key);
    refs.push({
      field: 'tree', key: u.key, found: true, value: u.value,
      file: u.file, line: u.line, origin: u.origin,
    });
  }

  const label = treeLabel(tree);
  return {
    type: ref.type,
    id: ref.id,
    kind: 'mission_tree',
    kindLabel: kindLabel('mission_tree', lang),
    file: ref.file,
    line: ref.line,
    sourceLine: ref.line,
    nameKey: null,
    name: null,
    // A tree has no localisation key of its own; its name is the file plus the
    // tags its `potential` filters on, which reads the same in both languages.
    synthName: { zh: label, en: label },
    descKey: null,
    desc: null,
    spriteName: null,
    spriteUrl: null,
    fields: [
      { key: 'file', label: pick(L('定义文件', 'Defined in'), lang), value: fileStem(ref.file), tone: 'name' },
      { key: 'slots', label: pick(L('占用槽位', 'Slots used'), lang), value: grid.slotList.join(', '), tone: 'num' },
      { key: 'missions', label: pick(L('任务数', 'Missions'), lang), value: String(tree.missions.length), tone: 'num' },
      { key: 'links', label: pick(L('前置连线', 'Prerequisite links'), lang), value: String(grid.arrows.length), tone: 'num' },
    ],
    groups: [],
    missions,
    grid,
    treeName: label,
    treeTags: tree.tags.slice(),
    treeDlc: tree.dlc.slice(),
    treeSeries: tree.seriesKeys.slice(),
    treeFile: tree.file,
    treeMissions: tree.missions.length,
    treeSlotCount: grid.slotList.length,
    treeConditions,
    locRefs: refs,
  };
}

// ---------------------------------------------------------------------------
// The mission-tree list
// ---------------------------------------------------------------------------

/** Tree ids are stable inside one index and only used to address the type. */
function treeRefId(tree) {
  return 'tree#' + tree.id;
}

function collectMissionTrees(index, files) {
  // Idempotent, so this works whatever order the descriptors are collected in.
  collectMissions(index, files);
  index.lists.mission_trees = [];
  if (!index.synthTitles) index.synthTitles = new Map();
  for (const tree of index.missionTrees || []) {
    const id = treeRefId(tree);
    const label = treeLabel(tree);
    const slots = Array.from(tree.slotsUsed).sort((a, b) => a - b).join(',');
    index.lists.mission_trees.push(makeRef('mission_trees', id, tree.file, tree.missions[0] ? tree.missions[0].line : 1, {
      kind: 'mission_tree',
      folder: 'missions/',
      treeId: tree.id,
      missionCount: tree.missions.length,
      slots,
    }));
    index.synthTitles.set('mission_trees:' + id, { zh: label, en: label });
    index.titles.set('mission_trees:' + id, label);
  }
}

function buildMissionTree(index, ref, lang) {
  const tree = (index.missionTrees || []).find((t) => t.id === ref.treeId);
  if (!tree) return null;
  return buildTree(index, ref, lang);
}

module.exports = {
  MAX_SLOTS,
  readGui,
  collectMissions,
  collectMissionTrees,
  buildMission,
  buildMissionTree,
  treeRefId,
  treeLabel,
  missionTitle,
  layoutTree,
};
