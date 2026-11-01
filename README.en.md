# EU4 Mod Viewer

[English](README.en.md) | [中文](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![Languages](https://img.shields.io/badge/UI-9%20languages-informational.svg)](#-ui-language-nine-of-them)

A local, wiki-style viewer that **reads an Europa Universalis IV mod and shows every change it makes**.
It finds the mods you already have installed, sorts their tens of thousands of files by *what they
change about the game*, decodes the Chinese text inside them correctly (EU4 uses a private escape
encoding), and then presents all of it the way a wiki would.

**Zero dependencies**: Node.js built-ins plus plain HTML/CSS/JS. No `npm install`, no build step.

> The interface and the screenshots below are in Chinese because that is this tool's primary
> audience; press the language button (or read [UI language](#-ui-language-nine-of-them))
> for the fully translated English UI.

| Change overview | Localisation (Chinese auto-decoded) |
|---|---|
| ![Overview](docs/screenshot-overview.png) | ![Localisation](docs/screenshot-localisation.png) |

| Structured script view | Embedded offline Chinese wiki |
|---|---|
| ![Script](docs/screenshot-script-tree.png) | ![Wiki](docs/screenshot-wiki.png) |

### 🎮 In-game format preview

It **pairs each script file with its localisation** and renders it the way EU4 actually shows it in
game — **35 content types in all**. The tab bar first collapses them into 6 groups
(content / country / religion & economy / military / world / system) and expands one at a time;
pick an entry on the left and the right side shows what the game would display, with a
script ↔ localisation correspondence table underneath.

| Event window (with the real event picture) | Decisions |
|---|---|
| ![Events](docs/screenshot-game-event.png) | ![Decisions](docs/screenshot-game-decisions.png) |

| National ideas | Idea groups |
|---|---|
| ![National ideas](docs/screenshot-game-national-ideas.png) | ![Idea groups](docs/screenshot-game-ideas.png) |

| Advisors | Policies |
|---|---|
| ![Advisors](docs/screenshot-game-advisors.png) | ![Policies](docs/screenshot-game-policies.png) |

| Mission trees (the in-game grid) | Missions (one mission + its whole tree) |
|---|---|
| ![Mission trees](docs/screenshot-game-mission-trees.png) | ![Missions](docs/screenshot-game-missions.png) |

| Government reforms | Estates |
|---|---|
| ![Government](docs/screenshot-game-government.png) | ![Estates](docs/screenshot-game-estates.png) |

| Disasters | Parliament |
|---|---|
| ![Disasters](docs/screenshot-game-disasters.png) | ![Parliament](docs/screenshot-game-parliament.png) |

| Units & military | Buildings |
|---|---|
| ![Units](docs/screenshot-game-units.png) | ![Buildings](docs/screenshot-game-buildings.png) |

| Religion | Great projects |
|---|---|
| ![Religion](docs/screenshot-game-religion.png) | ![Great projects](docs/screenshot-game-great-projects.png) |

| Cultures (all reference chips) | Map (regions → provinces) |
|---|---|
| ![Cultures](docs/screenshot-game-culture.png) | ![Map](docs/screenshot-game-map.png) |

| Technology levels (six-way modifiers + unlocked units) | Interface (GUI control tree) |
|---|---|
| ![Technology](docs/screenshot-game-technology.png) | ![Interface](docs/screenshot-game-interface.png) |

| Ruler traits (with per-slot conditions and weights) | Leader traits |
|---|---|
| ![Ruler traits](docs/screenshot-game-ruler-traits.png) | ![Leader traits](docs/screenshot-game-leader-traits.png) |

| 👑 Historical rulers (pips + dynasty + the general he also was) | 🎓 Historical advisors (type + skill + province) |
|---|---|
| ![Historical rulers](docs/screenshot-game-monarchs.png) | ![Historical advisors](docs/screenshot-game-hist-advisors.png) |

| 🗡 Historical leaders (fire/shock/maneuver/siege + traits) | 💥 Historical battles (who won, who attacked whom, losses) |
|---|---|
| ![Historical leaders](docs/screenshot-game-leaders.png) | ![Historical battles](docs/screenshot-game-battles.png) |

The remaining types (countries, rebels, ages, trade, war & peace, bookmarks, modifiers, scripted
effects, on_actions) are in `docs/screenshot-game-*.png` as well (36 screenshots in total).

![Preview overview](docs/screenshot-game-overview.png)

### 🌐 Nine interface languages + ⚙ Settings

| Settings (Chinese) | Settings (English) |
|---|---|
| ![Settings zh](docs/screenshot-settings-zh.png) | ![Settings en](docs/screenshot-settings-en.png) |

| Server-side folder picker | What you see with the local wiki switched off |
|---|---|
| ![Picker](docs/screenshot-settings-picker.png) | ![Wiki off](docs/screenshot-wiki-off-settings.png) |

| Related wiki pages (local offline + English online) | With both wikis off, the category page says why |
|---|---|
| ![Wiki links](docs/screenshot-wiki-links-en.png) | ![Wiki disabled](docs/screenshot-wiki-disabled-en.png) |

---

## Quick start

### Option 1: double-click (recommended)

```bat
:: In the eu4-mod-viewer folder, double-click either one
启动.bat        :: Chinese file name
start.bat       :: English file name, identical content
```

### Option 2: command line

```bat
node tools\launcher.js              :: same as npm start
node tools\launcher.js --lang en    :: English UI + English console
node tools\launcher.js --port 4200  :: use another port
node tools\launcher.js --help       :: every flag

npm start                           :: needs Node 18+
npm run start:en                    :: English UI
```

The browser then opens **http://127.0.0.1:4173** by itself. Closing the console window stops it.

> **Flags**: `--lang zh|en`, `--port N`, `--host H`, `--no-open`, `--help`.
> If the port is taken, the launcher first checks whether the occupant *is* this program: if so it
> just opens the browser, otherwise it moves on to the next free port.

### Auto-detected locations

| What | Where |
|---|---|
| Mod folder | `%USERPROFILE%\Documents\Paradox Interactive\Europa Universalis IV\mod` |
| Game folder | `steamapps\common\Europa Universalis IV` in any Steam library (scans `libraryfolders.vdf`) |
| Offline Chinese wiki | any folder on any drive whose name contains "wiki" and that has a `wiki\` subfolder |

All of it can be set by hand or switched off in **⚙ Settings** in the top-right corner — see
[Settings](#-settings).

> Mods are **only ever read from the Paradox mod folder inside your Documents** (the real path is
> resolved through the launcher's `.mod` descriptor file, so Workshop mods are located correctly in
> `steamapps\workshop\content\236850\...` too). No scratch/draft folder is ever scanned.

---

## Features

- **Mod list** — finds every installed mod (local + Workshop) and shows version, tags, dependencies and size.
- **Change overview** — sorts the mod's thousands of files into 35 categories
  (provinces / decisions / events / mission trees / ideas / government / religion / map / interface /
  localisation …), each with a file count and total size.
- **File tree browsing** — a directory tree filtered by category, with file sizes.
- **Content rendering**, chosen automatically by file type:
  - **Localisation `.yml`** — decoded to readable Chinese, with a key/value table and live filtering.
  - **Clausewitz script `.txt`** — parsed into a collapsible **structural tree** (`potential` /
    `allow` / `effect` / `ai_will_do` …), with one click to see the raw text.
  - **`.csv`** — tabulated (e.g. `map/definition.csv`, with GBK province names detected).
  - **`.gui` / `.gfx`** — parsed as script too.
  - **Images** — formats the browser can show are previewed in place; `.dds` textures (nearly all
    EU4 art) are **decoded to PNG on the fly by the built-in decoder**, so event pictures and icons
    are really drawn.
  - Other binaries (audio, models) — labelled as resource files, not parsed.
- **Full-text search** — file names, localisation keys and localisation text at once (Chinese searchable).
- **🎮 In-game format preview** — the section below. **35 content types** in 6 groups, pairing script
  with localisation and rendering the panel the game would show (event window, mission list,
  government reform panel, religion page, unit stat table …).
- **Nine interface languages** — the whole interface switches between **中文 / English / Français /
  Deutsch / Español / Português / Русский / 日本語 / 한국어** at any time, see below.
- **👑 Historical rulers / 🎓 Historical advisors / 🗡 Historical leaders / 💥 Historical battles** —
  the people, the advisors and the battles in `history/countries/*.txt`, `history/advisors/*.txt` and
  `history/wars/*.txt`, drawn with the numbers the game reads: monarch power, dynasty, life dates, the
  four leader pips, an advisor's type, skill and province, and both sides of a battle with their
  commanders, their troops, their losses and **who won**, see below.
- **Switchable wiki links** — the local offline Chinese wiki and the English online wiki are enabled,
  disabled and located independently; see [Settings](#-settings).
- **Shareable URLs** — the view is written into the URL hash, so a refresh or a shared link returns
  to the same file (deep links like `#mod/<id>/game/advisors/card/yangmingism_daru` open the entry
  directly).

---

## 🌐 UI language: nine of them

The top-right corner holds a picker that lists every language **in its own script**
(`中文 / English / Français / Deutsch / Español / Português / Русский / 日本語 / 한국어`) — the one
class of string that is never translated, because a reader looks for `Русский`, not for `Russian`.
The same list is in **⚙ Settings → UI language**. The choice is written to both browser `localStorage`
and the server's `config.json`, so:

- it survives a page refresh;
- the console launcher speaks the same language next time;
- every API request carries `?lang=`, so even a failed config write cannot fall the UI back to Chinese.

Switching redraws the current view **immediately** (no reload) without losing your place.

The translations are **side tables** (`src/data/locales/<lang>.json` plus the generated
`web/lang/<lang>.js`) that cover **interface text only** — buttons, field names, hints, error
messages — and never game terms.

The game itself ships **four** official localisations: English, French, German and Spanish
(`Europa Universalis IV\localisation\*_l_<lang>.yml` — 143 / 145 / 145 / 144 files on the machine
measured here). Português / Русский / 日本語 / 한국어 are **this viewer's own interface languages**:
the game has no official terminology for them, so in those languages a game term is shown exactly as
English shows it — as the raw script identifier (see the next section). The fallback chain is
"requested language → English → the Chinese source", so a raw key like `some.key.name` can never
appear. Measured this round: each of the seven languages covers **744 backend + 398 frontend** strings,
100%, with `tools/build-langs.js check` reporting no problems. To add a language or change a
translation, see **[docs/TRANSLATING.en.md](docs/TRANSLATING.en.md)**.

### How terms are shown outside Chinese

The Chinese term tables are assembled from two halves, **both on your own machine — neither is in
this repository**:

| Source | What | Measured here |
|---|---|---|
| **The offline wiki you mounted** | parsed at run time from `条件.html` / `命令.html` / `修正列表.html` (`src/wikigloss.js`) | triggers 689 · effects 394 · modifiers 604 |
| `src/data/*-curated.js` | hand-written gap filler for the common entries the wiki does not cover | modifiers 267 · effects 260 · triggers 18 |

Merged, that is roughly triggers 703 / effects 502 / modifiers 692, and it is **Chinese only — there
is no English twin**. So English mode does **not** machine-translate; it prints the **raw identifier
from the EU4 script**:

| Script | Chinese mode | Outside Chinese |
|---|---|---|
| `land_morale = 0.15` | `+15% 陆军士气修正` | `land_morale = +15%` |
| `manpower_recovery_speed = 0.15` | `+15% 后备人力恢复速度` | `manpower_recovery_speed = +15%` |
| `add_country_modifier = { name = X }` | `获得国家修正：X 的中文名` | `add_country_modifier = X` |
| `has_idea_group = humanist_ideas` | `有理念组 人文理念` | `has_idea_group = humanist_ideas` |

This is not laziness: `land_morale` *is* the official name in the English EU4 wiki and in the game's
own script, and it is directly searchable. The interface shell (buttons, titles, field names, scope
nouns, error messages) is fully translated in all nine languages.

---

## ⚙ Settings

**⚙ Settings** in the top-right corner opens the panel; press Save and it takes effect at once (no restart):

| Group | Options |
|---|---|
| **UI language** | 中文 / English / Français / Deutsch / Español / Português / Русский / 日本語 / 한국어 |
| **Local Chinese wiki** | master switch; offline wiki folder (type it / **Browse…** / **Auto-detect** / **Validate**) |
| **English online wiki** | master switch; online wiki base URL (default `https://eu4.paradoxwikis.com/`) |
| **Paths** | mod folder, game install folder (empty = auto-detect; changing them rescans the mods) |

- **Browse…** opens a server-side folder picker: it lists every drive and subfolder, tags folders
  containing `wiki\` with a `wiki` badge and folders containing `mod\` with a `mod` badge; double-click
  to descend, single-click to select.
- **Auto-detect** scans the drives and lists every path that looks like a wiki dump, a mod folder or
  a game folder.
- **Validate** checks that a folder really contains a `wiki\` subfolder and reports the page count.
- The two wiki switches are **independent**: English online only, local Chinese only, or both off.
  With both off, category pages say why and offer an "Open settings" button instead of looking broken.

Settings live in `config.json` in the project root (already in `.gitignore`). To change the defaults,
copy `config.example.json` to `config.json` and edit it.

### Related wiki pages

Every category lists two kinds of links:

- **Local Chinese wiki** — from the offline dump you configured; opens in an embedded iframe, and its
  internal links keep working;
- **English wiki** — deep links into `eu4.paradoxwikis.com`, opened in a new tab.

The English page titles are taken from the wiki's own
[Modding navigation template](https://eu4.paradoxwikis.com/Modding): **all 57 links were tested and
return HTTP 200**, so none of them 404.

---

## 🎮 In-game format preview

The game's interface and its script files are two different worlds: the player sees an "event
window", a "mission panel", a "government reform list", while the mod author writes
`option = { name = ... add_stability = 1 }`. This layer joins the two, **35 content types in the
sidebar's 6 groups** (content / country / religion & economy / military / world / system). The groups
are clickable and only one is expanded at a time, so thirty-odd tabs never turn into a wall. Below is
what each type renders, by theme:

**Events & decisions**

| Type | Script source | What it renders |
|---|---|---|
| **Events** | `events/` | The event window: picture (a real decoded `.dds`) + title + body + option buttons (each option's effects listed right under it) |
| **Decisions** | `decisions/` | Decision card: title + description + potential / allow / effect |
| **Mission trees** | `missions/` (per tree) | The in-game grid: one column per `slot`, one row per `position`, 104×152 cells, arrows placed at the GUI's own coordinates with the game's `gfx_arrow_*` sprites; the tree's mission list sits underneath |
| **Missions** | `missions/` (per mission) | One mission's requirements and rewards, **plus the whole tree it belongs to**, with the current mission highlighted |
| **Idea groups** | `common/ideas/` | Idea group panel: traditions / ambition + the 7 ideas (name, description, modifiers) |
| **National ideas** | `common/ideas/` | Same panel, split out automatically by TAG prefix and `trigger` |
| **Advisors** | `common/advisortypes/` | Advisor entry: adm/dip/mil colour frame + effect + skill-scaled modifier |
| **Policies** | `common/policies/` | Policy card: monarch power type + effect + unlock requirements |

**Country & government**

| Type | Script source | What it renders |
|---|---|---|
| **Countries & government** | `history/countries/`, `common/countries/` | Country dossier: starting ruler/heir, religion and culture, technology, a timeline of historical events. The entries in `history/countries/*.txt` are **assignments, not commands**, so they get a history renderer of their own: `政体 Monarchy`, `科技组 Chinese`, `首都 北平`, `宗教流派 Hanafi`, `历史宿敌 大顺`, a person block opens as `君主：努尔哈赤` → name/dynasty/adm/dip/mil, a leader block as fire/shock/manoeuvre/siege, and a real command such as `add_army_tradition` still uses the game tooltip |
| **👑 Historical rulers** | `history/countries/*.txt` | A `monarch` / `heir` / `queen` / `monarch_consort` entry: name and dynasty, life dates, the day the game applies it, **administrative/diplomatic/military pips**, religion and culture, claim strength, regency and female flags, ruler traits; when the same entry also carries a `leader` block, **the ruler's own four pips as a commander are drawn in place** (it is a separate row in *Historical leaders* and the chip jumps to it), and the rest of that dated block follows underneath |
| **🎓 Historical advisors** | `history/advisors/*.txt` | An advisor entry: name, **type of advice** (the `type` key is resolved through localisation — theologian, navigator …), **skill 1–3 (drawn as pips)**, the province they sit in (name + id), the advisor id, the appointed and death dates, the discount and the female flag. Note that this is a different tab from *Advisors* (`common/advisortypes/`, which defines what an advisor is) |
| **Governments & reforms** | `common/governments/`, `common/government_reforms/`, `government_mechanics/`, `subject_types/`, `factions/` … | Government/reform panel: name + description + attribute table (royal marriage, parliament …) + modifiers + unlock requirements |
| **Ruler traits** | `common/ruler_personalities/`, `ancestor_personalities/` | Trait card: name + the modifiers it grants + its own `allow` requirements, **plus a per-slot breakdown — as ruler / heir / consort — of each slot's requirements and spawn weights** (the `chance` inside each `*_allow` block). Ancestor traits share the same shape and are read here too |
| **Parliament & decrees** | `common/parliament_issues/`, `decrees/`, `state_edicts/`, `trading_policies/` | Parliament issues / decrees: requirements and effects |
| **Estates** | `common/estates/`, `estate_privileges/`, `estate_agendas/` | Estate panel: loyalty/influence modifiers, privileges, agendas |
| **Rebels** | `common/rebel_types/`, `revolt_triggers/` | Rebel type: name, composition (inf/cav/art), morale, uprising chance and conditions |
| **Disasters** | `common/disasters/` | Disaster panel: progress modifiers, `can_start` / `can_stop` / `can_end`, start and end effects, monthly events |
| **Ages** | `common/ages/` | Age panel: start year, objectives and abilities |
| **Great projects** | `common/great_projects/` | Project panel: cost, build time, and the province/area/country modifiers of every tier |

**Religion & culture**

| Type | Script source | What it renders |
|---|---|---|
| **Religion** | `common/religions/`, `church_aspects/`, `personal_deities/`, `fetishist_cults/`, `holy_orders/`, `incidents/` | Religion group → its religions → aspects / deities / holy orders / incidents, including heresy and centre-of-reformation settings |
| **Cultures** | `common/cultures/` | Culture group → its cultures: primary TAG, graphical culture, male/female/dynasty name lists |

**Economy & trade**

| Type | Script source | What it renders |
|---|---|---|
| **Buildings** | `common/buildings/` | Building panel: cost, build time, province modifiers, and the effects fired on completion or demolition |
| **Trade** | `common/tradegoods/`, `tradenodes/`, `trade_companies/`, `prices/` | Trade goods / nodes / companies / prices: modifiers, spawn chance and conditions, contained provinces |

**Military**

| Type | Script source | What it renders |
|---|---|---|
| **Units & military** | `common/units/`, `mercenary_companies/`, `naval_doctrines/`, `flagship_modifications/` | The six-stat unit table, mercenary companies, naval doctrines, flagship modifications |
| **🗡 Historical leaders** | `history/countries/*.txt` | A leader entry: its `type` (general / admiral / explorer / conquistador), **fire/shock/maneuver/siege pips**, life dates and traits. Both places a leader can live are indexed — a free-standing `leader` block in a dated entry, and the one nested inside a `monarch`/`heir` block (which cross-links with that ruler's card) |
| **💥 Historical battles** | `history/wars/*.txt` | A battle card: the battlefield province (name and id), the war it belongs to, **who won** (the game's own sentence — "N soldiers of A attacked M soldiers of B", ships for a naval battle — over two panels tinted by won/lost), and **one small table per side** (country, commander, infantry/cavalry/artillery, total, losses as a percentage of that side's strength) |
| **Leader traits** | `common/leader_personalities/` | Leader personality card: the modifiers it gives the stack it leads (`discipline`, `land_morale` …) and the `allow` conditions that decide who can get it (`is_admiral` separates generals from admirals) |
| **War & peace** | `common/cb_types/`, `wargoal_types/`, `peace_treaties/` | Casus belli: usage requirements, war goals and peace option factors |

**Technology & ideas**

| Type | Script source | What it renders |
|---|---|---|
| **Technology & institutions** | `common/technologies/`, `institutions/` | Technology level (adm/dip/mil ± levels) modifiers, and an institution's bonuses and spread conditions |

**Scripting** (no in-game panel of its own — rendered as the tooltip lines the engine generates)

| Type | Script source | What it renders |
|---|---|---|
| **Modifiers** | `common/static_modifiers/`, `event_modifiers/`, `triggered_modifiers/`, `opinion_modifiers/` | The modifier's own list of effects + the conditions under which it appears |
| **Scripted effects & triggers** | `common/scripted_effects/`, `scripted_triggers/`, `scripted_functions/` | Reusable script: the full condition/effect tooltip lines |
| **On actions** | `common/on_actions/` | Game hooks: when they fire + the effects and events they run |

**World**

| Type | Script source | What it renders |
|---|---|---|
| **Bookmarks** | `common/bookmarks/` | Bookmarks: start date, selectable countries and scenarios |
| **Map** | `map/` | Definitions and containment for areas / regions / superregions / continents / terrain / climate |
| **Interface & GUI** | `interface/*.gui` | The control tree of a GUI window (widget type, name, position/size/sprite) and the localisation text its buttons point at |

> Things not listed above (province history, graphics and models, localisation, music and sound, the
> mod definition …) are deliberately outside this layer: they are either binary resources or things
> the text/image viewer already presents completely, and forcing them into "in-game format" would
> only distort them. Browse them by category in the file browser instead.

### Mission trees: laid out the way the game lays them out

The mission panel is what mod authors change most and what is hardest to read at a glance, so it is
implemented separately (`src/content/missions.js`). **Every number comes from the game's own files —
nothing was eyeballed from a screenshot**:

| Element | Where it comes from |
|---|---|
| Columns | `slot = N` on each mission series block. The number of columns comes from `max_slots_horizontal` in the `countrymissionsview.gui` that is actually in effect, hard-capped at 11 |
| Rows | `position = N` on the mission block. Plenty of mods omit it — vanilla `Aragonese_Missions.txt` has none at all — in which case the order inside the series is used |
| Links | `required_missions`. Same column uses the vertical arrow sprite; a cross-column link turns above the target row using the left in/out sprites |
| 104×152 cells, 103×123 mission frame, icon (22,20), title (8,84), badges (0,7)/(70,7) | all read from the `slotsize` and `mission_entry` definitions in `countrymissionsview.gui` |
| Arrow sprites | the game's own `gfx_arrow_*` (`verticall_tile` / `end` / `left_out` / `right_in` / `horizontal_skip_slot` …), resolved through the `.gfx` sprite index **out of your own installation**, so the project distributes no art of its own |

**The GUI is read mod-first**, because a mod may override it — the test mod in this workspace does
(it widens the mission list box from 518px to 1090px), so the column count is neither a hard-coded 5
nor 11.

Three situations make a mission tree deviate from "one straight line downwards", and the project
**labels them honestly instead of drawing something prettier**:

- **slot/position collisions**: two or more missions in the same cell (this mod has 79, including
  `SC_haiwai_expansion_1/2/3`, all three written as `position = 12`). The grid fans them out and
  marks them in red.
- **Prerequisites pointing downwards**: a `required_missions` entry pointing at a larger `position`.
  The game only ships a downward arrow sprite, so the same sprite is drawn flipped, and the count is
  reported.
- **Prerequisites pointing at the same cell / outside the tree**: the former has no direction to
  draw; the latter is usually two mutually exclusive mission trees in one mod referencing each other
  (as in `Byzantine_Missions.txt`), of which only one is ever active in game.

`src/content/missions.js` also recognises **empty shell series** (a block with only `slot` and
`potential` and no missions at all — this mod has one); they no longer become a panel that opens
blank.

### What it actually "translates"

1. **Modifiers → the in-game bonus/malus lines**
   `discipline = 0.05` → `+5% 训练度` (green); `core_creation = -0.25` → `−25% 建造核心花费` (green,
   because for this kind of modifier *a negative number is the good outcome* — there is a reverse
   table plus a name-pattern fallback in the code).
   Whether a value is additive or multiplicative (i.e. whether it prints as a percentage) comes from
   the `效果类型` column of the wiki's modifier table.
   A modifier with no table entry is printed **exactly as the script wrote it** — guessing the
   default would print a false number (`prestige = 10` as `+1000%`), which is far worse than losing
   a label.

2. **Effects → the in-game tooltip lines**
   Event triggers (`country_event` → the event's **real title**, clickable), timed modifiers
   (`add_country_modifier` → the modifier's Chinese name + duration, **with the modifier's own
   effects listed too**), estate privileges, flags, variables, `if/else`, `random_list`, `every_*`
   scope iteration (→ "对每个国家") … Everything else is labelled from the Chinese term table (read at
   run time from the offline wiki you mounted); anything the table lacks is **shown verbatim and
   marked as not covered**, never invented.

3. **Conditions → a readable requirement list**
   `AND/OR/NOT` → "且（全部满足）／或（满足其一）／非（不满足）",
   `has_idea_group = X` → "有理念组 *X 的中文名*",
   `owns_core_province = 5241` → "拥有核心省份 滁州".

4. **Localisation markup → real typesetting**
   `§Y…§!` colour codes, `£icon_name£` icons (**looked up as sprites in `interface/*.gfx` and drawn
   from decoded textures**), `\n` line breaks, `$KEY$` references (resolved recursively and traced
   back to a file and line in the correspondence table), `[Root.GetName]` dynamic text (rendered as a
   placeholder with an explanation), and engine keywords such as `$COUNTRY$` marked as such.

5. **A script ↔ localisation correspondence table**
   Under every card: script field → localisation key → the text the game shows → **source file:line**,
   distinguishing mod localisation from vanilla, and clicking a file name jumps to that `.yml`.
   The table also includes **names resolved while rendering** — units unlocked by a technology level,
   the religions inside a religion group, the `desc` key of an estate influence entry, a GUI window's
   `buttonText` — so for almost all of the 35 types you can see which key a given piece of Chinese
   came from.

6. **AI weights → "×N when …"**
   `ai_will_do` / `chance` / `spawn_chance` blocks are weights, not effects: `factor` renders as
   "基础权重 = N" and each `modifier = { factor = 2 … }` renders as "×2 当满足：" followed by its own
   condition lines — exactly what the multiplication in the in-game tooltip means.

### How the generic card is drawn

Apart from the first six types, which have hand-written panels, the other 17 share one "generic
engine": a descriptor only declares which directory to read, which localisation key holds the name,
and which keys are modifiers/conditions/effects, and the engine classifies every sub-block into
`mod` (bonus/malus lines), `cond` (requirement list), `eff` (effect tooltip lines), `weight`,
`list` (clickable reference chips), `entries` (repeated named entries with values), `blocks` (nested
definitions such as great-project tiers), `fields` (an all-scalar settings table) or `raw` (script the
engine cannot phrase). Adding a content type is therefore usually a dozen lines of descriptor, with
no changes on either the front or back end.

Classification uses **node type + key-name patterns only** — no semantic guessing. Anything that
cannot be classified goes through `raw`, laid out as the original script with a note that the game
never displays raw script. Showing the source beats pretending to understand it.

### Why an idea group name is sometimes English

A mod only overrides the keys it has translated. Keys it does not override fall back to the
**vanilla localisation** (which is English), and the correspondence table shows a `原版` (vanilla)
badge and the real source file — so you can tell at a glance whether a string was translated by the
mod or actually comes from the base game.

### `.dds` textures

Nearly all EU4 art is `.dds`, which browsers cannot display. This project **ships a zero-dependency
DDS decoder** (`src/codec/dds.js`, supporting DXT1/BC2/DXT3/DXT5 and uncompressed BGRA, with a
hand-written PNG encoder), so event pictures, decision icons and `£icon£` icons are **really drawn**,
not placeholders. Tests: `tools/test-dds.js` (267 assertions, including real-texture round trips).

---

## Chinese decoding: the core of this project

EU4's localisation values **only accept bytes in the Latin-1 range**, so Chinese cannot be stored as
plain UTF-8. Text in a mod actually comes in **several shapes**, and they must be told apart:

| Shape | Where it appears | How it is handled |
|---|---|---|
| Plain UTF-8 | vanilla English/French/German/Spanish localisation | read directly |
| **Escaped + CP1252 double layer** | some mods' `*.yml` | read as UTF-8, then each code unit is mapped back through the CP1252 table to raw bytes, then decoded by the escape rules |
| **Escaped + raw bytes** | `common/`, `history/`, `events/` scripts | the file is often **invalid UTF-8**; decoded from raw bytes |
| CP1252 | many `history/` province names (e.g. `Logroño`) | read byte by byte |
| GBK | `map/definition.csv`, changelogs | decoded as gb18030 |

The escape rules (identical to matanki-saito's [EU4dll](https://github.com/matanki-saito/EU4dll)
double-byte patch):

```
each character = [lead] [low] [high]
  lead  ∈ 0x10..0x13   (= 0x10 + 2*(high is a reserved byte) + 1*(low is a reserved byte))
  value = low | (high << 8)
  lead & 1  ->  value -= 0x0E
  lead & 2  ->  value += 0x900
```

Because these shapes **overlap** (one byte may be a raw byte, or part of some UTF-8 sequence), the
decoder does not guess at rules: it **decodes every possible reading and scores them for "text
plausibility"**, taking the best. See `decodeBest()`. Two lessons made that necessary:

- `10 CC 91` read as raw bytes is **里** (U+91CC), but treating `CC 91` as UTF-8 yields `∑` (U+2211).
- The `ñ` (0xF1) in `Logroño`, taken as the start of a 4-byte UTF-8 sequence, decodes to the private-use
  character U+F88D, **swallows the following quote**, and destroys the rest of the file.

The parser also respects the fact that a **Clausewitz string never spans a line**: a quote that is not
closed within its line is treated as a literal, so even a mis-decoded byte can never eat everything
that follows.

**Skipping the CP1252 layer produces text that looks like Chinese but is wrong** (for instance
`江户城` turning into `汭户城`), which is why that step is mandatory.

That layer **has to be lossless**. An earlier revision sanitised the string on its way back to bytes
("invalid UTF-8 → U+FFFD"), which ate *legitimate CP1252 bytes* such as 0xF9: `& 0xFF` then turned it
into 0xFD, and `曹` (U+66F9) was displayed as `曽` (U+66FD). `cp1252Normalize()` now decodes UTF-8
sequences into code units and keeps every other byte exactly as it is, behind an explicit
`utf8Walk()` decision (C1 code points accepted, overlong and malformed sequences rejected);
57 assertions in `tools/test-codec.js` cover it.

### The `¿` in a mod is real

About **7% of the strings** in `history/countries/*.txt` begin with a bare `0xBF` byte (measured here:
93% of the Chinese script strings carry it, and localisation files carry none at all). This is not a
decoder bug:

- the double-byte patch's decoder, `convertEscapedTextToWideText()`, sends **every non-escape byte**
  through the CP1252 table, and 0xBF is `¿` (U+00BF);
- its encoder, `convertWideTextToEscapedText()`, only writes an escape sequence when `high != 0`, so a
  single-byte character like `U+00BF` can **only** be written as a raw byte — it is never a length
  marker or a separator.

In other words **the game itself shows those names as `¿曹勐得`** (measured here: 110 of 930 ruler
fields carry it, almost all of them `dynasty`). The viewer therefore **shows it as written** and does
not quietly clean it up — cleaning it up would be falsifying the mod. `tools/test-history.js` prints
that count on every run, so it cannot drift unnoticed.

Implementation: `src/codec/localisation.js` (`decodeBest()` is the automatic entry point).

Verified against real files (character-for-character):

```
mount_fuji            浅间神社
sankin_kotai_palaces  江户城
grand_canal_1         江南运河——杭州段
CE_torre_di_Pisa      比萨斜塔
成吉思汗金顶大帐 / 长城——宁夏镇 / 大报恩寺  …
```

---

## Directory structure

```
eu4-mod-viewer/
├─ 启动.bat                 one-click start (Chinese file name)
├─ start.bat                one-click start (English file name, identical content)
│                           ↑ both are "pure ASCII + CRLF"; all localised text comes from Node
├─ config.example.json      default settings template (copy to config.json to edit by hand)
├─ CONTRIBUTING.md          the three hard rules: no game assets / no wiki content / no dependencies
├─ README.md                Chinese README
├─ README.en.md             this file (English)
├─ src/
│  ├─ server.js             HTTP API + static files + offline wiki mount + texture/DDS decoding
│  ├─ config.js             ★ config.json read/write, default merging, folder auto-detection
│  ├─ i18n.js               ★ backend language layer (L/pick/msg) deciding which of the nine languages is shown
│  ├─ mods.js               mod discovery and scanning (.mod descriptor parsing, walking, category stats)
│  ├─ fileview.js           single-file reading and content assembly
│  ├─ taxonomy.js           35 change categories and their path rules (bilingual labels + descriptions)
│  ├─ wiki.js               ★ offline Chinese wiki parsing + English wiki deep links (configurable/switchable)
│  ├─ gameloc.js            ★ localisation index (mod replace → mod → vanilla, with file and line per key)
│  ├─ gamedata.js           ★ content-type assembly (type order, merged metadata, index cache, card dispatch)
│  ├─ content/              ★ one descriptor per content type
│  │  ├─ legacy.js            hand-written renderers for the first six types (events/decisions/ideas/advisors/policies)
│  │  ├─ registry.js          descriptors for the other 28 (generic engine, plus mission trees / missions /
│  │  │                       countries / bookmarks / map / interface / the four history types)
│  │  ├─ missions.js          ★ mission trees: reads slot/position/required_missions, lays out by GUI geometry and arrow sprites
│  │  ├─ history.js           ★ rulers / advisors / leaders / battles: an item's id comes from its *position*, and a card walks the same chain back
│  │  └─ common.js            generic engine: index enumeration, field classification, card assembly, sprite resolution
│  ├─ gametext.js           ★ §colour codes / £icon£ / $KEY$ / [dynamic] markup parsing
│  ├─ gameterms.js          ★ modifiers / conditions / effects → in-game text (term-table driven, nine languages)
│  ├─ wikigloss.js          ★ parses the 条件/命令/修正列表 pages of your local offline wiki at run time (never shipped)
│  ├─ data/                 the Chinese term tables (only the **hand-written half** is in the repo) + the translation side tables
│  │  ├─ modifiers-curated.js hand-written modifier names + how they display (percentage / flat / boolean)
│  │  ├─ effects-curated.js   hand-written effect names (the wiki's effects page has no name column)
│  │  └─ locales/             ★ translation layer: _source.* (the extracted strings) + <lang>.json (the seven side tables)
│  └─ codec/
│     ├─ localisation.js    ★ EU4 localisation / private Chinese encoding codec (the CP1252 layer is lossless)
│     ├─ script.js          ★ Clausewitz script lexer + parser
│     └─ dds.js             ★ zero-dependency DDS → RGBA → PNG decoder
├─ web/
│  ├─ index.html
│  ├─ style.css             wiki look + in-game panel styles + settings panel / folder picker styles
│  ├─ i18n.js               ★ frontend language layer (t / setLang / applyStatic), dictionary keyed by Chinese source
│  ├─ i18n.app.js           ★ English dictionary for web/app.js
│  ├─ i18n.game.js          ★ English dictionary for web/gameview.js
│  ├─ lang/<code>.js        ★ browser dictionaries for the seven languages (generated by tools/build-langs.js, committed)
│  ├─ settings.js           ★ settings panel + server-side folder picker + language picker
│  ├─ app.js                frontend rendering (categories, file tree, script tree, localisation table, wiki panel, search)
│  └─ gameview.js           ★ in-game preview: grouped navigation + bespoke panels + generic card renderer
├─ docs/
│  ├─ loc-key-conventions.md  localisation key conventions and each type's in-game render order (with measured hit rates)
│  ├─ TRANSLATING.en.md       ★ the nine-language translation pipeline
│  ├─ GITHUB.md               illustrated steps for uploading to GitHub (in Chinese; + GITHUB.en.md)
│  ├─ GITHUB-UPDATE.md        ★ pushing updates when there is no git (+ GITHUB-UPDATE.en.md)
│  └─ screenshot-*.png        screenshots (one per content type)
└─ tools/
   ├─ launcher.js            ★ console launcher (bilingual banner, port probe, opens the browser)
   ├─ run-tests.js           ★ test entry point (core / mods / e2e tiers, with SKIP detection)
   ├─ i18n-extract.js        ★ extracts every translatable string from the sources (744 backend / 398 frontend keys)
   ├─ build-langs.js         ★ translation pipeline: split / delta / verify / merge / check / status
   ├─ i18n-audit.js          ★ scans frontend sources and reports Chinese literals not yet wrapped in t()
   ├─ check-doc-links.js     ★ every relative link and screenshot in the docs must exist (no broken README images),
   │                            and the markdown shape is checked too: table cells, paired backticks, closed fences
   ├─ check-css.js           ★ every var(--x) must be declared (the header language box was white on white)
   ├─ gh-upload.js           ★ pushes the working tree as one commit through the GitHub API (no git here)
   ├─ gh-login.js            ★ guided publish: drives a controlled browser for the token, then pushes
   ├─ gh-delete.js           ★ removes paths from the repository (gh-upload can only add or overwrite)
   ├─ browser.js             Chrome DevTools Protocol client shared by the two scripts above
   ├─ test-codec.js           codec + parser tests (57 assertions)
   ├─ test-i18n-backend.js    backend bilingual layer (66 assertions, Chinese strings compared character by character to the old output)
   ├─ test-dds.js             DDS decoder tests (267 assertions, including real-texture round trips)
   ├─ test-scan.js            mod discovery and scanning tests
   ├─ test-all-mods.js        coverage test across every mod and every category
   ├─ test-gamedata.js        content extraction and card rendering for the first six types
   ├─ test-history.js       ★ rulers / advisors / leaders / battles: unique ids, the chain walk back to the block, winners and loss percentages, pip scale, cross-links (51 assertions)
   ├─ test-content-types.js ★ all 35 types: indexed, non-empty card, readable title, no Chinese in the English UI (289 assertions)
   ├─ test-missions.js      ★ mission tree layout: slot/position/link semantics + GUI geometry cross-check (297 assertions)
   ├─ test-wikigloss.js     ★ term tables come only from your wiki and are never invented; degrades with no wiki (59 assertions)
   ├─ test-fidelity.js        parser fidelity check (source keys vs parsed keys)
   ├─ verify-wiki.js          DevTools-protocol driven browser check of the embedded wiki
   ├─ verify-game.js          DevTools-protocol driven browser check of the in-game preview, one screenshot per type (242 assertions)
   └─ verify-i18n.js          DevTools-protocol driven browser check of all nine languages / settings / wiki switches (88 assertions)
```

---

## HTTP API

Except for `/wikifile/*`, every endpoint accepts `?lang=zh|en|fr|de|es|pt|ru|ja|ko` to override the server's language.

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | scan status, mod count, paths, wiki status |
| GET | `/api/mods` | summary of every mod (with category stats) |
| GET | `/api/refresh` | rescan |
| GET | `/api/config` | current settings + auto-detection results + wiki status |
| POST | `/api/config` | save settings (partial update) and apply them at once (rebuild wiki index / rescan if paths changed) |
| GET | `/api/mod/:id` | one mod's details |
| GET | `/api/mod/:id/tree` | directory tree (with category tags) |
| GET | `/api/mod/:id/files` | flat file list (filter with `?category=`) |
| GET | `/api/mod/:id/file?path=` | one file's content (decoded and parsed) |
| GET | `/api/mod/:id/search?q=` | search inside a mod |
| GET | `/api/mod/:id/thumbnail` | mod cover image |
| GET | `/api/mod/:id/tex?path=` | texture; `.dds` is **decoded to PNG on the fly** |
| GET | `/api/mod/:id/icon?name=` | resolve a `£name£` / `GFX_name` sprite and return it as a PNG icon |
| GET | `/api/mod/:id/game/index` | in-game preview: content index, language-ready `typeList` and groups, stats |
| GET | `/api/mod/:id/game/list?type=&q=&file=&offset=&limit=` | the entry list of one type (filterable by file) |
| GET | `/api/mod/:id/game/card?type=&id=` | one entry's "game card" (with its localisation correspondence) |
| GET | `/api/mod/:id/game/search?q=` | search across every content type |
| GET | `/api/wiki/status` | offline wiki status (enabled, folder, page count, failure reason) |
| GET | `/api/wiki/page?name=` | read and sanitise one wiki page |
| GET | `/api/wiki/search?q=` | search wiki page names |
| GET | `/api/wiki/suggest?category=` | category → `{local: Chinese page, online: English wiki link}` |
| GET | `/api/wiki/detect` | auto-detected wiki candidate folders |
| GET | `/api/wiki/validate?dir=` | check whether a folder is a usable wiki dump, and return its page count |
| GET | `/api/fs/list?path=` | the server-side folder picker (localhost requests only; the top level returns the drive list) |
| GET | `/wikifile/*` | css/js/image assets of the offline wiki |

---

## Tests

```bat
node tools\run-tests.js             :: entry point: core tier (no game install needed)
node tools\run-tests.js --tier=mods :: core + tests that need installed EU4 mods
node tools\run-tests.js --all       :: everything, including e2e checks that need a server and Edge
node tools\run-tests.js --list      :: list the test plan only

npm test                            :: same as node tools\run-tests.js
```

Individually:

```bat
node tools\test-codec.js          :: codec + parser (57 assertions)
node tools\test-i18n-backend.js   :: backend bilingual layer (66 assertions, Chinese compared to the old output)
node tools\test-dds.js            :: DDS decoder (267 assertions, real textures pixel-by-pixel)
node tools\test-gamedata.js       :: content extraction and card rendering for the first six types
node tools\test-content-types.js  :: all 35 types: indexed, non-empty card, readable title (289 assertions)
node tools\test-missions.js       :: mission tree layout: slot/position/link semantics + GUI geometry (297 assertions)
node tools\test-history.js        :: rulers / advisors / leaders / battles: unique ids, the chain walk back to the block, winners and loss percentages, pip scale, cross-links (51 assertions)
node tools\test-wikigloss.js      :: term tables parsed from your wiki + no-wiki degradation (59 assertions)
node tools\test-fidelity.js       :: check that the parser loses no content (key-level comparison)
node tools\test-all-mods.js       :: coverage test across all 11 mods and 19,467 files
node tools\verify-wiki.js         :: end-to-end check with Edge + the DevTools protocol
node tools\verify-game.js         :: per-type check of the in-game preview, and writes the screenshots
node tools\verify-i18n.js         :: end-to-end check of all nine languages / settings / wiki switches, and screenshots
node tools\i18n-extract.js        :: extract every translatable string into _source (two key spaces: backend and frontend)
node tools\build-langs.js check   :: coverage / placeholder / edge-whitespace audit for the seven languages
node tools\i18n-audit.js check    :: audit: are all t() keys in the dictionary, is any Chinese literal unwrapped
node tools\check-doc-links.js     :: do all relative links and screenshots exist, and is the markdown shape intact
node tools\check-css.js           :: is every var(--x) declared (self-tests first, proving it catches the undeclared spelling)
node tools\i18n-audit.js extract  :: list every Chinese literal in the frontend and how it is wrapped
```

Measured results (all 11 mods):

| Metric | Result |
|---|---|
| Mods / files | 11 / 19,467 |
| Sampled files | 1,386 |
| Load failures | **0** |
| Script parse failures | **0** |
| Key loss rate | **0.01%** (4 of 29,431 keys missing, all false positives from Chinese prose documents mistaken for config) |
| Encoding distribution | plain-utf8 879, escaped-cp1252 251, escaped-raw 137, gbk 63, cp1252 24, escaped-utf8 2 |
| Test entry point | `node tools/run-tests.js --all` → **16 passed / 0 failed / 0 skipped** |

Measured on the main test mod `1.37 Celestial empire on which the sun never sets` (9,512 files / 493 MB),
through the in-game preview: **35 content types, 25,793 records extracted, 0 files failed to read.**

| Group | Entries per type |
|---|---|
| Events & decisions | events 4,050 · decisions 618 · mission trees 235 · missions 3,875 · idea groups 107 · national ideas 615 · advisors 55 · policies 135 |
| Country & government | countries 625 · **historical rulers 3,643** · **historical advisors 55** · government/reforms 456 · parliament 38 · estates/privileges 275 · rebels 126 · disasters 41 · ages 5 · great projects 203 |
| Religion & culture | religion/aspects/deities 374 · cultures 600 |
| Economy & trade | buildings 54 · goods/nodes/companies 172 |
| Military | units/mercenaries/doctrines 504 · **historical leaders 1,061** · **historical battles 98** · casus belli/war goals 115 |
| Technology & ideas | technology levels 134 |
| Scripting | modifiers 2,746 · scripted effects/triggers 2,748 · on_actions 70 |
| World | bookmarks 15 · map definitions 1,575 · GUI windows 348 |

The four history types break down as: monarchs 2,412 + heirs 964 + consorts 267 = 3,643 rulers;
1,061 leaders (316 of them the "the monarch also commands" blocks nested inside a ruler's entry);
98 battles across 26 `history/wars/*.txt` files; 55 advisors from the mod's single
`history/advisors/ChinaKoreaJapan.txt`. 64 dated blocks are written twice under the same date
in one file, which is why an id can read `TAG@date#2@slot`.

| Other metrics | Result |
|---|---|
| Mod localisation keys | 36,344 (plus 136,579 vanilla keys as fallback) |
| Chinese term tables | modifiers 692 · triggers 703 · effects 502 (read at run time from the local offline wiki + hand-written fill; the repo holds **only the hand-written half**) |
| Index build time | about 6 s (cached in-process; the first run lazily loads the 136,579 vanilla keys) |

Multi-language measurements:

| Metric | Result |
|---|---|
| English dictionary entries | **398** in total (core + `i18n.app.js` + `i18n.game.js`), **0 missing, 0 containing Chinese** |
| Dictionary audit | `node tools/i18n-audit.js check` → 0 missing / 0 unexplained / 0 CJK value |
| Backend pairs | 865 `L()` pairs across `src/**` (799 call sites), 744 distinct English keys |
| Chinese regression | the backend test compares Chinese strings **character by character** with the pre-change output; identical |
| English wiki links | all 57 unique links tested **HTTP 200** |
| UI end-to-end | `verify-i18n.js` **88 / 88** (all nine languages, persistence, `?lang=` injection, settings panel, folder picker, both wiki switches, error recovery, plus contrast and no-clipping checks on the header language picker) |
| Preview end-to-end | `verify-game.js` checks all 35 panels (see the test table) and writes 36 screenshots |

Environment variables can override auto-detection: `EU4_USER_DIR`, `EU4_INSTALL_DIR`, `EU4_WIKI_DIR`,
`EU4_MOD_VIEWER_LANG`, `EU4_MOD_VIEWER_CONFIG`, `PORT`, `HOST`.

---

## Known limitations

- The escape rules are about 99% accurate for a few rare characters (the mod's own font is the
  authority); an occasional character may show as `…`, and a bare `0xBF` byte that really is in the
- Map images (`provinces.bmp`, `heightmap.bmp` …) are counted but not rendered, since they need a
  dedicated palette parser.
- DDS decoding covers DXT1/DXT3/DXT5 and uncompressed BGRA/BGR; DX10, BC5/ATI2 and friends return an
  explicit "not supported" rather than drawing something wrong.
- `.tga` (flags and such) cannot be displayed by a browser directly; a placeholder explains why.
- The in-game preview is a **static reconstruction**: a trigger is a "requirement list", not the
  runtime red/green verdict; dynamic text (`[Root.GetName]`) and engine keywords (`$COUNTRY$`) are
  marked as evaluated at run time — the tool never pretends to know their values.
- A command/modifier with no term-table entry is **shown verbatim and marked as not covered** —
  showing script beats inventing Chinese. Values are **printed exactly as the script wrote them**
  too; a value is never multiplied by 100 on the strength of a default (that would print
  `prestige = 10` as `+1000%`, a false number). The term tables come from the offline wiki you
  mounted, so **with no wiki** these names degrade to script identifiers in large numbers — the
  banner at the top of the view says which source is in use.
  Sub-blocks the generic card cannot classify go through `raw` (indented original script) as a whole;
  the longer the card, the more likely you are to see it. That is deliberate: no guessing.
- **Runtime placeholders** such as `$VAL$` and `$VALUE$` are not substituted as same-named
  localisation keys. In the `EST_VAL_*` estate tooltips `$VAL$` is a number the engine fills in, while
  `VAL` happens to be Valencia's country TAG, so resolving it as localisation would print "Valencia";
  such names are now marked as runtime-evaluated.
- In English mode, terms are shown as the **raw script identifiers** (see
  [UI language](#-ui-language-nine-of-them)); nothing is machine-translated. The Chinese wiki's
  `desc` column has no English twin, so English mode shows a `(Chinese wiki text)` placeholder there.
- The `.bat` launchers are deliberately limited to **pure ASCII + CRLF**: cmd.exe reads batch files
  through an OEM code page, and Chinese text in them gets mangled — which is exactly why older
  double-click launches failed. All Chinese messages come from Node instead. `.gitattributes` forces
  CRLF on checkout, **please do not change it to LF**.
- The analysis is **static** only: the game is never run and no file is ever modified.

---

## Licence

[MIT](LICENSE) © 2025–2026 SAHHakuryuu

Want to publish this on GitHub? See **[docs/GITHUB.en.md](docs/GITHUB.en.md)** (two routes: web upload or
the Git command line, including the `.gitattributes` CRLF caveat). **No git on this machine** and you
want to push with the scripts that ship with the project? See
**[docs/GITHUB-UPDATE.en.md](docs/GITHUB-UPDATE.en.md)**.
Before contributing, please read **[CONTRIBUTING.en.md](CONTRIBUTING.en.md)**; what changed in each
release is in **[CHANGELOG.en.md](CHANGELOG.en.md)**.

**Nothing in this repository belongs to anyone else**, and that is maintained deliberately:

| Content | In the repo? | Why |
|---|---|---|
| Game assets (textures / GUI / localisation) | ❌ | read at run time from your own EU4 installation |
| The offline Chinese wiki's content | ❌ | parsed at run time from the wiki you mounted (`src/wikigloss.js`); that wiki is **CC BY-NC-SA 4.0**, and shipping an extraction would drag the whole project under its non-commercial clause |
| Chinese term tables (the hand-written half) | ✅ | `src/data/*-curated.js` — original work, MIT |
| Third-party code / dependencies | ❌ | `dependencies` is `{}`; Node built-ins only |
| Screenshots | ✅ | `docs/screenshot-*.png`, produced by this project's own verification scripts |

*Europa Universalis IV* and its assets are trademarks and copyright of Paradox Interactive.
EU4 and Europa Universalis are trademarks of Paradox Interactive.
