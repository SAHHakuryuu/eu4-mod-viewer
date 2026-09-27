'use strict';
/**
 * The Chinese term tables for script conditions, effects and modifiers, parsed
 * at run time out of the offline wiki the user has mounted in Settings.
 *
 * Why this is a parser and not a data file
 * ---------------------------------------
 * Those three tables (`条件.html` / `命令.html` / `修正列表.html`) are community
 * documentation published under **CC BY-NC-SA 4.0** — attribution, *no
 * commercial use*, share-alike. Shipping an extraction of them would drag this
 * repository under that licence and its non-commercial clause, so nothing of the
 * sort is bundled here. The pages are read from the user's own copy, in memory,
 * every run: exactly the rule the viewer already follows for the game's art,
 * which is resolved out of the user's installation and never redistributed.
 *
 * With no offline wiki mounted the tables are empty. Rendering then falls back to
 * the hand-written tables in `src/data/*-curated.js` and finally to the raw
 * script, which is the documented behaviour either way — the tool never invents
 * a term it cannot source.
 *
 * Only the fields the renderer actually reads are kept:
 *
 *   zh    中文名. The effects page has no name column, so a documented effect
 *         keeps `zh: null` and the renderer falls back to the script key.
 *   desc  the page's own explanation, shown as the note beside the line.
 *   mode  modifiers only: 乘法 → 'mul' (0.1 prints as +10%), 加法 → 'add' (a flat
 *         number), 恒定 → null (a boolean flag). This is the *only* source for
 *         that distinction, which is why an unknown modifier must never be
 *         guessed at — see `modifierLines` in `src/gameterms.js`.
 *
 * Nothing here is cached to disk: parsing the three pages takes well under a
 * second and a stale cache would survive the user editing their wiki.
 */

const fs = require('fs');

const wiki = require('./wiki.js');

/** Page basenames, without `.html`, keyed by the glossary they fill. */
const PAGES = { triggers: '条件', effects: '命令', modifiers: '修正列表' };

const PARSERS = {
  triggers: parseTriggers,
  effects: parseEffects,
  modifiers: parseModifiers,
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

/** Named entities the wiki actually emits, plus the two space variants. */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#160': ' ', '#8195': ' ', '#32': ' ',
};

function decodeEntities(s) {
  return String(s).replace(/&(#?[0-9a-zA-Z]+);/g, (whole, code) => {
    if (Object.prototype.hasOwnProperty.call(ENTITIES, code)) return ENTITIES[code];
    if (code.charAt(0) === '#') {
      const hex = code.charAt(1) === 'x' || code.charAt(1) === 'X';
      const n = parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) return String.fromCodePoint(n);
    }
    return whole;
  });
}

/**
 * Visible text of an HTML fragment: entities decoded, space collapsed.
 *
 * Markup is dropped rather than blanked, because that is what a browser renders —
 * `行政点数</a>。` is "行政点数。" and not "行政点数 。". Only the tags that actually
 * separate content (`<br>`, a paragraph, a list item, a `<pre>` line) leave a
 * space behind.
 */
