'use strict';
/**
 * Language-backend test: `src/gameterms.js` + `src/gametext.js`.
 *
 * The Chinese output is pinned to strings captured *before* the language layer
 * was added, so this test guards the existing rendering. English mode is checked
 * for the two things the layer promises:
 *
 *   • no Chinese chrome labels — a synthetic snippet has no mod content, so no
 *     CJK may appear in the flattened spans at all;
 *   • term names are the raw EU4 script identifiers (`core_creation`,
 *     `add_country_modifier`), never an invented translation.
 *
 * Self-contained and dependency-free: it only parses small inline Clausewitz
 * snippets, so it needs no mod, no install and no server.
 *
 *   node tools/test-i18n-backend.js
 */

const { parseScript, getEntry } = require('../src/codec/script.js');
const terms = require('../src/gameterms.js');
const gametext = require('../src/gametext.js');
const i18n = require('../src/i18n.js');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got: ${JSON.stringify(actual)}\n  exp: ${JSON.stringify(expected)}`);
  else console.log(`pass ${name}`);
}

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

/** The same, but only the rendered label spans (notes are wiki prose). */
function flatSpans(lines) {
  const parts = [];
  for (const l of lines) for (const s of l.spans || []) parts.push(String(s.s));
  return parts.join('|');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODIFIER_SNIPPET = `
