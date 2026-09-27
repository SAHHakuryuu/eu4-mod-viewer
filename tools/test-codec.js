'use strict';
const loc = require('../src/codec/localisation.js');
const { parseScript, getEntry, scalarValue } = require('../src/codec/script.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got: ${JSON.stringify(actual)}\n  exp: ${JSON.stringify(expected)}`);
  else console.log(`pass ${name}`);
}

console.log('=== 1. Escaped codec round-trip (CP1252 shape) ===');
for (const s of [
  '天朝日不落MOD漢化',
  '指定加来为主要港口',
  '成立波兰立陶宛联邦',
  'ASCII only 123',
  '混排 mixed 文本',
  '§YColour§! £icon_manpower£',
]) {
  check(`roundtrip-cp1252 ${JSON.stringify(s)}`, loc.decodeBuffer(loc.encodeString(s), { mode: 'escaped-cp1252' }), s);
}

console.log('\n=== 1b. Escaped codec round-trip (raw shape) ===');
for (const s of [
  '天朝日不落MOD漢化',
  '指定加来为主要港口',
  '成立波兰立陶宛联邦',
  '混排 mixed 文本',
]) {
  check(`roundtrip-raw ${JSON.stringify(s)}`, loc.decodeBuffer(loc.encodeStringRaw(s), { mode: 'escaped-raw' }), s);
}

console.log('\n=== 2. Plain UTF-8 pass-through ===');
const van = 'E:/SteamLibrary/steamapps/common/Europa Universalis IV/localisation/decisions_l_english.yml';
const vanParsed = loc.parseLocalisation(loc.decodeLocBuffer(fs.readFileSync(van)));
check('vanilla plain entry count', String(vanParsed.entries.size), '207');
check('vanilla first title', vanParsed.entries.get('designate_the_staple_port_title')?.value, 'Designate Calais as The Staple Port');
check('vanilla language', vanParsed.language, 'l_english');

console.log('\n=== 3. Real escaped mod file decodes to Chinese ===');
const MOD = path.join(os.homedir(), 'Documents/Paradox Interactive/Europa Universalis IV/mod/1.37 Celestial empire on which the sun never sets');

// Ground truth verified independently in a file-format survey.
const groundTruth = [
  ['localisation/replace/CE_great_project_l_english.yml', ['浅间神社', '江户城', '江南运河——杭州段', '比萨斜塔', '成吉思汗金顶大帐']],
  ['localisation/replace/CE_opinion_l_english.yml', ['是藩属国', '是都护府', '叛逆', '是诸侯国', '欺君之罪']],
  ['localisation/replace/CE_mission_modifiers_l_english.yml', ['明君', '忠臣', '阳明书籍']],
];
for (const [rel, expects] of groundTruth) {
  const buf = fs.readFileSync(path.join(MOD, rel));
  const text = loc.decodeBuffer(buf);
  const mode = loc.detectEncoding(buf);
  for (const e of expects) check(`${rel.split('/').pop()} contains ${e} [${mode}]`, String(text.includes(e)), 'true');
}

const ceFile = path.join(MOD, 'localisation/replace/CE_decisions_l_english.yml');
const ceParsed = loc.parseLocalisation(loc.decodeBuffer(fs.readFileSync(ceFile)));
check('CE decisions entry count', String(ceParsed.entries.size), '324');
const ceJoined = [...ceParsed.entries.values()].map((v) => v.value).join(' ');
const han = [...ceJoined].filter((c) => { const p = c.codePointAt(0); return p >= 0x4e00 && p <= 0x9fff; }).length;
const ratio = han / ceJoined.length;
console.log(`  CE han characters: ${han} / ${ceJoined.length} (${(ratio * 100).toFixed(1)}%)`);
check('CE CJK ratio above 75%', String(ratio > 0.75), 'true');

// Script files use the raw (invalid-UTF-8) shape.
const abq = fs.readFileSync(path.join(MOD, 'common/countries/ABQ.txt'));
check('ABQ detected as raw', loc.detectEncoding(abq), 'escaped-raw');
check('ABQ decodes CJK names', String(loc.decodeBuffer(abq).includes('阿不都')), 'true');

console.log('\n=== 3b. Regression: CP1252 high bytes must not be eaten by UTF-8 ===');
// `Logroño` has 0xF1 (ñ). Read as a 4-byte UTF-8 lead it becomes U+F88D, which
// swallowed the closing quote and destroyed the rest of the file.
{
  const raw = Buffer.from(
    'capital = "Logro\xf1o"\nis_city = yes\nbase_tax = 2\n',
    'latin1'
  );
  const text = loc.decodeBuffer(raw);
  check('Logroño survives decode', String(text.includes('Logroño')), 'true');
  const t = parseScript(text);
  const keys = t.entries.map((e) => e.key);
  check('all 3 keys parsed', keys.join(','), 'capital,is_city,base_tax');
  check('capital value intact', JSON.stringify(t.entries[0].value.value), JSON.stringify('Logroño'));
}

