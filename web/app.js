'use strict';

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function fmtNum(n) {
  return window.I18N.fmtNum(n);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(text, needle) {
  const safe = escapeHtml(text);
  if (!needle) return safe;
  const idx = safe.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return safe;
  return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + needle.length) + '</mark>' + safe.slice(idx + needle.length);
}

const ENC_LABEL = {
  'plain-utf8': [() => t('纯 UTF-8'), 'plain'],
  'escaped-cp1252': [() => t('转义编码 (CP1252)'), 'cp'],
  'escaped-raw': [() => t('转义编码 (原始)'), 'raw'],
};

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

/**
 * fetch() wrapper.
 *
 * Every request carries the active UI language, because the server localises
 * the labels it generates (field names, scope nouns, error messages, wiki
 * suggestions). The stored setting is only a default for the very first
 * request; after that the client is authoritative, which keeps a language
 * switch instant and immune to a failed settings write.
 */
async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = path + sep + 'lang=' + encodeURIComponent(window.I18N ? I18N.getLang() : 'zh');
  const res = await fetch(url);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

/** True when a local offline Chinese wiki is configured and usable. */
function localWikiAvailable() {
  if (state.wikiStatus) return Boolean(state.wikiStatus.available);
  const s = state.suggest && state.suggest.local;
  return Boolean(s && s.available);
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const state = {
  mods: [],
  current: null,
  category: null,
  tree: null,
  currentFile: null,
  wikiStatus: null,
  view: 'overview',
  game: null,
  installDir: '',
};

/* ------------------------------------------------------------------ *
 * Sidebar
 * ------------------------------------------------------------------ */

function renderModList() {
  const host = $('#mod-list');
  host.innerHTML = '';
  for (const m of state.mods) {
    const item = el('a', {
      class: 'mod-item' + (state.current && state.current.id === m.id ? ' active' : ''),
      href: '#',
      onclick: (e) => { e.preventDefault(); selectMod(m.id); },
    }, [
      el('span', { class: 'mi-name', text: m.name }),
      el('span', {
        class: 'mi-meta',
        html: (m.version ? 'v' + escapeHtml(m.version) + ' · ' : '')
          + t('{n} 个文件', { n: fmtNum(m.stats.files) }) + ' · '
          + t('{n} 类', { n: m.categories.length })
          + (m.isWorkshop ? '<span class="mi-badge ws">' + t('创意工坊') + '</span>'
            : '<span class="mi-badge">' + t('本地') + '</span>'),
      }),
    ]);
    host.appendChild(item);
  }
}

/* ------------------------------------------------------------------ *
 * Mod overview
 * ------------------------------------------------------------------ */

async function selectMod(id, opts = {}) {
  state.category = null;
  state.currentFile = null;
  state.view = 'overview';
  $('#content').innerHTML = '<div class="loading">' + t('正在载入模组…') + '</div>';
  renderModList();

  const mod = state.mods.find((m) => m.id === id);
  if (!mod) return;
  state.current = mod;
  renderModList();

  try {
    const [detail, tree] = await Promise.all([
      api(`/api/mod/${encodeURIComponent(id)}`),
      api(`/api/mod/${encodeURIComponent(id)}/tree`),
    ]);
    state.current = { ...mod, ...detail };
    state.tree = tree.tree;
    renderOverview();
    if (!opts.fromRoute) updateHash();
  } catch (e) {
    $('#content').innerHTML = '';
    $('#content').appendChild(el('div', { class: 'error-box', text: t('载入失败: ') + e.message }));
  }
}

function renderOverview() {
  const m = state.current;
  const c = $('#content');
  c.innerHTML = '';

  const art = el('div', { class: 'wiki-article' });

  // Hero
  const hero = el('div', { class: 'mod-hero' });
  if (m.thumbnailUrl) hero.appendChild(el('img', { class: 'thumb', src: m.thumbnailUrl, alt: m.name }));
  const info = el('div', { class: 'hero-info' }, [
    el('h1', { class: 'hero-name', text: m.name }),
    el('div', {
      class: 'hero-sub',
      html: t('版本 ') + '<b>' + escapeHtml(m.version || t('未标注')) + '</b> · '
        + t('支持游戏版本 ') + '<b>' + escapeHtml(m.supportedVersion || t('未标注')) + '</b>'
        + (m.remoteFileId ? ' · ' + t('创意工坊 ID ') + '<b>' + escapeHtml(String(m.remoteFileId)) + '</b>' : ''),
    }),
    el('div', { class: 'tag-list' }, (m.tags || []).map((tag) => el('span', { class: 'tag', text: tag }))),
  ]);
  if ((m.dependencies || []).length) {
    info.appendChild(el('div', { class: 'tag-list' }, [
      el('span', { class: 'hero-sub', text: t('依赖：') }),
      ...m.dependencies.map((d) => el('span', { class: 'tag dep', text: d })),
    ]));
  }
  if ((m.replacePaths || []).length) {
    info.appendChild(el('div', { class: 'tag-list' }, [
      el('span', { class: 'hero-sub', text: t('整目录替换：') }),
      ...m.replacePaths.map((d) => el('span', { class: 'tag repl', text: d })),
    ]));
  }
  hero.appendChild(info);
  art.appendChild(hero);

  const body = el('div', { class: 'article-body' });

  // Infobox
  const box = el('div', { class: 'infobox' }, [
    el('h3', { text: t('模组信息') }),
    el('table', {}, [
      el('tr', {}, [el('th', { text: t('名称') }), el('td', { text: m.name })]),
      el('tr', {}, [el('th', { text: t('版本') }), el('td', { text: m.version || '—' })]),
      el('tr', {}, [el('th', { text: t('支持版本') }), el('td', { text: m.supportedVersion || '—' })]),
      el('tr', {}, [el('th', { text: t('来源') }), el('td', { text: m.isWorkshop ? t('Steam 创意工坊') : t('本地模组') })]),
      el('tr', {}, [el('th', { text: t('文件总数') }), el('td', { text: fmtNum(m.stats.files) })]),
      el('tr', {}, [el('th', { text: t('文本文件') }), el('td', { text: fmtNum(m.stats.textFiles) })]),
      el('tr', {}, [el('th', { text: t('资源文件') }), el('td', { text: fmtNum(m.stats.binaryFiles) })]),
      el('tr', {}, [el('th', { text: t('总体积') }), el('td', { text: fmtBytes(m.stats.bytes) })]),
      el('tr', {}, [el('th', { text: t('改动类别') }), el('td', { text: fmtNum(m.stats.categories) })]),
      el('tr', {}, [el('th', { text: t('安装路径') }), el('td', { html: `<span style="font-family:var(--mono);font-size:11px;word-break:break-all">${escapeHtml(m.root || '')}</span>` })]),
    ]),
  ]);
  body.appendChild(box);

  body.appendChild(el('p', {
    html: t('本模组共改动了 ') + '<b>' + fmtNum(m.stats.files) + '</b>' + t(' 个文件，分布在 ')
      + '<b>' + fmtNum(m.stats.categories) + '</b>' + t(' 个改动类别中。')
      + t('点击下方任意类别或使用左侧文件树，即可查看具体改动内容。'),
  }));

  // Stat cards
  body.appendChild(el('div', { class: 'stat-grid' }, [
    statCard(fmtNum(m.stats.files), t('文件总数')),
    statCard(fmtNum(m.categories.reduce((s, x) => s + x.fileCount, 0)), t('已归类文件')),
    statCard(fmtNum(m.stats.textFiles), t('文本 / 脚本')),
    statCard(fmtBytes(m.stats.bytes), t('总体积')),
  ]));

  // Game-format preview entry point. The detail payload carries category
  // summaries (not the flat file list), so decide from categories.
  const CONTENT_CATEGORIES = ['events', 'decisions', 'ideas', 'policies', 'advisors'];
  const hasContent = (m.categories || []).some((cat) => CONTENT_CATEGORIES.includes(cat.id));
  if (hasContent) {
    body.appendChild(el('div', { class: 'gw-entry' }, [
      el('div', { class: 'gw-entry-text' }, [
        el('b', { text: t('🎮 游戏内格式预览') }),
        el('div', {
          class: 'hero-sub',
          text: t('把脚本与本地化文件对应起来，按 EU4 在游戏里实际显示的样子浏览事件、决议、理念组、国家理念、顾问和政策。'),
        }),
      ]),
      el('button', { class: 'btn', text: t('打开游戏内预览 →'), onclick: () => openGame('events') }),
    ]));
  }

  body.appendChild(el('h2', { class: 'wiki-h2', text: t('改动类别') }));
  body.appendChild(el('p', {
    class: 'hero-sub',
    text: t('按游戏内容分类，显示该模组在各个系统上的改动规模。'),
  }));

  const grid = el('div', { class: 'cat-grid' });
  for (const cat of m.categories) {
    grid.appendChild(el('div', {
      class: 'cat-card',
      onclick: () => openCategory(cat.id),
    }, [
      el('div', { class: 'cc-head' }, [
        el('span', { class: 'cc-icon', text: cat.icon || '📁' }),
        el('span', { class: 'cc-zh', text: t(cat.zh) }),
        el('span', { class: 'cc-count', text: t('{n} 文件', { n: fmtNum(cat.fileCount) }) }),
      ]),
      el('div', { class: 'cc-en', text: cat.en }),
      el('div', { class: 'cc-desc', text: cat.desc ? t(cat.desc) : '' }),
    ]));
  }
  body.appendChild(grid);

  art.appendChild(body);
  c.appendChild(art);
}

function statCard(num, label) {
  return el('div', { class: 'stat-card' }, [
    el('span', { class: 'sc-num', text: num }),
    el('span', { class: 'sc-label', text: label }),
  ]);
}

/* ------------------------------------------------------------------ *
 * Category / file browser
 * ------------------------------------------------------------------ */

function openCategory(catId) {
  state.category = catId;
  state.currentFile = null;
  state.view = 'category';
  renderFileBrowser();
  updateHash();
}

/* ------------------------------------------------------------------ *
 * Game-format preview entry points
 * ------------------------------------------------------------------ */

/** Which game content type a script file belongs to, or null. */
function gameTypeForFile(rel) {
  const p = String(rel).toLowerCase();
  if (p.startsWith('events/')) return 'events';
  if (p.startsWith('decisions/')) return 'decisions';
  if (p.startsWith('common/ideas/')) return 'idea_groups';
  if (p.startsWith('common/advisortypes/')) return 'advisors';
  if (p.startsWith('common/policies/')) return 'policies';
  return null;
}

async function openGame(type, opts = {}) {
  if (typeof renderGameHub !== 'function') {
    $('#content').innerHTML = '<div class="error-box">' + t('游戏内预览模块未加载（/gameview.js）') + '</div>';
    return;
  }
  state.view = 'game';
  state.category = null;
  state.currentFile = null;
  gw.modId = state.current.id;
  if (type) gw.type = type;
  if (opts.file !== undefined) gw.file = opts.file;
  if (opts.card) gw.queueCard = { type: gw.type, id: opts.card };
  renderModList();
  await renderGameHub({ type: gw.type, file: opts.file });
  updateHash();
}

function renderFileBrowser() {
  const m = state.current;
  const c = $('#content');
  c.innerHTML = '';

  const art = el('div', { class: 'wiki-article' });
  art.appendChild(el('div', { class: 'breadcrumb' }, [
    el('a', { href: '#', text: m.name, onclick: (e) => { e.preventDefault(); renderOverview(); } }),
    document.createTextNode(' › '),
    el('span', { text: categoryLabel(state.category) }),
  ]));

  const cat = m.categories.find((x) => x.id === state.category);
  art.appendChild(el('h1', {
    class: 'article-title',
    text: cat ? cat.icon + ' ' + t(cat.zh) : t('全部文件'),
  }));

  const body = el('div', { class: 'article-body' });

  if (cat) {
    body.appendChild(el('p', {
      class: 'hero-sub',
      text: cat.en + ' — ' + (cat.desc ? t(cat.desc) : '')
        + t('（{n} 个文件，{size}）', { n: fmtNum(cat.fileCount), size: fmtBytes(cat.bytes) }),
    }));
    body.appendChild(el('div', { id: 'wiki-links', class: 'notice info', html: t('正在载入相关 wiki 页面…') }));
  }

  const browser = el('div', { class: 'file-browser' });
  const treeHost = el('div', { class: 'file-tree', id: 'file-tree' });
  const viewHost = el('div', { class: 'file-view', id: 'file-view' }, [
    el('div', { class: 'loading', text: t('从左侧选择一个文件以查看内容') }),
  ]);
  browser.appendChild(treeHost);
  browser.appendChild(viewHost);
  body.appendChild(browser);
  art.appendChild(body);
  c.appendChild(art);

  renderTree(treeHost);
  if (cat) loadWikiLinks(state.category);
}

function categoryLabel(id) {
  const m = state.current;
  const cat = m && m.categories.find((x) => x.id === id);
  return cat ? t(cat.zh) : t('全部文件');
}

function renderTree(host) {
  host.innerHTML = '';
  const m = state.current;
  const filter = state.category;

  // Build a pruned copy of the tree containing only files in this category.
  const root = state.tree ? filterTree(state.tree, filter, m) : [];
  if (!root || !root.length) {
    host.appendChild(el('div', { class: 'loading', text: t('该类别下没有文件') }));
    return;
  }
  for (const node of root) host.appendChild(treeNode(node, 1));
}

function filterTree(nodes, category, mod) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'dir') {
      const kids = filterTree(n.children, category, mod);
      if (kids.length) out.push({ ...n, children: kids });
    } else if (!category || n.category === category) {
      out.push(n);
    }
  }
  return out;
}

