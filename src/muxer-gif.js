/**
 * Pure-JS GIF89a Transparent Animated GIF Encoder (~4.5 KB, zero external dependencies).
 * Uses a clean 6x6x6 RGB web-cube + 39 studio grays + reserved index 255 transparency,
 * variable-width LZW compression, Netscape 2.0 infinite loop, and disposal=2 for crisp alpha.
 */

const PALETTE = new Uint8Array(256 * 3);
{
  let idx = 0;
  // 0..215: 6x6x6 uniform color cube
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        PALETTE[idx * 3] = Math.round((r * 255) / 5);
        PALETTE[idx * 3 + 1] = Math.round((g * 255) / 5);
        PALETTE[idx * 3 + 2] = Math.round((b * 255) / 5);
        idx++;
      }
    }
  }
  // 216..254: 39 fine luminance & warm studio shades
  for (let i = 0; i < 39; i++) {
    const v = Math.round((i * 255) / 38);
    PALETTE[idx * 3] = v;
    PALETTE[idx * 3 + 1] = v;
    PALETTE[idx * 3 + 2] = v;
    idx++;
  }
  // 255: transparent key color
  PALETTE[255 * 3] = 0;
  PALETTE[255 * 3 + 1] = 0;
  PALETTE[255 * 3 + 2] = 0;
}

export function quantizeRgbaToIndices(rgba, width, height, transparent = true) {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = rgba[o + 3];
    if (transparent && a < 96) {
      out[i] = 255;
      continue;
    }
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    // Fast perceptual snap to 6x6x6 cube (or fine gray if neutral)
    if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10) {
      out[i] = 216 + Math.round(((r + g + b) / 3) * 38 / 255);
    } else {
      const ri = Math.round((r * 5) / 255);
      const gi = Math.round((g * 5) / 255);
      const bi = Math.round((b * 5) / 255);
      out[i] = ri * 36 + gi * 6 + bi;
    }
  }
  return out;
}

function lzwEncode(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out = [minCodeSize];
  const sub = new Uint8Array(255);
  let subLen = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const flushSub = () => {
    if (subLen > 0) {
      out.push(subLen);
      for (let i = 0; i < subLen; i++) out.push(sub[i]);
      subLen = 0;
    }
  };
  const emit = (code, bits) => {
    bitBuf |= code << bitCount;
    bitCount += bits;
    while (bitCount >= 8) {
      sub[subLen++] = bitBuf & 0xff;
      bitBuf >>= 8;
      bitCount -= 8;
      if (subLen === 255) flushSub();
    }
  };

  // Fixed flat hash table for speed (zero GC churn)
  const TABLE_SIZE = 5003;
  const keys = new Int32Array(TABLE_SIZE);
  const vals = new Int16Array(TABLE_SIZE);
  const resetTable = () => keys.fill(-1);

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  resetTable();
  emit(clearCode, codeSize);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    let h = ((key * 2654435761) >>> 0) % TABLE_SIZE;
    let found = -1;
    while (keys[h] !== -1) {
      if (keys[h] === key) {
        found = vals[h];
        break;
      }
      h = (h + 1) % TABLE_SIZE;
    }
    if (found !== -1) {
      prefix = found;
    } else {
      emit(prefix, codeSize);
      if (nextCode < 4096) {
        keys[h] = key;
        vals[h] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode, codeSize);
        resetTable();
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      }
      prefix = k;
    }
  }
  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (bitCount > 0) {
    sub[subLen++] = bitBuf & 0xff;
  }
  flushSub();
  out.push(0); // block terminator
  return new Uint8Array(out);
}

export class GifEncoder {
  constructor(width, height, { fps = 15, transparent = true } = {}) {
    this.width = width;
    this.height = height;
    this.delayCs = Math.max(2, Math.round(100 / fps));
    this.transparent = transparent;
    this.chunks = [];

    // Header + Logical Screen Descriptor (Global Color Table 256 colors)
    const header = new Uint8Array(13);
    header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
    const dv = new DataView(header.buffer);
    dv.setUint16(6, width, true);
    dv.setUint16(8, height, true);
    header[10] = 0xf7; // GCT flag=1, color res=7, sort=0, size=7 (256 colors)
    header[11] = transparent ? 255 : 0;
    header[12] = 0;
    this.chunks.push(header, PALETTE);

    // Netscape 2.0 Application Extension (infinite loop)
    this.chunks.push(new Uint8Array([
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
      0x03, 0x01, 0x00, 0x00, 0x00
    ]));
  }

  addFrame(rgba) {
    const indices = quantizeRgbaToIndices(rgba, this.width, this.height, this.transparent);
    // Graphic Control Extension (disposal=2 restore to background when transparent)
    const gce = new Uint8Array(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 0x04;
    gce[3] = this.transparent ? 0x09 : 0x04; // disposal=2 + transparent flag=1
    new DataView(gce.buffer).setUint16(4, this.delayCs, true);
    gce[6] = 255; // transparent color index
    gce[7] = 0;

    // Image Descriptor
    const desc = new Uint8Array(10);
    desc[0] = 0x2c;
    const ddv = new DataView(desc.buffer);
    ddv.setUint16(5, this.width, true);
    ddv.setUint16(7, this.height, true);
    desc[9] = 0;

    this.chunks.push(gce, desc, lzwEncode(indices, 8));
  }

  finish() {
    this.chunks.push(new Uint8Array([0x3b])); // GIF trailer
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}
