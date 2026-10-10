# The translation pipeline: nine interface languages

The interface ships in **Chinese / English / Français / Deutsch / Español / Português / Русский /
日本語 / 한국어**. Chinese is the source language, English is the fallback, and the other seven hang
off side tables — **nothing anywhere is machine-translated**.

This document is about changing translations. To *add* a language, see the last section.

---

## 1. What is in the repository

| File | Contents | Produced by |
|---|---|---|
| `src/data/locales/_source.backend.json` | `{ english label: [chinese…] }`, extracted from every `L('中文','English')` in `src/**` | `tools/i18n-extract.js` |
| `src/data/locales/_source.frontend.json` | `{ chinese string: english }`, extracted from the dictionaries in `web/i18n*.js` | `tools/i18n-extract.js` |
| `src/data/locales/<lang>.json` | **backend side table**, keyed by the English label | `build-langs.js merge` |
| `src/data/locales/frontend.<lang>.json` | **frontend side table**, keyed by the Chinese string | `build-langs.js merge` |
| `web/lang/<lang>.js` | the browser dictionary, `I18N.extend({…}, '<lang>')` | `build-langs.js merge` |
| `src/data/locales/_work/` | the workbench: cut chunks and translator output | `split` / `delta`, **never committed** (it is in `.gitignore`) |

`web/lang/<lang>.js` is generated but *is* committed: the project has no build step at run time, so
the browser can only get its dictionary from `<script src="/lang/<lang>.js">`.

### Why the two key spaces differ

- **Backend.** `L('中文','English')` appears at 700-odd call sites; those are code, and a translation
  tool has no business rewriting them. The side table is therefore keyed by the **English** side, and
  `pick()` uses it when it is there and falls back to English when it is not.
- **Frontend.** The source says `t('搜索')`, so the key is the **Chinese string itself**. The benefit
  is that an untranslated entry renders its Chinese text instead of leaking a key like
  `search.button`.

Fallback chain:

```
frontend  t('搜索')        requested language → English → the Chinese source
backend   pick(pair, lang) requested language → English → the Chinese source
```

---

## 2. Commands

```bat
:: 0. after touching a string in the source, refresh the two _source files
node tools\i18n-extract.js

:: 1. progress at a glance
node tools\build-langs.js status

:: 2. first round: cut every string into 6 backend + 3 frontend chunks
node tools\build-langs.js split

:: 3. later rounds (incremental): write only the keys this language still lacks
node tools\build-langs.js delta
node tools\build-langs.js delta ja          :: one language only

:: 4. audit the unmerged delta files (placeholders / symbols / edge space / still-the-seed)
node tools\build-langs.js verify ja

:: 5. merge: writes <lang>.json and frontend.<lang>.json, and regenerates web/lang/<lang>.js
node tools\build-langs.js merge

:: 6. the full audit: coverage + placeholders + symbols + edge space + identical-to-source
node tools\build-langs.js check
```

`split` **deletes the whole `_work/` tree**, including every translated delta file. It is therefore
gated: once the workbench holds output, you have to ask for it explicitly.

```bat
node tools\build-langs.js split --force
```

**Later rounds use `delta`, not `split`.** That lesson was paid for: during this round somebody ran
`split` by accident — an earlier revision of the tool defaulted to `split` when it was given no
argument, so a single `node -e "require('./tools/build-langs.js')"` was enough to delete a day of
work, and all seven languages' delta files were gone and had to be redone. Importing the module is now
inert, and the argument-less default still asks for `--force` first.

---

## 3. The rules for one string

`verify` and `check` enforce the first four, and fail on a violation:

1. **Do not touch the key**: no additions, no removals, no renames, no reordering.
2. **Placeholders verbatim**: `{max}`, `{lost}`, `{total}`, `{label}`, `{value}`, `{n}` … none may go
   missing or be renamed.
3. **Symbols verbatim**: `£icon£`, `§R`, `\n`, `[GetName]`, `$COUNTRY$` and friends.
4. **Edge whitespace** is a *code contract*, not typography. `' days'` is concatenated after a
   number, so losing the space produces "30days". `merge` therefore aligns the edges to the English
   shape mechanically; you only have to avoid inventing spaces in the middle.
   - Exception: a string made only of punctuation (`'  '`, `': '`, `'（'`) is exempt — French
     `a : b` and Japanese `a：b` *are* the translation.
