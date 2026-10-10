'use strict';
/*
 * check-css.js -- every `var(--name)` must resolve to a declaration.
 *
 * This exists because of a real, user-visible bug. The header language picker
 * was styled as:
 *
 *     background: var(--panel, #fff);
 *     color: inherit;
 *
 * `--panel` was never declared anywhere, so the fallback silently won and the
 * control became a white box -- while `color: inherit` inherited the navy
 * header's near-white #eef2f7 text. White on white, contrast ratio 1.0:1: the
 * picker looked like an empty white button that never showed the current
 * language.
 *
 * A missing custom property is never an error at runtime. CSS just walks on and
 * uses the fallback, or drops the declaration, so nothing complains until a
 * human looks at the rendered page. This check complains instead.
 *
 * Scope: `web/**` only, since that is the whole front end. A property created
 * from JavaScript (`style.setProperty('--x', …)`) counts as a declaration, so
 * genuinely runtime-driven properties are not reported.
 *
 *   node tools/check-css.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const failures = [];
let passed = 0;
function check(what, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok   ${what}`);
  } else {
    failures.push(`${what}${detail ? ' — ' + detail : ''}`);
    console.log(`  FAIL ${what}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * Blank out comments in place of deleting them, so every line number still
 * matches the file: prose about a custom property must not count as a use.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Find declarations and references in one source text. */
function scan(text) {
  const src = stripComments(text);
  const declared = [];
  let m;
  const declRe = /(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
  while ((m = declRe.exec(src))) declared.push(m[2]);
  const setRe = /setProperty\(\s*['"](--[A-Za-z0-9_-]+)['"]/g;
  while ((m = setRe.exec(src))) declared.push(m[1]);
  const refs = [];
  const refRe = /var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g;
  while ((m = refRe.exec(src))) {
    refs.push({
      name: m[1],
      fallback: Boolean(m[2]),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return { declared, refs };
}

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test: a checker that cannot fail proves nothing, so assert that the
// detector finds both shapes of the bug before trusting its verdict below.
// ---------------------------------------------------------------------------
const sample = scan(`
  :root { --declared: #fff; }
  .a { background: var(--panel, #fff); color: var(--declared); }
  .b { border-color: var(--missing); }
`);
const found = (s) => s.declared.slice().sort().join(',');
check('self-test: declarations are found', found(sample) === '--declared', found(sample));
check('self-test: an undeclared fallback reference is detected',
  sample.refs.some((r) => r.name === '--panel' && r.fallback),
  JSON.stringify(sample.refs));
check('self-test: an undeclared reference without a fallback is detected',
  sample.refs.some((r) => r.name === '--missing' && !r.fallback),
  JSON.stringify(sample.refs));
const commentedRef = scan('/* var(--ghost, #000) */ .c { color: var(--declared); }');
check('self-test: a commented-out reference is not counted',
  commentedRef.refs.length === 1 && commentedRef.refs[0].name === '--declared',
  JSON.stringify(commentedRef.refs));
const commentedDecl = scan('/* --ghost: #000; */ .c { color: var(--ghost, #111); }');
check('self-test: a commented-out declaration is not counted',
  commentedDecl.declared.length === 0, JSON.stringify(commentedDecl.declared));
const runtimeDecl = scan("el.style.setProperty('--live', '1px');");
check('self-test: a runtime setProperty counts as a declaration',
  runtimeDecl.declared.includes('--live'), JSON.stringify(runtimeDecl.declared));

// ---------------------------------------------------------------------------
// The real scan.
// ---------------------------------------------------------------------------
const files = walk(WEB).map((p) => ({
  rel: path.relative(ROOT, p).replace(/\\/g, '/'),
  text: fs.readFileSync(p, 'utf8'),
}));
const css = files.filter((f) => f.rel.endsWith('.css'));
const code = files.filter((f) => /\.(js|html)$/.test(f.rel));

check('a stylesheet exists to check', css.length > 0, css.map((f) => f.rel).join(', '));

const declared = new Map(); // name -> [where, …]
const refs = new Map(); // name -> [{rel, line, fallback}]
for (const f of css.concat(code)) {
  const s = scan(f.text);
  for (const n of s.declared) {
    if (!declared.has(n)) declared.set(n, []);
    declared.get(n).push(f.rel);
  }
  for (const r of s.refs) {
    if (!refs.has(r.name)) refs.set(r.name, []);
    refs.get(r.name).push({ rel: f.rel, line: r.line, fallback: r.fallback });
  }
}

check('the front end references at least one custom property', refs.size > 0, `${refs.size} referenced`);

const undeclared = [...refs.keys()].filter((n) => !declared.has(n)).sort();
check('every referenced custom property is declared', undeclared.length === 0,
  undeclared.map((n) => {
    const at = refs.get(n)[0];
    return `${n} (${at.rel}:${at.line}${at.fallback ? ', hidden by a fallback' : ', no fallback → declaration dropped'})`;
  }).join('; '));

// Called out separately because this is the exact shape of the picker bug: the
// fallback makes the typo look intentional, and the page keeps rendering.
const silent = undeclared.filter((n) => refs.get(n).some((r) => r.fallback));
check('no undeclared custom property is masked by a fallback', silent.length === 0, silent.join(', '));

// Informational: dead palette entries and shadowed declarations are not bugs,
// but a palette that drifts is how the next missing name gets created.
const unused = [...declared.keys()].filter((n) => !refs.has(n)).sort();
if (unused.length) console.log(`\n  note  declared but never referenced: ${unused.join(', ')}`);
const dupes = [...declared.entries()].filter(([, where]) => where.length > 1).map(([n]) => n);
if (dupes.length) console.log(`  note  declared more than once: ${dupes.join(', ')}`);

const total = [...refs.values()].reduce((a, v) => a + v.length, 0);
console.log(`\n${css.length} stylesheet(s), ${total} var() reference(s), ${declared.size} custom propert(ies)`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log('  !! ' + f);
}
console.log(`\nCSS VAR TEST: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
