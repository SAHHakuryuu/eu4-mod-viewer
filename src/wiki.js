'use strict';
/**
 * Bridges the viewer to EU4 wikis.
 *
 * Two sources, each independently switchable:
 *
 *  1. **Local offline Chinese wiki** — a dump such as
 *     `F:\20240820_Eu4离线wiki_1.37v2`. Pages are FLAT `.html` files under
 *     `wiki\` (plus a few directories for pages that have subpages). Pages are
 *     UTF-8 and reference `../images/...` and `../all.css`, so the server mounts
 *     the whole dump root and serves pages into an iframe.
 *     The directory is chosen by the user in Settings (`wiki.local.dir`) and can
 *     be turned off entirely (`wiki.local.enabled`).
 *
 *  2. **English online wiki** — `https://eu4.paradoxwikis.com/`. We do not
 *     mirror it; we only build deep links from a curated per-category page list.
 *     Every title below was taken from the wiki's own "Modding" navigation
 *     template, so the links resolve rather than 404.
 */

const fs = require('fs');
const path = require('path');

const config = require('./config.js');
const { L, pick, normalizeLang } = require('./i18n.js');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  enabled: false,
  root: null,
  wikiDir: null,
  pageIndex: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Local dump
// ---------------------------------------------------------------------------

/** A folder looks usable when `wiki/` holds a reasonable number of pages. */
function validateDir(dir) {
  if (!dir) return { ok: false, error: 'empty' };
  let abs;
  try {
    abs = path.resolve(String(dir));
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const wikiDir = path.join(abs, 'wiki');
  let entries;
  try {
    entries = fs.readdirSync(wikiDir, { withFileTypes: true });
  } catch {
    return { ok: false, error: 'no-wiki-dir', root: abs };
  }
  let pageCount = 0;
  for (const ent of entries) if (ent.isFile() && ent.name.toLowerCase().endsWith('.html')) pageCount++;
  if (!pageCount) return { ok: false, error: 'no-pages', root: abs };
  return { ok: true, root: abs, wikiDir, pageCount };
}

/** Build a name -> file index. One level only; never recurses (14k dirs). */
function buildIndex(wikiDir) {
  const pageIndex = new Map();
  let entries;
  try {
    entries = fs.readdirSync(wikiDir, { withFileTypes: true });
  } catch {
    return pageIndex;
  }
  for (const ent of entries) {
    const full = path.join(wikiDir, ent.name);
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.html')) {
      const base = ent.name.slice(0, -5);
      pageIndex.set(base.toLowerCase(), { name: base, file: full, type: 'page' });
    } else if (ent.isDirectory()) {
      // Pages that have subpages: expose `<dir>` itself, then each child.
      pageIndex.set(ent.name.toLowerCase(), { name: ent.name, file: full, type: 'dir' });
      let children = [];
      try {
        children = fs.readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ch of children) {
        if (!ch.isFile() || !ch.name.toLowerCase().endsWith('.html')) continue;
        const childBase = ch.name.slice(0, -5);
        const key = `${ent.name}/${childBase}`.toLowerCase();
        pageIndex.set(key, {
          name: `${ent.name}/${childBase}`,
          file: path.join(full, ch.name),
          type: 'subpage',
        });
      }
    }
  }
  return pageIndex;
}

/**
 * Apply the local-wiki settings. Called at boot and whenever the user saves
 * settings, so enabling/disabling takes effect without a server restart.
 */
function configureLocal(cfg) {
  const c = cfg || config.get();
  const local = (c.wiki && c.wiki.local) || {};
  state.error = null;

  if (!local.enabled) {
    state.enabled = false;
    state.root = null;
    state.wikiDir = null;
    state.pageIndex = null;
    return status();
  }

  const dir = local.dir && String(local.dir).trim();
  const candidates = dir ? [dir] : config.detectWikiRoots();
  for (const cand of candidates) {
    const v = validateDir(cand);
    if (v.ok) {
      state.enabled = true;
      state.root = v.root;
      state.wikiDir = v.wikiDir;
      state.pageIndex = buildIndex(v.wikiDir);
      return status();
    }
  }
  state.enabled = false;
  state.root = dir ? path.resolve(dir) : null;
  state.wikiDir = null;
  state.pageIndex = null;
  state.error = dir ? 'configured-dir-unusable' : 'not-found';
  return status();
}

