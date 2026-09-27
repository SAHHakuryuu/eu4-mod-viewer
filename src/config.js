'use strict';
/**
 * Persistent user settings.
 *
 * Everything the viewer cannot guess reliably — the UI language, where the
 * offline Chinese wiki lives, whether to link out to the English wiki, and
 * manual overrides for the mod/install directories — lives in `config.json`
 * next to the project root. The file is created on first write and is
 * deliberately human-editable.
 *
 * Precedence for every value: environment variable > config.json > default.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.EU4_MOD_VIEWER_CONFIG
  ? path.resolve(process.env.EU4_MOD_VIEWER_CONFIG)
  : path.join(ROOT, 'config.json');

const DEFAULT_ONLINE_WIKI = 'https://eu4.paradoxwikis.com/';

/** Defaults double as the schema: unknown keys are dropped, these are typed. */
function defaults() {
  return {
    language: 'zh', // 'zh' | 'en'
    wiki: {
      local: {
        enabled: true,
        dir: '', // absolute path to the offline dump root (the folder holding `wiki/`)
      },
      online: {
        enabled: true,
        base: DEFAULT_ONLINE_WIKI,
      },
    },
    paths: {
      userDir: '', // override for <Documents>/Paradox Interactive/Europa Universalis IV
      installDir: '', // override for the game install directory
    },
    server: {
      port: 4173,
      openBrowser: true,
    },
  };
}

