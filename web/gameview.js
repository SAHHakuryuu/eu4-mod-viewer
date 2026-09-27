'use strict';

/* ------------------------------------------------------------------ *
 * 游戏内格式预览
 *
 * Renders a mod's script + localisation as the panels EU4 itself shows.
 *
 * Two families of content type exist:
 *   • the six bespoke ones (event window, decision tooltip, idea group
 *     panel, advisor list, policy card) with a hand-written renderer;
 *   • everything else, which the server describes as generic "groups"
 *     (modifier list, condition list, effect list, item list, entry
 *     table, sub-block, raw script) and which `gwGenericCard` draws.
 *
 * The tab bar is driven by the server's `typeList`, so the UI can never
 * disagree with what the backend can actually build.
 *
 * Depends on the helpers declared in app.js (`el`, `api`, `escapeHtml`,
 * `state`, `showWikiPage`, `openFile`, `updateHash`, `fmtNum`, `t`), which
 * are global lexical bindings shared by classic scripts.
 * ------------------------------------------------------------------ */

const MP_CLASS = { ADM: 'adm', DIP: 'dip', MIL: 'mil' };
/** Monarch-power labels; the ADM/DIP/MIL keys are game identifiers and stay as they are. */
const MP_ZH = { ADM: '行政', DIP: '外交', MIL: '军事' };

/** How many list items to draw before folding the rest behind a button. */
const GW_LIST_CAP = 60;
/** How many dated history entries to show before folding. */
const GW_TIMELINE_CAP = 12;

const gw = {
  modId: null,
  index: null,
  type: 'events',
  group: null,
  items: [],
  total: 0,
  offset: 0,
  q: '',
  file: null,
  card: null,
  loading: false,
};

/** The active language, defensively. */
function gwLang() {
  return window.I18N && I18N.getLang() === 'en' ? 'en' : 'zh';
}

/** Pick the right side of a `{zh, en}` pair the server sent. */
function gwPick(pair) {
  if (!pair) return '';
  if (typeof pair === 'string') return pair;
  return gwLang() === 'en' ? (pair.en || pair.zh || '') : (pair.zh || pair.en || '');
}

/** Type metadata from the server's ordered list. */
function gwTypeMeta(id) {
  const list = (gw.index && gw.index.typeList) || [];
  return list.find((x) => x.id === id)
    || { id, label: id, zh: id, en: id, icon: '📄', group: null, wiki: null, wikiEn: null, count: 0 };
}

/** Group list from the server, with a single fallback group. */
function gwGroups() {
  const g = (gw.index && gw.index.groups) || [];
  return g.length ? g : [{ id: 'all', group: 'all', label: t('全部类别') }];
}

/** Every type in the active group. */
function gwTypesInGroup(groupId) {
  const list = (gw.index && gw.index.typeList) || [];
  return list.filter((x) => x.group === groupId);
}

/** Menu label for a content type: English in `en` mode, Chinese otherwise. */
function gwTypeLabel(type) {
  if (!type) return '';
  return gwLang() === 'en' ? (type.en || type.label || type.zh) : (type.zh || type.label || type.en);
}

/** Monarch-power label for the active language ('' when unknown). */
function gwMpLabel(mp) {
  return MP_ZH[mp] ? t(MP_ZH[mp]) : '';
}

/* ------------------------------------------------------------------ *
 * Rich text + line rendering
 * ------------------------------------------------------------------ */

function gwRich(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes || []) {
    if (n.k === 'br') { frag.appendChild(el('br')); continue; }
    if (n.k === 'i') {
      // `£icon_name£` — the game paints a real sprite here.
      const img = el('img', {
        class: 'gw-icon-img',
        src: `/api/mod/${encodeURIComponent(gw.modId)}/icon?name=${encodeURIComponent(n.s)}`,
        alt: n.s,
        title: t('游戏图标 £{icon}£', { icon: n.s }),
      });
      img.addEventListener('error', () => {
        const fallback = el('span', { class: 'gw-icon', title: t('游戏图标 £{icon}£（未找到贴图）', { icon: n.s }), text: '◆' });
        if (img.parentNode) img.parentNode.replaceChild(fallback, img);
      });
      frag.appendChild(img);
      continue;
    }
    if (n.k === 'd') {
      frag.appendChild(el('span', {
        class: 'gw-dyn',
        title: t('游戏运行时才会求值的动态文本：{code}（{note}）', { code: n.s, note: n.zh || '' }),
        text: '[' + n.s + ']',
      }));
      continue;
    }
    if (n.k === 'e') {
      frag.appendChild(el('span', {
        class: 'gw-engine',
        title: t('游戏引擎关键字 {ref} → {note}', { ref: '$' + n.s + '$', note: n.zh || t('运行时数值') }),
        text: '$' + n.s + '$',
      }));
      continue;
    }
    if (n.k === 'x') {
      frag.appendChild(el('span', {
        class: 'gw-missing-var',
        title: t('本地化文件中找不到这个键，游戏里会原样显示'),
        text: '$' + n.key + '$',
      }));
      continue;
    }
    if (n.k === 'v') {
      frag.appendChild(el('span', {
        class: 'gw-var' + (n.c ? ' gw-c-' + n.c : ''),
        title: t('来自另一条本地化：{ref}', { ref: '$' + n.key + '$' }),
        text: n.s,
      }));
      continue;
    }
    frag.appendChild(el('span', { class: 'gw-c-' + (n.c || 'plain'), text: n.s || '' }));
  }
  return frag;
}

/** Render a server name/desc value: rich nodes, a plain string, or nothing. */
function gwNodes(v) {
  if (!v) return null;
  if (typeof v === 'string') return el('span', { text: v });
  return gwRich(v);
}

function gwNameSpan(sp) {
  const cls = 'gw-name' + (sp.link ? ' gw-link' : '');
  const node = el('span', { class: cls, text: sp.s });
  if (sp.link) {
    node.title = t('{kind}：{id}（点击查看）', { kind: sp.link.kind, id: sp.link.id });
    node.addEventListener('click', () => gwFollow(sp.link));
  }
  return node;
}

function gwLines(lines, opts = {}) {
  const wrap = el('div', { class: 'gw-lines' });
  const list = lines || [];
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'gw-empty', text: opts.emptyText || t('（无）') }));
    return wrap;
  }
  for (const l of list) {
    const row = el('div', {
      class: 'gw-line gw-k-' + (l.k || 'txt'),
      style: `padding-left:${(l.i || 0) * 15}px`,
    });
    if (l.note) row.title = l.note;
    for (const sp of l.spans || []) {
      if (sp.t === 'raw') row.appendChild(el('span', { class: 'gw-raw', text: sp.s }));
      else if (sp.t === 'val') row.appendChild(el('span', { class: 'gw-val gw-' + (sp.c || 'neutral'), text: sp.s }));
      else if (sp.t === 'name') row.appendChild(gwNameSpan(sp));
      else row.appendChild(el('span', { class: 'gw-txt' + (sp.c ? ' gw-c-' + sp.c : ''), text: sp.s }));
    }
    wrap.appendChild(row);
  }
  return wrap;
}

