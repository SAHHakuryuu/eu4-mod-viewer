'use strict';
/*
 * gh-login.js -- guided GitHub publishing, driven through a browser I control.
 *
 * Why this exists: GitHub has to be authorised by the human, and there is no git
 * on this machine to delegate that to. So this script
 *
 *   1. launches its own debuggable Chrome with a throwaway profile -- your normal
 *      browser window, its cookies and its logins are never touched,
 *   2. opens the classic-token page and ticks the right scope,
 *   3. draws the instructions ON the GitHub page itself, so the guidance cannot
 *      drift out of sync with what you are looking at,
 *   4. takes the token out of the clipboard (never the chat, never a file),
 *   5. creates the repository and commits every file through the REST API,
 *   6. walks you to the "Delete" button afterwards.
 *
 *   node tools/gh-login.js                # public repo named eu4-mod-viewer
 *   node tools/gh-login.js --private
 *   node tools/gh-login.js --repo other-name
 *
 * The token lives only in this process's memory and dies with it.
 */

const browser = require('./browser.js');
const upload = require('./gh-upload.js');

const sleep = browser.sleep;

function parseArgs(argv) {
  const out = { visibility: 'public', keepOpen: true, timeoutMin: 20, repo: 'eu4-mod-viewer' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--private') out.visibility = 'private';
    else if (a === '--public') out.visibility = 'public';
    else if (a === '--close') out.keepOpen = false;
    else if (a === '--timeout') out.timeoutMin = Number(argv[++i]) || 20;
    else if (a === '--repo') out.repo = argv[++i] || out.repo;
    else if (a === '--profile') out.profile = argv[++i] || undefined;
    else if (a === '--proxy') out.proxy = argv[++i] || undefined;
  }
  // A proxy is often the only way github.com loads: the system proxy can be
  // switched off while the client is still listening on 127.0.0.1:7890, and a
  // throwaway Chrome profile has none of your extensions to fall back on. Set
  // it explicitly and the token page comes up.
  if (!out.proxy && process.env.EU4MV_PROXY) out.proxy = process.env.EU4MV_PROXY;
  return out;
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// --- on-page guidance ------------------------------------------------------
const banner = (html) => `
(function () {
  var old = document.getElementById('__eu4mv');
  if (old) old.remove();
  var d = document.createElement('div');
  d.id = '__eu4mv';
  d.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;' +
    'background:#0b3d2c;color:#eafff4;font:15px/1.75 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;' +
    'padding:14px 20px;box-shadow:0 6px 24px rgba(0,0,0,.5);border-bottom:3px solid #28c07a';
  d.innerHTML = ${JSON.stringify(html)};
  document.documentElement.appendChild(d);
  return 'ok';
})()`;

const clearBanner = `
(function () {
  var a = document.getElementById('__eu4mv'); if (a) a.remove();
  var h = document.querySelectorAll('.__eu4mv_hl');
  for (var i = 0; i < h.length; i++) h[i].remove();
  return 'cleared';
})()`;

// Yellow ring around the controls the user has to touch, computed live so it
// follows scrolling and layout.
const highlight = (selectors) => `
(function () {
  var sels = ${JSON.stringify(selectors)};
  var h = document.querySelectorAll('.__eu4mv_hl');
  for (var i = 0; i < h.length; i++) h[i].remove();
  var n = 0;
  sels.forEach(function (s) {
    var els = document.querySelectorAll(s);
    for (var j = 0; j < els.length; j++) {
      var r = els[j].getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      var x = document.createElement('div');
      x.className = '__eu4mv_hl';
      x.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;' +
        'border:3px solid #ffb300;border-radius:6px;' +
        'box-shadow:0 0 0 3px rgba(255,179,0,.25),0 0 20px rgba(255,179,0,.6);' +
        'left:' + (r.left - 5) + 'px;top:' + (r.top - 5) + 'px;' +
        'width:' + (r.width + 10) + 'px;height:' + (r.height + 10) + 'px';
      document.documentElement.appendChild(x);
      n++;
    }
  });
  return n;
})()`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const openUrl = 'https://github.com/settings/tokens/new?scopes=repo&description=' +
    encodeURIComponent('eu4-mod-viewer upload (temporary)');

  console.log('启动一个我自己能控制的 Chrome 窗口（全新独立配置，不碰你现有的窗口和数据）...');
  const L = await browser.launch({
    port: 9333,
    url: openUrl,
    profile: args.profile,
    extraArgs: args.proxy ? ['--proxy-server=' + args.proxy] : undefined
  });
  console.log('  chrome pid ' + L.proc.pid + '  profile ' + L.profile +
    (args.proxy ? '  proxy ' + args.proxy : '') + '\n');

  const page = await browser.attachToPage(9333);
  await page.send('Page.enable');
  await page.goto(openUrl);
  await sleep(2500);

  const here = await page.evaluate('location.href');
  const onTokenPage = await page.evaluate('!!document.getElementById("oauth_access_description")');

  if (!onTokenPage) {
    console.log('需要你先在这个新窗口里登录 GitHub（Chrome 已经认出你的账号，填密码即可）');
    await page.evaluate(banner(
      '<b>第 1 步 / 3：登录 GitHub</b>' +
      '<div style="margin-top:6px">这个窗口是全新配置，所以要你登录一次。' +
      '用户名已经填好了，你只需要填密码，然后按页面上的 <b>Sign in</b>。' +
      '登录成功后我会自动跳到 token 页面，你不用管地址栏。</div>' +
      '<div style="margin-top:8px;opacity:.75;font-size:13px">为什么不让浏览器记住 token：' +
      '这个窗口是临时的，关掉就没了；你自己的浏览器不受影响。</div>'
    ));
    await page.waitFor(
      'location.pathname.indexOf("/settings/tokens/new") === 0 && !!document.getElementById("oauth_access_description")',
      { timeout: args.timeoutMin * 60000, poll: 1200 }
    );
    console.log('  登录成功');
  }

  // Fill the note and tick "repo" for the user, then ring the controls.
  const prepped = await page.evaluate(`
  (function () {
    var out = { note: 'skip', repo: 'not found', scopes: 0 };
    var n = document.getElementById('oauth_access_description');
    if (n) {
      if (!n.value) {
        n.focus();
        n.value = 'eu4-mod-viewer upload';
        n.dispatchEvent(new Event('input', { bubbles: true }));
      }
      out.note = 'ok';
    }
    var boxes = document.querySelectorAll('input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      var li = boxes[i].closest('li') || boxes[i].parentElement;
      var txt = (li ? li.innerText : '').trim();
      if (/^repo\\b/.test(txt)) {
        if (!boxes[i].checked) boxes[i].click();
        out.repo = boxes[i].checked ? 'checked' : 'click failed';
      }
    }
    var s = document.getElementById('oauth_access_scopes');
    if (s) s.scrollIntoView({ block: 'center' });
    return out;
  })()`);
  console.log('  表单准备: ' + JSON.stringify(prepped));
  await sleep(500);

  // Ring the three controls the user has to touch. Selectors are computed live
  // so scrolling and GitHub's own layout changes do not invalidate them.
  const hl = await page.evaluate(`
  (function () {
    var sels = ['#oauth_access_description', '#oauth_access_scopes'];
    var boxes = document.querySelectorAll('input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      var li = boxes[i].closest('li') || boxes[i].parentElement;
      var txt = (li ? li.innerText : '').trim();
      if (/^repo\\b/.test(txt)) {
        if (boxes[i].id) sels.push('#' + boxes[i].id);
        else boxes[i].setAttribute('data-eu4mv', '1'), sels.push('[data-eu4mv="1"]');
      }
    }
    var h = document.querySelectorAll('.__eu4mv_hl');
    for (var k = 0; k < h.length; k++) h[k].remove();
    var n = 0;
    sels.forEach(function (s) {
      var els = document.querySelectorAll(s);
      for (var j = 0; j < els.length; j++) {
        var r = els[j].getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        var x = document.createElement('div');
        x.className = '__eu4mv_hl';
        x.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;' +
          'border:3px solid #ffb300;border-radius:6px;' +
          'box-shadow:0 0 0 3px rgba(255,179,0,.25),0 0 20px rgba(255,179,0,.6);' +
          'left:' + (r.left - 5) + 'px;top:' + (r.top - 5) + 'px;' +
          'width:' + (r.width + 10) + 'px;height:' + (r.height + 10) + 'px';
        document.documentElement.appendChild(x);
        n++;
      }
    });
    return n;
  })()`);
  console.log('  高亮 ' + hl + ' 个控件');

  await page.evaluate(banner(
    '<b>第 2 步 / 3：生成 token</b>' +
    '<div style="margin-top:6px">① <b>Note</b> 我填好了；② <b>repo</b> 这一项我已经帮你勾上（见黄框）；' +
    '③ 滚到页面最底部，点绿色的 <b>Generate token</b>。</div>' +
    '<div style="margin-top:8px">点完会跳到显示 token 的页面。' +
    '<b>到那一页之后，我会再弹一个输入框</b>——你把 token 粘进去就行（或者直接 Ctrl+C 复制，两条路都可以）。' +
    '它只用于这一次上传，不写进任何文件。</div>'
  ));

  console.log('\n等你在浏览器里生成并复制 token...（最多 ' + args.timeoutMin + ' 分钟）');
  console.log('  提示：如果自动读取剪贴板被浏览器拒绝（窗口不在前台时会发生），');
  console.log('  我会在页面上放一个输入框，你把 token 粘进去就行。\n');

  const copied = await waitForToken(page, args.timeoutMin * 60000);
  console.log('\n拿到 token（' + copied.length + ' 字符，结尾 "' + copied.slice(-4) + '"），先验证身份...');

  const me = await github(copied, 'GET', '/user');
  console.log('  已认证为 ' + me.login);

  await page.evaluate(clearBanner);
  await page.evaluate(banner(
    '<b>第 3 步 / 3：上传中，请不要关这个窗口</b>' +
    '<div style="margin-top:6px">正在通过 GitHub API 建立 commit，共 100 多个文件 / 约 16.6 MB，通常 1～3 分钟。' +
    '进度看运行脚本的那个终端窗口。</div>'
  ));

  console.log('\n开始上传...\n');
  const result = await upload.run({
    token: copied,
    args: Object.assign(upload.parseArgs([]), {
      repo: args.repo,
      visibility: args.visibility
    })
  });

  console.log('\n带你到撤销页面...');
  await page.goto('https://github.com/settings/tokens');
  await sleep(1200);
  await page.evaluate(banner(
    '<b>完成！最后一步：删掉这个临时 token</b>' +
    '<div style="margin-top:6px">仓库 <b>' + esc(result.url) + '</b> 已经建好，' +
    result.files + ' 个文件（' + (result.bytes / 1048576).toFixed(2) + ' MB）已提交。</div>' +
    '<div style="margin-top:8px">下面列表最上面那条 <b>eu4-mod-viewer upload</b> 就是刚才用的 token，' +
    '点它右边的 <b>Delete</b> 删掉。删掉不影响仓库，只是以后不能再用这个 token 推送。</div>'
  ));
  await page.evaluate(highlight(['.listgroup-item:first-child', 'a[href*="/settings/tokens/"]']));

  console.log('\n===================  完 成  ===================');
  console.log('  仓库    ' + result.url);
  console.log('  commit  ' + result.commit);
  console.log('  文件    ' + result.files + ' 个 / ' + (result.bytes / 1048576).toFixed(2) + ' MB');
  console.log('================================================');
  console.log('\n浏览器里已打开撤销页面：请点那条 token 右边的 Delete。');
  console.log('窗口我留着不关，你确认完自己关掉就行。');

  if (args.keepOpen) {
    // Hold the process so the revoke page stays under our control until the user
    // is done; Ctrl+C here is also fine, it does not touch the repo.
    await page.waitFor('false', { timeout: 60 * 60000, poll: 5000 }).catch(() => {});
  }
}

