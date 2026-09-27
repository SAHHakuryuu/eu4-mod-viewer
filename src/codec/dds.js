'use strict';
/**
 * EU4 `.dds` texture codec — decoder to raw RGBA + a built-in PNG encoder.
 *
 * EU4 ships every interface texture (event pictures, advisor portraits, icons,
 * flags, terrain) as DirectDraw Surface files, and a browser cannot render one.
 * This module turns a `.dds` Buffer into RGBA bytes and then into a real PNG, so
 * the viewer can serve a preview with nothing but Node's own `zlib`.
 *
 * Supported on decode:
 *
 *   DXT1 / BC1   8 B per 4x4 block — two RGB565 endpoints + 32 index bits.
 *                When c0 <= c1 the block is 3-colour + 1-bit punch-through
 *                alpha (index 3 is fully transparent); otherwise 4-colour.
 *   DXT3 / BC2  16 B per block — 8 B of explicit 4-bit alpha, then a colour
 *                block that is always read in 4-colour mode.
 *   DXT5 / BC3  16 B per block — 8 B of interpolated alpha (two 8-bit
 *                endpoints + 16 x 3-bit indices), then a 4-colour block.
 *   uncompressed dwFourCC == 0 with dwRGBBitCount 32 (BGRA byte order) or
 *                24 (BGR). Any sensible bit mask layout is honoured, not just
 *                the standard 0x00ff0000 / 0x0000ff00 / 0x000000ff pair, so
 *                odd RGBA-ordered exports decode correctly too.
 *
 * Everything else (DX10, ATI2/BC5, 16-bit, ...) makes `decodeDds` return null.
 * The input is untrusted game/mod data: no path through this module throws, and
 * dimensions are validated before a single byte is allocated.
 *
 * Interpolation convention: the block decoders use integer division (floor),
 * which is what the reference decoders (stb_image, squish) do, so output
 * matches what the engine and every other DDS tool produce.
 */

const zlib = require('zlib');

const DDS_MAGIC = 0x20534444; // 'DDS '
const DDS_HEADER_OFFSET = 4; // magic is a separate 4-byte field
const DDS_HEADER_SIZE = 124;
const DDS_PIXELFORMAT_OFFSET = DDS_HEADER_OFFSET + 72; // ddspf inside the header
const DDS_DATA_OFFSET = DDS_HEADER_OFFSET + DDS_HEADER_SIZE; // 128
const DDS_DX10_HEADER_SIZE = 20; // extended header that follows a 'DX10' fourCC

// DDS_HEADER.dwFlags
const DDSD_PITCH = 0x8;
const DDSD_LINEARSIZE = 0x80000;

// DDS_PIXELFORMAT.dwFlags
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;

// Untrusted-input guards. EU4's widest interface strips are ~4k pixels across,
// so these caps are generous while still refusing to allocate gigabytes for a
// hostile file.
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;

// On a little-endian host the four RGBA bytes of one pixel are exactly one
// Uint32 (r in the low byte), so a block decoder can store a pixel with a
// single assignment instead of four. This is what keeps block decoding fast.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const ALPHA_KEEP_MASK = LITTLE_ENDIAN ? 0x00ffffff : 0xffffff00;
const ALPHA_SHIFT = LITTLE_ENDIAN ? 24 : 0;

