'use strict';
/**
 * Build the translation sources for every language side table.
 *
 *   node tools/i18n-extract.js            write src/data/locales/_source.*.json
 *   node tools/i18n-extract.js --report   print what was found, write nothing
 *
 * Two key spaces exist, because the two halves of the app translate differently:
 *
 *   backend   `src/**` — every label comes from an `L(zh, en)` pair (or a
 *             `{ zh, en }` metadata object). The side table is therefore keyed by
 *             the **English** string, so translators never see a call site and a
 *             new language never touches one.
 *   frontend  `web/i18n*.js` — the dictionary is keyed by the **Chinese source
 *             string** (`t('搜索')`), which is what makes a missing translation
 *             fall back to readable Chinese instead of a raw key.
 *
 * The output is deterministic (sorted keys) so a regenerated file produces a
 * clean diff instead of a reshuffle.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'locales');
const REPORT_ONLY = process.argv.includes('--report');

/** Turn a raw source literal body into the string JavaScript would evaluate. */
function unescapeSrc(raw) {
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') { out += raw[i]; continue; }
    const n = raw[++i];
    if (n === undefined) { out += '\\'; break; }
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '\r';
    else if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n === 'v') out += '\v';
    else if (n === '0') out += '\0';
    else if (n === 'u') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4; }
    else if (n === 'x') { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; }
    else out += n;
  }
  return out;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'locales' && path.basename(dir) === 'data') continue;
      if (e.name === 'node_modules' || e.name === '.git') continue;
      walk(p, out);
    } else if (/\.js$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const L_RE = /\b(?:L|synth)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g;
const META_RE = /\bzh:\s*'((?:[^'\\]|\\.)*)'\s*,\s*\n?\s*en:\s*'((?:[^'\\]|\\.)*)'/g;
const L_ANY_RE = /\b(?:L|synth)\(/g;

/** Every `L(zh, en)` / `synth(zh, en)` / `{ zh, en }` pair under `src/`. */
function scanBackend() {
  const pairs = new Map();      // en -> Set(zh)
  const unmatched = [];         // L( calls whose arguments are not both literals
  let callCount = 0;
  let pairCount = 0;

  for (const file of walk(path.join(ROOT, 'src'), [])) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    const add = (zh, en) => {
      if (!en) return;
      if (!pairs.has(en)) pairs.set(en, new Set());
      pairs.get(en).add(zh);
    };
    for (const m of src.matchAll(L_RE)) { add(unescapeSrc(m[1]), unescapeSrc(m[2])); pairCount++; }
    for (const m of src.matchAll(META_RE)) { add(unescapeSrc(m[1]), unescapeSrc(m[2])); pairCount++; }
    // Sanity: how many L(/synth( calls are there in total? A call whose
    // arguments are computed rather than literal would silently escape the
    // side table, so it has to be reported rather than assumed away.
    const fileCalls = [...src.matchAll(L_ANY_RE)].length;
    callCount += fileCalls;
    if (fileCalls) {
      const matchedHere = [...src.matchAll(L_RE)].length + [...src.matchAll(META_RE)].length;
      if (fileCalls > matchedHere) {
        unmatched.push({ file: rel, calls: fileCalls, matched: matchedHere });
      }
    }
  }
  return { pairs, unmatched, callCount, pairCount };
}

/**
 * Evaluate the real frontend dictionaries in a stub DOM.
 *
 * Using the actual files (rather than parsing them) means the source can never
 * drift from what the browser loads.
 */
function loadFrontendDict() {
  const noop = () => {};
  const sandbox = {
    console: { log: noop, error: noop, warn: noop },
    setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: {
      documentElement: { setAttribute: noop, lang: '' },
      querySelector: () => null,
      querySelectorAll: () => [],
      title: '',
      addEventListener: noop,
      readyState: 'complete',
    },
    navigator: { language: 'en' },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const rel of ['web/i18n.js', 'web/i18n.app.js', 'web/i18n.game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
  }
  if (!sandbox.I18N) throw new Error('I18N was not registered by the dictionary scripts');
  // `t()` translates *away from* Chinese, so the dictionary only yields the
  // English text once the stub is switched to English.
  sandbox.I18N.setLang('en', { persist: false });
  const dict = {};
  for (const key of sandbox.I18N.keys('en')) dict[key] = sandbox.I18N.t(key);
  return dict;
}

function sorted(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

function main() {
  const { pairs, unmatched, callCount, pairCount } = scanBackend();
  const frontend = loadFrontendDict();

  const backendOut = {};
  for (const [en, zhSet] of pairs) backendOut[en] = [...zhSet].sort();

  console.log('backend pairs (distinct English keys): ' + Object.keys(backendOut).length);
  console.log('backend L()/meta occurrences          : ' + pairCount + ' of ' + callCount + ' call sites');
  if (unmatched.length) {
    console.log('CALL SITES WITH NON-LITERAL ARGUMENTS (review these):');
    for (const u of unmatched) console.log(`   ${u.file}: ${u.calls} calls, ${u.matched} literal pairs`);
  }
  console.log('frontend dictionary keys              : ' + Object.keys(frontend).length);

  if (REPORT_ONLY) return 0;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const writeJson = (name, data) => {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('wrote ' + path.relative(ROOT, file).replace(/\\/g, '/'));
  };
  writeJson('_source.backend.json', sorted(backendOut));
  writeJson('_source.frontend.json', sorted(frontend));
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { unescapeSrc, scanBackend, loadFrontendDict, L_RE, META_RE };
