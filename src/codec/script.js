'use strict';
/**
 * Parser for Paradox "Clausewitz" script, the language used by every EU4 data
 * file (decisions, events, missions, ideas, common/*, history/*, ...).
 *
 * The grammar is small and uniform:
 *
 *   document := (entry)*
 *   entry    := key (= | < | > | <= | >=)? value
 *   value    := block | array | string | number | identifier
 *   block    := '{' (entry)* '}'
 *   array    := '{' (value)* '}'
 *
 * A brace body is classified as an object when its first token is a key,
 * otherwise as an array. That is exactly how the engine behaves, so it is also
 * the most faithful thing a viewer can do.
 *
 * The result is a tree of nodes:
 *   { type: 'object', entries: [{key, op, value, line}] }
 *   { type: 'array',  items:   [node], line }
 *   { type: 'string', value } | { type: 'number', value }
 *   { type: 'identifier', value }
 */

const OPERATORS = new Set(['=', '<', '>', '<=', '>=']);

function tokenize(text) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

    // Comments: # to end of line (outside quotes)
    if (c === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }

    if (c === '{' || c === '}') {
      tokens.push({ kind: c, value: c, line });
      i++;
      continue;
    }

    // Operators
    if (c === '=') {
      tokens.push({ kind: 'op', value: '=', line });
      i++;
      continue;
    }
    if (c === '<' || c === '>') {
      if (text[i + 1] === '=') {
        tokens.push({ kind: 'op', value: c + '=', line });
        i += 2;
      } else {
        tokens.push({ kind: 'op', value: c, line });
        i++;
      }
      continue;
    }

    // Quoted string. Clausewitz strings do not span lines: if the closing quote
    // is missing before the newline, treat the quote as literal text. Otherwise a
    // single mis-decoded byte could swallow the rest of the file.
    if (c === '"') {
      const nl = text.indexOf('\n', i + 1);
      const lineEnd = nl === -1 ? n : nl;
      const close = text.indexOf('"', i + 1);
      if (close === -1 || close > lineEnd) {
        tokens.push({ kind: 'bare', value: '"', line });
        i++;
        continue;
      }
      i++;
      let buf = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          buf += text[i + 1];
          i += 2;
          continue;
        }
        buf += text[i];
        i++;
      }
      i++; // closing quote
      tokens.push({ kind: 'string', value: buf, line });
      continue;
    }

    // Bare token: read until whitespace, brace, operator or comment
    let buf = '';
    while (i < n) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' ||
          ch === '{' || ch === '}' || ch === '=' || ch === '#' ||
          ch === '<' || ch === '>' || ch === '"') break;
      buf += ch;
      i++;
    }
    if (buf.length) tokens.push({ kind: 'bare', value: buf, line });
    else i++; // safety: never loop forever
  }

  return tokens;
}

function isNumber(s) {
  return /^-?\d+(\.\d+)?$/.test(s);
}

function makeScalar(tok) {
  if (tok.kind === 'string') return { type: 'string', value: tok.value, line: tok.line };
  if (isNumber(tok.value)) return { type: 'number', value: Number(tok.value), raw: tok.value, line: tok.line };
  return { type: 'identifier', value: tok.value, line: tok.line };
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  next() {
    return this.tokens[this.pos++];
  }

  eof() {
    return this.pos >= this.tokens.length;
  }

  parseDocument() {
    const root = { type: 'object', entries: [] };
    while (!this.eof()) {
      if (this.peek().kind === '}') { this.next(); continue; } // unbalanced close
      const entry = this.parseEntry();
      if (entry) root.entries.push(entry);
    }
    return root;
  }

  parseEntry() {
    const keyTok = this.next();
    if (!keyTok) return null;
    if (keyTok.kind === '{' || keyTok.kind === '}') return null;

    const key = keyTok.value;
    let op = '=';
    if (this.peek() && this.peek().kind === 'op') op = this.next().value;

    const value = this.parseValue();
    return { key, op, value, line: keyTok.line };
  }

  parseValue() {
    const tok = this.peek();
    if (!tok) return { type: 'identifier', value: '', line: 0 };

    if (tok.kind === '{') return this.parseBraces();

    this.next();
    return makeScalar(tok);
  }

  parseBraces() {
    const open = this.next(); // consume '{'
    const body = this.parseBody();

    if (body.classification === 'object') {
      return { type: 'object', entries: body.entries, line: open.line };
    }
    return { type: 'array', items: body.items, line: open.line };
  }

  parseBody() {
    const entries = [];
    const items = [];

    // Peek: is this an object (`key = value`) or an array of scalars/objects?
    // We decide per element, allowing mixed bodies to be treated as arrays,
    // which mirrors the engine's tolerance.
    let sawEntry = false;
    let sawItem = false;

    while (!this.eof()) {
      const tok = this.peek();
      if (tok.kind === '}') { this.next(); break; }

      // Object entry if next token after a bare/string key is an operator.
      const isEntry =
        (tok.kind === 'bare' || tok.kind === 'string') &&
        this.peek(1) &&
        this.peek(1).kind === 'op';

      if (isEntry) {
        const entry = this.parseEntry();
        if (entry) { entries.push(entry); sawEntry = true; }
      } else {
        const value = this.parseValue();
        items.push(value);
        sawItem = true;
      }
    }

    if (sawEntry && !sawItem) return { classification: 'object', entries };
    if (sawItem && !sawEntry) return { classification: 'array', items };
    if (sawEntry && sawItem) {
      // Mixed: keep both, but call it an object so entries stay addressable.
      return { classification: 'object', entries, items };
    }
    return { classification: 'object', entries: [] };
  }
}

/**
 * Parse Clausewitz text into a tree.
 * @param {string} text
 */
function parseScript(text) {
  // Some mod files are UTF-8 with a BOM.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const tokens = tokenize(text);
  const parser = new Parser(tokens);
  return parser.parseDocument();
}

/** Flatten an object node's entries into a plain map (last wins). */
function entriesToMap(node) {
  const map = new Map();
  if (!node || node.type !== 'object') return map;
  for (const e of node.entries) map.set(e.key, e.value);
  return map;
}

/** Look up a single entry value by key. */
function getEntry(node, key) {
  if (!node || node.type !== 'object') return undefined;
  for (const e of node.entries) if (e.key === key) return e.value;
  return undefined;
}

/** Scalar value of a node as a string, or null. */
function scalarValue(node) {
  if (!node) return null;
  if (node.type === 'string' || node.type === 'identifier') return node.value;
  if (node.type === 'number') return node.raw !== undefined ? node.raw : String(node.value);
  return null;
}

module.exports = {
  parseScript,
  tokenize,
  entriesToMap,
  getEntry,
  scalarValue,
  OPERATORS,
};