function textOf(html) {
  return decodeEntities(
    String(html)
      .replace(/<\/?(?:br|p|div|li|tr|h[1-6]|pre|blockquote)\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

/**
 * Every top-level `<table>` of a page, as raw html.
 *
 * The pages end with a stack of navigation boxes that are also tables, so the
 * callers below identify the glossary tables by their header row rather than by
 * position — the wiki inserts and reorders sections between versions.
 */
function tables(html) {
  const out = [];
  let cursor = 0;
  for (;;) {
    const start = html.indexOf('<table', cursor);
    if (start < 0) break;
    let depth = 0;
    let at = start;
    let end = -1;
    for (;;) {
      const open = html.indexOf('<table', at + 1);
      const close = html.indexOf('</table>', at + 1);
      if (close < 0) break;
      if (open >= 0 && open < close) { depth++; at = open; continue; }
      if (depth === 0) { end = close + '</table>'.length; break; }
      depth--; at = close;
    }
    if (end < 0) break;
    out.push(html.slice(start, end));
    cursor = end;
  }
  return out;
}

/** `<tr>` contents of a table, header row first. */
function rowsOf(table) {
  return table.split(/<tr[^>]*>/i).slice(1).map((row) => {
    const cut = row.indexOf('</tr>');
    return cut >= 0 ? row.slice(0, cut) : row;
  });
}

/** `<td>`/`<th>` inner html of a row, in document order. */
function cellsOf(row) {
  const out = [];
  const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(row))) out.push(m[1]);
  return out;
}

/** Header cells of a table, as visible text. */
function headOf(table) {
  const rows = rowsOf(table);
  return rows.length ? cellsOf(rows[0]).map(textOf) : [];
}

/**
 * Does this table start with the given header cells? A `null` entry means "any
 * header here", for tables whose middle column the wiki has renamed between
 * revisions (`用法举例` is spelled `举例举例` in two sections).
 */
function headIs(head, want) {
  return want.every((w, i) => w === null || head[i] === w);
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Is this a script command key?
 *
 * Command keys are lower-case snake_case. The pages also carry the odd row for a
 * country tag (`REB` sits in the trigger tables as a scope keyword), which is not
 * a command and is filtered out here.
 */
function isCommandKey(s) {
  return typeof s === 'string' && s !== '' && IDENT.test(s) && s === s.toLowerCase();
}

/**
 * A 语句 cell holds the Chinese name and the script key side by side:
 * `国家代码 tag`. A cell that is only a key documents the key without naming it.
 * Anything else (a merged sub-header, a `<trade good>` placeholder) is not a row.
 *
 * @returns {{zh: string|null, key: string}|null}
 */
function splitNameCell(cell) {
  const text = textOf(cell);
  if (!text) return null;
  const parts = text.split(' ');
  const last = parts[parts.length - 1];
  if (!isCommandKey(last)) return null;
  if (parts.length === 1) return { zh: null, key: last };
  return { zh: parts.slice(0, -1).join(' '), key: last };
}

/**
 * The script key of a row whose 语句 cell is a placeholder — `商品 <trade good>`,
 * `<estate>_influence_modifier`. Such a row still documents a real key: it is
 * written out in the 举例 column (`gold = 2`). Rows that carry no concrete key
 * anywhere stay out of the tables entirely. The wiki leaves a handful of pure
 * templates, and expanding one into every combination the engine accepts would be
 * inventing keys the page never states — the tool does not do that.
 */
function keyFromExample(cell) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(textOf(cell));
  return m ? m[1] : null;
}

/**
 * The 修正描述 column mixes the name with a gloss after a full-width colon
 * (`围城能力：削减防御效率`). Only the part before the colon is a name — the gloss
 * would read as part of the modifier in a `+10% …` line.
 */
function modifierName(text) {
  const name = String(text).split('：')[0].trim();
  return name || null;
}

// ---------------------------------------------------------------------------
// Per-page parsers
// ---------------------------------------------------------------------------

/**
 * `条件.html` — 27 tables shaped
 * `语句 | 参数类型 | 描述 | 作用域 | 举例 | 版本`.
 *
 * The first definition of a key wins, because the page lists a condition once per
 * scope it belongs to and repeats it with the same name.
 */
function parseTriggers(html) {
  const out = {};
  for (const table of tables(html)) {
    if (!headIs(headOf(table), ['语句', '参数类型'])) continue;
    for (const row of rowsOf(table).slice(1)) {
      const cells = cellsOf(row);
      if (cells.length < 2) continue;
      let key = null;
      let zh = null;
      const name = splitNameCell(cells[0]);
      if (name) { key = name.key; zh = name.zh; } else if (cells.length > 4) key = keyFromExample(cells[4]);
      if (!isCommandKey(key) || out[key]) continue;
      out[key] = { zh, desc: textOf(cells[2]) || '' };
    }
  }
  return out;
}

/**
 * `命令.html` — 25 tables shaped
 * `语句 | 参数 | 例子 | 描述 | 备注 | 版本`. There is no Chinese-name column, so
 * every entry keeps `zh: null` and the renderer prints the script key.
 *
 * The 备注 column is dropped: it holds a caveat about engine behaviour rather
 * than a description of the effect, and the note the renderer prints beside a
 * line is a single short gloss. The page is one click away for the rest.
 */
function parseEffects(html) {
  const out = {};
  for (const table of tables(html)) {
    if (!headIs(headOf(table), ['语句', '参数', '例子'])) continue;
    for (const row of rowsOf(table).slice(1)) {
      const cells = cellsOf(row);
      if (cells.length < 4) continue;
      let key = textOf(cells[0]);
      if (!isCommandKey(key)) key = keyFromExample(cells[2]);
      if (!isCommandKey(key) || out[key]) continue;
      out[key] = { zh: null, desc: textOf(cells[3]) };
    }
  }
  return out;
}

/** The wiki's 效果类型 column, which is the only statement of how a value prints. */
const MODE_BY_TYPE = { '乘法': 'mul', '加法': 'add', '恒定': null };

/**
 * `修正列表.html` — 32 tables shaped
 * `修正代码 | 用法举例 | 修正描述 | 效果类型 | 添加修正的版本`, split across
 * sections (陆军/海军/核心/…). The page also carries a table of modifiers that
 * were *removed* and several one-row DLC notes; both are excluded by the header
 * test, which requires the 效果类型 column.
 */
function parseModifiers(html) {
  const out = {};
  for (const table of tables(html)) {
    if (!headIs(headOf(table), ['修正代码', null, '修正描述', '效果类型'])) continue;
    for (const row of rowsOf(table).slice(1)) {
      const cells = cellsOf(row);
      if (cells.length < 4) continue;
      let key = textOf(cells[0]);
      if (!isCommandKey(key)) key = keyFromExample(cells[1]);
      if (!isCommandKey(key) || out[key]) continue;
      const zh = modifierName(textOf(cells[2]));
      const type = textOf(cells[3]);
      out[key] = {
        zh: zh && zh !== key ? zh : null,
        mode: Object.prototype.hasOwnProperty.call(MODE_BY_TYPE, type) ? MODE_BY_TYPE[type] : null,
        desc: '',
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Parsed pages, keyed by the wiki directory they came from (`''` = none). */
const cache = new Map();

/** The wiki directory the current tables were read from, or `''`. */
function cacheKey() {
  return wiki.isEnabled() && wiki.getWikiDir() ? String(wiki.getWikiDir()) : '';
}

/**
 * The glossary for the currently mounted wiki.
 *
 * Never throws and never returns undefined: an unmounted, missing or unreadable
 * wiki yields empty tables plus an `error` the caller can surface.
 */
function load() {
  const key = cacheKey();
  const hit = cache.get(key);
  if (hit) return hit;

  const result = {
    dir: key || null,
    triggers: {},
    effects: {},
    modifiers: {},
    pages: {},
    error: null,
  };

  if (key) {
    for (const [slot, name] of Object.entries(PAGES)) {
      const page = wiki.resolvePage(name);
      if (!page || !page.file) { result.error = result.error || 'page-missing'; continue; }
      let html;
      try {
        html = fs.readFileSync(page.file, 'utf8');
      } catch {
        result.error = result.error || 'read-failed';
        continue;
      }
      const parsed = PARSERS[slot](html);
      result[slot] = parsed;
      result.pages[slot] = { page: `${name}.html`, keys: Object.keys(parsed).length };
      if (!Object.keys(parsed).length) result.error = result.error || 'no-rows';
    }
  }

  cache.set(key, result);
  return result;
}

/** Drop the parsed tables (the wiki folder or its contents changed on disk). */
function clear() {
  cache.clear();
}

/** Entry counts and provenance, for the status line in the UI. */
function stats() {
  const g = load();
  return {
    wiki: Boolean(g.dir),
    dir: g.dir,
    error: g.error,
    pages: g.pages,
    counts: {
      triggers: Object.keys(g.triggers).length,
      effects: Object.keys(g.effects).length,
      modifiers: Object.keys(g.modifiers).length,
    },
  };
}

module.exports = {
  load,
  clear,
  stats,
  cacheKey,
  // exported for tests
  textOf,
  decodeEntities,
  tables,
  rowsOf,
  cellsOf,
  headOf,
  headIs,
  splitNameCell,
  keyFromExample,
  parseTriggers,
  parseEffects,
  parseModifiers,
  MODE_BY_TYPE,
};
