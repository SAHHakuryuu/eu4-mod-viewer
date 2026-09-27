'use strict';
/**
 * End-to-end verification + screenshots of the "game-format preview".
 *
 * Drives headless Edge over the DevTools protocol through every content type,
 * asserts that the rendered panel actually contains what the game would show
 * (Chinese localised title, modifier lines, an event picture, the script↔
 * localisation table), and writes one screenshot per content type into docs/.
 *
 * Usage: node tools/verify-game.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const PORT = 9223;
const APP = 'http://127.0.0.1:4173/';
const DOCS = path.join(__dirname, '..', 'docs');
const MOD_ID = '1.37 Celestial empire on which the sun never sets';

/**
 * One screenshot target per content type.
 *
 * The first six are the bespoke renderers; the rest exercise the generic
 * engine. `strict` marks the types whose panel must also resolve localisation
 * (see the raw-key assertion below): a raw reference is expected for the
 * script-only types, where the script key genuinely *is* the display name.
 */
const TARGETS = [
  { type: 'events', id: 'CE_chinese_religion_disasters.6', file: 'screenshot-game-event.png', label: '事件窗' },
  { type: 'decisions', id: 'CE_sixiang_gaige', file: 'screenshot-game-decisions.png', label: '决议' },
  { type: 'idea_groups', id: 'kaimeng_ideas', file: 'screenshot-game-ideas.png', label: '理念组' },
  { type: 'national_ideas', id: 'QNG_ideas', file: 'screenshot-game-national-ideas.png', label: '国家理念' },
  { type: 'advisors', id: 'yangmingism_daru', file: 'screenshot-game-advisors.png', label: '顾问' },
  { type: 'policies', id: 'CE_kaimeng_ecnomy_ideas', file: 'screenshot-game-policies.png', label: '政策' },

  // --- missions & disasters
  { type: 'mission_trees', id: 'tree#1', file: 'screenshot-game-mission-trees.png', label: '任务树网格' },
  { type: 'missions', id: 'aju_annex_mogadishu', file: 'screenshot-game-missions.png', label: '任务树' },
  { type: 'disasters', id: 'bm_dongnan_corruption_disaster', file: 'screenshot-game-disasters.png', label: '灾难' },
  // --- country & government
  { type: 'countries', id: 'ABQ', file: 'screenshot-game-countries.png', label: '国家' },
  { type: 'government', id: 'celestial_empire', file: 'screenshot-game-government.png', label: '政府改革' },
  { type: 'ruler_traits', id: 'CE_fatuity_personality', file: 'screenshot-game-ruler-traits.png', label: '君主特质' },
  { type: 'parliament', id: 'charter_trade_companies', file: 'screenshot-game-parliament.png', label: '议会与法令' },
  { type: 'estates', id: 'estate_brahmins', file: 'screenshot-game-estates.png', label: '阶层' },
  { type: 'rebels', id: 'CE_jingxiang_liumin_rebels', file: 'screenshot-game-rebels.png', label: '叛军' },
  { type: 'ages', id: 'age_of_rejuvenation', file: 'screenshot-game-ages.png', label: '时代' },
  { type: 'great_projects', id: 'kiel_canal', file: 'screenshot-game-great-projects.png', label: '伟大工程' },
  // --- religion, culture, economy
  { type: 'religion', id: 'catholic', file: 'screenshot-game-religion.png', label: '宗教' },
  { type: 'culture', id: 'germanic', file: 'screenshot-game-culture.png', label: '文化' },
  { type: 'buildings', id: 'marketplace', file: 'screenshot-game-buildings.png', label: '建筑' },
  { type: 'trade', id: 'herb', file: 'screenshot-game-trade.png', label: '贸易商品' },
  // --- military
  { type: 'units', id: 'asian_arquebusier', file: 'screenshot-game-units.png', label: '单位' },
  { type: 'leader_traits', id: 'ce_cornered_fox_personality', file: 'screenshot-game-leader-traits.png', label: '将领特质' },
  { type: 'wars', id: 'cb_war_on_empire', file: 'screenshot-game-wars.png', label: '宣战理由' },
  // --- world
  { type: 'bookmarks', id: 'CE_1368', file: 'screenshot-game-bookmarks.png', label: '书签' },
  { type: 'map', id: 'black_sea_area', file: 'screenshot-game-map.png', label: '地图' },
  { type: 'interface', id: 'ages_view', file: 'screenshot-game-interface.png', label: '界面', noLoc: true },
  // --- system
  { type: 'technology', id: 'mil#30', file: 'screenshot-game-technology.png', label: '科技' },
  { type: 'modifiers', id: 'mercantilism', file: 'screenshot-game-modifiers.png', label: '修正' },
  // The two script-only types: their ids are the display names, so a raw
  // script reference in the chrome is correct rather than a missing key.
  { type: 'scripted', id: 'move_capital_effect', file: 'screenshot-game-scripted.png', label: '脚本效果', scriptOnly: true },
  { type: 'on_actions', id: 'on_startup', file: 'screenshot-game-on-actions.png', label: '行动指令', scriptOnly: true },
];