console.log('\n=== 3c. Regression: escaped pairs that look like valid UTF-8 ===');
// `10 CC 91` is 里 (U+91CC) as raw bytes, but `CC 91` also reads as U+0311.
{
  const raw = Buffer.from([0x63, 0x61, 0x70, 0x69, 0x74, 0x61, 0x6c, 0x20, 0x3d, 0x20,
    0x22, 0x10, 0x50, 0x4e, 0x10, 0xcc, 0x91, 0x22, 0x0a, 0x68, 0x72, 0x65, 0x20, 0x3d, 0x20, 0x6e, 0x6f, 0x0a]);
  const text = loc.decodeBuffer(raw);
  check('raw escaped pair decodes to 乐里', String(text.includes('乐里')), 'true');
  const t = parseScript(text);
  check('both entries parsed', t.entries.map((e) => e.key).join(','), 'capital,hre');
}

console.log('\n=== 3d. Regression: unterminated quote must not swallow the file ===');
// A mis-decoded byte must never make one string consume every later line.
{
  const broken = 'capital = "Logro\uf88d\nis_city = yes\nbase_tax = 2\ntrade_goods = wine\n';
  const t = parseScript(broken);
  const keys = t.entries.map((e) => e.key);
  check('later keys still parsed', String(keys.includes('base_tax') && keys.includes('trade_goods')), 'true');
  check('at least 3 keys recovered', String(keys.length >= 3), 'true');
  check('newline terminates the string', String(!broken.includes('is_city = yes"')), 'true');
}

console.log('\n=== 4. Clausewitz script parser ===');const sample = `
country_decisions = {
	form_great_britain = {
		potential = {
			NOT = { tag = GBR }
			tag = ENG
		}
		allow = {
			adm_tech = 10
			has_idea_group = exploration_ideas
		}
		effect = {
			change_tag = GBR
			add_country_modifier = {
				name = "centralisation"
				duration = 3650
			}
			add_adm_power = 100
		}
		ai_will_do = { factor = 1 }
	}
}
`;
const tree = parseScript(sample);
check('root has 1 entry', String(tree.entries.length), '1');
const decs = getEntry(tree, 'country_decisions');
check('country_decisions is object', decs?.type, 'object');
check('one decision', String(decs.entries.length), '1');
const fd = getEntry(decs, 'form_great_britain');
check('decision is object', fd?.type, 'object');
const pot = getEntry(fd, 'potential');
check('potential is object', pot?.type, 'object');
check('potential has 2 entries', String(pot.entries.length), '2');
const notNode = getEntry(pot, 'NOT');
check('NOT is object', notNode?.type, 'object');
check('NOT.tag', scalarValue(getEntry(notNode, 'tag')), 'GBR');
const eff = getEntry(fd, 'effect');
const acm = getEntry(eff, 'add_country_modifier');
check('add_country_modifier.name', scalarValue(getEntry(acm, 'name')), 'centralisation');
check('add_adm_power', scalarValue(getEntry(eff, 'add_adm_power')), '100');
const aiw = getEntry(fd, 'ai_will_do');
check('ai_will_do.factor', scalarValue(getEntry(aiw, 'factor')), '1');

console.log('\n=== 5. Parser handles arrays ===');
const arr = parseScript(`ideas = { my_idea = { bonus = { cavalry_power = 0.2 } trigger = { tag = FRA } } }`);
const ideas = getEntry(arr, 'ideas');
check('ideas object', ideas?.type, 'object');
const mi = getEntry(ideas, 'my_idea');
check('my_idea object', mi?.type, 'object');
check('bonus.cavalry_power', scalarValue(getEntry(getEntry(mi, 'bonus'), 'cavalry_power')), '0.2');

const arr2 = parseScript(`list = { a b c }`);
const l = getEntry(arr2, 'list');
check('list is array', l?.type, 'array');
check('list length', String(l.items.length), '3');
check('list[1]', scalarValue(l.items[1]), 'b');

console.log('\n=== 6. Parser handles comments and numbers ===');
const c = parseScript(`# a comment\nfoo = 12.5 # trailing\nbar = yes\n`);
check('foo number', scalarValue(getEntry(c, 'foo')), '12.5');
check('bar identifier', scalarValue(getEntry(c, 'bar')), 'yes');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
