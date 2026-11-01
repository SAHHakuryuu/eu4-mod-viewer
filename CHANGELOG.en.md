# Changelog

The version number matches `package.json`; every push adds an entry here.
The Chinese edition is [CHANGELOG.md](CHANGELOG.md).

---

## 1.1.1 — 2026-11-01

### Fixed

- **A modifier's long spelling now gets its Chinese name.** EU4 accepts two spellings of the same
  modifier: `development_cost` (vanilla scripts) and `development_cost_modifier` (which this mod's
  ideas, technologies and monuments use heavily). The term table only listed the short one, so the
  long one fell through to "not in glossary; shown as script". A miss now retries as `X_modifier → X`,
  which brings the name, the percentage mode and the good/bad colour along with it. The alias is not
  written into the table, so counts like "692 modifiers" stay honest. Measured on the main test mod:
  all 10 long spellings found in modifier blocks now resolve.
- **The docs no longer call the seven interface languages "the official EU4 localisation".** The game
  ships exactly four official localisations — English / Français / Deutsch / Español
  (`localisation\*_l_<lang>.yml`, 143 / 145 / 145 / 144 files measured on this machine).
  Português / Русский / 日本語 / 한국어 are this viewer's own interface languages, and the game has no
  official terminology for them, so a game term always prints as the raw script identifier. The side
  tables translate interface text only. README and `docs/TRANSLATING` corrected in both editions.
- `tools/test-wikigloss.js` grows 11 assertions for the long-spelling path (name, mode, tone, and the
  two ways it must *not* fire), 70 passing.

### Added

- **A country card's history is now read as fields** (`terms.historyLines`). The entries in
  `history/countries/*.txt` — `government = monarchy`, `capital = 739`, `monarch = { … }` — are
  *assignments*, not commands, so the effect glossary could only print them as "not in glossary". Now a
  real command the glossary knows (`add_army_tradition`, `add_country_modifier`…) still gets the game
  tooltip, and everything else renders as a field: the name comes from `FIELD_LABEL` plus a new
  `HISTORY_FIELD`, a value that names something is resolved (`capital = 1816` → 北平,
  `historical_rival = CSH` → 大顺, `type = general` → 陆军将领), a person block opens as
  "君主：努尔哈赤", and a leader's four skills read 火力 / 冲击 / 机动 / 围城. On the main test mod's
  QNG card the raw script keys dropped from 222 to 101, and what is left is flag names and numbers that
  have no translation to begin with.
- `tools/test-content-types.js` grows 5 country-history assertions (fields are labelled, a person opens
  as a block, commands stay on the effect path, and no *named* field may fall back to a raw key), 289
  passing.

### Other

- The side tables gain the 8 new field names (8 per language for fr/de/es/pt/ru/ja/ko): **744** backend
  and **398** frontend strings, 100% coverage, `build-langs.js check` → `CHECK: clean`. The measured
  numbers in the README and both TRANSLATING docs were updated to match.

---

## 1.1.0 — 2026-10-11

### Added

- **Four content types: historical rulers / leaders / battles / advisors** (`src/content/history.js`)
  - *Historical rulers*: the `monarch` / `heir` / `queen` / `monarch_consort` blocks of
    `history/countries/*.txt`, with monarch power, dynasty, life dates, claim strength, the
    regency and female flags and ruler traits. When the ruler also carries a `leader` block, his
    four commander pips are drawn on the same card and cross-link to the standalone leader entry.
  - *Historical leaders*: both places a leader can live are indexed — a free-standing `leader` block
    in a dated entry and the one nested inside a `monarch`/`heir` block — with `type`
    (general / admiral / explorer / conquistador), fire/shock/maneuver/siege pips, life dates and traits.
  - *Historical battles*: the `battle` blocks of `history/wars/*.txt`, with the battlefield province,
    the war they belong to, each side's country / commander / infantry / cavalry / artillery / total
    and losses, **and who won**. A line at the top of the card reproduces the game's own sentence —
    "N soldiers of A attacked M soldiers of B" (ships for a naval battle, the generic wording when
    both are mixed) — above two side panels tinted by won/lost. `result = yes` means the attacker
    won, `no` means the defender did; that was checked battle by battle against the real files
    (Zaragoza carries `no` and was a French attacking victory, Cabezón carries `yes` and is also an
    attacker victory). The loss figure is already **a percentage of that side's strength**, so it is
    printed as `%`.
  - *Historical advisors*: the `advisor` blocks that sit at the **top level** of
    `history/advisors/*.txt` (not inside a dated entry), with `advisor_id`, name, `location` (resolved
    to the province name), `skill` 1–3, `type` (philosopher / theologian / navigator …), the appointed
    and death dates, `discount`, and the religion / culture / female flags.
  - Measured on the main test mod: monarchs 2,412 + heirs 964 + consorts 267 = 3,643 rulers;
    1,061 leaders; 98 battles; 55 advisors.
