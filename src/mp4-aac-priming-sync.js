/**
 * Pure-JS WebCodecs MP4 AAC Priming Delay Probe & ISO/IEC 14496-12 Edit-List Patcher.
 *
 * Problem:
 * Chromium's hardware/CoreAudio/MediaFoundation WebCodecs AAC encoder emits ~2,112 samples
 * (~44 ms at 48 kHz) of encoder priming silence before sample 0. Without an ISO BMFF `edts`/`elst`
 * edit list and Apple TN2258 `sgpd`/`sbgp` (`roll` = -1) sample group, beats and audio-reactive
 * frames drift +44 ms out of sync in Chrome, FFmpeg, Premiere Pro, and Apple AVFoundation.
 *
 * Solution:
 * 1. `measureAacPrimingSamples()` runs a ~12 ms AudioEncoder -> AudioDecoder cross-correlation
 *    probe once per (sampleRate, channels) to measure the host browser's exact priming sample count.
 * 2. `patchMp4AudioEditList()` injects `edts`/`elst` + `sgpd`/`sbgp` ('roll' = -1) into the
 *    audio track (`soun`), clamps `mvhd`/`tkhd` durations to trim trailing AAC frame padding, and
 *    shifts all `stco`/`co64` chunk offsets when `moov` precedes `mdat` (`fastStart`).
 */
import { atom, concatBytes, str4, u16, u32 } from "./muxer-mov-png.js";

const aacPrimingCache = new Map();

/**
 * Dynamically measure browser WebCodecs AAC encoder priming delay once per (sampleRate, channels)
 * via a ~12 ms AudioEncoder -> AudioDecoder cross-correlation probe.
 * Returns exact priming sample offset (e.g. 2112 on macOS CoreAudio / Chrome) or `null` if unavailable.
 */
export async function measureAacPrimingSamples(sr, ch = 2, bitrate = 192_000) {
  const key = `${sr}:${ch}`;
  if (aacPrimingCache.has(key)) return aacPrimingCache.get(key);
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return null;
  try {
    const N = 8192, B0 = 2048, BL = 1024;
    const f1 = Math.min(1000, sr * 0.15), f2 = Math.min(2300, sr * 0.3);
    const ref = new Float32Array(N);
    let eng = 0;
    for (let i = 0; i < BL; i++) {
      const v = (0.5 - 0.5 * Math.cos((6.2831853 * i) / (BL - 1))) * 0.6 * (Math.sin((6.2831853 * f1 * i) / sr) + 0.5 * Math.sin((6.2831853 * f2 * i) / sr));
      ref[B0 + i] = v;
      if (!(i & 1)) eng += v * v;
    }
    const planar = new Float32Array(N * ch);
    for (let c = 0; c < ch; c++) planar.set(ref, c * N);

    const chunks = [];
    let desc = null;
    const enc = new AudioEncoder({
      output: (k, m) => {
        if (m?.decoderConfig?.description) desc = m.decoderConfig.description;
        const b = new Uint8Array(k.byteLength);
        k.copyTo(b);
        chunks.push({ type: k.type, timestamp: k.timestamp, duration: k.duration, data: b });
      },
      error: () => {}
    });
    enc.configure({ codec: "mp4a.40.2", numberOfChannels: ch, sampleRate: sr, bitrate });
    const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: N, numberOfChannels: ch, timestamp: 0, data: planar });
    enc.encode(ad);
    ad.close();
    await enc.flush();
    enc.close();

    const parts = [];
    let tot = 0;
    const dec = new AudioDecoder({
      output: (d) => {
        const c0 = new Float32Array(d.numberOfFrames);
        d.copyTo(c0, { planeIndex: 0, format: "f32-planar" });
        parts.push(c0);
        tot += c0.length;
        d.close();
      },
      error: () => {}
    });
    dec.configure({ codec: "mp4a.40.2", numberOfChannels: ch, sampleRate: sr, ...(desc ? { description: desc } : {}) });
    for (const c of chunks) dec.decode(new EncodedAudioChunk(c));
    await dec.flush();
    dec.close();

    const all = new Float32Array(tot);
    let pos = 0;
    for (const p of parts) { all.set(p, pos); pos += p.length; }
    let bestLag = 0, best = -1e9;
    for (let lag = 0, lim = Math.min(4096, tot - B0 - BL); lag <= lim; lag++) {
      let s = 0;
      for (let i = 0; i < BL; i += 2) s += all[B0 + lag + i] * ref[B0 + i];
      if (s > best) { best = s; bestLag = lag; }
    }
    const res = best > eng * 0.25 ? bestLag : null;
    aacPrimingCache.set(key, res);
    return res;
  } catch {
    return null;
  }
}

/**
 * Inject ISO/IEC 14496-12 `edts`/`elst` + Apple TN2258 `sgpd`/`sbgp` ('roll' = -1) into an MP4
 * audio track (`soun`) so FFmpeg, Chrome, Premiere Pro, and Apple AVFoundation skip exact AAC
 * priming silence and trim trailing encoder padding.
 *
 * Automatically shifts `stco`/`co64` chunk offsets across all tracks when `moov` precedes `mdat`.
 */
