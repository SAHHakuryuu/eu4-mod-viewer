'use strict';
/*
 * TEMPORARY publishing helper (deleted once the push is done).
 *
 * Drives the Chrome instance that tools/gh-login.js launched on port 9333, so
 * the token page can be looked at (screenshot + DOM report) and the
 * "Generate token" button pressed from here instead of by hand. The token is
 * never printed: `token2box` moves it from the page into gh-login's paste box,
 * and only its length leaves this process.
 *
 *   node tools/_pub-act.js look tools/_pub1.png
 *   node tools/_pub-act.js click "button[type=submit]"
 *   node tools/_pub-act.js token2box
 */
const fs = require('fs');
const path = require('path');
const browser = require('./browser.js');

const PORT = 9333;

async function main() {
  const cmd = process.argv[2] || 'look';
  const page = await browser.attachToPage(PORT, { timeout: 15000 });

  if (cmd === 'look') {
    const file = process.argv[3] || path.join(__dirname, '_pub-look.png');
    const info = await page.evaluate(`(function () {
      var q = function (s) { return document.querySelector(s) ? 1 : 0; };
      var buttons = [].slice.call(document.querySelectorAll('button, input[type=submit]'))
        .map(function (b) { return ((b.innerText || b.value || '') + '').trim().slice(0, 40); })
        .filter(function (s) { return s; }).slice(0, 14);
      return JSON.stringify({
        href: location.href,
        title: document.title,
        hasDescription: q('#oauth_access_description'),
        hasRepoScope: q('#scope_repo'),
        note: (document.querySelector('#oauth_access_description') || {}).value || '',
        repoChecked: !!(document.querySelector('#scope_repo') || {}).checked,
        pasteBox: q('#__eu4mv_box'),
        pasteValue: (document.querySelector('#__eu4mv_box') || {}).value ? 'filled' : 'empty',
        tokenShown: q('#new-oauth-token') || q('.token') || q('code.js-clipboard-copy'),
        buttons: buttons
      });
    })()`);
    console.log(info);
    await page.screenshot(file);
    console.log('screenshot: ' + file + '  ' + fs.statSync(file).size + ' bytes');
  } else if (cmd === 'scopes') {
    const r = await page.evaluate(`(function () {
      var boxes = [].slice.call(document.querySelectorAll('input[type=checkbox]')).map(function (b) {
        var lab = b.closest('li,div,label');
        return { id: b.id, name: b.name, value: b.value, checked: b.checked,
                 text: ((lab && lab.innerText) || '').trim().split('\\n')[0].slice(0, 30) };
      });
      var desc = document.querySelector('#oauth_access_description');
      return JSON.stringify({ note: desc ? desc.id : null, boxes: boxes.slice(0, 30) }, null, 1);
    })()`);
    console.log(r);
  } else if (cmd === 'prep') {
    const r = await page.evaluate(`(function () {
      var out = {};
      var d = document.getElementById('oauth_access_description');
      if (d) {
        d.focus();
        d.value = 'eu4-mod-viewer upload (temporary)';
        d.dispatchEvent(new Event('input', { bubbles: true }));
        out.note = d.value;
      } else out.note = 'not found';
      var box = document.querySelector('input[name="oauth_access[scopes][]"][value="repo"]');
      if (!box) { out.repo = 'checkbox not found'; return JSON.stringify(out); }
      if (!box.checked) box.click();
      out.repo = box.checked ? 'repo scope ticked' : 'click failed';
      var ticked = [].slice.call(document.querySelectorAll('input[type=checkbox]'))
        .filter(function (b) { return b.checked; }).length;
      out.tickedBoxes = ticked;
      return JSON.stringify(out);
    })()`);
    console.log(r);
  } else if (cmd === 'goto') {
    const url = process.argv[3];
    await page.goto(url);
    await browser.sleep(2500);
    console.log('now at: ' + (await page.evaluate('location.href')));
  } else if (cmd === 'click') {
    const sel = process.argv[3];
    const r = await page.evaluate(
      `(function () {
        var n = document.querySelector(${JSON.stringify(sel)});
        if (!n) return 'not found';
        n.scrollIntoView({ block: 'center' });
        n.click();
        return 'clicked: ' + ((n.innerText || n.value || '') + '').trim().slice(0, 40);
      })()`
    );
    console.log(r);
    await browser.sleep(2500);
    console.log('now at: ' + (await page.evaluate('location.href')));
  } else if (cmd === 'token2box') {
    const r = await page.evaluate(`(function () {
      var t = '';
      var cand = ['#new-oauth-token', 'code.js-clipboard-copy', '.token', 'input#new-oauth-token'];
      for (var i = 0; i < cand.length && !t; i++) {
        var n = document.querySelector(cand[i]);
        if (n) t = ((n.value || n.innerText || n.textContent) + '').trim();
      }
      if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(t)) {
        var m = (document.body.innerText || '').match(/(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/);
        t = m ? m[1] : '';
      }
      if (!t) return 'no token on the page';
      var box = document.getElementById('__eu4mv_box');
      if (!box) return 'token found (len ' + t.length + ') but no paste box';
      box.value = t;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return 'token of length ' + t.length + ' handed to the paste box';
    })()`);
    console.log(r);
  } else if (cmd === 'copyclip') {
    // Last resort: put the page's token into the OS clipboard (readable by
    // gh-login's PowerShell channel), without printing it.
    const r = await page.evaluate(
      `(function () {
        var m = (document.body.innerText || '').match(/(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/);
        if (!m) return 'no token on the page';
        return navigator.clipboard.writeText(m[1]).then(function () { return 'copied ' + m[1].length + ' chars'; },
          function (e) { return 'clipboard write failed: ' + e.message; });
      })()`,
      { awaitPromise: true }
    );
    console.log(r);
  }
  page.close();
}

main().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
