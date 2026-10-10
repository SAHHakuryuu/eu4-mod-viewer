'use strict';
/**
 * Backend language layer.
 *
 * The viewer renders EU4 script as the game would show it, and every human
 * label it prints on the way — field names, scope nouns, glossary fallbacks —
 * exists in Chinese and English. This module is the single place that decides
 * which one to emit.
 *
 * Design rules:
 *   - Never invent a term. Where the wiki-derived Chinese glossary is the only
 *     source, non-Chinese modes fall back to the raw script identifier, which is
 *     exactly the name the English EU4 wiki and the game's own script use.
 *   - A `pair` in the source is always `{ zh, en }` — that is what `L()` builds,
 *     and it keeps ~700 call sites readable. The seven further languages live in
 *     a side table (`src/data/locales/<lang>.json`) keyed by the **English**
 *     string, so a new language never has to touch a call site. `pick` consults
 *     it automatically, which is why every existing label becomes translatable
 *     by translating one JSON file.
 *   - `pick` degrades gracefully: requested language -> side table -> English ->
 *     Chinese -> first non-empty value.
 */

/** Supported UI languages, in menu order. */
const LANGS = ['zh', 'en', 'fr', 'de', 'es', 'pt', 'ru', 'ja', 'ko'];
/** Languages that exist only as a side table (no `{ zh, en }` pair entries). */
const EXTRA_LANGS = LANGS.filter((l) => l !== 'zh' && l !== 'en');
const DEFAULT_LANG = 'zh';
const FALLBACK_LANG = 'en';

/**
 * Language menu labels, always in the language's own script: a language picker
 * is the one place where a translation is never wanted.
 */
const LANG_LABELS = {
  zh: { zh: '中文', en: '中文' },
  en: { zh: 'English', en: 'English' },
  fr: { zh: 'Français', en: 'Français' },
  de: { zh: 'Deutsch', en: 'Deutsch' },
  es: { zh: 'Español', en: 'Español' },
  pt: { zh: 'Português', en: 'Português' },
  ru: { zh: 'Русский', en: 'Русский' },
  ja: { zh: '日本語', en: '日本語' },
  ko: { zh: '한국어', en: '한국어' },
};

/** Accepted spellings/regional tags per language, longest-prefix match first. */
const LANG_ALIASES = {
  zh: ['zh', 'cn', 'chs', 'cht', 'chi', 'zho'],
  en: ['en', 'eng'],
  fr: ['fr', 'fra', 'fre'],
  de: ['de', 'deu', 'ger'],
  es: ['es', 'spa'],
  pt: ['pt', 'por'],
  ru: ['ru', 'rus'],
  ja: ['ja', 'jp', 'jpn'],
  ko: ['ko', 'kor'],
};

/** Build a bilingual pair. */
function L(zh, en) {
  return { zh, en: en === undefined ? zh : en };
}

// ---------------------------------------------------------------------------
// Side tables
// ---------------------------------------------------------------------------

/**
 * `{ <english label>: <translated label> }` per extra language.
 *
 * Loaded lazily and defensively: a language file may legitimately be absent (a
 * fresh checkout before `tools/build-langs.js` has run, or a packager who ships
 * only some languages), and a missing table must degrade to English rather than
 * throw.
 */
const TABLES = new Map();

function tableFor(lang) {
  if (!EXTRA_LANGS.includes(lang)) return null;
  if (TABLES.has(lang)) return TABLES.get(lang);
  let table = null;
  try {
    // eslint-disable-next-line global-require
    table = require('./data/locales/' + lang + '.json');
  } catch {
    table = null;
  }
  if (!table || typeof table !== 'object') table = null;
  TABLES.set(lang, table);
  return table;
}

/** Coerce anything (query param, config value, Accept-Language) to a language. */
function normalizeLang(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return DEFAULT_LANG;
  if (s === 'auto') return DEFAULT_LANG;
  // Match on the primary subtag, so `pt-BR`, `zh-Hans-CN` and `ja_JP` all land.
  const primary = s.split(/[-_]/)[0];
  if (primary === 'cn') return 'zh';
  for (const lang of LANGS) {
    if (primary === lang) return lang;
  }
  for (const lang of LANGS) {
    if ((LANG_ALIASES[lang] || []).includes(primary)) return lang;
  }
  return DEFAULT_LANG;
}

/**
 * Resolve a pair (or a plain string) to the requested language.
 *
 * An explicitly present key always wins — including an empty string, which is
 * how a caller says "this label genuinely has no English form". Only a *missing*
 * key falls back.
 */
