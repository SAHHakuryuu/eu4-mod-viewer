'use strict';
/**
 * i18n audit / codemod helper.
 *
 *   node tools/i18n-audit.js extract        list every CJK string literal per file
 *   node tools/i18n-audit.js wrap           wrap CJK literals in t( ... )
 *   node tools/i18n-audit.js check          report literals that look untranslated
 *
 * The wrap pass is deliberately conservative: it only touches single-quoted or
 * backtick literals that contain CJK, it skips anything that is a property key,
 * an import, a require path, or a locale/config identifier, and it never
 * rewrites a literal that is already inside t().
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['web/app.js', 'web/gameview.js', 'web/settings.js'];
/** Scripts that register the English dictionary, in load order. */
const DICT_SCRIPTS = ['web/i18n.js', 'web/i18n.app.js', 'web/i18n.game.js'];

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** Words after which a `/` starts a regular expression, not a division. */
const REGEX_PREV_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Read a `/.../flags` regular expression starting at `i` (which points at `/`).
 * Returns the index just past the flags.
 */
function skipRegex(src, i) {
  const n = src.length;
  i++; // opening slash
  let inClass = false;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { i++; break; }
    else if (c === '\n') break; // not actually a regex
    i++;
  }
  while (i < n && /[a-z]/i.test(src[i])) i++;
  return i;
}

/**
 * Scan a JS source and return every string literal (single, double, backtick)
 * with its source offsets. Template literals keep their `${}` parts intact.
 *
 * Regex literals are recognised so that quotes inside a character class (for
 * example `/[&<>"']/g`) do not derail the scan.
 */
function scanLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let prevSignificant = '';
  let prevWord = '';

  while (i < n) {
    const ch = src[i];

    // Skip comments so their contents are never treated as code.
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // A `/` here is a regex when the previous token cannot end an expression.
    if (ch === '/' && (prevSignificant === '' || /[({[,;:=!&|?+\-*%<>~^]/.test(prevSignificant)
      || REGEX_PREV_WORDS.has(prevWord))) {
      i = skipRegex(src, i);
      prevSignificant = '/';
      prevWord = '';
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let w = '';
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) { w += src[i]; i++; }
      prevWord = w;
      prevSignificant = w.slice(-1);
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      const start = i;
      i++;
      let body = '';
      while (i < n) {
        const c = src[i];
        if (c === '\\') { body += src[i] + src[i + 1]; i += 2; continue; }
        if (c === quote) break;
        if (quote === '`' && c === '$' && src[i + 1] === '{') {
          // Keep the interpolation expression verbatim.
          let depth = 1;
          body += '${';
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth === 0) break;
            body += src[i];
            i++;
          }
          body += '}';
          i++;
          continue;
        }
        body += c;
        i++;
      }
      const end = i + 1; // past the closing quote
      out.push({ start, end, quote, body, prevSignificant, tpl: quote === '`' });
      i = end;
      prevSignificant = quote;
      continue;
    }

    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out;
}

