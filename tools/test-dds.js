'use strict';
/**
 * Verification harness for `src/codec/dds.js`.
 *
 * Part 1 synthesises DDS surfaces byte-by-byte (DXT1/DXT3/DXT5 blocks plus
 * uncompressed BGRA/BGR) where every pixel value is known by hand, and checks
 * the decoder against those literals. Malformed / oversized / unsupported
 * headers are checked to return null instead of throwing.
 *
 * Part 2 decodes real `.dds` files out of an installed EU4 mod + the vanilla
 * game directory, writes the results as PNGs next to this script so they can be
 * eyeballed, and reports header, pixel count, timing and byte size. It exits 1
 * if nothing real decoded.
 *
 * Run from the repo root:  node tools\test-dds.js
 */

const dds = require('../src/codec/dds.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got: ${JSON.stringify(actual)}\n  exp: ${JSON.stringify(expected)}`);
  else console.log(`pass ${name}`);
}
function checkTrue(name, value) {
  check(name, !!value, true);
}

// ---------------------------------------------------------------------------
// Synthetic DDS construction
// ---------------------------------------------------------------------------

const DDS_MAGIC = 0x20534444;
const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;

const STANDARD_MASKS = { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0xff000000 };

/** Build a complete 128-byte-header + data DDS buffer. */
function buildDds(o) {
  const header = Buffer.alloc(128);
  header.writeUInt32LE(DDS_MAGIC, 0);
  header.writeUInt32LE(124, 4); // dwSize
  let flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT;
  if (o.linearSize) flags |= 0x80000; // DDSD_LINEARSIZE
  if (o.pitch) flags |= 0x8; // DDSD_PITCH
  header.writeUInt32LE(o.flags === undefined ? flags : o.flags, 8);
  header.writeUInt32LE(o.height, 12);
  header.writeUInt32LE(o.width, 16);
  header.writeUInt32LE(o.pitchOrLinearSize || 0, 20);
  header.writeUInt32LE(0, 24); // dwDepth
  header.writeUInt32LE(o.mipmaps || 0, 28);
  header.writeUInt32LE(32, 76); // ddspf.dwSize
  header.writeUInt32LE(o.pfFlags, 80);
  if (o.fourCC) header.write(o.fourCC, 84, 'ascii');
  header.writeUInt32LE(o.rgbBitCount || 0, 88);
  const m = o.masks || {};
  header.writeUInt32LE(m.r || 0, 92);
  header.writeUInt32LE(m.g || 0, 96);
  header.writeUInt32LE(m.b || 0, 100);
  header.writeUInt32LE(m.a || 0, 104);
  return Buffer.concat([header, Buffer.from(o.data || [])]);
}

/** Wrap block-compressed data in a full DDS container. */
function blockDds(fourCC, width, height, blocks, mipmaps) {
  return buildDds({
    width,
    height,
    fourCC,
    mipmaps,
    pfFlags: DDPF_FOURCC,
    linearSize: blocks.length,
    data: Buffer.concat(blocks),
  });
}

/** Pack the four 2-bit-index bytes of a BC1 block into its 32-bit field. */
function packIndices(rows) {
  return (rows[0] | (rows[1] << 8) | (rows[2] << 16) | (rows[3] << 24)) >>> 0;
}

/** One BC1 colour block; `rows` holds one index byte per pixel row. */
function bc1Block(c0, c1, rows) {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(c0, 0);
  b.writeUInt16LE(c1, 2);
  b.writeUInt32LE(packIndices(rows), 4);
  return b;
}

/** One BC2 block: 8 literal alpha bytes then an always-4-colour block. */
function bc2Block(alphaBytes, c0, c1, rows) {
  const b = Buffer.alloc(16);
  Buffer.from(alphaBytes).copy(b, 0);
  b.writeUInt16LE(c0, 8);
  b.writeUInt16LE(c1, 10);
  b.writeUInt32LE(packIndices(rows), 12);
  return b;
}

/**
 * Pack 16 x 3-bit BC3 alpha indices into 6 bytes, little-endian bit order.
 * Written bit by bit on purpose — this is the test's own independent packer,
 * not a copy of the decoder's shifting trick.
 */
function packAlphaIndices(indices) {
  const b = Buffer.alloc(6);
  let bitPos = 0;
  for (const idx of indices) {
    for (let k = 0; k < 3; k++) {
      if ((idx >> k) & 1) b[bitPos >> 3] |= 1 << (bitPos & 7);
      bitPos++;
    }
  }
  return b;
}

