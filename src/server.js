'use strict';
/**
 * HTTP API + static file server for the EU4 Mod Viewer.
 *
 * Exported as `start(opts)` so `tools/launcher.js` can own the console banner,
 * the port search and the browser launch. Running this file directly still
 * works and is equivalent to `node tools/launcher.js`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('./config.js');
const i18n = require('./i18n.js');
const modsSvc = require('./mods.js');
const { loadFile, resolveInside } = require('./fileview.js');
const wiki = require('./wiki.js');
const gamedata = require('./gamedata.js');
const gameloc = require('./gameloc.js');
const terms = require('./gameterms.js');

const VERSION = require('../package.json').version;

const RAW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tga': 'image/x-tga',
  '.dds': 'image/vnd-ms.dds',
  '.txt': 'text/plain; charset=utf-8',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const WEB_DIR = path.join(__dirname, '..', 'web');

// ---------------------------------------------------------------------------
// Mod registry (scanned once at startup, refreshed on demand)
// ---------------------------------------------------------------------------

const registry = {
  userDir: null,
  installDir: null,
  scannedAt: null,
  mods: new Map(),
  errors: [],
};

async function refreshRegistry() {
  registry.errors = [];
  const cfg = config.get();
  registry.userDir = cfg.paths.userDir || modsSvc.findUserDir();
  registry.installDir = cfg.paths.installDir || modsSvc.findInstallDir();
  registry.mods = new Map();

  const descriptors = modsSvc.listModDescriptors(registry.userDir);
  for (const d of descriptors) {
    try {
      const mod = await modsSvc.scanMod(d);
      registry.mods.set(mod.id, mod);
    } catch (e) {
      registry.errors.push({ mod: d.descriptorFile, error: e.message });
    }
  }

  // Attach a lazy thumbnail URL (the image itself is served separately so the
  // mod list payload stays small).
  for (const mod of registry.mods.values()) {
    const pic = mod.picture || 'thumbnail.png';
    const thumbAbs = path.join(mod.root, pic);
    mod.thumbnailUrl = fs.existsSync(thumbAbs)
      ? `/api/mod/${encodeURIComponent(mod.id)}/thumbnail`
      : null;
    mod.isWorkshop = /^ugc_/i.test(mod.id) || /workshop/i.test(mod.root);
  }

  registry.scannedAt = new Date().toISOString();
  contentIndexes.clear();
  gameloc.clearCache();
  return registry;
}

// ---------------------------------------------------------------------------
// Content index (game-format preview) — built lazily, cached per mod
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<object>>} */
const contentIndexes = new Map();

