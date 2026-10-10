'use strict';
/**
 * EU4 localisation + private-CJK codec.
 *
 * EU4 only accepts Latin-1-range bytes in localisation *values*, so Chinese (and
 * other non-Latin) text is stored using Paradox's private "escaped" scheme:
 *
 *   [lead] [low] [high]
 *
 *   lead = 0x10 + 2*(high in reserved set) + 1*(low in reserved set)
 *   value = low | (high << 8)
 *       lead & 1  ->  value -= 0x0E
 *       lead & 2  ->  value += 0x900
 *
 * There are three shapes on disk, and they must be told apart:
 *
 *   (1) plain UTF-8            — normal EN/FR/DE/ES localisation. Pass through.
 *   (2) escape + CP1252 layer  — all mod `*.yml`. The file is valid UTF-8, but
 *       bytes >= 0x80 in the payload were first mapped through CP1252 and then
 *       written as UTF-8. Reading it as UTF-8 and mapping every code unit back
 *       through the CP1252 table recovers the real byte stream, which then
 *       decodes at ~100% accuracy. Skipping this pass silently yields *wrong*
 *       but plausible Chinese (江户城 -> 汭户城), so it is mandatory.
 *   (3) escape, raw bytes      — many script files under `common/`, `history/`
 *       and `events/`. Payload bytes are stored raw, so the file is usually
 *       *invalid* UTF-8. Decode the raw bytes directly.
 *
 * The escape arithmetic matches matanki-saito's EU4dll double-byte patch
 * (Plugin64/escape_tool.cpp), independently re-derived and verified here.
 */

// CP1252 C1 range <-> Unicode.
const CP1252_C1_TO_UNICODE = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
const UNICODE_TO_CP1252_C1 = {};
for (const [byte, uni] of Object.entries(CP1252_C1_TO_UNICODE)) {
  UNICODE_TO_CP1252_C1[uni] = Number(byte);
}

/** Bytes the engine reserves for itself; they force an escape bump. */
const RESERVED_BYTES = new Set([
  0xa4, 0xa3, 0xa7, 0x24, 0x5b, 0x00, 0x5c, 0x20, 0x0d, 0x0a,
  0x22, 0x7b, 0x7d, 0x40, 0x80, 0x7e, 0x2f, 0x5f, 0xbd,
  0x3b, 0x5d, 0x3d, 0x23, 0x3f, 0x3a, 0x3c, 0x3e, 0x2a, 0x7c,
]);

const ESC_MIN = 0x10;
const ESC_MAX = 0x13;

function isEscapeByte(b) {
  return b >= ESC_MIN && b <= ESC_MAX;
}

/** Does the buffer contain escape lead bytes? */
function hasEscapes(buf) {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) if (isEscapeByte(buf[i])) return true;
  return false;
}

/** Was this buffer valid UTF-8? (Node replaces bad sequences with U+FFFD.) */
function isValidUtf8(buf) {
  return !buf.toString('utf8').includes('\uFFFD');
}

/**
 * Walk one UTF-8 sequence at `pos`. Returns `[codepoint, bytesConsumed, valid]`.
 *
 * Unlike `readUtf8` below this accepts C1 code points (U+0080–U+009F), because
 * that is exactly what the CP1252 layer encodes: a payload byte of 0x80 was
 * written as the two bytes `C2 80`. A byte that does not start a well-formed
 * sequence is reported invalid so the caller can keep it verbatim — turning it
 * into something else is how a raw 0xF9 silently became 0xFD.
 */
function utf8Walk(buf, i) {
  const b = buf[i];
  if (b === undefined) return [undefined, 1, false];
  if (b < 0x80) return [b, 1, true];

  let len;
  let cp;
  if (b >= 0xf0) { len = 4; cp = b & 0x07; }
  else if (b >= 0xe0) { len = 3; cp = b & 0x0f; }
  else if (b >= 0xc0) { len = 2; cp = b & 0x1f; }
  else return [b, 1, false];              // a continuation byte on its own

  if (i + len > buf.length) return [b, 1, false];
  for (let k = 1; k < len; k++) {
    const c = buf[i + k];
    if ((c & 0xc0) !== 0x80) return [b, 1, false];
    cp = (cp << 6) | (c & 0x3f);
  }
  if (cp < 0x80) return [b, 1, false];    // overlong
  if (cp > 0xffff) return [b, 1, false];  // out of the BMP this scheme uses
  return [cp, len, true];
}