function findEdge() {
  for (const p of EDGE_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('msedge.exe not found');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params && msg.params.exceptionDetails;
        this.events.push('EXCEPTION: ' + (d && (d.text || '') + ' ' + JSON.stringify(d.exception && d.exception.description || '')));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.events.push('console.error: ' + (msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 120000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify((r.exceptionDetails.exception || {}).description || ''));
    }
    return r.result.value;
  }
}

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });

  // The viewer must already be running: this script drives it, it does not
  // start it. Without this check a dead server produces twenty confusing
  // screenshot failures instead of one clear message.
  let serving = false;
  for (let i = 0; i < 3 && !serving; i++) {
    try {
      const res = await fetch(APP + 'api/status');
      serving = res.ok;
    } catch { await sleep(1000); }
  }
  if (!serving) {
    console.error('FAILED: no viewer server on ' + APP + ' — start it with npm start first');
    process.exit(1);
  }

  const edge = findEdge();
  const userDataDir = path.join(os.tmpdir(), 'eu4viewer-game-' + Date.now());

  const proc = spawn(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=1720,1300', APP,
  ], { stdio: 'ignore' });

  try {
    let version = null;
    for (let i = 0; i < 60 && !version; i++) {
      try { version = await getJson(`http://127.0.0.1:${PORT}/json/version`); } catch { await sleep(500); }
    }
    if (!version) throw new Error('DevTools endpoint never came up');
    console.log('browser:', version.Browser);

    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('no page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    for (let i = 0; i < 60; i++) {
      if (await cdp.eval("!!document.querySelector('#mod-list .mod-item')")) break;
      await sleep(500);
    }
    console.log('mods listed:', await cdp.eval("document.querySelectorAll('#mod-list .mod-item').length"));

    // The overview renders asynchronously; openGame() needs state.current, so
    // wait for the category grid before driving the UI.
    for (let i = 0; i < 90; i++) {
      if (await cdp.eval("!!document.querySelector('.cat-grid')")) break;
      await sleep(500);
    }
    const overviewReady = await cdp.eval("!!document.querySelector('.cat-grid')");
    check('mod overview rendered (category grid)', overviewReady);
    const overviewError = await cdp.eval("(document.querySelector('.error-box')||{}).textContent || ''");
    check('mod overview shows no load error', !overviewError, overviewError);
    const entryBanner = await cdp.eval("!!document.querySelector('.gw-entry')");
    check('mod overview offers the game-preview entry point', entryBanner);
    await shot(cdp, path.join(DOCS, 'screenshot-overview.png'), 1200);

    const hasGame = await cdp.eval("typeof openGame === 'function'");
    check('/gameview.js loaded (openGame is global)', hasGame);

    // ---- hub -------------------------------------------------------------
    const enc = encodeURIComponent(MOD_ID);
    await cdp.eval(`openGame('events')`);
    for (let i = 0; i < 90; i++) {
      if (await cdp.eval("!!document.querySelector('#gw-list .gw-item')")) break;
      await sleep(500);
    }
    const hub = await cdp.eval(`(function(){
      return {
        groups: document.querySelectorAll('.gw-nav .gw-group').length,
        tabs: document.querySelectorAll('.gw-nav .gw-tab').length,
        items: document.querySelectorAll('#gw-list .gw-item').length,
        stats: (document.querySelector('#gw-stats')||{}).innerText || '',
        firstTitle: (document.querySelector('#gw-list .gw-item-title')||{}).textContent || ''
      };
    })()`);
    console.log('hub:', JSON.stringify(hub));
    check('group bar rendered', hub.groups >= 5, `groups=${hub.groups}`);
    // Derive the expected tab counts from the server's own type table, so adding
    // a content type cannot leave these two assertions stale.
    const typeIndex = await getJson(`${APP}api/mod/${encodeURIComponent(MOD_ID)}/game/index?lang=zh`);
    const contentTypes = (typeIndex.typeList || []).filter((t) => t.group === 'content').length;
    check(`content group shows its ${contentTypes} tabs + wiki tab`,
      hub.tabs === contentTypes + 1, `tabs=${hub.tabs} expected=${contentTypes + 1}`);
    check('content list populated', hub.items > 0, `items=${hub.items}`);
    check('index summary mentions parsed content', /已解析/.test(hub.stats));
    // The summary line also states where the Chinese term tables came from. That
    // claim has to match what the server actually did, so it is checked against
    // the payload rather than against a hard-coded string.
    const wikiGlossary = Boolean(typeIndex.glossary && typeIndex.glossary.fromWiki);
    check(`index summary states the term-table source (${wikiGlossary ? 'offline wiki' : 'hand-written only'})`,
      wikiGlossary ? /运行时读自本机离线 wiki/.test(hub.stats) : /未挂载离线 wiki/.test(hub.stats),
      hub.stats);
    check('first list item has a Chinese title', /[\u4e00-\u9fff]/.test(hub.firstTitle), hub.firstTitle);

    // Walk every sidebar group and collect the content tabs behind it. This is
    // the check that all content types are actually *reachable from the UI*,
    // which the size of the index alone does not prove.
    const allTabs = [];
    const groupNames = [];
    for (let gi = 0; gi < hub.groups; gi++) {
      const info = await cdp.eval(`(function(){
        var gs = document.querySelectorAll('.gw-nav .gw-group');
        if (${gi} >= gs.length) return null;
        gs[${gi}].click();
        var tabs = document.querySelectorAll('.gw-nav .gw-tabs:not(.gw-tabs-aux) .gw-tab');
        var out = { name: gs[${gi}].innerText.split('\\n')[0], tabs: [] };
        for (var i = 0; i < tabs.length; i++) {
          var spans = tabs[i].querySelectorAll('span');
          out.tabs.push(spans.length >= 2 ? spans[1].textContent : tabs[i].textContent);
        }
        return out;
      })()`);
      if (!info) continue;
      groupNames.push(info.name);
      for (const label of info.tabs) allTabs.push(info.name + '/' + label);
      await sleep(250);
    }
    console.log('groups:', groupNames.join(' | '));
    console.log('content tabs reachable:', allTabs.length, allTabs.join(', '));
    check('every content group is reachable', groupNames.length === hub.groups, `${groupNames.length}/${hub.groups}`);
    check(`all ${typeIndex.typeList.length} content types are reachable from the sidebar`,
      allTabs.length === typeIndex.typeList.length, `tabs=${allTabs.length}`);
    check('no content tab is duplicated', new Set(allTabs).size === allTabs.length);

    // Switching a group must land on that group's first type with a live list.
    const switched = await cdp.eval(`(function(){
      var gs = document.querySelectorAll('.gw-nav .gw-group');
      for (var i = 0; i < gs.length; i++) {
        if (gs[i].innerText.indexOf('系统') === 0) { gs[i].click(); return true; }
      }
      return false;
    })()`);
    check('a non-default group can be selected', switched);
    let groupSwitched = false;
    for (let i = 0; i < 60; i++) {
      groupSwitched = await cdp.eval("(function(){var a=document.querySelector('.gw-tab.active');return !!a && a.innerText.indexOf('科技') >= 0 && document.querySelectorAll('#gw-list .gw-item').length > 0;})()");
      if (groupSwitched) break;
      await sleep(400);
    }
    check('selecting a group loads that group\'s first type', groupSwitched);
    await cdp.eval(`openGame('events')`);
    for (let i = 0; i < 60; i++) {
      if (await cdp.eval("!!document.querySelector('#gw-list .gw-item')")) break;
      await sleep(300);
    }

    await shot(cdp, path.join(DOCS, 'screenshot-game-overview.png'), 1500);

    // ---- one card per content type --------------------------------------
    for (const t of TARGETS) {
      console.log(`\n--- ${t.label} (${t.type}/${t.id}) ---`);
      await cdp.eval(`openGame('${t.type}', { card: ${JSON.stringify(t.id)} })`);
      let ready = false;
      for (let i = 0; i < 90; i++) {
        ready = await cdp.eval("!!document.querySelector('.gw-win') && !!document.querySelector('.gw-loc-table')");
        if (ready) break;
        await sleep(500);
      }
      check(`${t.label}: game window rendered`, ready);
      if (!ready) continue;

      const info = await cdp.eval(`(function(){
        var win = document.querySelector('.gw-win');
        var txt = win ? win.innerText : '';
        var imgs = Array.prototype.slice.call(document.querySelectorAll('.gw-win img'));
        return {
          winText: txt.slice(0, 90).replace(/\\n/g, ' | '),
          hasChinese: /[\\u4e00-\\u9fff]/.test(txt),
          good: document.querySelectorAll('.gw-val.gw-good').length,
          bad: document.querySelectorAll('.gw-val.gw-bad').length,
          neutral: document.querySelectorAll('.gw-val.gw-neutral').length,
          lines: document.querySelectorAll('.gw-line').length,
          groups: document.querySelectorAll('.gw-line.gw-k-group').length,
          rawKeys: document.querySelectorAll('.gw-raw').length,
          names: document.querySelectorAll('.gw-name').length,
          images: imgs.length,
          imgLoaded: imgs.filter(function(i){return i.naturalWidth > 0;}).length,
          locRows: document.querySelectorAll('.gw-loc-table tbody tr').length,
          locMissing: document.querySelectorAll('.gw-loc-table tr.gw-loc-miss').length,
          missingLocalisation: document.querySelectorAll('.gw-missing').length,
          // Non-line renderers: a card can be all chips (a culture group), all
          // settings rows (a bookmark) or a widget tree (a GUI window).
          chips: document.querySelectorAll('.gw-chip').length,
          rows: document.querySelectorAll('.gw-fields-table tbody tr').length,
          records: document.querySelectorAll('.gw-record').length,
          widgets: document.querySelectorAll('.gw-widget').length,
          stats: document.querySelectorAll('.gw-stats-table tbody tr').length,
          timeline: document.querySelectorAll('.gw-tl-row').length,
          missionCells: document.querySelectorAll('.gw-mcell').length,
          missionFrames: document.querySelectorAll('.gw-mcell .gw-msprite img').length,
          missionArrows: document.querySelectorAll('.gw-marrow img').length,
          // Lines carrying a resolved (glossed or localised) span rather than a
          // bare script key.
          resolvedLines: Array.prototype.filter.call(document.querySelectorAll('.gw-line'), function(l){
            return l.querySelector('.gw-val, .gw-name, [class*="gw-c-"]');
          }).length
        };
      })()`);
      console.log('  ' + JSON.stringify(info));
      check(`${t.label}: window text contains Chinese`, info.hasChinese);
      const semantic = info.lines + info.chips + info.rows + info.records
        + info.widgets + info.stats + info.timeline + info.missionCells;
      check(
        `${t.label}: rendered semantic content`,
        semantic > 0,
        `lines=${info.lines} chips=${info.chips} rows=${info.rows} records=${info.records} widgets=${info.widgets} stats=${info.stats} timeline=${info.timeline}`,
      );
      // A type whose whole representation is script identifiers (a GUI window
      // name, `on_startup`) legitimately resolves no localisation at all.
      if (t.scriptOnly) {
        check(`${t.label}: script key shown as the display name`, info.rawKeys > 0, `raw=${info.rawKeys}`);
      } else if (t.noLoc) {
        // This type names its records from the script, so there is no key to
        // resolve and no correspondence row to show.
        check(`${t.label}: panel renders without a localisation table`,
          semantic > 0, `semantic=${semantic} locRows=${info.locRows}`);
      } else {
        check(`${t.label}: localisation table filled`, info.locRows > 0, `rows=${info.locRows}`);
      }
      if (t.type === 'missions' || t.type === 'mission_trees') {
        // The grid is drawn from the mod's own mission icons and the game's own
        // arrow sprites, both streamed as decoded PNGs, so wait for them.
        check(`${t.label}: mission grid cells drawn`, info.missionCells > 0, `cells=${info.missionCells}`);
        check(`${t.label}: prerequisite arrows drawn`, info.missionArrows > 0, `arrows=${info.missionArrows}`);
        let loaded = 0;
        for (let i = 0; i < 25; i++) {
          loaded = await cdp.eval("Array.prototype.filter.call(document.querySelectorAll('.gw-mcell .gw-msprite img'), function(i){return i.naturalWidth > 0;}).length");
          if (loaded > 0) break;
          await sleep(400);
        }
        check(
          `${t.label}: mission sprites decoded and displayed`,
          loaded > 0,
          `loaded=${loaded}/${info.missionFrames}`,
        );
      }
      if (t.type === 'events') {
        // The picture is streamed as a decoded PNG, so give it a moment.
        let loaded = 0;
        for (let i = 0; i < 20; i++) {
          loaded = await cdp.eval("Array.prototype.filter.call(document.querySelectorAll('.gw-win img'), function(i){return i.naturalWidth > 0;}).length");
          if (loaded > 0) break;
          await sleep(400);
        }
        check('event: picture decoded and displayed', info.images > 0 && loaded > 0, `img=${loaded}/${info.images}`);
        const opts = await cdp.eval("document.querySelectorAll('.gw-option').length");
        check('event: option buttons rendered', opts > 0, `options=${opts}`);
      } else if (!t.scriptOnly) {
        // Raw script is the documented fallback for a key the Chinese glossary
        // does not cover, so a generic card may legitimately contain some. What
        // must not happen is a panel with nothing *resolved* on it.
        check(
          `${t.label}: resolved at least one glossed or localised line`,
          info.lines === 0 || info.resolvedLines > 0,
          `resolved=${info.resolvedLines}/${info.lines} raw=${info.rawKeys}`,
        );
      }

      await shot(cdp, path.join(DOCS, t.file), 900);
    }

    // ---- deep-link routing ----------------------------------------------
    console.log('\n--- deep link ---');
    await cdp.eval(`location.hash = '#mod/' + encodeURIComponent(${JSON.stringify(MOD_ID)}) + '/game/advisors/card/yangmingism_daru'`);
    await cdp.eval('applyRoute()');
    let routed = false;
    for (let i = 0; i < 60; i++) {
      routed = await cdp.eval("!!document.querySelector('.gw-win') && /翰林大儒/.test(document.querySelector('.gw-win').innerText)");
      if (routed) break;
      await sleep(400);
    }
    check('deep link #mod/<id>/game/advisors/card/<id> restores the card', routed);

    const errs = cdp.events.filter((e) => !/favicon/i.test(e));
    check('no uncaught page errors', errs.length === 0, errs.slice(0, 4).join(' ;; '));

    ws.close();
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\nGAME VIEW TEST: ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

/** Screenshot the full page, capped so the PNG size stays reasonable. */
async function shot(cdp, out, settle) {
  await sleep(settle);
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const cs = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(Math.ceil(cs.width), 1720);
  const height = Math.min(Math.ceil(cs.height), 3400);
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
  const size = fs.statSync(out).size;
  console.log(`  shot  ${path.basename(out)}  ${width}x${height}  ${(size / 1024).toFixed(0)} KB`);
  check(`screenshot ${path.basename(out)} written`, size > 20000, `${size} bytes`);
}
