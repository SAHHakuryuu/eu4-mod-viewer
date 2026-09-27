'use strict';
/* End-to-end check of the content model: index the mod, then build one card of
 * every type and print what the game would show. */

const modsSvc = require('../src/mods.js');
const gamedata = require('../src/gamedata.js');
const gametext = require('../src/gametext.js');
const terms = require('../src/gameterms.js');

const WANT = process.argv[2] || '1.37 Celestial empire on which the sun never sets';

function lineText(l) {
  let s = '  '.repeat(l.i) + '  ';
  for (const sp of l.spans || []) {
    if (sp.t === 'raw') s += '‹' + sp.s + '›';
    else if (sp.t === 'name') s += (sp.link ? '[' + sp.s + ']' : sp.s);
    else s += sp.s;
  }
  if (l.note) s += '   ⟨' + String(l.note).slice(0, 60) + '⟩';
  return s;
}

const userDir = modsSvc.findUserDir();
const installDir = modsSvc.findInstallDir();
const descriptors = modsSvc.listModDescriptors(userDir);
const entry = descriptors.find((d) => (d.meta.name || '').includes(WANT) || d.root.includes(WANT));

(async () => {
  console.log('glossary:', terms.glossaryStats());
  if (!entry) { console.log('mod not found'); process.exit(1); }
  const mod = await modsSvc.scanMod(entry);
  console.log(`mod: ${mod.name} (${mod.files.length} files)`);

  const t0 = Date.now();
  const index = gamedata.buildIndex(mod, installDir);
  console.log(`index built in ${Date.now() - t0} ms`);
  console.log('stats:', JSON.stringify(index.stats, null, 2));
  console.log('loc keys (mod only):', index.resolver.modIndex.size, 'files:', index.resolver.modIndex.files);
  console.log('errors:', index.errors.length);

  // Force vanilla indexing to prove lazy load works and measure it.
  const t1 = Date.now();
  const v = index.resolver.vanilla;
  console.log(`vanilla index: ${v.size} keys from ${v.files} files in ${Date.now() - t1} ms`);
  console.log('province 5241 ->', index.resolver.text('PROV5241'));

  const samples = {
    events: index.lists.events[3],
    decisions: index.lists.decisions[0],
    idea_groups: index.lists.idea_groups[0],
    national_ideas: index.lists.national_ideas[0],
    advisors: index.lists.advisors[0],
    policies: index.lists.policies[0],
  };

  for (const [type, ref] of Object.entries(samples)) {
    console.log('\n' + '='.repeat(78));
    console.log(`${type}: ${ref ? ref.id : '(none)'}   ${ref ? ref.file + ':' + ref.line : ''}`);
    console.log('='.repeat(78));
    if (!ref) continue;
    const t = Date.now();
    const card = gamedata.buildCard(index, type, ref.id);
    if (!card) { console.log('  !! card build failed'); continue; }
    console.log(`(built in ${Date.now() - t} ms)`);
    for (const [k, v2] of Object.entries(card)) {
      if (['locRefs', 'options', 'ideas', 'file', 'line', 'mods', 'traditions', 'ambition', 'skillsCalated'].includes(k)) continue;
      if (v2 === null || v2 === undefined) continue;
      if (Array.isArray(v2)) {
        if (!v2.length) continue;
        if (!(v2[0] && v2[0].spans)) continue;
        console.log(`${k}:`);
        for (const l of v2.slice(0, 16)) console.log(lineText(l));
        if (v2.length > 16) console.log('    … ' + (v2.length - 16) + ' more');
      } else if (typeof v2 === 'object' && Array.isArray(v2)) {
        continue;
      } else if (typeof v2 === 'object' && v2.k) {
        console.log(`${k.padEnd(16)}: ${gametext.displayText([v2])}`);
      } else if (typeof v2 !== 'object') {
        console.log(`${k.padEnd(16)}: ${v2}`);
      } else {
        console.log(`${k.padEnd(16)}: ${JSON.stringify(v2)}`);
      }
    }
    // Rich-text fields that are node arrays but not "line" arrays.
    for (const k of ['name', 'startName', 'bonusName', 'title', 'desc']) {
      const v2 = card[k];
      if (Array.isArray(v2) && v2.length && !(v2[0] && v2[0].spans)) {
        console.log(`${k.padEnd(16)}: ${gametext.displayText(v2) || '(empty)'}   [key ${card[k + 'Key'] || card.nameKey}]`);
      } else if (v2 === null && card[k + 'Key']) {
        console.log(`${k.padEnd(16)}: !! NOT FOUND: ${card[k + 'Key']}`);
      }
    }
    for (const k of ['mods', 'traditions', 'ambition']) {
      const v2 = card[k];
      if (Array.isArray(v2) && v2.length && v2[0] && v2[0].spans) {
        console.log(`${k}:`);
        for (const l of v2.slice(0, 16)) console.log(lineText(l));
      }
    }
    if (card.skillScaled && card.skillScaled.length) {
      console.log(`skillScaled (${card.skillScaled.length}):`);
      for (const s of card.skillScaled.slice(0, 2)) {
        console.log('  trigger:'); for (const l of s.trigger.slice(0, 4)) console.log('  ' + lineText(l));
        console.log('  modifier:'); for (const l of s.mods.slice(0, 4)) console.log('  ' + lineText(l));
      }
    }
    if (card.options && card.options.length) {
      console.log(`options (${card.options.length}):`);
      for (const o of card.options.slice(0, 3)) {
        console.log(`  [${o.letter}] ${o.name ? gametext.displayText(o.name) : '(no loc: ' + o.nameKey + ')'}`);
        for (const l of (o.effects || []).slice(0, 8)) console.log('    ' + lineText(l));
        if ((o.effects || []).length > 8) console.log('    … ' + (o.effects.length - 8) + ' more effect lines');
      }
    }
    if (card.ideas && card.ideas.length) {
      console.log(`ideas (${card.ideas.length}):`);
      for (const idea of card.ideas.slice(0, 3)) {
        console.log(`  ${idea.id}  ${idea.name ? gametext.displayText(idea.name) : '(no loc)'}`);
        for (const l of (idea.mods || []).slice(0, 5)) console.log('    ' + lineText(l));
      }
    }
    console.log(`locRefs (${card.locRefs.length}):`);
    for (const r of card.locRefs.slice(0, 8)) {
      console.log(`  ${r.field.padEnd(22)} ${r.key.padEnd(34)} ${r.found ? '=> ' + String(r.value).replace(/\n/g, ' ').slice(0, 34) + '  @' + r.file + ':' + r.line : '!! NOT FOUND'}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