/**
 * Map a valid-UTF-8 buffer back to the raw byte stream the escapes were built
 * from, by running every code unit through the CP1252 C1 table.
 *
 * The pass is *lossless*: a byte that was never UTF-8-encoded (which is the
 * normal shape of a script file — payload bytes are stored raw) is kept as it
 * is. Getting this wrong is not cosmetic: a raw 0xF9 used to be replaced by
 * 0xFD, so 曹 (U+66F9) read as 曽 (U+66FD) — plausible-looking, silently wrong
 * Chinese, and invisible to the scoring heuristic because both are real
 * ideographs.
 */
function cp1252Normalize(buf) {
  const out = [];
  let i = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  while (i < buf.length) {
    const [cp, len, valid] = utf8Walk(buf, i);
    if (!valid) { out.push(buf[i]); i++; continue; }
    const mapped = UNICODE_TO_CP1252_C1[cp];
    out.push(mapped !== undefined ? mapped : cp & 0xff);
    i += len;
  }
  return out;
}

/** Number of bytes in the UTF-8 sequence starting with `b`. */
function utf8SeqLen(b) {
  if (b < 0x80) return 1;
  if (b >= 0xf0) return 4;
  if (b >= 0xe0) return 3;
  if (b >= 0xc0) return 2;
  return 1;
}

/**
 * Read one UTF-8 codepoint at `pos`. Returns [codepoint, bytesConsumed].
 *
 * These files are fundamentally CP1252 with UTF-8 used only for the high bytes of
 * escaped characters, so a byte >= 0x80 is ambiguous: it may be a single CP1252
 * character or the lead of a multi-byte sequence. A sequence that decodes to a
 * control code or a private-use character cannot be a real character, so it is
 * rejected and the byte is taken literally. Without this, the CP1252 `ñ` (0xF1)
 * in `Logroño` is read as the 4-byte lead of U+F88D, which then eats the closing
 * quote and destroys the rest of the file.
 */
function readUtf8(buf, pos) {
  const b = buf[pos];
  if (b === undefined) return [undefined, 1];
  const len = utf8SeqLen(b);
  if (len === 1) return [b, 1];

  let cp;
  let extra;
  if (len === 2) { cp = b & 0x1f; extra = 1; }
  else if (len === 3) { cp = b & 0x0f; extra = 2; }
  else { cp = b & 0x07; extra = 3; }

  for (let k = 1; k <= extra; k++) {
    const next = buf[pos + k];
    if (next === undefined) return [b, 1];
    if ((next & 0xc0) !== 0x80) return [b, 1];   // not a continuation byte
    cp = (cp << 6) | (next & 0x3f);
  }

  if (cp < 0x80) return [b, 1];                                   // overlong
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return [b, 1];     // control
  if (cp >= 0xd800 && cp <= 0xdfff) return [b, 1];                // surrogate
  if (cp >= 0xe000 && cp <= 0xf8ff) return [b, 1];                // private use
  if (cp > 0xffff) return [b, 1];                                 // out of BMP

  return [cp, len];
}

/** Read one payload byte, treating it as a raw byte. Returns [byte, bytesConsumed]. */
function readRawPayloadByte(buf, pos) {
  const b = buf[pos];
  if (b === undefined) return [undefined, 1];
  const mapped = UNICODE_TO_CP1252_C1[b];
  return [(mapped !== undefined ? mapped : b) & 0xff, 1];
}

/** Read one payload byte that was written as UTF-8. Returns [byte, bytesConsumed]. */
function readUtf8PayloadByte(buf, pos) {
  const [cp, len] = readUtf8(buf, pos);
  if (cp === undefined) return [undefined, 1];
  return [cp & 0xff, len];
}

