# EU4 Mod 浏览器 (EU4 Mod Viewer)

[English](README.en.md) | [中文](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![Languages](https://img.shields.io/badge/UI-%E4%B8%AD%E6%96%87%20%7C%20English-informational.svg)](#-界面语言--中英文切换)

一个 EU4 维基风格的本地软件，用来**读取并可视化 Europa Universalis IV 模组的全部改动**。
它会自动发现你已安装的模组，把上万个文件按「改动了游戏的什么内容」归类，并且能正确
**解码模组里的中文**（EU4 私有转义编码），最后按 wiki 的样子呈现出来。

**零依赖**：只用 Node.js 内置模块 + 原生 HTML/CSS/JS，没有 `npm install`，没有构建步骤。

| 改动总览 | 本地化（自动解码中文） |
|---|---|
| ![总览](docs/screenshot-overview.png) | ![本地化](docs/screenshot-localisation.png) |

| 脚本结构化视图 | 内嵌离线中文 wiki |
|---|---|
| ![脚本](docs/screenshot-script-tree.png) | ![wiki](docs/screenshot-wiki.png) |

### 🎮 游戏内格式预览

把**脚本文件与本地化文件对应起来**，按 EU4 在游戏里实际显示的样子渲染，**共 31 类内容**。
标签栏先按 6 个分组（内容 / 国家 / 宗教与经济 / 军事 / 世界 / 系统）收拢，一次只展开一组；
左侧选条目，右边就是「游戏里长什么样」，卡片下方是脚本 ↔ 本地化的对照表。

| 事件窗（含真实事件插图） | 决议 |
|---|---|
| ![事件](docs/screenshot-game-event.png) | ![决议](docs/screenshot-game-decisions.png) |

| 国家理念 | 理念组 |
|---|---|
| ![国家理念](docs/screenshot-game-national-ideas.png) | ![理念组](docs/screenshot-game-ideas.png) |

| 顾问 | 政策 |
|---|---|
| ![顾问](docs/screenshot-game-advisors.png) | ![政策](docs/screenshot-game-policies.png) |

| 任务树（游戏内网格） | 任务（单个任务 + 所属整棵树） |
|---|---|
| ![任务树网格](docs/screenshot-game-mission-trees.png) | ![任务](docs/screenshot-game-missions.png) |

| 政府改革 | 阶层 |
|---|---|
| ![政府改革](docs/screenshot-game-government.png) | ![阶层](docs/screenshot-game-estates.png) |

| 灾难 | 议会法令 |
|---|---|
| ![灾难](docs/screenshot-game-disasters.png) | ![议会与法令](docs/screenshot-game-parliament.png) |

| 单位与军事 | 建筑 |
|---|---|
| ![单位](docs/screenshot-game-units.png) | ![建筑](docs/screenshot-game-buildings.png) |

| 宗教 | 伟大工程 |
|---|---|
| ![宗教](docs/screenshot-game-religion.png) | ![伟大工程](docs/screenshot-game-great-projects.png) |

| 文化（全是引用芯片） | 地图（地区 → 省份） |
|---|---|
| ![文化](docs/screenshot-game-culture.png) | ![地图](docs/screenshot-game-map.png) |

| 科技等级（六维修正 + 解锁兵种） | 界面（GUI 控件树） |
|---|---|
| ![科技](docs/screenshot-game-technology.png) | ![界面](docs/screenshot-game-interface.png) |

| 君主特质（含作为君主/继承人/配偶时的条件与权重） | 将领特质 |
|---|---|
| ![君主特质](docs/screenshot-game-ruler-traits.png) | ![将领特质](docs/screenshot-game-leader-traits.png) |

其余各类（国家、叛军、时代、贸易、战争与和平、书签、修正、脚本效果、
行动指令）的截图同样在 `docs/screenshot-game-*.png`（共 32 张）。

![预览总览](docs/screenshot-game-overview.png)

### 🌐 双语界面 + ⚙ 设置

| 设置（中文） | 设置（English） |
|---|---|
| ![设置中文](docs/screenshot-settings-zh.png) | ![设置英文](docs/screenshot-settings-en.png) |

| 服务端文件夹选择器 | 关掉本地 wiki 后的说明 |
|---|---|
| ![选择器](docs/screenshot-settings-picker.png) | ![wiki 关闭](docs/screenshot-wiki-off-settings.png) |

---

## 快速开始

### 方式一：双击启动（推荐）

```bat
:: 在 eu4-mod-viewer 目录下，双击其中任意一个
启动.bat        :: 中文文件名
start.bat       :: 英文文件名，内容完全相同
```

### 方式二：命令行

```bat
node tools\launcher.js              :: 等同 npm start
node tools\launcher.js --lang en    :: 英文界面 + 英文控制台
node tools\launcher.js --port 4200  :: 换端口
node tools\launcher.js --help       :: 全部参数

npm start                           :: 需要 Node 18+
npm run start:en                    :: 英文界面
```

然后浏览器会自动打开 **http://127.0.0.1:4173**。关闭控制台窗口即停止服务。

> **参数一览**：`--lang zh|en`、`--port N`、`--host H`、`--no-open`、`--help`。
> 端口被占用时，启动器会先判断占用者是不是本程序：是就直接打开浏览器，不是就自动顺延到下一个空闲端口。

### 自动探测的位置

| 项目 | 位置 |
|---|---|
| 模组目录 | `%USERPROFILE%\Documents\Paradox Interactive\Europa Universalis IV\mod` |
| 游戏目录 | 自动探测各 Steam 库（含 `libraryfolders.vdf`）中的 `steamapps\common\Europa Universalis IV` |
| 离线中文 wiki | 自动扫描各盘符下名字含「wiki / 百科」且带 `wiki\` 子目录的文件夹 |

以上全部可以在网页右上角 **⚙ 设置** 里手动指定或关闭，见 [设置](#-设置)。

> 模组**只从「我的文档」里的 Paradox 模组目录读取**（依据 launcher 的 `.mod` 描述文件解析
> 真实路径，因此创意工坊模组也能正确定位到 `steamapps\workshop\content\236850\...`）。
> 不会扫描 F 盘的任何草稿目录。

---

## 功能

- **模组列表** —— 自动发现全部已安装模组（本地 + 创意工坊），显示版本、标签、依赖、体积。
- **改动分类总览** —— 把模组的上万个文件自动归入 35 个类别（省份 / 决议 / 事件 / 任务树 /
  理念 / 政府 / 宗教 / 地图 / 界面 / 本地化 …），每个类别显示文件数与体积。
- **文件树浏览** —— 按类别过滤的目录树，带文件大小。
- **内容渲染**，按文件类型自动选择：
  - **本地化 `.yml`** —— 自动解码为可读中文，键值对照表 + 实时筛选。
  - **Clausewitz 脚本 `.txt`** —— 解析成可折叠的**结构化树**（`potential` / `allow` /
    `effect` / `ai_will_do` …），并可一键切换原始文本。
  - **`.csv`** —— 表格化（如 `map/definition.csv`，自动识别 GBK 省名）。
  - **`.gui` / `.gfx`** —— 同样按脚本解析。
  - **图片** —— 浏览器可直接显示的格式就地预览；`.dds` 贴图（EU4 的绝大多数贴图）
    **由内置解码器实时解成 PNG**，事件插图、图标都能真正画出来。
  - 其余二进制（音频、模型等）—— 标注为资源文件，不做解析。
- **全文搜索** —— 同时搜索文件名、本地化键和本地化文本（中文可搜）。
- **🎮 游戏内格式预览** —— 见下节。**31 类内容**按 6 个分组排列，把脚本和本地化对应起来，
  渲染成游戏里真正看到的面板（事件窗、任务序列、政府改革面板、宗教页、兵种属性表…）。
- **双语界面** —— 整套 UI 可在**中文 / English** 之间随时切换，见下节。
- **wiki 关联可开关** —— 本地离线中文 wiki 与英文在线 wiki 各自独立启用/禁用、目录可手动选择，见 [设置](#-设置)。
- **可分享的地址** —— 视图写入 URL hash，刷新和分享都能回到同一个文件
  （`#mod/<id>/game/advisors/card/yangmingism_daru` 这样的深链也能直接打开对应内容）。

---

## 🌐 界面语言 / 中英文切换

点右上角的语言按钮（显示的是**要切换到的**语言）或到 **⚙ 设置 → 界面语言** 下拉框切换。
选择会同时写入浏览器 `localStorage` 和服务端 `config.json`，所以：

- 刷新页面后保持；
- 控制台启动器下次也用同一个语言输出；
- 每个 API 请求都带 `?lang=`，即使写配置文件失败，界面也不会退回中文。

语言切换会**立刻重绘当前视图**（不用刷新），且不会丢失你正在看的位置。

### 英文模式下「术语」怎么显示

中文词表由两部分拼成，**都在你自己的机器上，仓库里一份都没有**：

| 来源 | 内容 | 本机实测 |
|---|---|---|
| **你挂载的离线 wiki** | 运行时解析 `条件.html` / `命令.html` / `修正列表.html` 三页（`src/wikigloss.js`） | 条件 689 · 效果 394 · 修正 604 |
| `src/data/*-curated.js` | 手写补充，wiki 未覆盖的常用项 | 修正 267 · 效果 260 · 条件 18 |

合并后约为 条件 703 / 效果 502 / 修正 692 条，**只有中文，没有英文对照**。
所以英文模式下**不机翻**，而是显示 **EU4 脚本里的原始标识符**：

| 脚本 | 中文模式 | 英文模式 |
|---|---|---|
| `land_morale = 0.15` | `+15% 陆军士气修正` | `land_morale = +15%` |
| `manpower_recovery_speed = 0.15` | `+15% 后备人力恢复速度` | `manpower_recovery_speed = +15%` |
| `add_country_modifier = { name = X }` | `获得国家修正：X 的中文名` | `add_country_modifier = X` |
| `has_idea_group = humanist_ideas` | `有理念组 人文理念` | `has_idea_group = humanist_ideas` |

这不是偷懒：`land_morale` 正是**英文 EU4 wiki 和游戏脚本里的官方名字**，可以直接拿去搜索。
界面外壳（按钮、标题、字段名、作用域名、错误信息）在两种语言下都是完整翻译的。

---

## ⚙ 设置

右上角 **⚙ 设置** 打开设置面板，修改后点「保存」即时生效（无需重启）：

| 分组 | 可配置项 |
|---|---|
| **界面语言** | 中文 / English |
| **本地中文 Wiki** | 总开关；离线 wiki 目录（手动填写 / **浏览…** / **自动检测** / **验证**） |
| **英文在线 Wiki** | 总开关；在线 wiki 地址（默认 `https://eu4.paradoxwikis.com/`） |
| **路径设置** | 模组目录、游戏安装目录（留空则自动检测；改动后会重新扫描模组） |

- **浏览…** 打开服务端文件夹选择器：列出所有盘符与子目录，并给带有 `wiki\` 的目录打上
  `wiki` 标记、带 `mod\` 的目录打上 `mod` 标记，双击进入、单击选中。
- **自动检测** 扫描各盘符，列出所有看起来像 wiki 转储 / 模组目录 / 游戏目录的候选路径。
- **验证** 检查目录是否真的包含 `wiki\` 子目录，并报告页面数量。
- 两项 wiki 开关**互相独立**：可以只留英文在线 wiki，也可以只留本地中文 wiki，也可以都关掉。
  都关掉时，类别页会明确说明原因并给一个「打开设置」按钮，而不是显示成坏掉的功能。

设置保存在项目根目录的 `config.json`（已在 `.gitignore` 中）。想改默认值可以
复制 `config.example.json` 为 `config.json` 后手动编辑。

### 相关 wiki 页面

每个改动类别下方都会列出两类链接：

- **本地中文 wiki** —— 来自你配置的离线转储，点击在页面内嵌 iframe 打开，内部链接可以继续跳转；
- **英文 wiki** —— 指向 `eu4.paradoxwikis.com`，新标签页打开。

英文链接的页面标题取自英文 wiki 自己的 [Modding 导航模板](https://eu4.paradoxwikis.com/Modding)，
**57 个链接全部实测返回 HTTP 200**，不会 404。

---

## 🎮 游戏内格式预览

游戏里的界面和脚本文件是两个世界：玩家看到的是「事件窗」「任务面板」「政府改革列表」，
而模组作者写的是 `option = { name = ... add_stability = 1 }`。
这一层把两边接起来，**共 31 类内容，按侧栏的 6 个分组排列**
（内容 / 国家 / 宗教与经济 / 军事 / 世界 / 系统）——分组是可点的，一次只展开一组，
所以三十来个标签也不会挤成一片。下面按主题列出每一类渲染成什么：

**事件与决议 / Events & decisions**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **事件** | `events/` | 事件窗：插图（真的解码 `.dds`）+ 标题 + 正文 + 选项按钮（按钮下直接列出该选项的效果） |
| **决议** | `decisions/` | 决议卡：标题 + 说明 + 可决议条件 / 允许决议 / 决议效果 |
| **任务树** | `missions/`（按树） | 游戏内网格：一列一个 `slot`、一行一个 `position`，格子 104×152，箭头用游戏自带的 `gfx_arrow_*` 贴图按 GUI 坐标摆放；下方另有该树的任务清单 |
| **任务** | `missions/`（按任务） | 单个任务的条件与奖励，**并附上它所属的整棵树**，当前任务高亮 |
| **理念组** | `common/ideas/` | 理念组面板：传统 / 雄心 + 7 个理念（名称、描述、修正） |
| **国家理念** | `common/ideas/` | 同上，按 TAG 前缀与 `trigger` 自动区分 |
| **顾问** | `common/advisortypes/` | 顾问条目：行政/外交/军事色框 + 效果 + 等级缩放修正 |
| **政策** | `common/policies/` | 政策卡：君主点数类别 + 效果 + 解锁条件 |

**国家与政府 / Country & government**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **国家与政体** | `history/countries/`、`common/countries/` | 国家档案：开局君主/继承人、宗教文化、科技、历史事件时间轴 |
| **政府与改革** | `common/governments/`、`common/government_reforms/`、`government_mechanics/`、`subject_types/`、`factions/` 等 | 政体/改革面板：名称 + 说明 + 属性表（是否可联姻、是否有议会…）+ 修正 + 解锁条件 |
| **君主特质** | `common/ruler_personalities/`、`ancestor_personalities/` | 特质卡：名称 + 它给的修正 + 生效条件（`allow`）+ **分「作为君主 / 继承人 / 配偶时」列出各自的允许条件与出现权重**（`*_allow` 块里的 `chance`）。先祖特质同属一套结构，一并收录 |
| **议会与法令** | `common/parliament_issues/`、`decrees/`、`state_edicts/`、`trading_policies/` | 议会提案 / 法令条目：条件与效果 |
| **阶层** | `common/estates/`、`estate_privileges/`、`estate_agendas/` | 阶层面板：忠诚/影响力修正、特权、议程 |
| **叛军** | `common/rebel_types/`、`revolt_triggers/` | 叛军类型：名称、构成比例（步/骑/炮）、士气、起义概率与条件 |
| **灾难** | `common/disasters/` | 灾难面板：进度修正、`can_start` / `can_stop` / `can_end`、开始与结束效果、月度事件 |
| **时代** | `common/ages/` | 时代面板：起始年份、目标（objectives）与能力（abilities） |
| **伟大工程** | `common/great_projects/` | 工程面板：造价、工期、逐级（tier）的省份/地区/国家修正 |

**宗教与文化 / Religion & culture**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **宗教** | `common/religions/`、`church_aspects/`、`personal_deities/`、`fetishist_cults/`、`holy_orders/`、`incidents/` | 宗教组 → 所属宗教 → 信条/神祇/修会/事件，含异端与改革中心设定 |
| **文化** | `common/cultures/` | 文化组 → 所属文化：主流 TAG、图形文化、男/女/王朝姓名库 |

**经济与贸易 / Economy & trade**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **建筑** | `common/buildings/` | 建筑面板：造价、工期、省份修正、建成/拆毁时触发的效果 |
| **贸易** | `common/tradegoods/`、`tradenodes/`、`trade_companies/`、`prices/` | 商品/贸易节点/贸易公司/价格：修正、出现概率与条件、包含省份 |

**军事 / Military**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **单位与军事** | `common/units/`、`mercenary_companies/`、`naval_doctrines/`、`flagship_modifications/` | 兵种六维属性表、雇佣兵团、海军学说、旗舰改装 |
| **将领特质** | `common/leader_personalities/` | 将领性格卡：它给该将领所率部队的修正（`discipline`、`land_morale`…）+ `allow` 里的适用条件（`is_admiral` 区分陆军/海军将领） |
| **战争与和平** | `common/cb_types/`、`wargoal_types/`、`peace_treaties/` | 宣战理由：使用条件、战争目标与和平选项系数 |

**科技与理念 / Technology & ideas**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **科技与思潮** | `common/technologies/`、`institutions/` | 科技等级（行政/外交/军事 ± 级数）修正、思潮的加成与传播条件 |

**脚本 / Scripting**（游戏里没有独立面板，按引擎会生成的提示行渲染）

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **修正** | `common/static_modifiers/`、`event_modifiers/`、`triggered_modifiers/`、`opinion_modifiers/` | 修正自身包含的增减益清单 + 出现条件 |
| **脚本效果与条件** | `common/scripted_effects/`、`scripted_triggers/`、`scripted_functions/` | 可复用脚本：完整的条件/效果提示行 |
| **行动指令** | `common/on_actions/` | 游戏事件挂钩：触发时机 + 会执行的效果与事件列表 |

**世界 / World**

| 类型 | 脚本来源 | 渲染成什么 |
|---|---|---|
| **书签与开局** | `common/bookmarks/` | 书签：起始日期、可选国家与剧本 |
| **地图** | `map/` | 地区 / 区域 / 大区 / 大洲 / 地形 / 气候的定义与从属关系 |
| **界面与 GUI** | `interface/*.gui` | GUI 窗口的控件树（控件类型、名称、坐标/尺寸/sprite），以及窗口里 `buttonText` 指向的本地化文本 |

> 上面没列的东西（省份历史、图形与模型、本地化、音乐音效、模组定义等）不在这一层里，
> 它们在「文件浏览」里按类别查看：这些类别要么是二进制资源，要么本身就是文本/图片查看器
> 已经能完整呈现的东西，硬做「游戏内格式」反而会失真。

### 任务树：按游戏里的样子排版

任务面板是模组作者最常改、也最难一眼看懂的部分，所以它单独实现（`src/content/missions.js`），
**每一个数字都来自游戏自己的文件，没有一处是照着截图手调的**：

| 要素 | 依据 |
|---|---|
| 列 | 每个任务序列块上的 `slot = N`。列数上限取自生效的 `countrymissionsview.gui` 里的 `max_slots_horizontal`，并硬性封顶 11 |
| 行 | 任务块上的 `position = N`；**没写 `position` 的模组不少**（原版 `Aragonese_Missions.txt` 就一个都没写），这时按该序列内的出现次序 |
| 连线 | `required_missions`。同列用竖直箭头贴图，跨列在目标行上方转弯，用左右进/出贴图 |
| 格子 104×152、任务框 103×123、图标 (22,20)、标题 (8,84)、角标 (0,7)/(70,7) | 全部读自 `countrymissionsview.gui` 的 `slotsize` 与 `mission_entry` 定义 |
| 箭头贴图 | 游戏自带的 `gfx_arrow_*`（`verticall_tile` / `end` / `left_out` / `right_in` / `horizontal_skip_slot` …），经 `.gfx` 精灵索引从**用户自己的安装目录**取用，因此不随本项目分发任何美术资源 |

**GUI 是从模组优先读的**，因为模组可以覆盖它——本工作区的测试模组就覆盖了
（把任务列表框从 518px 加宽到 1090px），所以列数不是硬编码的 5，也不是 11。

任务树的形状有三种情况会偏离「一条竖线往下走」，项目选择**如实标注而不是画得好看**：

- **slot 与 position 冲突**：同一个格子里塞了两个以上任务（本模组有 79 处，其中
  `SC_haiwai_expansion_1/2/3` 三个任务都写 `position = 12`）。网格把它们错开显示并标红。
- **前置指向下方**：`required_missions` 指向 position 更大的任务。游戏只带了朝下的箭头贴图，
  所以这里用同一张贴图翻转表示，并注明有多少条。
- **前置指向同一格 / 指向本树之外**：前者没有方向可画，后者通常是模组里两套互斥任务树
  互相引用（如 `Byzantine_Missions.txt` 的两棵树），游戏里只会有一套生效。

`src/content/missions.js` 里还识别出一类**空壳序列**（只写了 `slot` 和 `potential`、一个任务都没有，
本模组有一处），它不会变成一个点开是空白的面板。

### 它做了哪些「翻译」

1. **修正 → 游戏里的增减益行**
   `discipline = 0.05` → `+5% 训练度`（绿色）；`core_creation = -0.25` → `−25% 建造核心花费`（绿色，
   因为这类修正「负数才是好事」，代码里有一张反向表 + 命名模式兜底）。
   加法/乘法（该不该显示成百分比）取自 wiki 修正表的「效果类型」列。
   词表里没有的修正**原样打印脚本里的数值**——按默认值猜会印出假数字
   （`prestige = 10` 显示成 `+1000%`），这比丢一个标签严重得多。

2. **效果 → 游戏里的提示行**
   识别事件触发（`country_event` → 显示该事件的**真实标题**并可点击跳转）、
   限时修正（`add_country_modifier` → 显示修正中文名 + 持续时间，**并把修正自身的增减益一并列出**）、
   阶层特权、标记、变量、`if/else`、`random_list`、`every_*` 作用域遍历（→「对每个国家」）……
   其余命令用中文词表（运行时读自你挂载的离线 wiki）标注，词表没有的**原样显示并标记为未收录**，绝不编造。

3. **条件 → 可读的要求清单**
   `AND/OR/NOT` → 「且（全部满足）／或（满足其一）／非（不满足）」，
   `has_idea_group = X` → 「有理念组 *X 的中文名*」，`owns_core_province = 5241` → 「拥有核心省份 滁州」。

4. **本地化标记 → 真正的排版**
   `§Y…§!` 色码、`£icon_name£` 图标（**从 `interface/*.gfx` 查 sprite 并解码贴图真正画出来**）、
   `\n` 换行、`$KEY$` 引用（递归解析并在对照表里标出来源文件行号）、
   `[Root.GetName]` 动态文本（渲染成带说明的占位符）、`$COUNTRY$` 这类引擎关键字同样单独标注。

5. **脚本 ↔ 本地化对照表**
   每张卡片下方列出：脚本字段 → 本地化键 → 游戏显示的文本 → **来源文件:行号**，
   并区分模组本地化与原版本地化，点文件名可直接跳到那个 `.yml`。
   表里也包含**渲染过程中解析出的名字**——科技等级解锁的兵种、宗教组里的各宗教、
   阶层影响力条目的 `desc` 键、GUI 窗口按钮的 `buttonText`，所以 31 类里绝大多数
   都能看到「这条中文是从哪个键来的」。

6. **AI 权重 → 「×N 当满足……」**
   `ai_will_do` / `chance` / `spawn_chance` 这类块不是效果，而是权重：
   `factor` 渲染成「基础权重 = N」，每个 `modifier = { factor = 2 … }` 渲染成
   「×2 当满足：」加它自己的条件行——这正是游戏提示里乘算的含义。

### 通用卡片是怎么画出来的

除最早六个类型是手写面板外，其余 17 类共用一台「通用引擎」：描述符只声明
「读哪个目录、名字在哪个本地化键、哪些键是修正/条件/效果」，引擎把每个子块归类成
`mod`（增减益行）、`cond`（要求清单）、`eff`（效果提示行）、`weight`（权重）、
`list`（可点击的引用芯片）、`entries`（带名字和数值的重复条目）、`blocks`（嵌套定义，
比如伟大工程的 tier）、`fields`（全标量的设置表）、`raw`（引擎无法措辞的原始脚本）。
所以再加一类内容，通常只是加十几行描述符，前后端都不用动。

分类只按**节点类型 + 键名模式**判断，不做语义猜测：无法归类的块一律走 `raw`，
把脚本原样排好并注明「游戏内不会显示原始脚本」。宁可显示原文，也不假装读懂。

### 为什么「理念组的名字」有时是英文

模组只覆盖了它自己翻译过的键。没有覆盖的键会回落到**原版游戏本地化**（原版是英文），
对照表里会显示 `原版` 标签和真实来源文件，所以你能一眼看出「这条是模组翻译的」还是「这条其实来自原版」。

### `.dds` 贴图

EU4 的贴图基本都是 `.dds`，浏览器不能直接显示。本项目**自带一个零依赖的 DDS 解码器**
（`src/codec/dds.js`，支持 DXT1/BC2/DXT3/DXT5/未压缩 BGRA，自写 PNG 编码器），
所以事件插图、决议图标、`£icon£` 图标都是**真的画出来的**，不是占位符。
测试见 `tools/test-dds.js`（267 项断言，含真实贴图往返比对）。

---

## 中文解码：这是本项目最核心的部分

EU4 的本地化数值**只接受 Latin-1 范围内的字节**，所以中文不能用普通 UTF-8 保存。
模组里的文本实际有**多种形态**，必须区分对待：

| 形态 | 出现位置 | 处理方式 |
|---|---|---|
| 纯 UTF-8 | 原版英/法/德/西本地化 | 直接读取 |
| **转义 + CP1252 双层** | 部分模组 `*.yml` | 先按 UTF-8 读出，再把每个码元经 CP1252 表映射回原始字节，然后按转义规则解码 |
| **转义 + 原始字节** | `common/`、`history/`、`events/` 脚本 | 文件常是**非法 UTF-8**，直接按原始字节解码 |
| CP1252 | 大量 `history/` 省名（如 `Logroño`） | 逐字节读取 |
| GBK | `map/definition.csv`、更新日志 | 用 gb18030 解码 |

转义规则（与 matanki-saito 的 [EU4dll](https://github.com/matanki-saito/EU4dll) 双字节补丁一致）：

```
每个字符 = [lead] [low] [high]
  lead  ∈ 0x10..0x13   （= 0x10 + 2*(high 属保留字节) + 1*(low 属保留字节)）
  value = low | (high << 8)
  lead & 1  ->  value -= 0x0E
  lead & 2  ->  value += 0x900
```

由于这些形态**互相重叠**（同一个字节既可能是原始字节，也可能是某段 UTF-8 序列），
解码器不是靠猜规则，而是**把每一种读法都解出来、按「文本可信度」打分取最优**。
参见 `decodeBest()`。这样做的必要性有两处实打实的教训：

- `10 CC 91` 按原始字节读是 **里**（U+91CC），但若把 `CC 91` 当成 UTF-8 就变成 `∑`（U+2211）。
- `Logroño` 里的 `ñ`（0xF1）若被当成 4 字节 UTF-8 序列的开头，会解出私用区字符 U+F88D，
  **吃掉后面的引号**，进而毁掉整个文件。

同时解析器遵循「Clausewitz 字符串不跨行」这一事实：**引号若在本行内没有闭合就当作字面量**，
因此即便某个字节解码有误，也绝不会吞掉后续所有内容。

**如果跳过 CP1252 那一层，会得到「看起来像中文但其实是错的」结果**
（例如 `江户城` 会变成 `汭户城`），所以这一步是必须的。

实现见 `src/codec/localisation.js`（`decodeBest()` 为自动判别入口）。

已用真实文件校验（逐字比对通过）：

```
mount_fuji            浅间神社
sankin_kotai_palaces  江户城
grand_canal_1         江南运河——杭州段
CE_torre_di_Pisa      比萨斜塔
成吉思汗金顶大帐 / 长城——宁夏镇 / 大报恩寺  …
```

---

## 目录结构

```
eu4-mod-viewer/
├─ 启动.bat                 一键启动（中文文件名）
├─ start.bat                一键启动（英文文件名，内容相同）
│                           ↑ 两者都是「纯 ASCII + CRLF」，本地化文字全部由 Node 输出
├─ config.example.json      设置默认值模板（复制成 config.json 可手改）
├─ CONTRIBUTING.md          三条硬规矩：不打包游戏资源 / wiki 内容 / 第三方依赖
├─ README.en.md             英文版 README
├─ src/
│  ├─ server.js             HTTP API + 静态资源 + 离线 wiki 挂载 + 贴图/DDS 解码
│  ├─ config.js             ★ config.json 读写、默认值合并、目录自动探测
│  ├─ i18n.js               ★ 后端语言层（L/pick/msg），决定中文还是英文标签
│  ├─ mods.js               模组发现与扫描（.mod 描述文件解析、文件遍历、分类统计）
│  ├─ fileview.js           单文件读取与内容组装
│  ├─ taxonomy.js           34 个改动类别与路径匹配规则（中英标签 + 中英描述）
│  ├─ wiki.js               ★ 离线中文 wiki 解析 + 英文 wiki 深链映射（可配置/可关闭）
│  ├─ gameloc.js            ★ 本地化索引（模组 replace → 模组 → 原版，含键的来源文件与行号）
│  ├─ gamedata.js           ★ 内容类型总装配（类型顺序、合并元数据、索引缓存、卡片分发）
│  ├─ content/              ★ 每一类内容一个描述符
│  │  ├─ legacy.js            最早六个类型的手写渲染器（事件/决议/理念/顾问/政策）
│  │  ├─ registry.js          其余 25 类的描述符（19 类走通用引擎，6 类另有构建器：任务树/任务/国家/书签/地图/界面)
│  │  ├─ missions.js          ★ 任务树：读 slot/position/required_missions，按 GUI 几何与箭头贴图排版
│  │  └─ common.js            通用引擎：索引枚举、字段归类、卡片组装、贴图解析
│  ├─ gametext.js           ★ §色码 / £图标£ / $KEY$ / [动态] 标记解析
│  ├─ gameterms.js          ★ 修正 / 条件 / 效果 → 游戏内文本（词表驱动，双语）
│  ├─ wikigloss.js          ★ 运行时解析你本机离线 wiki 的 条件/命令/修正列表 三页（不随仓库分发）
│  ├─ data/                 中文词表（仓库里**只有手写的那一半**）
│  │  ├─ modifiers-curated.js 手写补充的修正名 + 显示方式（百分比 / 平值 / 布尔）
│  │  └─ effects-curated.js   手写补充的效果名（wiki 的效果页没有中文名列）
│  └─ codec/
│     ├─ localisation.js    ★ EU4 本地化/私有中文编码编解码
│     ├─ script.js          ★ Clausewitz 脚本词法 + 语法分析器
│     └─ dds.js             ★ 零依赖 DDS → RGBA → PNG 解码器
├─ web/
│  ├─ index.html
│  ├─ style.css             wiki 风格 + 游戏内面板样式 + 设置面板/文件夹选择器样式
│  ├─ i18n.js               ★ 前端语言层（t / setLang / applyStatic），词典按中文字符串索引
│  ├─ i18n.app.js           ★ web/app.js 的英文词典
│  ├─ i18n.game.js          ★ web/gameview.js 的英文词典
│  ├─ settings.js           ★ 设置面板 + 服务端文件夹选择器 + 语言切换按钮
│  ├─ app.js                前端渲染（分类、文件树、脚本树、本地化表、wiki 面板、搜索）
│  └─ gameview.js           ★ 游戏内格式预览：分组导航 + 六个专用面板 + 通用卡片渲染器
├─ docs/
│  ├─ loc-key-conventions.md  本地化键约定与各类型在游戏中的渲染顺序（含实测命中率）
│  ├─ GITHUB.md               上传到 GitHub 的图文步骤
│  └─ screenshot-*.png        截图（每类内容一张）
└─ tools/
   ├─ launcher.js            ★ 控制台启动器（双语横幅、端口探测、自动开浏览器）
   ├─ run-tests.js           ★ 测试总入口（core / mods / e2e 三档，带 SKIP 判定）
   ├─ i18n-audit.js          ★ 扫描前端源码，报告「还没包进 t() 的中文字面量」
   ├─ test-codec.js         编解码 + 解析器测试（57 项）
   ├─ test-i18n-backend.js  后端双语层测试（66 项，中文字符串逐字比对旧输出）
   ├─ test-dds.js           DDS 解码器测试（267 项断言，含真实贴图往返比对）
   ├─ test-scan.js          模组发现与扫描测试
   ├─ test-all-mods.js      全部模组、全部类别的覆盖测试
   ├─ test-gamedata.js      最早六个类型的内容抽取与卡片渲染检查
   ├─ test-content-types.js ★ 全部 31 类：索引有记录、卡片非空、标题可读、英文界面无中文（252 项）
   ├─ test-missions.js      ★ 任务树版式：slot/position/连线语义 + GUI 几何对照（297 项）
   ├─ test-wikigloss.js     ★ 词表只从你的 wiki 解析、不许编造；无 wiki 时可降级（59 项）
   ├─ test-fidelity.js      解析器保真度校验（源文件键 vs 解析结果）
   ├─ verify-wiki.js        DevTools 协议驱动 Edge 验证 wiki 内嵌渲染
   ├─ verify-game.js        DevTools 协议驱动 Edge 逐类验证游戏内预览 + 生成截图（210 项）
   └─ verify-i18n.js        DevTools 协议驱动 Edge 验证语言切换 / 设置 / wiki 开关（55 项）
```

---

## HTTP 接口

除 `/wikifile/*` 外，所有接口都接受 `?lang=zh|en` 覆盖服务端语言设置。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | 扫描状态、模组数、路径、wiki 状态 |
| GET | `/api/mods` | 全部模组摘要（含类别统计） |
| GET | `/api/refresh` | 重新扫描 |
| GET | `/api/config` | 当前设置 + 自动探测结果 + wiki 状态 |
| POST | `/api/config` | 保存设置（部分更新），并即时应用（重建 wiki 索引 / 路径变了就重新扫描） |
| GET | `/api/mod/:id` | 单个模组详情 |
| GET | `/api/mod/:id/tree` | 目录树（带分类标记） |
| GET | `/api/mod/:id/files` | 扁平文件列表（可按 `?category=` 过滤） |
| GET | `/api/mod/:id/file?path=` | 单个文件内容（自动解码 + 解析） |
| GET | `/api/mod/:id/search?q=` | 模组内搜索 |
| GET | `/api/mod/:id/thumbnail` | 模组封面 |
| GET | `/api/mod/:id/tex?path=` | 贴图；`.dds` 会被**实时解码成 PNG** 再返回 |
| GET | `/api/mod/:id/icon?name=` | 解析 `£name£` / `GFX_name` sprite 并返回图标 PNG |
| GET | `/api/mod/:id/game/index` | 游戏内预览：内容索引、按语言排好的 `typeList` 与分组、统计 |
| GET | `/api/mod/:id/game/list?type=&q=&file=&offset=&limit=` | 某一类内容的列表（可按文件过滤） |
| GET | `/api/mod/:id/game/card?type=&id=` | 某个条目的「游戏卡片」（含本地化对照） |
| GET | `/api/mod/:id/game/search?q=` | 全部内容类型内搜索 |
| GET | `/api/wiki/status` | 离线 wiki 状态（启用与否、目录、页面数、失败原因） |
| GET | `/api/wiki/page?name=` | 读取并净化一个 wiki 页面 |
| GET | `/api/wiki/search?q=` | wiki 页面名搜索 |
| GET | `/api/wiki/suggest?category=` | 类别 → `{local: 本地中文页面, online: 英文 wiki 链接}` |
| GET | `/api/wiki/detect` | 自动探测到的 wiki 候选目录 |
| GET | `/api/wiki/validate?dir=` | 校验某个目录是不是可用的 wiki 转储，并返回页面数 |
| GET | `/api/fs/list?path=` | 服务端文件夹选择器（仅限本机请求；顶层返回盘符列表） |
| GET | `/wikifile/*` | 离线 wiki 的 css/js/图片资源 |

---

## 测试

```bat
node tools\run-tests.js             :: 总入口：core 档（不需要装游戏）
node tools\run-tests.js --tier=mods :: core + 需要已安装 EU4 模组的测试
node tools\run-tests.js --all       :: 全部，含需要启动服务和 Edge 的端到端检查
node tools\run-tests.js --list      :: 只列出测试计划

npm test                            :: 等同 node tools\run-tests.js
```

也可以单独跑：

```bat
node tools\test-codec.js          :: 编解码 + 解析器（57 项）
node tools\test-i18n-backend.js   :: 后端双语层（66 项，中文字符串逐字比对旧输出）
node tools\test-dds.js            :: DDS 解码器（267 项断言，含真实贴图往返逐像素比对）
node tools\test-gamedata.js       :: 最早六个类型的内容抽取与卡片渲染
node tools\test-content-types.js  :: 全部 31 类内容：索引有记录、卡片非空、标题可读（252 项）
node tools\test-missions.js       :: 任务树版式：slot/position/连线语义 + GUI 几何对照（297 项）
node tools\test-wikigloss.js      :: 词表解析自你的离线 wiki + 无 wiki 时的降级（59 项）
node tools\test-fidelity.js       :: 校验解析器未丢失内容（键级比对）
node tools\test-all-mods.js       :: 全部 11 个模组、19,242 个文件的覆盖测试
node tools\verify-wiki.js         :: 用 Edge + DevTools 协议做端到端界面验证
node tools\verify-game.js         :: 逐类验证游戏内预览并生成截图
node tools\verify-i18n.js         :: 语言切换 / 设置面板 / wiki 开关端到端验证并生成截图
node tools\i18n-audit.js check    :: 审计：t() 键是否都在词典里、是否有中文字面量漏包
node tools\i18n-audit.js extract  :: 列出前端所有中文字面量及其包裹情况
```

实测结果（全部 11 个模组）：

| 指标 | 结果 |
|---|---|
| 模组 / 文件总数 | 11 / 19,242 |
| 抽样文件 | 1,370 |
| 载入失败 | **0** |
| 脚本解析失败 | **0** |
| 键丢失率 | **0.01%**（29,532 个键中缺失 4 个，均为把中文说明文档误当配置的误报） |
| 编码分布 | plain-utf8 864、escaped-raw 205、escaped-cp1252 182、gbk 63、cp1252 24、escaped-utf8 2 |
| 测试总入口 | `node tools/run-tests.js --all` → **13 passed / 0 failed / 0 skipped** |

主测试模组 `1.37 Celestial empire on which the sun never sets`（9,512 个文件 / 493 MB）的游戏内预览实测：
**31 类内容共抽取出 20,936 条记录，0 个文件读取失败。**

| 分组 | 各类条数 |
|---|---|
| 事件与决议 | 事件 4,050 · 决议 618 · 任务树 235 · 任务 3,875 · 理念组 107 · 国家理念 615 · 顾问 55 · 政策 135 |
| 国家与政府 | 国家 625 · 政府/改革 456 · 议会法令 38 · 阶层/特权 275 · 叛军 126 · 灾难 41 · 时代 5 · 伟大工程 203 |
| 宗教与文化 | 宗教/信条/神祇 374 · 文化 600 |
| 经济与贸易 | 建筑 54 · 商品/节点/公司 172 |
| 军事 | 单位/雇佣兵/学说 504 · 宣战理由/战争目标 115 |
| 科技与理念 | 科技等级 134 |
| 脚本 | 修正 2,746 · 脚本效果/条件 2,748 · 行动指令 70 |
| 世界 | 书签 15 · 地图定义 1,575 · GUI 窗口 348 |

| 其它指标 | 结果 |
|---|---|
| 模组本地化键 | 36,344（原版另有 136,579 键作为回退） |
| 中文词表 | 修正 692 · 条件 703 · 效果 502（运行时读自本机离线 wiki + 手写补充；仓库内**只有手写那一半**） |
| 索引耗时 | 约 4.5 秒（进程内缓存，首次含原版 136,579 键的惰性装载） |

双语相关实测：

| 指标 | 结果 |
|---|---|
| 英文词典条目 | 共 **383** 条（核心 + `i18n.app.js` + `i18n.game.js`），**0 条缺失、0 条含中文** |
| 词典审计 | `node tools/i18n-audit.js check` → 0 missing / 0 unexplained / 0 CJK value |
| 后端双语 | `gameterms.js` 277 处 + `gametext.js` 49 处 `L()` 配对 |
| 中文回归 | 后端测试把中文字符串与改动前的输出**逐字比对**，完全一致 |
| 英文 wiki 链接 | 57 个唯一链接全部实测 **HTTP 200** |
| 界面端到端 | `verify-i18n.js` **55 / 55**（语言切换、刷新保持、`?lang=` 注入、设置面板、文件夹选择器、两种 wiki 开关、错误恢复） |
| 游戏预览端到端 | `verify-game.js` 逐类检查 31 种面板（**210 项**）并生成 32 张截图 |

环境变量可覆盖自动探测：`EU4_USER_DIR`、`EU4_INSTALL_DIR`、`EU4_WIKI_DIR`、
`EU4_MOD_VIEWER_LANG`、`EU4_MOD_VIEWER_CONFIG`、`PORT`、`HOST`。

---

## 已知限制

- 转义规则对极少数生僻字约 99% 准确（模组自身字体为准），个别字可能显示为 `¿` 或 `…`。
- 地图图像（`provinces.bmp`、`heightmap.bmp` 等）只统计不渲染，因为需要专门的调色板解析。
- DDS 解码支持 DXT1/DXT3/DXT5 与未压缩 BGRA/BGR；DX10、BC5/ATI2 等格式会明确返回「不支持」而不是画错。
- `.tga`（旗帜等）浏览器不能直接显示，会用占位提示说明。
- 游戏内预览是**静态还原**：触发条件是「要求清单」，不是运行时的红绿判定结果；
  动态文本（`[Root.GetName]`）与引擎关键字（`$COUNTRY$`）会标注为运行时求值，不会假装知道它们的值。
- 词表未收录的命令/修正会**原样显示并标注「词表中未收录」**，宁可显示脚本原文也不编造中文；
  数值也**按脚本原样打印**，不会按默认的百分比约定乘 100（那会印出 `prestige = 10` → `+1000%` 这种假数字）。
  词表来自你挂载的离线 wiki：**没挂 wiki 时**这些名字会大量退化为脚本标识符，界面顶部横幅会写明当前来源。
  通用卡片里无法归类的子块会整块走 `raw`（原始脚本缩进排版），卡片越长越可能看到它——
  这是刻意的，不猜。
- `$VAL$`、`$VALUE$` 这类**运行时占位符**不会被当成同名本地化键替换。
  `EST_VAL_*` 阶层提示里 `$VAL$` 是引擎填的数值，而 `VAL` 恰好是瓦伦西亚的国家 TAG，
  按本地化解析会显示成「Valencia」；这些名字现在按运行时求值标注。
- 英文模式下的术语显示为**脚本原始标识符**（见 [界面语言](#-界面语言--中英文切换)），不做机器翻译；
  中文 wiki 的 `desc` 列没有英文对照，因此该处英文模式显示 `(Chinese wiki text)` 占位。
- `.bat` 启动脚本被刻意限制为**纯 ASCII + CRLF**：cmd.exe 按 OEM 代码页读取批处理文件，
  放中文会被解析错乱——这正是旧版本双击打不开的原因。所有中文提示改由 Node 输出。
  仓库里的 `.gitattributes` 强制 `.bat` 检出时保持 CRLF，**请不要改成 LF**。
- 只做**静态**分析：不运行游戏，不修改任何文件。

---

## 许可

[MIT](LICENSE) © 2025–2026 SAHHakuryuu

想把项目发布到 GitHub？见 **[docs/GITHUB.md](docs/GITHUB.md)**（两条路线：网页上传 / Git 命令行，
含 `.gitattributes` 强制 CRLF 的注意事项）。参与开发前请读 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

**这个仓库里没有别人的东西**，这一点是刻意维持的：

| 内容 | 在仓库里？ | 说明 |
|---|---|---|
| 游戏资源（贴图 / GUI / 本地化） | ❌ | 运行时从你自己的 EU4 安装目录读取 |
| 离线中文 wiki 的内容 | ❌ | 运行时从你挂载的那份 wiki 解析（`src/wikigloss.js`）；它是 **CC BY-NC-SA 4.0**，抽出来入库会把整个项目拖进「非商业性使用」 |
| 中文词表（手写那一半） | ✅ | `src/data/*-curated.js`，原创，MIT |
| 第三方代码 / 依赖 | ❌ | `dependencies` 为 `{}`，只用 Node 内置模块 |
| 截图 | ✅ | `docs/screenshot-*.png`，由本项目的验证脚本生成 |

《Europa Universalis IV》及其素材是 Paradox Interactive 的商标与版权物。
EU4 与 Europa Universalis 是 Paradox Interactive 的商标。