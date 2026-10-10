# 上传到 GitHub / Publishing to GitHub

[English](GITHUB.en.md) | [中文](GITHUB.md)

本机目前**没有安装 Git，也没有 `gh` 命令行**，所以下面是两条都不需要我替你装软件的路子。
选一条即可。

> ▲ = 需要你按自己情况替换的地方。

---

## 先看一眼：会上传什么

仓库已经准备好这些文件：

| 文件 | 作用 |
|---|---|
| `.gitignore` | 排除 `config.json`（含你的本机路径）、`node_modules/`、临时文件，以及翻译工作台 `src/data/locales/_work/` |
| `.gitattributes` | **强制 `.bat` 用 CRLF 检出**——否则在别的机器上克隆下来双击又会打不开 |
| `LICENSE` | MIT，版权行已写 `SAHHakuryuu` |
| `CONTRIBUTING.md` / `CONTRIBUTING.en.md` | 三条硬规矩：不打包游戏资源 / wiki 内容 / 第三方依赖 |
| `package.json` | 名称、版本、`npm start` / `npm test` 等脚本、仓库地址占位 |
| `config.example.json` | 设置模板（真正的 `config.json` 不会被上传） |
| `README.md` / `README.en.md` | 含徽章、截图、九语说明 |
| `docs/` | 截图 + 本地化键约定 + 翻译流水线 + 本文件 + [GITHUB-UPDATE.md](GITHUB-UPDATE.md)（更新仓库，中英各一份） |
| `src/` `web/` `tools/` | 全部源码与测试，含七种语言的侧表 `src/data/locales/*.json` 与生成的 `web/lang/*.js`，以及 `tools/gh-*.js`（无 git 时的推送脚本） |

**不会被上传**：`config.json`（你的界面语言、wiki 目录、模组路径）、
`src/data/locales/_work/`（切好的翻译 chunk 与 delta，`merge` 之后就是废料）、
`tools/dds-out/`、`tools/out/`、任何 `*.tmp`，以及**任何从离线 wiki 抽出的词表**
（`src/data/` 下只有手写的 `*-curated.js`，那是原创内容）。

确认一下没有敏感路径泄漏：

```bat
:: 在项目目录下
dir /b
:: 应该看不到 config.json；如果看到了，它会因为 .gitignore 而不被上传
```

---

## 路线 A：网页上传（不用装 Git，最省事）

适合：只想把代码放上去，之后不打算频繁改。

1. 打开 <https://github.com/new>。
2. **Repository name** 填 `eu4-mod-viewer`。
3. 选 **Public**（或 Private，随你）。**不要**勾选 *Add a README file* /
   *.gitignore* / *license*——我们本地已经有这些文件了，勾了会冲突。
4. 点 **Create repository**。
5. 在新仓库页面点 **uploading an existing file**（或直接开
   `https://github.com/▲你的用户名/eu4-mod-viewer/upload/main`）。
6. 把 `F:\DSH Work\eu4-mod-viewer` 里的内容**拖进去**。

   > ⚠️ 网页上传**不能拖文件夹**，只能一个个拖文件，而且**空目录不会被保留**。
   > 这个项目的目录不多（`src/` `src/codec/` `src/data/` `web/` `tools/` `docs/`），
   > 但一共 140 多个文件（其中 48 张是截图），手拖很累。
   >
   > 更省事的做法：先在本地把整个项目**压缩成 zip**，上传后 GitHub 不会自动解压，
   > 所以还是建议走**路线 B**。
7. Commit message 填 `Initial commit`，点 **Commit changes**。

如果你还是想用网页上传，建议至少用浏览器打开
<https://github.com/▲你的用户名/eu4-mod-viewer/upload/main>，
然后按 `src` → `web` → `tools` → `docs` 分四次拖，每次提交一次。

---

## 路线 B：装 Git 后用命令行（推荐）

### 1. 安装 Git

```powershell
winget install --id Git.Git -e --source winget
```

装完**关掉再重开**终端 / PowerShell，或者直接运行：

```powershell
$env:Path += ';C:\Program Files\Git\cmd'
git --version
```

### 2. 首次配置（只需一次）

```powershell
git config --global user.name  "▲你的名字"
git config --global user.email "▲你的邮箱"
:: Windows 上建议关掉自动换行转换，交给我们自己的 .gitattributes 管
git config --global core.autocrlf false
```

### 3. 初始化并提交

```powershell
cd 'F:\DSH Work\eu4-mod-viewer'

git init -b main
git add .
git status          :: 检查一遍：确认列表里没有 config.json

git commit -m "feat: EU4 mod viewer with game-format preview, zh/en UI and configurable wiki"
```