/** One BC3 block: interpolated alpha then a 4-colour block. */
function bc3Block(a0, a1, indices, c0, c1, rows) {
  const b = Buffer.alloc(16);
  b[0] = a0;
  b[1] = a1;
  packAlphaIndices(indices).copy(b, 2);
  b.writeUInt16LE(c0, 8);
  b.writeUInt16LE(c1, 10);
  b.writeUInt32LE(packIndices(rows), 12);
  return b;
}

/** 32-bit BGRA surface from an array of [b,g,r,a] pixels, row-major. */
function bgra32(width, height, pixels) {
  const data = Buffer.alloc(width * height * 4);
  pixels.forEach((p, i) => {
    data[i * 4] = p[0];
    data[i * 4 + 1] = p[1];
    data[i * 4 + 2] = p[2];
    data[i * 4 + 3] = p[3];
  });
  return buildDds({
    width,
    height,
    fourCC: null,
    pfFlags: DDPF_RGB | DDPF_ALPHAPIXELS,
    rgbBitCount: 32,
    masks: STANDARD_MASKS,
    pitch: true,
    pitchOrLinearSize: width * 4,
    data,
  });
}

/** 24-bit BGR surface from an array of [b,g,r] pixels, row-major. */
function bgr24(width, height, pixels, masks) {
  const data = Buffer.alloc(width * height * 3);
  pixels.forEach((p, i) => {
    data[i * 3] = p[0];
    data[i * 3 + 1] = p[1];
    data[i * 3 + 2] = p[2];
  });
  const m = masks || { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: 0 };
  return buildDds({
    width,
    height,
    fourCC: null,
    pfFlags: DDPF_RGB | (m.a ? DDPF_ALPHAPIXELS : 0),
    rgbBitCount: 24,
    masks: m,
    linearSize: true,
    pitchOrLinearSize: width * 3,
    data,
  });
}

// ---------------------------------------------------------------------------
// PNG structural verification (independent CRC implementation)
// ---------------------------------------------------------------------------

/** CRC-32 computed bit-by-bit (no table) so it shares no code with the module. */
function crc32Bitwise(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Split a PNG into chunks and verify every CRC. */
function readPngChunks(png) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = { signatureOk: png.subarray(0, 8).equals(sig), chunks: [], crcOk: true };
  let p = 8;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('ascii', p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    const stored = png.readUInt32BE(p + 8 + len);
    if (stored !== crc32Bitwise(png.subarray(p + 4, p + 8 + len))) out.crcOk = false;
    out.chunks.push({ type, data });
    p += 12 + len;
  }
  out.trailingBytes = png.length - p;
  return out;
}

/** Full PNG check: structure, IHDR fields, and IDAT pixels vs `rgba`. */
function verifyPng(name, png, width, height, rgba) {
  checkTrue(`${name} signature`, png && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  const info = readPngChunks(png);
  check(`${name} chunk order`, info.chunks.map((c) => c.type).join(','), 'IHDR,IDAT,IEND');
  checkTrue(`${name} all chunk CRCs valid`, info.crcOk);
  check(`${name} no trailing bytes`, info.trailingBytes, 0);
  const ihdr = info.chunks[0].data;
  check(`${name} IHDR width`, ihdr.readUInt32BE(0), width);
  check(`${name} IHDR height`, ihdr.readUInt32BE(4), height);
  check(`${name} IHDR bitDepth/colorType/comp/filter/interlace`,
    `${ihdr[8]}/${ihdr[9]}/${ihdr[10]}/${ihdr[11]}/${ihdr[12]}`, '8/6/0/0/0');
  const raw = zlib.inflateSync(info.chunks[1].data);
  check(`${name} inflated size`, raw.length, (width * 4 + 1) * height);
  let filtersOk = true;
  let pixelsOk = true;
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    if (raw[base] !== 0) filtersOk = false;
    if (Buffer.compare(raw.subarray(base + 1, base + 1 + stride), rgba.subarray(y * stride, (y + 1) * stride)) !== 0) {
      pixelsOk = false;
    }
  }
  checkTrue(`${name} every scanline uses filter 0`, filtersOk);
  checkTrue(`${name} IDAT pixels match decoded RGBA`, pixelsOk);
}

/** Read pixel (x,y) out of an RGBA buffer as [r,g,b,a]. */
function px(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}
function checkPixel(name, rgba, width, x, y, expected) {
  check(name, JSON.stringify(px(rgba, width, x, y)), JSON.stringify(expected));
}

