/**
 * Pure-JS Lossless Transparent QuickTime (.mov) Muxer (PNG-in-MOV RGBA 32-bit + PCM 16-bit LE audio)
 * Zero WASM, zero COOP/COEP, ~4 KB. Natively opens with true 32-bit RGBA alpha channel in
 * Apple Final Cut Pro, Adobe Premiere Pro, DaVinci Resolve, After Effects & FFmpeg.
 */

function str4(s) {
  return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}

function u16(v) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, false);
  return b;
}

function u32(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, false);
  return b;
}

function u64(v) {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, Math.floor(v / 4294967296) >>> 0, false);
  dv.setUint32(4, v >>> 0, false);
  return b;
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function atom(type, payload) {
  const data = Array.isArray(payload) ? concatBytes(payload) : payload;
  return concatBytes([u32(data.length + 8), str4(type), data]);
}

function identityMatrix() {
  return concatBytes([
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000)
  ]);
}

/**
 * Interleave stereo/mono Float32 audio into 16-bit signed Little-Endian PCM ('sowt').
 */
export function encodePcm16LE(channels, startSample, sampleCount) {
  const numCh = Math.min(2, channels.length);
  const out = new Uint8Array(sampleCount * numCh * 2);
  const dv = new DataView(out.buffer);
  let byteOff = 0;
  for (let i = 0; i < sampleCount; i++) {
    const idx = startSample + i;
    for (let c = 0; c < numCh; c++) {
      const ch = channels[c];
      const f = idx >= 0 && idx < ch.length ? Math.max(-1, Math.min(1, ch[idx])) : 0;
      const s = f < 0 ? Math.round(f * 32768) : Math.round(f * 32767);
      dv.setInt16(byteOff, s, true);
      byteOff += 2;
    }
  }
  return out;
}

/**
 * Build complete QuickTime .mov binary from PNG RGBA frames + optional PCM audio bytes.
 * @param {object} opts { width, height, fps, pngFrames: Uint8Array[], audioPcm?: Uint8Array, sampleRate?: number, channels?: number }
 * @returns {Uint8Array}
 */
