# 翻译流水线：九种界面语言

界面语言是 **中文 / English / Français / Deutsch / Español / Português / Русский / 日本語 / 한국어**。
中文是源语言，英文是回退语言，其余七种以「侧表」的形式挂上去——**没有任何一处是机器翻译**。

本文只讲怎么加/改译文。要不要新增一种语言，见最后一节。

---

## 一、仓库里有哪些文件

| 文件 | 内容 | 谁生成 |
|---|---|---|
| `src/data/locales/_source.backend.json` | `{ 英文标签: [中文…] }`，从 `src/**` 里所有 `L('中文','English')` 抽出来 | `tools/i18n-extract.js` |
| `src/data/locales/_source.frontend.json` | `{ 中文字符串: 英文 }`，从 `web/i18n*.js` 的英文词典抽出来 | `tools/i18n-extract.js` |
| `src/data/locales/<lang>.json` | **后端侧表**，键是英文标签 | `build-langs.js merge` |
| `src/data/locales/frontend.<lang>.json` | **前端侧表**，键是中文字符串 | `build-langs.js merge` |
| `web/lang/<lang>.js` | 浏览器词典，`I18N.extend({…}, '<lang>')` | `build-langs.js merge` |
| `src/data/locales/_work/` | 工作台：切好的 chunk 与翻译产出 | `split` / `delta`，**不入库**（在 `.gitignore` 里） |

`web/lang/<lang>.js` 是生成的，但**照样提交**：这个项目运行时没有构建步骤，
浏览器只能靠 `<script src="/lang/<lang>.js">` 拿到词典。

### 为什么两套键不一样

- **后端**：`L('中文','English')` 有 700 多处调用点，它们是代码的一部分，不该被翻译工具改动。
  所以后端侧表的键取**英文那一侧**，`pick()` 查到就用、查不到就回英文。
- **前端**：源码里写的是 `t('搜索')`，键就是**中文字符串本身**。好处是没翻的条目
  会原样显示中文而不是露出 `search.button` 这种键名。

回退链：

```
前端  t('搜索')      目标语言 → 英文 → 中文原文
后端  pick(pair, lang)  目标语言 → 英文 → 中文原文
```

---

## 二、命令

```bat
:: 0. 改了源码里的字符串之后，先刷新两个 _source
node tools\i18n-extract.js

:: 1. 看进度
node tools\build-langs.js status

:: 2. 第一轮：把全部字符串切成 6 个后端 chunk + 3 个前端 chunk
node tools\build-langs.js split

:: 3. 后续轮（增量）：只把「这个语言还缺的键」写成 delta/<lang>.<kind>.json
node tools\build-langs.js delta
node tools\build-langs.js delta ja          :: 只补发一个语言

:: 4. 校验还没合并的 delta（占位符 / 符号 / 首尾空格 / 是否还是英文种子）
node tools\build-langs.js verify ja

:: 5. 合并：写 <lang>.json、frontend.<lang>.json，并生成 web/lang/<lang>.js
node tools\build-langs.js merge

:: 6. 总检查：覆盖率 + 占位符 + 符号 + 首尾空格 + 与源文相同的条目
node tools\build-langs.js check
```

`split` 会**删掉整个 `_work/`**（含所有已经翻好的 delta）。所以它现在有一道闸：
工作台里已经有产出时，必须显式写

```bat
node tools\build-langs.js split --force
```

**后续轮不要用 `split`，用 `delta`。** 这是有代价换来的教训：本轮翻译时有人误跑了一次
`split`（更早的版本里 `node tools/build-langs.js` 不带参数默认就是 `split`，
所以一句 `node -e "require('./tools/build-langs.js')"` 就能把整天的工作删掉），
七种语言的 delta 当场全没了，只能重译。现在 `require` 这个模块是**无副作用**的，
不带参数的默认命令也仍然会先问过 `--force`。

---

## 三、翻一条的规矩

`verify` 与 `check` 会逐条检查前四条，违反就红：

1. **键不许动**：不加、不删、不改、不换顺序。
2. **占位符原样**：`{max}`、`{lost}`、`{total}`、`{label}`、`{value}`、`{n}` …… 一个都不能少、不能改名。
3. **符号原样**：`£icon£`、`§R`、`\n`、`[GetName]`、`$COUNTRY$` 这类原样保留。
4. **首尾空格**：这是**代码契约**，不是排版。`' days'` 会被拼在数字后面，
   丢了空格就变成「30days」。所以 `merge` 会按英文形状**自动对齐首尾空格**，
   你只要别在中间乱加空格就行。
   - 例外：整条只由标点组成（`'  '`、`': '`、`'（'`）的条目**豁免**——
     法语写 `a : b`、日语写 `a：b` 本身就是译文。
