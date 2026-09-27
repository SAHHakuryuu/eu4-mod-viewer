# Publishing to GitHub

[English](GITHUB.en.md) | [中文](GITHUB.md)

This machine currently has **neither Git nor the `gh` CLI installed**, so here are two routes, and
neither of them asks you to install anything on my behalf. Pick one.

> ▲ = a spot you have to replace with your own value.

---

## First, what would actually be uploaded

The repository is ready with these files:

| File | Purpose |
|---|---|
| `.gitignore` | excludes `config.json` (which holds your machine's paths), `node_modules/`, temp files |
| `.gitattributes` | **forces `.bat` to check out with CRLF** — otherwise a clone double-clicked on another machine breaks again |
| `LICENSE` | MIT, copyright line already set to `SAHHakuryuu` |
| `CONTRIBUTING.md` / `CONTRIBUTING.en.md` | the three hard rules: no game assets / no wiki content / no third-party dependencies |
| `package.json` | name, version, `npm start` / `npm test` scripts, placeholder repository URL |
| `config.example.json` | settings template (the real `config.json` is never uploaded) |
| `README.md` / `README.en.md` | badges, screenshots, the bilingual write-up |
| `docs/` | screenshots + localisation key conventions + this file |
| `src/` `web/` `tools/` | all the source and the tests |

**Never uploaded**: `config.json` (your UI language, wiki folder, mod paths), `tools/dds-out/`,
`tools/out/`, any `*.tmp`, and **any term table extracted from the offline wiki** (`src/data/` holds
only the hand-written `*-curated.js`, which is original work).

Check that no sensitive path is about to leak:

```bat
:: from the project folder
dir /b
:: config.json should not appear; if it does, .gitignore keeps it out of the upload anyway
```

---

## Route A: upload through the web UI (nothing to install, simplest)

Good for: getting the code up there without planning to change it often.

1. Open <https://github.com/new>.
2. **Repository name**: `eu4-mod-viewer`.
3. Pick **Public** (or Private, your call). **Do not** tick *Add a README file* / *.gitignore* /
   *license* — we already have those locally, and ticking them causes a conflict.
4. Click **Create repository**.
5. On the new repository page click **uploading an existing file** (or go straight to
   `https://github.com/▲your-username/eu4-mod-viewer/upload/main`).
6. **Drag in** the contents of `F:\DSH Work\eu4-mod-viewer`.

   > ⚠️ The web uploader **cannot take folders** — files only, one at a time — and **empty
   > directories are not preserved**. This project does not have many directories
   > (`src/` `src/codec/` `src/data/` `web/` `tools/` `docs/`), but there are 40-odd files, and
   > dragging them by hand is tedious.
   >
   > Zipping the project first does not help either: GitHub does not unpack an uploaded archive.
   > So **Route B** is recommended.
7. Commit message `Initial commit`, then **Commit changes**.

If you do want the web route, at least open
<https://github.com/▲your-username/eu4-mod-viewer/upload/main> in a browser and drag in four batches —
`src` → `web` → `tools` → `docs` — committing once per batch.

---

## Route B: install Git and use the command line (recommended)

### 1. Install Git

```powershell
winget install --id Git.Git -e --source winget
```

After it finishes, **close and reopen** your terminal / PowerShell, or just run:

```powershell
$env:Path += ';C:\Program Files\Git\cmd'
git --version
```

### 2. First-time configuration (once only)

```powershell
git config --global user.name  "▲your name"
git config --global user.email "▲your email"
:: On Windows, turn off automatic line-ending conversion and let our own .gitattributes decide
git config --global core.autocrlf false
```

### 3. Initialise and commit

```powershell
cd 'F:\DSH Work\eu4-mod-viewer'

git init -b main
git add .
git status          :: look it over: make sure config.json is not in the list

git commit -m "feat: EU4 mod viewer with game-format preview, zh/en UI and configurable wiki"
```

<details>
<summary>Optional: check that the <code>.bat</code> line endings were not mangled</summary>

```powershell
git ls-files --eol 启动.bat
:: you want to see i/crlf (CRLF in the index)
```
</details>

### 4. Add the remote and push

First create an **empty repository** at <https://github.com/new> (name `eu4-mod-viewer`, and
**do not** tick README / .gitignore / license), then:

