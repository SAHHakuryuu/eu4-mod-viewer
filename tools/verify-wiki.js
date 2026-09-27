'use strict';
/**
 * Drives headless Edge over the DevTools protocol to verify the wiki iframe
 * actually renders, then captures a screenshot.
 *
 * Usage: node tools/verify-wiki.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'.replace('/Microsoft/', '/Microsoft/');
const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const PORT = 9222;
const APP = 'http://127.0.0.1:4173/';
const OUT = path.join(__dirname, 'shot-wiki-verified.png');

function findEdge() {
  for (const p of EDGE_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('msedge.exe not found');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
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
      }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  }
}

(async () => {
  const edge = findEdge();
  const userDataDir = path.join(os.tmpdir(), 'eu4viewer-cdp-' + Date.now());

  const proc = spawn(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1700,1400',
    APP,
  ], { stdio: 'ignore' });

  try {
    // Wait for the debugging endpoint.
    let version = null;
    for (let i = 0; i < 40 && !version; i++) {
      try { version = await getJson(`http://127.0.0.1:${PORT}/json/version`); }
      catch { await sleep(500); }
    }
    if (!version) throw new Error('DevTools endpoint never came up');
    console.log('browser:', version.Browser);

    // Find the page target.
    let target = null;
    for (let i = 0; i < 30 && !target; i++) {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await sleep(500);
    }
    if (!target) throw new Error('no page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // Wait for the app to finish booting AND for the first mod to render.
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.eval("!!document.querySelector('#mod-list .mod-item')");
      if (ready) break;
      await sleep(500);
    }
    console.log('app booted:', await cdp.eval("document.querySelectorAll('#mod-list .mod-item').length + ' mods listed'"));

    // The mod overview renders asynchronously (the file tree is large), so wait
    // for the category grid before driving the UI — otherwise selectMod() will
    // overwrite whatever we open.
    for (let i = 0; i < 60; i++) {
      const done = await cdp.eval("!!document.querySelector('.cat-grid') || !!document.querySelector('.article-title')");
      if (done) break;
      await sleep(500);
    }
    console.log('overview rendered:', await cdp.eval("!!document.querySelector('.cat-grid')"));

    // Open a category view (which hosts the wiki links) and then a wiki page.
    await cdp.eval("typeof openCategory === 'function' ? (openCategory('decisions'), 'ok') : 'openCategory NOT GLOBAL'")
      .then((v) => console.log('openCategory:', v));
    await sleep(1500);
    console.log('after openCategory, #wiki-links present:', await cdp.eval("!!document.querySelector('#wiki-links')"));
    const openResult = await cdp.eval(`
      Promise.resolve()
        .then(function(){ return showWikiPage('决议修改'); })
        .then(function(){ return 'RESOLVED'; })
        .catch(function(e){ return 'REJECTED: ' + (e && e.stack ? e.stack : e); })
    `);
    console.log('showWikiPage result:', openResult);
    await sleep(2200);

    // Inspect the iframe.
    const info = await cdp.eval(`(function(){
      var f = document.querySelector('#wiki-panel iframe');
      if (!f) return { found: false };
      var d = f.contentDocument;
      var bodyText = d && d.body ? d.body.innerText : '';
      return {
        found: true,
        hasDoc: !!d,
        bodyLength: bodyText.length,
        sample: bodyText.slice(0, 220),
        headings: d ? Array.prototype.map.call(d.querySelectorAll('h1,h2,h3'), function(h){return h.innerText.trim();}).filter(Boolean).slice(0,6) : [],
        tables: d ? d.querySelectorAll('table').length : -1,
        images: d ? d.querySelectorAll('img').length : -1
      };
    })()`);
    console.log('\nwiki iframe:', JSON.stringify(info, null, 2));

    // Also verify a decoded localisation file view renders Chinese rows.
    const locCheck = await cdp.eval(`(async function(){
      await openFile('localisation/replace/CE_great_project_l_english.yml', 'localisation');
      await new Promise(function(r){ setTimeout(r, 800); });
      var t = document.querySelectorAll('#file-view table.wikitable tbody tr');
      var first = t.length ? t[0].innerText : '';
      var hasChinese = /[\\u4e00-\\u9fff]/.test(document.querySelector('#file-view') ? document.querySelector('#file-view').innerText : '');
      await openCategory('decisions');
      await new Promise(function(r){ setTimeout(r, 500); });
      return { rows: t.length, firstRow: first, hasChinese: hasChinese };
    })()`);
    console.log('\nlocalisation view:', JSON.stringify(locCheck));

    // Re-open the wiki page now that the view is stable, then screenshot it.
    await cdp.eval("showWikiPage('决议修改')");
    await sleep(2200);
    const domState = await cdp.eval(`(function(){
      var p = document.querySelector('#wiki-panel');
      var a = document.querySelector('.article-title');
      var f = document.querySelector('#wiki-panel iframe');
      if (p) p.scrollIntoView({block:'start'});
      return {
        articleTitle: a ? a.textContent : null,
        panelExists: !!p,
        panelParent: p && p.parentNode ? (p.parentNode.className || p.parentNode.tagName) : null,
        panelRectTop: p ? Math.round(p.getBoundingClientRect().top) : null,
        panelHeight: p ? Math.round(p.getBoundingClientRect().height) : null,
        iframeRect: f ? {w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height)} : null,
        scrollY: Math.round(window.scrollY),
        bodyHeight: document.body.scrollHeight
      };
    })()`);
    console.log('DOM state before capture:', JSON.stringify(domState, null, 2));
    await sleep(700);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log('\nscreenshot written:', OUT, fs.statSync(OUT).size, 'bytes');

    ws.close();
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(600);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
