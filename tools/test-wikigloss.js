'use strict';
/**
 * Runtime term-table test: `src/wikigloss.js` plus its merge into `src/gameterms.js`.
 *
 * Three things are checked, in this order:
 *
 *   1. **The parsers**, against inline wiki-shaped HTML, so the rules are pinned
 *      without needing a wiki on the machine: which tables are read, how a name
 *      and a key are split, how a placeholder row falls back to its 举例 column,
 *      that the removed-entry and navigation tables are ignored, and that a
 *      修正描述 is cut at its gloss colon.
 *   2. **The live wiki**, when one is mounted: the tables parse, every key is one
 *      the page actually states (nothing is invented), and known keys resolve to
 *      the expected name and display mode.
 *   3. **The renderer**, in both directions: with the wiki mounted a percentage
 *      modifier prints as a percentage, and — the regression this whole path
 *      exists to prevent — a modifier with *no* table entry prints its value
 *      exactly as the script wrote it instead of having ×100 applied to it.
 *
 *   node tools/test-wikigloss.js
 */

const fs = require('fs');

const wg = require('../src/wikigloss.js');
const wiki = require('../src/wiki.js');
const terms = require('../src/gameterms.js');
const { parseScript } = require('../src/codec/script.js');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got: ${JSON.stringify(actual)}\n  exp: ${JSON.stringify(expected)}`);
  else console.log(`pass ${name}`);
}
function ok(name, cond, detail) {
  check(name + (cond ? '' : ` (${detail || ''})`), Boolean(cond), true);
}

// ---------------------------------------------------------------------------
// 1. Parsers, against inline wiki-shaped HTML
// ---------------------------------------------------------------------------

console.log('--- parsers (inline fixtures) ---');

const TABLE = (head, rows) => '<table class="wikitable">\n<tbody><tr>'
  + head.map((h) => `<th>${h}</th>`).join('')
  + '</tr>\n' + rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('\n')
  + '</tbody></table>';

const TRIGGER_FIXTURE = TABLE(
  ['语句', '参数类型', '描述', '作用域', '举例', '版本'],
  [
    ['<b>国家代码</b>&#8195; tag', 'Tag', '返回真，如果该 <a href="#">国家</a>是指定的国家。', '国家', '<code>tag = HAB</code>', '1.1'],
    ['<b>商品</b> &lt;trade good&gt;', '整数', '返回真，如果该国有至少 X 个省份生产指定商品。', '国家', '<code>gold = 2</code>', '1.1'],
    ['REB', '标识符', '神圣罗马帝国。', '国家', '<code>REB = { }</code>', '1.1'],
  ],
) + TABLE(['运算符', '描述', '举例'], [['AND', '全部为真', 'AND = { }']]);

const EFFECT_FIXTURE = TABLE(
  ['语句', '参数', '例子', '描述', '备注', '版本'],
  [
    ['add_prestige', '&lt;float&gt; 增加或减少威望', '<code>add_prestige = 50</code>', '增加威望。', '上限 100', '1.1'],
    ['&lt;scope&gt;', '&lt;scope&gt; 作用域', '<code>add_claim = FRA</code>', '获得宣称。', '', '1.1'],
  ],
) + TABLE(['指令', '示例', '移除版本'], [['add_province_manpower', '<code>add_province_manpower = 1</code>', '1.12']]);

const MODIFIER_FIXTURE = TABLE(
  ['修正代码', '用法举例', '修正描述', '效果类型', '添加修正的版本'],
  [
    ['discipline', '<code>discipline = 0.1</code>', '训练度', '乘法', '1.1'],
    ['siege_ability', '<code>siege_ability = 0.1</code>', '围城能力：削减防御效率', '乘法', '1.1'],
    ['prestige', '<code>prestige = 0.5</code>', '年度威望', '加法', '1.1'],
    ['ignore_coring_distance', '<code>ignore_coring_distance = yes</code>', '无视距离造核', '恒定', '1.20'],
  ],
) + TABLE(['修正代码', '用法举例', '移除修正的版本'], [['build_cost_opposite', '<code>build_cost_opposite = -0.1</code>', '1.4']])
  + TABLE(['', ''], [['', '只适用于DLC皇帝激活时。']]);

{
  const t = wg.parseTriggers(TRIGGER_FIXTURE);
  check('trigger: key set', Object.keys(t).sort().join(','), 'gold,tag');
  check('trigger: name and key are split', t.tag.zh, '国家代码');
  check('trigger: description keeps browser spacing', t.tag.desc, '返回真，如果该 国家是指定的国家。');
  check('trigger: placeholder row takes the key from 举例', t.gold.zh, null);
  check('trigger: upper-case tag row is not a command key', 'REB' in t, false);

  const e = wg.parseEffects(EFFECT_FIXTURE);
  check('effect: key set', Object.keys(e).sort().join(','), 'add_claim,add_prestige');
  check('effect: no name column, so zh stays null', e.add_prestige.zh, null);
  check('effect: description', e.add_prestige.desc, '增加威望。');
  check('effect: the 备注 caveat is not the description', /上限/.test(e.add_prestige.desc), false);

  const m = wg.parseModifiers(MODIFIER_FIXTURE);
  check('modifier: key set', Object.keys(m).sort().join(','), 'discipline,ignore_coring_distance,prestige,siege_ability');
  check('modifier: 乘法 -> mul', m.discipline.mode, 'mul');
  check('modifier: 加法 -> add', m.prestige.mode, 'add');
  check('modifier: 恒定 -> null', m.ignore_coring_distance.mode, null);
  check('modifier: name is cut at the gloss colon', m.siege_ability.zh, '围城能力');
  check('modifier: removed-entry table is ignored', 'build_cost_opposite' in m, false);
  check('modifier: DLC note table is ignored', Object.keys(m).length, 4);

  check('empty page parses to nothing', Object.keys(wg.parseTriggers('')).length, 0);
  check('entities decode', wg.textOf('a &amp; b &#8195; c'), 'a & b c');
  check('markup does not inject spaces', wg.textOf('行政点数</a>。'), '行政点数。');
  check('a block tag does separate', wg.textOf('第一行<br>第二行'), '第一行 第二行');
}

// ---------------------------------------------------------------------------
// 2. The live wiki
// ---------------------------------------------------------------------------

const WIKI_ON = wiki.isEnabled() && Boolean(wiki.getWikiDir());
console.log(`\n--- live wiki (${WIKI_ON ? wiki.getWikiDir() : 'not mounted'}) ---`);

const PAGES = { triggers: '条件', effects: '命令', modifiers: '修正列表' };

if (!WIKI_ON) {
  console.log('SKIP live-wiki checks: no offline wiki mounted in Settings');
} else {
  const before = wg.cacheKey();
  const g = wg.load();
  const stats = wg.stats();

  check('wiki: no parse error', stats.error, null);
  check('wiki: all three pages were read', Object.keys(stats.pages).sort().join(','), 'effects,modifiers,triggers');
  ok('wiki: triggers table is substantial', stats.counts.triggers > 500, stats.counts.triggers);
  ok('wiki: effects table is substantial', stats.counts.effects > 300, stats.counts.effects);
  ok('wiki: modifiers table is substantial', stats.counts.modifiers > 500, stats.counts.modifiers);

  for (const [slot, page] of Object.entries(PAGES)) {
    const key = slot;
    const resolved = wiki.resolvePage(page);
    const html = fs.readFileSync(resolved.file, 'utf8');
    // Nothing is invented: every key must appear verbatim in the page it came from.
    const fabricated = Object.keys(g[key]).filter((k) => !html.includes(k)).slice(0, 8);
    check(`wiki: no invented keys in ${slot}`, fabricated.join(','), '');
    // Command keys are lower-case snake_case; a stray page token never slips in.
    const odd = Object.keys(g[key]).filter((k) => k !== k.toLowerCase() || !/^[a-z_][a-z0-9_]*$/.test(k)).slice(0, 8);
    check(`wiki: every ${slot} key is a script key`, odd.join(','), '');
    const named = Object.keys(g[key]).filter((k) => g[key][k].zh === k).length;
    check(`wiki: no entry repeats its key as its name (${slot})`, named, 0);
  }

  const modes = new Set();
  for (const rec of Object.values(g.modifiers)) modes.add(String(rec.mode));
  check('wiki: modifier modes are only mul/add/none', [...modes].sort().join(','), 'add,mul,null');

  // Names and display modes, spot-checked against the pages themselves.
  check('wiki: was_tag -> 曾是某国', g.triggers.was_tag && g.triggers.was_tag.zh, '曾是某国');
  check('wiki: tag -> 国家代码', g.triggers.tag && g.triggers.tag.zh, '国家代码');
  check('wiki: has_country_modifier -> 有国家修正', g.triggers.has_country_modifier.zh, '有国家修正');
  check('wiki: discipline prints as a percentage', g.modifiers.discipline.mode, 'mul');
  check('wiki: core_creation prints as a percentage', g.modifiers.core_creation.mode, 'mul');
  check('wiki: prestige is a flat number', g.modifiers.prestige.mode, 'add');
  check('wiki: ignore_coring_distance is a boolean flag', g.modifiers.ignore_coring_distance.mode, null);
  check('wiki: a trigger description is carried over', /返回真/.test(g.triggers.was_tag.desc), true);

  // The cache is keyed by the wiki directory, so a re-load is free but correct.
  const t0 = Date.now();
  wg.load();
  const warm = Date.now() - t0;
  ok('wiki: warm load is served from cache', warm < 50, `${warm} ms`);
  check('wiki: cache key is stable', wg.cacheKey(), before);
}

// ---------------------------------------------------------------------------
// 3. The renderer
// ---------------------------------------------------------------------------

console.log('\n--- renderer ---');

const flatten = (lines) => lines
  .map((l) => (l.spans || []).map((sp) => (sp.t === 'raw' ? `<${sp.s}>` : sp.s)).join('') + (l.note ? ` [${l.note}]` : ''))
  .join(' | ');

{
  const src = 'm = {\n discipline = 0.05\n prestige = 10\n some_unknown_mod = 7\n}';
  const node = parseScript(src).entries[0].value;
  const lines = terms.modifierLines(node, { lang: 'zh' });
  const text = flatten(lines);

  const g = terms.glossaries();
  if (WIKI_ON) {
    ok('render: a percentage modifier prints as a percentage', /\+5%/.test(text), text);
    ok('render: a flat modifier is not multiplied', /\+10\b/.test(text) && !/\+1000/.test(text), text);
  }
  // Without a table entry there is no mode, so the value is printed as written.
  // Defaulting to the ×100 convention here would print a false `+700%`.
  ok('render: an unknown modifier keeps its script value', /some_unknown_mod> = <7>/.test(text), text);
  ok('render: an unknown modifier is never scaled', !/700/.test(text), text);
  ok('render: an unknown modifier says so', /词表中未收录/.test(text), text);
  check('render: one line per modifier', lines.length, 3);
  ok('render: a curated name survives with no wiki', Boolean(g.modifiers.discipline && g.modifiers.discipline.zh), JSON.stringify(g.modifiers.discipline || null));
}

// ---------------------------------------------------------------------------
// 4. The `_modifier` long spelling of a documented modifier
// ---------------------------------------------------------------------------

console.log('\n--- long spelling ---');
{
  // `development_cost_modifier` is what the mod's idea groups, technologies and
  // monuments write; the wiki documents the short `development_cost`. They are
  // the same modifier, so the long form must resolve to the same name, mode and
  // tone rather than printing as "not in glossary".
  const e = terms.describeModifier('development_cost_modifier');
  ok('alias: the long spelling resolves to a name', Boolean(e && e.zh && e.zh.zh), JSON.stringify(e || null));
  check('alias: it is tagged with the documented spelling', e && e.aliasOf, 'development_cost');
  check('alias: it keeps the documented display mode', e && e.mode, 'mul');
  check('alias: an unrelated unknown key still misses', terms.describeModifier('some_unknown_mod'), null);
  check('alias: a key that only looks similar still misses', terms.describeModifier('development_cost_modifier_extra'), null);

  const node = parseScript('m = {\n development_cost_modifier = -0.1\n}').entries[0].value;
  const lines = terms.modifierLines(node, { lang: 'zh' });
  const text = flatten(lines);
  ok('alias: it renders as a percentage', /−10%/.test(text), text);
  ok('alias: it renders with a human name, not the script key', !/<development_cost_modifier>/.test(text), text);
  ok('alias: it does not claim to be missing', !/词表中未收录/.test(text), text);
  const tone = lines[0] && lines[0].spans && lines[0].spans[0] ? lines[0].spans[0].c : null;
  check('alias: a cheaper cost reads as good, judged by the short spelling', tone, 'good');

  // The same name must survive with no wiki mounted: the alias is built from the
  // merged tables, and `development_cost` is in the hand-written table too.
  const full = Object.keys(terms.glossaries().modifiers).length;
  check('alias: aliases are not counted as documented modifiers',
    terms.glossaryStats().modifiers, full);
}

// ---------------------------------------------------------------------------
// 5. No wiki mounted: the hand-written tables stand alone
// ---------------------------------------------------------------------------

console.log('\n--- with the wiki switched off ---');
{
  const restore = () => { wiki.configureLocal(); wg.clear(); terms.clearGlossary(); };
  try {
    wiki.configureLocal({ wiki: { local: { enabled: false } } });
    wg.clear();
    terms.clearGlossary();

    const s = terms.glossaryStats();
    check('off: nothing is read from a wiki', s.fromWiki, false);
    check('off: runtime tables are empty', JSON.stringify(s.runtime), JSON.stringify({ triggers: 0, effects: 0, modifiers: 0 }));
    check('off: the hand-written tables are still counted', s.modifiers, s.curated.modifiers);
    check('off: curated trigger count', s.triggers, s.curated.triggers);
    check('off: curated effect count', s.effects, s.curated.effects);

    const node = parseScript('m = {\n discipline = 0.05\n}').entries[0].value;
    const text = flatten(terms.modifierLines(node, { lang: 'zh' }));
    ok('off: a curated modifier still renders in game format', /\+5%/.test(text) && /训练度/.test(text), text);

    const alias = terms.describeModifier('development_cost_modifier');
    ok('off: the long spelling resolves from the hand-written table alone', Boolean(alias && alias.zh && alias.zh.zh), JSON.stringify(alias || null));
  } finally {
    restore();
  }

  const back = terms.glossaryStats();
  check('wiki state restored after the test', back.fromWiki, WIKI_ON);
}

// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
