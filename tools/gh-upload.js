'use strict';
/*
 * gh-upload.js -- publish this working tree to GitHub without a local git.
 *
 * There is no git on this machine, so instead of commits-from-a-clone we build
 * the commit server side with the GitHub REST API: one blob per file, one tree
 * pointing at those blobs, one commit over that tree, then move the branch ref.
 *
 * The token is never taken from argv (argv is visible in the process list and
 * would end up in shell history). Pass it through the environment:
 *
 *   $env:GH_TOKEN = 'ghp_...'; node tools/gh-upload.js --repo eu4-mod-viewer
 *   node tools/gh-upload.js --dry-run                 # list what would ship
 *
 * Note for anyone reading this later: the surrounding viewer project forbids
 * runtime dependencies, and this script is no exception -- global fetch only.
 */

const fs = require('fs');
const path = require('path');

const API = 'https://api.github.com';
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo' || a === '--owner' || a === '--token' || a === '--message' ||
        a === '--description' || a === '--branch') {
      out[a.slice(2)] = argv[++i];
    } else if (a === '--private') {
      out.visibility = 'private';
    } else if (a === '--public') {
      out.visibility = 'public';
    } else if (a === '--dry-run' || a === '--json') {
      out[a.slice(2).replace(/-/g, '')] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

// --- .gitignore, honoured to the extent this repo needs ---------------------
// The real rules are simple: exact paths, bare directory names and *.ext globs.
function loadIgnore(root) {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return { isEmpty: () => false };
  const rules = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
  return {
    rules,
    isEmpty(rel) {
      const p = rel.split(path.sep).join('/');
      for (const r of rules) {
        const dir = r.endsWith('/');
        const pat = r.replace(/\/+$/, '').replace(/^\//, '');
        if (dir) {
          if (p === pat || p.startsWith(pat + '/')) return true;
        } else if (pat.includes('*')) {
          const rx = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
          if (rx.test(p) || p.split('/').some((seg) => rx.test(seg))) return true;
        } else if (p === pat || p.startsWith(pat + '/') || p.endsWith('/' + pat)) {
          return true;
        }
      }
      return false;
    }
  };
}

function collect(root) {
  const ignore = loadIgnore(root);
  const files = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git' || name === 'node_modules') continue;
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      if (ignore.isEmpty(rel)) continue;
      const st = fs.statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) files.push({ rel: rel.split(path.sep).join('/'), abs, size: st.size });
    }
  })(root);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files;
}

