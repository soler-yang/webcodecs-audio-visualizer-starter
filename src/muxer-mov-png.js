/**
 * Pure-JS Lossless Transparent QuickTime (.mov) Muxer (PNG-in-MOV RGBA 32-bit + PCM 16-bit LE audio)
 * Zero WASM, zero COOP/COEP. Emits canonical QuickTime atoms (ftyp qt, fiel, pasp 1:1, depth=32,
 * edts/elst, url dref, co64) verified in FFmpeg and cross-platform NLEs (Premiere Pro, After Effects,
 * DaVinci Resolve).
 *
 * macOS AVFoundation / Final Cut Pro note:
 * Modern macOS AVFoundation dropped legacy QuickTime 'png ' video decoding (-11833/-12906).
 * For Final Cut Pro, use a Green Screen MP4 or transcode the lossless RGBA MOV to ProRes 4444:
 *   ffmpeg -i overlay.mov -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a copy overlay_prores4444.mov
 */

export const str4 = (s) => new Uint8Array([0, 1, 2, 3].map((i) => s.charCodeAt(i)));
export const u16 = (v) => new Uint8Array([(v >> 8) & 255, v & 255]);
export const u32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u32s = (...a) => concatBytes(a.map(u32));
const u64 = (v) => concatBytes([u32(Math.floor(v / 4294967296)), u32(v)]);
const Z = (n) => new Uint8Array(n);

export function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function atom(type, payload) {
  const data = Array.isArray(payload) ? concatBytes(payload) : payload;
  return concatBytes([u32(data.length + 8), str4(type), data]);
}

const MATRIX = u32s(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
const hdlr = (t, s) => atom("hdlr", [Z(4), str4(t), str4(s), Z(13)]);
const edtsBox = (dur) => atom("edts", [atom("elst", u32s(0, 1, dur, 0, 0x10000))]);

/**
 * Interleave stereo/mono Float32 audio into 16-bit signed Little-Endian PCM ('sowt').
 */
export function encodePcm16LE(channels, startSample, sampleCount) {
  const numCh = Math.min(2, channels.length);
  const out = new Uint8Array(sampleCount * numCh * 2);
  const dv = new DataView(out.buffer);
  let off = 0;
  for (let i = 0; i < sampleCount; i++) {
    const idx = startSample + i;
    for (let c = 0; c < numCh; c++) {
      const ch = channels[c];
      const f = idx >= 0 && idx < ch.length ? Math.max(-1, Math.min(1, ch[idx])) : 0;
      dv.setInt16(off, Math.round(f * (f < 0 ? 32768 : 32767)), true);
      off += 2;
    }
  }
  return out;
}

/**
 * Build complete QuickTime .mov binary from PNG RGBA frames + optional PCM audio bytes.
 */
export function buildTransparentMov({ width, height, fps = 30, pngFrames, audioPcm = null, sampleRate = 48000, channels = 2 }) {
  const timescale = fps * 100, frameDur = 100, frameCount = pngFrames.length, movieDuration = frameCount * frameDur;
  const ftyp = atom("ftyp", [str4("qt  "), u32(0x200), str4("qt  ")]);

  let vBytes = 0;
  for (const fr of pngFrames) vBytes += fr.length;
  const payloadSize = vBytes + (audioPcm ? audioPcm.length : 0);
  const wide = payloadSize + 8 > 0xffffffff;
  let cursor = ftyp.length + (wide ? 16 : 8);
  const vOffsets = pngFrames.map((fr) => { const o = cursor; cursor += fr.length; return o; });
  const aOffset = cursor;

  const mdatHead = wide ? concatBytes([u32(1), str4("mdat"), u64(payloadSize + 16)]) : concatBytes([u32(payloadSize + 8), str4("mdat")]);
  const mdatParts = [mdatHead, ...pngFrames];
  if (audioPcm?.length) mdatParts.push(audioPcm);
  const mdat = concatBytes(mdatParts);

  const dinf = atom("dinf", [atom("dref", [u32s(0, 1), atom("url ", u32(1))])]);
  const dhlr = hdlr("dhlr", "url ");

  const vStsd = atom("stsd", [u32s(0, 1), atom("png ", [
    Z(6), u16(1), Z(16), u16(width), u16(height), u32s(0x480000, 0x480000, 0),
    u16(1), Z(32), u16(32), u16(0xffff),
    atom("fiel", new Uint8Array([1, 0])), atom("pasp", u32s(1, 1))
  ])]);
  const vStbl = atom("stbl", [
    vStsd,
    atom("stts", u32s(0, 1, frameCount, frameDur)),
    atom("stsc", u32s(0, 1, 1, 1, 1)),
    atom("stsz", [u32s(0, 0, frameCount), ...pngFrames.map((f) => u32(f.length))]),
    atom("co64", [u32s(0, frameCount), ...vOffsets.map(u64)])
  ]);
  const vMdia = atom("mdia", [
    atom("mdhd", [u32s(0, 0, 0, timescale, movieDuration), Z(4)]),
    hdlr("mhlr", "vide"),
    atom("minf", [atom("vmhd", [u32(1), Z(8)]), dhlr, dinf, vStbl])
  ]);
  const vTkhd = atom("tkhd", [u32s(3, 0, 0, 1, 0, movieDuration, 0, 0), Z(8), MATRIX, u32s(width << 16, height << 16)]);
  const moovChildren = [
    atom("mvhd", [u32s(0, 0, 0, timescale, movieDuration, 0x10000), u16(0x100), Z(10), MATRIX, Z(24), u32(audioPcm?.length ? 3 : 2)]),
    atom("trak", [vTkhd, edtsBox(movieDuration), vMdia])
  ];

  if (audioPcm?.length) {
    const bpf = channels * 2, totalSamples = Math.floor(audioPcm.length / bpf);
    const aStsd = atom("stsd", [u32s(0, 1), atom("sowt", [
      Z(6), u16(1), Z(8), u16(channels), u16(16), Z(4), u32((Math.min(65535, sampleRate) & 0xffff) << 16)
    ])]);
    const aStbl = atom("stbl", [
      aStsd,
      atom("stts", u32s(0, 1, totalSamples, 1)),
      atom("stsc", u32s(0, 1, 1, totalSamples, 1)),
      atom("stsz", u32s(0, bpf, totalSamples)),
      atom("co64", [u32s(0, 1), u64(aOffset)])
    ]);
    const aMdia = atom("mdia", [
      atom("mdhd", [u32s(0, 0, 0, sampleRate, totalSamples), Z(4)]),
      hdlr("mhlr", "soun"),
      atom("minf", [atom("smhd", Z(8)), dhlr, dinf, aStbl])
    ]);
    const aDur = Math.max(1, Math.min(movieDuration, Math.round((totalSamples / sampleRate) * timescale)));
    const aTkhd = atom("tkhd", [u32s(3, 0, 0, 2, 0, aDur, 0, 0), Z(4), u16(0x100), Z(2), MATRIX, Z(8)]);
    moovChildren.push(atom("trak", [aTkhd, edtsBox(aDur), aMdia]));
  }

  return concatBytes([ftyp, mdat, atom("moov", moovChildren)]);
}
