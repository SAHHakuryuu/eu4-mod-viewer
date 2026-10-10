# Contributing

[English](CONTRIBUTING.en.md) | [中文](CONTRIBUTING.md)

There are only three hard rules in this project, plus a set of conventions that exist so the preview
keeps matching what the game actually shows. **Go through the three rules before you commit** — they
matter far more than code style.

---

## 1. The three hard rules

### 1.1 Never bundle game assets

Textures, GUI geometry and localisation text are always read **at run time from the user's own
installation**:

| Asset | Run-time source | Implementation |
|---|---|---|
| Mission frames, icons, arrows | `…/Europa Universalis IV/gfx/**/*.dds` | `src/codec/dds.js` + the `/tex` route in `src/server.js` |
| Mission-tree geometry | `interface/countrymissionsview.gui` + `*.gfx` | `readGui()` in `src/content/missions.js` |
| In-game text | the mod's and vanilla's `localisation/*.yml` | `src/gameloc.js` |

So the repository must **never** contain a `.dds`, a `.png` copied out of the game folder, or a
`localisation/*.yml`. `tools/dds-out/`, `tools/out/` and `tools/shot-*.png` are local verification
artefacts and are already excluded by `.gitignore`.

### 1.2 Never bundle wiki content

The Chinese term tables (modifiers / conditions / effects) come from a community wiki, and that wiki
is **CC BY-NC-SA 4.0** — attribution, *non-commercial*, share-alike. Shipping an extraction of it as
a data file would drag the whole project under its non-commercial clause, therefore:

- ✅ `src/wikigloss.js` — the parser, **original code**, distributed with the repo
- ❌ `triggers.json` / `effects.json` / `modifiers.json` — the extracted tables, **not in the repo**

When the user has mounted an offline wiki, the program parses those three pages
(`条件.html` / `命令.html` / `修正列表.html`) **at run time**, reading only the copy on the user's own
disk. With no wiki mounted the tables are empty and rendering falls back to `src/data/*-curated.js`
and then to the raw script — **both paths have to keep working**.

> This rule is enforced by `tools/test-wikigloss.js`: it checks that **every extracted key really
> appears on the page it came from** (nothing may be invented), and that the hand-written tables still
> stand on their own with the wiki switched off.

### 1.3 Never add a third-party dependency

`dependencies` and `devDependencies` in `package.json` **must stay `{}`**. Node built-ins only
(`fs` `path` `http` `zlib` `net` `os` `vm` `child_process`) plus plain HTML/CSS/JS. No `npm install`,
no build step. If you want a dependency, first ask whether 200 lines of built-ins can do the job.

---

## 2. Rendering rules: show the script rather than invent something

These rules are the whole point of the project. Check every one of them when you touch the rendering
layer:

- **A command/modifier with no term-table entry**: print the script verbatim and mark it as not
  covered. **Do not** guess a Chinese name.
- **How a value displays** (is `0.1` a `+10%` or a `+0.1`?) may only come from a source that *states*
  it — the wiki's `效果类型` column, or the `mode` in the hand-written table. With no source, print the
  value exactly as the script wrote it. Guessing the default prints a **false number**, which is far
  worse than losing a label; see `modifierLines` in `src/gameterms.js`.
- **A missing localisation key**: show it in red. Never pass the key name off as content.
- **A block that cannot be classified**: fall back to the indented raw script plus a note. Do not drop
  it silently.
- **Deletions and absences**: report them honestly (mission prerequisites pointing outside their tree,
  two missions in one cell, reversed arrows — all of these are in that category). Do not approximate
  them into "looks fine".
- **English mode**: always print the raw script identifier for a term. **Never** machine-translate the
  Chinese term tables.

---

## 3. Code conventions

- **User-facing strings**: the frontend goes through `I18N.t('中文原文')`, the backend through
  `L('中文', 'English')`. A backend `L(...)` returns a `{zh,en}` pair — **to use it as a field value
  you must run it through `pick(pair, lang)` first**, otherwise it renders as `[object Object]`.