// ===========================================================================
// 1. Synthetic header parsing
// ===========================================================================
console.log('=== 1. Header parsing ===');
{
  const buf = blockDds('DXT1', 6, 3, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 10);
  const h = dds.parseDdsHeader(buf);
  check('header width', h.width, 6);
  check('header height', h.height, 3);
  check('header fourCC', h.fourCC, 'DXT1');
  check('header format', h.format, 'DXT1');
  check('header mipmaps', h.mipmaps, 10);
  check('header hasAlpha', h.hasAlpha, true);
  check('header DDSD_LINEARSIZE', h.hasLinearSize, true);
  check('header DDSD_PITCH', h.hasPitch, false);
  check('header dataOffset', h.dataOffset, 128);

  const noMips = dds.parseDdsHeader(blockDds('DXT5', 4, 4, [bc3Block(0, 255, [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7], 0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 0));
  check('mipMapCount 0 normalises to 1', noMips.mipmaps, 1);

  // Guards: everything here must be null, never a throw.
  check('null input', dds.parseDdsHeader(null), null);
  check('undefined input', dds.parseDdsHeader(undefined), null);
  check('string input', dds.parseDdsHeader('DDS '), null);
  check('empty buffer', dds.parseDdsHeader(Buffer.alloc(0)), null);
  check('short buffer', dds.parseDdsHeader(Buffer.alloc(127)), null);
  check('bad magic', dds.parseDdsHeader(Buffer.concat([Buffer.from('XXXX'), Buffer.alloc(124)])), null);

  const zeroWidth = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])]);
  zeroWidth.writeUInt32LE(0, 16);
  check('width 0 rejected', dds.parseDdsHeader(zeroWidth), null);
  const zeroHeight = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])]);
  zeroHeight.writeUInt32LE(0, 12);
  check('height 0 rejected', dds.parseDdsHeader(zeroHeight), null);

  const wide = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])]);
  wide.writeUInt32LE(16385, 16);
  check('width > 16384 rejected', dds.parseDdsHeader(wide), null);
  const tall = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])]);
  tall.writeUInt32LE(16385, 12);
  check('height > 16384 rejected', dds.parseDdsHeader(tall), null);

  const huge = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])]);
  huge.writeUInt32LE(16384, 16);
  huge.writeUInt32LE(8192, 12); // 134,217,728 pixels > 64 Mi
  check('width*height > 64Mi rejected', dds.parseDdsHeader(huge), null);
  huge.writeUInt32LE(4096, 12); // exactly 64 Mi is allowed
  checkTrue('width*height == 64Mi accepted', dds.parseDdsHeader(huge) !== null);
}