- **The interface now ships in nine languages** instead of two: 中文 / English / Français / Deutsch /
  Español / Português / Русский / 日本語 / 한국어. Each of the seven new ones covers **720 backend +
  397 frontend** strings, 100%.
- **A translation pipeline**: `tools/i18n-extract.js` (key extraction) and two new subcommands of
  `tools/build-langs.js` — `delta` (hand out only the new keys) and `verify` (audit the unmerged
  delta files). The new [docs/TRANSLATING.en.md](docs/TRANSLATING.en.md) documents the whole flow
  and how to add a language.
- **New tests**: `tools/test-history.js` (51 assertions: unique ids, walking the chain back to the
  block, pip scale, cross-links, plus the battle winner / losses / unit-kind block and the advisor
  block), `tools/check-doc-links.js` (26 assertions: every relative link and screenshot in the
  documentation exists and each document has its language sibling, plus four **markdown shape** rules
  — a table row must carry as many cells as its header, no "text row followed by `--- ---`" flattened
  table, backticks must pair up on a line or across two neighbours, fences must close — and two that
  name this very corruption: a lone `v` between punctuation, and a fence written as `vvv`. All six were
  verified against the damaged files themselves, which is how the count below was earned),
  `tools/check-css.js` (10 assertions: six of them a self-test, plus all 245 `var()` references
  resolving to a declaration).
- Four new screenshots: `docs/screenshot-game-monarchs.png`, `-leaders.png`, `-battles.png` and
  `-hist-advisors.png`, plus the before/after pair for the header language picker
  (`docs/screenshot-header-before.png` / `-after.png`; the "after" one is re-shot by
  `verify-i18n.js` on every run).

### Fixed

- **The header language picker was an empty white box.** Its rule said
  `background: var(--panel, #fff)`, and `--panel` **was never declared anywhere** — the fallback
  quietly won, so the background became pure white; `color: inherit` in the same rule then picked up
  the navy header's near-white `#eef2f7`. White on white, a contrast ratio of **1.00:1**: the control
  looked like a blank white button that never showed the current language. It is now an opaque navy
  fill (`#2c4468`) with gold text (`#e0c48a`) — **5.83:1** — and its dropdown rows are **16.13:1**.
  The arrow is a drawn SVG instead of the UA one (dark grey on Windows, invisible against navy), and
  `font-variant: small-caps` is gone: it rendered `English` as `ENGLISH` while leaving `中文` alone,
  and a language name has to appear as written. All nine names were measured to fit uncut.
- **A second instance of the same mistake:** `--pdx-gold-dim` was undeclared too, quietly running on
  its `#b99450` fallback. The declaration is now part of the palette (**rendering is pixel-identical**),
  and three variables nothing referenced were dropped (`--gw-ink`, `--gw-parch-2` and
  `--wiki-link-visited`). The new `tools/check-css.js` requires a declaration for every `var(--x)` and
  **calls out the fallback-masked kind separately** — that is this bug's exact shape: the page renders
  fine and the error lives only where nobody looks. The checker self-tests first, proving it catches
  both spellings before it reports a verdict.

  | Before (white on white, 1.00:1) | After (5.83:1) |
  |---|---|
  | ![The picker before the fix: white text on a white box, reading as an empty control](docs/screenshot-header-before.png) | ![The picker after the fix: navy fill, gold text and a drawn arrow](docs/screenshot-header-after.png) |

  (The "after" close-up is re-captured by `verify-i18n.js` on every run; the "before" one is a
  historical capture from before the fix.)
- **The decoder lost characters.** The layer that maps a string back to bytes sanitised
  "invalid UTF-8" into U+FFFD, which ate *legitimate CP1252 bytes* such as 0xF9 — so `曹` (U+66F9)
  was displayed as `曽` (U+66FD). `cp1252Normalize()` now decodes UTF-8 sequences and keeps every
  other byte, behind an explicit `utf8Walk()` decision (C1 code points accepted, overlong and
  malformed sequences rejected).
- **Colliding ids for history entries.** The 64 places where one `.txt` repeats a date block gave two
  entries the same id. The date part now carries `#2`: `BYZ@1341.6.15#2@monarch`.