function treeNode(node, depth) {
  if (node.type === 'file') {
    const sizeTxt = node.binary ? '' : fmtBytes(node.size);
    return el('div', {
      class: 'ft-file' + (state.currentFile && state.currentFile.rel === node.rel ? ' active' : ''),
      title: node.rel,
      onclick: () => openFile(node.rel),
    }, [
      el('span', { text: node.binary ? '🖼' : fileIcon(node.rel) }),
      el('span', { text: node.name }),
      el('span', { class: 'ft-size', text: sizeTxt }),
    ]);
  }

  const children = el('div', { class: 'ft-children' }, node.children.map((c) => treeNode(c, depth + 1)));
  const arrow = el('span', { text: '▾' });
  const head = el('div', {
    class: 'ft-dir',
    onclick: () => {
      const hidden = children.classList.toggle('st-collapsed');
      arrow.textContent = hidden ? '▸' : '▾';
    },
  }, [arrow, document.createTextNode(' ' + node.name), el('span', { class: 'ft-size', text: `${node.children.length}` })]);
  return el('div', { class: 'ft-node' }, [head, children]);
}

function fileIcon(rel) {
  const p = rel.toLowerCase();
  if (p.endsWith('.yml') || p.endsWith('.yaml')) return '🔤';
  if (p.endsWith('.csv')) return '📊';
  if (p.endsWith('.mod')) return '📄';
  if (p.endsWith('.gui') || p.endsWith('.gfx')) return '🖥';
  if (p.endsWith('.txt') || p.endsWith('.lua')) return '📜';
  return '📄';
}

