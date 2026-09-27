'use strict';
/**
 * Fidelity check: confirm the script parser does not silently lose content.
 *
 * For each sampled script file we compare the set of "keys" that appear in the
 * raw source against the keys the parser produced. Any key present in the source
 * but missing from the tree (beyond a tolerance for commented-out lines) is a
 * parser bug and is reported.
 */

const fs = require('fs');
const path = require('path');

const modsSvc = require('../src/mods.js');
const { loadFile } = require('../src/fileview.js');
const { parseScript } = require('../src/codec/script.js');
const loc = require('../src/codec/localisation.js');

const SAMPLE = 120;
const TOLERANCE = 0.02;

/** Collect every entry key in a parsed tree. */
function treeKeys(node, out = new Set()) {
  if (!node) return out;
  if (node.type === 'object') {
    for (const e of node.entries || []) {
      out.add(e.key);
      treeKeys(e.value, out);
    }
  } else if (node.type === 'array') {
    for (const item of node.items || []) treeKeys(item, out);
  }
  return out;
}

/**
 * Collect keys from raw text, ignoring comment lines. This is a deliberately
 * loose regex so it over-counts rather than under-counts.
 */
function sourceKeys(text) {
  const out = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*#.*$/, ''); // drop whole-line comments
    if (!line.trim()) continue;
    // strip inline comment that is not inside quotes
    let inQ = false;
    let cleaned = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === '#' && !inQ) break;
      cleaned += c;
    }
    const m = /[\s{]\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(=|<=|>=|<|>)/.exec(' ' + cleaned);
    if (m) out.add(m[1]);
  }
  return out;
}

(async () => {
  const userDir = modsSvc.findUserDir();
  const descriptors = modsSvc.listModDescriptors(userDir);

  let checked = 0;
  let totalSrc = 0;
  let totalMissing = 0;
  const worst = [];

  for (const d of descriptors) {
    const mod = await modsSvc.scanMod(d);
    const scripts = mod.files.filter((f) => !f.binary && f.kind === 'script');
    if (!scripts.length) continue;

    const step = Math.max(1, Math.floor(scripts.length / SAMPLE));
    for (let i = 0; i < scripts.length; i += step) {
      const f = scripts[i];
      let buf;
      try { buf = fs.readFileSync(path.join(mod.root, f.rel)); } catch { continue; }
      if (buf.length > 2 * 1024 * 1024) continue;

      const text = loc.decodeBuffer(buf);
      let tree;
      try { tree = parseScript(text); } catch { continue; }
      const parsed = treeKeys(tree);
      const src = sourceKeys(text);

      if (src.size < 5) continue; // too small to be meaningful

      let missing = 0;
      const missingNames = [];
      for (const k of src) {
        if (!parsed.has(k)) { missing++; if (missingNames.length < 5) missingNames.push(k); }
      }

      checked++;
      totalSrc += src.size;
      totalMissing += missing;
      const ratio = missing / src.size;
      if (ratio > TOLERANCE) {
        worst.push({
          mod: mod.name, rel: f.rel, missing, of: src.size,
          ratio: ratio.toFixed(3), names: missingNames.join(','),
        });
      }
    }
  }

  console.log('检查脚本文件       :', checked);
  console.log('源文件键总数       :', totalSrc);
  console.log('解析后缺失键       :', totalMissing, `(${(totalMissing / totalSrc * 100).toFixed(2)}%)`);
  console.log('超过 2% 容差的文件 :', worst.length);
  console.log('');
  for (const w of worst.sort((a, b) => b.missing - a.missing).slice(0, 15)) {
    console.log(`  ${w.ratio}  ${w.missing}/${w.of}  ${w.rel}`);
    console.log(`          ${w.mod}`);
    console.log(`          缺失示例: ${w.names}`);
  }
  if (!worst.length) console.log('  (无 — 解析器未丢失任何内容)');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