function pick(pair, lang) {
  if (pair == null) return '';
  if (typeof pair === 'string') return pair;
  const l = normalizeLang(lang);
  const has = (k) => Object.prototype.hasOwnProperty.call(pair, k);
  if (has(l)) return pair[l];

  const en = has(FALLBACK_LANG) ? pair[FALLBACK_LANG] : null;
  if (l !== FALLBACK_LANG && typeof en === 'string' && en) {
    const table = tableFor(l);
    if (table && Object.prototype.hasOwnProperty.call(table, en)) {
      const hit = table[en];
      if (typeof hit === 'string' && hit) return hit;
    }
  }

  if (has(FALLBACK_LANG)) return pair[FALLBACK_LANG];
  if (has(DEFAULT_LANG)) return pair[DEFAULT_LANG];
  for (const k of Object.keys(pair)) if (pair[k]) return pair[k];
  return '';
}

function isEn(lang) {
  return normalizeLang(lang) === 'en';
}

/**
 * `pick()` plus `{name}` substitution.
 *
 * Synthetic titles such as `Administrative technology 5` must be translated as a
 * *template* (`Administrative technology {n}`) because the number's position
 * moves between languages — `行政科技 5 级` puts the level behind a counter word
 * that English does not have.
 */
function pickVars(pair, lang, vars) {
  let out = pick(pair, lang);
  if (vars && typeof out === 'string' && out.includes('{')) {
    out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
  }
  return out;
}

/**
 * "Do not consult the Chinese glossary."
 *
 * The wiki-derived term tables are Chinese-only, so every language other than
 * Chinese shows the raw script identifier — the name the English wiki and the
 * game's own script use. That is the honest fallback for French, Russian or
 * Japanese too: `pick()` still translates the *chrome* around the identifier.
 */
function usesRawTerms(lang) {
  return normalizeLang(lang) !== DEFAULT_LANG;
}

/**
 * `core_creation` -> `Core creation`, `adm_tech` -> `Adm tech`.
 * Used only where a readable English label is wanted and the raw identifier
 * would sit alone in a table header.
 */
function prettyKey(key) {
  const s = String(key == null ? '' : key);
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The English name of a script identifier.
 *
 * The wiki-derived glossary is Chinese-only, so in English mode we surface the
 * identifier itself rather than a machine translation. `raw` is preferred when
 * the glossary carried the canonical spelling.
 */
function enTermName(raw, fallback) {
  return raw || fallback || '';
}

/** Server-produced messages (errors, notices, status lines). */
const MESSAGES = {
  'error.missingName': L('缺少参数 name', 'missing name'),
  'error.missingPath': L('缺少参数 path', 'missing path'),
  'error.missingId': L('缺少参数 id', 'missing id'),
  'error.forbidden': L('禁止访问', 'forbidden'),
  'error.notFound': L('未找到', 'not found'),
  'error.unknownRoute': L('未知的 API 路由', 'unknown API route'),
  'error.modNotFound': L('未找到模组', 'mod not found'),
  'error.fileNotFound': L('未找到文件', 'file not found'),
  'error.textureNotFound': L('未找到贴图', 'texture not found'),
  'error.iconNotFound': L('未找到图标', 'icon not found'),
  'error.unsupportedDds': L('不支持的 DDS 格式', 'unsupported DDS format'),
  'error.noWikiRoot': L('离线 wiki 未启用或不可用', 'offline wiki is not enabled or not available'),
  'error.wikiPageNotFound': L('未找到 wiki 页面', 'wiki page not found'),
  'error.unknownContentType': L('未知的内容类型', 'unknown content type'),
  'error.contentNotFound': L('未找到该内容', 'content not found'),
  'error.noRoot': L('没有可用的根目录', 'no such root'),
  'error.badDir': L('目录不存在或不可读', 'directory does not exist or is unreadable'),
  'error.badPath': L('路径不合法', 'invalid path'),
};

/** Look up a server message. Unknown keys return the key itself. */
function msg(lang, key, vars) {
  const pair = MESSAGES[key];
  let out = pair ? pick(pair, lang) : key;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
  }
  return out;
}

module.exports = {
  LANGS,
  EXTRA_LANGS,
  DEFAULT_LANG,
  FALLBACK_LANG,
  LANG_LABELS,
  LANG_ALIASES,
  MESSAGES,
  L,
  pick,
  pickVars,
  isEn,
  usesRawTerms,
  tableFor,
  normalizeLang,
  prettyKey,
  enTermName,
  msg,
};
