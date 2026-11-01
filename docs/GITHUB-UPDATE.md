# 更新仓库

[English](GITHUB-UPDATE.en.md) | **中文**

本机**已经装好 git**，这个项目目录就是仓库本身：`origin` 指向
`https://github.com/SAHHakuryuu/eu4-mod-viewer.git`，工作分支 `main`。日常推送就是三条命令。

`tools/` 里那三个 GitHub API 脚本（`gh-login.js` / `gh-upload.js` / `gh-delete.js`）**仍然保留**，
作为**没有 git 的机器**（另一台电脑、CI、临时容器）的后备方案，见第四节。

---

## 一、日常：改完东西推上去

```powershell
cd "F:\DSH Work\eu4-mod-viewer"

git status                      # 改了哪些文件
git add -A                      # 全部暂存（.gitignore 已排掉本机文件）
git commit -m "一句话说明这次改了什么"
git push
```

- `git push` 用 Windows 凭据管理器里的 GitHub 凭据：**第一次**会弹一次浏览器登录，之后不再问。
  凭据只存在这台机器的凭据库里，**仓库里没有任何 token**。
- 只推一部分：`git add README.md src/`，然后照旧 `commit` / `push`。
- 提交前想看细节：`git diff --stat`、`git diff`；已暂存的看 `git diff --cached`。
- 远端被别人改过（比如在网页上直接编辑过文件）：先 `git pull --rebase`，再 push。
- 第一次在新机器上把仓库取下来：`git clone https://github.com/SAHHakuryuu/eu4-mod-viewer.git`，
  然后 `npm start` 即可，不需要 `npm install`（本项目零依赖）。

### 这个仓库特有的两条注意事项

1. **`.bat` 必须是纯 ASCII + CRLF**。`.gitattributes` 里写了 `*.bat text eol=crlf`：仓库内存 LF、
   检出成 CRLF，`启动.bat` / `start.bat` 里也**不能写中文**（cmd.exe 按 OEM 代码页读批处理），
   所有提示语由 `tools/launcher.js` 打印。改了批处理记得在真实控制台双击验证一次。
2. **永远不入库**：`config.json`（写着你的本机路径）、`src/data/locales/_work/`（翻译工作台）、
   `tools/_*`（一次性探针）、`tools/dds-out/`、`tools/out/`、`tools/shot-*.png`。
   它们都在 `.gitignore` 里，`git status` 不会冒出来；`git add -A` 不会把它们带上去。

---

## 二、撤销与回退

```powershell
git log --oneline -5              # 找到要退到哪一条
git revert <commit>               # 反向提交（已经推送过的用这个，历史不动）
git reset --soft HEAD~1           # 撤掉最近一次提交，改动留在工作区（还没推送时用）
git reset --hard HEAD             # 丢弃所有未提交改动（慎用）
git restore --staged <file>       # 取消暂存
git restore <file>                # 丢弃某个文件的工作区改动
```

---

## 三、仓库里现在是什么

```powershell
git log --oneline -1              # 最新提交
git ls-files | Measure-Object     # 本机实测 146 个被追踪的文件
Get-Content package.json          # 版本号（与 CHANGELOG 一致）
```

追踪的是：源码（`src/` `web/`）、测试与工具（`tools/`）、文档与截图（`README*.md`、`docs/`，
48 张截图）、七种语言侧表（`src/data/locales/*.json` 与生成的 `web/lang/*.js`）、
`package.json` / `.gitignore` / `.gitattributes` / `LICENSE`。

---

## 四、没有 git 的机器：API 脚本（备用）

这三个脚本**零依赖**，不需要 `npm install`，和项目本体一样只靠 Node 自带的能力。

### 一次性准备：token

脚本需要 GitHub 的 **personal access token** 才能代表你操作仓库。两个办法拿到它：

**办法 A（推荐，全自动）**

```powershell
cd "F:\DSH Work\eu4-mod-viewer"
node tools/gh-login.js
```

它会：

1. 打开一个**全新独立配置**的 Chrome 窗口（不碰你平时那个窗口的登录和数据）；
2. 带你去 token 创建页，**自动填好 Note、自动勾上 `repo`**，并用黄框标出要点的位置；
3. 你在那一页点 **Generate token**；
4. 页面上会出现一个输入框，你把 token 粘进去 —— 不依赖剪贴板权限，也不需要窗口在前台；
5. 验证身份 → 建仓库（若不存在）→ 提交全部文件 → 最后把你带到**撤销页面**。

> 用完请务必在撤销页面点 **Delete** 删掉这个 token。它只为一次推送而存在。

**办法 B（已经有 token）**

```powershell
$env:GH_TOKEN = "ghp_你的token"
node tools/gh-upload.js
```

`--token` 参数虽然也支持，但**不推荐**：命令行参数会出现在进程列表和 shell 历史里。

### 日常：用脚本推

