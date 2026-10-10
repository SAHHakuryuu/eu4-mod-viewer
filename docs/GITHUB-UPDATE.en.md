# Updating the repository (what to do when there is no git)

**English** | [中文](GITHUB-UPDATE.md)

This project is meant to go up on GitHub, but your machine has **no git installed**, and no GitHub
Desktop either. So the repository is not pushed with `git push`; instead, three scripts in `tools/`
create commits directly through GitHub's HTTP API.

Those three scripts are **zero-dependency**, need no `npm install`, and rely only on what Node ships
with — just like the project itself.

---

## One-time setup: the token

The scripts need a GitHub **personal access token** to act on the repository on your behalf. Two ways
to get one:

**Option A (recommended, fully automatic)**

```powershell
cd "F:\DSH Work\eu4-mod-viewer"
node tools/gh-login.js
```

What it does:

1. Opens a Chrome window with a **brand-new, separate profile** (it does not touch the login or the
   data of the window you normally use);
2. Takes you to the token creation page, **fills in the Note for you, ticks `repo` for you**, and
   marks the spot to click with a yellow box;
3. You click **Generate token** on that page;
4. An input box appears on the page and you paste the token into it — no clipboard permission needed,
   and the window does not have to be in the foreground;
5. Verifies your identity → creates the repository (if it does not exist) → commits every file →
   finally takes you to the **revoke page**.

> When you are done, be sure to click **Delete** on the revoke page to get rid of this token. It exists
> only for a single push.

**Option B (you already have a token)**

```powershell
$env:GH_TOKEN = "ghp_your_token"
node tools/gh-upload.js
```

The `--token` argument is supported too, but it is **not recommended**: command-line arguments show up
in the process list and in the shell history.

---

## Day to day: pushing your changes

```powershell
cd "F:\DSH Work\eu4-mod-viewer"

# 1. First look at which files this push would include (no network, changes nothing)
node tools/gh-upload.js --dry-run

# 2. Once it looks right, do the real push
node tools/gh-login.js
```

`--dry-run` filters through `.gitignore` and lists the files line by line, ending with a count and a
total size. **It is worth a look before every push**, to make sure nothing like `config.json` (which
holds your local paths) is going up with it.

### How the upload works

There is no local git, so what the scripts do is "create the commit server-side":

```
每个文件 → POST /git/blobs        得到每个文件的 sha
         → POST /git/trees        把这些 sha 组装成一棵目录树
         → POST /git/commits      基于这棵树建一个 commit
         → PATCH /git/refs        把 main 分支指向这个 commit
```

The whole tree goes up in one commit, so **every push is a complete snapshot, not an increment**. That
means:

- changing 3 files still re-uploads all 100-odd files, which takes about 1–3 minutes;
- **a file you deleted locally disappears from the repository on the next push** (because it is no
  longer in the new tree);
- you will not be bothered by git merge conflicts, but you also do not keep a "which lines changed"
  history.

### The empty-repository gotcha

GitHub has one restriction: **while a repository has no commit at all, you cannot write files through
the Git Data API** — it returns `409 Git Repository is empty.`. The scripts already handle this case —
they first drop a `.gitignore` through the Contents API as an initial commit, then build the full
commit on top of it. There is nothing extra for you to do.

---

## Deleting files

`gh-upload.js` can only add or overwrite. If you want a file gone from the repository for good, use
this one:

```powershell
# remote only
node tools/gh-delete.js --path tools/some-old-tool.js

# remote and local together
node tools/gh-delete.js --path tools/some-old-tool.js --local

# several at once
node tools/gh-delete.js --path docs/a.md --path docs/b.md
```

It takes the token from the environment variable or from the **clipboard** (reading the clipboard does
not require the window to be in the foreground). Each path produces one commit, which suits a few stray
files; for a large batch it is less hassle to delete them locally and run `gh-login.js` once more.

> Note: `gh-upload.js` reads no ignore rules beyond `.gitignore`, and `gh-delete.js` will not delete
> local files on its own — unless you add `--local`. Neither script touches `config.json`.

---

## FAQ

**Q: Why do I have to sign in once? Can't it reuse the login in my browser?**

No. Chrome's debugging port **can only be opened at startup** — the window you normally keep open did
not open it, so no tool can attach to it; and since Chrome 136 the default profile is explicitly
forbidden from enabling that port. So `gh-login.js` can only open a window of its own, and that window
is a brand-new, clean profile that needs you to sign in once.

**Q: Where is the token stored?**

Only in the script process's memory. It is not written to any file, it does not go into command-line
arguments, and it is gone once the push finishes and the process exits. The one time it lands in the
system clipboard is so that you can copy it; it is worth clearing afterwards.

**Q: Does it have to be public?**

`gh-login.js` creates a **public** repository by default. For private:
`node tools/gh-login.js --private`.

**Q: Can I still use these scripts after I install git later?**

Yes, but there is no need. Once git is installed, ordinary `git` commands are the better fit, and the
repository's history and contents are fully compatible — what these scripts produce are standard
commits.

**Q: What are `--repo` / `--owner` on `gh-upload.js` for?**

The URL in `package.json` says `SAHHakuryuu/eu4-mod-viewer`. If you want to push under a different name
or organisation, override it with `--repo other-name`; to push under an organisation, use
`--owner org-name`.

---

## The scripts

| Script | Purpose | Needs a token |
|---|---|---|
| `tools/gh-login.js` | The whole guided flow: open a window → get a token → create the repository → push → take you to revoke | No, you generate it yourself |
| `tools/gh-upload.js` | Push the current working tree as one commit (`--dry-run` only lists it) | Yes (environment variable or `--token`) |
| `tools/gh-delete.js` | Delete the given paths from the repository | Yes (environment variable or clipboard) |
| `tools/browser.js` | The Chrome DevTools Protocol client shared by the two scripts above | — |

---

**Related docs**: [GitHub publishing notes](GITHUB.en.md) · [Contributing guide](../CONTRIBUTING.en.md) · [Back to the README](../README.en.md)