/**
 * Get the token out of the browser, by whichever channel is available.
 *
 * `navigator.clipboard.readText()` needs the document to be focused, and a
 * browser we launched ourselves often is not the foreground window --
 * SetForegroundWindow is refused by the Windows foreground lock, so that is not
 * something we can count on fixing. So there are three channels, polled
 * together:
 *
 *   1. the OS clipboard, via clipboard.readText()  (works only when focused)
 *   2. the OS clipboard, via PowerShell Get-Clipboard (no focus requirement)
 *   3. a paste box injected into the page (always works, needs one Ctrl+V)
 *
 * Clipboard access is read-only here; nothing is ever written to it.
 */
async function waitForToken(page, timeoutMs) {
  const stop = Date.now() + timeoutMs;
  let boxReady = false;
  let warned = false;
  let ticks = 0;

  while (Date.now() < stop) {
    ticks++;

    // Channel 3: make sure the paste box is on the current page.
    const onTokenPage = await page.evaluate(
      '!!document.getElementById("__eu4mv_box")'
    ).catch(() => false);
    if (!onTokenPage && ticks % 4 === 1) {
      const armed = await page.evaluate(installPasteBox).catch(() => false);
      if (armed && !boxReady) {
        boxReady = true;
        console.log('  已在页面上放好输入框（也可以直接 Ctrl+C，两条路都行）');
      }
    }
    const typed = await page
      .evaluate('(document.getElementById("__eu4mv_box")||{}).value || ""')
      .catch(() => '');
    if (isToken(typed)) return String(typed).trim();

    // Channels 1 + 2: the clipboard.
    const fromPage = await page
      .evaluate('navigator.clipboard.readText().then(t=>t,"")', { awaitPromise: true })
      .catch((e) => {
        if (!warned) {
          warned = true;
          console.log('  （页面读剪贴板被拒：' + e.message.split('\n')[0] + '，改用系统剪贴板/输入框）');
        }
        return '';
      });
    if (isToken(fromPage)) return String(fromPage).trim();

    if (ticks % 2 === 0) {
      const sys = await systemClipboard();
      if (isToken(sys)) return sys;
    }

    await sleep(1200);
  }
  throw new Error('等了 ' + Math.round(timeoutMs / 60000) + ' 分钟没拿到 token');
}

