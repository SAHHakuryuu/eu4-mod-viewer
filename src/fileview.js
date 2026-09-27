'use strict';
/**
 * Reads individual files out of a scanned mod and turns them into something the
 * viewer can render: decoded localisation, a parsed script tree, or a preview
 * for binary assets.
 */

const fs = require('fs');
const path = require('path');

const loc = require('./codec/localisation.js');
const { parseScript } = require('./codec/script.js');
const tax = require('./taxonomy.js');
const { L, pick, normalizeLang } = require('./i18n.js');

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

/** Messages this module can attach to a render payload. */
const NOTES = {
  previewVia: L(
    '原文件为 {ext}（浏览器无法直接显示），此处预览同名的 {cand} 文件。',
    'The source file is {ext}, which browsers cannot display; showing the sibling {cand} file instead.',
  ),
  binaryAsset: L('二进制资源，不解析内容', 'Binary asset — contents are not parsed'),
  tooLarge: L('文件过大（{mb} MB），未加载', 'File is too large ({mb} MB) — not loaded'),
  readFailed: L('读取失败: {msg}', 'Read failed: {msg}'),
  looksBinary: L('疑似二进制内容', 'Looks like binary content'),
};

/** Fill `{name}` placeholders in an already-resolved message. */
function fill(text, vars) {
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

const say = (lang, key, vars) => fill(pick(NOTES[key], lang), vars);

// Formats browsers can render directly.
const WEB_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);

/**
 * Find a browser-renderable preview for a binary asset.
 *
 * `.dds` is the format EU4 uses for most textures and no browser decodes it, but
 * many mods keep a `.tga`/`.png` sibling with the same basename. We use that when
 * it exists and is small enough to be worth shipping to the client.
 */
function findImagePreview(mod, rel, size, lang) {
  const ext = path.extname(rel).toLowerCase();
  const url = (p) => `/api/mod/${encodeURIComponent(mod.id)}/raw?path=${encodeURIComponent(p)}`;

  if (WEB_IMAGE_EXT.has(ext)) {
    if (size > MAX_PREVIEW_BYTES) return null;
    return { url: url(rel), via: 'direct', note: null };
  }

  if (size > MAX_PREVIEW_BYTES) return null;

  const stem = rel.slice(0, rel.length - ext.length);
  for (const cand of ['.png', '.jpg', '.jpeg', '.bmp', '.gif']) {
    if (!WEB_IMAGE_EXT.has(cand)) continue;
    const sibling = stem + cand;
    const abs = resolveInside(mod.root, sibling);
    if (!abs || !fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_PREVIEW_BYTES) continue;
    return {
      url: url(sibling),
      via: sibling,
      note: say(lang, 'previewVia', { ext: ext.toUpperCase(), cand: cand.toUpperCase() }),
    };
  }

  return null;
}

/** Resolve a mod-relative path safely inside the mod root. */
function resolveInside(root, rel) {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null;
  return abs;
}

function countLines(s) {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * Load and decode one file.
 * Returns { rel, size, binary, category, kind, ... } with a `render` payload.
 */
function loadFile(mod, rel, lang) {
  const l = normalizeLang(lang);
  const abs = resolveInside(mod.root, rel);
  if (!abs || !fs.existsSync(abs)) return null;

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) return null;

  const cat = tax.classify(rel);
  const kind = tax.parserKind(rel);
  const binary = tax.isBinary(rel);

  const base = {
    rel,
    size: stat.size,
    binary,
    category: { id: cat.id, zh: cat.zh, en: cat.en, icon: cat.icon, wiki: cat.wiki },
    kind,
    ext: path.extname(rel).toLowerCase(),
  };

  if (binary) {
    // Many mods ship `.dds` textures (which browsers cannot decode) alongside a
    // `.tga` sibling, or already use a web-friendly format. Offer a preview
    // when either is the case.
    const preview = findImagePreview(mod, rel, stat.size, l);
    return {
      ...base,
      render: preview
        ? {
            type: 'image',
            url: preview.url,
            via: preview.via,
            note: preview.note,
            message: preview.note,
          }
        : { type: 'binary', message: say(l, 'binaryAsset') },
    };
  }

  if (stat.size > MAX_TEXT_BYTES) {
    return {
      ...base,
      render: { type: 'tooLarge', message: say(l, 'tooLarge', { mb: (stat.size / 1048576).toFixed(1) }) },
    };
  }

  let buf;
  try { buf = fs.readFileSync(abs); } catch (e) {
    return { ...base, render: { type: 'error', message: say(l, 'readFailed', { msg: e.message }) } };
  }

  // --- Localisation -------------------------------------------------------
  if (kind === 'localisation') {
    const encoding = loc.detectEncoding(buf);
    const text = loc.decodeBuffer(buf);
    const parsed = loc.parseLocalisation(text);
    const entries = [...parsed.entries.entries()].map(([key, v]) => ({
      key, value: v.value, version: v.version, line: v.line,
    }));
    return {
      ...base,
      render: {
        type: 'localisation',
        language: parsed.language,
        encoding,
        encoded: encoding !== 'plain-utf8',
        entryCount: entries.length,
        malformed: parsed.malformed,
        entries,
      },
    };
  }

  // --- CSV ----------------------------------------------------------------
  if (kind === 'csv') {
    // `map/definition.csv` in Chinese mods is GBK, not UTF-8.
    const encoding = loc.detectEncoding(buf);
    const text = loc.decodeBuffer(buf);
    const rows = text.split(/\r?\n/).filter((l) => l.length).map((l) => l.split(';'));
    return {
      ...base,
      render: {
        type: 'csv',
        encoding,
        rows: rows.slice(0, 5000),
        rowCount: rows.length,
        truncated: rows.length > 5000,
      },
    };
  }

  // --- Descriptor (.mod) --------------------------------------------------
  if (kind === 'descriptor') {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    return { ...base, render: { type: 'script', root: parseScript(text), source: text } };
  }

  // --- Clausewitz script --------------------------------------------------
  if (kind === 'script') {
    // Script files may carry the raw private CJK encoding (invalid UTF-8), so
    // always run them through the codec before parsing.
    const encoding = loc.detectEncoding(buf);
    const text = loc.decodeBuffer(buf);
    let tree = null;
    let parseError = null;
    try { tree = parseScript(text); } catch (e) { parseError = e.message; }
    return {
      ...base,
      render: {
        type: 'script',
        root: tree,
        source: text,
        encoding,
        lineCount: countLines(text),
        parseError,
        entryCount: tree ? tree.entries.length : 0,
      },
    };
  }

  // --- Everything else: show as text if it looks textual ------------------
  const sample = buf.slice(0, 4096);
  let suspicious = 0;
  for (const b of sample) if (b === 0) suspicious++;
  if (suspicious > 0) {
    return { ...base, render: { type: 'binary', message: say(l, 'looksBinary') } };
  }
  const encoding = loc.detectEncoding(buf);
  const text = loc.decodeBuffer(buf);
  return { ...base, render: { type: 'text', source: text, encoding, lineCount: countLines(text) } };
}

module.exports = { loadFile, resolveInside, MAX_TEXT_BYTES };
