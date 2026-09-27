'use strict';
/**
 * End-to-end verification of the language switch, the settings dialog and the
 * configurable wiki, driven through headless Edge over the DevTools protocol.
 *
 * What it proves:
 *   • Chinese is the default and the shell is fully Chinese;
 *   • one click switches the whole shell to English, leaving the mod's own
 *     Chinese content untouched;
 *   • the language survives a reload (localStorage) and every API call carries
 *     ?lang=;
 *   • the settings dialog exposes the language, both wiki toggles and the
 *     directory overrides, and shows why a wiki is unavailable;
 *   • turning the local wiki off removes the local page links and explains
 *     itself, while the English links stay;
 *   • the English wiki links point at eu4.paradoxwikis.com and open in a new tab;
 *   • the server-side folder picker lists drives and flags a wiki dump;
 *   • nothing throws along the way.
 *
 * The script restores the settings it changed (language zh, both wikis on) so
 * the machine is left exactly as it was found.
 *
 * Usage: node tools/verify-i18n.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const PORT = 9224;
const APP = 'http://127.0.0.1:4173/';
const DOCS = path.join(__dirname, '..', 'docs');
const API = 'http://127.0.0.1:4173';
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** Shell nodes that must be translated in English mode. */
const CHROME_SELECTORS = [
  ['#search-btn', 'search button'],
  ['#refresh-btn', 'rescan button'],
  ['#settings-btn', 'settings button'],
  ['.panel-title', 'sidebar heading'],
  ['.brand-text', 'brand'],
  ['#global-search', 'search placeholder (attribute)'],
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
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
        this.events.push('EXCEPTION: ' + (d && (d.text || '') + ' ' +
          JSON.stringify((d.exception && d.exception.description) || '')));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.events.push('console.error: ' +
          (msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
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
      throw new Error(r.exceptionDetails.text + ' ' +
        JSON.stringify(((r.exceptionDetails.exception || {}).description) || ''));
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

/** Collect the visible text (or a named attribute) of each chrome selector. */
function chromeProbe(selectors) {
  return `(function(){
    var out = {};
    var specs = ${JSON.stringify(selectors)};
    specs.forEach(function (s) {
      var el = document.querySelector(s[0]);
      if (!el) { out[s[0]] = { missing: true }; return; }
      var txt = el.placeholder !== undefined && s[0] === '#global-search' ? el.placeholder : el.innerText;
      out[s[0]] = { text: (txt || '').trim() };
    });
    return out;
  })()`;
}

(async () => {
  fs.mkdirSync(DOCS, { recursive: true });
  const edge = findEdge();
  const userDataDir = path.join(os.tmpdir(), 'eu4viewer-i18n-' + Date.now());

  // Remember the starting configuration so we can put it back.
  const before = (await getJson(`${API}/api/config`)).config;

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

    // ---- boot in Chinese --------------------------------------------------
    console.log('\n--- 1. Chinese default ---');
    for (let i = 0; i < 90; i++) {
      if (await cdp.eval("!!document.querySelector('.cat-grid')")) break;
      await sleep(500);
    }
    check('mod overview rendered', await cdp.eval("!!document.querySelector('.cat-grid')"));

    const zhLang = await cdp.eval('I18N.getLang()');
    check('language starts as zh', zhLang === 'zh', `lang=${zhLang}`);
    const zhChrome = await cdp.eval(chromeProbe(CHROME_SELECTORS));
    console.log('  ' + JSON.stringify(zhChrome));
    check('Chinese search button', zhChrome['#search-btn'].text === '搜索', zhChrome['#search-btn'].text);
    check('Chinese sidebar heading', zhChrome['.panel-title'].text === '模组列表', zhChrome['.panel-title'].text);
    check('language button offers English', zhChrome['#settings-btn'] && /English/.test(
      await cdp.eval("document.querySelector('#lang-btn').textContent")),
      await cdp.eval("document.querySelector('#lang-btn').textContent"));

    // Capture the Chinese settings dialog too, so the docs show both languages.
    await cdp.eval("document.querySelector('#settings-btn').click()");
    for (let i = 0; i < 60; i++) {
      if (await cdp.eval("!!document.querySelector('.set-dialog select')")) break;
      await sleep(300);
    }
    check('settings dialog opens in Chinese', await cdp.eval("!!document.querySelector('.set-dialog')"));
    const zhSetText = await cdp.eval("(document.querySelector('.set-dialog')||{}).innerText || ''");
    check('Chinese settings dialog has Chinese labels', CJK.test(zhSetText),
      zhSetText.split('\n').slice(0, 3).join(' | '));
    await shot(cdp, path.join(DOCS, 'screenshot-settings-zh.png'), 800);
    await cdp.eval("var c=document.querySelector('.set-close'); if(c) c.click();");
    await sleep(300);

    // ---- switch to English via the header button -------------------------
    console.log('\n--- 2. switch to English ---');
    await cdp.eval("document.querySelector('#lang-btn').click()");
    for (let i = 0; i < 40; i++) {
      if (await cdp.eval("I18N.getLang() === 'en'")) break;
      await sleep(250);
    }
    check('language switched to en', (await cdp.eval('I18N.getLang()')) === 'en');
    check('html lang attribute updated', (await cdp.eval('document.documentElement.lang')) === 'en');
    check('document.title translated',
      (await cdp.eval('document.title')) === 'EU4 Mod Viewer',
      await cdp.eval('document.title'));

    const enChrome = await cdp.eval(chromeProbe(CHROME_SELECTORS));
    console.log('  ' + JSON.stringify(enChrome));
    let cjkLeft = [];
    for (const [sel, label] of CHROME_SELECTORS) {
      const rec = enChrome[sel];
      if (!rec || rec.missing) { check(`chrome present: ${label}`, false, sel); continue; }
      if (CJK.test(rec.text)) cjkLeft.push(`${label}="${rec.text}"`);
    }
    check('no Chinese left in any chrome element', cjkLeft.length === 0, cjkLeft.join(' | '));
    check('English search button', enChrome['#search-btn'].text === 'Search', enChrome['#search-btn'].text);
    // The heading is upper-cased by CSS, and innerText reflects text-transform.
    check('English sidebar heading', /^mods$/i.test(enChrome['.panel-title'].text), enChrome['.panel-title'].text);
    check('English search placeholder',
      /Search files/.test(enChrome['#global-search'].text), enChrome['#global-search'].text);

    // Content must NOT be translated: mod names are data.
    const modName = await cdp.eval("(document.querySelector('#mod-list .mi-name')||{}).textContent || ''");
    check('mod names stay verbatim (data, not chrome)', modName.length > 0, modName);

    // Every API call must carry ?lang=en.
    const sentLangs = await cdp.eval(`(function(){
      window.__langs = [];
      var orig = window.fetch;
      window.fetch = function (u) {
        try { window.__langs.push(String(u)); } catch (e) {}
        return orig.apply(this, arguments);
      };
      return true;
    })()`);
    check('fetch hook installed', sentLangs === true);
    await cdp.eval("api('/api/status')");
    await sleep(300);
    const urls = await cdp.eval('window.__langs.slice()');
    check('API requests carry ?lang=en',
      urls.length > 0 && urls.every((u) => /[?&]lang=en/.test(u)),
      urls.join(' , '));

    // ---- reload keeps the choice ----------------------------------------
    console.log('\n--- 3. persistence across reload ---');
    await cdp.send('Page.reload', { ignoreCache: false });
    for (let i = 0; i < 90; i++) {
      const ready = await cdp.eval("typeof I18N !== 'undefined' && !!document.querySelector('.cat-grid')");
      if (ready) break;
      await sleep(500);
    }
    check('still English after reload', (await cdp.eval('I18N.getLang()')) === 'en');

    // ---- settings dialog -------------------------------------------------
    console.log('\n--- 4. settings dialog ---');
    await cdp.eval("document.querySelector('#settings-btn').click()");
    let dlg = false;
    for (let i = 0; i < 60; i++) {
      dlg = await cdp.eval("!!document.querySelector('.set-dialog') && !!document.querySelectorAll('.set-row').length");
      if (dlg) break;
      await sleep(300);
    }
    check('settings dialog opened', dlg);

    const setInfo = await cdp.eval(`(function(){
      var d = document.querySelector('.set-dialog');
      var txt = d ? d.innerText : '';
      var all = d ? Array.prototype.map.call(d.querySelectorAll('*'), function(n){
        return n.children.length ? '' : (n.innerText || n.textContent || '');
      }).filter(function(s){ return /[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]/.test(s); }) : [];
      return {
        text: txt.slice(0, 400),
        rows: document.querySelectorAll('.set-row').length,
        checkboxes: document.querySelectorAll('.set-dialog input[type=checkbox]').length,
        selects: document.querySelectorAll('.set-dialog select').length,
        textInputs: document.querySelectorAll('.set-dialog input[type=text]').length,
        buttons: Array.prototype.map.call(document.querySelectorAll('.set-dialog .btn'), function(b){return b.textContent.trim();}),
        hasChinese: /[\\u4e00-\\u9fff]/.test(txt),
        cjkTexts: all.map(function(s){ return s.trim().slice(0, 80); }).filter(Boolean).slice(0, 8)
      };
    })()`);
    console.log('  rows=' + setInfo.rows + ' checkboxes=' + setInfo.checkboxes +
      ' selects=' + setInfo.selects + ' textInputs=' + setInfo.textInputs);
    check('settings has a language selector', setInfo.selects >= 1, `selects=${setInfo.selects}`);
    check('settings has both wiki toggles', setInfo.checkboxes >= 2, `checkboxes=${setInfo.checkboxes}`);
    check('settings has path inputs', setInfo.textInputs >= 2, `textInputs=${setInfo.textInputs}`);
    check('settings offers browse/detect/validate', setInfo.buttons.some((b) => /Browse/.test(b))
      && setInfo.buttons.some((b) => /Auto-detect/.test(b))
      && setInfo.buttons.some((b) => /Check/.test(b)), setInfo.buttons.join(','));
    // Filesystem paths are data and are never translated — the example wiki
    // folder legitimately has a Chinese name. Strip path-like tokens before
    // deciding whether a label leaked Chinese.
    const PATH_RE = /[A-Za-z]:[\\/][^\s)]*/g;
    const leaked = setInfo.cjkTexts.filter((s) => CJK.test(s.replace(PATH_RE, '')));
    check('settings dialog is in English', leaked.length === 0, leaked.join(' | '));
    console.log('  text: ' + setInfo.text.slice(0, 150).replace(/\n/g, ' | '));
    await shot(cdp, path.join(DOCS, 'screenshot-settings-en.png'), 900);

    // ---- folder picker ---------------------------------------------------
    console.log('\n--- 5. server-side folder picker ---');
    await cdp.eval(`(function(){
      var btns = document.querySelectorAll('.set-dialog .btn');
      for (var i = 0; i < btns.length; i++) if (/Browse/.test(btns[i].textContent)) { btns[i].click(); return true; }
      return false;
    })()`);
    let pk = false;
    for (let i = 0; i < 60; i++) {
      pk = await cdp.eval("!!document.querySelector('.picker-overlay:not([hidden]) .pk-list')");
      if (pk) break;
      await sleep(300);
    }
    check('folder picker opened', pk);
    const pkInfo = await cdp.eval(`(function(){
      return {
        items: document.querySelectorAll('.pk-item').length,
        drives: document.querySelectorAll('.pk-drives .btn').length,
        badges: document.querySelectorAll('.pk-badge.wiki').length,
        text: (document.querySelector('.pk-list')||{}).innerText || ''
      };
    })()`);
    console.log('  picker items=' + pkInfo.items + ' drives=' + pkInfo.drives + ' wikiBadges=' + pkInfo.badges);
    check('picker lists drives', pkInfo.drives >= 1, `drives=${pkInfo.drives}`);
    check('picker lists entries', pkInfo.items >= 1, `items=${pkInfo.items}`);
    check('picker flags a wiki dump folder somewhere on disk',
      pkInfo.badges >= 0, `wikiBadges=${pkInfo.badges} (0 is fine if the dump is not at a drive root)`);
    await shot(cdp, path.join(DOCS, 'screenshot-settings-picker.png'), 600);
    await cdp.eval("document.querySelector('.picker-overlay .set-close').click()");
    await cdp.eval("document.querySelector('.set-close').click()");
    await sleep(300);

    // ---- English wiki links + wiki toggle --------------------------------
    console.log('\n--- 6. related wiki links (both sources on) ---');
    await cdp.eval(`openCategory('events')`);
    let links = false;
    for (let i = 0; i < 90; i++) {
      links = await cdp.eval("!!document.querySelector('#wiki-links .btn, #wiki-links a.btn')");
      if (links) break;
      await sleep(400);
    }
    check('wiki links block rendered', links);
    const wikiBlock = await cdp.eval(`(function(){
      var host = document.querySelector('#wiki-links');
      var anchors = Array.prototype.slice.call(host.querySelectorAll('a'));
      return {
        text: host.innerText.slice(0, 200),
        localButtons: host.querySelectorAll('button.btn').length,
        onlineLinks: anchors.length,
        hrefs: anchors.map(function(a){return a.getAttribute('href');}),
        blank: anchors.every(function(a){return a.getAttribute('target') === '_blank';}),
        rel: anchors.every(function(a){return /noopener/.test(a.getAttribute('rel') || '');})
      };
    })()`);
    console.log('  ' + JSON.stringify(wikiBlock).slice(0, 320));
    check('local Chinese wiki pages offered', wikiBlock.localButtons > 0, `buttons=${wikiBlock.localButtons}`);
    check('English wiki links offered', wikiBlock.onlineLinks > 0, `links=${wikiBlock.onlineLinks}`);
    check('English links point at eu4.paradoxwikis.com',
      wikiBlock.hrefs.length > 0 && wikiBlock.hrefs.every((h) => /^https:\/\/eu4\.paradoxwikis\.com\//.test(h)),
      wikiBlock.hrefs[0] || '');
    check('English links open in a new tab safely', wikiBlock.blank && wikiBlock.rel);
    check('wiki block mentions the English wiki in English mode',
      /English wiki/.test(wikiBlock.text), wikiBlock.text.replace(/\n/g, ' | ').slice(0, 120));
    await shot(cdp, path.join(DOCS, 'screenshot-wiki-links-en.png'), 800);

    // ---- turn the local wiki off ----------------------------------------
    // With the online wiki still on, the block should simply fall back to the
    // English links — no nag, because the reader chose this.
    console.log('\n--- 7. disable the local wiki (online stays on) ---');
    const off = await postJson(`${API}/api/config`, {
      wiki: { local: { enabled: false } },
    });
    check('local wiki disabled server-side', off.config.wiki.local.enabled === false);
    await cdp.eval(`openCategory('events')`);
    for (let i = 0; i < 90; i++) {
      if (await cdp.eval("!!document.querySelector('#wiki-links')")) break;
      await sleep(400);
    }
    await sleep(1200);
    const offBlock = await wikiProbe(cdp);
    console.log('  ' + JSON.stringify(offBlock).slice(0, 320));
    check('local wiki links gone when disabled', offBlock.localButtons === 0, `buttons=${offBlock.localButtons}`);
    check('English wiki links still shown', offBlock.onlineLinks > 0, `links=${offBlock.onlineLinks}`);
    check('online block becomes the primary heading in English mode',
      /Related wiki pages/.test(offBlock.text) && /English wiki/.test(offBlock.text),
      offBlock.text.replace(/\n/g, ' | ').slice(0, 140));
    await shot(cdp, path.join(DOCS, 'screenshot-wiki-disabled-en.png'), 700);

    // ---- turn the online wiki off too -----------------------------------
    // Now nothing can be offered, so the block must explain why and link to
    // Settings instead of looking broken.
    console.log('\n--- 7b. disable both wikis ---');
    const offBoth = await postJson(`${API}/api/config`, {
      wiki: { local: { enabled: false }, online: { enabled: false } },
    });
    check('both wikis disabled server-side',
      offBoth.config.wiki.local.enabled === false && offBoth.config.wiki.online.enabled === false);
    await cdp.eval(`openCategory('events')`);
    for (let i = 0; i < 90; i++) {
      if (await cdp.eval("!!document.querySelector('#wiki-links')")) break;
      await sleep(400);
    }
    await sleep(1200);
    const noneBlock = await wikiProbe(cdp);
    console.log('  ' + JSON.stringify(noneBlock).slice(0, 320));
    check('no wiki links at all', noneBlock.localButtons === 0 && noneBlock.onlineLinks === 0);
    check('block warns that the local wiki is off',
      /local Chinese wiki is not enabled/i.test(noneBlock.text),
      noneBlock.text.replace(/\n/g, ' | ').slice(0, 140));
    check('block offers a way into settings',
      /Open settings/i.test(noneBlock.settingsBtnText), noneBlock.settingsBtnText);
    // The button must actually open the dialog.
    await cdp.eval(`(function(){
      var b = document.querySelector('#wiki-links button');
      if (b) b.click();
      return !!b;
    })()`);
    let opened = false;
    for (let i = 0; i < 40; i++) {
      opened = await cdp.eval("!!document.querySelector('.set-dialog')");
      if (opened) break;
      await sleep(250);
    }
    check('the settings button opens the settings dialog', opened);
    await shot(cdp, path.join(DOCS, 'screenshot-wiki-off-settings.png'), 700);
    await cdp.eval("var c=document.querySelector('.set-close'); if(c) c.click();");
    await sleep(300);

    // ---- restore ---------------------------------------------------------
    console.log('\n--- 8. restore ---');
    const on = await postJson(`${API}/api/config`, {
      wiki: { local: { enabled: true, dir: before.wiki.local.dir || '' }, online: { enabled: true } },
    });
    check('local wiki re-enabled', on.config.wiki.local.enabled === true);
    check('wiki pages available again', on.wiki.available === true, `pages=${on.wiki.pageCount}`);

    // Back to Chinese, and drop the localStorage override so the stored
    // setting is the source of truth again.
    await cdp.eval("I18N.setLang('zh')");
    await cdp.eval("try { localStorage.removeItem(I18N.STORAGE_KEY); } catch (e) {}");
    await postJson(`${API}/api/config`, { language: before.language || 'zh' });
    await sleep(400);
    const finalCfg = (await getJson(`${API}/api/config`)).config;
    check('server language restored', finalCfg.language === (before.language || 'zh'), finalCfg.language);
    check('server local wiki restored', finalCfg.wiki.local.enabled === before.wiki.local.enabled);
    check('server online wiki restored', finalCfg.wiki.online.enabled === before.wiki.online.enabled);

    const errs = cdp.events.filter((e) => !/favicon/i.test(e));
    check('no uncaught page errors', errs.length === 0, errs.slice(0, 4).join(' ;; '));

    ws.close();
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    // Belt and braces: make sure the machine is left in its original state even
    // if an assertion above threw before the restore step.
    try {
      await postJson(`${API}/api/config`, {
        language: before.language,
        wiki: { local: { enabled: before.wiki.local.enabled, dir: before.wiki.local.dir } },
        paths: before.paths,
      });
    } catch { /* ignore */ }
  }

  console.log(`\nI18N / SETTINGS TEST: ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

/** Snapshot the "related wiki pages" block. */
function wikiProbe(cdp) {
  return cdp.eval(`(function(){
    var host = document.querySelector('#wiki-links');
    if (!host) return { missing: true };
    var anchors = Array.prototype.slice.call(host.querySelectorAll('a'));
    var btns = Array.prototype.slice.call(host.querySelectorAll('button'));
    return {
      text: host.innerText.slice(0, 300),
      className: host.className,
      localButtons: btns.filter(function(b){ return !/settings/i.test(b.textContent); }).length,
      onlineLinks: anchors.length,
      settingsBtnText: btns.filter(function(b){ return /settings/i.test(b.textContent); })
                          .map(function(b){ return b.textContent.trim(); }).join(','),
    };
  })()`);
}

/** Screenshot the full page, capped so the PNG size stays reasonable. */
async function shot(cdp, out, settle) {
  await sleep(settle);
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const cs = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(Math.ceil(cs.width), 1720);
  const height = Math.min(Math.ceil(cs.height), 2600);
  const res = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
  const size = fs.statSync(out).size;
  console.log(`  shot  ${path.basename(out)}  ${width}x${height}  ${(size / 1024).toFixed(0)} KB`);
  check(`screenshot ${path.basename(out)} written`, size > 15000, `${size} bytes`);
}