/** Pack r/g/b/a (each 0-255) into the host's native RGBA word order. */
function packRgba(r, g, b, a) {
  return LITTLE_ENDIAN
    ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/** Four-character code from a header field, '' when the field is zero. */
function fourCcToString(value) {
  if (value === 0) return '';
  return String.fromCharCode(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

/** Number of set bits (used to size non-8-bit colour channels). */
function popcount(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/** Index of the lowest set bit; masks are contiguous so this is the shift. */
function ctz(v) {
  if (v === 0) return 0;
  return 31 - Math.clz32(v & -v);
}

/**
 * Parse the 4-byte magic plus the 124-byte DDS_HEADER.
 *
 * Returns a description of the surface, or null when the buffer is not a
 * plausible DDS file. `format` is a human label ('DXT5', 'BGRA8', ...) while
 * `fourCC` is the raw 4-character code ('' for uncompressed surfaces).
 */
function parseDdsHeader(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) return null;
  // Accept a plain Uint8Array (or a view into a larger ArrayBuffer) by wrapping
  // it without copying, so the readUInt32LE calls below are always available.
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < DDS_DATA_OFFSET) return null;
  if (buf.readUInt32LE(0) !== DDS_MAGIC) return null;

  const dwSize = buf.readUInt32LE(DDS_HEADER_OFFSET);
  if (dwSize !== DDS_HEADER_SIZE) return null;

  const dwFlags = buf.readUInt32LE(DDS_HEADER_OFFSET + 4);
  const height = buf.readUInt32LE(DDS_HEADER_OFFSET + 8);
  const width = buf.readUInt32LE(DDS_HEADER_OFFSET + 12);
  const pitchOrLinearSize = buf.readUInt32LE(DDS_HEADER_OFFSET + 16);
  const mipMapCount = buf.readUInt32LE(DDS_HEADER_OFFSET + 24);

  const pfFlags = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 4);
  const fourCCValue = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 8);
  const rgbBitCount = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 12);
  const rBitMask = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 16);
  const gBitMask = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 20);
  const bBitMask = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 24);
  const aBitMask = buf.readUInt32LE(DDS_PIXELFORMAT_OFFSET + 28);

  // Guard against absurd surfaces before anything allocates memory.
  if (!(width > 0) || !(height > 0)) return null;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  if (width * height > MAX_PIXELS) return null;

  const fourCC = fourCcToString(fourCCValue);
  const isFourCc = (pfFlags & DDPF_FOURCC) !== 0;

  let format;
  let hasAlpha;
  if (isFourCc && fourCC) {
    format = fourCC;
    // Every block format we accept carries alpha of some kind; DXT1 can always
    // switch to punch-through when c0 <= c1, so it counts as alpha-capable.
    hasAlpha = fourCC === 'DXT1' || fourCC === 'DXT3' || fourCC === 'DXT5';
  } else if ((pfFlags & (DDPF_RGB | DDPF_LUMINANCE)) !== 0 || rgbBitCount > 0) {
    hasAlpha = aBitMask !== 0 && (pfFlags & DDPF_ALPHAPIXELS) !== 0;
    // The mask layout tells us the on-disk channel order (DDS is blue-first by
    // convention, but exporters do sometimes emit RGBA order instead).
    const rFirst = rBitMask !== 0 && bBitMask !== 0 && rBitMask < bBitMask;
    let suffix;
    if (rgbBitCount === 32) suffix = hasAlpha ? 'BGRA8' : 'BGRX8';
    else if (rgbBitCount === 24) suffix = 'BGR8';
    else suffix = `BGR${rgbBitCount}`;
    format = rFirst ? suffix.replace('BGR', 'RGB') : suffix;
  } else {
    format = 'UNKNOWN';
    hasAlpha = false;
  }

  return {
    width,
    height,
    format,
    mipmaps: mipMapCount > 0 ? mipMapCount : 1,
    fourCC,
    hasAlpha,
    // Extras that the decode path (and the test harness) finds useful.
    rgbBitCount,
    masks: { r: rBitMask, g: gBitMask, b: bBitMask, a: aBitMask },
    pixelFormatFlags: pfFlags,
    headerFlags: dwFlags,
    pitchOrLinearSize,
    hasLinearSize: (dwFlags & DDSD_LINEARSIZE) !== 0,
    hasPitch: (dwFlags & DDSD_PITCH) !== 0,
    dataOffset: DDS_DATA_OFFSET + (fourCC === 'DX10' ? DDS_DX10_HEADER_SIZE : 0),
  };
}

/** Expand a 5:6:5 RGB565 word to 8-bit channels by bit replication. */
function expand565(c) {
  const r5 = (c >>> 11) & 0x1f;
  const g6 = (c >>> 5) & 0x3f;
  const b5 = c & 0x1f;
  return [
    (r5 << 3) | (r5 >>> 2),
    (g6 << 2) | (g6 >>> 4),
    (b5 << 3) | (b5 >>> 2),
  ];
}

/**
 * Decode one BC1/DXT1 colour block into four packed RGBA words.
 * `pal` is a caller-owned Uint32Array(4) reused across blocks.
 *
 * DXT3/DXT5 reuse this colour block but never the punch-through rule, so they
 * pass `forceFourColour` — in those formats a c0 <= c1 pair still means the
 * two 1/3-interpolated colours, not a 3-colour block with transparent black.
 */