/** True when the literal sits in a position where wrapping would change meaning. */
function isStructural(src, lit) {
  const before = src.slice(Math.max(0, lit.start - 40), lit.start);
  // property key:  foo: '中文'   or  { '中文': 1 }
  if (/[{,]\s*$/.test(before)) {
    const after = src.slice(lit.end, lit.end + 4);
    if (/^\s*:/.test(after)) return true;
  }
  // already wrapped
  if (/\bt\(\s*$/.test(before)) return true;
  if (/\bt\(\s*[^)]*$/.test(before) && /t\($/.test(before.trim().slice(-2))) return true;
  return false;
}

/** True when the literal is already the argument of a `t(...)` call. */
function isWrapped(src, lit) {
  const before = src.slice(Math.max(0, lit.start - 24), lit.start);
  // Match `t(`, `I18N.t(`, allowing whitespace/newlines between.
  return /(?:\bt|I18N\.t)\(\s*$/.test(before);
}

/**
 * Turn a raw source literal body into the string JavaScript would evaluate it
 * to. `scanLiterals` deliberately keeps escape sequences verbatim so callers can
 * rewrite source, but dictionary keys are compared as *values*, so `\\` must
 * become a single backslash.
 */
function decodeBody(raw) {
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
    else out += n; // \\ \' \" \` and any other escaped character
  }
  return out;
}

/**
 * CJK literals that are legitimately not dictionary keys.
 * Each entry needs a reason: this list is the difference between "the audit is
 * clean" and "the audit was silenced".
 */
const ALLOW_UNWRAPPED = [
  { file: 'web/gameview.js', text: 'Mod文件结构', why: 'offline wiki page name used as the last-resort link target' },
  { file: 'web/gameview.js', text: '行政', why: 'MP_ZH value; resolved through gwMpLabel()' },
  { file: 'web/gameview.js', text: '外交', why: 'MP_ZH value' },
  { file: 'web/gameview.js', text: '军事', why: 'MP_ZH value' },
  { file: 'web/gameview.js', text: '天', why: 'mtth unit map value; wrapped with t() at the call site' },
  { file: 'web/gameview.js', text: '月', why: 'mtth unit map value' },
  { file: 'web/gameview.js', text: '年', why: 'mtth unit map value' },
  { file: 'web/settings.js', text: '切换到中文 / Switch to Chinese', why: 'language-button tooltip is intentionally bilingual' },
  { file: 'web/settings.js', text: 'Switch to English / 切换到英文', why: 'language-button tooltip is intentionally bilingual' },
  {
    file: 'web/gameview.js',
    text: "<a href=\"#\" data-file=\"${escapeHtml(r.file)}\">${escapeHtml(r.file)}:${r.line}</a>${r.origin === 'vanilla' ? ' <span class=\"gw-tag\">' + t('原版') + '</span>' : ''}",
    why: 'template literal whose only CJK sits inside a nested t(\'原版\') call',
  },
];

/** Filesystem paths are data: the example folder name must stay real. */
function isAllowedUnwrapped(file, text) {
  if (file === 'web/settings.js' && /^[A-Za-z]:\\\\/.test(text)) {
    return { why: 'example filesystem path placeholder' };
  }
  return ALLOW_UNWRAPPED.find((a) => a.file === file && a.text === text) || null;
}

function extract() {
  const report = {};
  for (const rel of TARGETS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lits = scanLiterals(src).filter((l) => CJK.test(l.body));
    const wrapped = lits.filter((l) => isWrapped(src, l));
    const loose = lits.filter((l) => !isWrapped(src, l));
    const lineOf = (lit) => src.slice(0, lit.start).split('\n').length;
    report[rel] = {
      total: lits.length,
      unique: new Set(lits.map((l) => l.body)).size,
      wrapped: wrapped.length,
      loose: loose.length,
      looseUnique: new Set(loose.map((l) => l.body)).size,
      strings: [...new Set(lits.map((l) => l.body))].sort(),
      looseStrings: [...new Set(loose.map((l) => l.body))].sort(),
      looseAt: loose.map((l) => ({ line: lineOf(l), text: l.body })),
    };
  }
  return report;
}

/**
 * Evaluate the real i18n scripts in a stub DOM to obtain the registered
 * dictionary. Using the actual files means the check can never drift from what
 * the browser will load.
 */
function loadDict() {
  const vm = require('vm');
  const noop = () => {};
  const sandbox = {
    console: { log: noop, error: noop, warn: noop },
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: {
      documentElement: { setAttribute: noop },
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
  for (const rel of DICT_SCRIPTS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(src, sandbox, { filename: rel });
  }
  if (!sandbox.I18N) throw new Error('I18N was not registered by the dictionary scripts');
  return sandbox.I18N;
}

/**
 * Cross-check every `t('…')` key used in the UI against the dictionary.
 *
 * A missing entry silently falls back to Chinese — exactly the kind of bug that
 * survives a visual check, and one that shipped once already. So it gets its own
 * command and a non-zero exit code.
 */
function check() {
  const I18N = loadDict();
  const registered = new Set(I18N.keys('en'));
  const used = new Map(); // evaluated key -> ['file:line', ...]
  const unwrapped = [];
  const allowed = [];

  for (const rel of TARGETS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lineOf = (lit) => src.slice(0, lit.start).split('\n').length;
    for (const lit of scanLiterals(src)) {
      const wrapped = isWrapped(src, lit);
      if (!wrapped && CJK.test(lit.body)) {
        const excuse = isAllowedUnwrapped(rel, lit.body);
        if (excuse) allowed.push({ file: rel, line: lineOf(lit), text: lit.body, why: excuse.why });
        else unwrapped.push({ file: rel, line: lineOf(lit), text: lit.body });
        continue;
      }
      if (!wrapped) continue;
      const key = decodeBody(lit.body);
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(`${rel}:${lineOf(lit)}`);
    }
  }

  const missing = [...used.keys()].filter((k) => !registered.has(k)).sort()
    .map((k) => ({ key: k, at: used.get(k) }));
  const unused = [...registered].filter((k) => !used.has(k)).sort();

  // An English value that still contains CJK is how Chinese leaks into English
  // mode — usually by pasting a real folder name into the translation. Check the
  // evaluated values rather than the source text so escapes are resolved.
  I18N.setLang('en');
  const cjkValues = [...registered].filter((k) => CJK.test(I18N.t(k)))
    .map((k) => ({ key: k, value: I18N.t(k) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { registered: registered.size, used: used.size, missing, unused, unwrapped, allowed, cjkValues };
}

if (require.main === module) {
  const cmd = process.argv[2] || 'extract';
  if (cmd === 'check') {
    const r = check();
    console.log(`dictionary entries          : ${r.registered}`);
    console.log(`distinct t() keys in use    : ${r.used}`);
    console.log(`unwrapped CJK literals      : ${r.unwrapped.length} unexplained, ${r.allowed.length} allow-listed`);
    for (const u of r.allowed) console.log(`   ok         ${u.file}:${u.line}  ${JSON.stringify(u.text)}   (${u.why})`);
    for (const u of r.unwrapped) console.log(`   UNWRAPPED  ${u.file}:${u.line}  ${JSON.stringify(u.text)}`);
    console.log(`MISSING dictionary entries  : ${r.missing.length}`);
    for (const m of r.missing) console.log(`   MISSING    ${JSON.stringify(m.key)}   <- ${m.at.join(', ')}`);
    console.log(`English values containing CJK: ${r.cjkValues.length}`);
    for (const c of r.cjkValues) console.log(`   CJK VALUE  ${JSON.stringify(c.key)} -> ${JSON.stringify(c.value)}`);
    console.log(`unused dictionary entries   : ${r.unused.length} (informational)`);
    for (const k of r.unused) console.log(`   unused     ${JSON.stringify(k)}`);
    process.exitCode = (r.missing.length || r.unwrapped.length || r.cjkValues.length) ? 1 : 0;
  } else if (cmd === 'extract') {
    const rep = extract();
    for (const [rel, r] of Object.entries(rep)) {
      console.log(`\n=== ${rel} ===`);
      console.log(`    total ${r.total} (${r.unique} unique)  |  wrapped ${r.wrapped}  |  UNWRAPPED ${r.loose} (${r.looseUnique} unique)`);
      for (const l of r.looseAt) console.log(`    L${l.line}: ${JSON.stringify(l.text)}`);
    }
  } else if (cmd === 'json') {
    process.stdout.write(JSON.stringify(extract(), null, 2));
  } else {
    console.error('unknown command: ' + cmd + '   (extract | check | json)');
    process.exit(2);
  }
}

module.exports = { scanLiterals, extract, check, loadDict, isStructural, isWrapped, CJK, TARGETS, ROOT };