/** Initial configuration from the persisted settings. */
function init() {
  return configureLocal();
}
init();

// ---------------------------------------------------------------------------
// Status & lookup
// ---------------------------------------------------------------------------

function onlineBase() {
  const c = config.get();
  const base = (c.wiki && c.wiki.online && c.wiki.online.base) || config.DEFAULT_ONLINE_WIKI;
  return String(base).endsWith('/') ? String(base) : String(base) + '/';
}

function onlineEnabled() {
  const c = config.get();
  return Boolean(c.wiki && c.wiki.online && c.wiki.online.enabled);
}

function status(lang) {
  const l = normalizeLang(lang);
  return {
    enabled: state.enabled,
    available: state.enabled && Boolean(state.root),
    root: state.root,
    wikiDir: state.wikiDir,
    pageCount: state.pageIndex ? state.pageIndex.size : 0,
    error: state.error,
    errorText: state.error
      ? pick(STATUS_ERRORS[state.error] || STATUS_ERRORS['not-found'], l)
      : null,
    configuredDir: (config.get().wiki.local.dir || '') || null,
    candidates: config.detectWikiRoots(),
    online: { enabled: onlineEnabled(), base: onlineBase() },
  };
}

const STATUS_ERRORS = {
  'not-found': L(
    '未找到离线中文 wiki。可在「设置」中手动选择目录。',
    'No offline Chinese wiki found. Choose its folder in Settings.',
  ),
  'configured-dir-unusable': L(
    '设置的目录不可用，或它不包含 wiki\\ 子目录。',
    'The configured folder is unusable, or it has no wiki\\ subfolder.',
  ),
};

/** Resolve a wiki page name to a file, tolerating spaces/underscores. */
function resolvePage(name) {
  if (!state.pageIndex) return null;
  const tries = [name, name.replace(/ /g, '_'), name.replace(/_/g, ' ')];
  for (const t of tries) {
    const hit = state.pageIndex.get(t.toLowerCase());
    if (hit && hit.type !== 'dir') return hit;
  }
  return null;
}

/**
 * Read a page and strip the parts of the offline dump that fight with an
 * iframe embed (its own sticky header/nav and fixed-width body).
 */
function readPage(name) {
  const hit = resolvePage(name);
  if (!hit) return null;
  let html;
  try {
    html = fs.readFileSync(hit.file, 'utf8');
  } catch {
    return null;
  }

  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1] : hit.name;

  // Pull out the main content container when we can find it, so the embedding
  // page keeps its own chrome instead of showing the wiki's navigation twice.
  let body = html;
  const contentMatch = /<div[^>]+id=["']mw-content-text["'][^>]*>/i.exec(html);
  if (contentMatch) {
    body = extractBalancedDiv(html, contentMatch.index);
  } else {
    const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    if (bodyMatch) body = bodyMatch[1];
  }

  const relToRoot = path.relative(state.root, hit.file).replace(/\\/g, '/');

  return {
    name: hit.name,
    title: title
      .replace(/\s*-\s*欧陆风云4百科.*$/, '')
      .replace(/\s*-\s*Europa Universalis 4 Wiki.*$/, ''),
    file: relToRoot,
    url: '/wikifile/' + relToRoot.split('/').map(encodeURIComponent).join('/'),
    html: body,
  };
}

/** Extract a top-level <div> starting at `start` using brace-free depth count. */
function extractBalancedDiv(html, start) {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let m;
  let end = html.length;
  while ((m = tagRe.exec(html))) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }
  return html.slice(start, end);
}

/** Fuzzy substring search over page names. */
function search(q, limit = 60) {
  if (!state.pageIndex) return [];
  const needle = q.toLowerCase();
  const out = [];
  for (const [key, hit] of state.pageIndex) {
    if (hit.type === 'dir') continue;
    if (key.includes(needle)) {
      out.push({ name: hit.name, isSub: hit.type === 'subpage' });
      if (out.length >= limit) break;
    }
  }
  out.sort((a, b) => a.name.length - b.name.length);
  return out;
}

// ---------------------------------------------------------------------------
// Page suggestions
// ---------------------------------------------------------------------------