/** Clicking a cross-reference chip jumps to the referenced content. */
const GW_LINK_TYPES = {
  event: 'events',
  idea_group: 'idea_groups',
  idea: 'idea_groups',
  advisor: 'advisors',
  policy: 'policies',
  mission: 'missions',
  mission_tree: 'mission_trees',
  building: 'buildings',
  religion: 'religion',
  religion_group: 'religion',
  culture: 'culture',
  culture_group: 'culture',
  trade_good: 'trade',
  trade_node: 'trade',
  trade_company: 'trade',
  price: 'trade',
  cb: 'wars',
  wargoal: 'wars',
  peace_treaty: 'wars',
  unit: 'units',
  mercenary: 'units',
  naval_doctrine: 'units',
  institution: 'technology',
  technology: 'technology',
  government: 'government',
  government_reform: 'government',
  government_mechanic: 'government',
  subject_type: 'government',
  faction: 'government',
  estate: 'estates',
  privilege: 'estates',
  estate_agenda: 'estates',
  rebel: 'rebels',
  revolt_trigger: 'rebels',
  disaster: 'disasters',
  age: 'ages',
  great_project: 'great_projects',
  // The only script commands that name a personality are the ruler/ancestor ones
  // (`add_ruler_personality`, `has_ruler_personality`), so that is where the chip
  // points. Leader traits are browsed from their own tab.
  personality: 'ruler_traits',
  modifier: 'modifiers',
  scripted_effect: 'scripted',
  scripted_trigger: 'scripted',
  on_action: 'on_actions',
  tag: 'countries',
  area: 'map',
  region: 'map',
  superregion: 'map',
  continent: 'map',
  climate: 'map',
  terrain: 'map',
};

function gwFollow(link) {
  if (!link || !link.kind) return;
  const type = GW_LINK_TYPES[link.kind];
  if (type && gwTypeMeta(type).id === type) {
    gwSwitchType(type, link.id);
    return;
  }
  gwToast(t('{kind}：{id}', { kind: link.kind, id: link.id }));
}