function bc1Palette(src, offset, pal, forceFourColour) {
  const c0 = src.readUInt16LE(offset);
  const c1 = src.readUInt16LE(offset + 2);
  const e0 = expand565(c0);
  const e1 = expand565(c1);
  pal[0] = packRgba(e0[0], e0[1], e0[2], 255);
  pal[1] = packRgba(e1[0], e1[1], e1[2], 255);
  if (forceFourColour || c0 > c1) {
    // 4-colour mode: two interpolated endpoints, all opaque.
    pal[2] = packRgba(
      ((2 * e0[0] + e1[0]) / 3) | 0,
      ((2 * e0[1] + e1[1]) / 3) | 0,
      ((2 * e0[2] + e1[2]) / 3) | 0,
      255,
    );
    pal[3] = packRgba(
      ((e0[0] + 2 * e1[0]) / 3) | 0,
      ((e0[1] + 2 * e1[1]) / 3) | 0,
      ((e0[2] + 2 * e1[2]) / 3) | 0,
      255,
    );
    return;
  }
  // 3-colour mode: midpoint plus a fully transparent index 3 (punch-through).
  pal[2] = packRgba(
    ((e0[0] + e1[0]) / 2) | 0,
    ((e0[1] + e1[1]) / 2) | 0,
    ((e0[2] + e1[2]) / 2) | 0,
    255,
  );
  pal[3] = 0; // transparent black
}

/**
 * Shared block walk. For every 4x4 block the caller's `readBlock` fills `pal`
 * (four packed RGBA words), writes per-pixel alpha into `alphas` when the
 * format has it, and returns the 32-bit colour index field.
 */
function walkBlocks(src, header, out32, needsPerPixelAlpha, readBlock) {
  const width = header.width;
  const height = header.height;
  const blocksX = (width + 3) >>> 2;
  const blocksY = (height + 3) >>> 2;
  const pal = new Uint32Array(4);
  const alphas = needsPerPixelAlpha ? new Uint8Array(16) : null;
  let p = header.dataOffset;

  for (let by = 0; by < blocksY; by++) {
    const y0 = by << 2;
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx << 2;
      const bits = readBlock(src, p, pal, alphas);
      p += readBlock.size;

      // Crop to the real surface size: partial edge blocks are decoded in full
      // and simply not written past width/height.
      const rows = Math.min(4, height - y0);
      const cols = Math.min(4, width - x0);
      for (let y = 0; y < rows; y++) {
        let di = (y0 + y) * width + x0;
        const rowBits = (bits >>> (y << 3)) & 0xff;
        for (let x = 0; x < cols; x++, di++) {
          const ci = (rowBits >>> (x << 1)) & 3;
          if (alphas === null) {
            out32[di] = pal[ci];
          } else {
            out32[di] = (pal[ci] & ALPHA_KEEP_MASK) | (alphas[y * 4 + x] << ALPHA_SHIFT);
          }
        }
      }
    }
  }
}

/** DXT1/BC1: 8 bytes per block. */
function decodeBc1(src, header, out32) {
  const readBc1 = function readBc1(s, p, pal) {
    bc1Palette(s, p, pal);
    return s.readUInt32LE(p + 4);
  };
  readBc1.size = 8;
  walkBlocks(src, header, out32, false, readBc1);
}

/** DXT3/BC2: 8 bytes of 4-bit alpha followed by an always-4-colour block. */
function decodeBc2(src, header, out32) {
  const readBc2 = function readBc2(s, p, pal, alphas) {
    // 16 nibbles, low nibble first; expand 0-15 to 0-255.
    for (let i = 0; i < 16; i++) {
      const nib = (s[p + (i >> 1)] >>> ((i & 1) << 2)) & 0x0f;
      alphas[i] = nib * 17;
    }
    bc1Palette(s, p + 8, pal, true);
    return s.readUInt32LE(p + 12);
  };
  readBc2.size = 16;
  walkBlocks(src, header, out32, true, readBc2);
}

