'use strict';
/**
 * EU4 rich-text markup → serialisable nodes.
 *
 * Localisation values are not plain strings. The engine interprets:
 *
 *   §X … §!        colour codes (§Y gold, §R red, §G green, §B blue, §W white,
 *                  §b black, §g grey, §O orange, §P purple; §! ends the run)
 *   £icon_name£    an icon/graphic escape (rendered from `interface/*.gfx`)
 *   \n             a line break (stored literally as backslash-n)
 *   $KEY$          substitution of another localisation key's text
 *   [Root.GetName] a dynamic, runtime-evaluated command reference
 *
 * `renderRich` turns that into a flat node list the front end can render without
 * knowing any of the above. Substituted keys are resolved through the mod's
 * localisation index and are reported back to the caller so a view can show the
 * script→localisation correspondence alongside the pretty text.
 */

const { L, pick } = require('./i18n.js');

/** § colour letters → CSS class suffix. Unlisted letters fall through as-is. */
const COLOR_CLASSES = {
  '!': null,          // end of coloured run
  Y: 'gold',
  R: 'red',
  G: 'green',
  B: 'blue',
  W: 'white',
  b: 'black',
  g: 'grey',
  O: 'orange',
  P: 'purple',
  M: 'magenta',
  T: 'teal',
  S: 'steel',
  I: 'indigo',
  J: 'jade',
  l: 'grey',
  V: 'violet',
};

/**
 * `$KEY$` tokens that are engine keywords rather than localisation keys. They
 * cannot be resolved statically — the value depends on the runtime scope — so
 * they are shown as a labelled placeholder instead of an error.
 *
 * Every label is a `{ zh, en }` pair resolved from `opts.lang`.
 */
const ENGINE_VARS = {
  COUNTRY: L('当前国家名', 'current country name'),
  CAPITAL: L('当前首都名', 'current capital name'),
  RELIGION: L('当前宗教名', 'current religion name'),
  CULTURE: L('当前文化名', 'current culture name'),
  TAG: L('当前国家 TAG', 'current country tag'),
  MONARCH: L('君主姓名', 'monarch name'),
  HEIR: L('继承人姓名', 'heir name'),
  CONSORT: L('配偶姓名', 'consort name'),
  ADM: L('行政点数', 'adm power'),
  DIP: L('外交点数', 'dip power'),
  MIL: L('军事点数', 'mil power'),
  YEAR: L('当前年份', 'current year'),
  MONTH: L('当前月份', 'current month'),
  DAY: L('当前日期', 'current day'),
  PROVINCE: L('当前省份名', 'current province name'),
  ESTATE: L('当前阶层名', 'current estate name'),
  RULER: L('统治者名', 'ruler name'),
  ADVISOR: L('顾问名', 'advisor name'),
  GENERAL: L('将领名', 'general name'),
  ADMIRAL: L('海军将领名', 'admiral name'),
  UNIT: L('部队名', 'unit name'),
  TRADEGOOD: L('贸易商品名', 'trade good name'),
  OVERLORD: L('宗主国名', 'overlord name'),
  SUBJECT: L('附属国名', 'subject name'),
  NUM: L('数字', 'number'),
  VALUE: L('运行时数值', 'runtime value'),
  VAL: L('运行时数值', 'runtime value'),
  ESTATE_NAME: L('阶层名', 'estate name'),
  PROVINCE_NAME: L('省份名', 'province name'),
  COUNTRY_NAME: L('国名', 'country name'),
};

/**
 * Placeholders the engine fills in at runtime that also happen to collide with
 * a real localisation key. `$VAL$` is the classic case: it appears in every
 * `EST_VAL_*` estate tooltip, and `VAL` is also the country tag of Valencia, so
 * resolving it from localisation would print "Valencia" where the game prints a
 * number. These are checked before the localisation lookup.
 */
const RUNTIME_ONLY_VARS = new Set([
  'VAL', 'VALUE', 'ESTATE_NAME', 'PROVINCE_NAME', 'COUNTRY_NAME',
]);

/** Common dynamic commands, explained for the reader. */
const DYNAMIC_HINTS = [
  [/^Root\.GetName$/, L('本国国名', 'root country name')],
  [/^Root\.GetAdjective$/, L('本国形容词', 'root country adjective')],
  [/^This\.GetName$/, L('当前作用域名称', 'current scope name')],
  [/^From\.GetName$/, L('来源国国名', 'from country name')],
  [/^Root\.Monarch\.GetName$/, L('君主姓名', 'monarch name')],
  [/^Root\.Monarch\.GetTitle$/, L('君主头衔', 'monarch title')],
  [/^Root\.Heir\.GetName$/, L('继承人姓名', 'heir name')],
  [/^Root\.Consort\.GetName$/, L('配偶姓名', 'consort name')],
  [/^Root\.Capital\.GetName$/, L('首都省份名', 'capital province name')],
  [/^Root\.GetCapitalName$/, L('首都省份名', 'capital province name')],
  [/^Root\.Religion\.GetName$/, L('国教名称', 'state religion name')],
  [/^Root\.Culture\.GetName$/, L('主流文化名称', 'primary culture name')],
  [/^Root\.GetTag$/, L('国家 TAG', 'country tag')],
  [/^Root\.GetMonarchAge$/, L('君主年龄', 'monarch age')],
  [/^Root\.GetAdm$/, L('君主行政能力', 'monarch adm skill')],
  [/^Root\.GetDip$/, L('君主外交能力', 'monarch dip skill')],
  [/^Root\.GetMil$/, L('君主军事能力', 'monarch mil skill')],
  [/^Root\.GetCountryModifierDuration$/, L('国家修正剩余天数', 'days left on country modifier')],
];