function contentIndexFor(mod) {
  const key = mod.id;
  if (!contentIndexes.has(key)) {
    const p = Promise.resolve().then(() => gamedata.buildIndex(mod, registry.installDir));
    contentIndexes.set(key, p);
    p.catch(() => contentIndexes.delete(key));
  }
  return contentIndexes.get(key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The language for one request: explicit `?lang=` wins over the stored setting. */
function langOf(query) {
  const q = query && query.get ? query.get('lang') : null;
  return i18n.normalizeLang(q || config.get().language);
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

/** Localized error reply. */
function sendErrorKey(res, status, lang, key, vars) {
  sendError(res, status, i18n.msg(lang, key, vars));
}

function summarizeMod(mod) {
  return {
    id: mod.id,
    name: mod.name,
    version: mod.version,
    supportedVersion: mod.supportedVersion,
    tags: mod.tags,
    dependencies: mod.dependencies,
    replacePaths: mod.replacePaths,
    remoteFileId: mod.remoteFileId,
    isWorkshop: mod.isWorkshop,
    root: mod.root,
    thumbnailUrl: mod.thumbnailUrl,
    stats: mod.stats,
    categories: mod.categories.map((c) => ({
      id: c.id, zh: c.zh, en: c.en, icon: c.icon, wiki: c.wiki,
      desc: c.desc || '', descEn: c.descEn || c.desc || '',
      fileCount: c.fileCount, bytes: c.bytes,
    })),
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const abs = path.join(WEB_DIR, rel);
  const normWeb = path.resolve(WEB_DIR);
  const normAbs = path.resolve(abs);
  if (normAbs !== normWeb && !normAbs.startsWith(normWeb + path.sep)) {
    return sendError(res, 403, 'forbidden');
  }
  if (!fs.existsSync(normAbs) || !fs.statSync(normAbs).isFile()) {
    return sendError(res, 404, 'not found');
  }
  const ext = path.extname(normAbs).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'no-store',
  });
  fs.createReadStream(normAbs).pipe(res);
}

/** Read and JSON-parse a request body with a small size cap. */
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Requests that may touch the filesystem must come from this machine. */
function isLocalRequest(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('::ffff:127.');
}

// ---------------------------------------------------------------------------
// Settings payload
// ---------------------------------------------------------------------------

/** Everything the Settings panel needs, including what was auto-detected. */
function configPayload() {
  const cfg = config.get();
  return {
    version: VERSION,
    config: cfg,
    configPath: config.CONFIG_PATH,
    detected: {
      userDirs: config.detectUserDirs(),
      installDirs: config.detectInstallDirs(),
      wikiRoots: config.detectWikiRoots(),
    },
    current: {
      userDir: registry.userDir,
      installDir: registry.installDir,
      modCount: registry.mods.size,
    },
    wiki: wiki.status(cfg.language),
    languages: i18n.LANGS.map((id) => ({ id, label: i18n.pick(i18n.LANG_LABELS[id], cfg.language) })),
    platform: process.platform,
    home: os.homedir(),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname, query) {
  const lang = langOf(query);

  // --- status & mods -------------------------------------------------------
  if (pathname === '/api/status') {
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      lang,
      configPath: config.CONFIG_PATH,
      userDir: registry.userDir,
      installDir: registry.installDir,
      scannedAt: registry.scannedAt,
      modCount: registry.mods.size,
      errors: registry.errors,
      wiki: wiki.status(lang),
    });
  }

  if (pathname === '/api/mods') {
    const list = [...registry.mods.values()].map(summarizeMod);
    list.sort((a, b) => {
      if (a.isWorkshop !== b.isWorkshop) return a.isWorkshop ? 1 : -1;
      return a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'zh-Hans-CN');
    });
    return sendJson(res, 200, { mods: list });
  }

  if (pathname === '/api/refresh') {
    await refreshRegistry();
    return sendJson(res, 200, {
      ok: true,
      modCount: registry.mods.size,
      scannedAt: registry.scannedAt,
      errors: registry.errors,
    });
  }

  // --- settings ------------------------------------------------------------
  if (pathname === '/api/config') {
    if (req.method === 'GET') return sendJson(res, 200, configPayload());

    if (req.method === 'POST') {
      let patch;
      try {
        patch = await readBody(req);
      } catch (e) {
        return sendErrorKey(res, 400, lang, 'error.badPath');
      }
      const before = JSON.parse(JSON.stringify(config.get()));
      const result = config.update(patch);
      const after = config.get();

      // Apply side effects so a save takes effect without a restart.
      wiki.configureLocal(after);
      terms.clearGlossary();               // re-read the term tables from the new wiki
      const pathsChanged = before.paths.userDir !== after.paths.userDir
        || before.paths.installDir !== after.paths.installDir;
      if (pathsChanged) await refreshRegistry();

      return sendJson(res, 200, {
        ok: result.saved,
        saved: result.saved,
        error: result.error || null,
        reloaded: pathsChanged,
        ...configPayload(),
      });
    }
    return sendErrorKey(res, 405, lang, 'error.unknownRoute');
  }

  // --- offline / online wiki ----------------------------------------------
  if (pathname === '/api/wiki/status') {
    return sendJson(res, 200, wiki.status(lang));
  }

  if (pathname === '/api/wiki/detect') {
    return sendJson(res, 200, { roots: config.detectWikiRoots() });
  }

  if (pathname === '/api/wiki/validate') {
    const dir = query.get('dir') || '';
    const v = wiki.validateDir(dir);
    return sendJson(res, 200, {
      dir,
      ok: v.ok,
      root: v.root || null,
      pageCount: v.pageCount || 0,
      error: v.ok ? null : v.error,
      errorText: v.ok
        ? null
        : i18n.pick(i18n.L('找不到该目录，或它不包含 wiki\\ 子目录。',
          'Folder not found, or it has no wiki\\ subfolder.'), lang),
    });
  }

  if (pathname === '/api/wiki/page') {
    if (!wiki.isEnabled()) return sendErrorKey(res, 404, lang, 'error.noWikiRoot');
    const name = query.get('name');
    if (!name) return sendErrorKey(res, 400, lang, 'error.missingName');
    const page = wiki.readPage(name);
    if (!page) return sendErrorKey(res, 404, lang, 'error.wikiPageNotFound');
    return sendJson(res, 200, page);
  }

  if (pathname === '/api/wiki/search') {
    const q = (query.get('q') || '').trim();
    if (!q) return sendJson(res, 200, { results: [], enabled: wiki.isEnabled() });
    return sendJson(res, 200, {
      enabled: wiki.isEnabled(),
      results: wiki.isEnabled() ? wiki.search(q, Number(query.get('limit')) || 60) : [],
      query: q,
    });
  }

  if (pathname === '/api/wiki/suggest') {
    const catId = query.get('category') || '';
    return sendJson(res, 200, wiki.suggest(catId, lang));
  }

  // --- server-side folder picker ------------------------------------------
  if (pathname === '/api/fs/list') {
    if (!isLocalRequest(req)) return sendErrorKey(res, 403, lang, 'error.forbidden');
    const raw = (query.get('path') || '').trim();
    const drives = config.driveRoots();

    if (!raw) {
      // Top level: the drives that exist.
      return sendJson(res, 200, {
        path: '',
        parent: null,
        isRoot: true,
        drives: drives.map((d) => ({ name: d, path: d })),
        dirs: drives.map((d) => ({
          name: d, path: d, wiki: config.looksLikeWikiDump(d), mods: false,
        })),
      });
    }

    let abs;
    try {
      abs = path.resolve(raw);
    } catch {
      return sendErrorKey(res, 400, lang, 'error.badPath');
    }
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return sendErrorKey(res, 404, lang, 'error.badDir');
    }

    const dirs = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      // Hidden and system directories are noise in a picker.
      if (ent.name.startsWith('.') || ent.name === '$RECYCLE.BIN' || ent.name === 'System Volume Information') continue;
      const full = path.join(abs, ent.name);
      let wikiDump = false;
      let modsDir = false;
      try {
        wikiDump = config.looksLikeWikiDump(full);
        modsDir = fs.existsSync(path.join(full, 'mod'));
      } catch { /* unreadable child */ }
      dirs.push({ name: ent.name, path: full, wiki: wikiDump, mods: modsDir });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'en'));

    const parent = path.dirname(abs);
    return sendJson(res, 200, {
      path: abs,
      parent: parent === abs ? null : parent,
      isRoot: false,
      drives: drives.map((d) => ({ name: d, path: d })),
      dirs: dirs.slice(0, 2000),
      truncated: dirs.length > 2000,
      looksLikeWiki: config.looksLikeWikiDump(abs),
      hasMods: fs.existsSync(path.join(abs, 'mod')),
      hasEu4Exe: fs.existsSync(path.join(abs, 'eu4.exe')),
    });
  }

  // --- per-mod -------------------------------------------------------------
  const modMatch = /^\/api\/mod\/([^/]+)(\/.*)?$/.exec(pathname);
  if (modMatch) {
    const modId = decodeURIComponent(modMatch[1]);
    const rest = modMatch[2] || '';
    const mod = registry.mods.get(modId);
    if (!mod) return sendErrorKey(res, 404, lang, 'error.modNotFound', { id: modId });

    if (rest === '' || rest === '/') return sendJson(res, 200, summarizeMod(mod));

    if (rest === '/thumbnail') {
      const pic = mod.picture || 'thumbnail.png';
      const abs = path.resolve(mod.root, pic);
      const normRoot = path.resolve(mod.root);
      if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
        return sendErrorKey(res, 403, lang, 'error.forbidden');
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return sendErrorKey(res, 404, lang, 'error.fileNotFound');
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, {
        'Content-Type': ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png',
        'Cache-Control': 'public, max-age=600',
      });
      return fs.createReadStream(abs).pipe(res);
    }

    if (rest === '/raw') {
      const rel = query.get('path');
      if (!rel) return sendErrorKey(res, 400, lang, 'error.missingPath');
      const abs = resolveInside(mod.root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return sendErrorKey(res, 404, lang, 'error.fileNotFound', { path: rel });
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, {
        'Content-Type': RAW_MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=600',
      });
      return fs.createReadStream(abs).pipe(res);
    }

    if (rest === '/files') {
      const category = query.get('category');
      let files = mod.files;
      if (category) files = files.filter((f) => f.category === category);
      return sendJson(res, 200, { mod: mod.id, files, total: files.length });
    }

    if (rest === '/tree') {
      return sendJson(res, 200, {
        mod: mod.id,
        tree: buildTree(mod.files),
        categories: mod.categories.map((c) => ({
          id: c.id, zh: c.zh, en: c.en, icon: c.icon, wiki: c.wiki,
          desc: c.desc || '', descEn: c.descEn || c.desc || '',
          fileCount: c.fileCount, bytes: c.bytes,
        })),
      });
    }

    if (rest === '/file') {
      const rel = query.get('path');
      if (!rel) return sendErrorKey(res, 400, lang, 'error.missingPath');
      const loaded = loadFile(mod, rel, lang);
      if (!loaded) return sendErrorKey(res, 404, lang, 'error.fileNotFound', { path: rel });
      return sendJson(res, 200, loaded);
    }

    // --- game-format preview ----------------------------------------------
    if (rest === '/game/index') {
      const index = await contentIndexFor(mod);
      return sendJson(res, 200, {
        mod: mod.id,
        lang,
        types: gamedata.TYPE_META,
        typeList: gamedata.typeList(index, lang),
        groups: gamedata.groupList(lang),
        stats: index.stats,
        glossary: terms.glossaryStats(),
        errors: index.errors.slice(0, 20),
      });
    }

    if (rest === '/game/list') {
      const type = query.get('type') || 'events';
      const index = await contentIndexFor(mod);
      const list = index.lists[type];
      if (!list) return sendErrorKey(res, 404, lang, 'error.unknownContentType', { type });
      const q = (query.get('q') || '').trim().toLowerCase();
      const fileFilter = query.get('file');
      const offset = Math.max(0, Number(query.get('offset')) || 0);
      const limit = Math.min(500, Math.max(1, Number(query.get('limit')) || 80));

      let rows = list;
      if (fileFilter) {
        rows = rows.filter((r) => r.file === fileFilter);
        // Idea groups and national ideas live in the same files; when jumping in
        // from a file, show both so nothing in it is hidden.
        if (type === 'idea_groups' || type === 'national_ideas') {
          const other = index.lists[type === 'idea_groups' ? 'national_ideas' : 'idea_groups'];
          rows = rows.concat(other.filter((r) => r.file === fileFilter));
        }
      }
      if (q) {
        rows = rows.filter((r) => {
          if (r.id.toLowerCase().includes(q)) return true;
          const t = gamedata.listTitle(index, type, r.id, lang);
          return t ? String(t).toLowerCase().includes(q) : false;
        });
      }

      const items = rows.slice(offset, offset + limit).map((r) => ({
        id: r.id,
        file: r.file,
        line: r.line,
        title: gamedata.listTitle(index, type, r.id, lang),
        meta: {
          kind: r.kind || null,
          kindLabel: r.kind ? gamedata.kindLabel(r.kind, lang) : null,
          eventType: eventTypeLabel(r.eventType, lang),
          major: r.major,
          monarchPower: r.monarchPower,
          national: r.national,
          hidden: r.hidden,
          slot: r.slot,
          // Mission trees carry a slot list and a mission count instead of a
          // single slot, so the list row can say what the tree covers.
          missionCount: r.missionCount,
          slots: r.slots,
          // A history item has no localisation key: its row says `MNG · 1368.1.23`
          // (a ruler), `AL2 · 1402.6.6` (a leader) or `靖难之役 · 1399.8.24`
          // (a battle) so two rulers of one country stay tellable apart.
          note: r.note || null,
        },
      }));

      return sendJson(res, 200, { mod: mod.id, type, lang, total: rows.length, offset, limit, items });
    }

    if (rest === '/game/card') {
      const type = query.get('type') || 'events';
      const id = query.get('id');
      if (!id) return sendErrorKey(res, 400, lang, 'error.missingId');
      const index = await contentIndexFor(mod);
      const card = gamedata.buildCard(index, type, id, lang);
      if (!card) return sendErrorKey(res, 404, lang, 'error.contentNotFound', { type, id });
      return sendJson(res, 200, { mod: mod.id, lang, card });
    }

    if (rest === '/game/search') {
      const q = (query.get('q') || '').trim().toLowerCase();
      if (!q) return sendJson(res, 200, { results: [] });
      const index = await contentIndexFor(mod);
      const results = [];
      outer: for (const [type, list] of Object.entries(index.lists)) {
        for (const r of list) {
          const t = gamedata.listTitle(index, type, r.id, lang) || '';
          if (r.id.toLowerCase().includes(q) || String(t).toLowerCase().includes(q)) {
            results.push({ type, id: r.id, title: t, file: r.file, line: r.line });
            if (results.length >= 400) break outer;
          }
        }
      }
      return sendJson(res, 200, { results, query: q, lang });
    }

    if (rest === '/icon') {
      const name = query.get('name');
      if (!name) return sendErrorKey(res, 400, lang, 'error.missingName');
      const index = await contentIndexFor(mod);
      const u = gamedata.resolveIcon(index, name);
      if (!u) return sendErrorKey(res, 404, lang, 'error.iconNotFound', { name });
      // The URL we just built points back at /tex; resolve it here instead of
      // redirecting so the browser gets pixels in one round trip.
      const q = new URL(u, 'http://x').searchParams;
      const origin = q.get('origin') === 'vanilla' ? 'vanilla' : 'mod';
      const root = origin === 'vanilla' ? registry.installDir : mod.root;
      const abs = root ? resolveInside(root, q.get('path')) : null;
      if (!abs || !fs.existsSync(abs)) {
        return sendErrorKey(res, 404, lang, 'error.textureNotFound', { name });
      }
      return serveTexture(res, abs, lang);
    }

    if (rest === '/tex') {
      const rel = query.get('path');
      if (!rel) return sendErrorKey(res, 400, lang, 'error.missingPath');
      const origin = query.get('origin') === 'vanilla' ? 'vanilla' : 'mod';
      const root = origin === 'vanilla' ? registry.installDir : mod.root;
      if (!root) return sendErrorKey(res, 404, lang, 'error.noRoot');
      const abs = resolveInside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return sendErrorKey(res, 404, lang, 'error.textureNotFound', { path: rel });
      }
      return serveTexture(res, abs, lang);
    }

    if (rest === '/search') {
      const q = (query.get('q') || '').trim();
      if (!q) return sendJson(res, 200, { results: [] });
      const results = searchMod(mod, q);
      return sendJson(res, 200, { results, query: q });
    }
  }

  return sendErrorKey(res, 404, lang, 'error.unknownRoute');
}

