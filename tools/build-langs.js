'use strict';
/**
 * Translation pipeline for the seven additional languages.
 *
 *   node tools/build-langs.js split     cut the sources into translator-sized chunks
 *   node tools/build-langs.js delta     cut only the *new* keys into delta/<lang>.<kind>.json
 *   node tools/build-langs.js merge     assemble chunks into the shipped language files
 *   node tools/build-langs.js verify    audit one language's unmerged delta files
 *   node tools/build-langs.js check     coverage + placeholder + fallback audit
 *   node tools/build-langs.js status    per-language progress at a glance
 *
 * Why chunks: every string of a language is translated by one agent so the
 * terminology stays consistent, but a whole language (≈1050 strings) does not
 * fit in a single message. Chunk files are small enough to read and write one
 * at a time, and `merge` refuses to ship a half-filled file.
 *
 * Key spaces (see tools/i18n-extract.js):
 *   backend   key = English label  -> src/data/locales/<lang>.json, read by `pick()`
 *   frontend  key = Chinese source -> src/data/locales/frontend.<lang>.json, and
 *                                     generated into web/lang/<lang>.js for the browser
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOC = path.join(ROOT, 'src', 'data', 'locales');
const WORK = path.join(LOC, '_work');
const OUT = path.join(WORK, 'out');
/** Late-round keys: written by `delta`, read by `merge` on top of `out/`. */
const DELTA = path.join(WORK, 'delta');
const WEB_LANG = path.join(ROOT, 'web', 'lang');

/** Languages that need a side table, in menu order (mirrors src/i18n.js). */
const EXTRA_LANGS = ['fr', 'de', 'es', 'pt', 'ru', 'ja', 'ko'];

/** Chunk sizes: small enough for one comfortable read+write round trip. */
const BACKEND_CHUNKS = 6;
const FRONTEND_CHUNKS = 3;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function chunkNames(kind) {
  const n = kind === 'backend' ? BACKEND_CHUNKS : FRONTEND_CHUNKS;
  const width = String(n).length;
  return Array.from({ length: n }, (_, i) => String(i + 1).padStart(width, '0'));
}

