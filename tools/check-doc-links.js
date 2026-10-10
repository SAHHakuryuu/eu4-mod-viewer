'use strict';
/**
 * Every relative link and image in the documentation must point at a file that
 * actually exists.
 *
 * Why this is a test and not a one-off: the READMEs are the repository's front
 * door on GitHub, and a mistyped screenshot path renders as a broken-image icon
 * *after* it is published — the author, who has the files locally, is the one
 * person who cannot see the problem. It costs a second to check and it is the
 * only automated guard against that class of mistake.
 *
 * Checked:
 *   • markdown `](target)` links and `](target#anchor)` targets whose file part
 *     is a relative path,
 *   • `<img src="…">` and `<a href="…">` in raw HTML,
 *   • links into another document (`docs/x.md`, `README.en.md`),
 *   • the language sibling of every document (`README.md` ↔ `README.en.md`,
 *     `docs/GITHUB.md` ↔ `docs/GITHUB.en.md`), which is what keeps the two
 *     editions from drifting into a dead end.
 *
 * Not checked: `#anchor` fragments. GitHub's slugs are generated from the
 * heading text (emoji and punctuation dropped, spaces to hyphens) and are not
 * reproducible here without re-implementing that rule, so a wrong anchor is
 * reported for review instead of failing.
 *
 * It also guards the *shape* of the markdown, because both READMEs have already
 * been damaged once by bulk text edits: in `README.md` every table's `|` had
 * become a space (the tables stopped rendering at all) and in `README.en.md`
 * every backtick had become the letter `v` (`/api/status` read `v/api/statusv`).
 * A link check notices neither, so four structural rules run here too:
 *   • every row of a table has the same number of cells as its header,
 *   • a row-like line directly above a flattened `--- ---` divider is a table
 *     that lost its pipes,
 *   • code spans balance per line, or across two neighbouring lines,
 *   • fence markers pair up.
 *
 * Usage: node tools/check-doc-links.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/** The documents that face the reader, plus the two folder indexes. */
const DOCS = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'CONTRIBUTING.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md'];

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(`${label}${detail ? '  (' + detail + ')' : ''}`);
}

/** Every markdown/HTML target in one file, with the line it sits on. */
function targets(text) {
  const out = [];
  const push = (raw, line) => {
    const t = String(raw).trim();
    if (!t) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return;        // http:, https:, mailto:
    if (t.startsWith('#')) { out.push({ anchorOnly: t, line }); return; }
    const [file, anchor] = t.split('#');
    out.push({ file, anchor: anchor || null, line });
  };
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // markdown: ![alt](target) and [text](target)
    for (const m of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(m[1], i + 1);
    // raw html: src="…" / href="…"
    for (const m of line.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) push(m[1], i + 1);
  });
  return out;
}

function exists(rel) {
  try { return fs.statSync(path.join(ROOT, decodeURIComponent(rel))).isFile(); } catch { return false; }
}

const docs = DOCS.filter((d) => fs.existsSync(path.join(ROOT, d)));
check('the documentation set is present', docs.length >= 4, docs.join(', '));

let totalTargets = 0;
let anchors = 0;
for (const doc of docs) {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const list = targets(text);
  totalTargets += list.length;
  const missing = [];
  for (const t of list) {
    if (t.anchorOnly) { anchors++; continue; }
    if (!exists(t.file)) missing.push(`${t.file} (line ${t.line})`);
  }
  check(`${doc}: every relative link and image resolves`, missing.length === 0, missing.slice(0, 4).join(', '));
  if (anchors) console.log(`  note  ${doc}: ${anchors} in-document anchor(s) not machine-checked`);
  anchors = 0;
}

// The two editions of each document must both exist: a reader who follows the
// language link must never land on a 404.
const PAIRS = [
  ['README.md', 'README.en.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.en.md'],
  ['CHANGELOG.md', 'CHANGELOG.en.md'],
  ['docs/GITHUB.md', 'docs/GITHUB.en.md'],
  ['docs/GITHUB-UPDATE.md', 'docs/GITHUB-UPDATE.en.md'],
  ['docs/TRANSLATING.md', 'docs/TRANSLATING.en.md'],
];
for (const [zh, en] of PAIRS) {
  const hasZh = fs.existsSync(path.join(ROOT, zh));
  const hasEn = fs.existsSync(path.join(ROOT, en));
  check(`${zh} has its English sibling`, !hasZh || hasEn, en);
  check(`${en} has its Chinese sibling`, !hasEn || hasZh, zh);
}

// A screenshot that is referenced by name but never produced is half the
// problem; the other half is a family of screenshots nothing points at. The
// READMEs summarise the tail of the list with a glob (`docs/screenshot-game-*.png`),
// so a glob mention counts as a reference for every file it covers.
const docText = docs.map((d) => fs.readFileSync(path.join(ROOT, d), 'utf8')).join('\n');
const shots = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => /^screenshot-.*\.png$/.test(f));
const globRefs = [...docText.matchAll(/screenshot-([a-z]+)-\*\.png/g)].map((m) => m[1]);
const orphans = shots.filter((f) => {
  if (docText.includes(f)) return false;
  const m = /^screenshot-([a-z]+)-/.exec(f);
  return !(m && globRefs.includes(m[1]));
});
check('every screenshot in docs/ is referenced (or covered by a glob) by a document',
  orphans.length === 0, `${orphans.length} unused: ${orphans.slice(0, 4).join(', ')}`);

