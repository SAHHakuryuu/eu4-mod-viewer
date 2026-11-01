# Updating the repository

**English** | [中文](GITHUB-UPDATE.md)

**git is installed**, and this project directory *is* the repository: `origin` points at
`https://github.com/SAHHakuryuu/eu4-mod-viewer.git`, working branch `main`. Day-to-day publishing is
three commands.

The three GitHub API scripts in `tools/` (`gh-login.js` / `gh-upload.js` / `gh-delete.js`) are **still
here** as the fallback for a machine **without git** (another PC, CI, a throwaway container) — see
section 4.

---

## 1. Day to day: pushing your changes

```powershell
cd "F:\DSH Work\eu4-mod-viewer"

git status                      # what changed
git add -A                      # stage everything (.gitignore already drops machine-local files)
git commit -m "one line about this change"
git push
```

- `git push` uses the GitHub credential stored by Windows Credential Manager: the **first** push opens
  a browser sign-in, after that it never asks again. The credential lives in this machine's credential
  store only — **no token is kept in the repository**.
- Push only part of the tree: `git add README.md src/`, then `commit` / `push` as usual.
- Want to see exactly what you are about to ship: `git diff --stat`, `git diff`; for what is already
  staged, `git diff --cached`.
- If someone changed the remote (say, an edit made on the web): `git pull --rebase`, then push.
- On a new machine: `git clone https://github.com/SAHHakuryuu/eu4-mod-viewer.git`, then `npm start`.
  There is no `npm install` — the project has no dependencies.

### Two caveats specific to this repository

1. **`.bat` files must stay pure ASCII with CRLF.** `.gitattributes` says `*.bat text eol=crlf`: LF in
   the repository, CRLF on checkout, and `启动.bat` / `start.bat` must contain **no non-ASCII text** at
   all (cmd.exe reads batch files in the OEM code page); every localised message is printed by
   `tools/launcher.js` instead. After touching a batch file, double-click it in a real console once.
2. **Never committed**: `config.json` (it holds your machine paths), `src/data/locales/_work/` (the
   translation workbench), `tools/_*` (one-off probes), `tools/dds-out/`, `tools/out/`,
   `tools/shot-*.png`. They are all in `.gitignore`, so `git status` never shows them and `git add -A`
   never picks them up.

---

## 2. Undo and roll back

```powershell
git log --oneline -5              # find the commit to go back to
git revert <commit>               # inverse commit (use this once a commit is already pushed)
git reset --soft HEAD~1           # drop the last commit, keep the changes in the working tree
git reset --hard HEAD             # throw away every uncommitted change (careful)
git restore --staged <file>       # unstage
git restore <file>                # discard the working-tree change of one file
```

---

## 3. What is in the repository now

```powershell
git log --oneline -1              # latest commit
git ls-files | Measure-Object     # 146 tracked files, measured on this machine
Get-Content package.json          # version (matches the CHANGELOG)
```

Tracked: source (`src/`, `web/`), tests and tools (`tools/`), docs and screenshots (`README*.md`,
`docs/`, 48 screenshots), the seven language side tables (`src/data/locales/*.json` plus the generated
`web/lang/*.js`), and `package.json` / `.gitignore` / `.gitattributes` / `LICENSE`.

---

## 4. A machine without git: the API scripts (fallback)

Those three scripts are **zero-dependency**, need no `npm install`, and rely only on what Node ships
with — just like the project itself.

### One-time setup: the token

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

### Day to day: pushing with the scripts

```powershell
cd "F:\DSH Work\eu4-mod-viewer"

# 1. First look at which files this push would include (no network, changes nothing)
node tools/gh-upload.js --dry-run

# 2. If that looks right, really push
node tools/gh-login.js
```

`--dry-run` filters by `.gitignore` and lists every file, ending with a count and a total size. **Look
at it before every push** to make sure nothing like `config.json` (which contains your machine paths)
goes up.

### How the upload works

The script builds the commit **server side**:

```
every file → POST /git/blobs        one sha per file
           → POST /git/trees        those shas assembled into a directory tree
           → POST /git/commits      one commit over that tree
           → PATCH /git/refs        move the main branch to that commit
```

The whole tree goes up in one commit, so **every push is a full snapshot**, not an increment. That
means:

- changing 3 files re-uploads all 100-odd files, about 1–3 minutes;
- **a file deleted locally disappears from the repository** on the next push (the new tree has no entry
  for it);
- no git merge conflicts to worry about, but no "which lines changed" history either.

### The empty-repository trap

GitHub has one restriction: **a repository with no commits at all cannot be written through the Git
Data API** — it answers `409 Git Repository is empty.` The scripts handle it: they first drop a
`.gitignore` through the Contents API as an initial commit, then build the full commit on top. Nothing
extra for you to do.

### Deleting files

`gh-upload.js` can only add or overwrite. To remove a path from the repository for good:

```powershell
# remote only
node tools/gh-delete.js --path tools/some-old-tool.js

# remote and local
node tools/gh-delete.js --path tools/some-old-tool.js --local

# several at once
node tools/gh-delete.js --path docs/a.md --path docs/b.md
```

It takes the token from the environment or from the **clipboard** (reading the clipboard needs no
foreground window). Each path produces one commit — fine for a handful of files; for a big cleanup it
is easier to delete locally and run `gh-login.js` once.

> Note: `gh-upload.js` honours nothing beyond `.gitignore`, and `gh-delete.js` does not delete local
> files unless you pass `--local`. Neither script ever touches `config.json`.

---

## 5. The scripts

| Script | Purpose | Needs a token |
|---|---|---|
| `tools/gh-login.js` | The whole guided flow: open a window → get a token → create the repository → push → take you to revoke | No, you generate it yourself |
| `tools/gh-upload.js` | Push the current working tree as one commit (`--dry-run` only lists it) | Yes (environment variable or `--token`) |
| `tools/gh-delete.js` | Delete the given paths from the repository | Yes (environment variable or clipboard) |
| `tools/browser.js` | The Chrome DevTools Protocol client shared by the two scripts above | — |

---

## FAQ

**Q: git is installed — why keep the scripts?**

Because "a machine without git" is a real situation: they need nothing but Node, and what they produce
are **standard commits**, fully compatible with git — push with them, then `git pull --rebase` here and
carry on with git.

**Q: Can the scripts and git be mixed?**

Yes. After a script push, `git fetch` and look at `git status`; to commit on top of it, `git pull
--rebase` first so the script's commit is in your history.

**Q: Why does the first `git push` ask me to sign in?**

No plaintext token is written into the repository or a config file. Git stores one authorisation in
Windows Credential Manager; after that push does not interrupt you. To switch accounts: Control Panel →
Credential Manager → remove the `git:https://github.com` entry.

**Q: Why do I have to sign in once (script route)? Can't it reuse the login in my browser?**

No. Chrome's debugging port **can only be opened at startup** — the window you normally keep open did
not open it, so no tool can attach to it; and since Chrome 136 the default profile is explicitly
forbidden from enabling that port. So `gh-login.js` can only open a window of its own, and that window
is a brand-new, clean profile that needs you to sign in once.

**Q: Where is the token stored (script route)?**

Only in the script process's memory. It is not written to any file, it does not go into command-line
arguments, and it is gone once the push finishes and the process exits. The one time it lands in the
system clipboard is so that you can copy it; it is worth clearing afterwards.

**Q: Does it have to be public?**

`gh-login.js` creates a **public** repository by default. For private:
`node tools/gh-login.js --private`.

**Q: What are `--repo` / `--owner` on `gh-upload.js` for?**

The URL in `package.json` says `SAHHakuryuu/eu4-mod-viewer`. If you want to push under a different name
or organisation, override it with `--repo other-name`; to push under an organisation, use
`--owner org-name`.

---

**Related docs**: [GitHub publishing notes](GITHUB.en.md) · [Contributing guide](../CONTRIBUTING.en.md) · [Back to the README](../README.en.md)