5. **与源文相同是允许的**（专有名词、路径、脚本标识符，例如 `Conquistador`、`Total`），
   `check` 只把它们列出来供人确认，不算错。

---

## 四、后续轮（增量翻译）

新增了一屏 UI 之后：

```bat
node tools\i18n-extract.js            :: 刷新 _source（键数会变多）
node tools\build-langs.js delta       :: 只把新键写进 delta/<lang>.<kind>.json
::  … 翻译 _work/delta/<lang>.backend.json 与 <lang>.frontend.json …
node tools\build-langs.js verify <lang>
node tools\build-langs.js merge       :: 增量合并，老译文原样保留
node tools\build-langs.js check
```

`merge` 是**增量**的：已发布的那份 `<lang>.json` 是底稿，chunk/delta 只覆盖它提到的键；
源文件里已经删掉的键会被丢弃，所以删掉一个标签不会在仓库里留下孤儿。

`delta` 不会覆盖已经翻好的 delta 文件（除非 `--force`），所以可以放心重复执行。

---

## 五、术语从哪来

| 语言侧 | 来源 |
|---|---|
| 中文 | **你自己挂载的离线 wiki**（运行时解析 `条件/命令/修正列表` 三页，`src/wikigloss.js`）+ 手写补充 `src/data/*-curated.js`；**仓库里一份都没有** |
| 非中文 | **官方 EU4 本地化**：`Europa Universalis IV\localisation\*_l_<lang>.yml` 里游戏自己印的那个词；查不到就用英文，**不机翻、不自造** |

几条判例（有意为之，不是漏翻）：

- `adm` / `dip` / `mil` 保留**游戏自己的缩写**，七种语言都一样。
- `result = yes|no` 是**胜负**，不是「是否显示战果」：英文 wiki 给这个键的注释（`# Show result`）
  描述错了。拿战绩有定论的历史战役对一遍就清楚——第一次布鲁克之战与萨拉戈萨是法军（进攻方）
  战败，文件里写 `result = no`；卡贝松之战法军（进攻方）获胜，写 `result = yes`。
  所以七种语言一律译成「进攻方获胜 / 防守方获胜」这一对，**不出现「显示战果」**。
- 非中文界面下，脚本标识符（`land_morale`、`MNG@1368.1.23@monarch`）**按原样显示**：
  它就是英文 wiki 和游戏脚本里的官方名字，可以直接拿去搜。中文界面才走中文词表。

---

## 六、本轮实测

主模式：七种语言 × （720 后端 + 397 前端），`check` 全部 100%，`CHECK: clean`。

| 语言 | 后端 | 前端 | 与源文相同（供人确认） |
|---|---|---|---|
| fr | 720/720 | 397/397 | 48 |
| de | 720/720 | 397/397 | 19 |
| es | 720/720 | 397/397 | 19 |
| pt | 720/720 | 397/397 | 23 |
| ru | 720/720 | 397/397 | 7 |
| ja | 720/720 | 397/397 | 11 |
| ko | 720/720 | 397/397 | 7 |

「与源文相同」的条目都是专有名词（`Conquistador`、`Total`）、
只含占位符的格式串（`{label}: {value} / {max}`）和路径。

---

## 七、想再加一种语言

1. `src/i18n.js`：`LANGS`、`EXTRA_LANGS`、`LANG_LABELS`（**母语名**，如 `Italiano`）、`LANG_ALIASES`
2. `web/i18n.js`：`LANGS`、`LANG_NAMES`、`LOCALES`、`LANG_ALIASES`
3. `web/index.html`：照抄一行 `<script src="/lang/xx.js"></script>`
4. `tools/build-langs.js`：`EXTRA_LANGS`
5. `node tools\i18n-extract.js` → `delta` → 翻译 → `merge`（会生成 `web/lang/xx.js`）→ `check`
6. `tools/verify-i18n.js`：把新代码加进语言循环与 `LOCALE` 表，跑一次端到端

语言名一律用**母语写法**，因为读者是在找「Русский」而不是「Russian」——这是唯一
不翻译的一类字符串。

---

[← 回到 README](../README.md) · [参与开发](../CONTRIBUTING.md) · [English](TRANSLATING.en.md)