/* ------------------------------------------------------------------ *
 * Individual file rendering
 * ------------------------------------------------------------------ */

async function openFile(rel, category) {
  state.currentFile = { rel };
  if (category) state.category = category;
  renderFileBrowser();
  updateHash();
  const view = $('#file-view');
  if (!view) return;
  view.innerHTML = '<div class="loading">' + t('正在读取文件…') + '</div>';

  try {
    const data = await api(`/api/mod/${encodeURIComponent(state.current.id)}/file?path=${encodeURIComponent(rel)}`);
    view.innerHTML = '';
    view.appendChild(fileHeader(data));
    view.appendChild(fileBody(data));
    // Re-scroll the newly rendered tree so the active row is visible.
    const active = $('.ft-file.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    view.innerHTML = '';
    view.appendChild(el('div', { class: 'error-box', text: t('读取失败: ') + e.message }));
  }
}

function fileHeader(data) {
  const enc = data.render && data.render.encoding ? ENC_LABEL[data.render.encoding] : null;
  const meta = [];
  meta.push(fmtBytes(data.size));
  if (data.render && data.render.lineCount) meta.push(t('{n} 行', { n: fmtNum(data.render.lineCount) }));
  if (data.render && data.render.type === 'localisation') meta.push(t('{n} 条本地化', { n: fmtNum(data.render.entryCount) }));
  if (data.render && data.render.type === 'script' && data.render.entryCount) meta.push(t('{n} 个顶层条目', { n: fmtNum(data.render.entryCount) }));
  if (data.render && data.render.type === 'csv') meta.push(t('{n} 行', { n: fmtNum(data.render.rowCount) }));

  const head = el('div', { class: 'fv-head' }, [
    el('div', { class: 'fv-path', text: data.rel }),
    el('div', { class: 'fv-meta', html: meta.join(' · ') }),
  ]);

  const pills = el('div', { class: 'fv-meta' });
  if (enc) pills.appendChild(el('span', { class: 'pill ' + enc[1], text: enc[0]() }));
  if (data.category) pills.appendChild(el('span', { class: 'pill', text: data.category.icon + ' ' + t(data.category.zh) }));
  if (pills.childNodes.length) head.appendChild(pills);

  const gwType = gameTypeForFile(data.rel);
  if (gwType) {
    head.appendChild(el('div', { class: 'fv-meta' }, [
      el('button', {
        class: 'btn small',
        text: t('🎮 按游戏内格式查看该文件'),
        title: t('把本文件里的内容与本地化文件对应起来，按 EU4 游戏内的样子渲染'),
        onclick: () => openGame(gwType, { file: data.rel }),
      }),
    ]));
  }
  return head;
}

function fileBody(data) {
  const host = el('div', { class: 'fv-body' });
  const r = data.render;
  if (!r) return host;

  switch (r.type) {
    case 'localisation': return renderLocalisation(host, r, data);
    case 'script': return renderScript(host, r, data);
    case 'csv': return renderCsv(host, r);
    case 'text': return renderText(host, r);
    case 'image': return renderImage(host, r);
    case 'binary': return appendNotice(host, r.message || t('二进制文件'), 'warn');
    case 'tooLarge': return appendNotice(host, r.message, 'warn');
    case 'error': return appendNotice(host, r.message, 'warn');
    default: return appendNotice(host, t('未知内容类型'), 'warn');
  }
}

function appendNotice(host, text, kind = 'info') {
  host.appendChild(el('div', { class: 'notice ' + kind, text }));
  return host;
}

function renderLocalisation(host, r, data) {
  if (r.encoded) {
    host.appendChild(el('div', {
      class: 'notice info',
      html: t('该文件的文本使用 EU4 私有转义编码（非 UTF-8 中文），已自动解码显示。原始文件中中文以「控制字节 + 字形」形式存储。'),
    }));
  }
  host.appendChild(el('div', {
    class: 'fv-meta',
    html: t('语言头 ') + '<b>' + escapeHtml(r.language || t('未声明')) + '</b> · ' + t('共 {n} 条', { n: fmtNum(r.entryCount) })
      + (r.malformed ? ' · ' + t('{n} 行无法解析', { n: r.malformed }) : ''),
  }));

  const filterWrap = el('div', { style: 'margin:10px 0' });
  const input = el('input', {
    type: 'search',
    placeholder: t('在本地化条目中筛选…'),
    style: 'width:100%;padding:6px 10px;border:1px solid var(--wiki-border);border-radius:3px;font-family:var(--sans);font-size:13px',
  });
  filterWrap.appendChild(input);
  host.appendChild(filterWrap);

  const scroll = el('div', { class: 'loc-scroll' });
  const table = el('table', { class: 'wikitable' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { style: 'width:38%', text: t('键 (key)') }),
    el('th', { text: t('文本 (value)') }),
  ])]));
  const tbody = el('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);
  host.appendChild(scroll);

  const render = (needle) => {
    tbody.innerHTML = '';
    const n = needle ? needle.toLowerCase() : '';
    let shown = 0;
    for (const e of r.entries) {
      if (n && !(e.key.toLowerCase().includes(n) || e.value.toLowerCase().includes(n))) continue;
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'k', html: highlight(e.key, needle) }),
        el('td', { class: 'v loc-value', html: highlight(e.value, needle) }),
      ]));
      if (++shown >= 3000) break;
    }
    if (!shown) {
      tbody.appendChild(el('tr', {}, [el('td', { colspan: '2', class: 'loading', text: t('没有匹配的条目') })]));
    }
  };
  input.addEventListener('input', () => render(input.value.trim()));
  render('');
  return host;
}

