'use strict';
/**
 * Localisation index: every localisation key a mod can resolve, mapped to the
 * text the game would show.
 *
 * This is what makes "script file ↔ localisation file" correspondence possible.
 * A mod's script says `title = CE_advisors.0.t`; the index says that key resolves
 * to 人才涌现 and lives in `localisation/replace/CE_history_advisors_l_english.yml`
 * line 412.
 *
 * Resolution order (first definition wins, exactly like the game's load order):
 *
 *   1. mod  localisation/replace/**      — explicit overrides
 *   2. mod  localisation/**
 *   3. vanilla localisation/**           — the base game, for keys the mod reuses
 *      (province names, estate names, generic strings, `OK`, …)
 *
 * Only the English slot is indexed. Chinese EU4 mods put Chinese text into
 * `l_english` because vanilla `languages.yml` ships no Chinese language at all,
 * so `l_english` *is* the display language.
 */

const fs = require('fs');
const path = require('path');

const loc = require('./codec/localisation.js');

/** Files that are never real localisation content. */
function isSkippable(name) {
  return (
    name.startsWith('~$') ||          // Office lock files
    name.startsWith('.') ||
    !/\.ya?ml$/i.test(name)
  );
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out, depth + 1);
    else if (ent.isFile() && !isSkippable(ent.name)) out.push(abs);
  }
  return out;
}

class LocIndex {
  constructor(label) {
    this.label = label;
    /** @type {Map<string, {value:string, file:string, lang:string, origin:string, line:number, version:number|null}>} */
    this.entries = new Map();
    this.files = 0;
    this.bytes = 0;
  }

  get size() { return this.entries.size; }

  has(key) { return this.entries.has(key); }

  /** Resolved text for a key, or undefined. */
  text(key) {
    const hit = this.entries.get(key);
    return hit ? hit.value : undefined;
  }

  /** Full provenance record for a key, or undefined. */
  lookup(key) { return this.entries.get(key); }

  /**
   * Add one localisation file. `origin` is 'mod' or 'vanilla'; existing keys are
   * never overwritten so callers control priority by call order.
   *
   * @returns {number} how many new keys this file contributed
   */
  addFile(abs, { origin, relPath, forcePlain }) {
    let buf;
    try { buf = fs.readFileSync(abs); } catch { return 0; }

    const text = forcePlain ? loc.decodePlain(buf) : loc.decodeBuffer(buf);
    const parsed = loc.parseLocalisation(text);

    let added = 0;
    for (const [key, rec] of parsed.entries) {
      if (this.entries.has(key)) continue;
      this.entries.set(key, {
        value: rec.value,
        file: relPath,
        lang: parsed.language || 'l_english',
        origin,
        line: rec.line,
        version: rec.version,
      });
      added++;
    }
    this.files++;
    this.bytes += buf.length;
    return added;
  }
}

/** Index a mod's own localisation, in override order. */
function buildModIndex(modRoot, label) {
  const idx = new LocIndex(label);
  const locRoot = path.join(modRoot, 'localisation');
  if (!fs.existsSync(locRoot)) return idx;

  const all = walk(locRoot).map((abs) => ({
    abs,
    rel: path.relative(modRoot, abs).split(path.sep).join('/'),
  }));

  const rank = (rel) => {
    if (/^localisation\/replace\//i.test(rel)) return 0;
    return 1;
  };
  all.sort((a, b) => {
    const d = rank(a.rel) - rank(b.rel);
    if (d !== 0) return d;
    return a.rel.localeCompare(b.rel);
  });

  for (const f of all) idx.addFile(f.abs, { origin: 'mod', relPath: f.rel });
  return idx;
}

const vanillaCache = new Map();

/** Index the base game's English localisation (cached per install dir). */
function buildVanillaIndex(installDir, label) {
  if (!installDir) return new LocIndex(label);
  if (vanillaCache.has(installDir)) return vanillaCache.get(installDir);

  const idx = new LocIndex(label);
  const locRoot = path.join(installDir, 'localisation');
  if (fs.existsSync(locRoot)) {
    const files = walk(locRoot).filter((abs) => /_l_english\.ya?ml$/i.test(abs) || /localisation[\\/][^\\/]+\.ya?ml$/i.test(abs));
    for (const abs of files) {
      const rel = path.relative(installDir, abs).split(path.sep).join('/');
      // Vanilla localisation is always plain UTF-8; skip the full decoder to
      // keep a ~30 MB corpus cheap to index.
      idx.addFile(abs, { origin: 'vanilla', relPath: rel, forcePlain: true });
    }
  }
  vanillaCache.set(installDir, idx);
  return idx;
}

/**
 * A mod's resolvable view: the mod's own keys first, then vanilla for the rest.
 * Vanilla is indexed lazily on the first miss so a typical request only pays for
 * it once.
 */
class Resolver {
  constructor({ modRoot, installDir, label }) {
    this.modIndex = buildModIndex(modRoot, label);
    this.installDir = installDir;
    this.label = label;
    this._vanilla = null;
  }

  get vanilla() {
    if (!this._vanilla) this._vanilla = buildVanillaIndex(this.installDir, this.label);
    return this._vanilla;
  }

  lookup(key) {
    const hit = this.modIndex.lookup(key);
    if (hit) return hit;
    if (!this.installDir) return undefined;
    return this.vanilla.lookup(key);
  }

  /** Does this key resolve anywhere (mod or vanilla)? */
  has(key) {
    return this.modIndex.has(key) || (!!this.installDir && this.vanilla.has(key));
  }

  text(key) {
    const hit = this.lookup(key);
    return hit ? hit.value : undefined;
  }

  stats() {
    return {
      modKeys: this.modIndex.size,
      modFiles: this.modIndex.files,
      vanillaKeys: this._vanilla ? this._vanilla.size : null,
      vanillaFiles: this._vanilla ? this._vanilla.files : null,
      vanillaIndexed: !!this._vanilla,
    };
  }
}

const resolverCache = new Map();

/** Cached resolver per mod id (invalidated when the registry is refreshed). */
function resolverFor(mod, installDir) {
  const key = `${mod.id}\u0000${mod.root}\u0000${installDir || ''}`;
  let hit = resolverCache.get(key);
  if (!hit) {
    hit = new Resolver({ modRoot: mod.root, installDir, label: mod.name || mod.id });
    resolverCache.set(key, hit);
  }
  return hit;
}

function clearCache() { resolverCache.clear(); vanillaCache.clear(); }

/** Resolve a province id to a display name (`PROV1234`, then `PROV1234` adj). */
function provinceName(resolver, id) {
  if (id === null || id === undefined) return null;
  const s = String(id);
  return resolver.text(`PROV${s}`) || resolver.text(`PROV_${s}`) || null;
}

module.exports = {
  LocIndex,
  Resolver,
  resolverFor,
  clearCache,
  buildModIndex,
  buildVanillaIndex,
  provinceName,
};
