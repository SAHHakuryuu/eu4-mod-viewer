# 参与开发 / Contributing

[English](CONTRIBUTING.en.md) | [中文](CONTRIBUTING.md)

这个项目只有三条硬规矩，以及一堆为了让「预览和游戏里一致」而存在的约定。
**提交前请把三条硬规矩过一遍**，它们比代码风格重要得多。

---

## 一、三条硬规矩

### 1. 不打包任何游戏资源

贴图、GUI 几何、本地化文本一律在**运行时从用户自己的安装目录**读取：

| 资源 | 运行时来源 | 实现 |
|---|---|---|
| 任务框/图标/箭头贴图 | `…/Europa Universalis IV/gfx/**/*.dds` | `src/codec/dds.js` + `src/server.js` 的 `/tex` |
| 任务树版式几何 | `interface/countrymissionsview.gui` + `*.gfx` | `src/content/missions.js` 的 `readGui()` |
| 游戏内文本 | 模组与原版的 `localisation/*.yml` | `src/gameloc.js` |

所以仓库里**不能**出现 `.dds`、从游戏目录拷出来的 `.png`、或 `localisation/*.yml`。
`tools/dds-out/`、`tools/out/`、`tools/shot-*.png` 是本地验证产物，已被 `.gitignore` 排除。

### 2. 不打包任何 wiki 内容

中文术语（修正 / 条件 / 效果）来自社区 wiki，而那份 wiki 是
**CC BY-NC-SA 4.0**（署名—非商业性使用—相同方式共享）。把它抽取成数据文件放进仓库，
会把整个项目拖进「非商业性使用」条款，因此：

- ✅ `src/wikigloss.js` —— 解析器，**原创代码**，随仓库分发
- ❌ `triggers.json` / `effects.json` / `modifiers.json` —— 抽取结果，**不入库**

程序在用户挂载了离线 wiki 时于**运行时**解析那三个页面（`条件.html` / `命令.html` /
`修正列表.html`），只读用户自己磁盘上的副本。没有 wiki 时词表为空，渲染退回
`src/data/*-curated.js` 再退回脚本原文——两条路都必须能跑。

> 这条规则由 `tools/test-wikigloss.js` 守着：它会校验抽出来的**每一个键都真的出现在那一页里**
> （不许凭空生成），以及关掉 wiki 后手写词表仍然独立可用。

### 3. 不引入第三方依赖

`package.json` 的 `dependencies` 与 `devDependencies` **必须保持 `{}`**。
只用 Node 内置模块（`fs` `path` `http` `zlib` `net` `os` `vm` `child_process`）＋原生
HTML/CSS/JS。没有 `npm install`，没有构建步骤。想加一个依赖，先想想能不能用 200 行内置模块解决。

---

## 二、渲染规则：宁可显示脚本，也不许编造

这些规则是项目的立身之本，改动渲染层时逐条对照：

- **词表未收录的命令/修正**：原样显示脚本，并注明「词表中未收录」，**不要**猜一个中文名。
- **数值的显示方式**（`0.1` 是 `+10%` 还是 `+0.1`）只能取自**明确声明它的来源**
  （wiki 的 `效果类型` 列，或手写表里的 `mode`）。没有来源时按脚本原样打印——
  按默认值猜会印出**假的数字**，这比丢一个标签严重得多，见 `gameterms.js` 的 `modifierLines`。
- **缺失的本地化键**：标红显示，不要用键名假装成内容。
- **无法归类的块**：退回缩进原文 + 一句说明，不要静默丢弃。
- **删除与缺失**：如实报告（任务树里指向树外的前置、同格冲突、反向前置都属此类），不要近似成"看起来正常"。
- **英文模式**：术语一律打印脚本标识符本身，**绝不机器翻译**中文词表。

---

## 三、代码约定

- **面向用户的字符串**：前端走 `I18N.t('中文原文')`，后端走 `L('中文', 'English')`。
  后端的 `L(...)` 结果是一个 `{zh,en}` 对——**要当字段值用必须先 `pick(pair, lang)`**，
  直接塞进去会渲染成 `[object Object]`。
- **改完文案必跑**：`node tools/i18n-audit.js check`，要求 0 缺失、0 处未包裹的中文、0 条英文值含中文。
- **`.bat` 必须纯 ASCII + CRLF**：cmd.exe 按 OEM 代码页读批处理，中文会解析错乱；
  中文提示统一由 Node 输出。`.gitattributes` 强制 CRLF，不要改成 LF。
- **新增内容类型**：在 `src/content/registry.js` 用 `custom(id, group, key, label, collect, build)` 注册，
  再到 `src/gamedata.js` 的 `TYPE_ORDER` 里加位置——`TYPE_ORDER` 同时决定标签页顺序与收集顺序，
  所以收集器必须写成幂等的。
- **只做静态分析**：不运行游戏，不修改用户的任何文件。

---

## 四、提交前

```bat
node tools\run-tests.js --all          :: 全部测试，包含 headless 浏览器 e2e
node tools\i18n-audit.js check         :: 文案与词条
```

`--all` 的 e2e 三层需要先有一个服务跑在 `http://127.0.0.1:4173`（`npm start`），
否则它们会 **SKIP** 而不是 FAIL——这是刻意的：缺环境不该伪装成失败。

### 各测试文件管什么

| 文件 | 管什么 |
|---|---|
| `test-codec.js` | 本地化编解码 + Clausewitz 解析器 |
| `test-i18n-backend.js` | 后端中英术语层（中文输出被钉住，防回归） |
| `i18n-audit.js check` | 每个 `t()` 键都在字典里、没有裸露中文 |
| `test-wikigloss.js` | 词表只能从用户的 wiki 解析出来，不许编造；无 wiki 时可降级 |
| `test-gamedata.js` | 内容索引 + 通用卡片渲染 |
| `test-content-types.js` | 每一种内容类型都能索引、建卡、渲染 |
| `test-missions.js` | 任务树版式（slot/position/连线语义 + GUI 几何对照） |
| `test-fidelity.js` | 解析器不丢源文件里的任何键 |
| `test-all-mods.js` | 载入全部模组，每个类别抽样 |
| `test-dds.js` | DDS 解码（合成贴图 + 真实贴图） |
| `verify-game.js` | headless 浏览器：游戏内视图逐类截图 |
| `verify-i18n.js` | headless 浏览器：语言切换、设置、可配置 wiki |
| `verify-wiki.js` | headless 浏览器：wiki 视图 |

### 新增测试

在 `tools/run-tests.js` 的 `TESTS` 里注册一条。需要模组 / 离线 wiki / 服务器的，
用 `needs:` 挂前置条件函数，并给 `skipReason`——**缺环境就 SKIP，不要 FAIL**。

---

## 五、许可

代码以 [MIT](../LICENSE) 发布。贡献即表示同意以同一许可分发你的代码。
请注意上面第 2 条：**不要把 wiki 内容或游戏资源提进来**，那会同时破坏授权和这个项目的可商用性。
