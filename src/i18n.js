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
 *     source, English mode falls back to the raw script identifier, which is
 *     exactly the name the English EU4 wiki and the game's own script use.
 *   - A `pair` is always `{ zh, en }`; `pick` degrades gracefully if a language
 *     is missing (zh -> en -> first non-empty value).
 */

/** Supported UI languages, in menu order. */
const LANGS = ['zh', 'en'];
const DEFAULT_LANG = 'zh';
const LANG_LABELS = {
  zh: { zh: '中文', en: 'Chinese' },
  en: { zh: 'English', en: 'English' },
};

/** Build a bilingual pair. */
function L(zh, en) {
  return { zh, en: en === undefined ? zh : en };
}

/** Coerce anything (query param, config value, Accept-Language) to a language. */
function normalizeLang(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return DEFAULT_LANG;
  if (s === 'auto') return DEFAULT_LANG;
  if (s.startsWith('en')) return 'en';
  if (s.startsWith('zh') || s.startsWith('cn')) return 'zh';
  return DEFAULT_LANG;
}

/**
 * Resolve a pair (or a plain string) to the requested language.
 *
 * An explicitly present key always wins — including an empty string, which is
 * how a caller says "this label genuinely has no English form". Only a *missing*
 * key falls back (requested language -> Chinese -> any non-empty value).
 */
function pick(pair, lang) {
  if (pair == null) return '';
  if (typeof pair === 'string') return pair;
  const l = normalizeLang(lang);
  const has = (k) => Object.prototype.hasOwnProperty.call(pair, k);
  if (has(l)) return pair[l];
  if (has(DEFAULT_LANG)) return pair[DEFAULT_LANG];
  for (const k of Object.keys(pair)) if (pair[k]) return pair[k];
  return '';
}

function isEn(lang) {
  return normalizeLang(lang) === 'en';
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
  DEFAULT_LANG,
  LANG_LABELS,
  MESSAGES,
  L,
  pick,
  isEn,
  normalizeLang,
  prettyKey,
  enTermName,
  msg,
};