5. **Being identical to the source is allowed** (proper nouns, paths, script identifiers such as
   `Conquistador` or `Total`). `check` lists those for a human to confirm; they are not errors.

---

## 4. Later rounds (incremental translation)

After adding a screen's worth of UI:

```bat
node tools\i18n-extract.js            :: refresh _source (the key count grows)
node tools\build-langs.js delta       :: seed only the new keys into delta/<lang>.<kind>.json
::  … translate _work/delta/<lang>.backend.json and <lang>.frontend.json …
node tools\build-langs.js verify <lang>
node tools\build-langs.js merge       :: incremental; existing translations are kept
node tools\build-langs.js check
```

`merge` is **additive**: the previously shipped `<lang>.json` is the base and the chunks only
overwrite the keys they mention. Keys the sources no longer define are dropped, so deleting a label
cannot leave an orphan behind.

`delta` never overwrites a delta file that already holds a translation (unless `--force`), so it is
safe to run repeatedly.

---

## 5. Where the terminology comes from

| Side | Source |
|---|---|
| Chinese | **the offline wiki you mounted yourself** (parsed at run time from the 条件 / 命令 / 修正列表 pages, `src/wikigloss.js`) plus the hand-written `src/data/*-curated.js`. **None of it is in the repository.** |
| Everything else | **the official EU4 localisation**: the exact word the game prints, taken from `Europa Universalis IV\localisation\*_l_<lang>.yml`. If the game has no such word, English is used — never a machine translation, never an invention. |

A few deliberate decisions (not oversights):

- `adm` / `dip` / `mil` keep **the game's own abbreviations** in all seven languages.
- `result = yes|no` is **who won**, not a "show the result" switch: the English wiki's comment on the
  key (`# Show result`) describes the wrong thing. Checked against battles whose outcome is a matter
  of record — the first battle of El Bruc and Zaragoza were French (attacker) defeats and read
  `result = no`, while Cabezón was a French (attacker) victory and reads `result = yes`. Every
  language therefore reads "the attacker won" / "the defender won", and never "show the result".
- Outside Chinese, script identifiers (`land_morale`, `MNG@1368.1.23@monarch`) are shown **as written**:
  that is the official name in the English wiki and in the game's script, and it is directly
  searchable. Only the Chinese interface goes through the Chinese glossary.

---

## 6. This round, measured

Seven languages × (720 backend + 397 frontend); `check` reports 100% for all of them, `CHECK: clean`.

| Language | Backend | Frontend | Identical to source (for review) |
|---|---|---|---|
| fr | 720/720 | 397/397 | 48 |
| de | 720/720 | 397/397 | 19 |
| es | 720/720 | 397/397 | 19 |
| pt | 720/720 | 397/397 | 23 |
| ru | 720/720 | 397/397 | 7 |
| ja | 720/720 | 397/397 | 11 |
| ko | 720/720 | 397/397 | 7 |

The identical-to-source entries are proper nouns (`Conquistador`, `Total`), placeholder-only format
strings (`{label}: {value} / {max}`) and paths.

---

## 7. Adding another language

1. `src/i18n.js`: `LANGS`, `EXTRA_LANGS`, `LANG_LABELS` (**the native name**, e.g. `Italiano`), `LANG_ALIASES`
2. `web/i18n.js`: `LANGS`, `LANG_NAMES`, `LOCALES`, `LANG_ALIASES`
3. `web/index.html`: copy one `<script src="/lang/xx.js"></script>` line
4. `tools/build-langs.js`: `EXTRA_LANGS`
5. `node tools\i18n-extract.js` → `delta` → translate → `merge` (generates `web/lang/xx.js`) → `check`
6. `tools/verify-i18n.js`: add the code to the language loop and the `LOCALE` table, then run the
   end-to-end check

A language name is always written **in its own language**, because a reader is looking for
`Русский`, not for `Russian` — the one class of string that is never translated.

---

[← Back to the README](../README.en.md) · [Contributing](../CONTRIBUTING.en.md) · [中文](TRANSLATING.md)