/**
 * Decode a buffer that uses the escape scheme.
 *
 * The on-disk shape is genuinely ambiguous: a payload byte >= 0x80 may be stored
 * raw, or written as a UTF-8 sequence, and the whole buffer may additionally sit
 * behind a CP1252 layer. Both readings are attempted and scored, because the two
 * can disagree for individual characters — e.g. `10 CC 91` is 里 (U+91CC) read as
 * raw bytes, but U+2211 if `CC 91` is taken as a UTF-8 sequence.
 */
function decodeEscapedBuffer(buf, opts = {}) {
  let bytes;
  let start = 0;

  if (opts.normalize === 'cp1252') {
    bytes = cp1252Normalize(buf);
  } else {
    bytes = buf;
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  }

  const reader = opts.payload === 'utf8' ? readUtf8PayloadByte : readRawPayloadByte;
  const out = [];
  let i = start;

  while (i < bytes.length) {
    const b = bytes[i];

    if (isEscapeByte(b)) {
      const [low, lowLen] = reader(bytes, i + 1);
      const [high, highLen] = reader(bytes, i + 1 + lowLen);
      if (high === undefined) break;

      let v = (low | (high << 8)) & 0xffff;
      if (b & 1) v = (v - 0x0e) & 0xffff;
      if (b & 2) v = (v + 0x900) & 0xffff;

      out.push(String.fromCharCode(v));
      i += 1 + lowLen + highLen;
      continue;
    }

    const [cp, len] = readUtf8(bytes, i);
    out.push(String.fromCharCode(cp));
    i += len;
  }

  return out.join('');
}

/**
 * How "real text"-like is this string?
 *
 * CJK and CJK punctuation are weighted heavily; ASCII is neutral; replacement
 * characters, unassigned code points and base64-ish accent soup are penalised.
 * This is what lets the decoder pick the right reading without knowing the file.
 */
function textScore(s) {
  if (!s.length) return 0;
  let good = 0;
  let bad = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfffd) { bad += 4; continue; }                   // lost data
    if (cp >= 0x4e00 && cp <= 0x9fff) { good += 3; continue; }   // CJK ideograph
    if (cp >= 0x3400 && cp <= 0x4dbf) { good += 2; continue; }   // CJK ext A
    if (cp >= 0x3000 && cp <= 0x303f) { good += 3; continue; }   // CJK punctuation
    if (cp >= 0xff00 && cp <= 0xffef) { good += 2; continue; }   // fullwidth forms
    if (cp >= 0x20 && cp < 0x7f) { good += 1; continue; }        // ASCII printable
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) { good += 1; continue; }
    if (cp >= 0x2010 && cp <= 0x203a) { good += 1; continue; }   // dashes, quotes
    if (cp < 0x20) { bad += 3; continue; }                       // control codes
    if (cp >= 0xe000 && cp <= 0xf8ff) { bad += 2; continue; }    // private use
    if (cp >= 0x300 && cp <= 0x36f) { bad += 1; continue; }      // combining marks
    good += 1;                                                    // other letters
  }
  return (good - bad) / s.length;
}

function decodePlain(buf) {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  return buf.slice(start).toString('utf8');
}

/** Decode treating every byte as a single CP1252/latin-1 character. */
function decodeBytesAsCp1252(buf) {
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  const out = [];
  for (let i = start; i < buf.length; i++) {
    const b = buf[i];
    const mapped = CP1252_C1_TO_UNICODE[b];
    out.push(String.fromCharCode(mapped !== undefined ? mapped : b));
  }
  return out.join('');
}

let GBK_DECODER = null;
function gbkDecoder() {
  if (GBK_DECODER === null) {
    try { GBK_DECODER = new TextDecoder('gb18030', { fatal: false }); }
    catch { GBK_DECODER = false; }
  }
  return GBK_DECODER;
}

function cjkCount(s) {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) n++;
  }
  return n;
}

/**
 * Decode a non-UTF-8, non-escaped file.
 *
 * Some files in a Chinese mod are plain GBK rather than CP1252 — notably
 * `map/definition.csv` and free-text changelogs. Latin-1 is always lossless for
 * single-byte text, so we prefer GBK only when it clearly produces real CJK.
 */