- **After changing any wording**: run `node tools/i18n-audit.js check`. It must report 0 missing,
  0 unwrapped Chinese literals and 0 English values containing Chinese.
- **`.bat` files must stay pure ASCII + CRLF**: cmd.exe reads batch files through an OEM code page, so
  Chinese text in them gets mangled. All Chinese messages come from Node instead. `.gitattributes`
  forces CRLF — do not change it to LF.
- **Adding a content type**: register it in `src/content/registry.js` with
  `generic(id, group, category, meta, spec)` or `custom(id, group, category, meta, collect, build)`,
  then give it a position in `TYPE_ORDER` in `src/gamedata.js`. `TYPE_ORDER` drives both the tab order
  and the collection order, so a collector has to be idempotent.
- **Static analysis only**: never run the game, never modify any of the user's files.

---

## 4. Before you commit

```bat
node tools\run-tests.js --all          :: everything, including the headless-browser e2e checks
node tools\i18n-audit.js check         :: wording and dictionary
node tools\build-langs.js check        :: coverage / placeholders / edge whitespace of the nine-language side tables
```

The three e2e tiers need a server already listening on `http://127.0.0.1:4173` (`npm start`).
Without one they **SKIP** rather than FAIL — deliberately: a missing environment must not masquerade
as a failure.

After changing a **string the interface shows** (`L('中文','English')` or `t('中文')`), run two more:

```bat
node tools\i18n-extract.js             :: re-extract _source (the key count grows)
node tools\build-langs.js delta        :: hand only the new keys to the seven languages
```

Details are in **[docs/TRANSLATING.en.md](docs/TRANSLATING.en.md)**. Two things to remember: `_work/`
is a workbench and is **never committed** (it is in `.gitignore`), and `build-langs.js split` deletes
that whole workbench — including another translator's delta files — which is why it demands
`--force` and why later rounds use `delta` instead.

### What each test file covers

| File | Covers |
|---|---|
| `test-codec.js` | localisation codec + Clausewitz parser |
| `test-i18n-backend.js` | the backend zh/en term layer (Chinese output is pinned to prevent regressions) |
| `i18n-audit.js check` | every `t()` key exists in the dictionary; no bare Chinese literals |
| `check-doc-links.js` | every relative link and screenshot in the docs exists and each doc has its language sibling; the markdown shape is checked too (table cells, paired backticks, closed fences, no table flattened into spaces) |
| `check-css.js` | every `var(--x)` has a declaration; an undeclared name hidden behind a fallback is called out separately |
| `build-langs.js check` | the seven side tables: coverage, placeholders, symbols, edge whitespace |
| `test-wikigloss.js` | term tables may only be parsed from the user's wiki, never invented; degrades with no wiki |
| `test-gamedata.js` | content index + the generic card renderers |
| `test-content-types.js` | every content type indexes, builds a card and renders |
| `test-missions.js` | mission-tree layout (slot/position/link semantics + GUI geometry cross-check) |
| `test-history.js` | rulers / leaders / battles: an item's id is built from its position, so it must walk back to the same block |
| `test-fidelity.js` | the parser loses no key present in the source file |
| `test-all-mods.js` | loads every mod and samples every category |
| `test-dds.js` | DDS decoding (synthetic textures + real ones) |
| `verify-game.js` | headless browser: the in-game view, one screenshot per content type |
| `verify-i18n.js` | headless browser: all nine languages, settings, the configurable wiki |
| `verify-wiki.js` | headless browser: the embedded wiki view |

### Adding a test

Register it in the `TESTS` array of `tools/run-tests.js`. If it needs mods, an offline wiki or a
running server, attach a precondition function as `needs:` and give it a `skipReason` — **a missing
environment SKIPs, it does not FAIL**.

---

## 5. Licence

The code is released under the [MIT licence](LICENSE). Contributing means you agree to distribute your
code under the same licence. And please note rule 1.2 above: **do not commit wiki content or game
assets** — that would break both the licence and this project's ability to be used commercially.