modifiers = {
	my_modifier = {
		core_creation = -0.25
		discipline = 0.05
		stability_cost_modifier = 0.1
		has_no_religion = no
		some_unknown_modifier = 3
	}
}
`;

const TRIGGER_SNIPPET = `
trigger = {
	AND = {
		OR = {
			tag = FRA
			tag = ENG
		}
		NOT = { has_idea_group = humanist_ideas }
	}
	every_country = {
		limit = { NOT = { is_ally = yes } }
		has_country_flag = yes
	}
	adm_tech = 10
	NOT = { has_country_modifier = centralisation }
}
`;

const EFFECT_SNIPPET = `
effect = {
	add_country_modifier = {
		name = centralisation
		duration = 3650
	}
	country_event = {
		id = my_event.1
		days = 30
	}
	add_estate_privilege = estate_nobles
}
`;

const modTree = getEntry(getEntry(parseScript(MODIFIER_SNIPPET), 'modifiers'), 'my_modifier');
const trigTree = getEntry(parseScript(TRIGGER_SNIPPET), 'trigger');
const effTree = getEntry(parseScript(EFFECT_SNIPPET), 'effect');

const zh = terms.modifierLines(modTree, { lang: 'zh' }, { indent: 0 });
const zhTrig = terms.conditionLines(trigTree, { lang: 'zh' }, { indent: 0 });
const zhEff = terms.effectLines(effTree, { lang: 'zh' }, { indent: 0 });

const en = terms.modifierLines(modTree, { lang: 'en' }, { indent: 0 });
const enTrig = terms.conditionLines(trigTree, { lang: 'en' }, { indent: 0 });
const enEff = terms.effectLines(effTree, { lang: 'en' }, { indent: 0 });

// ---------------------------------------------------------------------------
// 1. Chinese output is byte-for-byte what it always was
// ---------------------------------------------------------------------------

console.log('=== 1. Chinese mode is unchanged (captured pre-change expectations) ===');

check('zh modifier line 1 (core_creation)',
  JSON.stringify(zh[0]),
  JSON.stringify({ i: 0, k: 'mod', spans: [{ t: 'val', s: '\u221225%', c: 'good' }, { t: 'text', s: ' 建造核心花费' }] }));
check('zh modifier line 2 (discipline)',
  JSON.stringify(zh[1]),
  JSON.stringify({ i: 0, k: 'mod', spans: [{ t: 'val', s: '+5%', c: 'good' }, { t: 'text', s: ' 训练度' }] }));
check('zh modifier line 3 (stability_cost_modifier)',
  JSON.stringify(zh[2]),
  JSON.stringify({ i: 0, k: 'mod', spans: [{ t: 'val', s: '+10%', c: 'bad' }, { t: 'text', s: ' 提升稳定的行政点数花费' }] }));
check('zh modifier line 4 (boolean no)',
  JSON.stringify(zh[3]),
  JSON.stringify({
    i: 0, k: 'mod',
    spans: [{ t: 'text', s: '\u2717 非 ', c: 'bad' }, { t: 'text', s: 'has_no_religion' }],
    note: '词表中未收录的修正，原样显示',
  }));
// `some_unknown_modifier` has no table entry, so nothing states whether its value
// prints as a percentage. It used to default to the ×100 convention and render
// `+300%`; that was a false number, so the value is now printed as the script
// wrote it. This expectation was updated with the fix — do not "restore" it.
check('zh modifier line 5 (unknown, raw value as written)',
  JSON.stringify(zh[4]),
  JSON.stringify({
    i: 0, k: 'mod',
    spans: [{ t: 'raw', s: 'some_unknown_modifier' }, { t: 'text', s: ' = ', c: 'muted' }, { t: 'raw', s: '3' }],
    note: '词表中未收录的修正，原样显示',
  }));

check('zh condition AND head', JSON.stringify(zhTrig[0].spans[0].s), JSON.stringify('且（全部满足）'));
check('zh condition OR head', JSON.stringify(zhTrig[1].spans[0].s), JSON.stringify('或（满足其一）'));
check('zh condition NOT head', JSON.stringify(zhTrig[4].spans[0].s), JSON.stringify('非（不满足）'));
check('zh condition scope head', JSON.stringify(zhTrig[6].spans[0].s), JSON.stringify('对每个国家 满足：'));
check('zh condition tag note', JSON.stringify(zhTrig[2].note), JSON.stringify('返回真，如果该 国家 是指定的国家。'));
check('zh condition has_idea_group label', JSON.stringify(zhTrig[5].spans[1].s), JSON.stringify('有理念组'));
check('zh condition indent', JSON.stringify(zhTrig.map((l) => l.i).join(',')), JSON.stringify('0,1,2,2,1,2,0,1,2,3,1,0,0,1'));

check('zh effect add_country_modifier line',
  JSON.stringify(zhEff[0]),
  JSON.stringify({
    i: 0, k: 'eff',
    spans: [
      { t: 'text', s: '获得国家修正：' },
      { t: 'val', s: 'centralisation', c: 'neutral' },
      { t: 'text', s: '，持续 ' },
      { t: 'val', s: '3650', c: 'neutral' },
      { t: 'text', s: ' 天' },
      { t: 'text', s: '（约 10 年）', c: 'muted' },
    ],
  }));
check('zh effect country_event note', JSON.stringify(zhEff[1].note), JSON.stringify('事件 my_event.1（本地化标题缺失）'));
check('zh effect add_estate_privilege line',
  JSON.stringify(zhEff[2].spans.map((s) => s.s).join('')),
  JSON.stringify('授予阶层特权：estate_nobles'));
check('zh effect line count', String(zhEff.length), '3');

// ---------------------------------------------------------------------------
// 2. English mode carries no CJK chrome
// ---------------------------------------------------------------------------

console.log('\n=== 2. English mode has no CJK label text ===');

for (const [name, lines] of [['modifierLines', en], ['conditionLines', enTrig], ['effectLines', enEff]]) {
  const text = flatSpans(lines);
  check(`en ${name} spans contain no CJK`, String(CJK.test(text)), 'false');
  check(`en ${name} notes contain no CJK`, String(CJK.test(lines.map((l) => l.note || '').join('|'))), 'false');
  if (CJK.test(text)) console.log('  (leak: ' + JSON.stringify(text) + ')');
}

console.log('\n=== 3. English mode prints raw script identifiers as term names ===');

check('en modifier core_creation is raw',
  JSON.stringify(en[0].spans.map((s) => s.s).join('')),
  JSON.stringify('core_creation = \u221225%'));
check('en modifier discipline is raw',
  JSON.stringify(en[1].spans.map((s) => s.s).join('')),
  JSON.stringify('discipline = +5%'));
check('en modifier boolean line',
  JSON.stringify(en[3].spans.map((s) => s.s).join('')),
  JSON.stringify('\u2717 not has_no_religion'));
check('en trigger tag is raw',
  JSON.stringify(enTrig[2].spans.map((s) => s.s).join('')),
  JSON.stringify('\u2022 tag FRA'));
check('en trigger has_idea_group is raw',
  JSON.stringify(enTrig[5].spans.map((s) => s.s).join('')),
  JSON.stringify('\u2717 has_idea_group humanist_ideas'));
check('en trigger has_country_modifier is raw',
  JSON.stringify(enTrig[13].spans.map((s) => s.s).join('')),
  JSON.stringify('\u2717 has_country_modifier centralisation'));
check('en effect add_country_modifier is raw',
  JSON.stringify(enEff[0].spans.map((s) => s.s).join('')),
  JSON.stringify('add country modifier: centralisation, for 3650 days (about 10 years)'));
check('en effect country_event line',
  JSON.stringify(enEff[1].spans.map((s) => s.s).join('')),
  JSON.stringify('trigger country event: my_event.1, delayed 30 days'));
check('en effect add_estate_privilege is raw',
  JSON.stringify(enEff[2].spans.map((s) => s.s).join('')),
  JSON.stringify('grant estate privilege: estate_nobles'));

console.log('\n=== 4. English chrome wording ===');

check('en AND head', JSON.stringify(enTrig[0].spans[0].s), JSON.stringify('and (all met)'));
check('en OR head', JSON.stringify(enTrig[1].spans[0].s), JSON.stringify('or (one of)'));
check('en NOT head', JSON.stringify(enTrig[4].spans[0].s), JSON.stringify('not (not met)'));
check('en scope head', JSON.stringify(enTrig[6].spans[0].s), JSON.stringify('for every country met: '));
check('en scope head indentation matches zh', String(enTrig[6].i), String(zhTrig[6].i));
check('en modifier note for unknown key', JSON.stringify(en[3].note), JSON.stringify('not in glossary; shown as script'));
check('en condition note for unknown key', JSON.stringify(enTrig[9].note), JSON.stringify('not in glossary; shown as script'));
check('en condition note for a Chinese-only wiki description',
  JSON.stringify(enTrig[2].note), JSON.stringify(' (Chinese wiki text)'));
check('zh condition note keeps the wiki description',
  JSON.stringify(zhTrig[2].note), JSON.stringify('返回真，如果该 国家 是指定的国家。'));

// ---------------------------------------------------------------------------
// 5. nameOf: identifier in English, localised name in Chinese
// ---------------------------------------------------------------------------

console.log('\n=== 5. nameOf language switch ===');

const NAMES = { core_creation: '造核花费', add_country_modifier: '获得国家修正', tag: '国家代码' };
const resolver = {
  lookup: (k) => (NAMES[k] ? { value: NAMES[k], file: 'glossary.yml', line: 7, origin: 'wiki' } : null),
};

check('nameOf zh resolves the localised name',
  terms.nameOf('modifier', 'core_creation', { lang: 'zh', resolver }),
  '造核花费');
check('nameOf undefined lang behaves as zh',
  terms.nameOf('modifier', 'core_creation', { resolver }),
  '造核花费');
check('nameOf en returns the raw identifier',
  terms.nameOf('modifier', 'core_creation', { lang: 'en', resolver }),
  'core_creation');
check('nameOf en never touches the resolver for names',
  String(terms.nameOf('modifier', 'core_creation', { lang: 'en', resolver: { lookup: () => { throw new Error('resolver used in en mode'); } } })),
  'core_creation');
check('nameOf en tag', terms.nameOf('tag', 'FRA', { lang: 'en', resolver }), 'FRA');
check('nameOf zh records the lookup for locRefs',
  String((() => { const used = []; terms.nameOf('modifier', 'core_creation', { lang: 'zh', resolver, used }); return used.length; })()),
  '1');
check('nameOf en records nothing for locRefs',
  String((() => { const used = []; terms.nameOf('modifier', 'core_creation', { lang: 'en', resolver, used }); return used.length; })()),
  '0');

// ---------------------------------------------------------------------------
// 6. gametext: engine vars and dynamic hints follow opts.lang
// ---------------------------------------------------------------------------

console.log('\n=== 6. gametext.renderRich language ===');

const RICH = 'Hi $COUNTRY$ $NOPE$ [Root.GetName] [Root.GetFoo] $NUM$';

function hintField(nodes, kind) {
  const n = nodes.find((x) => x.k === kind);
  return n ? n.zh : null;
}

const zhNodes = gametext.renderRich(RICH, { lang: 'zh' });
const enNodes = gametext.renderRich(RICH, { lang: 'en' });
const defNodes = gametext.renderRich(RICH, {});

check('renderRich zh engine var hint', JSON.stringify(hintField(zhNodes, 'e')), JSON.stringify('当前国家名'));
check('renderRich en engine var hint', JSON.stringify(hintField(enNodes, 'e')), JSON.stringify('current country name'));
check('renderRich undefined lang behaves as zh', JSON.stringify(hintField(defNodes, 'e')), JSON.stringify('当前国家名'));
check('renderRich zh dynamic hint', JSON.stringify(hintField(zhNodes, 'd')), JSON.stringify('本国国名'));
check('renderRich en dynamic hint', JSON.stringify(hintField(enNodes, 'd')), JSON.stringify('root country name'));
check('renderRich en fallback dynamic hint', JSON.stringify(enNodes.filter((x) => x.k === 'd')[1].zh), JSON.stringify('evaluated by the game at runtime'));
check('renderRich unknown $KEY$ stays an x node', JSON.stringify(enNodes.filter((x) => x.k === 'x').map((x) => x.key)), JSON.stringify(['NOPE']));
check('renderRich en nodes keep the zh field name', String('zh' in enNodes.find((x) => x.k === 'e')), 'true');
check('renderRich en has no CJK', String(CJK.test(JSON.stringify(enNodes))), 'false');

check('dynamicHint default is Chinese', gametext.dynamicHint('Root.GetName'), '本国国名');
check('dynamicHint en', gametext.dynamicHint('Root.GetName', 'en'), 'root country name');
check('dynamicHint en fallback', gametext.dynamicHint('Nothing.Matches', 'en'), 'evaluated by the game at runtime');

check('undefined lang normalises to zh', i18n.normalizeLang(undefined), 'zh');
check('lang "en" is English', String(i18n.isEn('en')), 'true');
check('an unknown language tag falls back to zh', String(i18n.isEn('de')), 'false');

// Untouched behaviour.
// (`plainText` has always dropped engine keywords like `$COUNTRY$` — an `e`
// node falls through its else-branch with no `s` — so the expectation below is
// the pre-existing shape, not a language artefact.)
check('plainText unchanged',
  JSON.stringify(gametext.plainText(gametext.renderRich('a\u00a7Rb\u00a7!$COUNTRY$[Root.GetName]'))),
  JSON.stringify('abCOUNTRY[Root.GetName]'));
check('displayText unchanged',
  JSON.stringify(gametext.displayText(gametext.renderRich('a\u00a7Rb\u00a7!\u00a3icon_x\u00a3'))),
  JSON.stringify('ab'));
check('richFromString still works', JSON.stringify(gametext.richFromString('x\u00a7Yy\u00a7!')), JSON.stringify([
  { k: 't', s: 'x', c: null }, { k: 't', s: 'y', c: 'gold' },
]));
check('COLOR_CLASSES untouched', gametext.COLOR_CLASSES.R, 'red');

console.log(`\nRESULT: PASS ${pass}/${pass + fail} (${fail} failed)`);
process.exit(fail ? 1 : 0);