let toastTimer = null;
function gwToast(text) {
  let host = document.getElementById('gw-toast');
  if (!host) {
    host = el('div', { id: 'gw-toast', class: 'gw-toast' });
    document.body.appendChild(host);
  }
  host.textContent = text;
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ *
 * Hub page
 * ------------------------------------------------------------------ */

async function renderGameHub(opts = {}) {
  const m = state.current;
  if (!m) return;
  if (gw.modId !== m.id) { gw.q = ''; gw.file = null; gw.card = null; gw.index = null; gw.group = null; }
  gw.modId = m.id;
  if (opts.type) gw.type = opts.type;
  if (opts.file !== undefined) gw.file = opts.file;

  const c = $('#content');
  c.innerHTML = '';
  const art = el('div', { class: 'wiki-article' });
  art.appendChild(el('div', { class: 'breadcrumb' }, [
    el('a', { href: '#', text: m.name, onclick: (e) => { e.preventDefault(); renderOverview(); } }),
    document.createTextNode(' › '),
    el('span', { text: t('游戏内格式预览') }),
  ]));

  art.appendChild(el('h1', { class: 'article-title', text: t('🎮 游戏内格式预览') }));
  art.appendChild(el('p', {
    class: 'hero-sub',
    html: t('把模组的脚本文件与本地化文件对应起来，按 EU4 在游戏里实际显示的样子渲染：事件窗、决议提示、任务树、政府改革、阶层特权、灾难、时代、宗教、文化、建筑、贸易、单位、科技、修正、脚本、行动指令、宣战理由、伟大工程、叛军、书签、国家历史、地图与 GUI 界面。'),
  }));

  const statsHost = el('div', { class: 'notice info', id: 'gw-stats', text: t('正在建立内容索引（首次需要几秒钟）…') });
  art.appendChild(statsHost);

  if (gw.file) {
    art.appendChild(el('div', { class: 'gw-filefilter' }, [
      el('span', { text: t('仅显示文件：') }),
      el('code', { text: gw.file }),
      el('button', {
        class: 'btn small ghost',
        text: t('取消筛选'),
        onclick: () => { gw.file = null; renderGameHub({ type: gw.type, file: null }); updateHash(); },
      }),
    ]));
  }

  const nav = el('div', { class: 'gw-nav', id: 'gw-nav' });
  const split = el('div', { class: 'gw-split' }, [
    el('div', { class: 'gw-list-col', id: 'gw-list-col' }, [
      el('div', { class: 'gw-list-head' }, [
        el('input', {
          type: 'search', id: 'gw-search', class: 'gw-search',
          placeholder: t('在该类别中搜索…'), value: gw.q,
          oninput: (e) => { gw.q = e.target.value.trim(); gwLoadList(true); },
        }),
      ]),
      el('div', { class: 'gw-list', id: 'gw-list', html: t('<div class="loading">载入中…</div>') }),
      el('div', { class: 'gw-list-more', id: 'gw-list-more' }),
    ]),
    el('div', { class: 'gw-card-col', id: 'gw-card-col' }, [
      el('div', { class: 'gw-card-placeholder', text: t('← 从左侧选择一条内容，查看它在游戏中的样子') }),
    ]),
  ]);
  art.appendChild(nav);
  art.appendChild(split);
  c.appendChild(art);

  await gwEnsureIndex();
  renderGwNav();
  await gwLoadList(true);
  if (gw.queueCard) {
    const q = gw.queueCard;
    gw.queueCard = null;
    gwOpenCard(q.type, q.id, true);
  }
  void opts;
}

async function gwEnsureIndex() {
  if (gw.index && gw.index.mod === gw.modId && !gw.index.error) return gw.index;
  try {
    gw.index = await api(`/api/mod/${encodeURIComponent(gw.modId)}/game/index`);
  } catch (e) {
    gw.index = { error: e.message, stats: {}, typeList: [], groups: [], glossary: {} };
  }
  const host = $('#gw-stats');
  if (host) {
    if (gw.index.error) {
      host.className = 'notice warn';
      host.textContent = t('内容索引建立失败：{msg}', { msg: gw.index.error });
    } else {
      const s = gw.index.stats || {};
      const g = gw.index.glossary || {};
      const total = s.total || 0;
      const types = ((gw.index.typeList || []).filter((x) => x.count > 0)).length;
      const words = {
        n: fmtNum(total),
        types: fmtNum(types),
        m: fmtNum(s.locModKeys || 0),
        mods: fmtNum(g.modifiers || 0),
        trig: fmtNum(g.triggers || 0),
        effs: fmtNum(g.effects || 0),
      };
      const banner = g.fromWiki
        ? t('已解析 <b>{n}</b> 条游戏内容，分布在 <b>{types}</b> 个类别中 · 模组本地化键 <b>{m}</b> 条 · 中文词表：修正 {mods} / 条件 {trig} / 效果 {effs}（运行时读自本机离线 wiki）', words)
        : t('已解析 <b>{n}</b> 条游戏内容，分布在 <b>{types}</b> 个类别中 · 模组本地化键 <b>{m}</b> 条 · 中文词表：修正 {mods} / 条件 {trig} / 效果 {effs}（内置手写词表，未挂载离线 wiki）', words);
      host.className = 'notice info';
      host.innerHTML = banner
        + (gw.index.errors && gw.index.errors.length ? t(' · <span class="gw-warn">{n} 个文件读取失败</span>', { n: gw.index.errors.length }) : '');
    }
  }
  return gw.index;
}

function renderGwNav() {
  const nav = $('#gw-nav');
  if (!nav) return;
  nav.innerHTML = '';
  const groups = gwGroups();
  // Keep `gw.group` and `gw.type` consistent with each other.
  let cur = gwTypeMeta(gw.type);
  if (!cur.group) gw.type = ((gw.index && gw.index.typeList) || [])[0] ? gw.index.typeList[0].id : gw.type;
  cur = gwTypeMeta(gw.type);
  if (!gw.group || !groups.some((g) => g.id === gw.group)) gw.group = cur.group || groups[0].id;
  if (cur.group && cur.group !== gw.group) gw.group = cur.group;

  const gbar = el('div', { class: 'gw-groups' });
  for (const g of groups) {
    const n = gwTypesInGroup(g.id).reduce((a, x) => a + (x.count || 0), 0);
    gbar.appendChild(el('button', {
      class: 'gw-group' + (g.id === gw.group ? ' active' : ''),
      onclick: () => {
        const first = gwTypesInGroup(g.id)[0];
        if (gwTypeMeta(gw.type).group !== g.id && first) gwSwitchType(first.id);
        else { gw.group = g.id; renderGwNav(); }
      },
    }, [
      el('span', { class: 'gw-group-label', text: g.label }),
      el('span', { class: 'gw-group-count', text: fmtNum(n) }),
    ]));
  }
  nav.appendChild(gbar);

  const tbar = el('div', { class: 'gw-tabs' });
  for (const ty of gwTypesInGroup(gw.group)) {
    tbar.appendChild(el('button', {
      class: 'gw-tab' + (gw.type === ty.id ? ' active' : ''),
      title: t('{label}：{n} 条', { label: gwTypeLabel(ty), n: fmtNum(ty.count || 0) }),
      onclick: () => gwSwitchType(ty.id),
    }, [
      el('span', { class: 'gw-tab-icon', text: ty.icon }),
      el('span', { class: 'gw-tab-zh', text: gwTypeLabel(ty) }),
      el('span', { class: 'gw-tab-count', text: fmtNum(ty.count || 0) }),
    ]));
  }
  nav.appendChild(tbar);

  const wikiBtn = el('button', {
    class: 'gw-tab gw-tab-wiki',
    onclick: () => {
      const meta = gwTypeMeta(gw.type);
      showWikiPage(meta.wiki || (gw.index && gw.index.typeList[0] && gw.index.typeList[0].wiki) || 'Mod文件结构');
    },
    title: t('打开本地 EU4 wiki 中对应的修改教程'),
  }, [el('span', { class: 'gw-tab-icon', text: '📖' }), el('span', { class: 'gw-tab-zh', text: t('wiki 教程') })]);
  nav.appendChild(el('div', { class: 'gw-tabs gw-tabs-aux' }, [wikiBtn]));
}

/** Switch content type, optionally jumping straight to one item. */
function gwSwitchType(type, id) {
  gw.type = type;
  gw.file = null;
  gw.q = '';
  gw.card = null;
  const si = $('#gw-search'); if (si) si.value = '';
  renderGwNav();
  if (id) gw.queueCard = { type, id };
  gwLoadList(true);
  updateHash();
}

async function gwLoadList(reset) {
  const host = $('#gw-list');
  if (!host) return;
  if (reset) { gw.offset = 0; host.innerHTML = t('<div class="loading">载入中…</div>'); }

  const params = new URLSearchParams({
    type: gw.type, offset: String(gw.offset), limit: '120',
  });
  if (gw.q) params.set('q', gw.q);
  if (gw.file) params.set('file', gw.file);

  let data;
  try {
    data = await api(`/api/mod/${encodeURIComponent(gw.modId)}/game/list?${params}`);
  } catch (e) {
    host.innerHTML = '';
    host.appendChild(el('div', { class: 'error-box', text: t('载入失败: {msg}', { msg: e.message }) }));
    return;
  }

  gw.items = data.items || [];
  gw.total = data.total || 0;
  if (reset) host.innerHTML = '';

  if (reset && !gw.items.length) {
    host.appendChild(el('div', { class: 'loading', text: gw.q ? t('没有匹配的内容') : t('该类别没有内容') }));
  }
  for (const it of gw.items) host.appendChild(gwListItem(it));

  const more = $('#gw-list-more');
  if (more) {
    more.innerHTML = '';
    more.appendChild(el('span', {
      class: 'gw-count',
      text: t('已显示 {shown} / {total}', { shown: fmtNum(Math.min(gw.offset + gw.items.length, gw.total)), total: fmtNum(gw.total) }),
    }));
    if (gw.offset + gw.items.length < gw.total) {
      more.appendChild(el('button', {
        class: 'btn small',
        text: t('载入更多'),
        onclick: () => { gw.offset += gw.items.length; gwLoadList(false); },
      }));
    }
  }

  // Keep the panel useful: when the list resets and nothing suitable is open,
  // show the first entry.
  if (reset && !gw.queueCard && gw.items.length && (!gw.card || gw.card.type !== gw.type)) {
    gwOpenCard(gw.type, gw.items[0].id, false);
  }
  if (reset && gw.queueCard) {
    const q = gw.queueCard;
    gw.queueCard = null;
    gwOpenCard(q.type, q.id, false);
  }
}

function gwListItem(it) {
  const node = el('div', {
    class: 'gw-item' + (gw.card && gw.card.id === it.id && gw.card.type === gw.type ? ' active' : ''),
    onclick: () => gwOpenCard(gw.type, it.id, true),
  }, [
    el('div', { class: 'gw-item-title', text: it.title || it.id }),
    el('div', { class: 'gw-item-id', text: it.id }),
  ]);
  const tags = [];
  const meta = it.meta || {};
  if (meta.kindLabel) tags.push(meta.kindLabel);
  if (meta.eventType) tags.push(meta.eventType);
  if (meta.major) tags.push(t('重大决议'));
  if (meta.monarchPower) tags.push(meta.monarchPower);
  if (meta.national) tags.push(t('国家理念'));
  if (meta.slot) tags.push(t('槽位 {n}', { n: meta.slot }));
  if (meta.slots) tags.push(t('槽位 {n}', { n: meta.slots }));
  if (meta.missionCount) tags.push(t('{n} 个任务', { n: fmtNum(meta.missionCount) }));
  if (tags.length) {
    node.appendChild(el('div', { class: 'gw-item-tags' }, tags.map((tag) => el('span', { class: 'gw-tag', text: tag }))));
  }
  return node;
}

async function gwOpenCard(type, id, updateRoute) {
  gw.type = type;
  const col = $('#gw-card-col');
  if (!col) { gw.queueCard = { type, id }; return; }
  col.innerHTML = t('<div class="loading">正在生成游戏内视图…</div>');
  renderGwNav();
  const list = $('#gw-list');
  if (list) {
    for (const n of list.children) n.classList.toggle('active', n.querySelector && n.querySelector('.gw-item-id') && n.querySelector('.gw-item-id').textContent === id);
  }

  let data;
  try {
    data = await api(`/api/mod/${encodeURIComponent(gw.modId)}/game/card?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  } catch (e) {
    col.innerHTML = '';
    col.appendChild(el('div', { class: 'error-box', text: t('生成失败: {msg}', { msg: e.message }) }));
    return;
  }
  gw.card = data.card;
  col.innerHTML = '';
  col.appendChild(gwCardHeader(data.card));
  col.appendChild(gwRenderCard(data.card));
  col.appendChild(gwLocTable(data.card));
  col.scrollTop = 0;
  if (updateRoute) updateHash();
}

/* ------------------------------------------------------------------ *
 * Card chrome
 * ------------------------------------------------------------------ */

function gwCardHeader(card) {
  const meta = gwTypeMeta(card.type);
  const head = el('div', { class: 'gw-card-head' }, [
    el('span', { class: 'gw-card-kind', text: `${meta.icon || '📄'} ${gwTypeLabel(meta)}` }),
    el('code', { class: 'gw-card-id', text: card.id }),
  ]);
  head.appendChild(el('div', { class: 'gw-card-file' }, [
    el('a', {
      href: '#',
      text: card.file + ':' + (card.sourceLine || card.line || 1),
      title: t('打开脚本源文件'),
      onclick: (e) => { e.preventDefault(); openFile(card.file); },
    }),
  ]));
  return head;
}

/** Which renderer to use, keyed by content type. */
function gwRenderCard(card) {
  switch (card.type) {
    case 'events': return gwEventCard(card);
    case 'decisions': return gwDecisionCard(card);
    case 'idea_groups':
    case 'national_ideas': return gwIdeaCard(card);
    case 'advisors': return gwAdvisorCard(card);
    case 'policies': return gwPolicyCard(card);
    default: return gwGenericCard(card);
  }
}

function gwTitleText(card) {
  return card.title || card.name || null;
}

function gwField(label, child, cls) {
  return el('div', { class: 'gw-field ' + (cls || '') }, [
    el('div', { class: 'gw-field-label', text: label }),
    el('div', { class: 'gw-field-body' }, [child]),
  ]);
}

function gwMissing(key) {
  return el('span', { class: 'gw-missing', title: t('本地化键 {key} 在模组与原版本地化中都不存在，游戏里会显示这个键名本身', { key }), text: key });
}

/** Section heading used by the generic renderer. */
function gwGroupHead(text) {
  return el('div', { class: 'gw-group-head', text });
}

/* ------------------------------------------------------------------ *
 * Event window
 * ------------------------------------------------------------------ */

function gwEventCard(card) {
  const win = el('div', { class: 'gw-win gw-event' });

  const head = el('div', { class: 'gw-event-head' });
  if (card.pictureUrl) {
    head.appendChild(el('div', { class: 'gw-event-pic' }, [
      el('img', { src: card.pictureUrl, alt: card.picture, loading: 'lazy' }),
      el('span', { class: 'gw-event-pic-name', text: card.picture }),
    ]));
  } else if (card.picture) {
    head.appendChild(el('div', { class: 'gw-event-pic missing' }, [
      el('span', { text: t('图片 {name}（未找到贴图文件）', { name: card.picture }) }),
    ]));
  }
  head.appendChild(el('h3', { class: 'gw-event-title' }, [
    gwTitleText(card) ? gwRich(card.title) : gwMissing(card.titleKey),
  ]));
  win.appendChild(head);

  const body = el('div', { class: 'gw-event-body' });
  if (card.desc) body.appendChild(el('p', { class: 'gw-event-desc' }, [gwRich(card.desc)]));
  else body.appendChild(el('p', { class: 'gw-event-desc' }, [gwMissing(card.descKey)]));

  const flags = [];
  flags.push(card.eventTypeZh || card.eventType);
  if (card.flags.fireOnlyOnce) flags.push(t('只触发一次'));
  if (card.flags.hidden) flags.push(t('隐藏事件'));
  if (card.flags.major) flags.push(t('重大事件'));
  if (card.flags.isTriggeredOnly) flags.push(t('仅由事件触发'));
  if (card.mtth) {
    // `days` / `months` / `years` are the game's own unit identifiers.
    flags.push(t('平均触发：{value} {unit}', {
      value: card.mtth.value,
      unit: t(({ days: '天', months: '月', years: '年' })[card.mtth.unit] || card.mtth.unit),
    }));
  }
  body.appendChild(el('div', { class: 'gw-flagrow' }, flags.map((f) => el('span', { class: 'gw-flag', text: f }))));
  win.appendChild(body);

  if (card.options && card.options.length) {
    const opts = el('div', { class: 'gw-options' });
    for (const o of card.options) {
      const opt = el('div', { class: 'gw-option' });
      opt.appendChild(el('div', { class: 'gw-option-name' }, [
        el('span', { class: 'gw-option-letter', text: '[' + o.letter + ']' }),
        o.name ? gwRich(o.name) : el('span', { class: 'gw-missing', text: t('（选项名缺失，游戏显示 "Ok"）') }),
      ]));
      if (o.effects && o.effects.length) {
        opt.appendChild(el('div', { class: 'gw-option-effects' }, [
          el('div', { class: 'gw-sub', text: t('效果（游戏中悬停选项时显示）') }),
          gwLines(o.effects),
        ]));
      }
      if (o.aiChance && o.aiChance.length) {
        opt.appendChild(el('div', { class: 'gw-option-ai' }, [
          el('div', { class: 'gw-sub', text: t('AI 选择权重') }),
          gwLines(o.aiChance),
        ]));
      }
      opts.appendChild(opt);
    }
    win.appendChild(opts);
  } else {
    win.appendChild(el('div', { class: 'gw-options' }, [el('div', { class: 'gw-empty', text: t('该事件没有可选项（游戏里会直接应用 immediate 效果）') })]));
  }

  const extra = el('div', { class: 'gw-extra' });
  if (card.conditions && card.conditions.length) {
    extra.appendChild(gwCollapsible(t('触发条件 trigger'), gwLines(card.conditions), false));
  }
  if (card.immediate && card.immediate.length) {
    extra.appendChild(gwCollapsible(t('立即效果 immediate'), gwLines(card.immediate), false));
  }
  if (card.after && card.after.length) {
    extra.appendChild(gwCollapsible(t('后续效果 after'), gwLines(card.after), false));
  }
  win.appendChild(extra);
  return win;
}

function gwCollapsible(label, body, open) {
  const wrap = el('div', { class: 'gw-collapse' + (open ? ' open' : '') });
  const head = el('button', { class: 'gw-collapse-head' }, [
    el('span', { class: 'gw-collapse-arrow', text: open ? '▾' : '▸' }),
    el('span', { text: label }),
  ]);
  const content = el('div', { class: 'gw-collapse-body' }, [body]);
  head.addEventListener('click', () => {
    const isOpen = wrap.classList.toggle('open');
    head.querySelector('.gw-collapse-arrow').textContent = isOpen ? '▾' : '▸';
  });
  wrap.appendChild(head);
  wrap.appendChild(content);
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

function gwDecisionCard(card) {
  const win = el('div', { class: 'gw-win gw-decision' });
  win.appendChild(el('div', { class: 'gw-dec-head' }, [
    el('span', { class: 'gw-dec-icon', text: '⚖️' }),
    el('h3', { class: 'gw-dec-title' }, [gwTitleText(card) ? gwRich(card.title) : gwMissing(card.titleKey)]),
    card.major ? el('span', { class: 'gw-flag major', text: t('重大决议') }) : null,
  ]));

  if (card.desc) win.appendChild(el('p', { class: 'gw-dec-desc' }, [gwRich(card.desc)]));
  else win.appendChild(el('p', { class: 'gw-dec-desc' }, [gwMissing(card.descKey)]));

  const grid = el('div', { class: 'gw-dec-grid' });
  grid.appendChild(gwField(t('可决议条件 potential'), gwLines(card.potential, { emptyText: t('无限制') }), 'cond'));
  grid.appendChild(gwField(t('允许决议 allow'), gwLines(card.allow, { emptyText: t('无额外条件') }), 'cond'));
  grid.appendChild(gwField(t('决议效果 effect'), gwLines(card.effect, { emptyText: t('无效果') }), 'eff'));
  win.appendChild(grid);

  if (card.aiWillDo && card.aiWillDo.length) {
    win.appendChild(gwCollapsible(t('AI 意愿 ai_will_do'), gwLines(card.aiWillDo), false));
  }
  return win;
}

/* ------------------------------------------------------------------ *
 * Idea group / national ideas
 * ------------------------------------------------------------------ */

function gwIdeaCard(card) {
  const win = el('div', { class: 'gw-win gw-ideas' });
  win.appendChild(el('div', { class: 'gw-idea-head' }, [
    el('h3', { class: 'gw-idea-title' }, [gwTitleText(card) ? gwRich(card.name) : gwMissing(card.nameKey)]),
    el('span', { class: 'gw-flag', text: card.isNational ? t('国家理念') : t('理念组') }),
  ]));

  const trad = el('div', { class: 'gw-idea-trads' });
  trad.appendChild(gwField(card.startName ? gwPlain(card.startName) : t('传统 start'), gwLines(card.traditions), 'mod'));
  trad.appendChild(gwField(card.bonusName ? gwPlain(card.bonusName) : t('雄心 bonus'), gwLines(card.ambition), 'mod'));
  win.appendChild(trad);

  if (card.trigger && card.trigger.length) {
    win.appendChild(gwCollapsible(t('解锁条件 trigger'), gwLines(card.trigger), false));
  }

  const list = el('div', { class: 'gw-idea-list' });
  card.ideas.forEach((idea, i) => {
    const row = el('div', { class: 'gw-idea' });
    row.appendChild(el('div', { class: 'gw-idea-slot', text: String(i + 1) }));
    const main = el('div', { class: 'gw-idea-main' });
    main.appendChild(el('div', { class: 'gw-idea-name' }, [
      idea.name ? gwRich(idea.name) : gwMissing(idea.nameKey),
    ]));
    if (idea.desc) main.appendChild(el('div', { class: 'gw-idea-desc' }, [gwRich(idea.desc)]));
    main.appendChild(gwLines(idea.mods));
    row.appendChild(main);
    row.appendChild(el('div', { class: 'gw-idea-key', text: idea.id }));
    list.appendChild(row);
  });
  win.appendChild(list);
  return win;
}

function gwPlain(nodes) {
  let s = '';
  for (const n of nodes || []) {
    if (n.k === 'br') continue;
    if (n.k === 'd') s += '[' + n.s + ']';
    else if (n.k === 'e') s += '$' + n.s + '$';
    else if (n.k === 'i') continue;
    else s += n.s || '';
  }
  return s;
}

/** Flatten localisation markup for compact table cells. */
function gwPlainRaw(s) {
  return String(s)
    .replace(/\u00a7./g, '')
    .replace(/\u00a3[^\u00a3]*\u00a3/g, '')
    .replace(/\\n/g, ' \u23ce ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text content of a rich-node array, for titles used as plain strings. */
function gwPlainNodes(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return gwPlain(v);
}

/* ------------------------------------------------------------------ *
 * Advisor
 * ------------------------------------------------------------------ */

function gwAdvisorCard(card) {
  const win = el('div', { class: 'gw-win gw-advisor' });
  const mp = card.monarchPower || '';
  win.appendChild(el('div', { class: 'gw-adv-head' }, [
    el('div', { class: 'gw-adv-portrait ' + (MP_CLASS[mp] || '') }, [
      el('span', { class: 'gw-adv-mp', text: mp || '—' }),
      el('span', { class: 'gw-adv-mpzh', text: gwMpLabel(mp) }),
    ]),
    el('div', { class: 'gw-adv-id' }, [
      el('h3', { class: 'gw-adv-name' }, [gwRich(card.name) || gwMissing(card.nameKey)]),
      el('div', { class: 'gw-adv-key', text: card.id }),
    ]),
  ]));

  if (card.desc) win.appendChild(el('p', { class: 'gw-adv-desc' }, [gwRich(card.desc)]));
  else win.appendChild(el('p', { class: 'gw-adv-desc' }, [gwMissing(card.descKey)]));

  win.appendChild(gwField(t('顾问效果'), gwLines(card.mods, { emptyText: t('无固定修正') }), 'mod'));

  const flags = [];
  if (card.allowOnlyMale === 'yes') flags.push(t('仅男性'));
  if (card.allowOnlyFemale === 'yes') flags.push(t('仅女性'));
  if (flags.length) win.appendChild(el('div', { class: 'gw-flagrow' }, flags.map((f) => el('span', { class: 'gw-flag', text: f }))));

  if (card.skillScaled && card.skillScaled.length) {
    const box = el('div', { class: 'gw-adv-scaled' }, [el('div', { class: 'gw-sub', text: t('随顾问等级缩放的修正（skill_scaled_modifier）') })]);
    card.skillScaled.forEach((s, i) => {
      const item = el('div', { class: 'gw-adv-scaled-item' });
      item.appendChild(el('div', { class: 'gw-sub', text: t('条件 {n}', { n: i + 1 }) }));
      item.appendChild(gwLines(s.trigger, { emptyText: t('无条件') }));
      item.appendChild(el('div', { class: 'gw-sub', text: t('修正') }));
      item.appendChild(gwLines(s.mods, { emptyText: t('无') }));
      box.appendChild(item);
    });
    win.appendChild(gwCollapsible(t('等级缩放修正'), box, false));
  }
  if (card.chance && card.chance.length) {
    win.appendChild(gwCollapsible(t('出现概率 chance'), gwLines(card.chance), false));
  }
  return win;
}

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

function gwPolicyCard(card) {
  const win = el('div', { class: 'gw-win gw-policy' });
  const mp = card.monarchPower || '';
  win.appendChild(el('div', { class: 'gw-pol-head' }, [
    el('span', { class: 'gw-pol-mp ' + (MP_CLASS[mp] || ''), text: mp || '—', title: gwMpLabel(mp) }),
    el('h3', { class: 'gw-pol-title' }, [gwRich(card.name) || gwMissing(card.nameKey)]),
  ]));
  if (card.desc) win.appendChild(el('p', { class: 'gw-pol-desc' }, [gwRich(card.desc)]));
  else win.appendChild(el('p', { class: 'gw-pol-desc' }, [gwMissing(card.descKey)]));

  win.appendChild(gwField(t('政策效果'), gwLines(card.mods, { emptyText: t('无修正') }), 'mod'));
  const grid = el('div', { class: 'gw-dec-grid' });
  grid.appendChild(gwField(t('解锁条件 potential'), gwLines(card.potential, { emptyText: t('无') }), 'cond'));
  grid.appendChild(gwField(t('允许激活 allow'), gwLines(card.allow, { emptyText: t('无') }), 'cond'));
  win.appendChild(grid);
  return win;
}

/* ------------------------------------------------------------------ *
 * Generic card
 *
 * Everything the server does not model bespoke arrives as a flat list of
 * groups. Each role has exactly one renderer, so a new content type on the
 * server needs no new client code.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Mission trees
 *
 * The grid is the game's own layout: one column per `slot`, one row per
 * `position`, cells 104×152 with the arrow band in the bottom 30px. The arrow
 * pieces are the game's `gfx_arrow_*` sprites, placed at the offsets the mod's
 * own `countrymissionsview.gui` gives them — so a mod that resizes its mission
 * panel renders at that size, and nothing here is a redrawn approximation.
 * ------------------------------------------------------------------ */

/** One absolutely-positioned sprite. Frame strips are cropped to their first frame. */
function gwSpriteBox(info, x, y, w, h) {
  const box = el('span', { class: 'gw-msprite' });
  box.style.left = x + 'px';
  box.style.top = y + 'px';
  if (!info || !info.url) { box.classList.add('gw-msprite-none'); return box; }
  if (w) box.style.width = w + 'px';
  if (h) box.style.height = h + 'px';
  // `gfx_mission_effect` is a 3-frame strip; the box clips it to frame 0.
  if (info.frames > 1) box.classList.add('gw-msprite-clip');
  box.appendChild(el('img', { src: info.url, alt: '', loading: 'lazy' }));
  return box;
}

function gwMissionCell(m, cell, gui, art, cellW, cellH, selected, stack) {
  const box = el('div', {
    class: 'gw-mcell'
      + (m.id === selected ? ' selected' : '')
      + (cell.conflict ? ' conflict' : '')
      + (m.missingIcon ? ' noicon' : ''),
  });
  // Two missions can share a slot and a position (this mod has three at once), so
  // a conflicting cell fans them out instead of hiding all but one.
  const shift = stack * 7;
  box.style.left = (((cell.slot - 1) * cellW) + shift) + 'px';
  box.style.top = ((cell.row - 1) * cellH) + 'px';
  box.style.width = cellW + 'px';
  box.style.height = cellH + 'px';
  if (shift) box.style.zIndex = String(2 + stack);
  box.title = m.title + '\n' + m.id;

  box.appendChild(gwSpriteBox(art.frame, 0, 0, 103, 123));
  if (m.iconUrl) {
    box.appendChild(gwSpriteBox(
      { url: m.iconUrl, frames: 1 },
      (gui.icon && gui.icon.x) || 22, (gui.icon && gui.icon.y) || 20, 59, 63,
    ));
  }
  if (art.trigger && m.hasTrigger) {
    box.appendChild(gwSpriteBox(art.trigger, (gui.trigger && gui.trigger.x) || 0, (gui.trigger && gui.trigger.y) || 7, 33, 33));
  }
  if (art.effect && m.hasEffect) {
    box.appendChild(gwSpriteBox(art.effect, (gui.effect && gui.effect.x) || 70, (gui.effect && gui.effect.y) || 7, 33, 33));
  }

  const title = el('div', { class: 'gw-mtitle', text: m.title });
  title.style.left = ((gui.title && gui.title.x) || 8) + 'px';
  title.style.top = ((gui.title && gui.title.y) || 84) + 'px';
  title.style.width = ((gui.title && gui.title.w) || 90) + 'px';
  box.appendChild(title);

  if (m.id !== selected) {
    box.addEventListener('click', () => gwOpenCard('missions', m.id, true));
  }
  return box;
}

/** The whole tree as the game would show it, plus notes about what the mod got wrong. */
function gwMissionTree(card) {
  const grid = card.grid;
  if (!grid || !grid.cells) return null;
  const gui = grid.gui || {};
  const art = grid.art || {};
  const cellW = gui.cellW || 104;
  const cellH = gui.cellH || 152;
  const cols = Math.max(1, grid.columns || 1);
  const rows = Math.max(1, grid.rows || 1);
  const selected = card.selectedId || null;
  let missions = 0;
  for (const c of grid.cells) missions += c.missions.length;

  const wrap = el('div', { class: 'gw-mtree-wrap' });

  const head = el('div', { class: 'gw-mtree-head' });
  head.appendChild(el('span', { class: 'gw-mtree-name', text: card.treeName || card.treeFile || '' }));
  for (const tag of card.treeTags || []) head.appendChild(el('span', { class: 'gw-mtag', text: tag }));
  for (const dlc of card.treeDlc || []) head.appendChild(el('span', { class: 'gw-mtag gw-mtag-dlc', text: dlc }));
  head.appendChild(el('span', {
    class: 'gw-mtree-stat',
    text: t('{cols} 列 · {rows} 行 · {n} 个任务', { cols: fmtNum(cols), rows: fmtNum(rows), n: fmtNum(missions) }),
  }));
  if (gui.source) {
    const src = el('span', { class: 'gw-mtree-src', text: t('版式来自游戏 GUI') });
    src.title = gui.source;
    head.appendChild(src);
  }
  wrap.appendChild(head);

  const scroll = el('div', { class: 'gw-mtree-scroll' });
  const board = el('div', { class: 'gw-mtree' });
  // Backplates only for the columns we are willing to draw (capped at 11), but
  // the board is wide enough for every slot the script actually used.
  const boardCols = Math.max(cols, grid.boardColumns || cols);
  board.style.width = (boardCols * cellW) + 'px';
  board.style.height = (rows * cellH) + 'px';

  // Empty slot backplates, so the grid reads as the game's grid.
  for (let r = 1; r <= rows; r++) {
    for (let s = 1; s <= cols; s++) {
      const plate = el('div', { class: 'gw-mplate' });
      plate.style.left = ((s - 1) * cellW) + 'px';
      plate.style.top = ((r - 1) * cellH) + 'px';
      plate.style.width = cellW + 'px';
      plate.style.height = cellH + 'px';
      board.appendChild(plate);
    }
  }

  // Arrows go under the missions they connect.
  for (const a of grid.arrows || []) {
    const piece = gwSpriteBox({ url: a.url, frames: 1 }, (a.slot - 1) * cellW + a.x, (a.row - 1) * cellH + a.y);
    piece.classList.add('gw-marrow');
    // A reversed prerequisite gets the same head turned over.
    if (a.flip === 'v') piece.classList.add('gw-mflipv');
    board.appendChild(piece);
  }

  for (const cell of grid.cells) {
    cell.missions.forEach((m, i) => {
      board.appendChild(gwMissionCell(m, cell, gui, art, cellW, cellH, selected, i));
    });
  }
  scroll.appendChild(board);
  wrap.appendChild(scroll);

  const notes = [];
  if (grid.truncated) {
    notes.push(t('该任务树过大，仅显示前 {n} 个格子', { n: fmtNum(grid.cells.length) }));
  }
  if (grid.missingPrereqs && grid.missingPrereqs.length) {
    notes.push(t('有 {n} 条前置指向本树之外的任务：{list}', {
      n: fmtNum(grid.missingPrereqs.length),
      list: grid.missingPrereqs.slice(0, 6).map((x) => x.to).join(', '),
    }));
  }
  if (grid.reversedLinks && grid.reversedLinks.length) {
    notes.push(t('有 {n} 条前置指向下方任务，箭头贴图已翻转表示', { n: fmtNum(grid.reversedLinks.length) }));
  }
  if (grid.sameCellLinks && grid.sameCellLinks.length) {
    notes.push(t('有 {n} 条前置指向同一格内的任务，无法画出方向', { n: fmtNum(grid.sameCellLinks.length) }));
  }
  const conflicts = (grid.cells || []).filter((c) => c.conflict).length;
  if (conflicts) {
    notes.push(t('有 {n} 个格子被两个任务占用（slot 与 position 冲突）', { n: fmtNum(conflicts) }));
  }
  if (grid.missingSprites) {
    notes.push(t('有 {n} 个贴图无法从游戏目录解析', { n: fmtNum(grid.missingSprites) }));
  }
  if (grid.beyondCap && grid.beyondCap.length) {
    notes.push(t('该任务树用到槽位 {list}，超出上限 {cap} 列，已按原槽位摆放', {
      list: grid.beyondCap.join(', '), cap: fmtNum(11),
    }));
  }
  for (const n of notes) wrap.appendChild(el('div', { class: 'gw-note', text: n }));

  return wrap;
}

/** A tree's missions as clickable rows, for finding one by name. */
function gwMissionList(missions) {
  const wrap = el('div', { class: 'gw-chips' });
  for (const m of missions) {
    const chip = el('span', { class: 'gw-chip gw-link' }, [
      el('span', { text: m.title }),
      el('code', { class: 'gw-chip-id', text: 'slot ' + m.slot + ' · pos ' + m.position }),
    ]);
    chip.title = m.id;
    chip.addEventListener('click', () => gwOpenCard('missions', m.id, true));
    wrap.appendChild(chip);
  }
  return wrap;
}

function gwGenericCard(card) {
  const win = el('div', { class: 'gw-win gw-generic' });

  // --- title row
  const head = el('div', { class: 'gw-gen-head' });
  if (card.spriteUrl) {
    head.appendChild(el('img', {
      class: 'gw-gen-icon', src: card.spriteUrl, alt: card.spriteName || '', loading: 'lazy',
      onerror: (e) => { e.target.style.display = 'none'; },
    }));
  }
  const title = card.name
    ? gwRich(card.name)
    : (card.synthName
      ? document.createTextNode(gwPick(card.synthName))
      : gwMissing(card.nameKey || card.id));
  head.appendChild(el('h3', { class: 'gw-gen-title' }, [title]));
  if (card.kindLabel) head.appendChild(el('span', { class: 'gw-flag', text: card.kindLabel }));
  win.appendChild(head);

  // --- description
  if (card.desc) win.appendChild(el('p', { class: 'gw-gen-desc' }, [gwRich(card.desc)]));
  else if (card.descKey) win.appendChild(el('p', { class: 'gw-gen-desc' }, [gwMissing(card.descKey)]));

  // --- cross-references the script names
  if (card.links && card.links.length) {
    const row = el('div', { class: 'gw-links' }, [el('span', { class: 'gw-links-label', text: t('关联内容：') })]);
    for (const l of card.links) {
      const chip = el('span', { class: 'gw-chip gw-link', text: l.label || l.id });
      chip.title = t('{kind}：{id}（点击查看）', { kind: l.kind, id: l.id });
      chip.addEventListener('click', () => gwFollow({ kind: l.kind, id: l.id }));
      row.appendChild(chip);
    }
    win.appendChild(row);
  }

  // --- unit stat table
  if (card.stats && card.stats.length) win.appendChild(gwUnitStats(card.stats));

  // --- settings table
  if (card.fields && card.fields.length) win.appendChild(gwFieldTable(card.fields));

  // --- every other group
  for (const g of card.groups || []) win.appendChild(gwGroupBlock(g));

  // --- the mission tree, drawn with the game's own geometry and arrow sprites
  if (card.grid) {
    const tree = gwMissionTree(card);
    if (tree) win.appendChild(tree);
    if (card.treeConditions && card.treeConditions.length) {
      win.appendChild(gwCollapsible(t('该任务树生效条件 potential'), gwLines(card.treeConditions), false));
    }
  }

  // --- a tree also lists its missions, so one can be found by name
  if (card.missions && card.missions.length) {
    win.appendChild(gwCollapsible(
      t('该任务树中的任务（共 {n} 个）', { n: fmtNum(card.missions.length) }),
      gwMissionList(card.missions),
      card.missions.length <= 24,
    ));
  }

  // --- history timeline
  if (card.timeline && card.timeline.length) win.appendChild(gwTimeline(card.timeline, card.timelineTruncated));

  // --- GUI widget tree
  if (card.widgets) win.appendChild(gwWidgetTree(card.widgets));

  return win;
}

/** A unit's three-by-two stat table plus its movement allowance. */
function gwUnitStats(stats) {
  const box = el('div', { class: 'gw-gblock gw-role-stats' });
  box.appendChild(gwGroupHead(t('兵种属性')));
  const byKey = {};
  for (const s of stats) byKey[s.key] = s.value;
  const val = (k) => (byKey[k] !== undefined ? byKey[k] : '—');
  const table = el('table', { class: 'wikitable gw-stats-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('阶段') }),
    el('th', { text: t('进攻') }),
    el('th', { text: t('防御') }),
  ])]));
  table.appendChild(el('tbody', {}, [
    el('tr', {}, [el('th', { text: t('士气') }), el('td', { class: 'gw-num', text: val('offensive_morale') }), el('td', { class: 'gw-num', text: val('defensive_morale') })]),
    el('tr', {}, [el('th', { text: t('火力') }), el('td', { class: 'gw-num', text: val('offensive_fire') }), el('td', { class: 'gw-num', text: val('defensive_fire') })]),
    el('tr', {}, [el('th', { text: t('冲击') }), el('td', { class: 'gw-num', text: val('offensive_shock') }), el('td', { class: 'gw-num', text: val('defensive_shock') })]),
    el('tr', {}, [
      el('th', { text: t('机动') }),
      el('td', { class: 'gw-num', colspan: '2', text: val('maneuver') }),
    ]),
  ]));
  box.appendChild(table);
  return box;
}

/** One generic group, dispatched by role. */
function gwGroupBlock(g) {
  const box = el('div', { class: 'gw-gblock gw-role-' + g.role });
  box.appendChild(gwGroupHead(g.label || g.key));
  if (g.role === 'mod') box.appendChild(gwLines(g.lines, { emptyText: t('无修正') }));
  else if (g.role === 'cond') box.appendChild(gwLines(g.lines, { emptyText: t('无条件') }));
  else if (g.role === 'eff') box.appendChild(gwLines(g.lines, { emptyText: t('无效果') }));
  else if (g.role === 'weight') box.appendChild(gwLines(g.lines, { emptyText: t('无权重设置') }));
  else if (g.role === 'list') box.appendChild(gwItemList(g.items));
  else if (g.role === 'entries') box.appendChild(gwEntryList(g.items));
  else if (g.role === 'blocks') box.appendChild(gwBlocks(g.items));
  else if (g.role === 'fields') box.appendChild(gwFieldTable(g.fields));
  else if (g.role === 'raw') box.appendChild(gwRawRows(g.rows));
  return box;
}

/** A settings table: label + value, with colour swatches and yes/no tones. */
function gwFieldTable(fields) {
  const table = el('table', { class: 'wikitable gw-fields-table' });
  const tbody = el('tbody');
  for (const f of fields) {
    const tr = el('tr', {}, [el('th', { text: f.label || f.key })]);
    const td = el('td');
    if (f.tone === 'color' && f.color) {
      td.appendChild(el('span', {
        class: 'gw-swatch',
        style: `background:rgb(${f.color.r},${f.color.g},${f.color.b})`,
        title: f.value,
      }));
      td.appendChild(el('code', { class: 'gw-num', text: f.value }));
    } else if (f.tone === 'yes' || f.tone === 'no') {
      td.appendChild(el('span', { class: 'gw-bool gw-' + f.tone, text: f.tone === 'yes' ? '✓' : '✗' }));
      td.appendChild(el('span', { text: ' ' + f.value }));
    } else {
      td.appendChild(el('span', { class: f.tone === 'num' ? 'gw-num' : '', text: String(f.value) }));
    }
    if (!f.label || f.label === f.key) tr.title = t('该键不在中文词表中，按脚本原样显示');
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/** Reference chips: `enable = { … }`, estate privileges, age abilities. */
function gwItemList(items) {
  const wrap = el('div', { class: 'gw-chips' });
  const list = items || [];
  const shown = list.length > GW_LIST_CAP ? list.slice(0, GW_LIST_CAP) : list;
  for (const it of shown) wrap.appendChild(gwChip(it));
  if (list.length > shown.length) {
    wrap.appendChild(el('button', {
      class: 'btn small ghost gw-more',
      text: t('显示全部 {n} 条', { n: fmtNum(list.length) }),
      onclick: (e) => {
        const btn = e.currentTarget;
        const parent = btn.parentNode;
        parent.removeChild(btn);
        for (const it of list.slice(shown.length)) parent.appendChild(gwChip(it));
      },
    }));
  }
  return wrap;
}

function gwChip(it) {
  const cls = 'gw-chip'
    + (it.link ? ' gw-link' : '')
    + (it.state === 'no' || it.state === 'false' ? ' gw-off' : '');
  const chip = el('span', { class: cls });
  const nameNodes = gwNodes(it.name);
  if (nameNodes) chip.appendChild(nameNodes);
  else chip.appendChild(el('span', { text: it.id }));
  const nameText = gwPlainNodes(it.name);
  if (it.id && nameText !== it.id) chip.appendChild(el('code', { class: 'gw-chip-id', text: it.id }));
  if (it.weight) chip.appendChild(el('span', { class: 'gw-chip-w', text: '×' + it.weight }));
  if (it.note) chip.appendChild(el('span', { class: 'gw-chip-note', text: it.note }));
  if (it.link) {
    chip.title = t('{kind}：{id}（点击查看）', { kind: it.link.kind, id: it.link.id });
    chip.addEventListener('click', () => gwFollow(it.link));
  }
  return chip;
}

/** Repeated records with their own name, value and conditions (estates, ages). */
function gwEntryList(items) {
  const wrap = el('div', { class: 'gw-records' });
  for (const it of items) {
    const row = el('div', { class: 'gw-record' });
    const head = el('div', { class: 'gw-record-head' });
    const nameNodes = gwNodes(it.name);
    if (nameNodes) head.appendChild(nameNodes);
    else if (it.id) head.appendChild(el('span', { class: 'gw-record-id', text: it.id }));
    if (it.value !== null && it.value !== undefined) {
      head.appendChild(el('span', { class: 'gw-record-val', text: String(it.value) }));
    }
    if (it.nameKey && !nameNodes) head.appendChild(gwMissing(it.nameKey));
    row.appendChild(head);
    if (it.fields && it.fields.length) row.appendChild(gwFieldTable(it.fields));
    for (const g of it.groups || []) row.appendChild(gwGroupBlock(g));
    if (it.lines && it.lines.length) row.appendChild(gwLines(it.lines));
    wrap.appendChild(row);
  }
  return wrap;
}

/** Repeated definition blocks such as a great project's tiers. */
function gwBlocks(items) {
  const wrap = el('div', { class: 'gw-blocks' });
  for (const it of items) {
    const box = el('div', { class: 'gw-block' });
    box.appendChild(el('div', { class: 'gw-block-head', text: it.id }));
    if (it.fields && it.fields.length) box.appendChild(gwFieldTable(it.fields));
    for (const g of it.groups || []) box.appendChild(gwGroupBlock(g));
    wrap.appendChild(box);
  }
  return wrap;
}

/** The script exactly as written, for blocks the glossary cannot phrase. */
function gwRawRows(rows) {
  const pre = el('pre', { class: 'gw-raw-block', title: t('游戏内不会显示原始脚本，这里原样保留以便核对') });
  for (const r of rows || []) {
    const line = el('div', { style: `padding-left:${(r.i || 0) * 14}px` });
    if (r.k) {
      line.appendChild(el('span', { class: 'gw-raw-key', text: r.k }));
      if (r.v !== '' && r.v !== undefined) {
        line.appendChild(el('span', { class: 'gw-raw-eq', text: ' = ' }));
        line.appendChild(el('span', { class: 'gw-raw-val', text: String(r.v) }));
      }
    } else if (r.v !== '' && r.v !== undefined) {
      line.appendChild(el('span', { class: 'gw-raw-val', text: String(r.v) }));
    } else {
      line.appendChild(el('span', { class: 'gw-raw-key', text: '{ }' }));
    }
    pre.appendChild(line);
  }
  return pre;
}

/** A country's dated history, oldest first. */
function gwTimeline(timeline, truncated) {
  const box = el('div', { class: 'gw-timeline' });
  box.appendChild(gwGroupHead(truncated
    ? t('历史时间线（{n} 条，已截断）', { n: fmtNum(timeline.length) })
    : t('历史时间线（{n} 条）', { n: fmtNum(timeline.length) })));
  timeline.forEach((e, i) => {
    const row = el('div', { class: 'gw-tl-row' + (i >= GW_TIMELINE_CAP ? ' gw-tl-hidden' : '') });
    row.appendChild(el('div', { class: 'gw-tl-date', text: e.date }));
    row.appendChild(el('div', { class: 'gw-tl-body' }, [gwLines(e.lines)]));
    box.appendChild(row);
  });
  if (timeline.length > GW_TIMELINE_CAP) {
    box.appendChild(el('button', {
      class: 'btn small ghost',
      text: t('显示全部 {n} 条', { n: fmtNum(timeline.length) }),
      onclick: (ev) => {
        for (const n of box.querySelectorAll('.gw-tl-hidden')) n.classList.remove('gw-tl-hidden');
        ev.currentTarget.remove();
      },
    }));
  }
  return box;
}

/** The widget tree of one GUI window. */
function gwWidgetTree(widget) {
  const box = el('div', { class: 'gw-widgets' });
  let count = 0;
  const walk = (w, depth) => {
    if (!w || count++ > 400) return null;
    const node = el('div', { class: 'gw-widget', style: `padding-left:${depth * 14}px` });
    node.appendChild(el('span', { class: 'gw-widget-type', text: w.type }));
    if (w.name) node.appendChild(el('span', { class: 'gw-widget-name', text: w.name }));
    for (const f of w.fields || []) {
      node.appendChild(el('span', { class: 'gw-widget-field', text: f.key + '=' + f.value }));
    }
    const kids = el('div');
    for (const k of w.children || []) {
      const kn = walk(k, depth + 1);
      if (kn) kids.appendChild(kn);
    }
    const wrap = el('div');
    wrap.appendChild(node);
    wrap.appendChild(kids);
    return wrap;
  };
  const tree = walk(widget, 0);
  box.appendChild(gwGroupHead(t('GUI 控件树')));
  if (tree) box.appendChild(tree);
  box.appendChild(el('div', { class: 'gw-note', text: t('这是游戏加载该窗口时构建的控件层级；位置与尺寸为界面文件中的原始数值。') }));
  return box;
}

/* ------------------------------------------------------------------ *
 * Script ↔ localisation correspondence table
 * ------------------------------------------------------------------ */

function gwLocTable(card) {
  const refs = card.locRefs || [];
  const found = refs.filter((r) => r.found).length;
  const wrap = el('div', { class: 'gw-loc' });
  wrap.appendChild(el('div', { class: 'gw-sub', text: t('脚本 ↔ 本地化对照（{found}/{total} 个键已解析）', { found, total: refs.length }) }));
  const table = el('table', { class: 'wikitable gw-loc-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', { text: t('脚本字段') }),
    el('th', { text: t('本地化键') }),
    el('th', { text: t('游戏显示的文本') }),
    el('th', { text: t('来源文件') }),
  ])]));
  const tbody = el('tbody');
  for (const r of refs) {
    const tr = el('tr', { class: r.found ? '' : 'gw-loc-miss' });
    tr.appendChild(el('td', { class: 'k', text: r.field }));
    tr.appendChild(el('td', { class: 'k', text: r.key }));
    const shown = r.found ? gwPlainRaw(String(r.value)).slice(0, 220) : t('（未找到，游戏显示键名本身）');
    tr.appendChild(el('td', { class: 'v', text: shown, title: r.found ? String(r.value) : '' }));
    tr.appendChild(el('td', {
      class: 'gw-loc-src',
      html: r.found
        ? `<a href="#" data-file="${escapeHtml(r.file)}">${escapeHtml(r.file)}:${r.line}</a>${r.origin === 'vanilla' ? ' <span class="gw-tag">' + t('原版') + '</span>' : ''}`
        : '—',
    }));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  wrap.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-file]');
    if (!a) return;
    e.preventDefault();
    openFile(a.getAttribute('data-file'));
  });
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Language switching
 *
 * Re-render the hub in the new language. Switching must never throw when
 * the game view is not on screen, when no mod is selected, or when the
 * content index has not been built yet — renderGameHub() itself only needs
 * `state.current` and `gw.type`, and it reuses a cached index.
 * ------------------------------------------------------------------ */

if (window.I18N) {
  I18N.onChange(() => {
    if (!gw.modId || typeof gw.type !== 'string') return;
    if (!document.getElementById('gw-nav')) return;   // game view is not on screen
    // The tab labels and the group names come from the server, so the index has
    // to be re-fetched in the new language before the nav is redrawn.
    gw.index = null;
    renderGameHub({ type: gw.type, file: gw.file }).catch(() => {});
  });
}