function splitMap(map, count) {
  const keys = Object.keys(map);
  const size = Math.ceil(keys.length / count);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const slice = {};
    for (const k of keys.slice(i * size, (i + 1) * size)) slice[k] = map[k];
    parts.push(slice);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

function split() {
  // A first round cuts every string. A *later* round only ever needs `delta`,
  // and re-splitting throws away both the translated chunks of the round before
  // and the per-language delta files, so it has to be asked for explicitly — a
  // bare `node tools/build-langs.js` used to be enough to lose a day of work.
  const populated = ['out', 'delta'].filter((d) => {
    const p = path.join(WORK, d);
    try { return fs.readdirSync(p).length > 0; } catch { return false; }
  });
  if (populated.length && !process.argv.includes('--force')) {
    console.error(`split would delete the existing translations in _work/${populated.join(', ')}.`);
    console.error('A late round wants `node tools/build-langs.js delta` instead.');
    console.error('Re-run as `node tools/build-langs.js split --force` if you really mean to re-cut everything.');
    process.exit(2);
  }
  const backend = readJson(path.join(LOC, '_source.backend.json'));
  const frontend = readJson(path.join(LOC, '_source.frontend.json'));
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const backendParts = splitMap(backend, BACKEND_CHUNKS);
  const frontendParts = splitMap(frontend, FRONTEND_CHUNKS);
  chunkNames('backend').forEach((id, i) => writeJson(path.join(WORK, `backend.${id}.json`), backendParts[i]));
  chunkNames('frontend').forEach((id, i) => writeJson(path.join(WORK, `frontend.${id}.json`), frontendParts[i]));

  console.log(`split ${Object.keys(backend).length} backend keys into ${BACKEND_CHUNKS} chunks`);
  console.log(`split ${Object.keys(frontend).length} frontend keys into ${FRONTEND_CHUNKS} chunks`);
  console.log(`chunks are under ${path.relative(ROOT, WORK).replace(/\\/g, '/')}/`);
  console.log('each language writes out/<lang>.<kind>.<NN>.json with exactly the same keys');
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

/**
 * Read every chunk a language produced, over a previously shipped table.
 *
 * The numbered chunks of the first round plus, when a later round added UI
 * strings, the single `delta/<lang>.<kind>.json` file `delta` writes. A chunk
 * that is absent is reported, but only a *key* that stays missing after the
 * merge is fatal — see `merge()`.
 */
function readChunks(lang, kind, existing) {
  const merged = Object.assign({}, existing || {});
  const missing = [];
  const extra = [];
  const source = readJson(path.join(LOC, `_source.${kind}.json`));
  const isFrontend = kind === 'frontend';
  const files = chunkNames(kind).map((id) => path.join(OUT, `${lang}.${kind}.${id}.json`));
  files.push(path.join(DELTA, `${lang}.${kind}.json`));
  const deltaFile = files.length - 1;
  let fromChunks = 0;
  let aligned = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!fs.existsSync(file)) {
      // A later round never re-splits the numbered chunks, so their absence is
      // only worth reporting when the shipped table cannot cover them anyway.
      if (i !== deltaFile) missing.push(`${kind}.${chunkNames(kind)[i]}`);
      continue;
    }
    let part;
    try {
      part = readJson(file);
    } catch (e) {
      throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${e.message}`);
    }
    for (const [k, v] of Object.entries(part)) {
      if (typeof v !== 'string') throw new Error(`${lang} ${kind}: value for ${JSON.stringify(k)} is not a string`);
      // For a frontend entry the key is Chinese, so the English text is the
      // shape the code was written against.
      const shape = isFrontend && typeof source[k] === 'string' ? source[k] : k;
      const fixed = alignEdges(v, shape);
      if (fixed !== v) aligned++;
      merged[k] = fixed;
      fromChunks++;
    }
  }
  for (const k of Object.keys(merged)) {
    if (!Object.prototype.hasOwnProperty.call(source, k)) extra.push(k);
  }
  // Drop anything the current source no longer defines.
  for (const k of extra) delete merged[k];
  extra.length = 0;
  return { merged, missing, extra, source, fromChunks, aligned };
}

/**
 * Assemble one language.
 *
 * The merge is *additive*: the previously shipped file is the base and the
 * chunks overwrite it. That is what makes a late translation round possible —
 * when new UI strings appear, only the new keys are chunked, translated and
 * merged, and the strings already translated are never re-requested. Keys that
 * no longer exist in the source are dropped, so a removed label cannot linger.
 */
function merge() {
  fs.mkdirSync(WEB_LANG, { recursive: true });
  const report = [];
  for (const lang of EXTRA_LANGS) {
    const backendExisting = fs.existsSync(path.join(LOC, `${lang}.json`))
      ? readJson(path.join(LOC, `${lang}.json`)) : {};
    const frontendExisting = fs.existsSync(path.join(LOC, `frontend.${lang}.json`))
      ? readJson(path.join(LOC, `frontend.${lang}.json`)) : {};
    const backend = readChunks(lang, 'backend', backendExisting);
    const frontend = readChunks(lang, 'frontend', frontendExisting);
    // Completeness is a property of the *table*, not of the chunk files: after
    // a late round the numbered chunks may be long gone while the shipped table
    // still carries every one of their strings.
    const uncovered = [
      ...Object.keys(backend.source).filter((k) => !(k in backend.merged)),
      ...Object.keys(frontend.source).filter((k) => !(k in frontend.merged)),
    ];
    if (uncovered.length) {
      report.push(`${lang}: INCOMPLETE — ${uncovered.length} key(s) untranslated`
        + ` (e.g. ${JSON.stringify(uncovered[0])}); run \`node tools/build-langs.js delta\``);
      continue;
    }
    if (backend.extra.length || frontend.extra.length) {
      report.push(`${lang}: unexpected keys (${[...backend.extra, ...frontend.extra].slice(0, 3).join(', ')})`);
    }
    const carried = Object.keys(frontendExisting).length - frontend.fromChunks + Object.keys(backendExisting).length - backend.fromChunks;
    writeJson(path.join(LOC, `${lang}.json`), backend.merged);
    writeJson(path.join(LOC, `frontend.${lang}.json`), frontend.merged);

    // The browser bundle. A generated file, but committed, because the viewer
    // has no build step at run time.
    const banner = '/* Generated by tools/build-langs.js — do not edit by hand.\n'
      + `   Source: src/data/locales/frontend.${lang}.json (${Object.keys(frontend.merged).length} strings). */\n`;
    const body = 'I18N.extend(' + JSON.stringify(frontend.merged, null, 2) + ", '" + lang + "');\n";
    fs.writeFileSync(path.join(WEB_LANG, `${lang}.js`), banner + body, 'utf8');
    report.push(`${lang}: ${Object.keys(backend.merged).length} backend + ${Object.keys(frontend.merged).length} frontend strings`
      + (carried > 0 ? ` (${carried} carried over from the previous build)` : '')
      + (backend.aligned + frontend.aligned > 0 ? `, ${backend.aligned + frontend.aligned} re-spaced to the English shape` : ''));
  }
  for (const line of report) console.log(line);
}

