'use strict';
/**
 * Settings dialog and server-side folder picker.
 *
 * Owns:
 *   - the header language switch
 *   - the settings dialog (language, local/online wiki, directory overrides)
 *   - a folder picker backed by `GET /api/fs/list`, because a browser cannot
 *     hand the server a path from the client machine
 *
 * Everything is plain DOM so the project stays dependency-free. The UI is
 * rebuilt from state on every language change rather than patched in place.
 */
(function () {
  const S = {
    open: false,
    busy: false,
    loaded: false,
    cfg: null, // the settings object being edited
    meta: null, // detected directories, wiki status, version
    configPath: '',
    status: null, // { kind: 'ok'|'err', text }
    picker: null, // { target, path, listing, selected }
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /** Small element builder; mirrors the one in app.js but stays local. */
  function e(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  /** fetch() with the active language attached, so server text matches the UI. */
  async function api(path, opts) {
    const url = path + (path.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(I18N.getLang());
    const res = await fetch(url, opts);
    let body = null;
    try {
      body = await res.json();
    } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error((body && body.error) || res.statusText);
    return body;
  }

  // -------------------------------------------------------------------------
  // Language switch
  // -------------------------------------------------------------------------

  function renderLangButton() {
    const btn = $('#lang-btn');
    if (!btn) return;
    const next = I18N.getLang() === 'zh' ? 'en' : 'zh';
    btn.textContent = I18N.LANG_NAMES[next];
    btn.title = I18N.getLang() === 'zh'
      ? 'Switch to English / 切换到英文'
      : '切换到中文 / Switch to Chinese';
  }

  /** Switch language everywhere: UI, storage, and the server-side default. */
  async function switchLang(next) {
    I18N.setLang(next);
    try { localStorage.setItem('eu4mv.lang', next); } catch { /* private mode */ }
    I18N.applyStatic(document);
    renderLangButton();
    if (S.open) render();
    // Persist so the console launcher and fresh sessions agree. A failure here
    // is not fatal: the UI already switched, every request carries ?lang=.
    try {
      const r = await api('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      });
      if (r && r.config) S.cfg = r.config;
    } catch { /* keep going with the client-side choice */ }
  }

  // -------------------------------------------------------------------------
  // Dialog scaffolding
  // -------------------------------------------------------------------------

  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = e('div', { class: 'set-overlay', id: 'set-overlay', hidden: 'hidden' });
    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) close();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function close() {
    S.open = false;
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('set-open');
  }

  function open() {
    S.open = true;
    ensureOverlay();
    overlay.hidden = false;
    document.body.classList.add('set-open');
    if (!S.loaded) load().catch(() => { /* render() shows the error */ });
    else render();
  }

  async function load() {
    const data = await api('/api/config');
    S.cfg = data.config;
    S.meta = data;
    S.configPath = data.configPath;
    S.loaded = true;
    render();
  }

  // -------------------------------------------------------------------------
  // Field helpers
  // -------------------------------------------------------------------------

  function row(label, control, hint) {
    return e('div', { class: 'set-row' }, [
      e('label', { class: 'set-label', text: label }),
      e('div', { class: 'set-control' }, [control, hint ? e('div', { class: 'set-hint', text: hint }) : null]),
    ]);
  }

  function checkbox(checked, onChange) {
    const input = e('input', { type: 'checkbox' });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function textInput(value, placeholder, onChange) {
    const input = e('input', { type: 'text', class: 'set-input', placeholder: placeholder || '' });
    input.value = value || '';
    input.addEventListener('input', () => onChange(input.value));
    return input;
  }

  /** A text input paired with the picker / detect / validate buttons. */
  function pathRow(label, value, opts) {
    const wrap = e('div', { class: 'set-pathrow' });
    const input = textInput(value, opts.placeholder, (v) => { opts.onChange(v); });
    const buttons = e('div', { class: 'set-pathbtns' }, [
      e('button', {
        class: 'btn small ghost', type: 'button', text: I18N.t('浏览…'),
        onclick: () => openPicker(opts.target),
      }),
      opts.onDetect
        ? e('button', {
            class: 'btn small ghost', type: 'button', text: I18N.t('自动检测'),
            onclick: () => opts.onDetect(),
          })
        : null,
      opts.onValidate
        ? e('button', {
            class: 'btn small ghost', type: 'button', text: I18N.t('验证'),
            onclick: () => opts.onValidate(input.value),
          })
        : null,
    ]);
    wrap.appendChild(input);
    wrap.appendChild(buttons);
    return e('div', { class: 'set-row' }, [
      e('label', { class: 'set-label', text: label }),
      e('div', { class: 'set-control' }, [wrap]),
    ]);
  }

  function statusLine() {
    if (!S.status) return null;
    return e('div', {
      class: 'set-status ' + (S.status.kind === 'ok' ? 'ok' : 'err'),
      text: S.status.text,
    });
  }

  function setStatus(kind, text) {
    S.status = { kind, text };
    render();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function render() {
    ensureOverlay();
    if (!S.cfg) {
      overlay.innerHTML = '';
      overlay.appendChild(e('div', { class: 'set-dialog' }, [
        e('div', { class: 'set-head' }, [e('h2', { text: I18N.t('设置') })]),
        e('div', { class: 'set-body' }, [e('div', { class: 'loading', text: I18N.t('正在载入…') })]),
      ]));
      return;
    }

    const cfg = S.cfg;
    const meta = S.meta || { detected: {}, current: {}, wiki: {}, languages: [] };

    const body = e('div', { class: 'set-body' });

    // --- language ----------------------------------------------------------
    const langSelect = e('select', { class: 'set-input set-select' });
    for (const l of (meta.languages && meta.languages.length ? meta.languages : [
      { id: 'zh', label: I18N.t('中文') }, { id: 'en', label: 'English' },
    ])) {
      const opt = e('option', { value: l.id, text: l.label });
      if (cfg.language === l.id) opt.selected = true;
      langSelect.appendChild(opt);
    }
    langSelect.addEventListener('change', () => switchLang(langSelect.value));
    body.appendChild(e('h3', { class: 'set-h3', text: I18N.t('界面语言') }));
    body.appendChild(row(I18N.t('语言'), langSelect,
      I18N.t('语言会同时应用到网页界面、控制台输出和这里的设置项。')));

    // --- local wiki --------------------------------------------------------
    const wl = cfg.wiki.local;
    body.appendChild(e('h3', { class: 'set-h3', text: I18N.t('本地中文 Wiki') }));
    body.appendChild(row(
      I18N.t('启用'),
      checkbox(wl.enabled, (v) => { wl.enabled = v; render(); }),
      I18N.t('把相关 wiki 链接指向本地离线中文 wiki。'),
    ));
    if (wl.enabled) {
      body.appendChild(pathRow(I18N.t('离线 wiki 目录'), wl.dir, {
        target: 'wiki.local.dir',
        placeholder: 'F:\\20240820_Eu4离线wiki_1.37v2',
        onChange: (v) => { wl.dir = v; },
        onDetect: detectWiki,
        onValidate: validateWiki,
      }));
      body.appendChild(e('div', {
        class: 'set-hint indent',
        // The example is data (a real folder name), so it is passed in rather
        // than baked into the translated string — otherwise English mode would
        // carry Chinese characters.
        text: I18N.t('目录需包含一个 wiki\\ 子目录（例如 {example}）', {
          example: 'F:\\20240820_Eu4离线wiki_1.37v2',
        }),
      }));
      const ws = meta.wiki || {};
      const line = ws.available
        ? I18N.t('已找到 {n} 个 wiki 页面。', { n: I18N.fmtNum(ws.pageCount) })
        : (ws.errorText || I18N.t('未找到离线中文 wiki。请在「设置」中手动选择目录。'));
      body.appendChild(e('div', { class: 'set-note ' + (ws.available ? 'ok' : 'warn'), text: line }));
    }

    // --- online wiki -------------------------------------------------------
    const wo = cfg.wiki.online;
    body.appendChild(e('h3', { class: 'set-h3', text: I18N.t('英文在线 Wiki') }));
    body.appendChild(row(
      I18N.t('启用'),
      checkbox(wo.enabled, (v) => { wo.enabled = v; render(); }),
      I18N.t('把相关 wiki 链接指向英文 wiki（eu4.paradoxwikis.com）。'),
    ));
    if (wo.enabled) {
      body.appendChild(pathRow(I18N.t('在线 wiki 地址'), wo.base, {
        target: 'wiki.online.base',
        placeholder: 'https://eu4.paradoxwikis.com/',
        onChange: (v) => { wo.base = v; },
      }));
      body.appendChild(e('div', { class: 'set-hint indent', text: I18N.t('英文 wiki 链接会在新标签页打开。') }));
    }

    // --- paths -------------------------------------------------------------
    body.appendChild(e('h3', { class: 'set-h3', text: I18N.t('路径设置') }));
    body.appendChild(pathRow(I18N.t('模组目录'), cfg.paths.userDir, {
      target: 'paths.userDir',
      placeholder: meta.current.userDir || '',
      onChange: (v) => { cfg.paths.userDir = v; },
      onDetect: () => detectInto('userDirs', 'paths.userDir'),
    }));
    body.appendChild(pathRow(I18N.t('游戏安装目录'), cfg.paths.installDir, {
      target: 'paths.installDir',
      placeholder: meta.current.installDir || '',
      onChange: (v) => { cfg.paths.installDir = v; },
      onDetect: () => detectInto('installDirs', 'paths.installDir'),
    }));
    body.appendChild(e('div', { class: 'set-hint indent', text: I18N.t('留空则自动检测。') }));

    body.appendChild(e('div', {
      class: 'set-note',
      html: I18N.t('当前模组目录') + ': <code>' + esc(meta.current.userDir || '—') + '</code><br>'
        + I18N.t('当前游戏目录') + ': <code>' + esc(meta.current.installDir || '—') + '</code><br>'
        + I18N.t('已发现 {n} 个模组', { n: I18N.fmtNum(meta.current.modCount || 0) }),
    }));

    if (S.configPath) {
      body.appendChild(e('div', { class: 'set-hint', text: I18N.t('配置文件') + ': ' + S.configPath }));
    }

    const st = statusLine();
    if (st) body.appendChild(st);

    // --- footer ------------------------------------------------------------
    const footer = e('div', { class: 'set-foot' }, [
      e('button', { class: 'btn ghost', type: 'button', text: I18N.t('恢复默认'), onclick: restoreDefaults }),
      e('span', { class: 'set-spacer' }),
      e('button', { class: 'btn ghost', type: 'button', text: I18N.t('关闭'), onclick: close }),
      e('button', {
        class: 'btn', type: 'button', text: S.busy ? I18N.t('保存中…') : I18N.t('保存'),
        disabled: S.busy ? 'disabled' : null,
        onclick: save,
      }),
    ]);

    overlay.innerHTML = '';
    overlay.appendChild(e('div', { class: 'set-dialog', role: 'dialog', 'aria-modal': 'true' }, [
      e('div', { class: 'set-head' }, [
        e('h2', { text: I18N.t('设置') }),
        e('button', { class: 'set-close', type: 'button', text: '✕', 'aria-label': I18N.t('关闭'), onclick: close }),
      ]),
      body,
      footer,
    ]));

    // The picker is a separate overlay stacked on top.
    if (S.picker) renderPicker();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function save() {
    S.busy = true;
    S.status = null;
    render();
    try {
      const r = await api('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(S.cfg),
      });
      S.cfg = r.config;
      S.meta = r;
      S.status = r.saved
        ? { kind: 'ok', text: I18N.t('设置已保存。') }
        : { kind: 'err', text: I18N.t('设置保存失败：{msg}', { msg: r.error || '' }) };
      if (r.reloaded) {
        // Directory overrides changed, so the mod list has to be re-fetched.
        if (typeof window.reloadMods === 'function') await window.reloadMods();
      }
    } catch (err) {
      S.status = { kind: 'err', text: I18N.t('设置保存失败：{msg}', { msg: err.message }) };
    } finally {
      S.busy = false;
      render();
    }
  }

  function restoreDefaults() {
    if (!S.cfg) return;
    S.cfg = {
      language: S.cfg.language,
      wiki: { local: { enabled: true, dir: '' }, online: { enabled: true, base: 'https://eu4.paradoxwikis.com/' } },
      paths: { userDir: '', installDir: '' },
      server: { port: 4173, openBrowser: true },
    };
    setStatus('ok', I18N.t('已恢复默认值，点击「保存」后生效。'));
  }

  async function detectWiki() {
    setStatus('ok', I18N.t('正在检测…'));
    try {
      const r = await api('/api/wiki/detect');
      const roots = (r && r.roots) || [];
      if (!roots.length) {
        setStatus('err', I18N.t('没有找到候选目录，请手动填写路径。'));
        return;
      }
      S.cfg.wiki.local.dir = roots[0];
      S.cfg.wiki.local.enabled = true;
      setStatus('ok', I18N.t('扫描到的候选目录：') + roots.join('   |   '));
    } catch (err) {
      setStatus('err', I18N.t('载入失败: {msg}', { msg: err.message }));
    }
  }

  async function validateWiki(dir) {
    setStatus('ok', I18N.t('正在验证…'));
    try {
      const r = await api('/api/wiki/validate?dir=' + encodeURIComponent(dir || ''));
      if (r && r.ok) setStatus('ok', I18N.t('已找到 {n} 个 wiki 页面。', { n: I18N.fmtNum(r.pageCount) }));
      else setStatus('err', (r && r.errorText) || I18N.t('找不到该目录，或它不包含 wiki\\ 子目录。'));
    } catch (err) {
      setStatus('err', I18N.t('载入失败: {msg}', { msg: err.message }));
    }
  }

  async function detectInto(kind, target) {
    const list = (S.meta && S.meta.detected && S.meta.detected[kind]) || [];
    if (!list.length) {
      setStatus('err', I18N.t('没有找到候选目录，请手动填写路径。'));
      return;
    }
    setPath(target, list[0]);
    setStatus('ok', I18N.t('扫描到的候选目录：') + list.join('   |   '));
  }

  /** Write into a dotted config path, e.g. `paths.userDir`. */
  function setPath(target, value) {
    const parts = target.split('.');
    let node = S.cfg;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
    node[parts[parts.length - 1]] = value;
    render();
  }

  function getPath(target) {
    const parts = target.split('.');
    let node = S.cfg;
    for (const p of parts) node = node && node[p];
    return node || '';
  }

  // -------------------------------------------------------------------------
  // Server-side folder picker
  // -------------------------------------------------------------------------

  let pickerOverlay = null;

  function openPicker(target) {
    S.picker = { target, path: getPath(target) || '', listing: null, error: null };
    ensurePicker();
    pickerOverlay.hidden = false;
    loadPicker(S.picker.path);
  }

  function ensurePicker() {
    if (pickerOverlay) return pickerOverlay;
    pickerOverlay = e('div', { class: 'set-overlay picker-overlay', hidden: 'hidden' });
    pickerOverlay.addEventListener('mousedown', (ev) => {
      if (ev.target === pickerOverlay) closePicker();
    });
    document.body.appendChild(pickerOverlay);
    return pickerOverlay;
  }

  function closePicker() {
    S.picker = null;
    if (pickerOverlay) pickerOverlay.hidden = true;
  }

  async function loadPicker(dir) {
    try {
      const r = await api('/api/fs/list?path=' + encodeURIComponent(dir || ''));
      S.picker.listing = r;
      S.picker.path = r.path || '';
      S.picker.error = null;
    } catch (err) {
      S.picker.error = err.message;
      S.picker.listing = null;
    }
    renderPicker();
  }

  function renderPicker() {
    if (!S.picker) return;
    ensurePicker();
    const p = S.picker;
    const list = e('div', { class: 'pk-list' });

    if (p.error) {
      list.appendChild(e('div', { class: 'pk-err', text: p.error }));
    } else if (p.listing) {
      const items = [];
      if (p.listing.parent) {
        items.push(e('div', {
          class: 'pk-item pk-up', onclick: () => loadPicker(p.listing.parent),
        }, [e('span', { class: 'pk-ico', text: '↰' }), e('span', { text: I18N.t('上级目录') })]));
      }
      for (const d of p.listing.dirs || []) {
        const badges = [];
        if (d.wiki) badges.push(e('span', { class: 'pk-badge wiki', text: 'wiki' }));
        if (d.mods) badges.push(e('span', { class: 'pk-badge', text: 'mod' }));
        items.push(e('div', {
          class: 'pk-item',
          ondblclick: () => loadPicker(d.path),
          onclick: (ev) => {
            for (const n of list.querySelectorAll('.pk-item.sel')) n.classList.remove('sel');
            ev.currentTarget.classList.add('sel');
            S.picker.selected = d.path;
          },
        }, [
          e('span', { class: 'pk-ico', text: '📁' }),
          e('span', { class: 'pk-name', text: d.name }),
          ...badges,
        ]));
      }
      if (!items.length) items.push(e('div', { class: 'pk-empty', text: I18N.t('这个文件夹里没有子目录。') }));
      for (const it of items) list.appendChild(it);
    } else {
      list.appendChild(e('div', { class: 'loading', text: I18N.t('正在载入…') }));
    }

    const pathBox = e('input', { class: 'set-input pk-path', type: 'text' });
    pathBox.value = p.listing ? p.listing.path : p.path;
    pathBox.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') loadPicker(pathBox.value.trim());
    });

    const hints = [];
    if (p.listing && p.listing.looksLikeWiki) hints.push('✔ ' + I18N.t('这个目录看起来是一份 wiki 转储'));
    if (p.listing && p.listing.hasMods) hints.push('✔ ' + I18N.t('包含 mod 子目录'));
    if (p.listing && p.listing.hasEu4Exe) hints.push('✔ ' + I18N.t('包含 eu4.exe'));

    pickerOverlay.innerHTML = '';
    pickerOverlay.appendChild(e('div', { class: 'set-dialog pk-dialog', role: 'dialog', 'aria-modal': 'true' }, [
      e('div', { class: 'set-head' }, [
        e('h2', { text: I18N.t('浏览服务器上的文件夹') }),
        e('button', { class: 'set-close', type: 'button', text: '✕', 'aria-label': I18N.t('关闭'), onclick: closePicker }),
      ]),
      e('div', { class: 'pk-bar' }, [
        e('div', { class: 'pk-drives' }, ((p.listing && p.listing.drives) || []).map((d) =>
          e('button', {
            class: 'btn small ghost', type: 'button', text: d.name,
            onclick: () => loadPicker(d.path),
          }))),
        pathBox,
        e('button', { class: 'btn small', type: 'button', text: I18N.t('确定'), onclick: () => loadPicker(pathBox.value.trim()) }),
      ]),
      hints.length ? e('div', { class: 'pk-hints', text: hints.join('    ') }) : null,
      list,
      e('div', { class: 'set-foot' }, [
        e('button', { class: 'btn ghost', type: 'button', text: I18N.t('取消'), onclick: closePicker }),
        e('span', { class: 'set-spacer' }),
        e('button', {
          class: 'btn', type: 'button', text: I18N.t('选择此文件夹'),
          onclick: () => {
            const chosen = S.picker.selected || (S.picker.listing && S.picker.listing.path) || '';
            const target = S.picker.target;
            closePicker();
            setPath(target, chosen);
          },
        }),
      ]),
    ]));
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  function boot() {
    const btn = $('#lang-btn');
    if (btn) btn.addEventListener('click', () => switchLang(I18N.getLang() === 'zh' ? 'en' : 'zh'));
    const sbtn = $('#settings-btn');
    if (sbtn) sbtn.addEventListener('click', open);
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (S.picker) closePicker();
      else if (S.open) close();
    });
    renderLangButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.openSettings = open;
  window.closeSettings = close;
  window.switchLang = switchLang;
})();
