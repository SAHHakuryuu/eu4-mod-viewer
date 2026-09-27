'use strict';
const mods = require('../src/mods.js');

(async () => {
  const userDir = mods.findUserDir();
  const installDir = mods.findInstallDir();
  console.log('user dir   :', userDir);
  console.log('install dir:', installDir);
  console.log('steam libs :', mods.findSteamLibraries());

  const descs = mods.listModDescriptors(userDir);
  console.log('\ndescriptors found:', descs.length);

  for (const d of descs) {
    const t0 = Date.now();
    const mod = await mods.scanMod(d);
    const ms = Date.now() - t0;
    console.log('\n--- ' + mod.name + ' ---');
    console.log('  id        :', mod.id);
    console.log('  root      :', mod.root);
    console.log('  version   :', mod.version, '/ supported', mod.supportedVersion);
    console.log('  tags      :', mod.tags.join(', '));
    if (mod.dependencies.length) console.log('  deps      :', mod.dependencies.join(', '));
    if (mod.replacePaths.length) console.log('  replace   :', mod.replacePaths.join(', '));
    console.log('  stats     :', JSON.stringify(mod.stats), `(scan ${ms}ms)`);
    console.log('  top categories:');
    for (const c of mod.categories.slice(0, 8)) {
      console.log(`     ${c.icon} ${c.zh.padEnd(10)} ${String(c.fileCount).padStart(6)} files`);
    }
  }
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