/** Localized label for an event's block name. */
function eventTypeLabel(eventType, lang) {
  if (!eventType) return null;
  const pair = gamedata.EVENT_TYPE[eventType];
  return pair ? i18n.pick(pair, lang) : eventType;
}

/** Build a nested directory tree from a flat file list. */
function buildTree(files) {
  const root = { name: '', type: 'dir', children: new Map() };
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!node.children.has(p)) {
        node.children.set(p, { name: p, type: 'dir', children: new Map() });
      }
      node = node.children.get(p);
    }
    node.children.set(parts[parts.length - 1], {
      name: parts[parts.length - 1],
      type: 'file',
      rel: f.rel,
      size: f.size,
      binary: f.binary,
      category: f.category,
      kind: f.kind,
    });
  }
  return serializeTree(root).children;
}

function serializeTree(node) {
  if (node.type === 'file') return node;
  const children = [...node.children.values()]
    .map(serializeTree)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { name: node.name, type: 'dir', children };
}

/** Search file paths and localisation keys/values. */
function searchMod(mod, q) {
  const needle = q.toLowerCase();
  const results = [];
  const MAX = 300;

  for (const f of mod.files) {
    if (f.rel.toLowerCase().includes(needle)) {
      results.push({ type: 'file', rel: f.rel, category: f.category });
      if (results.length >= MAX) return results;
    }
  }

  for (const f of mod.files) {
    if (!f.rel.toLowerCase().endsWith('.yml')) continue;
    if (f.size > 4 * 1024 * 1024) continue;
    const loaded = loadFile(mod, f.rel, 'zh');
    if (!loaded || loaded.render.type !== 'localisation') continue;
    for (const e of loaded.render.entries) {
      if (e.key.toLowerCase().includes(needle) || e.value.toLowerCase().includes(needle)) {
        results.push({
          type: 'loc',
          rel: f.rel,
          key: e.key,
          value: e.value,
          category: f.category,
        });
        if (results.length >= MAX) return results;
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const WIKI_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Serve a texture. `.dds` files (the format EU4 uses for nearly everything) are
 * decoded to PNG on the fly so the browser can actually display them; anything
 * else is streamed as-is.
 */
function serveTexture(res, abs, lang) {
  const ext = path.extname(abs).toLowerCase();
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    return sendError(res, 500, e.message);
  }

  if (ext === '.dds') {
    let png = null;
    try {
      png = require('./codec/dds.js').ddsToPng(buf);
    } catch {
      png = null;
    }
    if (png) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        'Cache-Control': 'public, max-age=3600',
        'X-DDS-Decoded': '1',
      });
      return res.end(png);
    }
    return sendErrorKey(res, 415, lang, 'error.unsupportedDds');
  }

  res.writeHead(200, {
    'Content-Type': RAW_MIME[ext] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=3600',
  });
  return res.end(buf);
}

