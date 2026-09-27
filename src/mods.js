'use strict';
/**
 * Discovers installed EU4 mods and scans their contents.
 *
 * Mods come from two places on a Paradox/Steam setup:
 *   1. `<Documents>/Paradox Interactive/Europa Universalis IV/mod/` — local mods,
 *      each described by a sibling `<name>.mod` file.
 *   2. `<SteamLibrary>/steamapps/workshop/content/236850/<id>/` — Workshop mods,
 *      also described by a `ugc_<id>.mod` file in the Documents mod folder.
 *
 * The `.mod` descriptor is authoritative: its `path=` field may point anywhere,
 * so it is always preferred over guessing from the folder name.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const { parseScript, getEntry, scalarValue } = require('./codec/script.js');
const tax = require('./taxonomy.js');

const EU4_STEAM_APPID = '236850';

/** Read a `.mod` descriptor into a plain object. */
function parseDescriptor(text) {
  const tree = parseScript(text);
  const get = (k) => scalarValue(getEntry(tree, k));

  const tags = [];
  const tagsNode = getEntry(tree, 'tags');
  if (tagsNode && tagsNode.type === 'array') {
    for (const item of tagsNode.items) {
      const v = scalarValue(item);
      if (v) tags.push(v);
    }
  } else if (tagsNode && tagsNode.type === 'object') {
    for (const e of tagsNode.entries) tags.push(e.key);
  }

  const dependencies = [];
  const depNode = getEntry(tree, 'dependencies');
  if (depNode && depNode.type === 'array') {
    for (const item of depNode.items) {
      const v = scalarValue(item);
      if (v) dependencies.push(v);
    }
  }

  const replacePaths = [];
  for (const e of tree.entries) {
    if (e.key === 'replace_path') {
      const v = scalarValue(e.value);
      if (v) replacePaths.push(v);
    }
  }

  return {
    name: get('name') || null,
    version: get('version') || null,
    supportedVersion: get('supported_version') || null,
    picture: get('picture') || null,
    path: get('path') || null,
    remoteFileId: get('remote_file_id') || null,
    tags,
    dependencies,
    replacePaths,
  };
}

/** Locate the Documents-side EU4 user directory. */
function findUserDir() {
  const candidates = [
    process.env.EU4_USER_DIR,
    path.join(os.homedir(), 'Documents', 'Paradox Interactive', 'Europa Universalis IV'),
    path.join(os.homedir(), 'OneDrive', 'Documents', 'Paradox Interactive', 'Europa Universalis IV'),
    path.join(os.homedir(), '文档', 'Paradox Interactive', 'Europa Universalis IV'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Locate the EU4 install directory. */
function findInstallDir() {
  const candidates = [process.env.EU4_INSTALL_DIR].filter(Boolean);
  const libRoots = [
    'C:/Program Files (x86)/Steam/steamapps',
    'D:/Steam/steamapps',
    'D:/SteamLibrary/steamapps',
    'E:/Steam/steamapps',
    'E:/SteamLibrary/steamapps',
    'F:/Steam/steamapps',
    'F:/SteamLibrary/steamapps',
  ];
  for (const root of libRoots) {
    candidates.push(path.join(root, 'common', 'Europa Universalis IV'));
  }
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'eu4.exe'))) return path.resolve(c);
  }
  return null;
}

/** All Steam library roots that exist. */
function findSteamLibraries() {
  const roots = [
    'C:/Program Files (x86)/Steam',
    'D:/Steam',
    'D:/SteamLibrary',
    'E:/Steam',
    'E:/SteamLibrary',
    'F:/Steam',
    'F:/SteamLibrary',
  ];
  return roots
    .map((r) => path.join(r, 'steamapps'))
    .filter((p) => fs.existsSync(p));
}

/** Enumerate every installed mod descriptor. */
function listModDescriptors(userDir) {
  const results = [];
  if (!userDir) return results;
  const modDir = path.join(userDir, 'mod');
  if (!fs.existsSync(modDir)) return results;

  let entries;
  try {
    entries = fs.readdirSync(modDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.mod')) continue;
    const descriptorPath = path.join(modDir, ent.name);
    let descriptor;
    try {
      descriptor = parseDescriptor(fs.readFileSync(descriptorPath, 'utf8'));
    } catch {
      continue;
    }

    // Resolve the content root: descriptor path wins, else sibling folder.
    let root = null;
    if (descriptor.path) {
      const p = path.resolve(descriptor.path);
      if (fs.existsSync(p)) root = p;
    }
    if (!root) {
      const sibling = path.join(modDir, path.basename(ent.name, '.mod'));
      if (fs.existsSync(sibling)) root = sibling;
    }
    if (!root) continue;

    results.push({
      descriptorPath,
      descriptorFile: ent.name,
      root,
      meta: descriptor,
    });
  }
  return results;
}

function walkFiles(root, opts = {}) {
  const out = [];
  const maxFiles = opts.maxFiles || 200000;
  const stack = [''];
  while (stack.length && out.length < maxFiles) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) stack.push(childRel);
      else if (ent.isFile()) out.push(childRel);
    }
  }
  return out;
}

/**
 * Scan a mod: classify every file, parse localisation, and summarise.
 * Returns a serialisable mod record.
 */
async function scanMod(entry) {
  const files = walkFiles(entry.root);

  const categories = new Map();
  let textFiles = 0;
  let binaryFiles = 0;
  let totalBytes = 0;

  const fileList = [];

  for (const rel of files) {
    const cat = tax.classify(rel);
    const binary = tax.isBinary(rel);
    let size = 0;
    try { size = fs.statSync(path.join(entry.root, rel)).size; } catch { /* ignore */ }
    totalBytes += size;

    if (binary) binaryFiles++;
    else textFiles++;

    if (!categories.has(cat.id)) {
      categories.set(cat.id, {
        id: cat.id, zh: cat.zh, en: cat.en, icon: cat.icon,
        wiki: cat.wiki, desc: cat.desc,
        files: [], fileCount: 0, bytes: 0,
      });
    }
    const bucket = categories.get(cat.id);
    bucket.fileCount++;
    bucket.bytes += size;
    bucket.files.push({ rel, size, binary, kind: tax.parserKind(rel) });

    fileList.push({ rel, size, binary, category: cat.id, kind: tax.parserKind(rel) });
  }

  const mod = {
    id: entry.descriptorFile.replace(/\.mod$/i, ''),
    descriptorFile: entry.descriptorFile,
    root: entry.root,
    name: entry.meta.name || path.basename(entry.root),
    version: entry.meta.version,
    supportedVersion: entry.meta.supportedVersion,
    picture: entry.meta.picture,
    tags: entry.meta.tags,
    dependencies: entry.meta.dependencies,
    replacePaths: entry.meta.replacePaths,
    remoteFileId: entry.meta.remoteFileId,
    stats: {
      files: files.length,
      textFiles,
      binaryFiles,
      bytes: totalBytes,
      categories: categories.size,
    },
    categories: [...categories.values()].sort((a, b) => b.fileCount - a.fileCount),
    files: fileList,
  };

  return mod;
}

/** Read the thumbnail for a mod as a data URL (or null). */
function readThumbnail(mod) {
  const pic = mod.picture || 'thumbnail.png';
  const p = path.join(mod.root, pic);
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  try {
    const buf = fs.readFileSync(p);
    if (buf.length > 4 * 1024 * 1024) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = {
  EU4_STEAM_APPID,
  parseDescriptor,
  findUserDir,
  findInstallDir,
  findSteamLibraries,
  listModDescriptors,
  walkFiles,
  scanMod,
  readThumbnail,
};