export function buildTransparentMov({ width, height, fps = 30, pngFrames, audioPcm = null, sampleRate = 48000, channels = 2 }) {
  const timescale = fps * 100; // e.g. 3000 for 30fps
  const frameDur = 100;
  const frameCount = pngFrames.length;
  const movieDuration = frameCount * frameDur;

  const ftyp = atom("ftyp", [
    str4("qt  "),
    u32(0x00000200),
    str4("qt  ")
  ]);

  // Calculate mdat total size and exact chunk offsets
  let videoBytesTotal = 0;
  for (const fr of pngFrames) videoBytesTotal += fr.length;
  const audioBytesTotal = audioPcm ? audioPcm.length : 0;
  const mdatPayloadSize = videoBytesTotal + audioBytesTotal;
  const useWideMdat = mdatPayloadSize + 8 > 0xffffffff;
  const mdatHeaderSize = useWideMdat ? 16 : 8;
  const mdatStart = ftyp.length;
  const dataStart = mdatStart + mdatHeaderSize;

  const videoOffsets = new Array(frameCount);
  let cursor = dataStart;
  for (let i = 0; i < frameCount; i++) {
    videoOffsets[i] = cursor;
    cursor += pngFrames[i].length;
  }
  const audioOffset = cursor;

  // Build mdat
  const mdatHeader = useWideMdat
    ? concatBytes([u32(1), str4("mdat"), u64(mdatPayloadSize + 16)])
    : concatBytes([u32(mdatPayloadSize + 8), str4("mdat")]);
  const mdatParts = [mdatHeader, ...pngFrames];
  if (audioPcm && audioPcm.length) mdatParts.push(audioPcm);
  const mdat = concatBytes(mdatParts);

  // Video Track ('png ' 32-bit RGBA alpha)
  const vStsdEntry = atom("png ", [
    new Uint8Array(6), // reserved
    u16(1), // data ref index
    u16(0), u16(0), u32(0), u32(0), u32(0), // version/rev/vendor/quality
    u16(width), u16(height),
    u32(0x00480000), u32(0x00480000), // 72 dpi
    u32(0), // reserved
    u16(1), // frame count per sample
    new Uint8Array(32), // compressor name (32 bytes)
    u16(32), // IMPORTANT: depth = 32 signals RGBA with Alpha channel to QuickTime/FCP/Premiere/FFmpeg!
    u16(0xffff) // color table id = -1
  ]);
  const vStsd = atom("stsd", [u32(0), u32(1), vStsdEntry]);
  const vStts = atom("stts", [u32(0), u32(1), u32(frameCount), u32(frameDur)]);
  const vStsc = atom("stsc", [u32(0), u32(1), u32(1), u32(1), u32(1)]);
  const vStsz = atom("stsz", [u32(0), u32(0), u32(frameCount), ...pngFrames.map((f) => u32(f.length))]);
  const vCo64 = atom("co64", [u32(0), u32(frameCount), ...videoOffsets.map((o) => u64(o))]);
  const vStbl = atom("stbl", [vStsd, vStts, vStsc, vStsz, vCo64]);

  const dref = atom("dref", [u32(0), u32(1), atom("alis", [u32(1)])]);
  const dinf = atom("dinf", [dref]);
  const vmhd = atom("vmhd", [u32(1), u16(0), u16(0), u16(0), u16(0)]);
  const vMinf = atom("minf", [vmhd, atom("hdlr", [u32(0), str4("dhlr"), str4("alis"), u32(0), u32(0), u32(0), new Uint8Array(1)]), dinf, vStbl]);
  const vMdhd = atom("mdhd", [u32(0), u32(0), u32(0), u32(timescale), u32(movieDuration), u16(0), u16(0)]);
  const vHdlr = atom("hdlr", [u32(0), str4("mhlr"), str4("vide"), u32(0), u32(0), u32(0), new Uint8Array(1)]);
  const vMdia = atom("mdia", [vMdhd, vHdlr, vMinf]);
  const vTkhd = atom("tkhd", [
    u32(0x0000000f), u32(0), u32(0), u32(1), u32(0), u32(movieDuration),
    u32(0), u32(0), u16(0), u16(0), u16(0), u16(0),
    identityMatrix(), u32(width << 16), u32(height << 16)
  ]);
  const videoTrak = atom("trak", [vTkhd, vMdia]);

  const moovChildren = [
    atom("mvhd", [
      u32(0), u32(0), u32(0), u32(timescale), u32(movieDuration),
      u32(0x00010000), u16(0x0100), new Uint8Array(10),
      identityMatrix(), new Uint8Array(24), u32(audioPcm && audioPcm.length ? 3 : 2)
    ]),
    videoTrak
  ];

  // Optional PCM 16-bit LE Audio Track ('sowt')
  if (audioPcm && audioPcm.length > 0) {
    const bytesPerFrame = channels * 2;
    const totalSamples = Math.floor(audioPcm.length / bytesPerFrame);
    const aStsdEntry = atom("sowt", [
      new Uint8Array(6), u16(1),
      u16(0), u16(0), u32(0),
      u16(channels), u16(16), u16(0), u16(0),
      u32((sampleRate & 0xffff) << 16)
    ]);
    const aStsd = atom("stsd", [u32(0), u32(1), aStsdEntry]);
    const aStts = atom("stts", [u32(0), u32(1), u32(totalSamples), u32(1)]);
    const aStsc = atom("stsc", [u32(0), u32(1), u32(1), u32(totalSamples), u32(1)]);
    const aStsz = atom("stsz", [u32(0), u32(bytesPerFrame), u32(totalSamples)]);
    const aCo64 = atom("co64", [u32(0), u32(1), u64(audioOffset)]);
    const aStbl = atom("stbl", [aStsd, aStts, aStsc, aStsz, aCo64]);
    const smhd = atom("smhd", [u32(0), u16(0), u16(0)]);
    const aMinf = atom("minf", [smhd, atom("hdlr", [u32(0), str4("dhlr"), str4("alis"), u32(0), u32(0), u32(0), new Uint8Array(1)]), dinf, aStbl]);
    const aMdhd = atom("mdhd", [u32(0), u32(0), u32(0), u32(sampleRate), u32(totalSamples), u16(0), u16(0)]);
    const aHdlr = atom("hdlr", [u32(0), str4("mhlr"), str4("soun"), u32(0), u32(0), u32(0), new Uint8Array(1)]);
    const aMdia = atom("mdia", [aMdhd, aHdlr, aMinf]);
    const aTkhd = atom("tkhd", [
      u32(0x0000000f), u32(0), u32(0), u32(2), u32(0), u32(movieDuration),
      u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0),
      identityMatrix(), u32(0), u32(0)
    ]);
    moovChildren.push(atom("trak", [aTkhd, aMdia]));
  }

  const moov = atom("moov", moovChildren);
  return concatBytes([ftyp, mdat, moov]);
}