// --- GitHub API ------------------------------------------------------------
async function api(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
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
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = (json && json.message) || text.slice(0, 300) || res.statusText;
    const err = new Error('HTTP ' + res.status + ' ' + method + ' ' + url + ' -> ' + msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Publish ROOT to GitHub.
 *
 * `tokenOverride` exists so a caller (tools/gh-login.js) can hand the token over
 * in memory. Never route a real token through argv: it shows up in the process
 * list and in shell history.
 */
async function run(opts) {
  opts = opts || {};
  const args = opts.args || parseArgs(process.argv.slice(2));
  const token = opts.token || args.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = args.repo || 'eu4-mod-viewer';
  const branch = args.branch || 'main';
  const visibility = args.visibility || 'public';
  const message =
    args.message ||
    'EU4 mod 改动可视化查看器：首次提交（查看器源码 + 文档 + 截图，MIT）';
  const description =
    args.description ||
    'Local, zero-dependency viewer for Europa Universalis IV mods: browse every change a mod makes, rendered the way the game displays it. 本地 EU4 mod 改动可视化查看器。';

  const files = collect(ROOT);
  const bytes = files.reduce((s, f) => s + f.size, 0);

  if (args.dryrun) {
    for (const f of files) console.log(String(f.size).padStart(9), f.rel);
    console.log('\n' + files.length + ' files, ' + (bytes / 1048576).toFixed(2) + ' MB');
    return { dryRun: true, files: files.length, bytes };
  }
  if (!token) throw new Error('no token: set $env:GH_TOKEN, pass --token, or use tools/gh-login.js');

  console.log('authenticating...');
  const me = await api(token, 'GET', '/user');
  const owner = args.owner || me.login;
  console.log('  user: ' + me.login + (owner !== me.login ? ' (owner override: ' + owner + ')' : ''));

  console.log('repository ' + owner + '/' + repo + ' ...');
  let exists = true;
  let info;
  try {
    info = await api(token, 'GET', '/repos/' + owner + '/' + repo);
  } catch (e) {
    if (e.status !== 404) throw e;
    exists = false;
  }
  if (!exists) {
    info = await api(token, 'POST', '/user/repos', {
      name: repo,
      description,
      private: visibility === 'private',
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false
    });
    console.log('  created (' + visibility + ')');
  } else {
    console.log('  already exists, updating description + pushing a new commit');
    await api(token, 'PATCH', '/repos/' + owner + '/' + repo, { description });
  }

  // Parent commit, if the branch already has one.
  let parent = null;
  try {
    const ref = await api(token, 'GET', '/repos/' + owner + '/' + repo + '/git/ref/heads/' + branch);
    parent = ref.object.sha;
    console.log('  branch ' + branch + ' at ' + parent.slice(0, 7));
  } catch (e) {
    if (e.status !== 404 && e.status !== 409) throw e;
    console.log('  branch ' + branch + ' is empty (first commit)');
  }

  // A repository with no commits at all cannot take blobs written through the
  // Git Data API: POST /git/blobs answers 409 "Git Repository is empty." The
  // only way in is the Contents API, which commits on its own. So seed the
  // repository with one real file, then build the full tree on top of it.
  if (!parent) {
    console.log('  仓库为空，先用 Contents API 落一个初始提交（GitHub 限制，必须如此）...');
    parent = await seedRepository({ api, token, owner, repo, branch, fs, path, ROOT });
    console.log('  bootstrap commit ' + parent.slice(0, 7));
  }

  console.log('uploading ' + files.length + ' files (' + (bytes / 1048576).toFixed(2) + ' MB) as blobs...');
  const tree = [];
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const data = fs.readFileSync(f.abs).toString('base64');
    let blob;
    try {
      blob = await api(token, 'POST', '/repos/' + owner + '/' + repo + '/git/blobs', {
        content: data,
        encoding: 'base64'
      });
    } catch (e) {
      // Belt and braces: an empty repository cannot accept blobs written through
      // the Git Data API (409 "Git Repository is empty."). The seeding above
      // normally prevents this; if a repository is created between the two
      // steps, seed now and retry this one blob.
      if (e.status === 409 && !parent) {
        console.log('  遇到空仓库的 409，补一个初始提交后重试...');
        parent = await seedRepository({ api, token, owner, repo, branch, fs, path, ROOT });
        blob = await api(token, 'POST', '/repos/' + owner + '/' + repo + '/git/blobs', {
          content: data,
          encoding: 'base64'
        });
      } else {
        throw e;
      }
    }
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    done++;
    if (done % 10 === 0 || done === files.length) {
      console.log('  ' + done + '/' + files.length);
    }
  }

  console.log('building tree...');
  const treeRes = await api(token, 'POST', '/repos/' + owner + '/' + repo + '/git/trees', {
    tree
  });

  console.log('creating commit...');
  const now = new Date().toISOString();
  const author = {
    name: me.name || me.login,
    email: me.id + '+' + me.login + '@users.noreply.github.com',
    date: now
  };
  const commit = await api(token, 'POST', '/repos/' + owner + '/' + repo + '/git/commits', {
    message,
    tree: treeRes.sha,
    parents: parent ? [parent] : [],
    author,
    committer: author
  });

  console.log('moving ref heads/' + branch + ' -> ' + commit.sha.slice(0, 7));
  if (parent) {
    await api(token, 'PATCH', '/repos/' + owner + '/' + repo + '/git/refs/heads/' + branch, {
      sha: commit.sha,
      force: false
    });
  } else {
    await api(token, 'POST', '/repos/' + owner + '/' + repo + '/git/refs', {
      ref: 'refs/heads/' + branch,
      sha: commit.sha
    });
  }

  // Make sure the branch we pushed is the one GitHub shows by default. A fresh
  // repository is created with whatever default_branch GitHub picked (often
  // "master"), which would otherwise leave the pushed branch hidden.
  if (info.default_branch !== branch) {
    try {
      await api(token, 'PATCH', '/repos/' + owner + '/' + repo, { default_branch: branch });
      console.log('  default branch set to ' + branch);
    } catch (e) {
      console.log('  WARNING: could not set default branch: ' + e.message);
    }
  }

  const result = {
    owner,
    repo,
    url: 'https://github.com/' + owner + '/' + repo,
    commit: commit.sha,
    files: files.length,
    bytes
  };

  console.log('\nDONE');
  console.log('  ' + result.url);
  console.log('  commit ' + commit.sha);
  console.log('  files  ' + files.length + ' (' + (bytes / 1048576).toFixed(2) + ' MB)');
  console.log('\nUploaded file list was read from ' + ROOT + ', honouring .gitignore.');
  return result;
}

/**
 * GitHub refuses POST /git/blobs while a repository has no commits at all
 * ("409 Git Repository is empty."). The Contents API is the only door in,
 * because it creates the commit for you. Seed with one real tracked file -- the
 * .gitignore -- and return the resulting commit sha, which then becomes the
 * parent of the real commit.
 */
async function seedRepository(ctx) {
  const seedPath = '.gitignore';
  const seedAbs = ctx.path.join(ctx.ROOT, seedPath);
  const seed = ctx.fs.existsSync(seedAbs)
    ? ctx.fs.readFileSync(seedAbs).toString('base64')
    : Buffer.from('# placeholder\n').toString('base64');
  const seeded = await ctx.api(ctx.token, 'PUT',
    '/repos/' + ctx.owner + '/' + ctx.repo + '/contents/' + seedPath, {
      message: 'chore: 初始化仓库（占位提交，随后立即被完整提交取代）',
      content: seed,
      branch: ctx.branch
    });
  return seeded.commit.sha;
}

module.exports = { run, collect, parseArgs, ROOT, seedRepository };

if (require.main === module) {
  run().catch((e) => {
    // Never echo the request body: it can contain the token in headers only, but
    // be defensive anyway.
    console.error('\nFAILED: ' + e.message);
    if (e.body && e.body.errors) console.error('  ' + JSON.stringify(e.body.errors));
    process.exit(1);
  });
}
