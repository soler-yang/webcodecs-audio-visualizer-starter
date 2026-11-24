/**
 * Pure-JS EBML Segment > Info > Duration injector for Chromium MediaRecorder WebM blobs.
 *
 * Chromium's MediaRecorder writes WebM files with an omitted Duration element inside Segment > Info,
 * causing seek bars, FFprobe, and NLE timelines to report "N/A" or Infinity duration.
 * This zero-dependency patcher injects (or updates) the 8-byte IEEE-754 Float64 EBML Duration
 * element (0x4489) and adjusts parent Info/Segment VINT sizes in-memory.
 */
import { concatBytes } from "./muxer-mov-png.js";

export function patchWebmDuration(bytes, durationMs) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || !Number.isFinite(durationMs) || durationMs <= 0) return bytes;
  const readVint = (pos) => {
    const b0 = bytes[pos];
    if (!b0) return null;
    let len = 1, mask = 0x80;
    while (len <= 8 && !(b0 & mask)) { len++; mask >>= 1; }
    if (len > 8 || pos + len > bytes.length) return null;
    let val = b0 & (mask - 1), allOnes = val === mask - 1;
    for (let i = 1; i < len; i++) { val = val * 256 + bytes[pos + i]; if (bytes[pos + i] !== 0xff) allOnes = false; }
    return { val, len, unknown: allOnes };
  };
  const writeVint = (val, len) => {
    const out = new Uint8Array(len);
    for (let i = len - 1, v = val; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
    out[0] |= 1 << (8 - len);
    return out;
  };
  let infoPos = -1;
  for (let i = 0, lim = Math.min(bytes.length - 12, 8192); i < lim; i++) {
    if (bytes[i] === 0x15 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0xa9 && bytes[i + 3] === 0x66) { infoPos = i; break; }
  }
  if (infoPos === -1) return bytes;
  const sizePos = infoPos + 4, infoSize = readVint(sizePos);
  if (!infoSize || infoSize.unknown) return bytes;
  const bodyStart = sizePos + infoSize.len, bodyEnd = bodyStart + infoSize.val;
  if (bodyEnd > bytes.length) return bytes;

  let scaleNs = 1e6, durPos = -1, durLen = 0;
  for (let p = bodyStart; p < bodyEnd - 2; ) {
    let idLen = 1, idMask = 0x80, id = 0;
    while (idLen <= 4 && !(bytes[p] & idMask)) { idLen++; idMask >>= 1; }
    if (idLen > 4 || p + idLen >= bodyEnd) break;
    for (let i = 0; i < idLen; i++) id = id * 256 + bytes[p + i];
    const el = readVint(p + idLen);
    if (!el || el.unknown) break;
    const dPos = p + idLen + el.len;
    if (dPos + el.val > bodyEnd) break;
    if (id === 0x2ad7b1 && el.val >= 1 && el.val <= 8) {
      let s = 0;
      for (let i = 0; i < el.val; i++) s = s * 256 + bytes[dPos + i];
      if (s > 0) scaleNs = s;
    } else if (id === 0x4489 && (el.val === 4 || el.val === 8)) { durPos = dPos; durLen = el.val; }
    p = dPos + el.val;
  }

  const ticks = (durationMs * 1e6) / scaleNs;
  if (durPos !== -1) {
    const out = bytes.slice(), dv = new DataView(out.buffer, out.byteOffset + durPos, durLen);
    if (durLen === 8) dv.setFloat64(0, ticks); else dv.setFloat32(0, ticks);
    return out;
  }

  const durEl = new Uint8Array(11);
  durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88;
  new DataView(durEl.buffer).setFloat64(3, ticks);
  const newVal = infoSize.val + 11;
  let newLen = infoSize.len;
  while (newLen < 8 && newVal >= Math.pow(2, 7 * newLen) - 1) newLen++;
  const delta = (newLen - infoSize.len) + 11;
  const out = concatBytes([bytes.subarray(0, sizePos), writeVint(newVal, newLen), bytes.subarray(bodyStart, bodyEnd), durEl, bytes.subarray(bodyEnd)]);

  for (let i = 0; i < infoPos - 4; i++) {
    if (out[i] === 0x18 && out[i + 1] === 0x53 && out[i + 2] === 0x80 && out[i + 3] === 0x67) {
      const seg = readVint(i + 4);
      if (seg && !seg.unknown && seg.val + delta < Math.pow(2, 7 * seg.len) - 1) out.set(writeVint(seg.val + delta, seg.len), i + 4);
      break;
    }
  }
  return out;
}
