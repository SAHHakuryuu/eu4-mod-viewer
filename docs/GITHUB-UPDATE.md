# 更新仓库（没有 git 的时候怎么办）

[English](GITHUB-UPDATE.en.md) | **中文**

这个项目要推到 GitHub，但你的电脑上**没有安装 git**，也没有 GitHub Desktop。所以仓库
不是用 `git push` 推的，而是用 `tools/` 里三个脚本，通过 GitHub 的 HTTP API 直接建立
commit。

这三个脚本**零依赖**，不需要 `npm install`，和项目本体一样只靠 Node 自带的能力。

---

## 一次性准备：token

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

---

## 日常：改完东西怎么推上去

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

本地没有 git，所以脚本做的是「服务端建 commit」：

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

---

## 删除文件

`gh-upload.js` 只能新增或覆盖。如果某个文件你想从仓库里彻底去掉，用它：

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

## 常见问题

**Q：为什么必须登录一次？不能复用我浏览器里的登录吗？**

不能。Chrome 的调试端口**只在启动时**才能打开，你平时开着的窗口没有开，任何工具都无法
接上去；而且从 Chrome 136 起，官方明确禁止对默认配置开启这个端口。所以 `gh-login.js`
只能开一个自己的窗口，那个窗口是全新的、干净的配置，需要你登录一次。

**Q：token 会存在哪里？**

只存在脚本进程的内存里。不写入任何文件，不进入命令行参数，推送结束进程退出就没了。
唯一一次落在系统剪贴板，是为了让你复制，用完建议随手清掉。

**Q：一定要公开吗？**

`gh-login.js` 默认建**公开**仓库。要私有：`node tools/gh-login.js --private`。

**Q：以后装了 git 还能用这些脚本吗？**

能，但没必要。装了 git 之后用普通的 `git` 命令更合适，仓库的历史和内容完全兼容 ——
这些脚本产出的就是标准 commit。

**Q：`gh-upload.js` 的 `--repo` / `--owner` 有什么用？**

`package.json` 里的地址写的是 `SAHHakuryuu/eu4-mod-viewer`。如果你要推到别的名字或组织
下，用 `--repo 别的名字` 覆盖；推到组织下用 `--owner 组织名`。

---

## 脚本清单

| 脚本 | 作用 | 是否需要 token |
|---|---|---|
| `tools/gh-login.js` | 全流程引导：开窗口 → 拿 token → 建仓库 → 推送 → 引导撤销 | 不需要，你自己生成 |
| `tools/gh-upload.js` | 把当前工作树推成一个 commit（`--dry-run` 只列清单） | 需要（环境变量或 `--token`） |
| `tools/gh-delete.js` | 从仓库删除指定路径 | 需要（环境变量或剪贴板） |
| `tools/browser.js` | 上面两个脚本共用的 Chrome DevTools Protocol 客户端 | — |

---

**相关文档**：[GitHub 发布说明](GITHUB.md) · [贡献指南](../CONTRIBUTING.md) · [返回首页](../README.md)