// ===========================================================================
// 2. DXT1 / BC1
// ===========================================================================
console.log('\n=== 2. DXT1 / BC1 ===');
{
  // c0 = 0xF800 (255,0,0), c1 = 0x001F (0,0,255); c0 > c1 -> 4-colour mode.
  // Row pattern 0xE4 -> indices 0,1,2,3 across the row.
  //   idx 2 = (2*c0 + c1)/3 = (170,0,85), idx 3 = (c0 + 2*c1)/3 = (85,0,170)
  const buf = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const d = dds.decodeDds(buf);
  check('DXT1 4-colour decode non-null', d !== null, true);
  check('DXT1 4-colour size', d.rgba.length, 4 * 4 * 4);
  checkPixel('DXT1 idx0 endpoint0', d.rgba, 4, 0, 0, [255, 0, 0, 255]);
  checkPixel('DXT1 idx1 endpoint1', d.rgba, 4, 1, 0, [0, 0, 255, 255]);
  checkPixel('DXT1 idx2 2/3 blend', d.rgba, 4, 2, 0, [170, 0, 85, 255]);
  checkPixel('DXT1 idx3 1/3 blend', d.rgba, 4, 3, 0, [85, 0, 170, 255]);
  checkPixel('DXT1 row 3 identical', d.rgba, 4, 3, 3, [85, 0, 170, 255]);
  verifyPng('DXT1 4-colour PNG', dds.ddsToPng(buf), 4, 4, d.rgba);
}
{
  // Punch-through: c0 = 0x03E0 (0,125,0) <= c1 = 0x07E0 (0,255,0).
  //   idx 2 = midpoint (0,190,0); idx 3 = transparent black.
  const buf = blockDds('DXT1', 4, 4, [bc1Block(0x03e0, 0x07e0, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const d = dds.decodeDds(buf);
  checkPixel('DXT1 punch idx0', d.rgba, 4, 0, 0, [0, 125, 0, 255]);
  checkPixel('DXT1 punch idx1', d.rgba, 4, 1, 0, [0, 255, 0, 255]);
  checkPixel('DXT1 punch idx2 midpoint', d.rgba, 4, 2, 0, [0, 190, 0, 255]);
  checkPixel('DXT1 punch idx3 transparent', d.rgba, 4, 3, 0, [0, 0, 0, 0]);
  checkPixel('DXT1 punch idx3 transparent (last row)', d.rgba, 4, 3, 3, [0, 0, 0, 0]);
  checkTrue('DXT1 punch PNG encodes', dds.ddsToPng(buf) !== null);
}
{
  // Non-multiple-of-4 surface: 6x3 -> 2x1 blocks, only x<6 / y<3 survive.
  // Block 0: c0=0xF800 c1=0x001F (4-colour, indices 0..3).
  // Block 1: c0=0x07E0 (0,255,0) c1=0x001F -> pal1 (0,0,255),
  //          pal2 = (0,170,85), pal3 = (0,85,170).
  const blocks = [
    bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
    bc1Block(0x07e0, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
  ];
  const buf = blockDds('DXT1', 6, 3, blocks, 10);
  const d = dds.decodeDds(buf);
  check('DXT1 6x3 width', d.width, 6);
  check('DXT1 6x3 height', d.height, 3);
  check('DXT1 6x3 rgba length', d.rgba.length, 6 * 3 * 4);
  checkPixel('DXT1 6x3 block0 pixel', d.rgba, 6, 0, 0, [255, 0, 0, 255]);
  checkPixel('DXT1 6x3 block0 last visible', d.rgba, 6, 3, 0, [85, 0, 170, 255]);
  checkPixel('DXT1 6x3 block1 in-range', d.rgba, 6, 4, 2, [0, 255, 0, 255]);
  checkPixel('DXT1 6x3 block1 in-range 2', d.rgba, 6, 5, 2, [0, 0, 255, 255]);
  const png = dds.ddsToPng(buf);
  verifyPng('DXT1 6x3 PNG', png, 6, 3, d.rgba);
}
{
  // Truncated payload must be null, not a crash.
  const good = blockDds('DXT1', 8, 8, [
    bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
    bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
    bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
    bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4]),
  ], 1);
  check('truncated DXT1 payload -> null', dds.decodeDds(good.subarray(0, 128 + 20)), null);
}

// ===========================================================================
// 3. DXT3 / BC2
// ===========================================================================
console.log('\n=== 3. DXT3 / BC2 ===');
{
  // Colour endpoints are deliberately c0 < c1 so that a decoder that wrongly
  // applied the BC1 punch-through rule would produce the midpoint (0,190,0)
  // instead of the 4-colour blend (0,168,0).
  const alphaBytes = [0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe];
  const buf = blockDds('DXT3', 4, 4, [bc2Block(alphaBytes, 0x03e0, 0x07e0, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const d = dds.decodeDds(buf);
  checkPixel('DXT3 pixel0 nibble0 alpha', d.rgba, 4, 0, 0, [0, 125, 0, 0]);
  checkPixel('DXT3 pixel1 nibble1 alpha', d.rgba, 4, 1, 0, [0, 255, 0, 17]);
  checkPixel('DXT3 pixel2 nibble2 alpha 4-colour blend', d.rgba, 4, 2, 0, [0, 168, 0, 34]);
  checkPixel('DXT3 pixel3 nibble3', d.rgba, 4, 3, 0, [0, 211, 0, 51]);
  checkPixel('DXT3 pixel15 nibble15', d.rgba, 4, 3, 3, [0, 211, 0, 255]);
  checkPixel('DXT3 row1 first pixel alpha 68', d.rgba, 4, 0, 1, [0, 125, 0, 68]);
  verifyPng('DXT3 PNG', dds.ddsToPng(buf), 4, 4, d.rgba);
}

// ===========================================================================
// 4. DXT5 / BC3
// ===========================================================================
console.log('\n=== 4. DXT5 / BC3 ===');
{
  // a0 = 0 <= a1 = 255 -> 6-value ramp: [0,255,51,102,153,204,0,255].
  // All divisions are exact, so there is no rounding ambiguity to argue about.
  const rampIndices = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
  const buf = blockDds('DXT5', 4, 4, [bc3Block(0, 255, rampIndices, 0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const d = dds.decodeDds(buf);
  checkPixel('BC3 ramp idx0 = a0', d.rgba, 4, 0, 0, [255, 0, 0, 0]);
  checkPixel('BC3 ramp idx1 = a1', d.rgba, 4, 1, 0, [0, 0, 255, 255]);
  checkPixel('BC3 ramp idx2 = 51', d.rgba, 4, 2, 0, [170, 0, 85, 51]);
  checkPixel('BC3 ramp idx3 = 102', d.rgba, 4, 3, 0, [85, 0, 170, 102]);
  checkPixel('BC3 ramp idx4 = 153', d.rgba, 4, 0, 1, [255, 0, 0, 153]);
  checkPixel('BC3 ramp idx5 = 204', d.rgba, 4, 1, 1, [0, 0, 255, 204]);
  checkPixel('BC3 ramp idx6 = 0', d.rgba, 4, 2, 1, [170, 0, 85, 0]);
  checkPixel('BC3 ramp idx7 = 255', d.rgba, 4, 3, 1, [85, 0, 170, 255]);
  verifyPng('BC3 ramp PNG', dds.ddsToPng(buf), 4, 4, d.rgba);
}
{
  // a0 = 7 > a1 = 0 -> 8-value ramp: [7,0,6,5,4,3,2,1].
  const rampIndices = [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0];
  const buf = blockDds('DXT5', 4, 4, [bc3Block(7, 0, rampIndices, 0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const d = dds.decodeDds(buf);
  checkPixel('BC3 8-ramp idx0', d.rgba, 4, 0, 0, [255, 0, 0, 7]);
  checkPixel('BC3 8-ramp idx1', d.rgba, 4, 1, 0, [0, 0, 255, 0]);
  checkPixel('BC3 8-ramp idx2 = 6', d.rgba, 4, 2, 0, [170, 0, 85, 6]);
  checkPixel('BC3 8-ramp idx3 = 5', d.rgba, 4, 3, 0, [85, 0, 170, 5]);
  checkPixel('BC3 8-ramp idx7 = 1', d.rgba, 4, 3, 1, [85, 0, 170, 1]);
  checkPixel('BC3 8-ramp row2 idx7 reused', d.rgba, 4, 0, 2, [255, 0, 0, 1]);
}
{
  // 5x5 DXT5 -> 2x2 blocks: exercises cropping on both axes for BC3, and the
  // endpoints are c0 < c1 so a decoder that leaked BC1's punch-through rule
  // into DXT5 would produce the midpoint (0,190,0) instead of the blend.
  const rampIndices = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
  const block = () => bc3Block(0, 255, rampIndices, 0x03e0, 0x07e0, [0xe4, 0xe4, 0xe4, 0xe4]);
  const buf = blockDds('DXT5', 5, 5, [block(), block(), block(), block()], 12);
  const d = dds.decodeDds(buf);
  check('DXT5 5x5 rgba length', d.rgba.length, 5 * 5 * 4);
  // Block (1,1), local (0,0): index 0 -> (0,125,0), alpha ramp index 0 -> 0.
  checkPixel('DXT5 5x5 cropped corner', d.rgba, 5, 4, 4, [0, 125, 0, 0]);
  // Block (1,0), local (0,1): alpha ramp index 4 -> 153.
  checkPixel('DXT5 5x5 cropped edge', d.rgba, 5, 4, 1, [0, 125, 0, 153]);
  // Block (0,0), local (3,3): index 3 -> (c0 + 2*c1)/3 = 211.
  checkPixel('DXT5 5x5 full block blend', d.rgba, 5, 3, 3, [0, 211, 0, 255]);
  checkTrue('DXT5 5x5 PNG encodes', dds.ddsToPng(buf) !== null);
}

// ===========================================================================
// 5. Uncompressed surfaces
// ===========================================================================
console.log('\n=== 5. Uncompressed ===');
{
  // DDS stores blue first; the decoder must hand back true RGBA order.
  const buf = bgra32(2, 2, [
    [10, 20, 30, 40],   // b,g,r,a
    [0, 0, 255, 255],
    [255, 128, 0, 128],
    [1, 2, 3, 4],
  ]);
  const h = dds.parseDdsHeader(buf);
  check('BGRA8 format', h.format, 'BGRA8');
  check('BGRA8 hasAlpha', h.hasAlpha, true);
  check('BGRA8 hasPitch', h.hasPitch, true);
  check('BGRA8 rgbBitCount', h.rgbBitCount, 32);
  const d = dds.decodeDds(buf);
  checkPixel('BGRA8 swap r/b', d.rgba, 2, 0, 0, [30, 20, 10, 40]);
  checkPixel('BGRA8 red', d.rgba, 2, 1, 0, [255, 0, 0, 255]);
  checkPixel('BGRA8 mixed', d.rgba, 2, 0, 1, [0, 128, 255, 128]);
  checkPixel('BGRA8 low values', d.rgba, 2, 1, 1, [3, 2, 1, 4]);
  verifyPng('BGRA8 PNG', dds.ddsToPng(buf), 2, 2, d.rgba);
}
{
  const buf = bgr24(3, 1, [
    [10, 20, 30],
    [0, 255, 0],
    [255, 0, 255],
  ]);
  const h = dds.parseDdsHeader(buf);
  check('BGR8 format', h.format, 'BGR8');
  check('BGR8 hasAlpha', h.hasAlpha, false);
  const d = dds.decodeDds(buf);
  checkPixel('BGR8 swap r/b', d.rgba, 3, 0, 0, [30, 20, 10, 255]);
  checkPixel('BGR8 green', d.rgba, 3, 1, 0, [0, 255, 0, 255]);
  checkPixel('BGR8 magenta', d.rgba, 3, 2, 0, [255, 0, 255, 255]);
}
{
  // Non-standard RGBA-ordered masks (r in the low byte) must still come out
  // as RGBA rather than being blindly byte-swapped. The bytes below are
  // r,g,b here precisely because the masks say so.
  const buf = bgr24(2, 1, [
    [255, 0, 0],
    [7, 8, 9],
  ], { r: 0x000000ff, g: 0x0000ff00, b: 0x00ff0000, a: 0 });
  const h = dds.parseDdsHeader(buf);
  check('RGBA-ordered masks format', h.format, 'RGB8');
  const d = dds.decodeDds(buf);
  checkPixel('RGBA-ordered masks pixel', d.rgba, 2, 0, 0, [255, 0, 0, 255]);
  checkPixel('RGBA-ordered masks pixel 2', d.rgba, 2, 1, 0, [7, 8, 9, 255]);
}
{
  // 8-bit masks are read straight through; a 5-bit channel gets scaled.
  const buf = buildDds({
    width: 2,
    height: 1,
    fourCC: null,
    pfFlags: DDPF_RGB | DDPF_ALPHAPIXELS,
    rgbBitCount: 32,
    masks: { r: 0x3ff00000, g: 0x000ffc00, b: 0x000003ff, a: 0xc0000000 },
    linearSize: true,
    data: Buffer.from([
      0xff, 0x03, 0x00, 0x00, // b=1023, g=0, r=0, a=0
      0x00, 0x00, 0xf0, 0xff, // b=0, g=0, r=1023, a=3
    ]),
  });
  const d = dds.decodeDds(buf);
  checkPixel('10-bit channel scaling low', d.rgba, 2, 0, 0, [0, 0, 255, 0]);
  checkPixel('10-bit channel scaling high', d.rgba, 2, 1, 0, [255, 0, 0, 255]);
}
{
  // A 16-bit surface is not supported and must decode to null.
  const buf = buildDds({
    width: 2,
    height: 1,
    fourCC: null,
    pfFlags: DDPF_RGB,
    rgbBitCount: 16,
    masks: { r: 0xf800, g: 0x07e0, b: 0x001f, a: 0 },
    data: Buffer.alloc(4),
  });
  check('16-bit format label', dds.parseDdsHeader(buf).format, 'BGR16');
  check('16-bit decode -> null', dds.decodeDds(buf), null);
}

// ===========================================================================
// 6. Unsupported formats and malformed input never throw
// ===========================================================================
console.log('\n=== 6. Unsupported / malformed ===');
{
  const base = { width: 4, height: 4, mipmaps: 1, pfFlags: DDPF_FOURCC, data: Buffer.alloc(64) };
  for (const cc of ['DX10', 'ATI2', 'BC5U', 'DXT2', 'DXT4', 'BC4U']) {
    const buf = buildDds({ ...base, fourCC: cc, data: Buffer.alloc(cc === 'DX10' ? 64 + 20 : 64) });
    const h = dds.parseDdsHeader(buf);
    check(`${cc} header parses`, h && h.fourCC, cc);
    check(`${cc} decode -> null`, dds.decodeDds(buf), null);
    check(`${cc} ddsToPng -> null`, dds.ddsToPng(buf), null);
  }
  check('DX10 dataOffset skips extended header', dds.parseDdsHeader(buildDds({ ...base, fourCC: 'DX10', data: Buffer.alloc(84) })).dataOffset, 148);
}
{
  const valid = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const bad = [
    ['empty buffer', Buffer.alloc(0)],
    ['random bytes', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ['text', Buffer.from('this is definitely not a dds texture at all')],
    ['magic only', Buffer.from('DDS ' + 'x'.repeat(4))],
    ['header only', valid.subarray(0, 128)],
    ['truncated data', valid.subarray(0, 130)],
  ];
  for (const [label, buf] of bad) {
    check(`decodeDds ${label} -> null`, dds.decodeDds(buf), null);
    check(`ddsToPng ${label} -> null`, dds.ddsToPng(buf), null);
  }
  for (const value of [null, undefined, 0, 'x', {}, [], true]) {
    check(`ddsToPng(${JSON.stringify(value)}) -> null`, dds.ddsToPng(value), null);
    check(`decodeDds(${JSON.stringify(value)}) -> null`, dds.decodeDds(value), null);
  }
}
{
  // encodePng rejects impossible requests rather than emitting a broken file.
  let threw = 0;
  for (const args of [[0, 1, Buffer.alloc(4)], [1, 0, Buffer.alloc(4)], [2, 2, Buffer.alloc(4)]]) {
    try {
      dds.encodePng(...args);
    } catch {
      threw++;
    }
  }
  check('encodePng throws on bad args', threw, 3);
}
{
  // A 1x1 PNG is still a legal, well-formed file.
  const png = dds.encodePng(1, 1, Buffer.from([1, 2, 3, 4]));
  verifyPng('1x1 PNG', png, 1, 1, Buffer.from([1, 2, 3, 4]));
}

{
  // Plain Uint8Array input, including a view that starts at an offset inside a
  // bigger ArrayBuffer, must decode identically to a Buffer.
  const valid = blockDds('DXT1', 4, 4, [bc1Block(0xf800, 0x001f, [0xe4, 0xe4, 0xe4, 0xe4])], 1);
  const expected = dds.decodeDds(valid);
  checkTrue('Uint8Array header parses', dds.parseDdsHeader(new Uint8Array(valid)) !== null);
  const fromU8 = dds.decodeDds(new Uint8Array(valid));
  checkTrue('Uint8Array decodes', fromU8 !== null);
  checkTrue('Uint8Array pixels match Buffer', fromU8 && fromU8.rgba.equals(expected.rgba));

  const padded = Buffer.alloc(valid.length + 24, 0xab);
  valid.copy(padded, 12);
  const view = new Uint8Array(padded.buffer, padded.byteOffset + 12, valid.length);
  const fromView = dds.decodeDds(view);
  checkTrue('offset Uint8Array view decodes', fromView !== null);
  checkTrue('offset view pixels match Buffer', fromView && fromView.rgba.equals(expected.rgba));
}

// ===========================================================================
// 7. Performance: a full-size 1024x1024 DXT5 surface
// ===========================================================================
console.log('\n=== 7. Performance (1024x1024 DXT5) ===');
{
  // 256 x 256 blocks x 16 bytes = 1 MiB, i.e. a typical big EU4 texture.
  const blockCount = 256 * 256;
  const data = Buffer.alloc(blockCount * 16);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    // Deterministic xorshift fill: the pixel *values* do not matter here, only
    // that the surface is full size and non-degenerate.
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    data[i] = seed & 0xff;
  }
  const buf = buildDds({
    width: 1024,
    height: 1024,
    fourCC: 'DXT5',
    mipmaps: 1,
    pfFlags: DDPF_FOURCC,
    linearSize: true,
    pitchOrLinearSize: data.length,
    data,
  });
  check('perf input size', buf.length, 128 + 1024 * 1024);
  const t0 = process.hrtime.bigint();
  const d = dds.decodeDds(buf);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  checkTrue(`1024x1024 DXT5 decoded (${ms.toFixed(1)} ms)`, d !== null);
  check('1024x1024 rgba length', d && d.rgba.length, 1024 * 1024 * 4);
  checkTrue(`1024x1024 DXT5 decode well under 2000 ms (${ms.toFixed(1)} ms)`, ms < 2000);
  const t1 = process.hrtime.bigint();
  const png = dds.ddsToPng(buf);
  const pngMs = Number(process.hrtime.bigint() - t1) / 1e6;
  checkTrue(`1024x1024 DXT5 -> PNG (${pngMs.toFixed(1)} ms, ${png ? png.length : 0} bytes)`, png !== null);
}

// ===========================================================================
// 8. Real EU4 textures
// ===========================================================================
console.log('\n=== 8. Real EU4 textures ===');
const OUT_DIR = path.join(__dirname, 'dds-out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MOD_ROOT = path.join(
  os.homedir(),
  'Documents/Paradox Interactive/Europa Universalis IV/mod/1.37 Celestial empire on which the sun never sets',
);
const VANILLA_ROOT = 'E:/SteamLibrary/steamapps/common/Europa Universalis IV';

// The brief's paths are listed first; the mod actually keeps its event pictures
// under gfx/event_pictures (no `interface` level), so that variant is included
// too and whichever directories exist get used.
const sources = [
  { label: 'mod gfx/interface/event_pictures', dir: path.join(MOD_ROOT, 'gfx/interface/event_pictures'), take: 2 },
  { label: 'mod gfx/event_pictures', dir: path.join(MOD_ROOT, 'gfx/event_pictures'), take: 2 },
  { label: 'mod gfx/interface/advisors', dir: path.join(MOD_ROOT, 'gfx/interface/advisors'), take: 2 },
  { label: 'vanilla gfx/interface/event_pictures', dir: path.join(VANILLA_ROOT, 'gfx/interface/event_pictures'), take: 2 },
  { label: 'vanilla gfx/interface/advisors', dir: path.join(VANILLA_ROOT, 'gfx/interface/advisors'), take: 2 },
];

function listDds(dir, take) {
  if (!fs.existsSync(dir)) return { dir, missing: true, files: [] };
  const files = fs.readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith('.dds'))
    .sort()
    .slice(0, take)
    .map((n) => path.join(dir, n));
  return { dir, missing: false, files };
}

function safeName(label, file) {
  const source = label.replace(/[^\w.-]+/g, '_');
  const base = path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, '_');
  return `${source}__${base}.png`;
}

const realTargets = [];
for (const s of sources) {
  const listed = listDds(s.dir, s.take);
  if (listed.missing) {
    console.log(`skip  ${s.label}: directory not present`);
    continue;
  }
  if (listed.files.length === 0) {
    console.log(`skip  ${s.label}: no .dds files`);
    continue;
  }
  console.log(`use   ${s.label}: ${listed.files.length} file(s)`);
  for (const f of listed.files) realTargets.push({ label: s.label, file: f });
}

// One deliberately big texture (1.4 MB, 2048-wide) to prove the performance
// claim on something much larger than a 1024x1024 DXT5.
const BIG = path.join(MOD_ROOT, 'gfx/interface/country_mission_view_bg_huge.dds');
if (fs.existsSync(BIG)) {
  console.log(`use   mod gfx/interface large texture: ${path.basename(BIG)}`);
  realTargets.push({ label: 'mod gfx/interface (large)', file: BIG });
} else {
  console.log('skip  large texture: not present');
}

let realDecoded = 0;
let realPng = 0;
for (const target of realTargets) {
  const name = path.basename(target.file);
  const buf = fs.readFileSync(target.file);
  const header = dds.parseDdsHeader(buf);
  if (!header) {
    check(`real ${name} header parses`, false, true);
    console.log(`FAIL  ${target.file}: header did not parse`);
    continue;
  }

  const t0 = process.hrtime.bigint();
  const decoded = dds.decodeDds(buf);
  const decodeMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const t1 = process.hrtime.bigint();
  const png = dds.ddsToPng(buf);
  const totalMs = Number(process.hrtime.bigint() - t1) / 1e6;

  const outPath = path.join(OUT_DIR, safeName(target.label, target.file));
  if (png) fs.writeFileSync(outPath, png);

  console.log(`file   ${target.file}`);
  console.log(`       header ${header.width}x${header.height} fourCC=${header.fourCC || '(none)'} format=${header.format} mips=${header.mipmaps} alpha=${header.hasAlpha}`);
  console.log(`       pixels ${decoded ? decoded.rgba.length / 4 : 0}  decode ${decodeMs.toFixed(1)} ms  ddsToPng ${totalMs.toFixed(1)} ms`);
  console.log(`       png    ${png ? outPath : '(none)'}  ${png ? png.length : 0} bytes`);

  checkTrue(`real ${name} decoded`, decoded !== null);
  check(`real ${name} pixel count`, decoded && decoded.rgba.length, header.width * header.height * 4);
  check(`real ${name} dimensions`, decoded && `${decoded.width}x${decoded.height}`, `${header.width}x${header.height}`);
  checkTrue(`real ${name} png produced`, png !== null);
  checkTrue(`real ${name} png signature`, png && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  if (png) {
    const info = readPngChunks(png);
    check(`real ${name} IHDR dimensions`, `${info.chunks[0].data.readUInt32BE(0)}x${info.chunks[0].data.readUInt32BE(4)}`, `${header.width}x${header.height}`);
    checkTrue(`real ${name} chunk CRCs valid`, info.crcOk);
    // Round-trip the biggest surface through inflate + compare, proving the
    // PNG really carries the decoded pixels.
    const raw = zlib.inflateSync(info.chunks[1].data);
    let same = raw.length === (header.width * 4 + 1) * header.height;
    if (same && decoded) {
      const stride = header.width * 4;
      for (let y = 0; y < header.height && same; y++) {
        if (Buffer.compare(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), decoded.rgba.subarray(y * stride, (y + 1) * stride)) !== 0) same = false;
      }
    }
    checkTrue(`real ${name} PNG pixels match decode`, same);
    realPng++;
  }
  // Well under the 2 s budget: this is the headline performance requirement.
  checkTrue(`real ${name} decode under 2000 ms (${decodeMs.toFixed(1)} ms)`, decodeMs < 2000);
  realDecoded++;
}

console.log(`\nreal files decoded: ${realDecoded} (png written: ${realPng})`);
if (realDecoded === 0) {
  fail++;
  console.log('FAIL no real .dds file could be decoded — the real-file path is unproven');
}

console.log(`\nDDS TEST: ${pass}/${pass + fail} assertions passed`);
if (fail > 0) {
  console.log(`${fail} assertion(s) failed`);
  process.exitCode = 1;
}