<details>
<summary>想先确认 <code>.bat</code> 的换行没被改坏（可选）</summary>

```powershell
git ls-files --eol 启动.bat
:: 期望看到 i/crlf（索引里就是 CRLF）
```
</details>

### 4. 关联远程仓库并推送

先在 <https://github.com/new> 建一个**空仓库**（名字 `eu4-mod-viewer`，
**不要**勾 README / .gitignore / license），然后：

```powershell
git remote add origin https://github.com/▲你的用户名/eu4-mod-viewer.git
git push -u origin main
```

推送时会要求登录。Git for Windows 自带凭据管理器，会弹出浏览器让你登录 GitHub，
**不需要手动生成 token**。

如果之前已经配过远程地址又想改：

```powershell
git remote set-url origin https://github.com/▲你的用户名/eu4-mod-viewer.git
```

### 5. 以后再更新

```powershell
cd 'F:\DSH Work\eu4-mod-viewer'
git add .
git commit -m "▲改了什么"
git push
```

---

## 上传后建议做的三件事

1. **补 仓库地址**：`package.json` 里已经写了
   `https://github.com/SAHHakuryuu/eu4-mod-viewer`，
   如果你用了别的仓库名，把 `repository` / `bugs` / `homepage` 三处一起改掉。
2. **加 Topics**：仓库首页右上角 ⚙ → Topics，建议加
   `eu4`、`europa-universalis`、`paradox-interactive`、`modding`、`mod-viewer`、`nodejs`。
3. **确认截图显示正常**：README 用了 `docs/screenshot-*.png` 相对路径，
   在 GitHub 上应该能直接显示。若显示不出来，说明图片没被 `git add` 进去。

---

## 常见问题

**Q: `git push` 报 `remote: Support for password authentication was removed`**
GitHub 不再接受账号密码。用 Git Credential Manager（安装 Git for Windows 时自带，
`git push` 会自动弹窗），或者建一个 Personal Access Token 当密码用：
<https://github.com/settings/tokens> → Generate new token (classic) → 勾 `repo`。

**Q: 别人克隆下来双击 `启动.bat` 打不开**
检查 `.gitattributes` 是否被一起上传了。如果没上传，Git 可能把 CRLF 转成 LF，
cmd.exe 就会解析错乱。补救：

```powershell
git add --renormalize .
git commit -m "fix: keep CRLF for .bat"
```

**Q: 我误把 `config.json` 提交了**
```powershell
git rm --cached config.json
git commit -m "chore: stop tracking config.json"
git push
```
注意历史里仍然有它；如果里面有隐私路径，用
[git filter-repo](https://github.com/newren/git-filter-repo) 或直接删仓库重建。

**Q: 想顺便传一个 Release**
```powershell
git tag v1.0.0
git push origin v1.0.0
```
然后到仓库的 Releases 页面基于这个 tag 写说明。本项目不需要打包产物，
用户下载源码即可运行。

---

## 许可提醒

项目以 **MIT** 发布，仓库里**只有本项目的原创内容**：

- **游戏资源**（贴图、GUI 定义、本地化文本）一律在运行时从**用户自己的 EU4 安装目录**读取，
  仓库里没有任何一份——所以不会有 Paradox 的素材被分发。
- **离线中文 wiki 的内容**一份都没有。那些术语表（`条件` / `命令` / `修正列表` 三页）是
  **CC BY-NC-SA 4.0**（署名—非商业性使用—相同方式共享），把抽取结果提交进来会让整个仓库
  受「非商业性使用」约束。所以仓库里只有解析器 `src/wikigloss.js`，词表在你运行时从
  **你自己挂载的离线 wiki** 里读出来。
- **第三方代码与依赖**：`dependencies` 为 `{}`，只用 Node 内置模块。
- 仓库里唯一属于别人的东西是 `docs/screenshot-*.png`——本项目的验证脚本跑出来的界面截图，
  画面里当然有游戏自己的美术。要更保守的话删掉这个目录即可，README 会少几张图。

《Europa Universalis IV》及其素材是 Paradox Interactive 的商标与版权物；
本仓库不包含任何游戏资源。参与开发前请读 [CONTRIBUTING.md](../CONTRIBUTING.md)——
**不要把 wiki 内容或游戏资源提进来**，那会同时破坏授权和这个项目的可商用性。

> 顺带一句：如果你以后想给这个项目开赞助或用于商业用途，MIT 本身是允许的；
> 但**不要**为了「词表更全」而把 wiki 抽取结果加回仓库，那会立刻让赞助这条路走不通。

