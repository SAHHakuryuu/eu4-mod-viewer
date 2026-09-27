# EU4 1.37 脚本 → 屏幕文本 映射参考（loc key 约定 / 渲染顺序 / 标记语法）

回答一个问题：**读到一个脚本字段，浏览器该查哪个本地化键、按什么顺序画到屏幕上。**
每条键约定都附实测命中率与真实 key→中文 样例；无实测支撑的说法显式标注
`wiki 说法，未在本模组中验证`。

---

## 0. 数据来源与验证方法

| 项 | 值 |
|---|---|
| 游戏版本 | `release_1.37.5`（`E:\SteamLibrary\steamapps\common\Europa Universalis IV`，`eu4_rev.txt` = `835bfdf8ca24c291a1b3f1b5bc72d47e7df1ae18`） |
| vanilla loc 语料 | 126,744 条（`localisation/*_l_english.yml`） |
| 模组 | `1.37 Celestial empire on which the sun never sets`（`supported_version="v1.37.*"`） |
| 模组 loc 语料 | 36,344 条（`localisation/replace/*_l_english.yml`，正文中文） |
| 工具 | `src/codec/localisation.js`（`decodeBuffer` / `parseLocalisation`）＋ `src/codec/script.js`（`parseScript`） |
| 扫描规模 | vanilla：事件 6,366 / 决议 516 / 理念组 555 / 理念 3,884 / 顾问 21 / 政策 203；模组：4,050 / 618 / 722 / 5,054 / 55 / 135 |
| UI 硬证据 | `interface/{eventwindow,countrydecisionsview,countryideasview,countrycourtview}.gui`（1.37.5 原文件，控件名即渲染顺序） |
| wiki | 离线 `F:\20240820_Eu4离线wiki_1.37v2\wiki\*.html`；英文 wiki 仅交叉验证 [Event_modding](https://eu4.paradoxwikis.com/Event_modding) |

**前提**：模组只有 `localisation/replace/`，文件名（`CE_*`/`BM_*`）与 vanilla **不同名**，所以是**追加**而非覆盖 → 做"翻译视图"必须 **合并模组 loc + vanilla loc** 查表，只查模组会漏掉大量键（例：`alaska_nation_title` 在 vanilla 里是 `Form Alaska`）。

---

## 1. 通用约定（先读这一节）

### 1.1 loc 文件格式

```yaml
l_english:
 CE_guanliaotewu:0 "官僚特务机构"
 desc_CE_guanliaotewu:0 "成立官方的特务机构，监视大小官员，防止他们做出违法的事情。"
```

首行 `l_<语言>:` 声明语言块，条目行必须以空格开头；`<key>:<版本号> "<正文>"`，**版本号可省略**。只有引号内正文会显示。文件名必须是 `<名>_l_<语言>.yml`。本模组**所有**文件都叫 `_l_english.yml` 而内容是中文（英文槽装中文）→ **语言推断不能看文件名，要看正文 CJK 比例**。

### 1.2 后缀 vs 前缀（最容易搞错的地方）

| 形式 | 用于 | 实测 |
|---|---|---|
| `<key>_desc`（**后缀**） | 顾问、单个理念、宣战理由、政体、阶层、修会、贸易政策、海军学说 | vanilla 顾问 21/21、理念 3,884/3,884；模组 55/55、5,054/5,054 |
| `desc_<key>`（**前缀**） | **政策**、修正、灾难、统治者特质、崇敬物 | vanilla 政策 203/203；模组 134/135 |
| `<key>_title`（后缀） | **决议**、任务、诏书、事变、孤立主义 | vanilla 决议 516/516；模组 616/618 |
| `<key>_tooltip` / `_alert_tooltip` | 决议（可选） | vanilla 6 / 0；模组 7 / 0 |
| `<group>_start` / `<group>_bonus` | 理念组的传统 / 野心 | vanilla 529/530、554/555；模组 710/710、722/722 |

> 离线 wiki `本地化.html`「参考资料」表写法一致（`政策：<policy>，desc_<policy>`）。

### 1.3 引擎不"推导"键，只"查"键

引擎**不会**从标识符自动拼 loc key，它只把脚本里**字面写着**的那个字符串拿去查表。
所谓 `<id>.t` 约定，指的是 1.37 官方写法把 `title = <id>.t` 这串字面写在脚本里。
浏览器做法：**先读字段值当 key 查表；查不到再按约定生成候选，并标注为「推断」**。

---

## 2. 事件 (event)

### 2.1 脚本位置与顶层形状

`events/*.txt`（模组 104 文件）。文件顶部可选 `namespace = <名>`；文件体是**平铺重复块**
`country_event = { … }` / `province_event = { … }`，**无整体包裹键**。

| 字段 | 次 | 说明 | 字段 | 次 | 说明 |
|---|---|---|---|---|---|
| `id` | 4050 | 唯一 ID `<命名空间>.<数>`，必填 | `after` | 317 | 任意选项被选后都执行 |
| `title` | 4050 | 标题 loc **键**（不是文本） | `goto` | 187 | 选项旁"定位省份"按钮；实测值只有 `root`/`war_province` 类标识符 |
| `desc` | 4390 | 描述 loc 键；可写多份带 `trigger` 的条件描述块 | `hidden` | 61 | `yes` = 后台触发不弹窗 |
| `picture` | 4201 | 图片名（`gfx/event_pictures` + `interface/*eventpictures*.gfx` 的 `name =`）；也可条件块 | `is_mtth_scaled_to_size` | 56 | 省份事件 MTTH 随拥有者省份数放大 |
| `option` | 8841 | 选项块，**顺序即显示顺序** | `major_trigger` | 25 | 只让满足条件的国家收到 `major` 广播 |
| `trigger` | 2311 | 触发条件，全真才可能触发 | `is_triggered_only` | 3071 | `yes` = 只能被脚本/on_action 触发 |
| `fire_only_once` | 2014 | `yes` = 全局只发生一次 | `mean_time_to_happen` | 1973 | 平均触发时间 + `modifier` |
| `major` | 1531 | `yes` = 选完把通知广播给所有国家 | `immediate` | 1171 | 弹出即执行，默认显示在描述下方 |

`option` 块字段：`name` 8831（选项文字 loc 键）、`trigger` 3017（不满足则**该选项不显示**）、
`ai_chance` 2858（内部）、`if`/`else_if`/`else` 2555/96/246、`hidden_effect` 1800、
`custom_tooltip` 1144、`highlight` 213（按钮高亮），其余为效果指令。

### 2.2 loc key 约定（实测）

| 目标 | 1.37 官方写法 | 实测 |
|---|---|---|
| 标题 | `title = <id>.t` → 键 `<id>.t` | vanilla 6,366 事件中 **4,466** 个 title 字面等于 `<id>.t`，601 个是旧式 `EVTNAME<id>`，1,299 个其它自定义键；**键在 loc 中存在**：vanilla 6,356/6,366、模组 4,019/4,050 |
| 描述 | `desc = <id>.d` | vanilla 3,758 个字面等于 `<id>.d`；键存在 vanilla 6,120/6,366、模组 3,866/4,050 |
| 选项 | `name = <id>.a`/`.b`/`.c`… | 模组 8,841 选项里 **3,196** 个字面等于 `<id>.<位置字母>`；后缀频率：`.a`2227 `.b`1091 `.c`305 `.d`36 `.e`63 `.f`38…；另有数字式 `.1`1289 `.2`651 |
| 条件描述 | `desc` 写成块时，每子块自带 `desc = "<自己的键>"`，键名任意 | 模组 151 个事件用条件 desc 块 |

**字母按选项在块中出现的次序给**（第 1 个 = `.a`），不是按 modder 偏好。

**选项名缺失时的行为**：引擎回退到 `<id>.<位置字母>`。vanilla 证据：`flavor_tim.13` 第 1 个 `option` 无 `name`，loc 有 `flavor_tim.13.a` = `AI Event`；`MEE_Byzantine_Events.28` 第 5 个 `option` 无 `name`，loc 有 `MEE_Byzantine_Events.28.e` = `I need to consult the Strategikon.`。vanilla 64 个无 `name` 选项里 58 个属于 `hidden = yes` 事件（本就不显示，所以从未建键）。→ **`hidden = yes` 的事件不要为选项生成待补文本。**

### 2.3 游戏内渲染（`interface/eventwindow.gui`，564×620 居中）

| 序 | 控件 | 内容 | 来源字段 |
|---|---|---|---|
| 1 | `event_bg_top` | 顶部装饰条 | 固定素材 |
| 2 | `Title`（`vic_29s`，居中，`maxWidth=656`） | **金色标题** | `title` 的 loc |
| 3 | `event_picture`（x=30,y=81） | 事件大图横幅 | `picture` |
| 4 | `Description`（`vic_18_black`，左对齐，`maxWidth=512`） | 描述正文 | `desc` 的 loc |
| 5 | 描述下方 | `immediate` / `after` 的效果行（官方 wiki：默认列在描述下面，可被 `hidden_effect` 隐藏） | `immediate` / `after` |
| 6 | `event_goto_province` | 可选"前往省份"按钮 | `goto` |
| 7 | `event_option_listbox`（垂直，`spacing=1`） | 选项列表，`event_option_button`(547×30, `vic_18`) = 一条可点击按钮，正文 = 选项 name 的 loc；**悬停 tooltip 列出该选项效果**（设置/清除国家 flag 不列入）；另可带 `event_option_goto_button` | 每个 `option` 一块 |

`major = yes` 不改变弹窗，只决定选完后是否广播；`hidden = yes` 完全不弹窗。

### 2.4 实测样例（`events/1399_events.txt`）

```
11: country_event = {
12: 	id = ce_1399_events.0
13: 	title = "ce_1399_events.0.t"
14: 	desc = "ce_1399_events.0.d"
15: 	picture = CE_china_turns_open
18: 	major = yes
19: 	mean_time_to_happen = { days = 1 }
```

| key | 真实中文 |
|---|---|
| `ce_1399_events.0.t` | `叛乱藩王覆灭` |
| `ce_1399_events.0.d` | `在$COUNTRY$王师大破乱臣贼子的军队后，逆藩自知大势已去，便在家中自焚而亡。` |
| `ce_1399_events.0.a` | `朕把他们全部打败了啊！$COUNTRY$天下无敌啊！` |
| `ce_1399_events.2.t` | `靖难` |
| `ce_1399_events.2.d` | `明太祖朱元璋登基后，为保朱姓王朝千秋万代…（略）…\n时至今日，燕宁二王相约共同南下靖难。` |
| `ce_1399_events.2.a` / `.b` / `.c` | `清君侧，靖国难！先入应天者为王，事成之后，平分天下！` / `朕是天子！他们这些叛逆！` / `权力的游戏。` |

---

## 3. 决议 (decision)

### 3.1 脚本位置与顶层形状

`decisions/*.txt`（模组 84 文件）。**唯一包裹键 `country_decisions = { … }`**
（模组 84/84；vanilla 195 文件用它）；包裹键之外的内容会被忽略。
内部是平铺的 `decision_key = { … }`（模组 618 条）。

| 字段 | 模组 | vanilla | 说明 | 字段 | 模组 | vanilla | 说明 |
|---|---|---|---|---|---|---|---|
| `potential` | 618 | 516 | 满足才出现在面板；**对玩家不可见** | `provinces_to_highlight` | 244 | 197 | 点击后高亮省份（内部） |
| `allow` | 618 | 516 | 满足才可点击；UI 显示绿色 √ | `ai_importance` | 69 | 92 | AI 优先级（内部） |
| `effect` | 618 | 516 | 执行效果 | `color` | 64 | 84 | 图标配色档位（内部） |
| `ai_will_do` | 589 | 501 | AI 权重（内部） | `do_not_integrate`/`do_not_core` | 4/1 | 8/1 | 成立国家时的内部开关 |
| `major` | 399 | 243 | `yes` = 绿底大决议（如成立国家） | | | | |

### 3.2 loc key 约定（实测；wiki `决议修改.html` 同）

| 目标 | 模式 | 实测 |
|---|---|---|
| 名称 | `<key>_title` | vanilla **516/516**；模组 **616/618** |
| 描述 | `<key>_desc` | vanilla 516/516；模组 616/618 |
| 效果提示替换 | `<key>_tooltip` | vanilla 6；模组 7 |
| 提醒提示 | `<key>_alert_tooltip` | vanilla 0；模组 0（本模组未用） |

模组缺的 2 条是脚本疏漏（`CE_AI_Province_decisions.txt` 的 `CE_ai_raid_action`、
`CE_ai_zhuangding_action` 完全没有 `_title`/`_desc`）→ 缺键不报错，游戏里只会显示原始键名。

### 3.3 游戏内渲染（`interface/countrydecisionsview.gui`）

一个 `countrydecisionsview` 窗口同时装两块：上半 `policies_window`，下半
`decisions_window`（`decisions_label` 硬编码 `COUNTRY_DECISIONS` + `decisions_listbox`）。

决议条目 `countrydecisionsview_decision_entry`（一行 300×28），从左到右：

| 序 | 控件 | 内容 |
|---|---|---|
| 1 | `decisions_banner` | 左侧徽标底图 |
| 2 | `decision_icon` | 决议图标 |
| 3 | `title`（`vic_18`，`maxWidth=280`） | **`<key>_title` 文本**；模组常在前缀 `£icon_tianming£` 之类图标 |
| 4 | `decision_checkbox` | 右数第三列复选框（wiki：黄点，用来"不再提醒"） |
| 5 | `info_icon` / `6 select_button` | 信息图标 / 执行按钮 |

`major = yes` 用 `countrydecisionsview_major_decision_entry`（绿底大徽标）。
wiki `决议修改.html`：`_title` 决定 UI 中显示的名称，`_desc` 显示描述；
`allow` 条件在 UI 中显示为 √/✗，`potential` 条件不可见。

### 3.4 实测样例

| key | 真实中文 |
|---|---|
| `kaiqi_zhanguo_zhuhou_title` | `£icon_tianming£开启战国诸侯争霸` |
| `kaiqi_zhanguo_zhuhou_desc` | `分封尽是春秋地，日月轮转又一周。` |
| `restore_zhongyuan_order_title` | `£icon_tianzi£重建秩序` |
| `restore_zhongyuan_order_desc` | `天朝的秩序已经崩溃，州县人民各为其主。…\n\n§M当没有更多国家拥有§!§Y“还国之策”…§M修正之后，你可以重建中国的秩序，加速统一中国。所有在中国拥有土地的§!§G东亚势力§!§M都可以尝试这个决议§!` |
| `restore_zhongyuan_order_tooltip` | `§Y尝试在混乱开始300年内重建中国的秩序并获得奖励§!` |

（脚本：`decisions/BM_zhuhou_decisions.txt` 的 `kaiqi_zhanguo_zhuhou`；
`decisions/CE_Ming_decisions.txt` 的 `restore_zhongyuan_order`）

---

## 4. 理念组 (idea group)

### 4.1 脚本位置与顶层形状

`common/ideas/*.txt`（模组 8 文件，722 组）。顶层**无包裹键**，平铺 `group_key = { … }`。
组内子键即理念本体：`<idea_key> = { 修正… }`，每组恰好 **7** 个（模组 722/722、vanilla 554/555）。

| 组字段 | 说明 |
|---|---|
| `category` | `ADM`/`DIP`/`MIL`；**只出现在基本理念组**（模组 12 组有：ADM×4/DIP×4/MIL×4）；国家理念组没有 |
| `free` | `free = yes` = 国家理念组（模组 710） |
| `start` / `bonus` | 传统（两条修正）/ 野心（一条修正） |
| `trigger` | 谁能用（模组 717） |
| `ai_will_do` | AI 选组倾向（模组 12） |
| 其余子键 | 理念。`start`/`bonus`/`trigger`/`free`/`category`/`ai_will_do` 是保留名 |

> 1.37 **没有** `idea = { key = … }` 写法（vanilla 555 + 模组 722 组中 0 次）。

### 4.2 loc key 约定（实测 + wiki `理念组修改.html` §本地化）

wiki 原文例子与实测完全一致：

```
KHM_ideas: "Khmer Ideas"
KHM_ideas_start: "Khmer tradition"
KHM_ideas_bonus: "Khmer ideas"
staunch_theravada_buddhists: "Staunch Theravada Buddhists"
staunch_theravada_buddhists_desc: "The Khmer people have fully embraced…"
```

| 目标 | 模式 | 实测 |
|---|---|---|
| 组名 | `<group_key>`（**就是组块自己的键**） | vanilla 554/555；模组 **722/722** |
| 传统 | `<group_key>_start` | 在**有 `start` 块**的组里：vanilla 529/530；模组 **710/710** |
| 野心 | `<group_key>_bonus` | 在**有 `bonus` 块**的组里：vanilla 554/555；模组 **722/722** |
| 理念名 | `<idea_key>`（**就是理念子键**，不拼组名） | vanilla **3,884/3,884**；模组 **5,054/5,054** |
| 理念描述 | `<idea_key>_desc` | vanilla 3,884/3,884；模组 5,054/5,054 |

两处要写进代码的"反常识"：

1. 理念 loc 键**不是** `<group>_<序号>`，而是**理念块自己的键**。例：组 `HLR_ideas` 里的块叫 `hlr_imperial_throne`，loc 键就是 `hlr_imperial_throne`；组 `norse_ideas` 里叫 `norse_ideas_eternal_struggle`，loc 键就是它本身。vanilla 里描述性键与 `FR2_1`/`kaimeng_ideas_1` 数字键**并存** → 只认"子键即 loc 键"。
2. wiki `理念组修改.html`"额外奖励"一节写"不必进行本地化"——**这是错的**。实测模组 722/722 个 `bonus` 块都有对应 `<group>_bonus` loc（vanilla 554/555），必须当必填。

### 4.3 游戏内渲染（`interface/countryideasview.gui`）

左右两个组列表 + 详情区。

* 组条目 `countryideaview_ideagroupitem`，自上而下：`ideas_category_bg` →
  `ideas_category`（`ADM`/`DIP`/`MIL` 分类字，**来自 `category` 而非 loc**）→ `ideas_cost`
  → `ideas_idea_title`（**组名 = `<group_key>` loc**）→ `ideas_bonus_icon`（野心图标，
  tooltip 用 `<group_key>_bonus`）→ `ideas`（7 个理念图标，悬停显示 `<idea_key>` +
  `<idea_key>_desc` + 修正数值）→ `idea_progress`/`progress_frame_army` → `abandon_idea_button`。
* 单理念条目 `countryideaview_ideaitem`：`idea_icon` + `idea_icon_can_unlock`/
  `idea_icon_cannot_unlock` + `idea_button`。
* 传统（`start`）在组详情里表现为组名旁的额外修饰项，标题走 `<group_key>_start`。

### 4.4 实测样例

| key | 真实中文 |
|---|---|
| `kaimeng_ideas` | `§M开蒙理念§!` |
| `kaimeng_ideas_bonus` | `开蒙理念完成` |
| `kaimeng_ideas_start` | **不存在**（该组没有 `start` 块——键缺失与脚本缺失严格对应） |
| `kaimeng_ideas_1` | `上下而求索` |
| `kaimeng_ideas_1_desc` | `旧思想的经济基础消亡时，新思想往往还未产生。譬如北明初期的人们就远未体会到自己处于历史的拐点，只是本能地寻求一种新的政治…` |
| `xibeicul_ideas` | `西北理念` |
| `xibeicul_ideas_start` | `西北传统` |
| `xibeicul_ideas_bonus` | `西北雄心` |
| `rong_qiang_gu_yuan` | `戎羌故地` |
| `rong_qiang_gu_yuan_desc` | `甘肃地区作为古代北方草原的一部分，曾经是东亚游牧民族活动最为频繁的地区之一。…这里仍旧有着“马场”的美誉。` |

（`common/ideas/BM_basic_ideas.txt` 的 `kaimeng_ideas` 含 `category = ADM`；
`common/ideas/zz_BM_groups_ideas.txt` 的 `xibeicul_ideas` 含 `start` + `bonus`）

---

## 5. 国家理念 (national ideas)

脚本与 loc 层面与理念组**同构**，只有这些差异：

| 差异点 | 值 |
|---|---|
| 文件 | `common/ideas/00_country_ideas.txt`（独特国家理念）、`zz_group_ideas.txt`（文化/政体/政府改革组）、`zzz_default_idea.txt`（通用）；模组 `CE_country_ideas.txt`、`zz_BM_country_ideas.txt`、`zz_BM_groups_ideas.txt` |
| 组键 | 通常 `<TAG>_ideas`（wiki：`<tag>_ideas`），也可 `FR2_ideas`、`great_project_ideas` 等自定义键 |
| 标记 | `free = yes`（模组 710/722）；**不写 `category`**（不消耗君主点数，解锁 3 个理念组理念换 1 个国家理念） |
| 传统 / 野心 | `start` = 国家传统；`bonus` = 国家野心。wiki `国家理念.html`：*"每个国家开局都有代表了各自国家过往历史和文化遗产的国家传统。在解锁了全部7个国家理念后还会得到一个独有的国家野心。"* |
| loc | 同 §4.2：`<TAG>_ideas`、`<TAG>_ideas_start`、`<TAG>_ideas_bonus`、`<idea_key>`、`<idea_key>_desc` |
| 加载优先级 | wiki `理念组修改.html`：按文件名字母序 `00_country_ideas.txt` > `zz_group_ideas.txt` > `zzz_default_idea.txt`，文件内按出现顺序；满足多个组时取**最靠前**的；事件里用 `swap_free_idea_group` 切换 |

渲染（`countryideasview.gui` 的 unique 区，与理念组共用同一窗口）：

| 序 | 控件 | 内容 |
|---|---|---|
| 1 | `unique_ideas_category` | 国家盾徽 |
| 2 | `unique_ideas_idea_title`（`vic_22`，`maxWidth=212`） | **`<TAG>_ideas`** |
| 3 | `unique_ideas_start_icon_1/2` + `unique_ideas_start_desc_1/2` | 两条国家传统（图标 + 修正数值文本来自 `start` 块；标题来自 `<TAG>_ideas_start`） |
| 4 | `unique_ideas` + `idea_unique_progress` | 7 个国家理念，未解锁为暗色 |
| 5 | `unique_ideas_bonus_icon` + `unique_ideas_bonus_desc` | 国家野心（`bonus` 块；标题来自 `<TAG>_ideas_bonus`） |

> `<TAG>_ideas_start` / `_bonus` 的确切落点由 C++ 决定，`.gui` 里没有独立文本框；
> 上表第 3/5 行的"标题来自 `_start`/`_bonus`"依据 wiki `理念组修改.html` §本地化
> 的明文叙述 + 100% 的键存在率。`wiki 说法，未在游戏内逐帧验证`。

### 5.1 实测样例

| key | 真实中文 |
|---|---|
| `QIC_ideas` | `齐理念` |
| `QIC_ideas_start` | `齐传统` |
| `QIC_ideas_bonus` | `齐雄心` |
| `Deng_lai_shui_li` | `登莱水运` |
| `Deng_lai_shui_li_desc` | `臣李凉斗胆进言，公齐国君，祖洪武所命京东镇守者也。山东古称登莱，为古东夷地。…除援引海盐之利，亦应开海禁，以水为财。` |
| `FR2_ideas` | `神圣法兰西理念` |
| `FR2_ideas_start` | `神圣法兰西传统` |
| `FR2_ideas_bonus` | `神圣法兰西雄心` |
| `FR2_1` | `君权民授` |
| `FR2_1_desc` | `自古以来授予法兰西国王权柄的就是上帝和人民，而非先祖血统，在百年战争中丑态尽出的法国贵族更是证明了这一点。…推举她加冕为王。` |
| `FR2_7` | `自由、平等、博爱` |

（`common/ideas/zz_BM_country_ideas.txt` 的 `QIC_ideas`：`start = { land_morale = 0.1
infantry_power = 0.1 }`、`bonus = { core_creation = -0.1 }`、`trigger = { tag = QIC }`；
`common/ideas/CE_country_ideas.txt` 的 `FR2_ideas` 用数字式理念键 `FR2_1`…`FR2_7`）

---

## 6. 顾问 (advisor)

### 6.1 脚本位置与顶层形状

`common/advisortypes/*.txt`（vanilla `00_advisortypes.txt` 21 个；模组另有
`CE_advisortypes.txt`，共 55 个）。顶层**无包裹键**，平铺 `advisor_key = { … }`。

| 字段 | 说明 |
|---|---|
| `monarch_power` | `ADM`/`DIP`/`MIL`，决定顾问槽位与每月点数类型（模组 55/55） |
| （任意修正键） | 顾问加成，只写一个（如 `state_governing_cost`、`yearly_corruption`、`prestige`） |
| `skill_scaled_modifier` | 随顾问等级线性放大的修正块（模组 226 次） |
| `chance = { factor = … }` | 出现在顾问池的权重（55/55） |
| `ai_will_do = { … }` | AI 雇佣倾向（55/55） |
| `allow_only_male` / `allow_only_female` | 性别限制（模组 33 / 1） |

### 6.2 loc key 约定（实测；wiki `顾问修改.html` §本地化 同）

wiki 原文：`philosopher:0 "Philosopher"` / `philosopher_desc:0 "An advisor dedicated…"`

| 目标 | 模式 | 实测 |
|---|---|---|
| 名称 | `<advisor_key>` | vanilla **21/21**；模组 **55/55** |
| 描述 | `<advisor_key>_desc`（**后缀**，不是 `desc_`） | vanilla 21/21；模组 55/55 |

### 6.3 游戏内渲染（`interface/countrycourtview.gui`，国家界面宫廷面板）

* **可选顾问池** `advisor_selection_entry`，依次：`banner` → `advisor_button`（头像）→
  `name`（**`<key>` loc**）→ `skill_value` + `skill_icon_ADM/DIP/MIL` → `title` →
  `purchase`/`purchase_cost`（雇佣花费）→ `effect_icon`+`effect`（加成数值）→
  `desc`（**`<key>_desc` loc**）→ `home` → `dismiss_button`。
* **已雇佣顾问** `countrycourtview_abilitylistitem`：`advisor_name` → `advisor_skill_icon` +
  `ability_skill` → `power_progress`/`power` → `advisor_modifier_listbox`
  （`advisor_modifier_item`：`advisor_modifier_icon` + `advisor_desc`）→ `advisor_cost` →
  `advisor_activefor` → `advisor_promote` → `advisor_sack`；宗教/文化不适配时显示
  `advisor_indicator_religion` / `advisor_indicator_culture`。
* 顾问描述（`<key>_desc`）出现在**悬停/选中时的说明文本**，不是常驻标题。

### 6.4 实测样例（`common/advisortypes/CE_advisortypes.txt`）

```
65: hubu_shangshu = { #户部名臣
66: 	monarch_power = ADM
69: 	state_governing_cost = -0.2
71: 	skill_scaled_modifier = { trigger = { always = yes } modifier = { meritocracy = 0.3 } }
```

| key | 真实中文 |
|---|---|
| `hubu_shangshu` | `§Y户部名臣§!` |
| `hubu_shangshu_desc` | `成也萧何，败也萧何。` |
| `xingbu_shangshu` | `§Y刑部名臣§!` |
| `xingbu_shangshu_desc` | `事莫重于大辟，大辟莫重于初情，初情莫重于检验。` |
| `yangmingism_daru` | `翰林大儒` |
| `yangmingism_daru_desc` | `儒家思想研习集大成之人。` |

---

## 7. 政策 (policy)

### 7.1 脚本位置与顶层形状

`common/policies/*.txt`（vanilla `00_adm/00_dip/00_mil.txt` 共 203；模组 `BM_all.txt` +
`CE_adm/dip/mil.txt` 共 135）。顶层**无包裹键**，平铺 `policy_key = { … }`。

| 字段 | 模组 | 说明 |
|---|---|---|
| `monarch_power` | 135 | `ADM`/`DIP`/`MIL`；决定类别与每月维护点数（同类别第一项免费，之后每多一项 +1/月） |
| `potential` | 135 | 何时**出现在**政策列表（原版：拥有两个前置理念组之一） |
| `allow` | 135 | 何时**可启用**（原版：两个前置理念组都点满） |
| `ai_will_do` | 135 | AI 权重（内部） |
| （任意修正键） | — | 政策效果直接写在块里（`global_unrest`、`trade_efficiency`…）；也可用 `effect = {}` / `removed_effect = {}` |

### 7.2 loc key 约定（实测）

| 目标 | 模式 | 实测 |
|---|---|---|
| 名称 | `<policy_key>` | vanilla **203/203**；模组 **135/135** |
| 描述 | **`desc_<policy_key>`（前缀！）** | vanilla **203/203**；模组 **134/135** |

> 政策是唯一用 `desc_` **前缀**的主要内容类型。写成 `<key>_desc` 在 vanilla + 本模组里
> 命中 **0/338**。离线 wiki `本地化.html`「参考资料」同样写作 `政策：<policy>，desc_<policy>`。
> 模组 `CE_adm.txt` 的 `CE_chunqiubifa` 缺 `desc_`，属模组疏漏。

### 7.3 游戏内渲染（`countrydecisionsview.gui` 的 `policies_window`，"任务与决议"窗口）

* 标题 `decisions_label` 硬编码 `COUNTRY_POLICIES`。
* 三列并排，每列一套：`adm_cost_icon`/`adm_capacity_icon`/`adm_cost`/`adm_capacity`/
  `adm_title`/`adm_count`/`adm_list`（DIP/MIL 同构）；`modifiers_title` +
  `modifiers_description_list` 显示已启用政策带来的总修正。
* 已启用政策 `countrydecisionsview_activepolicy`：`policy_icon_frame` + `button1`/`button2`。
* 可选政策 `countrydecisionsview_possiblepolicy`：`policy_icon` → `title`
  （**`<policy_key>` loc**）→ `effect`；其下每行一个 `countrydecisionsview_policymodifier`
  （`modifier_icon` + `modifier_value`）。
* 选择界面 `countrydecisionsview_pickpolicy`：`select` + `policy_icon` + `title` + `effect`。
* 悬停/详情文本用 **`desc_<policy_key>`**；需求行按 wiki `政策.html` 的格式
  "显示于：在完成两者之一时显示 / 可用于：在两者都完成时可用"，即 `potential`/`allow`
  被渲染成条件行（带 √/✗），但**条件文本由引擎生成，不来自 loc**。

### 7.4 实测样例

| key | 真实中文 |
|---|---|
| `CE_guanliaotewu` | `官僚特务机构` |
| `desc_CE_guanliaotewu` | `成立官方的特务机构，监视大小官员，防止他们做出违法的事情。` |
| `CE_wenrenqijie` | `文人气节` |
| `desc_CE_wenrenqijie` | `三军可夺帅也,匹夫不可夺志也。守城文官宁死也决不降敌，誓与城池共存亡。` |
| `CE_kaimeng_innovation_ideas` | `革新不眠` |
| `desc_CE_kaimeng_innovation_ideas` | `时代永远在前进，前进一步，还有下一步。` |
| `CE_jiaohuawanmin` | `教化外民` |
| `desc_CE_jiaohuawanmin` | `用潜移默化的方式让我们征服的外族融入我们。` |
| `the_combination_act`（vanilla） | `The Combination Act` |
| `desc_the_combination_act`（vanilla） | `Every measure has been taken to prevent future strikes. All unlawful formations of trade- or labor unions are henceforth prohibited.` |

（脚本位置：`common/policies/CE_adm.txt`、`CE_mil.txt`、`BM_all.txt`）

---

## 8. loc 值内的文本标记语法（EU4 1.37 实测）

统计口径：vanilla 126,744 条 + 模组 36,344 条 loc 值全文扫描。

### 8.1 颜色 `§`

`§X` 开始着色，`§!` 结束。实测出现的全部代码与次数（vanilla / 模组）：

| 代码 | 颜色 | v / m | 代码 | 颜色 | v / m | 代码 | 颜色 | v / m |
|---|---|---|---|---|---|---|---|---|
| `§!` | 结束/复位 | 23088 / 4533 | `§T` | 青绿 | 168 / 100 | `§b` | 黑 | 0 / 8 |
| `§Y` | 黄 | 18218 / 2754 | `§O` | 橙 | 112 / 104 | `§B` | 深蓝 | 0 / 7 |
| `§G` | 绿 | 3571 / 513 | `§g` | 灰 | 52 / 0 | `§P` | 深紫 | 2 / 0 |
| `§R` | 红 | 1451 / 611 | `§J` | 翡翠绿 | 34 / 0 | `§V` | 浅紫 | 0 / 0（wiki 列出，语料未见） |
| `§W` | 白 | 993 / 9 | `§l` | 黄绿 | 6 / 2 | `§0`–`§9` | 数值精度（须紧跟一个值，如 `§R§2[…GetValue]§!`） | 66 / 0 |
| `§M` | 天蓝 | 544 / 457 | `§I` | **wiki 未列出**，模组用过 1 次（`…§I每一个省份§!`）→ 视为未知代码，原文保留 | 0 / 1 | | | |

离线 wiki `本地化.html` 的格式化规则表另列 `%`（转百分数）、`*`（SI 单位）、`=`（正数加 `+`）、
`+`（正绿/零黄/负红）、`-`（正红/零黄/负绿）。这些**不写在 `§…§!` 里**，而写在 `$…|…$`
的竖线之后（见 §8.4）。wiki 示例 `「§=Y3$VAL$§」` 与实测不符，属 wiki 排版错误。

### 8.2 图标 `£icon£`

`£名字£` 替换为一张约 20×20 的图片，**名字 = `.gfx` 里 `spriteType` 的 `name` 去掉 `GFX_` 前缀**。vanilla 常用：`£adm£`(173) `£dip£`(145) `£mil£`(135) `£yes£`(215) `£no£`(214) `£icon_sailors£` `£icon_manpower£` `£infantry_icon_small£` `£cavalry_icon_small£` `£artillery_icon_small£` `£big_ship_icon_small£` `£light_ship_icon_small£` `£galley_icon_small£` `£transport_icon_small£` `£icon_trade_power£` `£time£`。
模组自定义：`£icon_tianzi£`(110) `£icon_tianming£`(100) `£icon_chinese_religion£`(26) `£icon_cercenary£`(23) `£icon_awaken£`(13) `£icon_CE_chinese_province_wars£`(5) → 在 `interface/CE_icon.gfx` 中定义为 `name = "GFX_icon_tianming"` / `texturefile = "gfx//interface//icon//icon_tianming.dds"`。**规则**：`£X£` → 解析 `GFX_X`；解析不到就原样显示文本或显示占位框。

### 8.3 换行

`\n`（引号内的字面反斜杠 + n）= 换行。vanilla 10,550 次、模组 6,161 次；`\n\n` 很常见
（空一行分段）。**没有** `\r`、`<br>`、`|n` 等写法。

### 8.4 `$KEY$` 与 `|格式化`

`$KEY$` 由引擎替换，`KEY` 有两类来源：

1. **引擎内建关键字表**（离线 wiki `本地化.html` 有约 100 项的表）：`$COUNTRY$` `$COUNTRY_ADJ$` `$CAPITAL$` `$CAPITAL_CITY$` `$CULTURE$` `$RELIGION$` `$MONARCH$` `$MONARCHTITLE$` `$DYNASTY$` `$HEIR$` `$FROM$` `$FROMCOUNTRY$` `$PROVINCE$` `$PROVINCENAME$` `$YEAR$` `$DATE$` `$ADM$/$DIP$/$MIL$` `$VAL$` `$COST$` `$NAME$` `$WHO$` `$LIST$` `$TARGET$` `$NUM$` `$ACTOR$` `$RECIPIENT$` `$ARMY_REFORMER$`（顾问名）等。实测最高频（模组）：`$COUNTRY$`129 `$RELIGION$`35 `$NAME$`30 `$WHO$`28 `$COUNTRYNAME$`18 `$VAL$`17 `$FROM$`14 `$MONARCH$`11 `$EFFECT$`7。
2. **脚本注入关键字**：`custom_tooltip = X` / `tooltip = X` 会在文本里留下 `$X$`，由引擎填入动态效果文本。例：`$PRIVILEGE_EFFECTS$`、`$SCORNFUL_INSULT$`（其值是随机取一组的 loc 键）、`$ESTIMATE_TRIBUTE_AMOUNT$`。→ **静态 loc 里只是占位符，浏览器无法离线求解。**

`$KEY|FORMAT$`：格式化写在竖线后、结尾 `$` 前。实测真实写法：`$NAME|Y$`、`$VAL|%=+1$`、
`$COST|0Y$`、`$ABILITY|Y$`、`$POWER_COST|Y$` —— `|` 后可跟颜色字母（`Y`）与/或数字/`%`/`=`/`+`/`-`。

> 未验证：把**任意 loc 键**当 `$KEY$` 用（`$另一个键$`）能否成立。语料中全部 130 例长短键名匹配都能用"引擎关键字表"解释。`wiki 说法，未在本模组中验证`。

### 8.5 `[Scope.Command]` 动态指令

方括号指令，vanilla 20,002 次、模组 1,968 次。形式 `<作用域>.<指令>`：
`[Root.GetName]`、`[From.GetName]`、`[Root.Monarch.Dynasty.GetName]`、
`[From.Capital.GetCapitalName]`、`[Root.GovernmentName]`、`[Root.myvar.GetValue]`、
`[GetYear]`（无作用域）、`[event_target_name.GetName]`（事件目标）。

作用域（wiki `本地化.html`）：`Root` `From` `This` `Capital` `Owner` `Monarch` `Heir` `Consort` `Culture` `Religion` `Dynasty` `ColonialParent` `TradeCompany` `Location` `Dip_Advisor`/`Adm_Advisor`/`Mil_Advisor`，以及直接写国家 TAG（`[FRA.Monarch.GetTitle]`）。指令（同页表）：`GetName` `GetAdjective` `GetCapitalName` `GetAreaName` `GetGroupName` `GetTradeGoodsName` `GetTitle` `GetAdm/GetDip/GetMil` `GetHerHim(Cap)` `GetHerHis(Cap)` `GetSheHe(Cap)` `GetHerselfHimself(Cap)` `GetWomanMan` `GovernmentName` `GetValue` 等。

**规则**：不要真的求值；渲染成"动态片段"占位（如灰色 `[Root.GetName]` 或 `⟨国家名⟩`），因为求值需要运行时游戏状态。

### 8.6 `@TAG` 国旗图标

`@FRA`、`@BUR`、`@KAR`、`@CND`… → 该国国旗小图标。vanilla 237 次、模组 176 次，
1.37 真实存在（主要在任务/事件文本，如 `"如果@KAR§Y卡拉曼§!存在："`）。

### 8.7 **不属于** EU4 1.37 的标记（重要）

| 语法 | 结论 | 依据 |
|---|---|---|
| `#bold` / `#italic` / `#X … #!` | **不是 EU4 语法**，是 CK3 / Victoria 3 / HOI4 的富文本标签 | 全文扫描 163,088 条 loc 值，匹配 `#[a-zA-Z_]+` 的只有 2 条且都是误报（模组 `&*&QN_E##V…`、vanilla `#Channelname/Playerlist`） |
| `@icon_name!`（HOI4 图标语法） | 不是 EU4 语法；EU4 用 `£…£` | 同上 |
| `\uXXXX`、`&#123;`、HTML 实体、Markdown、BBCode | 不存在于 loc 值 | 未出现 |

### 8.8 转义与引号

* yml 层标准写法是 `\"`（离线 wiki 明写
  `STRING_WITH_QUOTES: "This string contains \"quotes\", therefore it's awesome!"`），
  但**本模组 0 次使用 `\"`**，改用 `""……""` 双写，如
  `desc_CE_great_project_policies:0 ""走过路过不要错过，一张门票10块钱......""`。
  → 浏览器解析时若值**首尾各多出一个引号**，应再削一层。
* 模组 loc 里没有反斜杠转义（`\\` 0 次）。
* 脚本层 `.txt`：`#` 起注释，`\"` 转义引号；`src/codec/script.js` 的 tokenizer 按
  "引号不跨行"处理，能容忍中文转码造成的坏序列。
* **中文正文编码**既非 UTF-8 也非 GBK，是 Paradox 私有 `[lead][low][high]` 转义方案 +
  CP1252 中间层（见 `src/codec/localisation.js` 头部注释）。显示前必须 `decodeBuffer()`，
  否则会得到"看起来像中文但其实错的"结果。

---

## 9. 只写脚本、不上屏幕的字段（内部字段）

| 类型 | 字段 | 为什么不可见 |
|---|---|---|
| 全部 | `id` / 块自己的 key | 只是标识符 |
| 事件 | `trigger` / `mean_time_to_happen` / `is_mtth_scaled_to_size` | 只决定是否/何时触发，UI 不显示概率 |
| 事件 | `is_triggered_only` / `fire_only_once` / `hidden` | 触发策略；`hidden=yes` 时整个窗口不出现 |
| 事件 | `major` / `major_trigger` | `major` 只影响是否广播；`major_trigger` 只筛选收件国 |
| 事件 option | `ai_chance` / `highlight` | AI 权重；`highlight` 只影响按钮高亮，无文本 |
| 决议 | `potential` / `ai_will_do` / `ai_importance` | wiki：`potential` 对玩家不可见；后两个是 AI 决策 |
| 决议 | `color` / `provinces_to_highlight` / `do_not_integrate` / `do_not_core` / `major` | 内部机制；`major` 只切换条目样式（绿底） |
| 理念组 | `trigger` / `free` / `ai_will_do` | 可用性判断 |
| 理念组 | `category` | **不来自 loc**，UI 直接显示 `ADM`/`DIP`/`MIL` |
| 顾问 | `monarch_power` / `chance` / `ai_will_do` / `allow_only_male`/`female` | 槽位、池化、雇佣逻辑；UI 显示的是点数**图标**不是这个词 |
| 顾问 | `skill_scaled_modifier` 的 `trigger` | 条件 |
| 政策 | `monarch_power` / `potential` / `allow` / `ai_will_do` | 类别与维护费；UI 把条件渲染成 √/✗ 行而非文本 |
| 全部 | `effect` 及各类效果指令 | 效果会以**引擎生成的** tooltip 行显示，但字段名与脚本语法本身不上屏 |

> 渲染器正确姿势：以上字段渲染成"脚本视图"（灰色、可折叠），不当作待翻译文本查 loc。

---

## 10. 实测命中率总表（可直接当回归测试的期望值）

| 内容类型 | 目标 | 推导规则 | vanilla | 模组 |
|---|---|---|---|---|
| 事件 | 标题 | 字段 `title` 的值即 key | 6,356/6,366 键存在 | 4,019/4,050 |
| 事件 | 描述 | 字段 `desc` 的值即 key | 6,120/6,366 | 3,866/4,050 |
| 事件 | 选项名 | 字段 `option.name` 的值即 key | 11,471 项有 name | 8,831 项有 name |
| 事件 | 选项名缺省 | 回退 `<id>.<位置字母>` | 2 个可见回退例（`flavor_tim.13.a`、`MEE_Byzantine_Events.28.e`） | 1 个（`flavor_tim.13.a`） |
| 决议 | 名称 / 描述 | `<key>_title` / `<key>_desc` | 516/516 / 516/516 | 616/618 / 616/618 |
| 决议 | tooltip | `<key>_tooltip` / `_alert_tooltip` | 6 / 0 | 7 / 0 |
| 理念组 | 组名 | `<group_key>` | 554/555 | 722/722 |
| 理念组 | 传统 | `<group_key>_start`（仅有 `start` 块时） | 529/530 | 710/710 |
| 理念组 | 野心 | `<group_key>_bonus`（仅有 `bonus` 块时） | 554/555 | 722/722 |
| 理念组 | 理念名 / 描述 | 理念子键本身 / `<idea_key>_desc` | 3,884/3,884 / 3,884/3,884 | 5,054/5,054 / 5,054/5,054 |
| 顾问 | 名称 / 描述 | `<advisor_key>` / `<advisor_key>_desc` | 21/21 / 21/21 | 55/55 / 55/55 |
| 政策 | 名称 | `<policy_key>` | 203/203 | 135/135 |
| 政策 | 描述 | **`desc_<policy_key>`** | 203/203 | 134/135 |

---

## 对本浏览器的实现建议

* **统一入口**：`resolveLoc(kind, node, locMap)` 按 §10 表 switch，返回
  `{key, text, exact, source:'mod'|'vanilla'}`；`exact:false` 表示走了回退推断。
* **先精确后推断**：永远先用脚本字面值查表（`title`/`desc`/`option.name`），
  查不到才按 `<id>.t`/`<id>.d`/`<id>.<a|b|c…>` 生成候选，并在 UI 上标注「推断」。
* **键方向别搞错**：顾问/理念/决议用 `_desc`/`_title` **后缀**，**政策用 `desc_` 前缀**。
  把 `{ nameKey, descKey }` 模板写成类型数据，不要散落 if。
* **理念特例**：理念 loc 键 = 理念块的**子键**，不是 `<group>_<n>`；不要假设都叫 `_1.._7`
  （`FR2_1` 与 `norse_ideas_eternal_struggle` 并存）。
* **`_start`/`_bonus` 与 `start`/`bonus` 块一一对应**：脚本没有 `start` 就不要为
  `<group>_start` 生成占位（模组 `kaimeng_ideas`、`wenshi_ideas`、`chaogong_ideas` 都如此）。
* **必须合并模组 loc + vanilla loc**：模组是 `localisation/replace/` 且文件名不同，属追加。
* **不要把 `_l_english.yml` 当英文**：本模组用英文语言槽装中文；用 CJK 比例判定语言。
* **中文必须过 `decodeBuffer()`**（私有 escape + CP1252）；另外模组用 `""…""` 双写引号，
  解析后可能残留一层引号，渲染前削掉。
* **行内标记渲染顺序**：先 `§X…§!`（颜色）与 `\n`（换行），再 `£X£`（图标 → 查 `GFX_X`）
  与 `@TAG`（国旗），最后把 `$KEY$` 与 `[…]` 渲染成**动态占位符**（灰底/斜体）并给
  「运行时求值」提示，不要静默丢弃。
* **`$KEY|FORMAT$`**：把 `|` 后格式串解析成 `{color, numberFormat}`，颜色字母按 §8.1 映射。
* **`hidden = yes` 的事件**不生成待补文本，也不进"翻译覆盖率"分母。
* **覆盖率统计**区分「键缺失（模组 bug）」与「键存在但未翻译（回退到英文）」，两者在游戏里
  表现不同，对使用者意义也不同。
* **界面还原**：事件窗口按 `标题(金) → 图片 → 描述 → immediate/after 效果行 → 选项按钮列表`
  固定顺序渲染，选项顺序必须严格按脚本中 `option` 块出现顺序（= `<id>.a/b/c` 字母序）。
* **可折叠"脚本视图"**：§9 的内部字段只在脚本视图显示，不进文本视图。
