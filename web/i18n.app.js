'use strict';
/* English strings for web/app.js, keyed by the Chinese original. */
(function () {
  I18N.extend({
    // --- encoding labels (ENC_LABEL) ---------------------------------------
    '纯 UTF-8': 'Plain UTF-8',
    '转义编码 (CP1252)': 'Escape encoding (CP1252)',
    '转义编码 (原始)': 'Escape encoding (raw)',
    '未标注': 'not specified',
    '未声明': 'not declared',

    // --- sidebar / mod list ------------------------------------------------
    '{n} 个文件': '{n} files',
    '{n} 类': '{n} categories',
    '创意工坊': 'Workshop',
    '本地': 'Local',

    // --- mod overview ------------------------------------------------------
    '正在载入模组…': 'Loading mod…',
    '载入失败: ': 'Load failed: ',
    '版本 ': 'Version ',
    '支持游戏版本 ': 'Supported game version ',
    '创意工坊 ID ': 'Workshop ID ',
    '依赖：': 'Dependencies: ',
    '整目录替换：': 'Whole-folder replacements: ',
    '模组信息': 'Mod info',
    '名称': 'Name',
    '版本': 'Version',
    '支持版本': 'Supported version',
    '来源': 'Source',
    'Steam 创意工坊': 'Steam Workshop',
    '本地模组': 'Local mod',
    '文件总数': 'Total files',
    '文本文件': 'Text files',
    '资源文件': 'Asset files',
    '总体积': 'Total size',
    '改动类别': 'Change categories',
    '安装路径': 'Install path',
    '本模组共改动了 ': 'This mod changes ',
    ' 个文件，分布在 ': ' files across ',
    ' 个改动类别中。': ' change categories.',
    '点击下方任意类别或使用左侧文件树，即可查看具体改动内容。':
      'Pick a category below, or use the file tree on the left, to see exactly what changed.',
    '已归类文件': 'Categorised files',
    '文本 / 脚本': 'Text / script',
    '🎮 游戏内格式预览': '🎮 In-game format preview',
    '把脚本与本地化文件对应起来，按 EU4 在游戏里实际显示的样子浏览事件、决议、理念组、国家理念、顾问和政策。':
      'Pairs scripts with their localisation files so you can browse events, decisions, idea groups, national ideas, advisors and policies the way EU4 shows them in game.',
    '打开游戏内预览 →': 'Open in-game preview →',
    '按游戏内容分类，显示该模组在各个系统上的改动规模。':
      'Grouped by game content, showing how much this mod changes each system.',
    '{n} 文件': '{n} files',

    // --- category / file browser -------------------------------------------
    '游戏内预览模块未加载（/gameview.js）': 'In-game preview module not loaded (/gameview.js)',
    '全部文件': 'All files',
    '（{n} 个文件，{size}）': ' ({n} files, {size})',
    '正在载入相关 wiki 页面…': 'Loading related wiki pages…',
    '从左侧选择一个文件以查看内容': 'Pick a file on the left to view its contents',
    '该类别下没有文件': 'No files in this category',
    '正在读取文件…': 'Reading file…',
    '读取失败: ': 'Read failed: ',

    // --- file view ---------------------------------------------------------
    '{n} 行': '{n} lines',
    '{n} 条本地化': '{n} localisation entries',
    '{n} 个顶层条目': '{n} top-level entries',
    '🎮 按游戏内格式查看该文件': '🎮 View this file in in-game format',
    '把本文件里的内容与本地化文件对应起来，按 EU4 游戏内的样子渲染':
      'Pairs what is in this file with its localisation and renders it as EU4 shows it in game',
    '二进制文件': 'Binary file',
    '未知内容类型': 'Unknown content type',
    '该文件的文本使用 EU4 私有转义编码（非 UTF-8 中文），已自动解码显示。原始文件中中文以「控制字节 + 字形」形式存储。':
      'This file uses EU4\u2019s private escape encoding (not UTF-8 Chinese) and has been decoded for display. In the original file, Chinese is stored as control byte + glyph pairs.',
    '语言头 ': 'Language header ',
    '共 {n} 条': '{n} entries',
    '{n} 行无法解析': '{n} unparsable lines',
    '在本地化条目中筛选…': 'Filter localisation entries…',
    '键 (key)': 'Key',
    '文本 (value)': 'Text (value)',
    '没有匹配的条目': 'No matching entries',
    '解析提示: ': 'Parse warning: ',
    '（下方为原始文本）': ' (raw text below)',
    '结构化视图': 'Structured view',
    '原始文本': 'Raw text',
    '无法构建结构树': 'Could not build the structure tree',
    '没有顶层条目': 'No top-level entries',
    '共 {n} 行': '{n} lines',
    '（仅显示前 5000 行）': ' (showing the first 5000 rows only)',
    '资源预览': 'Asset preview',

    // --- offline wiki ------------------------------------------------------
    // The old "put the dump on drive F" message is gone: the wiki folder is now
    // chosen in Settings, so the reason text comes from the server.
    '<b>相关 wiki 页面</b>（点击在下方内嵌打开）：':
      '<b>Related wiki pages</b> (click to open inline below):',
    '载入 wiki 链接失败: ': 'Could not load wiki links: ',
    '离线 wiki：{name}': 'Offline wiki: {name}',
    '收起': 'Collapse',
    '载入失败: ': 'Load failed: ',

    // --- search ------------------------------------------------------------
    '搜索：{q}': 'Search: {q}',
    '正在搜索…': 'Searching…',
    '模组内结果': 'Results in mod',
    '（': ' (',
    '）': ')',
    '请先在左侧选择一个模组，即可搜索该模组内的文件与文本。':
      'Select a mod on the left to search its files and text.',
    '没有匹配的文件或本地化条目。': 'No matching files or localisation entries.',
    '文件': 'File',
    '离线中文 wiki': 'Offline Chinese wiki',
    'wiki 中没有匹配的页面。': 'No matching wiki pages.',
    '搜索失败: ': 'Search failed: ',

    // --- status bar / boot -------------------------------------------------
    '已发现 {n} 个模组': '{n} mods found',
    '游戏目录 {dir}': 'Game folder {dir}',
    '未找到游戏目录': 'Game folder not found',
    '离线 wiki 已挂载（{n} 个页面）': 'Offline wiki mounted ({n} pages)',
    '未找到离线 wiki': 'Offline wiki not found',
    '初始化失败: ': 'Initialisation failed: ',
    '正在重新扫描…': 'Rescanning…',
    '已重新扫描：{n} 个模组': 'Rescanned: {n} mods',
    '重新扫描失败: ': 'Rescan failed: ',

    // --- category names / descriptions served by the API -------------------
    // The file endpoints carry the category `desc`, which is Chinese-only in
    // the taxonomy; the overview endpoints omit it, so this is a best effort.
    '国家与政体': 'Countries & government',
    '国家标签、配色、历史开局与可成立国家':
      'Country tags, colours, historical starts and formable nations',
    '省份': 'Provinces',
    '省份历史、名称、归属、宗教与文化':
      'Province history, names, ownership, religion and culture',
    '地图': 'Map',
    '地图图像、地区、区域、地形、气候与地形定义':
      'Map images, regions, areas, terrain, climate and terrain definitions',
    '决议': 'Decisions',
    '国家决议：条件、效果与 AI 权重':
      'National decisions: triggers, effects and AI weighting',
    '事件': 'Events',
    '事件：触发条件、选项与图片': 'Events: triggers, options and pictures',
    '任务树': 'Mission trees',
    '任务树与任务序列': 'Mission trees and mission series',
    '理念': 'Ideas',
    '理念组、国家理念与自定义理念':
      'Idea groups, national ideas and custom ideas',
    '政策': 'Policies',
    '政策及其解锁条件与修正': 'Policies with their unlock triggers and modifiers',
    '政府与改革': 'Government & reforms',
    '政体、政府改革、政府等级与名称':
      'Government types, government reforms, government ranks and names',
    '宗教': 'Religion',
    '宗教、信条、教会面向与宗教机制':
      'Religions, creeds, church aspects and religious mechanics',
    '文化': 'Culture',
    '文化组与文化交流': 'Culture groups and culture conversion',
    '科技与思潮': 'Technology & institutions',
    '科技等级、科技组与思潮': 'Technology levels, technology groups and institutions',
    '单位与军事': 'Units & military',
    '陆军/海军单位、兵模与雇佣兵团':
      'Army and navy units, unit models and mercenary companies',
    '建筑': 'Buildings',
    '建筑、其前置与效果': 'Buildings with their prerequisites and effects',
    '贸易': 'Trade',
    '贸易节点、贸易公司、商品与价格':
      'Trade nodes, trade companies, goods and prices',
    '阶层': 'Estates',
    '阶层、阶层特权与议程': 'Estates, estate privileges and agendas',
    '灾难': 'Disasters',
    '灾难的触发条件、进程与结束效果':
      'Disaster triggers, progress and ending effects',
    '时代': 'Ages',
    '时代能力与时代定义': 'Age abilities and age definitions',
    '修正': 'Modifiers',
    '静态/事件/触发/观点修正':
      'Static, event, trigger and opinion modifiers',
    '脚本效果与条件': 'Scripted effects & triggers',
    '可复用的脚本效果、触发条件与函数':
      'Reusable scripted effects, triggers and functions',
    '行动指令': 'On actions',
    '游戏事件挂钩（on_actions）': 'Game event hooks (on_actions)',
    '宣战理由与战争': 'Casus belli & war',
    '宣战理由、战争目标与和平条约':
      'Casus belli, war goals and peace treaties',
    '顾问': 'Advisors',
    '顾问类型与历史顾问': 'Advisor types and historical advisors',
    '伟大工程': 'Great projects',
    '伟大工程及其阶段效果': 'Great projects and their stage effects',
    '叛军': 'Rebels',
    '叛军类型与叛乱触发': 'Rebel types and rebellion triggers',
    '书签与开局': 'Bookmarks & starts',
    '开局书签与起始剧本': 'Start bookmarks and opening scenarios',
    '历史': 'History',
    '国家、省份、外交与战争历史':
      'Country, province, diplomacy and war history',
    '本地化': 'Localisation',
    '文本与翻译；支持 EU4 转义编码自动解码':
      'Text and translations; decodes EU4 escape encoding automatically',
    '界面与 GUI': 'Interface & GUI',
    'GUI 布局、精灵定义与自定义窗口':
      'GUI layouts, sprite definitions and custom windows',
    '图形与模型': 'Graphics & models',
    '贴图、模型、旗帜、字体与特效':
      'Textures, models, flags, fonts and effects',
    '音乐与音效': 'Music & sound',
    '音乐与音效资源': 'Music and sound assets',
    'DLC 元数据': 'DLC metadata',
    'DLC 与配套元数据': 'DLC and its accompanying metadata',
    '模组定义': 'Mod definition',
    '模组描述文件与封面': 'Mod descriptor file and cover image',
    '其他改动': 'Other changes',
    '未归类的改动': 'Changes that could not be categorised',

    // --- related wiki links (loadWikiLinks) --------------------------------
    // The local wiki is on, so the online block gets its own heading.
    '<b>英文 wiki</b>（在新标签页打开）：':
      '<b>English wiki</b> (opens in a new tab):',
    // The local wiki is off, so the online block is the primary one.
    '<b>相关 wiki 页面</b>（英文 wiki，在新标签页打开）：':
      '<b>Related wiki pages</b> (English wiki, opens in a new tab):',
  });
})();