function decodeLegacy(buf) {
  const dec = gbkDecoder();
  if (dec) {
    const gbk = dec.decode(buf);
    if (cjkCount(gbk) > 0) {
      return { text: gbk, encoding: 'gbk' };
    }
  }
  return { text: buf.toString('latin1'), encoding: 'cp1252' };
}

/** True when the buffer is plain UTF-8 (no escapes, no invalid sequences). */
function isPlainUtf8(buf) {
  return !hasEscapes(buf) && isValidUtf8(buf);
}

/** One decoding strategy: how to read a buffer, and how to label the result. */
const STRATEGIES = [
  { encoding: 'plain-utf8', run: (buf) => decodePlain(buf) },
  { encoding: 'escaped-cp1252', run: (buf) => decodeEscapedBuffer(buf, { normalize: 'cp1252', payload: 'raw' }) },
  { encoding: 'escaped-raw', run: (buf) => decodeEscapedBuffer(buf, { payload: 'raw' }) },
  { encoding: 'escaped-utf8', run: (buf) => decodeEscapedBuffer(buf, { payload: 'utf8' }) },
  { encoding: 'cp1252', run: (buf) => decodeBytesAsCp1252(buf) },
];

/**
 * Decode any EU4 text buffer into a JS string, choosing the right shape.
 *
 * Every plausible reading is produced and scored, and the best one wins. This is
 * deliberately empirical: the shapes overlap, and a buffer's byte pattern alone
 * cannot always distinguish them (a raw 0xCC 0x91 is also valid UTF-8).
 *
 * @param {Buffer} buf
 * @param {{mode?: string}} [opts]
 * @returns {string}
 */
function decodeBuffer(buf, opts = {}) {
  const mode = opts.mode;
  if (mode) {
    const forced = STRATEGIES.find((s) => s.encoding === mode);
    if (forced) return forced.run(buf);
    if (mode === 'plain') return decodePlain(buf);
    if (mode === 'escaped-cp1252') {
      return decodeEscapedBuffer(buf, { normalize: 'cp1252', payload: 'raw' });
    }
    if (mode === 'escaped-raw') return decodeEscapedBuffer(buf, { payload: 'raw' });
  }

  const { text, encoding } = decodeBest(buf);
  void encoding;
  return text;
}

/** Minimum CJK characters before a GBK reading is considered credible. */
const GBK_MIN_CJK = 5;

/**
 * Pick the best-reading strategy for a buffer. Returns { text, encoding }.
 *
 * Strategies are tried in priority order and the first strictly-better score
 * wins, so ties resolve deterministically. GBK is only considered when a file is
 * neither valid UTF-8 nor escape-free, and only when it yields real CJK text —
 * otherwise a single coincidental character (the `ñ` in `Logroño` decodes to 駉
 * under GBK) would hijack ordinary CP1252 content.
 */
function decodeBest(buf) {
  const escaped = hasEscapes(buf);
  const validUtf8 = isValidUtf8(buf);

  const candidates = STRATEGIES.filter((s) => escaped || !s.encoding.startsWith('escaped'));

  if (!escaped && !validUtf8) {
    const dec = gbkDecoder();
    if (dec) {
      candidates.push({
        encoding: 'gbk',
        run: () => dec.decode(buf),
        requires: (text) => cjkCount(text) >= GBK_MIN_CJK,
      });
    }
  }

  let best = null;
  for (const s of candidates) {
    let text;
    try { text = s.run(buf); } catch { continue; }
    if (s.requires && !s.requires(text)) continue;

    const score = textScore(text);
    if (!best || score > best.score + 1e-9) {
      best = { text, score, encoding: s.encoding };
    }
  }

  if (!best) return { text: decodePlain(buf), encoding: 'plain-utf8' };
  return { text: best.text, encoding: best.encoding };
}

/** Report which shape a buffer is in. */
function detectEncoding(buf) {
  return decodeBest(buf).encoding;
}

/** Legacy alias used by the rest of the app. */
function decodeLocBuffer(buf, opts) {
  return decodeBuffer(buf, opts);
}

const looksEscaped = hasEscapes;

// ---------------------------------------------------------------------------
// Encoding (round-trip / tooling)
// ---------------------------------------------------------------------------