/** DXT5/BC3: 8 bytes of interpolated alpha followed by a 4-colour block. */
function decodeBc3(src, header, out32) {
  // The 8-value ramp derived from the two endpoints, rebuilt per block.
  const ramp = new Uint8Array(8);
  const readBc3 = function readBc3(s, p, pal, alphas) {
    const a0 = s[p];
    const a1 = s[p + 1];
    ramp[0] = a0;
    ramp[1] = a1;
    if (a0 > a1) {
      // 8-value ramp between the two endpoints.
      ramp[2] = ((6 * a0 + 1 * a1) / 7) | 0;
      ramp[3] = ((5 * a0 + 2 * a1) / 7) | 0;
      ramp[4] = ((4 * a0 + 3 * a1) / 7) | 0;
      ramp[5] = ((3 * a0 + 4 * a1) / 7) | 0;
      ramp[6] = ((2 * a0 + 5 * a1) / 7) | 0;
      ramp[7] = ((1 * a0 + 6 * a1) / 7) | 0;
    } else {
      // 6-value ramp with hard 0 and 255 at the top of the table.
      ramp[2] = ((4 * a0 + 1 * a1) / 5) | 0;
      ramp[3] = ((3 * a0 + 2 * a1) / 5) | 0;
      ramp[4] = ((2 * a0 + 3 * a1) / 5) | 0;
      ramp[5] = ((1 * a0 + 4 * a1) / 5) | 0;
      ramp[6] = 0;
      ramp[7] = 255;
    }
    // 48 bits of 3-bit indices, little-endian bit order. Reading one byte past
    // the alpha block is safe: the colour block that follows supplies it.
    for (let i = 0; i < 16; i++) {
      const bit = i * 3;
      const at = p + 2 + (bit >> 3);
      const idx = ((s[at] | (s[at + 1] << 8)) >>> (bit & 7)) & 7;
      alphas[i] = ramp[idx];
    }
    bc1Palette(s, p + 8, pal, true);
    return s.readUInt32LE(p + 12);
  };
  readBc3.size = 16;
  walkBlocks(src, header, out32, true, readBc3);
}

/**
 * Decode an uncompressed surface (dwFourCC == 0, 32 or 24 bpp) using the file's
 * own bit masks, so non-standard channel layouts still come out correct.
 */
function decodeUncompressed(src, header, rgba) {
  const { r, g, b, a } = header.masks;
  const inBytes = header.rgbBitCount >> 3; // 4 for BGRA, 3 for BGR
  if (inBytes !== 4 && inBytes !== 3) return false;

  const rShift = ctz(r);
  const gShift = ctz(g);
  const bShift = ctz(b);
  const aShift = ctz(a);
  const rBits = popcount(r);
  const gBits = popcount(g);
  const bBits = popcount(b);
  const aBits = popcount(a);

  // Fast path: the everyday 8-bit-per-channel layout needs no scaling at all.
  const plain =
    rBits === 8 && gBits === 8 && bBits === 8 && (aBits === 8 || aBits === 0);

  // Honour an explicit row pitch, which is what DDSD_PITCH is there for.
  const tightPitch = header.width * inBytes;
  const rowPitch =
    header.hasPitch && header.pitchOrLinearSize >= tightPitch
      ? header.pitchOrLinearSize
      : tightPitch;
  const needed = rowPitch * (header.height - 1) + tightPitch;
  if (header.dataOffset + needed > src.length) return false;

  for (let y = 0; y < header.height; y++) {
    let sp = header.dataOffset + y * rowPitch;
    let dp = y * header.width * 4;
    for (let x = 0; x < header.width; x++, sp += inBytes, dp += 4) {
      const word = inBytes === 4
        ? src.readUInt32LE(sp)
        : src[sp] | (src[sp + 1] << 8) | (src[sp + 2] << 16);
      if (plain) {
        rgba[dp] = (word & r) >>> rShift;
        rgba[dp + 1] = (word & g) >>> gShift;
        rgba[dp + 2] = (word & b) >>> bShift;
        rgba[dp + 3] = aBits === 8 ? (word & a) >>> aShift : 255;
      } else {
        rgba[dp] = scaleChannel((word & r) >>> rShift, rBits);
        rgba[dp + 1] = scaleChannel((word & g) >>> gShift, gBits);
        rgba[dp + 2] = scaleChannel((word & b) >>> bShift, bBits);
        rgba[dp + 3] = aBits === 0 ? 255 : scaleChannel((word & a) >>> aShift, aBits);
      }
    }
  }
  return true;
}