/** Read the OS clipboard without needing any window to be focused. */
function systemClipboard() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    // NOTE: the $ here is escaped because this string is built by the DSH
    // PowerShell host from time to time; in Node it is a plain $.
    const cmd = [
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
      '\u0024c = Get-Clipboard -Raw -ErrorAction SilentlyContinue;',
      'if (\u0024c) { [Console]::Out.Write(\u0024c) }'
    ].join('');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => resolve(err || !stdout ? '' : String(stdout).trim())
    );
  });
}

/** Inject a banner + paste box on whatever GitHub page is showing now. */
const installPasteBox = `
(function () {
  var old = document.getElementById('__eu4mv');
  if (old) old.remove();
  var d = document.createElement('div');
  d.id = '__eu4mv';
  d.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;' +
    'background:#0b3d2c;color:#eafff4;font:15px/1.75 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;' +
    'padding:14px 20px;box-shadow:0 6px 24px rgba(0,0,0,.5);border-bottom:3px solid #28c07a';
  d.innerHTML =
    '<b>把 token 粘进下面这个框（或按 Ctrl+C 复制，我会自动取走）</b>' +
    '<div style="margin-top:6px;display:flex;gap:10px;align-items:center">' +
    '<input id="__eu4mv_box" type="text" spellcheck="false" autocomplete="off" ' +
    'placeholder="点这里，然后 Ctrl+V 粘贴 ghp_... / github_pat_..." ' +
    'style="flex:1;font:14px/1.5 Consolas,monospace;padding:8px 10px;border-radius:6px;border:2px solid #ffb300;background:#fff;color:#111">' +
    '<span id="__eu4mv_state" style="min-width:150px;font-size:13px">等待粘贴…</span></div>' +
    '<div style="margin-top:6px;font-size:13px;opacity:.8">' +
    '这个 token 只用一次，上传完我会把你带到撤销页面。它不会写进任何文件。</div>';
  document.documentElement.appendChild(d);
  var box = document.getElementById('__eu4mv_box');
  function check() {
    var v = (box.value || '').trim();
    var ok = /^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(v);
    var s = document.getElementById('__eu4mv_state');
    if (s) s.textContent = ok ? '✓ 收到，正在上传' : (v ? '格式不像 token（' + v.length + ' 字符）' : '等待粘贴…');
  }
  box.addEventListener('input', check);
  box.addEventListener('paste', function () { setTimeout(check, 60); });
  setTimeout(function () { box.focus(); }, 200);
  return true;
})()`;

function isToken(s) {
  return /^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(String(s || '').trim());
}

async function github(token, method, url) {
  const res = await fetch('https://api.github.com' + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'eu4-mod-viewer-uploader'
    }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + ((body && body.message) || ''));
  return body;
}

main().catch(async (e) => {
  console.error('\nFAILED: ' + e.message);
  process.exitCode = 1;
});
