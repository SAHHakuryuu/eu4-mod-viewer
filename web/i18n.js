'use strict';
/**
 * Frontend language layer.
 *
 * The dictionary is keyed by the **Chinese source string**, so a string that
 * has not been translated yet still renders (in Chinese) instead of showing a
 * raw key. That keeps the UI usable at every point during translation and makes
 * the call sites read naturally: `t('搜索')`.
 *
 * Load order (see index.html):
 *   i18n.js  ->  i18n.app.js  ->  i18n.game.js  ->  app.js  ->  gameview.js
 * Each fragment registers itself with `I18N.extend({ ... })`.
 */
(function () {
  const STORAGE_KEY = 'eu4mv.lang';
  const LANGS = ['zh', 'en', 'fr', 'de', 'es', 'pt', 'ru', 'ja', 'ko'];
  /** Language names in their own script — a picker should never translate them. */
  const LANG_NAMES = {
    zh: '中文',
    en: 'English',
    fr: 'Français',
    de: 'Deutsch',
    es: 'Español',
    pt: 'Português',
    ru: 'Русский',
    ja: '日本語',
    ko: '한국어',
  };
  const LOCALES = {
    zh: 'zh-CN', en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
    pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR',
  };
  const LANG_ALIASES = {
    zh: ['zh', 'cn', 'chs', 'cht', 'chi', 'zho'],
    en: ['en', 'eng'],
    fr: ['fr', 'fra', 'fre'],
    de: ['de', 'deu', 'ger'],
    es: ['es', 'spa'],
    pt: ['pt', 'por'],
    ru: ['ru', 'rus'],
    ja: ['ja', 'jp', 'jpn'],
    ko: ['ko', 'kor'],
  };

  /** English strings, keyed by the Chinese original. */
  const EN = {
    // --- shell / header -----------------------------------------------------
    'EU4 模组浏览器': 'EU4 Mod Viewer',
    'Mod 浏览器': 'Mod Viewer',
    'Europa Universalis IV Mod Viewer': 'Europa Universalis IV Mod Viewer',
    '搜索': 'Search',
    '搜索文件、本地化键或文本…': 'Search files, localisation keys or text…',
    '重新扫描': 'Rescan',
    '重新扫描模组': 'Rescan mods',
    '设置': 'Settings',
    '模组列表': 'Mods',
    '选择一个模组': 'Choose a mod',
    '从左侧选择要浏览的模组，即可查看它对游戏做的全部改动。':
      'Pick a mod on the left to see everything it changes in the game.',
    '正在扫描…': 'Scanning…',
    '语言': 'Language',
    '界面语言': 'Interface language',
    '中文': 'Chinese',
    'English': 'English',
    '关闭': 'Close',
    '保存': 'Save',
    '保存中…': 'Saving…',
    '已保存': 'Saved',
    '取消': 'Cancel',
    '确定': 'OK',
    '重置': 'Reset',
    '恢复默认': 'Restore defaults',
    '应用': 'Apply',
    '浏览…': 'Browse…',
    '自动检测': 'Auto-detect',
    '检测中…': 'Detecting…',
    '状态': 'Status',
    '可用': 'Available',
    '不可用': 'Unavailable',
    '已启用': 'Enabled',
    '已禁用': 'Disabled',
    '启用': 'Enable',
    '禁用': 'Disable',
    '开': 'On',
    '关': 'Off',
    '个文件': 'files',
    '个页面': 'pages',
    '个模组': 'mods',
    '类': 'categories',
    '共': 'total',
    '行': 'lines',
    '条': 'entries',

    // --- settings panel -----------------------------------------------------
    '本地中文 Wiki': 'Local Chinese wiki',
    '英文在线 Wiki': 'English online wiki',
    '关联本地 EU4 中文离线 wiki': 'Link to the local offline Chinese EU4 wiki',
    '在文件浏览页显示相关 wiki 页面按钮': 'Show related-wiki buttons on file pages',
    '离线 wiki 目录': 'Offline wiki folder',
    '目录需包含一个 wiki\\ 子目录（例如 {example}）':
      'The folder must contain a wiki\\ subfolder (for example {example})',
    '把相关 wiki 链接指向英文 wiki（eu4.paradoxwikis.com）':
      'Point related-wiki links at the English wiki (eu4.paradoxwikis.com)',
    '在线 wiki 地址': 'Online wiki base URL',
    '英文 wiki 链接会在新标签页打开。':
      'English wiki links open in a new tab.',
    '路径设置': 'Paths',
    '模组目录': 'Mod folder',
    '游戏安装目录': 'Game install folder',
    '留空则自动检测。': 'Leave blank to auto-detect.',
    '自动检测到': 'Detected',
    '未检测到': 'Not found',
    '扫描到的候选目录：': 'Candidate folders found:',
    '没有找到候选目录，请手动填写路径。': 'No candidates found — enter a path manually.',
    '正在验证…': 'Checking…',
    '验证': 'Check',
    '找不到该目录，或它不包含 wiki\\ 子目录。': 'Folder not found, or it has no wiki\\ subfolder.',
    '已找到 {n} 个 wiki 页面。': 'Found {n} wiki pages.',
    '设置已保存。': 'Settings saved.',
    '设置保存失败：{msg}': 'Could not save settings: {msg}',
    '浏览服务器上的文件夹': 'Browse folders on the server',
    '上级目录': 'Parent folder',
    '这个文件夹里没有子目录。': 'No subfolders here.',
    '选择此文件夹': 'Use this folder',
    '驱动器': 'Drives',
    '语言会同时应用到网页界面、控制台输出和这里的设置项。':
      'Applies to the web UI, the console output and this dialog.',
    '把相关 wiki 链接指向本地离线中文 wiki。':
      'Point related-wiki links at the local offline Chinese wiki.',
    '把相关 wiki 链接指向英文 wiki（eu4.paradoxwikis.com）。':
      'Point related-wiki links at the English wiki (eu4.paradoxwikis.com).',
    '正在检测…': 'Detecting…',
    '正在载入…': 'Loading…',
    '已恢复默认值，点击「保存」后生效。': 'Defaults restored — click Save to apply.',
    '当前模组目录': 'Current mod folder',
    '当前游戏目录': 'Current game folder',
    '配置文件': 'Config file',
    '这个目录看起来是一份 wiki 转储': 'This folder looks like a wiki dump',
    '包含 mod 子目录': 'has a mod subfolder',
    '包含 eu4.exe': 'has eu4.exe',

    // --- wiki panel ---------------------------------------------------------
    '相关 wiki 页面': 'Related wiki pages',
    '离线中文 wiki': 'Offline Chinese wiki',
    '英文 wiki': 'English wiki',
    '本地 wiki': 'Local wiki',
    '点击在下方内嵌打开': 'click to open inline below',
    '在新标签页打开': 'opens in a new tab',
    '未启用本地中文 wiki。可在「设置」中启用并选择目录。':
      'The local Chinese wiki is not enabled. Turn it on and pick a folder in Settings.',
    '未找到离线中文 wiki。请在「设置」中手动选择目录。':
      'No offline Chinese wiki found. Choose its folder in Settings.',
    '打开设置': 'Open settings',
    '收起': 'Collapse',
    '载入 wiki 链接失败: {msg}': 'Could not load wiki links: {msg}',
    '离线 wiki：{name}': 'Offline wiki: {name}',
    '正在载入相关 wiki 页面…': 'Loading related wiki pages…',
    'wiki 中没有匹配的页面。': 'No matching wiki pages.',

    // --- misc ---------------------------------------------------------------
    '正在载入模组…': 'Loading mod…',
    '正在读取文件…': 'Reading file…',
    '正在搜索…': 'Searching…',
    '载入失败: {msg}': 'Load failed: {msg}',
    '读取失败: {msg}': 'Read failed: {msg}',
    '搜索失败: {msg}': 'Search failed: {msg}',
    '初始化失败: {msg}': 'Initialisation failed: {msg}',
    '重新扫描失败: {msg}': 'Rescan failed: {msg}',
    '没有匹配的条目': 'No matching entries',
    '没有匹配的文件或本地化条目。': 'No matching files or localisation entries.',
    '请先在左侧选择一个模组，即可搜索该模组内的文件与文本。':
      'Select a mod on the left to search its files and text.',
    '从左侧选择一个文件以查看内容': 'Pick a file on the left to view its contents',
    '该类别下没有文件': 'No files in this category',
    '没有顶层条目': 'No top-level entries',
    '无法构建结构树': 'Could not build the structure tree',
    '结构化视图': 'Structured view',
    '原始文本': 'Raw text',
    '全部文件': 'All files',
    '文件': 'File',
    '二进制文件': 'Binary file',
    '未知内容类型': 'Unknown content type',
    '资源预览': 'Asset preview',
    '搜索：{q}': 'Search: {q}',
    '模组内结果': 'Results in mod',
    '已发现 {n} 个模组': 'Found {n} mods',
    '未找到游戏目录': 'Game folder not found',
    '游戏目录 {dir}': 'Game folder {dir}',
    '离线 wiki 已挂载（{n} 个页面）': 'Offline wiki mounted ({n} pages)',
    '未找到离线 wiki': 'Offline wiki not found',
    '已重新扫描：{n} 个模组': 'Rescanned: {n} mods',
    '正在重新扫描…': 'Rescanning…',
  };

  /** Filled in by i18n.app.js / i18n.game.js and by web/lang/<code>.js. */
  const DICT = { en: EN };

  let lang = 'zh';
  const listeners = [];

  function normalize(l) {
    const s = String(l == null ? '' : l).toLowerCase();
    // Primary subtag only, so `pt-BR`, `zh-Hans-CN` and `ja_JP` all land.
    const primary = s.split(/[-_]/)[0];
    if (primary === 'cn') return 'zh';
    for (const code of LANGS) if (primary === code) return code;
    for (const code of LANGS) if ((LANG_ALIASES[code] || []).includes(primary)) return code;
    return 'zh';
  }

  /**
   * Look up `s`, substituting `{name}` placeholders from `vars`.
   *
   * Fallback chain: requested language -> English -> the Chinese source string
   * itself. English sits in the middle on purpose: for a French or Korean
   * reader an untranslated string is far more useful in English than in Chinese
   * (and a missing key can never render as a raw key).
   */
  function t(s, vars) {
    if (s == null) return '';
    let out = s;
    if (lang !== 'zh') {
      const table = DICT[lang] || {};
      if (Object.prototype.hasOwnProperty.call(table, s)) out = table[s];
      else if (lang !== 'en') {
        const en = DICT.en || {};
        if (Object.prototype.hasOwnProperty.call(en, s)) out = en[s];
      }
    }
    if (vars) {
      out = String(out).replace(/\{(\w+)\}/g, (m, k) =>
        (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
    }
    return out;
  }

  /** Register more translations (fragment files and ad-hoc additions). */
  function extend(map, target) {
    const key = target || 'en';
    if (!DICT[key]) DICT[key] = {};
    Object.assign(DICT[key], map || {});
    return DICT[key];
  }

  /** Every key currently registered for a language (used by the audit tool). */
  function keys(l) {
    return Object.keys(DICT[l || 'en'] || {});
  }

  function getLang() {
    return lang;
  }

  function getLocale() {
    return LOCALES[lang] || 'en-US';
  }

  /**
   * Switch language. `persist` writes the choice to localStorage so a reload
   * keeps it; the caller is responsible for telling the server.
   */
  function setLang(next, opts = {}) {
    const l = normalize(next);
    const changed = l !== lang;
    lang = l;
    try {
      document.documentElement.lang = getLocale();
      document.documentElement.setAttribute('data-lang', l);
    } catch { /* no document in tests */ }
    if (opts.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, l); } catch { /* private mode */ }
    }
    if (changed) for (const fn of listeners) { try { fn(l); } catch { /* ignore */ } }
    return l;
  }

  /** The stored preference, or null when the user has never chosen one. */
  function storedLang() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v ? normalize(v) : null;
    } catch {
      return null;
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  /**
   * Translate the static markup: every `[data-i18n]` element's text content,
   * plus `data-i18n-title` / `data-i18n-placeholder` / `data-i18n-aria`.
   * The attribute value is the Chinese source string.
   */
  function applyStatic(root) {
    const scope = root || document;
    for (const node of scope.querySelectorAll('[data-i18n]')) {
      node.textContent = t(node.getAttribute('data-i18n'));
    }
    for (const node of scope.querySelectorAll('[data-i18n-html]')) {
      node.innerHTML = t(node.getAttribute('data-i18n-html'));
    }
    for (const [attr, target] of [
      ['data-i18n-title', 'title'],
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-aria', 'aria-label'],
    ]) {
      for (const node of scope.querySelectorAll('[' + attr + ']')) {
        node.setAttribute(target, t(node.getAttribute(attr)));
      }
    }
    // The <title> element lives outside any rendered container, so handle it
    // explicitly (textContent on <title> would work in HTML but not in XML).
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) document.title = t(titleEl.getAttribute('data-i18n'));
  }

  /** Numbers follow the active locale so thousands separators look right. */
  function fmtNum(n) {
    return Number(n || 0).toLocaleString(getLocale());
  }

  /** Text direction is left-to-right for both supported languages. */
  const RTL = false;

  setLang(storedLang() || 'zh', { persist: false });

  window.I18N = {
    LANGS,
    LANG_NAMES,
    t,
    extend,
    keys,
    getLang,
    setLang,
    storedLang,
    onChange,
    applyStatic,
    fmtNum,
    STORAGE_KEY,
    RTL,
  };
  // Shorthand used throughout app.js / gameview.js.
  window.t = t;
})();