/**
 * Scale a channel of `bits` width up to 8 bits, rounding to nearest.
 * A zero-width mask means the channel is absent, so it contributes nothing.
 */
function scaleChannel(value, bits) {
  if (bits >= 8) return value & 0xff;
  if (bits === 0) return 0;
  const max = (1 << bits) - 1;
  return ((value * 255 + (max >> 1)) / max) | 0;
}

/**
 * Decode a `.dds` Buffer to `{ width, height, rgba }`.
 *
 * `rgba` is a freshly allocated `width * height * 4` Buffer. Returns null for
 * anything unsupported, truncated or malformed — callers never see a throw.
 */
function decodeDds(buf) {
  try {
    const header = parseDdsHeader(buf);
    if (!header) return null;

    const pixels = header.width * header.height;
    const rgba = Buffer.alloc(pixels * 4);
    // A Uint32 view lets the block decoders store whole pixels per assignment.
    const out32 = new Uint32Array(rgba.buffer, rgba.byteOffset, pixels);

    const src = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);

    if (header.fourCC === 'DXT1') {
      if (src.length < header.dataOffset + blocksSize(header, 8)) return null;
      decodeBc1(src, header, out32);
    } else if (header.fourCC === 'DXT3') {
      if (src.length < header.dataOffset + blocksSize(header, 16)) return null;
      decodeBc2(src, header, out32);
    } else if (header.fourCC === 'DXT5') {
      if (src.length < header.dataOffset + blocksSize(header, 16)) return null;
      decodeBc3(src, header, out32);
    } else if (header.fourCC === '') {
      if (!decodeUncompressed(src, header, rgba)) return null;
    } else {
      // DX10, ATI2/BC5, BC4, DXT2/DXT4 and friends: deliberately unsupported.
      return null;
    }

    return { width: header.width, height: header.height, rgba };
  } catch {
    return null;
  }
}

/** Total byte size of mipmap level 0 for a block-compressed surface. */
function blocksSize(header, blockBytes) {
  const blocksX = (header.width + 3) >>> 2;
  const blocksY = (header.height + 3) >>> 2;
  return blocksX * blocksY * blockBytes;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable = null;

/** Build (once) the standard CRC-32 table used by every PNG chunk. */
function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  crcTable = table;
  return table;
}

/** CRC-32 over `buf`, as PNG specifies (reflected, init/xorout 0xffffffff). */
function crc32(buf) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Serialise one PNG chunk: length, type, payload, CRC. */
function pngChunk(type, payload) {
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.write(type, 4, 'ascii');
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length);
  return out;
}

/**
 * Encode raw 8-bit RGBA pixels as a PNG Buffer (colour type 6, no interlace).
 *
 * Every scanline is prefixed with filter type 0 (None): these are already
 * tightly packed pixels and the extra pass cost is not worth the bytes for a
 * preview image. `rgba` must hold `width * height * 4` bytes.
 */
function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError('encodePng: width and height must be positive integers');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new RangeError('encodePng: image too large');
  }
  const stride = width * 4;
  const pixels = Buffer.isBuffer(rgba)
    ? rgba
    : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  if (pixels.length < stride * height) {
    throw new RangeError('encodePng: rgba buffer is too small');
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  // Fast path: one preallocated scanline buffer, one memcpy per row, then a
  // single deflate pass — no per-row intermediate arrays or string building.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 0; // filter type 0 (None)
    pixels.copy(raw, dst + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * One-shot `.dds` -> PNG. Returns null (never throws) for anything the decoder
 * cannot handle, which is what the HTTP layer wants for arbitrary game files.
 */
function ddsToPng(buf) {
  try {
    // Fast path: reject unsupported/oversized surfaces from the header alone,
    // before decoding allocates a single pixel.
    const header = parseDdsHeader(buf);
    if (!header) return null;
    if (header.fourCC !== '' && header.fourCC !== 'DXT1'
      && header.fourCC !== 'DXT3' && header.fourCC !== 'DXT5') {
      return null;
    }
    const decoded = decodeDds(buf);
    if (!decoded) return null;
    return encodePng(decoded.width, decoded.height, decoded.rgba);
  } catch {
    return null;
  }
}

module.exports = {
  parseDdsHeader,
  decodeDds,
  encodePng,
  ddsToPng,
};
