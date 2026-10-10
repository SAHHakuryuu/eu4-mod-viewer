'use strict';
/*
 * gh-delete.js -- remove paths from the GitHub repository.
 *
 * The companion problem to gh-upload.js: it can only add or overwrite files, so
 * without a local git there is no other way to mirror a deletion you made on
 * disk. Each path is deleted with one commit; that is fine for the handful of
 * files this is meant for.
 *
 *   node tools/gh-delete.js --path tools/gh-resume.js --path docs/old.md
 *   node tools/gh-delete.js --path tools/foo.js --token ghp_...
 *   node tools/gh-delete.js --path tools/foo.js --local     # also unlink locally
 *
 * The token can come from --token, $env:GH_TOKEN, or the Windows clipboard.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://api.github.com';

function parseArgs(argv) {
  const out = { paths: [], repo: 'eu4-mod-viewer', branch: 'main', local: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--path') out.paths.push(argv[++i]);
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--branch') out.branch = argv[++i];
    else if (a === '--owner') out.owner = argv[++i];
    else if (a === '--token') out.token = argv[++i];
    else if (a === '--message') out.message = argv[++i];
    else if (a === '--local') out.local = true;
  }
  return out;
}

/** Read the token from the Windows clipboard, so it never lands in argv. */
function clipboardToken() {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    const cmd =
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      '\u0024c = Get-Clipboard -Raw -ErrorAction SilentlyContinue;' +
      'if (\u0024c) { [Console]::Out.Write(\u0024c) }';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { timeout: 8000, windowsHide: true },
      (e, o) => resolve(e || !o ? '' : String(o).trim())
    );
  });
}

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: Object.assign(
      {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'eu4-mod-viewer-uploader'
      },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    /* not json */
  }
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + ' ' + method + ' ' + url + ' -> ' + ((json && json.message) || text.slice(0, 200)));
    err.status = res.status;
    throw err;
  }
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.paths.length) {
    console.error('usage: node tools/gh-delete.js --path <repo-relative-path> [--path ...] [--local]');
    process.exit(2);
  }
  const token = args.token || process.env.GH_TOKEN || (await clipboardToken());
  if (!token) {
    console.error('no token: pass --token, set $env:GH_TOKEN, or copy one to the clipboard');
    process.exit(2);
  }
  const me = await api(token, 'GET', '/user');
  const owner = args.owner || me.login;
  console.log('authenticated as ' + me.login + ', repo ' + owner + '/' + args.repo);

  for (const p of args.paths) {
    const rel = p.split(path.sep).join('/').replace(/^\.?\//, '');
    // Need the blob sha of the current content to delete it.
    const cur = await api(
      token,
      'GET',
      '/repos/' + owner + '/' + args.repo + '/contents/' + encodeURI(rel) + '?ref=' + args.branch
    );
    const sha = Array.isArray(cur) ? null : cur.sha;
    if (!sha) throw new Error('not a file (or not found): ' + rel);
    const res = await api(token, 'DELETE', '/repos/' + owner + '/' + args.repo + '/contents/' + encodeURI(rel), {
      message: args.message || ('chore: 删除 ' + rel),
      sha,
      branch: args.branch
    });
    console.log('  deleted ' + rel + ' -> commit ' + res.commit.sha.slice(0, 7));

    if (args.local) {
      const abs = path.join(ROOT, rel);
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
        console.log('  unlinked locally: ' + rel);
      }
    }
  }
  console.log('\ndone. https://github.com/' + owner + '/' + args.repo);
}

module.exports = { parseArgs, clipboardToken, api };

if (require.main === module) {
  main().catch((e) => {
    console.error('\nFAILED: ' + e.message);
    process.exit(1);
  });
}