/** The explanation shown when no known pattern matches a `[Dynamic.Command]`. */
const DYNAMIC_FALLBACK = L('游戏运行时替换', 'evaluated by the game at runtime');

function dynamicHint(expr, lang) {
  for (const [re, pair] of DYNAMIC_HINTS) if (re.test(expr)) return pick(pair, lang);
  return pick(DYNAMIC_FALLBACK, lang);
}

const VAR_RE = /\$([A-Za-z0-9_.\-]+)\$/g;
const DYN_RE = /\[([^\[\]]+)\]/g;

/**
 * Render a localisation value into nodes.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {{text:(k:string)=>string|undefined, lookup:(k:string)=>object|undefined}} [opts.resolver]
 * @param {string} [opts.lang]    `'zh'` or `'en'`; `undefined` means `'zh'`
 * @param {number} [opts.depth]  recursion guard for `$KEY$` chains
 * @param {Set<string>} [opts.seen] cycle guard
 * @param {Array} [opts.used]    collects {key, value, file, line, origin} for
 *                               every key the text pulled in
 * @returns {Array<object>} nodes
 */
function renderRich(text, opts = {}) {
  const resolver = opts.resolver || null;
  const lang = opts.lang;
  const depth = opts.depth || 0;
  const seen = opts.seen || new Set();
  const used = opts.used || [];

  const out = [];
  if (text === null || text === undefined) return out;
  const src = String(text);

  let color = null;
  let plain = '';

  const flush = () => {
    if (plain) { out.push({ k: 't', s: plain, c: color }); plain = ''; }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // --- colour ---------------------------------------------------------
    if (ch === '\u00a7') {           // §
      const code = src[i + 1];
      if (code === undefined) { plain += ch; i++; continue; }
      flush();
      if (code === '!') color = null;
      else if (code in COLOR_CLASSES) color = COLOR_CLASSES[code];
      else color = code;             // unknown letter: keep it as a class
      i += 2;
      continue;
    }

    // --- line break -----------------------------------------------------
    if (ch === '\\' && (src[i + 1] === 'n' || src[i + 1] === 'N')) {
      flush();
      out.push({ k: 'br' });
      i += 2;
      continue;
    }

    // --- icon escape ----------------------------------------------------
    if (ch === '\u00a3') {           // £
      const end = src.indexOf('\u00a3', i + 1);
      if (end > i) {
        flush();
        out.push({ k: 'i', s: src.slice(i + 1, end), c: color });
        i = end + 1;
        continue;
      }
    }

    // --- $KEY$ substitution --------------------------------------------
    if (ch === '$') {
      VAR_RE.lastIndex = i;
      const m = VAR_RE.exec(src);
      if (m && m.index === i) {
        flush();
        const key = m[1];
        if (RUNTIME_ONLY_VARS.has(key)) {
          out.push({ k: 'e', s: key, zh: pick(ENGINE_VARS[key], lang), c: color });
          i = m.index + m[0].length;
          continue;
        }
        const value = resolver ? resolver.text(key) : undefined;
        if (value !== undefined && !seen.has(key) && depth < 6) {
          const prov = resolver.lookup(key);
          used.push({ key, value, file: prov.file, line: prov.line, origin: prov.origin });
          seen.add(key);
          const inner = renderRich(value, { ...opts, depth: depth + 1, seen, used, resolver });
          for (const n of inner) out.push(n.c === undefined && n.k !== 'br' ? n : n);
        } else if (value !== undefined) {
          out.push({ k: 'v', s: value, key, c: color });
        } else if (ENGINE_VARS[key]) {
          // An engine keyword such as $COUNTRY$: real in game, but only the
          // running game knows its value.
          out.push({ k: 'e', s: key, zh: pick(ENGINE_VARS[key], lang), c: color });
        } else {
          out.push({ k: 'x', s: key, key, c: color });
        }
        i = m.index + m[0].length;
        continue;
      }
    }

    // --- [Dynamic.Command] ---------------------------------------------
    if (ch === '[') {
      DYN_RE.lastIndex = i;
      const m = DYN_RE.exec(src);
      if (m && m.index === i) {
        flush();
        out.push({ k: 'd', s: m[1], zh: dynamicHint(m[1], lang), c: color });
        i = m.index + m[0].length;
        continue;
      }
    }

    plain += ch;
    i++;
  }

  flush();
  return out;
}

/** Flat text of a node list (search, tooltips, titles). */
function plainText(nodes) {
  if (!Array.isArray(nodes)) return '';
  let s = '';
  for (const n of nodes) {
    if (n.k === 'br') s += '\n';
    else if (n.k === 'v' || n.k === 'x') s += n.key ? `$${n.key}$` : '';
    else if (n.k === 'd') s += `[${n.s}]`;
    else if (n.k === 'i') s += `£${n.s}£`;
    else s += n.s || '';
  }
  return s;
}

/** Text as the player reads it, with `$KEY$` already substituted. */
function displayText(nodes) {
  if (!Array.isArray(nodes)) return '';
  let s = '';
  for (const n of nodes) {
    if (n.k === 'br') s += '\n';
    else if (n.k === 'd') s += `[${n.s}]`;
    else if (n.k === 'i') s += '';
    else if (n.k === 'x') s += `$${n.key}$`;
    else s += n.s || '';
  }
  return s;
}

/** Plain-string convenience wrapper for callers that have no resolver. */
function richFromString(text) {
  return renderRich(text, {});
}

module.exports = {
  renderRich, plainText, displayText, richFromString, dynamicHint,
  COLOR_CLASSES, ENGINE_VARS,
};