/**
 * Map a taxonomy category id to the offline Chinese wiki pages worth showing
 * alongside it. These names were verified to exist in the 1.37 dump.
 */
const CATEGORY_PAGES = {
  countries: ['国家.html', '国家列表.html', '国家理念.html', '自定义国家修改.html'],
  provinces: ['省份修改.html', '省份列表.html', '省份界面.html'],
  map: ['地图修改.html', '地图.html', '地形.html', '地区.html'],
  decisions: ['决议修改.html', '决议.html', '总决议列表.html'],
  events: ['事件修改.html', '事件.html', '事件ID.html'],
  missions: ['任务树修改.html', '任务树.html', '总任务列表.html'],
  ideas: ['理念组修改.html', '理念组.html', '国家理念.html'],
  policies: ['政策修改.html', '政策.html'],
  government: ['政府修改.html', '政体类型及修改.html', '政府改革.html', '政府互动修改.html'],
  religion: ['宗教修改.html', '宗教.html', '信条.html'],
  culture: ['文化修改.html', '文化.html'],
  technology: ['科技修改.html', '思潮修改.html', '科技.html'],
  units: ['单位修改.html', '陆军单位.html', '海军单位.html'],
  buildings: ['建筑修改.html', '建筑.html'],
  trade: ['贸易节点修改.html', '贸易公司修改.html', '商品修改.html'],
  estates: ['阶层修改.html', '阶层特权.html', '阶层互动.html'],
  disasters: ['灾难修改.html', '灾难.html'],
  ages: ['时代修改.html', '时代.html'],
  modifiers: ['修正修改.html', '修正类型及修改.html', '修正列表.html'],
  scripted: ['Mod文件结构.html', '修改.html'],
  on_actions: ['事件修改.html', 'Mod文件结构.html'],
  casusbelli: ['宣战理由修改.html', '战争目标.html', '和平条约.html'],
  advisors: ['顾问修改.html', '顾问.html'],
  great_projects: ['伟大工程修改.html', '伟大工程.html'],
  rebels: ['叛军修改.html', '叛军.html'],
  bookmarks: ['书签修改.html', '剧本.html'],
  history: ['历史修改.html', '历史将领列表.html'],
  localisation: ['本地化.html', '可定制的本地化.html'],
  interface: ['界面修改.html', '界面.html', '用户界面.html'],
  gfx: ['贴图库修改.html', '模型修改.html', '字体修改.html'],
  audio: ['音乐修改.html', '音效修改.html'],
  dlc: ['DLC.html'],
  setup: ['Mod文件结构.html', '模组.html', '模组制作.html'],
  other: ['Mod文件结构.html'],
};

/**
 * English wiki pages per category.
 *
 * Titles are verbatim from the wiki's "Modding" navigation template
 * (https://eu4.paradoxwikis.com/Modding), which is why they can be linked
 * directly as `base + Title_With_Underscores`.
 */