function serveWikiFile(req, res, rel, lang) {
  const root = wiki.getRoot();
  if (!root) return sendErrorKey(res, 404, lang, 'error.noWikiRoot');

  const decoded = decodeURIComponent(rel).replace(/\+/g, ' ');
  const abs = path.resolve(root, decoded);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    return sendErrorKey(res, 403, lang, 'error.forbidden');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return sendError(res, 404, 'wiki asset not found');
  }
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, {
    'Content-Type': WIKI_MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600',
  });
  fs.createReadStream(abs).pipe(res);
}

const requestHandler = async (req, res) => {
  let lang = i18n.normalizeLang(config.get().language);
  try {
    const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    // decodeURIComponent throws on a malformed escape (e.g. "%zz"); fall back to
    // the raw path so a junk request 404s instead of taking the connection down.
    let pathname = u.pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch { /* keep the undecoded path */ }
    const query = u.searchParams;
    lang = langOf(query);

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, query);
      return;
    }

    // Offline wiki assets (css/js/images) and pages, served straight from the dump.
    if (pathname.startsWith('/wikifile/')) {
      return serveWikiFile(req, res, pathname.slice('/wikifile/'.length), lang);
    }

    serveStatic(req, res, pathname);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('request failed:', e);
    if (!res.headersSent) sendError(res, 500, e.message);
    else res.end();
  }
};