/**
 * Write the keys a language is still missing into `delta/<lang>.<kind>.json`.
 *
 * This is the late-round equivalent of `split`: instead of re-cutting every
 * string into chunks (which would ask translators to redo work that is already
 * shipped), it hands out exactly the strings that are new since the last merge.
 * The seed value is the English text, so a translator replaces values and never
 * has to invent a key.
 *
 *   node tools/build-langs.js delta        every language
 *   node tools/build-langs.js delta ja     just one, to restore a lost file
 *
 * A delta file that already holds a translation is never overwritten: that file
 * is somebody's work in progress, and re-seeding it would throw the translation
 * away. `--force` re-seeds anyway.
 */
function delta() {
  const want = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const force = process.argv.includes('--force');
  const langs = want ? EXTRA_LANGS.filter((l) => l === want) : EXTRA_LANGS;
  if (!langs.length) {
    console.error(`unknown language ${JSON.stringify(want)}; expected one of ${EXTRA_LANGS.join(', ')}`);
    process.exit(2);
  }
  fs.mkdirSync(DELTA, { recursive: true });
  let total = 0;
  for (const lang of langs) {
    const parts = [];
    const kept = [];
    for (const kind of ['backend', 'frontend']) {
      const source = readJson(path.join(LOC, `_source.${kind}.json`));
      const shippedFile = path.join(LOC, kind === 'backend' ? `${lang}.json` : `frontend.${lang}.json`);
      const shipped = fs.existsSync(shippedFile) ? readJson(shippedFile) : {};
      const file = path.join(DELTA, `${lang}.${kind}.json`);
      // backend: key is the English label, so the seed is the label itself.
      // frontend: key is the Chinese source, the value the English text.
      const seed = (key) => (kind === 'backend' ? key : String(source[key]));
      const gap = {};
      for (const [key, value] of Object.entries(source)) {
        if (key in shipped) continue;
        gap[key] = seed(key);
        void value;
      }
      const n = Object.keys(gap).length;
      if (!n) continue;
      if (!force && fs.existsSync(file)) {
        let already = false;
        try {
          already = Object.entries(readJson(file)).some(([k, v]) => v !== seed(k));
        } catch { already = false; }
        if (already) { kept.push(`${kind} (${Object.keys(gap).length} key(s), already translated)`); continue; }
      }
      writeJson(file, gap);
      total += n;
      parts.push(`${kind} ${n}`);
    }
    const bits = [];
    if (parts.length) bits.push(parts.join(', ') + ' keys to translate');
    if (kept.length) bits.push('kept ' + kept.join(', '));
    console.log(`${lang}: ${bits.length ? bits.join('; ') : 'nothing missing'}`);
  }
  console.log(total
    ? `\n${total} string(s) seeded -> delta/<lang>.<kind>.json`
    : '\nnothing seeded: every language either covers the sources or has work in progress');
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

/** `{name}` placeholders present in a string. */
function placeholders(s) {
  return [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
}

/** Symbols that must survive translation byte for byte. */
const SYMBOLS = [/£[^£]*£/g, /§./g, /\\n/g, /\[[A-Za-z_.]+\]/g, /\$[A-Za-z_$]+\$/g];

function symbols(s) {
  const out = [];
  for (const re of SYMBOLS) for (const m of String(s).match(re) || []) out.push(m);
  return out.sort().join('|');
}

/**
 * Leading/trailing whitespace is load-bearing: many backend labels are
 * fragments concatenated with a value (`' days'`, `', delayed '`), so a lost
 * space silently welds two words together in the UI.
 */
function edgeSpace(s) {
  const m = /^(\s*)[\s\S]*?(\s*)$/.exec(String(s));
  return m ? m[1] + '|' + m[2] : '';
}

/**
 * Punctuation-only fragments (`': '`, `'  '`, `'（'`) are the one place where a
 * different spacing *is* the translation: French writes `a : b`, Japanese `a：b`.
 * So they are exempt from the width rules.
 */
const PUNCT_ONLY = /^[\s\p{P}\p{S}]*$/u;

/**
 * Give a translated string exactly the leading/trailing whitespace its English
 * shape has.
 *
 * The surrounding spaces are part of the *code's* contract — `' days'` is glued
 * after a number, `' ({n} files'` after a dash — while the spaces a translator
 * adds or drops are typography. Aligning the edges mechanically removes a whole
 * class of "words welded together" bugs without touching a single word, and
 * languages that put a space before `:` keep their inner spacing.
 */
function alignEdges(value, shape) {
  if (PUNCT_ONLY.test(shape)) return value;
  const lead = /^\s*/.exec(shape)[0];
  const trail = /\s*$/.exec(shape)[0];
  const body = String(value).replace(/^\s+/, '').replace(/\s+$/, '');
  if (!body) return value;
  return lead + body + trail;
}

/**
 * Audit the *unmerged* delta files of one language (or of all of them).
 *
 * A translator can run this the moment the file is saved, before anything is
 * merged into the shipped tables: it applies exactly the rules `check` applies,
 * so a lost `{placeholder}`, a broken `£icon£` run or a dropped leading space is
 * caught while the strings are still in the translator's hands.
 *
 *   node tools/build-langs.js verify fr
 */
function verify() {
  const want = process.argv[3];
  const langs = want ? EXTRA_LANGS.filter((l) => l === want) : EXTRA_LANGS;
  if (!langs.length) {
    console.error(`unknown language ${JSON.stringify(want)}; expected one of ${EXTRA_LANGS.join(', ')}`);
    process.exit(2);
  }
  let problems = 0;
  for (const lang of langs) {
    const issues = [];
    const same = [];
    let total = 0;
    for (const kind of ['backend', 'frontend']) {
      const file = path.join(DELTA, `${lang}.${kind}.json`);
      if (!fs.existsSync(file)) { console.log(`${lang.padEnd(3)} ${kind}: no delta file (nothing to translate)`); continue; }
      let part;
      try {
        part = readJson(file);
      } catch (e) {
        issues.push(`${kind}: not valid JSON (${e.message})`);
        continue;
      }
      const source = readJson(path.join(LOC, `_source.${kind}.json`));
      const isFrontend = kind === 'frontend';
      for (const [key, value] of Object.entries(part)) {
        total++;
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
          issues.push(`${kind}: ${JSON.stringify(key)} is not a current source key`);
          continue;
        }
        if (typeof value !== 'string' || !value.trim()) {
          issues.push(`${kind}: empty value for ${JSON.stringify(key)}`);
          continue;
        }
        // For a frontend entry the key is Chinese, so the English text is the
        // shape the code was written against.
        const shape = isFrontend ? String(source[key]) : key;
        if (placeholders(shape) !== placeholders(value)) {
          issues.push(`${kind}: placeholder mismatch ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
        } else if (symbols(shape) !== symbols(value)) {
          issues.push(`${kind}: symbol mismatch ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
        } else if (!PUNCT_ONLY.test(shape) && edgeSpace(shape) !== edgeSpace(value)) {
          issues.push(`${kind}: edge whitespace changed ${JSON.stringify(shape)} -> ${JSON.stringify(value)}`);
        }
        // The seed equals the English text (backend: the key itself, frontend:
        // the value in `_source.frontend.json`), so a value that still matches
        // it is a string nobody has translated. It passes every other rule —
        // which is exactly why it is reported here rather than left to review.
        if (value === shape) same.push(key);
      }
    }
    console.log(`${lang.padEnd(3)} ${String(total).padStart(3)} strings  ${issues.length ? '!! ' + issues.slice(0, 8).join(' | ') : 'ok'}`
      + (same.length ? `  (${same.length} value(s) left as the English seed)` : ''));
    problems += issues.length;
  }
  console.log(problems ? `\nVERIFY: ${problems} problem(s)` : '\nVERIFY: clean');
  process.exitCode = problems ? 1 : 0;
}

function check() {
  let problems = 0;
  const backendSource = readJson(path.join(LOC, '_source.backend.json'));
  const frontendSource = readJson(path.join(LOC, '_source.frontend.json'));
  const totalBackend = Object.keys(backendSource).length;
  const totalFrontend = Object.keys(frontendSource).length;

  for (const lang of EXTRA_LANGS) {
    const backendFile = path.join(LOC, `${lang}.json`);
    const frontendFile = path.join(LOC, `frontend.${lang}.json`);
    if (!fs.existsSync(backendFile) || !fs.existsSync(frontendFile)) {
      console.log(`${lang.padEnd(3)} not built yet`);
      problems++;
      continue;
    }
    const backend = readJson(backendFile);
    const frontend = readJson(frontendFile);
    const issues = [];
    const same = [];

    const missingBackend = Object.keys(backendSource).filter((k) => !(k in backend));
    const missingFrontend = Object.keys(frontendSource).filter((k) => !(k in frontend));
    if (missingBackend.length) issues.push(`${missingBackend.length} backend keys missing (e.g. ${JSON.stringify(missingBackend[0])})`);
    if (missingFrontend.length) issues.push(`${missingFrontend.length} frontend keys missing (e.g. ${JSON.stringify(missingFrontend[0])})`);

    for (const [src, table] of [[backendSource, backend], [frontendSource, frontend]]) {
      const isFrontend = src === frontendSource;
      for (const [key, value] of Object.entries(table)) {
        if (!(key in src)) continue;
        // The English text is what the code was written against: for a frontend
        // entry the key is Chinese, so comparing its width to the translation
        // would flag correct typography conversions (`依赖：` -> `Dependencies: `).
        const shape = isFrontend ? String(src[key]) : key;
        if (PUNCT_ONLY.test(key)) {
          if (placeholders(key) !== placeholders(value)) {
            issues.push(`placeholder mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
          }
          continue;
        }
        if (placeholders(key) !== placeholders(value)) {
          issues.push(`placeholder mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
        } else if (symbols(key) !== symbols(value)) {
          issues.push(`symbol mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
        } else if (edgeSpace(shape) !== edgeSpace(value)) {
          issues.push(`edge whitespace changed: ${JSON.stringify(shape)} -> ${JSON.stringify(value)}`);
        }
        if (!value.trim()) issues.push(`empty value for ${JSON.stringify(key)}`);
        // Identical values are expected for proper nouns, paths and script
        // identifiers, so they are reported for review rather than failing.
        else if (value === key && /[A-Za-z]/.test(key) && key.length > 3) same.push(key);
        if (issues.length > 6) break;
      }
      if (issues.length > 6) break;
    }

    const pctB = ((Object.keys(backend).length / totalBackend) * 100).toFixed(0);
    const pctF = ((Object.keys(frontend).length / totalFrontend) * 100).toFixed(0);
    console.log(`${lang.padEnd(3)} backend ${String(Object.keys(backend).length).padStart(4)}/${totalBackend} (${pctB}%)  frontend ${String(Object.keys(frontend).length).padStart(4)}/${totalFrontend} (${pctF}%)  ${same.length} identical-to-source${issues.length ? '  !! ' + issues.slice(0, 4).join(' | ') : '  ok'}`);
    if (same.length && process.argv.includes('--verbose')) {
      for (const k of same.slice(0, 25)) console.log(`      same  ${JSON.stringify(k)}`);
    }
    problems += issues.length;
  }
  console.log(problems ? `\nCHECK: ${problems} problem(s)` : '\nCHECK: clean');
  process.exitCode = problems ? 1 : 0;
}

function status() {
  if (!fs.existsSync(OUT)) { console.log('nothing translated yet (run split first)'); return; }
  const files = fs.readdirSync(OUT);
  for (const lang of EXTRA_LANGS) {
    const mine = files.filter((f) => f.startsWith(lang + '.'));
    const backend = mine.filter((f) => f.includes('.backend.'));
    const frontend = mine.filter((f) => f.includes('.frontend.'));
    console.log(`${lang}: ${backend.length}/${BACKEND_CHUNKS} backend chunks, ${frontend.length}/${FRONTEND_CHUNKS} frontend chunks`);
  }
}

/**
 * Dispatch, but only when this file *is* the program.
 *
 * `require()`ing this module must never run a command: `split` deletes `_work`,
 * and an inline `node -e "require('./tools/build-langs.js')"` — a natural way to
 * reach `chunkNames()` or `readChunks()` — silently took the whole work tree
 * with it once. Importing is now inert; run it through the CLI.
 */
if (require.main === module) {
  const CMD = process.argv[2] || 'split';
  if (CMD === 'split') split();
  else if (CMD === 'delta') delta();
  else if (CMD === 'merge') merge();
  else if (CMD === 'verify') verify();
  else if (CMD === 'check') check();
  else if (CMD === 'status') status();
  else {
    console.error('usage: node tools/build-langs.js [split|delta|merge|verify|check|status]');
    process.exit(2);
  }
}

module.exports = { EXTRA_LANGS, chunkNames, readChunks, placeholders, symbols, edgeSpace };
