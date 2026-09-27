'use strict';
/**
 * Coverage test over every mod installed in the Documents mod folder.
 *
 * For each mod it samples files from every category that has a parser, loads
 * them through the same code path the HTTP API uses, and reports per-encoding
 * statistics plus any file that failed to load or parse.
 */

const modsSvc = require('../src/mods.js');
const { loadFile } = require('../src/fileview.js');

const SAMPLE_PER_CATEGORY = 25;

function classify(text) {
  // Fraction of characters that look like real content rather than garbage.
  if (!text) return 0;
  let good = 0, bad = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfffd) { bad += 3; continue; }
    if (cp >= 0x4e00 && cp <= 0x9fff) { good += 2; continue; }
    if (cp >= 0x3000 && cp <= 0x303f) { good += 2; continue; }
    if (cp >= 0x20 && cp < 0x7f) { good += 1; continue; }
    if (cp === 9 || cp === 10 || cp === 13) { good += 1; continue; }
    if (cp < 0x20) { bad += 2; continue; }
    good += 1;
  }
  return (good - bad) / text.length;
}

(async () => {
  const userDir = modsSvc.findUserDir();
  console.log('mod folder:', userDir + '\\mod');
  const descriptors = modsSvc.listModDescriptors(userDir);
  console.log('mods found:', descriptors.length, '\n');

  const grand = {
    files: 0, sampled: 0, loadErrors: 0, parseErrors: 0, tooLarge: 0,
    byKind: {}, byEncoding: {}, catStat: {},
  };

  for (const d of descriptors) {
    const mod = await modsSvc.scanMod(d);
    console.log('='.repeat(78));
    console.log(`${mod.name}`);
    console.log(`  files=${mod.stats.files}  text=${mod.stats.textFiles}  binary=${mod.stats.binaryFiles}  categories=${mod.categories.length}`);

    // Bucket files by category, then sample from each.
    const byCat = new Map();
    for (const f of mod.files) {
      if (f.binary) continue;
      if (!byCat.has(f.category)) byCat.set(f.category, []);
      byCat.get(f.category).push(f);
    }

    const stats = { loc: 0, locHan: 0, script: 0, scriptParsed: 0, enc: {} };
    const problems = [];

    for (const [catId, files] of byCat) {
      // Spread samples across the category rather than always taking the head.
      const step = Math.max(1, Math.floor(files.length / SAMPLE_PER_CATEGORY));
      const picked = [];
      for (let i = 0; i < files.length && picked.length < SAMPLE_PER_CATEGORY; i += step) picked.push(files[i]);

      for (const f of picked) {
        grand.sampled++;
        grand.byKind[f.kind] = (grand.byKind[f.kind] || 0) + 1;

        let loaded;
        try {
          loaded = loadFile(mod, f.rel);
        } catch (e) {
          grand.loadErrors++;
          problems.push(`LOAD  ${f.rel}: ${e.message}`);
          continue;
        }
        if (!loaded) { grand.loadErrors++; problems.push(`NULL  ${f.rel}`); continue; }

        const r = loaded.render;
        if (!r) { grand.loadErrors++; problems.push(`NORENDER ${f.rel}`); continue; }

        if (r.type === 'tooLarge') { grand.tooLarge++; continue; }
        if (r.type === 'error') { grand.loadErrors++; problems.push(`ERROR ${f.rel}: ${r.message}`); continue; }

        if (r.encoding) {
          stats.enc[r.encoding] = (stats.enc[r.encoding] || 0) + 1;
          grand.byEncoding[r.encoding] = (grand.byEncoding[r.encoding] || 0) + 1;
        }

        if (r.type === 'localisation') {
          stats.loc++;
          const vals = r.entries.map((e) => e.value).join(' ');
          const score = classify(vals);
          if (score < 0.75) {
            problems.push(`LOWQ  ${f.rel}: score=${score.toFixed(2)} enc=${r.encoding} entries=${r.entries.length} sample=${JSON.stringify(vals.slice(0, 60))}`);
            grand.catStat[catId] = grand.catStat[catId] || { low: 0, total: 0 };
            grand.catStat[catId].low++;
          } else {
            const han = [...vals].filter((c) => { const p = c.codePointAt(0); return p >= 0x4e00 && p <= 0x9fff; }).length;
            if (han > 0) stats.locHan++;
          }
          grand.catStat[catId] = grand.catStat[catId] || { low: 0, total: 0 };
          grand.catStat[catId].total++;
        } else if (r.type === 'script' && r.encoding !== 'binary') {
          stats.script++;
          if (r.parseError) {
            grand.parseErrors++;
            problems.push(`PARSE ${f.rel}: ${r.parseError}`);
          } else {
            stats.scriptParsed++;
            const top = r.entryCount;
            if (top === 0) problems.push(`EMPTY ${f.rel}: 0 top-level entries`);
          }
        }
      }
    }

    grand.files += mod.stats.files;
    console.log(`  sampled=${[...byCat.values()].reduce((s, a) => s + Math.min(a.length, SAMPLE_PER_CATEGORY), 0)}` +
      `  loc=${stats.loc}(含中文 ${stats.locHan})  script=${stats.script}(解析成功 ${stats.scriptParsed})`);
    console.log('  encodings:', JSON.stringify(stats.enc));
    if (problems.length) {
      console.log(`  !! ${problems.length} 个问题:`);
      for (const p of problems.slice(0, 8)) console.log('     ' + p);
      if (problems.length > 8) console.log(`     ... 另有 ${problems.length - 8} 个`);
    } else {
      console.log('  OK 无问题');
    }
  }

  console.log('\n' + '='.repeat(78));
  console.log('汇总');
  console.log('  模组总数        :', descriptors.length);
  console.log('  文件总数        :', grand.files.toLocaleString('zh-CN'));
  console.log('  抽样文件        :', grand.sampled);
  console.log('  按类型          :', JSON.stringify(grand.byKind));
  console.log('  按编码          :', JSON.stringify(grand.byEncoding));
  console.log('  载入失败        :', grand.loadErrors);
  console.log('  脚本解析失败    :', grand.parseErrors);
  console.log('  过大跳过        :', grand.tooLarge);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