export function patchMp4AudioEditList(bytes, primingSamples, audioDurSec, videoDurSec, sampleRate) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 64 || !Number.isFinite(primingSamples) || primingSamples < 0 || !Number.isFinite(audioDurSec) || audioDurSec <= 0) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const find = (s, e, name) => {
    for (let p = s; p + 8 <= e; ) {
      const sz = dv.getUint32(p);
      if (sz < 8 || p + sz > e) break;
      if (tag(bytes, p + 4) === name) return { s: p, e: p + sz };
      p += sz;
    }
    return null;
  };
  const moov = find(0, bytes.length, "moov"), mdat = find(0, bytes.length, "mdat");
  const mvhd = moov && find(moov.s + 8, moov.e, "mvhd");
  if (!moov || !mdat || !mvhd) return bytes;
  const mv = bytes[mvhd.s + 8], mTs = dv.getUint32(mvhd.s + (mv === 1 ? 28 : 20));
  const mDur = Math.max(1, Math.round(Math.max(videoDurSec || audioDurSec, audioDurSec) * mTs));
  const aSeg = Math.max(1, Math.round(audioDurSec * mTs));

  let aTrak, aTkhd, aMdia, aMinf, aStbl, aTs = sampleRate, aCount = 0;
  for (let p = moov.s + 8; p + 8 <= moov.e; ) {
    const sz = dv.getUint32(p);
    if (sz < 8 || p + sz > moov.e) break;
    if (tag(bytes, p + 4) === "trak") {
      const mdia = find(p + 8, p + sz, "mdia"), hdlr = mdia && find(mdia.s + 8, mdia.e, "hdlr");
      if (hdlr && tag(bytes, hdlr.s + 16) === "soun") {
        aTrak = { s: p, e: p + sz };
        aTkhd = find(p + 8, p + sz, "tkhd");
        aMdia = mdia;
        aMinf = find(mdia.s + 8, mdia.e, "minf");
        aStbl = aMinf && find(aMinf.s + 8, aMinf.e, "stbl");
        const mdhd = find(mdia.s + 8, mdia.e, "mdhd");
        if (mdhd) aTs = dv.getUint32(mdhd.s + (bytes[mdhd.s + 8] === 1 ? 28 : 20));
        const stsz = aStbl && find(aStbl.s + 8, aStbl.e, "stsz");
        if (stsz) aCount = dv.getUint32(stsz.s + 16);
        break;
      }
    }
    p += sz;
  }
  if (!aTrak || !aTkhd || !aStbl || !aCount || find(aTrak.s + 8, aTrak.e, "edts") || find(aStbl.s + 8, aStbl.e, "sgpd")) return bytes;

  const edts = atom("edts", [atom("elst", [u32(0), u32(1), u32(aSeg), u32(Math.round((primingSamples / sampleRate) * aTs)), u32(0x10000)])]);
  const roll = concatBytes([
    atom("sgpd", [u32(0x01000000), str4("roll"), u32(2), u32(1), u16(0xffff)]),
    atom("sbgp", [u32(0), str4("roll"), u32(1), u32(aCount), u32(1)])
  ]);
  const dE = edts.length, dR = roll.length, dT = dE + dR;
  const out = concatBytes([bytes.subarray(0, aTkhd.e), edts, bytes.subarray(aTkhd.e, aStbl.e), roll, bytes.subarray(aStbl.e)]);
  const odv = new DataView(out.buffer);
  const addU32 = (pos, d) => odv.setUint32(pos, (odv.getUint32(pos) + d) >>> 0);
  addU32(moov.s, dT); addU32(aTrak.s, dT); addU32(aMdia.s + dE, dR); addU32(aMinf.s + dE, dR); addU32(aStbl.s + dE, dR);

  const setDur = (pos, ver, val) => {
    if (!ver) odv.setUint32(pos, val >>> 0);
    else { odv.setUint32(pos, Math.floor(val / 4294967296) >>> 0); odv.setUint32(pos + 4, val >>> 0); }
  };
  setDur(mvhd.s + (mv === 1 ? 32 : 24), mv, mDur);
  const tv = out[aTkhd.s + 8];
  setDur(aTkhd.s + (tv === 1 ? 36 : 28), tv, aSeg);

  if (moov.s < mdat.s) {
    const shift = (s, e) => {
      for (let p = s; p + 8 <= e; ) {
        const sz = odv.getUint32(p);
        if (sz < 8 || p + sz > e) break;
        const t = tag(out, p + 4);
        if (t === "trak" || t === "mdia" || t === "minf" || t === "stbl") shift(p + 8, p + sz);
        else if (t === "stco") for (let i = 0, n = odv.getUint32(p + 12); i < n; i++) addU32(p + 16 + i * 4, dT);
        else if (t === "co64") {
          for (let i = 0, n = odv.getUint32(p + 12); i < n; i++) {
            const v = odv.getUint32(p + 16 + i * 8) * 4294967296 + odv.getUint32(p + 20 + i * 8) + dT;
            odv.setUint32(p + 16 + i * 8, Math.floor(v / 4294967296) >>> 0);
            odv.setUint32(p + 20 + i * 8, v >>> 0);
          }
        }
        p += sz;
      }
    };
    shift(moov.s + 8, moov.e + dT);
  }
  return out;
}