const CATEGORY_PAGES_EN = {
  countries: [
    ['Country creation', '国家与政体'], ['Country list', '国家列表'], ['Mod structure', 'Mod 结构'],
  ],
  provinces: [
    ['Province modding', '省份修改'], ['Province list', '省份列表'], ['Map modding', '地图修改'],
  ],
  map: [
    ['Map modding', '地图修改'], ['Map Modding Quick Reference', '地图速查'],
    ['Random New World modding', '随机新世界'],
  ],
  decisions: [['Decision modding', '决议修改']],
  events: [['Event modding', '事件修改'], ['List of event pictures', '事件图片列表']],
  missions: [['Mission modding', '任务树修改']],
  ideas: [['Idea group modding', '理念组修改']],
  policies: [['Policy modding', '政策修改']],
  government: [
    ['Government modding', '政府修改'], ['Government mechanic modding', '政府机制修改'],
  ],
  religion: [['Religion modding', '宗教修改']],
  culture: [['Culture modding', '文化修改']],
  technology: [['Technology modding', '科技修改'], ['Institutions modding', '思潮修改']],
  units: [
    ['Unit modding', '单位修改'], ['Unit models', '兵模'], ['Mercenaries modding', '雇佣兵修改'],
  ],
  buildings: [['Building modding', '建筑修改']],
  trade: [
    ['Trade node modding', '贸易节点修改'], ['Trade company modding', '贸易公司修改'],
    ['Trade goods modding', '贸易商品修改'],
  ],
  estates: [['Estate modding', '阶层修改'], ['Parliament modding', '议会修改']],
  disasters: [['Disaster modding', '灾难修改']],
  ages: [['Age modding', '时代修改']],
  modifiers: [
    ['Modifier modding', '修正修改'], ['Modifier list', '修正列表'],
  ],
  scripted: [
    ['Scripted function modding', '脚本函数'], ['Effects', '命令/效果'], ['Triggers', '条件'],
    ['Scopes', '作用域'], ['Variables', '变量'],
  ],
  on_actions: [['On Actions', 'On Actions'], ['Event modding', '事件修改']],
  casusbelli: [
    ['Casus belli modding', '宣战理由修改'], ['Peace treaty modding', '和平条约修改'],
  ],
  advisors: [['Advisor modding', '顾问修改']],
  great_projects: [['Great project modding', '伟大工程修改']],
  rebels: [['Rebel modding', '叛军修改']],
  bookmarks: [['Scenario modding', '书签/剧本修改']],
  history: [['History modding', '历史修改']],
  localisation: [
    ['Localisation', '本地化'], ['Customizable localization', '可定制的本地化'],
  ],
  interface: [['Interface modding', '界面修改']],
  gfx: [
    ['Graphical asset modding', '贴图库修改'], ['Model modding', '模型修改'],
    ['Font modding', '字体修改'],
  ],
  audio: [['Music modding', '音乐修改'], ['Sound modding', '音效修改']],
  dlc: [['Mod structure', 'Mod 结构']],
  setup: [
    ['Mod structure', 'Mod 结构'], ['Mod troubleshooting', '疑难解答'],
    ['Scripting Tutorial', '脚本教程'], ['Defines', 'Defines'],
  ],
  other: [['Mod structure', 'Mod 结构'], ['Effects', '命令/效果'], ['Triggers', '条件']],
};

/** Build the online URL for a wiki page title. */
function onlineUrl(title, base) {
  const b = base || onlineBase();
  return b + encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/');
}

/** Resolve the offline Chinese page list to only pages that actually exist. */
function pagesForCategory(catId) {
  const names = CATEGORY_PAGES[catId] || CATEGORY_PAGES.other;
  return names
    .map((n) => {
      const label = n.replace(/\.html$/, '');
      const hit = resolvePage(label);
      return hit ? { name: hit.name, label } : null;
    })
    .filter(Boolean);
}

/** English page list for a category (no network access needed). */
function onlinePagesForCategory(catId) {
  const rows = CATEGORY_PAGES_EN[catId] || CATEGORY_PAGES_EN.other;
  const base = onlineBase();
  return rows.map(([title, zhLabel]) => ({
    title,
    label: title,
    zhLabel,
    url: onlineUrl(title, base),
  }));
}

/**
 * Everything the UI needs to render the "related wiki pages" block.
 * Both sources are reported with their own enabled/available flags so the page
 * can explain *why* nothing is shown.
 */
function suggest(catId, lang) {
  const l = normalizeLang(lang);
  const cfg = config.get();
  const localOn = Boolean(cfg.wiki.local.enabled);
  const onlineOn = onlineEnabled();
  const st = status(l);

  return {
    category: catId,
    local: {
      enabled: localOn,
      available: st.available,
      error: st.error,
      errorText: st.errorText,
      pages: localOn && st.available ? pagesForCategory(catId) : [],
    },
    online: {
      enabled: onlineOn,
      base: onlineBase(),
      pages: onlineOn ? onlinePagesForCategory(catId) : [],
    },
  };
}

module.exports = {
  init,
  configureLocal,
  validateDir,
  status,
  readPage,
  search,
  suggest,
  pagesForCategory,
  onlinePagesForCategory,
  onlineUrl,
  onlineBase,
  onlineEnabled,
  resolvePage,
  getRoot: () => state.root,
  getWikiDir: () => state.wikiDir,
  isEnabled: () => state.enabled,
  CATEGORY_PAGES,
  CATEGORY_PAGES_EN,
};