- **Every battle reported zero troops.** `Number(scalarValue(entry))` is always `0` (the
  `Number(null)` trap). A `numOf()` helper now reads the real figures back, e.g. `38,000` / `250,000`.
- **Washed-out table rows in the dark panel.** The wiki table's pale zebra striping collided with the
  panel's light text, making rows like `War` nearly invisible; tables inside the panel now share one
  translucent background.
- **`build-langs.js` could delete the workbench.** With no argument it defaulted to `split`, which
  wipes the whole `_work/` tree (including seven languages' finished delta files). `require`ing the
  module is now inert, and `split` demands `--force` once output exists.
- History list rows showed a stray "slot monarch" tag (they reused the mission series' `slot` field).
- **Both READMEs had been written over (a real bug, not a style choice).** In `README.md` **every
  table's `|` had turned into a space** (38 tables / 170 rows: `| key | value |` read `  key   value `,
  so no table rendered at all), and in `README.en.md` **every backtick had turned into the letter `v`**
  (724 of them: `/api/status` read `v/api/statusv`). A plain text replacement would also have hit the
  `v` inside ordinary English words, so the repair works from structure instead: tables are rebuilt
  only when a header row sits directly above a flattened `--- ---` separator with a matching cell count
  (anything ambiguous is left untouched and reported), and the backticks are recovered line by line
  with a dynamic program — markdown backticks always pair up in order, so each `v` is weighed as
  "a letter" or "a delimiter", the latter only paying off when the enclosed text **looks like code
  rather than prose** (function words such as `the` / `of` / `a` are heavily penalised). Both files
  were then checked against each other: 355 code spans each, 25 headings, 14 fences, 206 vs 208 table
  rows, and 252 of the Chinese edition's 254 pure-ASCII spans appear verbatim in the English one —
  the seven that go the other way are `Russian` / `monarch` / `heir` / `queen` / `monarch_consort`,
  code spans by design. Two machine-checkable clinchers: the 724 substitutions were confirmed
  **byte by byte** to change nothing but `v` → backtick (same line count, same line lengths, every
  other character identical), and outside fenced blocks **not one line** has an odd number of
  backticks (an unpaired one would render the rest of the document as code).

### Changed

- `src/i18n.js` / `web/i18n.js`: nine side tables, native language names, alias normalisation; the
  frontend fallback chain is "requested language → English → the Chinese source", and `<html lang>`
  carries the full BCP-47 locale (`ja-JP` and friends).
- `src/gameterms.js`: field labels for rulers, leaders and battles (life dates, claim, the four pips,
  losses, commander …).
- `src/content/common.js` / `gamedata.js`: synthetic titles support a `{ tpl, vars }` template, because
  the position of a number differs between languages.
- `.gitignore`: the translation workbench `src/data/locales/_work/` is excluded.
- `package.json`: version 1.1.0, plus `test:history`, `test:content-types`, `verify:i18n`,
  `langs:extract`, `langs:delta` and `langs:check` scripts.
- Documentation: both editions of the README and CONTRIBUTING brought up to date (35 content types,
  nine languages, the measured numbers), and `docs/GITHUB.md` lists what is newly included and excluded.

### Removed

- Nine throwaway probe scripts (`tools/_*-probe.js`), used only while chasing the encoding problem.

### Deliberate, not pending

- **`result` decides whether the war screen prints an outcome — and that outcome *is* the winner.**
  `result = yes` means the attacker won, `no` means the defender did. The English wiki's comment on the
  key (`# Show result`) only states the first half and reads as if the file held no verdict at all;
  checking real files confirmed the second half. The card reports that winner and infers nothing more.
- **A bare `0xBF` byte in a script is shown as `¿`**, because that is what the game prints: the
  double-byte patch's decoder sends every non-escape byte through CP1252 (0xBF = `¿`) and its encoder
  only writes an escape sequence when `high != 0`, so the byte can never be a length marker. Cleaning
  it up would be falsifying the mod.

---

## 1.0.0 — first release

A zero-dependency viewer for EU4 mods: 35 change categories, 31 content types in the in-game format
preview (events, decisions, mission trees, ideas, government, religion, culture, buildings, trade,
units, technology, modifiers, scripted effects, map, interface …), decoding of the game's private
Chinese encoding, a Chinese / English interface, switchable offline Chinese and online English wikis,
and on-the-fly DDS → PNG decoding. See [README.en.md](README.en.md) for the details.
