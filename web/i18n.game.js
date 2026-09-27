'use strict';
/* English strings for web/gameview.js, keyed by the Chinese original. */
(function () {
  I18N.extend({
    // --- hub page ------------------------------------------------------------
    '游戏内格式预览': 'In-game preview',
    '🎮 游戏内格式预览': '🎮 In-game preview',
    '把模组的脚本文件与本地化文件对应起来，按 EU4 在游戏里实际显示的样子渲染：事件窗、决议提示、任务树、政府改革、阶层特权、灾难、时代、宗教、文化、建筑、贸易、单位、科技、修正、脚本、行动指令、宣战理由、伟大工程、叛军、书签、国家历史、地图与 GUI 界面。':
      "Maps a mod's script files to its localisation files and renders them the way EU4 shows them in game: the event window, decision tooltip, mission tree, government reforms, estate privileges, disasters, ages, religions, cultures, buildings, trade, units, technology, modifiers, scripted effects and triggers, on_actions, casus belli, great projects, rebels, bookmarks, country history, the map and GUI windows.",
    '正在建立内容索引（首次需要几秒钟）…': 'Building the content index (takes a few seconds the first time)…',
    '内容索引建立失败：{msg}': 'Could not build the content index: {msg}',
    '已解析 <b>{n}</b> 条游戏内容，分布在 <b>{types}</b> 个类别中 · 模组本地化键 <b>{m}</b> 条 · 中文词表：修正 {mods} / 条件 {trig} / 效果 {effs}（运行时读自本机离线 wiki）':
      'Game content parsed: <b>{n}</b> entries across <b>{types}</b> categories · mod localisation keys: <b>{m}</b> · Chinese glossary: modifiers {mods} / triggers {trig} / effects {effs} (read from your local offline wiki at run time)',
    '已解析 <b>{n}</b> 条游戏内容，分布在 <b>{types}</b> 个类别中 · 模组本地化键 <b>{m}</b> 条 · 中文词表：修正 {mods} / 条件 {trig} / 效果 {effs}（内置手写词表，未挂载离线 wiki）':
      'Game content parsed: <b>{n}</b> entries across <b>{types}</b> categories · mod localisation keys: <b>{m}</b> · Chinese glossary: modifiers {mods} / triggers {trig} / effects {effs} (hand-written terms only; no offline wiki mounted)',
    ' · <span class="gw-warn">{n} 个文件读取失败</span>':
      ' · <span class="gw-warn">Files that could not be read: {n}</span>',
    '仅显示文件：': 'Showing only file:',
    '取消筛选': 'Clear filter',
    '在该类别中搜索…': 'Search this category…',
    '<div class="loading">载入中…</div>': '<div class="loading">Loading…</div>',
    '<div class="loading">正在生成游戏内视图…</div>': '<div class="loading">Rendering the in-game view…</div>',
    '← 从左侧选择一条内容，查看它在游戏中的样子': '← Pick an entry on the left to see how it looks in game',
    'wiki 教程': 'Wiki guide',
    '打开本地 EU4 wiki 中对应的修改教程': 'Open the matching modding guide on the local EU4 wiki',
    '载入失败: {msg}': 'Load failed: {msg}',
    '生成失败: {msg}': 'Could not render: {msg}',
    '载入更多': 'Load more',
    '已显示 {shown} / {total}': 'Showing {shown} / {total}',
    '没有匹配的内容': 'No matching entries',
    '该类别没有内容': 'Nothing in this category',
    '未知内容类型': 'Unknown content type',
    '打开脚本源文件': 'Open the script source file',

    // --- rich text / line helpers --------------------------------------------
    '（无）': 'None',
    '游戏图标 £{icon}£': 'Game icon £{icon}£',
    '游戏图标 £{icon}£（未找到贴图）': 'Game icon £{icon}£ (sprite not found)',
    '游戏运行时才会求值的动态文本：{code}（{note}）':
      'Dynamic text the game evaluates only at runtime: {code} ({note})',
    '游戏引擎关键字 {ref} → {note}': 'Game engine keyword {ref} → {note}',
    '运行时数值': 'runtime value',
    '本地化文件中找不到这个键，游戏里会原样显示':
      'This key is not in the localisation files; the game shows it as-is',
    '来自另一条本地化：{ref}': 'From another localisation: {ref}',
    '{kind}：{id}': '{kind}: {id}',
    '{kind}：{id}（点击查看）': '{kind}: {id} (click to view)',
    '本地化键 {key} 在模组与原版本地化中都不存在，游戏里会显示这个键名本身':
      'The localisation key {key} is in neither the mod nor vanilla localisation; the game shows the key name itself',
    '图片 {name}（未找到贴图文件）': 'Picture {name} (sprite file not found)',

    // --- item badges ---------------------------------------------------------
    '重大决议': 'Major decision',
    '国家理念': 'National ideas',
    '理念组': 'Idea group',

    // --- monarch power -------------------------------------------------------
    '行政': 'Administrative',
    '外交': 'Diplomatic',
    '军事': 'Military',

    // --- event window --------------------------------------------------------
    '只触发一次': 'Fires only once',
    '隐藏事件': 'Hidden event',
    '重大事件': 'Major event',
    '仅由事件触发': 'Triggered only by an event',
    '平均触发：{value} {unit}': 'Mean time to happen: {value} {unit}',
    '天': 'days',
    '月': 'months',
    '年': 'years',
    '（选项名缺失，游戏显示 "Ok"）': '(option name missing; the game shows "Ok")',
    '效果（游戏中悬停选项时显示）': 'Effects (shown when hovering an option in game)',
    'AI 选择权重': 'AI weight',
    '该事件没有可选项（游戏里会直接应用 immediate 效果）':
      'This event has no options (the game applies the immediate effects directly)',
    '触发条件 trigger': 'Trigger conditions (trigger)',
    '立即效果 immediate': 'Immediate effects (immediate)',
    '后续效果 after': 'After effects (after)',

    // --- decision ------------------------------------------------------------
    '可决议条件 potential': 'Potential (potential)',
    '允许决议 allow': 'Allow (allow)',
    '决议效果 effect': 'Effects (effect)',
    '无限制': 'No restrictions',
    '无额外条件': 'No extra conditions',
    '无效果': 'No effects',
    'AI 意愿 ai_will_do': 'AI will do (ai_will_do)',

    // --- idea group / national ideas -----------------------------------------
    '传统 start': 'Traditions (start)',
    '雄心 bonus': 'Ambition (bonus)',
    '解锁条件 trigger': 'Unlock requirements (trigger)',

    // --- advisor -------------------------------------------------------------
    '顾问效果': 'Advisor effects',
    '无固定修正': 'No fixed modifiers',
    '仅男性': 'Male only',
    '仅女性': 'Female only',
    '随顾问等级缩放的修正（skill_scaled_modifier）':
      'Modifiers scaled by advisor skill (skill_scaled_modifier)',
    '条件 {n}': 'Condition {n}',
    '无条件': 'No conditions',
    '修正': 'Modifiers',
    '无': 'None',
    '等级缩放修正': 'Skill-scaled modifiers',
    '出现概率 chance': 'Spawn chance (chance)',

    // --- policy --------------------------------------------------------------
    '政策效果': 'Policy effects',
    '无修正': 'No modifiers',
    '解锁条件 potential': 'Unlock requirements (potential)',
    '允许激活 allow': 'Activation requirements (allow)',

    // --- script ↔ localisation table -----------------------------------------
    '脚本 ↔ 本地化对照（{found}/{total} 个键已解析）':
      'Script ↔ localisation ({found}/{total} keys resolved)',
    '脚本字段': 'Script field',
    '本地化键': 'Localisation key',
    '游戏显示的文本': 'Text shown in game',
    '来源文件': 'Source file',
    '（未找到，游戏显示键名本身）': '(not found — the game shows the key name itself)',
    '原版': 'Vanilla',

    // --- generic cards -------------------------------------------------------
    '全部类别': 'All categories',
    '{label}：{n} 条': '{label}: {n} entries',
    '槽位 {n}': 'Slot {n}',
    '关联内容：': 'Related content:',
    '无权重设置': 'No weight configured',
    '显示全部 {n} 条': 'Show all {n}',
    '该键不在中文词表中，按脚本原样显示':
      'This key is not in the Chinese glossary, so it is shown exactly as written in the script',
    '游戏内不会显示原始脚本，这里原样保留以便核对':
      'The game never shows raw script; it is kept verbatim here so it can be checked',

    // --- unit stat table -----------------------------------------------------
    '兵种属性': 'Unit stats',
    '阶段': 'Phase',
    '进攻': 'Offensive',
    '防御': 'Defensive',
    '士气': 'Morale',
    '火力': 'Fire',
    '冲击': 'Shock',
    '机动': 'Maneuver',

    // --- mission tree --------------------------------------------------------
    '同一任务树中的任务（共 {n} 个）': 'Missions in the same tree ({n} in total)',
    '该任务树生效条件 potential': "This mission tree's potential",
    '任务树来源：{n}': 'Mission tree source: {n}',
    '{cols} 列 · {rows} 行 · {n} 个任务': '{cols} columns · {rows} rows · {n} missions',
    '版式来自游戏 GUI': 'Layout from the game GUI',
    '该任务树中的任务（共 {n} 个）': 'Missions in this tree ({n} in total)',
    '该任务树过大，仅显示前 {n} 个格子': 'This tree is very large; only the first {n} cells are shown',
    '有 {n} 条前置指向本树之外的任务：{list}': '{n} prerequisites point outside this tree: {list}',
    '有 {n} 条前置指向下方任务，箭头贴图已翻转表示': '{n} prerequisites point at a mission below; their arrowheads are drawn flipped',
    '有 {n} 条前置指向同一格内的任务，无法画出方向': '{n} prerequisites point at a mission in their own cell, so there is no direction to draw',
    '有 {n} 个格子被两个任务占用（slot 与 position 冲突）': '{n} cells hold two missions (conflicting slot and position)',
    '有 {n} 个贴图无法从游戏目录解析': '{n} sprites could not be resolved from the game folder',
    '该任务树用到槽位 {list}，超出上限 {cap} 列，已按原槽位摆放': 'This tree uses slots {list}, past the {cap}-column cap; they are placed where the script put them',
    '{n} 个任务': '{n} missions',

    // --- history timeline ----------------------------------------------------
    '历史时间线（{n} 条）': 'History timeline ({n} dated entries)',
    '历史时间线（{n} 条，已截断）': 'History timeline ({n} dated entries, truncated)',

    // --- GUI widget tree -----------------------------------------------------
    'GUI 控件树': 'GUI widget tree',
    '这是游戏加载该窗口时构建的控件层级；位置与尺寸为界面文件中的原始数值。':
      "This is the widget hierarchy the game builds when it loads the window; positions and sizes are the raw values from the interface file.",
  });
})();