function renderScript(host, r, data) {
  if (r.parseError) {
    host.appendChild(el('div', { class: 'notice warn', text: t('解析提示: ') + r.parseError + t('（下方为原始文本）') }));
  }
  const toggle = el('div', { style: 'margin-bottom:8px' });
  const treeBtn = el('button', { class: 'btn small', text: t('结构化视图') });
  const srcBtn = el('button', { class: 'btn small ghost', text: t('原始文本'), style: 'color:#333;border-color:#bbb;margin-left:6px' });
  toggle.appendChild(treeBtn);
  toggle.appendChild(srcBtn);
  host.appendChild(toggle);

  const treeHost = el('div');
  const srcHost = el('div');
  srcHost.style.display = 'none';

  if (r.root) treeHost.appendChild(renderScriptTree(r.root));
  else treeHost.appendChild(el('div', { class: 'notice warn', text: t('无法构建结构树') }));

  const pre = el('pre', { class: 'source' });
  pre.textContent = r.source || '';
  srcHost.appendChild(pre);

  host.appendChild(treeHost);
  host.appendChild(srcHost);

  treeBtn.addEventListener('click', () => { treeHost.style.display = ''; srcHost.style.display = 'none'; });
  srcBtn.addEventListener('click', () => { treeHost.style.display = 'none'; srcHost.style.display = ''; });
  return host;
}

