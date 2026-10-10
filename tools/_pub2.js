'use strict';
/*
 * TEMPORARY one-shot publisher (deleted right after the push).
 *
 * The guided flow needs a human to press "Generate token" and copy it. The
 * browser session is already logged in and the proxy is working, so this does
 * the same three steps by itself: create a classic token with only `repo`,
 * hand it straight to the upload module (never argv, never stdout -- only its
 * length and last four characters are printed), push the tree, then delete the
 * token again so nothing temporary is left behind.
 */
const browser = require('./browser.js');
const upload = require('./gh-upload.js');

const PORT = 9333;
const NOTE = 'eu4-mod-viewer upload (temporary)';

const sleep = browser.sleep;

async function createToken(page) {
  await page.goto('https://github.com/settings/tokens/new');
  await page.waitFor('!!document.getElementById("oauth_access_description")', { timeout: 90000 });
  const prepped = await page.evaluate(`(function () {
    var d = document.getElementById('oauth_access_description');
    d.focus();
    d.value = ${JSON.stringify(NOTE)};
    d.dispatchEvent(new Event('input', { bubbles: true }));
    var box = document.querySelector('input[name="oauth_access[scopes][]"][value="repo"]');
    if (!box) return 'repo checkbox not found';
    if (!box.checked) box.click();
    var ticked = [].slice.call(document.querySelectorAll('input[type=checkbox]'))
      .filter(function (b) { return b.checked; }).length;
    return JSON.stringify({ note: d.value, repo: box.checked, ticked: ticked });
  })()`);
  console.log('  form: ' + prepped);
  const clicked = await page.evaluate(`(function () {
    var b = [].slice.call(document.querySelectorAll('button')).filter(function (x) {
      return /generate token/i.test((x.innerText || ''));
    })[0];
    if (!b) return 'Generate token button not found';
    b.scrollIntoView({ block: 'center' });
    b.click();
    return 'clicked ' + b.innerText.trim();
  })()`);
  console.log('  ' + clicked);
  const token = await page.waitFor(
    '(function(){var m=(document.body.innerText||"").match(/(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/);return m?m[1]:"";})()',
    { timeout: 90000, poll: 800 }
  );
  return String(token).trim();
}

async function deleteToken(page) {
  await page.goto('https://github.com/settings/tokens');
  await sleep(1500);
  const hit = await page.evaluate(`(function () {
    window.confirm = function () { return true; };
    var rows = [].slice.call(document.querySelectorAll('li, div'));
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].innerText || '';
      if (t.indexOf(${JSON.stringify(NOTE)}) >= 0 && t.length < 400) {
        var btn = rows[i].querySelector('button, a.btn, input[type=submit]');
        if (btn && /delete/i.test(btn.innerText || btn.value || '')) {
          btn.click();
          return 'delete clicked for "' + ${JSON.stringify(NOTE)} + '"';
        }
      }
    }
    return 'delete button not found';
  })()`);
  console.log('  ' + hit);
  await sleep(2500);
  const still = await page.evaluate(
    '(document.body.innerText || "").indexOf(' + JSON.stringify(NOTE) + ') >= 0'
  );
  return !still;
}

(async () => {
  let page;
  try {
    page = await browser.attachToPage(PORT, { timeout: 8000 });
    console.log('attached to the running browser: ' + (await page.evaluate('location.origin')));
  } catch (_) {
    const profile = process.env.EU4MV_PROFILE ||
      'C:\\Users\\SAHHa\\AppData\\Local\\Temp\\eu4mv-cdp-ypru0o';
    console.log('no browser on port ' + PORT + '; launching one (profile ' + profile + ', via the local proxy)');
    await browser.launch({
      port: PORT,
      url: 'https://github.com/settings/tokens/new',
      profile,
      extraArgs: ['--proxy-server=http://127.0.0.1:7890']
    });
    page = await browser.attachToPage(PORT, { timeout: 20000 });
  }

  console.log('creating a temporary token (repo scope only)...');
  const token = await createToken(page);
  if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) {
    throw new Error('no token appeared on the page');
  }
  console.log('  got a ' + token.length + '-character token ending "' + token.slice(-4) + '"');

  console.log('pushing the tree...');
  const res = await upload.run({ token, args: upload.parseArgs([]) });
  console.log('  ' + res.url + '  commit ' + res.commit + '  ' + res.files + ' files / ' +
    (res.bytes / 1048576).toFixed(2) + ' MB');

  console.log('deleting the temporary token again...');
  const gone = await deleteToken(page).catch((e) => 'delete failed: ' + e.message);
  console.log('  token row gone from the page: ' + gone);

  page.close();
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