/* ---------- the shape of the markdown ---------- */
/** Every markdown file that faces a reader, READMEs and docs/ alike. */
function allDocs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...allDocs(p));
    else if (e.name.endsWith('.md') && !e.name.startsWith('_')) out.push(p);
  }
  return out;
}
const mdFiles = allDocs(ROOT);

/** Walk the lines, telling the caller which ones sit outside a fenced block. */
function outsideFences(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; out.push({ line, i: i + 1, fence: true, code: false }); return; }
    out.push({ line, i: i + 1, fence: false, code: inFence });
  });
  return out;
}

const cells = (line) => (line.match(/\|/g) || []).length;
const isTableRow = (l) => /^\s*\|/.test(l);
const isDivider = (l) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');
const flattenedRow = (l) => /\S {2}$/.test(l) && /\s{3,}/.test(l);
const flattenedDivider = (l) => /^\s*-{2,}(\s+-{2,})+\s*$/.test(l);

const bad = { cells: [], flattened: [], ticks: [], fences: [], loneV: [], vFence: [] };
for (const file of mdFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const rows = outsideFences(fs.readFileSync(file, 'utf8'));

  // 1. tables: every row carries as many cells as its header row
  let header = null;
  for (const { line, i, code, fence } of rows) {
    if (fence || code) { header = null; continue; }
    if (isTableRow(line)) {
      if (header === null) header = { n: cells(line), i };
      else if (cells(line) !== header.n) bad.cells.push(`${rel}:${i} has ${cells(line)} pipes, header on line ${header.i} has ${header.n}`);
    } else if (header !== null && !isDivider(line)) {
      header = null;
    }
  }
  // 2. flattened tables: a row-like line whose next line is a `--- ---` divider
  for (let k = 0; k + 1 < rows.length; k++) {
    if (rows[k].code || rows[k].fence) continue;
    if (flattenedRow(rows[k].line) && flattenedDivider(rows[k + 1].line)) {
      bad.flattened.push(`${rel}:${rows[k].i} looks like a table row with its pipes replaced by spaces`);
    }
  }

  // 3. code spans pair up on a line, or across two neighbouring lines
  const odd = rows.filter((r) => !r.fence && !r.code && (r.line.match(/`/g) || []).length % 2).map((r) => r.i);
  for (const i of odd) {
    if (!odd.includes(i - 1) && !odd.includes(i + 1)) bad.ticks.push(`${rel}:${i} has an unpaired backtick`);
  }

  // 4. fences pair up
  const fences = rows.filter((r) => r.fence).length;
  if (fences % 2) bad.fences.push(`${rel} has ${fences} fence markers (odd)`);

  // 5 + 6. the other corruption: every backtick replaced by the letter `v`.
  // A lone `v` cannot stand between two non-word characters in English, and a
  // code span written as vvv… is a fence that lost its backticks. Both look
  // only outside code spans, so a document that legitimately *talks* about the
  // letter -- writing it as `v` -- stays clean.
  for (const { line, i, code, fence } of rows) {
    if (fence || code) continue;
    if (/^\s*v{3,}\S*\s*$/.test(line)) bad.vFence.push(`${rel}:${i} looks like a fence written with the letter v`);
    const spans = [];
    const re = /`/g;
    let m;
    while ((m = re.exec(line))) spans.push(m.index);
    const inSpan = (k) => {
      for (let s = 0; s + 1 < spans.length; s += 2) if (k > spans[s] && k < spans[s + 1]) return true;
      return false;
    };
    const lone = /(^|[^A-Za-z0-9])v(?![A-Za-z0-9])/g;
    while ((m = lone.exec(line))) {
      if (!inSpan(m.index + m[1].length)) {
        bad.loneV.push(`${rel}:${i} has a lone "v" between punctuation: ...${line.slice(Math.max(0, m.index - 20), m.index + 22).trim()}...`);
      }
    }
  }
}

check('every markdown table row has as many cells as its header', bad.cells.length === 0, bad.cells.slice(0, 3).join('; '));
check('no markdown table has lost its pipes to spaces', bad.flattened.length === 0, bad.flattened.slice(0, 3).join('; '));
check('every code span is closed (same line or the next one)', bad.ticks.length === 0, bad.ticks.slice(0, 3).join('; '));
check('every fenced block is closed', bad.fences.length === 0, bad.fences.slice(0, 3).join('; '));
check('no backtick has been replaced by the letter "v" (lone v between punctuation)',
  bad.loneV.length === 0, bad.loneV.slice(0, 3).join('; '));
check('no fence has been written as vvv instead of ```', bad.vFence.length === 0, bad.vFence.slice(0, 3).join('; '));

console.log(`\n${docs.length} documents, ${totalTargets} link(s)/image(s), ${shots.length} screenshot(s)`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log('  !! ' + f);
}
console.log(`\nDOC LINK TEST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
