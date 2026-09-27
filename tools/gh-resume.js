'use strict';
/*
 * One-off recovery: continue the publish with the token that is still sitting in
 * the paste box of the browser window tools/gh-login.js opened. Exists because
 * the first attempt created the repository and then hit GitHub's "cannot write a
 * blob into an empty repository" rule.
 */
const browser = require('./browser.js');
const upload = require('./gh-upload.js');

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

(async () => {
  const page = await browser.attachToPage(9333);
  await page.send('Page.enable');

  let token = await page.evaluate(
    '(document.getElementById("__eu4mv_box")||{}).value || ""'
  );
  token = String(token).trim();
  if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) {
    console.log('paste box empty, trying the OS clipboard...');
    const sys = await new Promise((resolve) => {
      const { execFile } = require('child_process');
      const cmd =
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
        '\u0024c = Get-Clipboard -Raw -ErrorAction SilentlyContinue;' +
        'if (\u0024c) { [Console]::Out.Write(\u0024c) }';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
        { timeout: 8000, windowsHide: true },
        (e, o) => resolve(e || !o ? '' : String(o).trim()));
    });
    if (/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(sys)) token = sys;
  }
  if (!token) {
    console.error('no usable token found in the page or the clipboard -- aborting');
    process.exit(2);
  }
  console.log('token recovered from the page (' + token.length + ' chars, tail "' + token.slice(-4) + '")');

  await page.evaluate(`
  (function () {
    var s = document.getElementById('__eu4mv_state');
    if (s) s.textContent = '✓ 重试上传中…';
    return 'ok';
  })()`);

  console.log('\nre-running the upload...\n');
  const r = await upload.run({
    token,
    args: Object.assign(upload.parseArgs([]), { repo: 'eu4-mod-viewer', visibility: 'public' })
  });
  console.log('\nUPLOAD OK -> ' + r.url);

  // Leave the window on the revoke page with instructions, like gh-login does.
  try {
    await page.goto('https://github.com/settings/tokens');
    await browser.sleep(1500);
    await page.evaluate(`
    (function () {
      var old = document.getElementById('__eu4mv');
      if (old) old.remove();
      var d = document.createElement('div');
      d.id = '__eu4mv';
      d.style.cssText = 'position:fixed;z-index:2147483647;left:0;right:0;top:0;' +
        'background:#0b3d2c;color:#eafff4;font:15px/1.75 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;' +
        'padding:14px 20px;box-shadow:0 6px 24px rgba(0,0,0,.5);border-bottom:3px solid #28c07a';
      d.innerHTML = ${JSON.stringify(
        '<b>完成！最后一步：删掉这个临时 token</b>' +
        '<div style="margin-top:6px">仓库 <b>' + esc(r.url) + '</b> 已建好，' +
        r.files + ' 个文件（' + (r.bytes / 1048576).toFixed(2) + ' MB）已提交。</div>' +
        '<div style="margin-top:8px">下面列表最上面那条 <b>eu4-mod-viewer upload</b> 就是刚才用的 token，' +
        '点它右边的 <b>Delete</b> 删掉。删掉不影响仓库。</div>'
      )};
      document.documentElement.appendChild(d);
      return 'ok';
    })()`);
    console.log('browser left on the revoke page');
  } catch (e) {
    console.log('could not open the revoke page: ' + e.message);
  }

  page.close();
  process.exit(0);
})().catch((e) => {
  console.error('RECOVERY FAILED: ' + e.message);
  process.exit(1);
});