function renderScriptTree(root) {
  const wrap = el('div', { class: 'script-tree' });
  for (const entry of root.entries || []) {
    wrap.appendChild(scriptEntry(entry));
  }
  if (!root.entries || !root.entries.length) {
    wrap.appendChild(el('div', { class: 'loading', text: t('没有顶层条目') }));
  }
  return wrap;
}

function scriptEntry(entry) {
  const row = el('div', { class: 'st-entry' });
  const line = el('div');
  line.appendChild(el('span', { class: 'st-key', text: entry.key }));
  line.appendChild(el('span', { class: 'st-op', text: ' ' + (entry.op || '=') + ' ' }));

  const v = entry.value;
  if (!v || v.type === 'string' || v.type === 'identifier' || v.type === 'number') {
    const cls = !v ? 'st-scalar' : v.type === 'number' ? 'st-number' : 'st-scalar';
    const txt = !v ? '' : v.type === 'string' ? `"${v.value}"` : (v.raw !== undefined ? v.raw : v.value);
    line.appendChild(el('span', { class: cls, text: txt }));
    row.appendChild(line);
    return row;
  }

  const arrow = el('span', { class: 'st-toggle', text: '▾' });
  line.insertBefore(arrow, line.firstChild);
  const block = el('div', { class: 'st-block' });

  if (v.type === 'object') {
    for (const child of v.entries || []) block.appendChild(scriptEntry(child));
  } else if (v.type === 'array') {
    for (const item of v.items || []) {
      if (item.type === 'object') {
        const o = el('div', { class: 'st-block' });
        for (const child of item.entries || []) o.appendChild(scriptEntry(child));
        block.appendChild(o);
      } else {
        const txt = item.type === 'string' ? `"${item.value}"` : (item.raw !== undefined ? item.raw : item.value);
        block.appendChild(el('div', { class: 'st-array-item', text: txt }));
      }
    }
  }

  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = block.classList.toggle('st-collapsed');
    arrow.textContent = hidden ? '▸' : '▾';
  });
  line.style.cursor = 'pointer';
  line.addEventListener('click', () => {
    const hidden = block.classList.toggle('st-collapsed');
    arrow.textContent = hidden ? '▸' : '▾';
  });

  row.appendChild(line);
  row.appendChild(block);
  return row;
}