let cache = null;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Recursively overlay `patch` onto `base`, keeping the shape of `base`. */
function merge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in out)) continue; // ignore unknown keys rather than persist junk
    if (isPlainObject(out[k]) && isPlainObject(v)) out[k] = merge(out[k], v);
    else if (typeof out[k] === 'string' && typeof v === 'string') out[k] = v.trim();
    else if (typeof out[k] === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (typeof out[k] === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Read config.json, tolerating a missing or corrupt file. */
function load() {
  if (cache) return cache;
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    raw = {};
  }
  cache = merge(defaults(), raw);
  applyEnv(cache);
  return cache;
}

/** Environment variables win over the file, so CI and one-off runs stay easy. */
function applyEnv(cfg) {
  if (process.env.EU4_MOD_VIEWER_LANG) cfg.language = String(process.env.EU4_MOD_VIEWER_LANG);
  if (process.env.EU4_WIKI_DIR) {
    cfg.wiki.local.dir = String(process.env.EU4_WIKI_DIR);
    cfg.wiki.local.enabled = true;
  }
  if (process.env.EU4_USER_DIR) cfg.paths.userDir = String(process.env.EU4_USER_DIR);
  if (process.env.EU4_INSTALL_DIR) cfg.paths.installDir = String(process.env.EU4_INSTALL_DIR);
  if (process.env.PORT) {
    const p = Number(process.env.PORT);
    if (Number.isFinite(p) && p > 0) cfg.server.port = p;
  }
  if (process.env.HOST) cfg.server.host = String(process.env.HOST);
  return cfg;
}

function get() {
  return load();
}

/** Write the current config back to disk (atomically enough for a local tool). */
function save() {
  const cfg = load();
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return cfg;
}

/**
 * Apply a partial patch. Only keys present in the defaults are accepted, so a
 * malformed request cannot inject arbitrary fields.
 */
function update(patch) {
  const cfg = load();
  const next = merge(cfg, patch);
  for (const k of Object.keys(cfg)) delete cfg[k];
  Object.assign(cfg, next);
  applyEnv(cfg);
  try {
    save();
  } catch (e) {
    return { config: cfg, saved: false, error: e.message };
  }
  return { config: cfg, saved: true };
}

/** Forget the in-memory copy (tests, and after an external file edit). */
function reload() {
  cache = null;
  return load();
}

// ---------------------------------------------------------------------------
// Directory detection
// ---------------------------------------------------------------------------

function existsDir(p) {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** A folder looks like the offline dump when it holds a non-trivial `wiki/`. */
function looksLikeWikiDump(dir) {
  const w = path.join(dir, 'wiki');
  if (!existsDir(w)) return false;
  try {
    const names = fs.readdirSync(w);
    let html = 0;
    for (const n of names) {
      if (/\.html$/i.test(n) && ++html >= 20) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Drive roots that currently exist (C: .. H:), for auto-detection. */
function driveRoots() {
  const out = [];
  for (const letter of 'CDEFGH') {
    const r = letter + ':/';
    try {
      fs.accessSync(r);
      out.push(r);
    } catch { /* not mounted */ }
  }
  return out;
}

/**
 * Candidate roots for the offline Chinese wiki, best first.
 * Detection never throws and never recurses more than one level deep.
 */
function detectWikiRoots() {
  const found = [];
  const push = (p) => {
    const abs = p && path.resolve(p);
    if (abs && looksLikeWikiDump(abs) && !found.includes(abs)) found.push(abs);
  };

  // 1. Whatever the user already configured.
  push(load().wiki.local.dir);
  if (process.env.EU4_WIKI_DIR) push(process.env.EU4_WIKI_DIR);

  // 2. Well-known names at the root of every mounted drive.
  const NAMES = [
    '20240820_Eu4离线wiki_1.37v2',
    '20240820_Eu4离线wiki',
    'Eu4离线wiki',
    'EU4离线wiki',
    'eu4wiki',
    'EU4Wiki',
  ];
  for (const drive of driveRoots()) {
    for (const n of NAMES) push(path.join(drive, n));
  }

  // 3. Any sibling folder whose name mentions a wiki, one level deep.
  for (const drive of driveRoots()) {
    let entries = [];
    try {
      entries = fs.readdirSync(drive, { withFileTypes: true });
    } catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!/(wiki|百科)/i.test(ent.name)) continue;
      if (/^windows$/i.test(ent.name) || /^\$/.test(ent.name)) continue;
      push(path.join(drive, ent.name));
    }
  }
  return found;
}

/** Candidate mod directories (`<Documents>/Paradox Interactive/Europa Universalis IV`). */
function detectUserDirs() {
  const found = [];
  const push = (p) => {
    const abs = p && path.resolve(p);
    if (abs && existsDir(path.join(abs, 'mod')) && !found.includes(abs)) found.push(abs);
  };
  push(load().paths.userDir);
  if (process.env.EU4_USER_DIR) push(process.env.EU4_USER_DIR);
  const home = os.homedir();
  for (const base of ['Documents', 'OneDrive/Documents', 'OneDrive/文档', '文档', 'My Documents']) {
    push(path.join(home, base, 'Paradox Interactive', 'Europa Universalis IV'));
  }
  return found;
}

/** Steam library roots that actually exist. */
function detectInstallDirs() {
  const found = [];
  const push = (p) => {
    const abs = p && path.resolve(p);
    if (abs && fs.existsSync(path.join(abs, 'eu4.exe')) && !found.includes(abs)) found.push(abs);
  };
  push(load().paths.installDir);
  if (process.env.EU4_INSTALL_DIR) push(process.env.EU4_INSTALL_DIR);
  for (const drive of driveRoots()) {
    for (const lib of ['Steam/steamapps', 'SteamLibrary/steamapps']) {
      push(path.join(drive, lib, 'common', 'Europa Universalis IV'));
    }
  }
  push('C:/Program Files (x86)/Steam/steamapps/common/Europa Universalis IV');
  // Steam keeps a list of extra library folders; mine it when present.
  for (const drive of driveRoots()) {
    const vdf = path.join(drive, 'Steam/steamapps/libraryfolders.vdf');
    let text;
    try {
      text = fs.readFileSync(vdf, 'utf8');
    } catch { continue; }
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const libRoot = m[1].replace(/\\\\/g, '/');
      push(path.join(libRoot, 'steamapps', 'common', 'Europa Universalis IV'));
    }
  }
  return found;
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_ONLINE_WIKI,
  defaults,
  load,
  get,
  save,
  update,
  reload,
  merge,
  looksLikeWikiDump,
  detectWikiRoots,
  detectUserDirs,
  detectInstallDirs,
  driveRoots,
};