/**
 * Boot the HTTP server.
 * @param {{port?:number, host?:string, lang?:string}} [opts]
 */
async function start(opts = {}) {
  const cfg = config.get();
  const port = Number(opts.port) || cfg.server.port || 4173;
  const host = opts.host || cfg.server.host || '127.0.0.1';

  wiki.configureLocal(cfg);
  await refreshRegistry();

  // Build the whole info block *before* binding the port: if anything in here
  // throws, no socket is left open behind a failed startup.
  const info = {
    version: VERSION,
    userDir: registry.userDir,
    installDir: registry.installDir,
    modCount: registry.mods.size,
    errors: registry.errors,
    wiki: {
      ...wiki.status(),
      online: { enabled: wiki.onlineEnabled(), base: wiki.onlineBase() },
    },
  };

  const server = http.createServer(requestHandler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  server.on('error', (e) => console.error('server error:', e.message));

  const actual = server.address();
  const shownPort = actual && typeof actual === 'object' ? actual.port : port;

  return {
    server,
    url: `http://${host}:${shownPort}`,
    port: shownPort,
    host,
    info,
  };
}

if (require.main === module) {
  start().then(
    (s) => {
      console.log('EU4 Mod Viewer ' + VERSION);
      console.log('  URL        : ' + s.url);
      console.log('  user dir   : ' + s.info.userDir);
      console.log('  install dir: ' + s.info.installDir);
      console.log('  mods       : ' + s.info.modCount);
      for (const mod of registry.mods.values()) {
        console.log(`    - ${mod.name}  (${mod.stats.files} files, ${mod.categories.length} categories)`);
      }
      if (registry.errors.length) console.log('  errors     : ' + JSON.stringify(registry.errors));
    },
    (e) => {
      console.error('startup failed:', e && e.message ? e.message : e);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  start,
  requestHandler,
  registry,
  refreshRegistry,
  configPayload,
  VERSION,
};