```powershell
git remote add origin https://github.com/▲your-username/eu4-mod-viewer.git
git push -u origin main
```

The push asks you to sign in. Git for Windows ships the credential manager, which opens a browser for
the GitHub login — **you do not need to create a token by hand**.

If a remote is already configured and you want to change it:

```powershell
git remote set-url origin https://github.com/▲your-username/eu4-mod-viewer.git
```

### 5. Updating later

```powershell
cd 'F:\DSH Work\eu4-mod-viewer'
git add .
git commit -m "▲what changed"
git push
```

---

## Three things worth doing after the upload

1. **Fix the repository URL**: `package.json` already says
   `https://github.com/SAHHakuryuu/eu4-mod-viewer`. If you used a different repository name, change
   all three of `repository` / `bugs` / `homepage`.
2. **Add Topics**: ⚙ in the top-right of the repository page → Topics. Suggested:
   `eu4`, `europa-universalis`, `paradox-interactive`, `modding`, `mod-viewer`, `nodejs`.
3. **Confirm the screenshots render**: the READMEs use relative `docs/screenshot-*.png` paths, which
   should display directly on GitHub. If they do not, the images were not `git add`ed.

---

## FAQ

**Q: `git push` fails with `remote: Support for password authentication was removed`**
GitHub no longer accepts an account password. Use Git Credential Manager (bundled with Git for
Windows; `git push` pops it up), or create a Personal Access Token to use as the password:
<https://github.com/settings/tokens> → Generate new token (classic) → tick `repo`.

**Q: Someone clones it and double-clicking `启动.bat` does nothing**
Check whether `.gitattributes` was uploaded too. Without it Git may convert CRLF to LF and cmd.exe
then misparses the file. To repair:

```powershell
git add --renormalize .
git commit -m "fix: keep CRLF for .bat"
```

**Q: I committed `config.json` by accident**
```powershell
git rm --cached config.json
git commit -m "chore: stop tracking config.json"
git push
```
Note that it is still in the history. If it contained private paths, use
[git filter-repo](https://github.com/newren/git-filter-repo) or just delete the repository and
recreate it.

**Q: I would like to publish a Release too**
```powershell
git tag v1.0.0
git push origin v1.0.0
```
Then write the notes on the repository's Releases page against that tag. This project has no build
artefact — downloading the source is enough to run it.

---

## Licence note

The project is released under **MIT**, and the repository contains **only this project's own original
work**:

- **Game assets** (textures, GUI definitions, localisation text) are always read at run time from the
  **user's own EU4 installation**. Not one of them is in the repository, so no Paradox material is
  redistributed.
- **Nothing from the offline Chinese wiki** is in here either. Those term tables (the `条件` /
  `命令` / `修正列表` pages) are **CC BY-NC-SA 4.0** (attribution — non-commercial — share-alike), and
  committing an extraction would put the whole repository under the non-commercial clause. So the
  repository holds only the parser, `src/wikigloss.js`, and the tables are read at run time from
  **the offline wiki you have mounted**.
- **Third-party code and dependencies**: `dependencies` is `{}`; Node built-ins only.
- The only thing in the repository that belongs to someone else is `docs/screenshot-*.png` — screenshots
  of this project's own UI, which naturally show some of the game's art. Delete that folder if you want
  to be more conservative; the READMEs will simply show fewer images.

*Europa Universalis IV* and its assets are trademarks and copyright of Paradox Interactive; this
repository contains none of them. Before contributing, read [CONTRIBUTING.en.md](../CONTRIBUTING.en.md) —
**do not commit wiki content or game assets**, which would break both the licence and this project's
ability to be used commercially.

> One more thing: if you later want to accept sponsorship or use this commercially, MIT permits it —
> but **do not** add the wiki extraction back to the repository "to make the term tables more
> complete". That would close the sponsorship door immediately.