```powershell
cd "F:\DSH Work\eu4-mod-viewer"

# 1. 先看一眼这次会推哪些文件（不会联网，不会改任何东西）
node tools/gh-upload.js --dry-run

# 2. 确认没问题再真推
node tools/gh-login.js
```

`--dry-run` 会按 `.gitignore` 过滤后逐行列出文件，并在最后给出数量与体积。**每次推送前
都建议先看一眼**，确认没有把 `config.json`（里面写着你的本机路径）之类的东西带上去。

### 上传是怎么工作的

脚本做的是「服务端建 commit」：

```
每个文件 → POST /git/blobs        得到每个文件的 sha
         → POST /git/trees        把这些 sha 组装成一棵目录树
         → POST /git/commits      基于这棵树建一个 commit
         → PATCH /git/refs        把 main 分支指向这个 commit
```

整棵树一次提交，所以**每次推送都是一个完整快照**，不是增量。这意味着：

- 改了 3 个文件也会重新上传全部 100 多个文件，耗时约 1～3 分钟；
- **本地删掉的文件，下次推送会从仓库里消失**（因为新树里没有它了）；
- 不会被 git 的 merge 冲突困扰，但也不会保留「只改了哪几行」的历史。

### 关于空仓库的那个坑

GitHub 有一条限制：**仓库还没有任何 commit 时，不能通过 Git Data API 写文件**，
会返回 `409 Git Repository is empty.`。脚本已经处理了这种情况 —— 它会先用 Contents API
落一个 `.gitignore` 作为初始提交，再在它上面建立完整提交。你不需要做任何额外操作。

### 删除文件

`gh-upload.js` 只能新增或覆盖。如果某个文件你想从仓库里彻底去掉：

```powershell
# 只删线上的
node tools/gh-delete.js --path tools/some-old-tool.js

# 线上和本地一起删
node tools/gh-delete.js --path tools/some-old-tool.js --local

# 一次删多个
node tools/gh-delete.js --path docs/a.md --path docs/b.md
```

它从环境变量或**剪贴板**里取 token（剪贴板读取不要求窗口在前台）。每个路径产生一个
commit，适合处理零散几个文件；大批量删除直接本地删掉、再跑一次 `gh-login.js` 更省事。

> 注意：`gh-upload.js` 不读 `.gitignore` 之外的忽略规则，`gh-delete.js` 也不会自动删除
> 本地文件 —— 除非你加上 `--local`。两个脚本都不会碰 `config.json`。

---

## 五、脚本清单

| 脚本 | 作用 | 是否需要 token |
|---|---|---|
| `tools/gh-login.js` | 全流程引导：开窗口 → 拿 token → 建仓库 → 推送 → 引导撤销 | 不需要，你自己生成 |
| `tools/gh-upload.js` | 把当前工作树推成一个 commit（`--dry-run` 只列清单） | 需要（环境变量或 `--token`） |
| `tools/gh-delete.js` | 从仓库删除指定路径 | 需要（环境变量或剪贴板） |
| `tools/browser.js` | 上面两个脚本共用的 Chrome DevTools Protocol 客户端 | — |

---

## 常见问题

**Q：装了 git，为什么还留着这些脚本？**

因为「换一台没装 git 的电脑」是真实场景：这些脚本只依赖 Node，产出的**也是标准 commit**，
和 git 建的提交完全兼容 —— 用脚本推完，回来 `git pull --rebase` 就能继续用 git。

**Q：脚本和 git 能混着用吗？**

能。用脚本推过之后，本机 git 里先 `git fetch` 再看 `git status`；要在这上面继续提交，
`git pull --rebase` 把脚本那条 commit 拉下来即可。

**Q：第一次 `git push` 为什么要登录？**

本机没有把明文 token 写进仓库或配置文件。Git 用 Windows 凭据管理器保存一次授权；登录成功后
token 存在系统凭据库里，之后的 push 不再打断你。想换账号：控制面板 → 凭据管理器 →
删除 `git:https://github.com` 那一条即可。

**Q：token 会存在哪里（脚本路线）？**

只存在脚本进程的内存里。不写入任何文件，不进入命令行参数，推送结束进程退出就没了。
唯一一次落在系统剪贴板，是为了让你复制，用完建议随手清掉。

**Q：一定要公开吗？**

`gh-login.js` 默认建**公开**仓库。要私有：`node tools/gh-login.js --private`。

**Q：`gh-upload.js` 的 `--repo` / `--owner` 有什么用？**

`package.json` 里的地址写的是 `SAHHakuryuu/eu4-mod-viewer`。如果你要推到别的名字或组织
下，用 `--repo 别的名字` 覆盖；推到组织下用 `--owner 组织名`。

---

**相关文档**：[GitHub 发布说明](GITHUB.md) · [贡献指南](../CONTRIBUTING.md) · [返回首页](../README.md)