function renderCsv(host, r) {
  host.appendChild(el('div', {
    class: 'fv-meta',
    html: t('共 {n} 行', { n: fmtNum(r.rowCount) }) + (r.truncated ? t('（仅显示前 5000 行）') : ''),
  }));
  const scroll = el('div', { class: 'loc-scroll' });
  const table = el('table', { class: 'wikitable' });
  const rows = r.rows || [];
  if (rows.length) {
    const maxCols = Math.max(...rows.slice(0, 50).map((x) => x.length));
    const thead = el('thead', {}, [el('tr', {}, rows[0].map((h) => el('th', { text: h })))]);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of rows.slice(1, 2000)) {
      const tr = el('tr');
      for (let i = 0; i < maxCols; i++) tr.appendChild(el('td', { text: row[i] !== undefined ? row[i] : '' }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }
  scroll.appendChild(table);
  host.appendChild(scroll);
  return host;
}

function renderText(host, r) {
  const pre = el('pre', { class: 'source' });
  pre.textContent = r.source || '';
  host.appendChild(pre);
  return host;
}

function renderImage(host, r) {
  if (r.note) host.appendChild(el('div', { class: 'notice info', text: r.note }));
  host.appendChild(el('div', {
    style: 'padding:12px;background:#e9e6de;border:1px solid var(--wiki-border);border-radius:3px;text-align:center;overflow:auto',
  }, [
    el('img', {
      src: r.url,
      alt: t('资源预览'),
      style: 'max-width:100%;max-height:70vh;background:#fff;border:1px solid #ccc',
    }),
  ]));
  return host;
}

/* ------------------------------------------------------------------ *
 * Offline wiki links
 * ------------------------------------------------------------------ */

/**
 * "Related wiki pages" block.
 *
 * There are two independent sources and either can be off:
 *   - the local offline Chinese dump, opened inline in an iframe below;
 *   - eu4.paradoxwikis.com, opened in a new tab.
 * The block explains which one is missing and links straight to Settings, so a
 * disabled wiki never looks like a broken feature.
 */
async function loadWikiLinks(categoryId) {
  const host = $('#wiki-links');
  if (!host) return;
  try {
    const data = await api(`/api/wiki/suggest?category=${encodeURIComponent(categoryId)}`);
    state.suggest = data;
    state.wikiStatus = data.local;

    host.innerHTML = '';
    host.className = 'notice info';

    const local = data.local || {};
    const online = data.online || {};
    const hasLocal = Boolean(local.enabled && local.available && (local.pages || []).length);
    const hasOnline = Boolean(online.enabled && (online.pages || []).length);

    if (!hasLocal && !hasOnline) {
      host.className = 'notice warn';
      host.appendChild(el('span', { text: wikiOffReason(local) }));
      host.appendChild(document.createTextNode(' '));
      host.appendChild(el('button', {
        class: 'btn small ghost',
        style: 'margin-left:6px',
        text: t('打开设置'),
        onclick: () => { if (window.openSettings) window.openSettings(); },
      }));
      return;
    }

    // --- local offline Chinese wiki ---------------------------------------
    if (hasLocal) {
      host.appendChild(el('div', { html: t('<b>相关 wiki 页面</b>（点击在下方内嵌打开）：') }));
      const list = el('div', { style: 'margin-top:6px;display:flex;flex-wrap:wrap;gap:6px' });
      for (const p of local.pages) {
        list.appendChild(el('button', {
          class: 'btn small',
          text: p.label || p.name,
          style: 'background:#fff',
          onclick: () => showWikiPage(p.name),
        }));
      }
      host.appendChild(list);
    }

    // --- English online wiki ----------------------------------------------
    if (hasOnline) {
      host.appendChild(el('div', {
        style: hasLocal ? 'margin-top:10px' : '',
        html: hasLocal
          ? t('<b>英文 wiki</b>（在新标签页打开）：')
          : t('<b>相关 wiki 页面</b>（英文 wiki，在新标签页打开）：'),
      }));
      const list = el('div', { style: 'margin-top:6px;display:flex;flex-wrap:wrap;gap:6px' });
      for (const p of online.pages) {
        list.appendChild(el('a', {
          class: 'btn small',
          href: p.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: p.title,
          style: 'background:#fff',
        }));
      }
      host.appendChild(list);
    }
  } catch (e) {
    host.className = 'notice warn';
    host.textContent = t('载入 wiki 链接失败: ') + e.message;
  }
}

/** Why no local wiki page could be offered, in the reader's language. */
function wikiOffReason(local) {
  if (!local || !local.enabled) {
    return t('未启用本地中文 wiki。可在「设置」中启用并选择目录。');
  }
  return local.errorText || t('未找到离线中文 wiki。请在「设置」中手动选择目录。');
}

async function showWikiPage(name) {
  let panel = $('#wiki-panel');
  if (!panel) {
    panel = el('div', { class: 'panel', id: 'wiki-panel' });
    const links = $('#wiki-links');
    const article = $('.wiki-article');
    if (links) {
      links.parentNode.insertBefore(panel, links.nextSibling);
    } else if (article) {
      article.appendChild(panel);
    } else {
      ($('.content') || document.body).appendChild(panel);
    }
  }
  panel.innerHTML = '';
  panel.appendChild(el('h2', { class: 'panel-title', text: t('离线 wiki：{name}', { name }) }));
  panel.appendChild(el('div', { style: 'padding:8px 12px' }, [
    el('button', { class: 'btn small ghost', text: t('收起'), style: 'color:#333;border-color:#bbb', onclick: () => panel.remove() }),
  ]));
  const frame = el('iframe', {
    style: 'width:100%;height:70vh;border:0;border-top:1px solid var(--wiki-border);background:#fff',
  });
  panel.appendChild(frame);
  try {
    const page = await api(`/api/wiki/page?name=${encodeURIComponent(name)}`);
    frame.srcdoc = buildWikiDoc(page, name);
  } catch (e) {
    panel.appendChild(el('div', { class: 'error-box', text: t('载入失败: ') + e.message }));
  }
  if (typeof panel.scrollIntoView === 'function') {
    panel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
  return panel;
}

function buildWikiDoc(page, name) {
  // Rebase the dump's relative asset URLs onto our /wikifile/ mount.
  const css = [
    '/wikifile/all.css',
    '/wikifile/liberty.css',
    '/wikifile/skinliberty.css',
    '/wikifile/v4-shims.css',
  ].map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  const fixups = `
    <style>
      html,body{background:#fff;margin:0;padding:12px 16px;font-family:"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7;color:#202122}
      img{max-width:100%;height:auto}
      a{color:#0b4f8a}
      table{border-collapse:collapse;max-width:100%}
      table td,table th{border:1px solid #c8c3b4;padding:4px 8px;font-size:13px}
      table th{background:#eaeef4}
      h1,h2,h3{font-family:Georgia,"Songti SC",serif;color:#223551;font-weight:400}
      h2{border-bottom:1px solid #c8c3b4;padding-bottom:4px}
      pre,code{font-family:Consolas,monospace;font-size:12.5px;background:#f4f2ec;border-radius:3px}
      pre{padding:10px;overflow:auto}
      .mw-editsection,.mw-jump-link,.mw-indicators,#toc,.toc,.navbox,.catlinks{display:none}
      .thumb{border:1px solid #ddd;background:#fafafa;padding:3px}
    </style>
    <script>
      // Turn wiki-internal links into messages for the host page.
      document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^[a-z]+:/i.test(href)) return;
        var file = href.split('#')[0].split('/').pop();
        if (!/\\.html$/i.test(file)) return;
        e.preventDefault();
        parent.postMessage({ type: 'eu4wiki', page: decodeURIComponent(file.replace(/\\.html$/i, '')) }, '*');
      }, true);
    </script>
  `;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="/wikifile/wiki/">${css}${fixups}</head><body>${page.html}</body></html>`;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

async function runSearch(q) {
  if (!q) return;
  const c = $('#content');
  c.innerHTML = '';
  const art = el('div', { class: 'wiki-article' });
  art.appendChild(el('h1', { class: 'article-title', text: t('搜索：{q}', { q }) }));
  const body = el('div', { class: 'article-body' });
  art.appendChild(body);
  c.appendChild(art);

  const status = el('div', { class: 'loading', text: t('正在搜索…') });
  body.appendChild(status);

  try {
    const [modRes, wikiRes] = await Promise.all([
      state.current
        ? api(`/api/mod/${encodeURIComponent(state.current.id)}/search?q=${encodeURIComponent(q)}`)
        : Promise.resolve({ results: [] }),
      api(`/api/wiki/search?q=${encodeURIComponent(q)}&limit=40`),
    ]);

    body.innerHTML = '';

    // Mod results
    body.appendChild(el('h2', { class: 'wiki-h2', text: t('模组内结果') + (state.current ? t('（') + state.current.name + t('）') : '') }));
    const mr = modRes.results || [];
    if (!state.current) {
      body.appendChild(el('div', { class: 'notice info', text: t('请先在左侧选择一个模组，即可搜索该模组内的文件与文本。') }));
    } else if (!mr.length) {
      body.appendChild(el('div', { class: 'notice', text: t('没有匹配的文件或本地化条目。') }));
    } else {
      const wrap = el('div', { class: 'search-results' });
      for (const r of mr) {
        if (r.type === 'file') {
          wrap.appendChild(el('div', {
            class: 'sr-item',
            onclick: () => openFile(r.rel),
          }, [
            el('div', { class: 'sr-rel', html: highlight(r.rel, q) }),
            el('div', { class: 'ft-cat', text: t('文件') }),
          ]));
        } else {
          wrap.appendChild(el('div', {
            class: 'sr-item',
            onclick: () => openFile(r.rel),
          }, [
            el('div', { class: 'sr-key', html: highlight(r.key, q) }),
            el('div', { html: highlight(r.value, q) }),
            el('div', { class: 'sr-rel', html: highlight(r.rel, q) }),
          ]));
        }
      }
      body.appendChild(wrap);
    }

    // Wiki results
    body.appendChild(el('h2', { class: 'wiki-h2', text: t('离线中文 wiki') }));
    const wr = wikiRes.results || [];
    if (!wr.length) {
      body.appendChild(el('div', { class: 'notice', text: t('wiki 中没有匹配的页面。') }));
    } else {
      const wrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
      for (const p of wr) {
        wrap.appendChild(el('button', {
          class: 'btn small',
          style: 'background:#fff',
          text: p.name,
          onclick: () => showWikiPage(p.name),
        }));
      }
      body.appendChild(wrap);
      const panelHost = el('div');
      body.appendChild(panelHost);
    }
  } catch (e) {
    status.className = 'error-box';
    status.textContent = t('搜索失败: ') + e.message;
  }
}

/* ------------------------------------------------------------------ *
 * Routing (hash based, so views are shareable and survive refresh)
 * ------------------------------------------------------------------ */

function updateHash() {
  if (!state.current) return;
  const parts = ['#mod', encodeURIComponent(state.current.id)];
  if (state.view === 'game' && typeof gw !== 'undefined') {
    parts.push('game', encodeURIComponent(gw.type || 'events'));
    if (gw.card) parts.push('card', encodeURIComponent(gw.card.id));
  } else {
    if (state.category) parts.push('cat', encodeURIComponent(state.category));
    if (state.currentFile && state.currentFile.rel) parts.push('file', encodeURIComponent(state.currentFile.rel));
  }
  const h = parts.join('/');
  if (location.hash !== h) history.replaceState(null, '', h);
}

async function applyRoute() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return false;
  const seg = raw.split('/');
  if (seg[0] !== 'mod' || !seg[1]) return false;

  const modId = decodeURIComponent(seg[1]);
  let category = null;
  let file = null;
  let game = null;
  let card = null;
  for (let i = 2; i + 1 < seg.length; i += 2) {
    if (seg[i] === 'cat') category = decodeURIComponent(seg[i + 1]);
    if (seg[i] === 'file') file = decodeURIComponent(seg[i + 1]);
    if (seg[i] === 'game') game = decodeURIComponent(seg[i + 1]);
    if (seg[i] === 'card') card = decodeURIComponent(seg[i + 1]);
  }

  await selectMod(modId, { fromRoute: true });
  if (game) { await openGame(game, card ? { card } : {}); return true; }
  if (file) await openFile(file, category);
  else if (category) openCategory(category);
  return true;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

/** Status-bar summary. Also re-rendered when the UI language changes. */
function renderStatusBar() {
  const sb = $('#status-bar');
  if (!sb) return;
  const parts = [
    t('已发现 {n} 个模组', { n: state.mods.length }),
    state.installDir ? t('游戏目录 {dir}', { dir: state.installDir }) : t('未找到游戏目录'),
    state.wikiStatus && state.wikiStatus.available
      ? t('离线 wiki 已挂载（{n} 个页面）', { n: fmtNum(state.wikiStatus.pageCount) })
      : t('未找到离线 wiki'),
  ];
  sb.textContent = parts.join('  ·  ');
}

async function boot() {
  try {
    const [status, mods] = await Promise.all([api('/api/status'), api('/api/mods')]);
    state.mods = mods.mods;
    const wikiS = await api('/api/wiki/status').catch(() => ({ available: false }));
    state.wikiStatus = wikiS;
    state.installDir = status.installDir || '';

    renderStatusBar();

    renderModList();

    // Allow deep-linking straight to a wiki page: ?wiki=本地化
    const wikiParam = new URLSearchParams(location.search).get('wiki');
    if (wikiParam) {
      // Render something to anchor the panel onto, then open the page.
      await selectMod(state.mods[0].id, { fromRoute: true });
      await showWikiPage(wikiParam);
      return;
    }

    if (await applyRoute()) return;

    // Auto-open the biggest local (non-Workshop) mod — usually the one in use.
    const local = state.mods.filter((m) => !m.isWorkshop).sort((a, b) => b.stats.files - a.stats.files);
    if (local.length) selectMod(local[0].id);
  } catch (e) {
    $('#status-bar').textContent = t('初始化失败: ') + e.message;
  }
}

/** Re-fetch the mod list after the server rescan or a directory change. */
async function reloadMods() {
  const [status, mods] = await Promise.all([api('/api/status'), api('/api/mods')]);
  state.mods = mods.mods;
  state.installDir = status.installDir || '';
  state.wikiStatus = status.wiki || state.wikiStatus;
  // The previously open mod may no longer exist after a directory change.
  if (state.current && !state.mods.some((m) => m.id === state.current.id)) {
    state.current = null;
    state.tree = null;
    state.view = 'overview';
  }
  renderStatusBar();
  renderModList();
  if (state.current) {
    if (state.view === 'game' && typeof renderGameHub === 'function') {
      await renderGameHub({ type: typeof gw !== 'undefined' ? gw.type : undefined });
    } else if (state.view === 'category') renderFileBrowser();
    else renderOverview();
  } else if (state.mods.length) {
    await selectMod(state.mods[0].id);
  }
  return state.mods;
}

// settings.js calls this after saving directory overrides.
window.reloadMods = reloadMods;

$('#refresh-btn').addEventListener('click', async () => {
  $('#status-bar').textContent = t('正在重新扫描…');
  try {
    await api('/api/refresh');
    const mods = await api('/api/mods');
    state.mods = mods.mods;
    renderModList();
    $('#status-bar').textContent = t('已重新扫描：{n} 个模组', { n: state.mods.length });
  } catch (e) {
    $('#status-bar').textContent = t('重新扫描失败: ') + e.message;
  }
});

$('#search-btn').addEventListener('click', () => runSearch($('#global-search').value.trim()));
$('#global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch($('#global-search').value.trim());
});

$('#brand').addEventListener('click', (e) => {
  e.preventDefault();
  if (state.current) renderOverview();
});

// Wiki iframes post navigation requests here when an internal link is clicked.
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'eu4wiki' || !d.page) return;
  showWikiPage(d.page).catch(() => { /* ignore */ });
});

/* ------------------------------------------------------------------ *
 * Language switching
 *
 * Every t() call happens at render time, so switching the language only
 * has to re-render the visible view. Each branch is guarded: a switch must
 * never throw, whatever the current state happens to be.
 * ------------------------------------------------------------------ */

I18N.onChange(() => {
  try {
    renderStatusBar();
    renderModList();
    if (!state.current) return;
    if (state.view === 'game' && typeof renderGameHub === 'function') {
      renderGameHub({ type: typeof gw !== 'undefined' ? gw.type : undefined, file: typeof gw !== 'undefined' ? gw.file : undefined });
      return;
    }
    if (state.view === 'category') { renderFileBrowser(); return; }
    renderOverview();
  } catch (err) {
    // A failed re-render must not break the language switch itself.
    if (typeof console !== 'undefined' && console.error) console.error(err);
  }
});

boot();