function writeUtf8(byte) {
  if (byte < 0x80) return [byte];
  return [0xc0 | (byte >> 6), 0x80 | (byte & 0x3f)];
}

/** Encode a string into the escape byte form (CP1252-normalized shape). */
function encodeString(str) {
  const out = [];
  for (const ch of str) {
    let cp = ch.codePointAt(0);

    const c1 = UNICODE_TO_CP1252_C1[cp];
    if (c1 !== undefined) { out.push(...writeUtf8(c1)); continue; }
    if (cp > 0x100 && cp < 0xa00) cp += 0xe000;

    let high = (cp >> 8) & 0xff;
    let low = cp & 0xff;
    if (high === 0) { out.push(...writeUtf8(low)); continue; }

    let esc = ESC_MIN;
    if (RESERVED_BYTES.has(high)) esc += 2;
    if (RESERVED_BYTES.has(low)) esc += 1;

    if (esc === 0x11) low = (low + 0x0e) & 0xff;
    else if (esc === 0x12) high = (high - 9) & 0xff;
    else if (esc === 0x13) { low = (low + 0x0e) & 0xff; high = (high - 9) & 0xff; }

    out.push(esc, ...writeUtf8(low), ...writeUtf8(high));
  }
  return Buffer.from(out);
}

/** Encode a string into the raw (invalid-UTF-8) shape used by script files. */
function encodeStringRaw(str) {
  const out = [];
  for (const ch of str) {
    let cp = ch.codePointAt(0);
    if (cp > 0x100 && cp < 0xa00) cp += 0xe000;
    let high = (cp >> 8) & 0xff;
    let low = cp & 0xff;
    if (high === 0) { out.push(low); continue; }
    let esc = ESC_MIN;
    if (RESERVED_BYTES.has(high)) esc += 2;
    if (RESERVED_BYTES.has(low)) esc += 1;
    if (esc === 0x11) low = (low + 0x0e) & 0xff;
    else if (esc === 0x12) high = (high - 9) & 0xff;
    else if (esc === 0x13) { low = (low + 0x0e) & 0xff; high = (high - 9) & 0xff; }
    out.push(esc, low, high);
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// YML localisation parsing
// ---------------------------------------------------------------------------

function stripOuterComment(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === '#' && !inQuotes) return line.slice(0, i);
  }
  return line;
}

function parseLocalisation(text, opts = {}) {
  const entries = new Map();
  let language = opts.language || null;
  let malformed = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (!line || !line.trim()) continue;

    const header = /^\s*(l_[a-z_]+)\s*:\s*$/.exec(line);
    if (header) { language = header[1]; continue; }
    if (/^\s*#/.test(line)) continue;

    line = stripOuterComment(line);
    if (!line.trim()) continue;

    const m = /^\s*([^\s:#][^:]*?)\s*:\s*(\d+)?\s*(.*)$/.exec(line);
    if (!m) { malformed++; continue; }

    const rest = m[3].trim();
    let value;
    if (rest.startsWith('"')) {
      const end = rest.lastIndexOf('"');
      value = end > 0 ? rest.slice(1, end) : rest.slice(1);
      // Paradox YAML doubles a quote to escape it, so a value written `""…""`
      // means the player sees the text wrapped in literal quotes. The outer
      // strip above has already removed one layer.
      if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
    } else {
      value = rest;
    }

    entries.set(m[1], {
      value,
      version: m[2] !== undefined ? Number(m[2]) : null,
      line: i + 1,
    });
  }

  return { language, entries, malformed };
}

module.exports = {
  RESERVED_BYTES,
  CP1252_C1_TO_UNICODE,
  UNICODE_TO_CP1252_C1,
  isEscapeByte,
  hasEscapes,
  looksEscaped,
  isValidUtf8,
  isPlainUtf8,
  cp1252Normalize,
  decodeEscapedBuffer,
  decodePlain,
  decodeLegacy,
  decodeBuffer,
  decodeBest,
  decodeLocBuffer,
  detectEncoding,
  textScore,
  encodeString,
  encodeStringRaw,
  parseLocalisation,
};
