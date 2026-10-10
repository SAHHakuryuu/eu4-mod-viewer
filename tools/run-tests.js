'use strict';
/**
 * Test runner.
 *
 *   node tools/run-tests.js              core tests only (no machine deps)
 *   node tools/run-tests.js --tier=mods  core + tests that need an EU4 install
 *   node tools/run-tests.js --all        everything, including browser checks
 *   node tools/run-tests.js --list       show the plan without running anything
 *
 * Child output is inherited rather than piped: a test file's own PASS/FAIL lines
 * are the useful artefact, and inherited stdio also works inside restricted
 * sandboxes where opening a pipe is not permitted.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/** Preconditions are probed so a missing game install reports SKIP, not FAIL. */
function hasMods() {
  try {
    const mods = require(path.join(ROOT, 'src', 'mods.js'));
    const userDir = mods.findUserDir();
    if (!userDir) return false;
    return mods.listModDescriptors(userDir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Is an offline wiki mounted? The Chinese term tables for conditions, effects and
 * modifiers are parsed out of it at run time rather than shipped with the tool,
 * so the test needs one to compare against.
 */
function hasWiki() {
  try {
    const wiki = require(path.join(ROOT, 'src', 'wiki.js'));
    return wiki.isEnabled() && Boolean(wiki.getWikiDir());
  } catch {
    return false;
  }
}

/**
 * Is a viewer server reachable? Retried, because the immediately preceding test
 * is a blocking `spawnSync` and a single 1 s probe can lose the race against a
 * server that is still busy serving it.
 */
async function serverUp() {
  const attempt = () => new Promise((resolve) => {
    let req;
    try {
      req = require('http').request(
        { host: '127.0.0.1', port: 4173, path: '/api/status', timeout: 2500 },
        (res) => { res.resume(); resolve(res.statusCode === 200); },
      );
    } catch {
      resolve(false);
      return;
    }
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (await attempt()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const TESTS = [
  {
    id: 'codec',
    file: 'tools/test-codec.js',
    tier: 'core',
    what: 'Localisation codec + Clausewitz parser',
  },
  {
    id: 'i18n',
    file: 'tools/test-i18n-backend.js',
    tier: 'core',
    what: 'Backend zh/en term layer',
  },
  {
    id: 'i18n-audit',
    file: 'tools/i18n-audit.js',
    args: ['check'],
    tier: 'core',
    what: 'Every t() key exists in the dictionary; no stray Chinese literals',
  },
  {
    id: 'doc-links',
    file: 'tools/check-doc-links.js',
    tier: 'core',
    what: 'Every relative link and screenshot in the documentation exists',
  },
  {
    id: 'css-vars',
    file: 'tools/check-css.js',
    tier: 'core',
    what: 'Every CSS custom property is declared before it is referenced',
  },
  {
    id: 'wikigloss',
    file: 'tools/test-wikigloss.js',
    tier: 'mods',
    what: 'Term tables are parsed from the user\'s wiki at run time, never invented',
    needs: hasWiki,
    skipReason: 'no offline wiki mounted (Settings → offline wiki)',
  },
  {
    id: 'gamedata',
    file: 'tools/test-gamedata.js',
    tier: 'mods',
    what: 'Content index + the six bespoke card renderers',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'content-types',
    file: 'tools/test-content-types.js',
    tier: 'mods',
    what: 'Every content type indexes, builds and renders a card',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'missions',
    file: 'tools/test-missions.js',
    tier: 'mods',
    what: 'Mission trees lay out on the game\'s own slot/position grid',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'history',
    file: 'tools/test-history.js',
    tier: 'mods',
    what: 'Historical rulers, leaders and battles index, resolve and render',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'fidelity',
    file: 'tools/test-fidelity.js',
    tier: 'mods',
    what: 'Parser loses no source keys',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'mods',
    file: 'tools/test-all-mods.js',
    tier: 'mods',
    what: 'Load every mod, sample every category',
    needs: hasMods,
    skipReason: 'no EU4 mods found on this machine',
  },
  {
    id: 'dds',
    file: 'tools/test-dds.js',
    tier: 'mods',
    what: 'DDS decoder (synthetic + real textures)',
    needs: hasMods,
    skipReason: 'no EU4 textures to decode',
  },
  {
    id: 'verify-game',
    file: 'tools/verify-game.js',
    tier: 'e2e',
    what: 'Headless browser check of the game-format view',
    needs: serverUp,
    skipReason: 'no server on http://127.0.0.1:4173 (run `npm start` first)',
  },
  {
    id: 'verify-i18n',
    file: 'tools/verify-i18n.js',
    tier: 'e2e',
    what: 'Headless browser check of the language switch, settings and configurable wiki',
    needs: serverUp,
    skipReason: 'no server on http://127.0.0.1:4173 (run `npm start` first)',
  },
  {
    id: 'verify-wiki',
    file: 'tools/verify-wiki.js',
    tier: 'e2e',
    what: 'Headless browser check of the wiki view',
    needs: serverUp,
    skipReason: 'no server on http://127.0.0.1:4173 (run `npm start` first)',
  },
];

const TIERS = { core: ['core'], mods: ['core', 'mods'], all: ['core', 'mods', 'e2e'] };

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const t of TESTS) console.log(`${t.tier.padEnd(5)} ${t.id.padEnd(12)} ${t.file.padEnd(30)} ${t.what}`);
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*\*/, '').replace(/^ \* ?/gm, '').trim());
    return 0;
  }

  const tierArg = (argv.find((a) => a.startsWith('--tier=')) || '').slice(7);
  const tier = argv.includes('--all') ? 'all' : (TIERS[tierArg] ? tierArg : 'core');
  const wanted = TIERS[tier];

  const plan = TESTS.filter((t) => wanted.includes(t.tier));
  const results = [];

  console.log('EU4 Mod Viewer — test runner');
  console.log(`tier: ${tier}   (${plan.length} test file(s))`);
  console.log('='.repeat(70));

  for (const t of plan) {
    const abs = path.join(ROOT, t.file);
    if (!fs.existsSync(abs)) {
      results.push({ ...t, status: 'MISSING' });
      console.log(`\n-- ${t.id}: MISSING (${t.file})`);
      continue;
    }
    if (t.needs) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await t.needs();
      if (!ok) {
        results.push({ ...t, status: 'SKIP' });
        console.log(`\n-- ${t.id}: SKIP — ${t.skipReason}`);
        continue;
      }
    }
    console.log(`\n${'='.repeat(70)}\n-- ${t.id}: ${t.what}\n   ${t.file}${t.args ? ' ' + t.args.join(' ') : ''}\n${'='.repeat(70)}`);
    const r = spawnSync(process.execPath, [abs].concat(t.args || []), {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    const code = r.status === null ? 1 : r.status;
    results.push({ ...t, status: code === 0 ? 'PASS' : 'FAIL', code });
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('summary');
  console.log('='.repeat(70));
  for (const r of results) {
    const mark = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', MISSING: 'MISS' }[r.status];
    console.log(`  ${mark}  ${r.id.padEnd(12)} ${r.status === 'FAIL' ? '(exit ' + r.code + ')' : r.status === 'SKIP' ? r.skipReason : ''}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'MISSING').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped`);
  return failed ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => {
    console.error('runner crashed:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  },
);
