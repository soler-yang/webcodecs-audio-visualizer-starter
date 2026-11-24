import test from "node:test";
import assert from "node:assert/strict";
import { fftMagnitude, analyzeAudioData } from "../src/audio-engine.js";
import { GifEncoder } from "../src/muxer-gif.js";
import { atom, concatBytes, encodePcm16LE, buildTransparentMov, str4, u16, u32 } from "../src/muxer-mov-png.js";
import { patchMp4AudioEditList } from "../src/mp4-aac-priming-sync.js";
import { patchWebmDuration } from "../src/webm-duration-patch.js";
import { extractClipOverviewPeaks, generateSoundwaveSvg } from "../src/exporter-svg.js";

function findFourCC(bytes, fourcc) {
  const target = str4(fourcc);
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === target[0] && bytes[i + 1] === target[1] && bytes[i + 2] === target[2] && bytes[i + 3] === target[3]) return i;
  }
  return -1;
}

test("Radix-2 Hann FFT detects 440Hz tone accurately", () => {
  const sr = 48000;
  const samples = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  const mag = new Float32Array(512);
  fftMagnitude(samples, 0, mag);
  let peak = 0;
  for (let i = 1; i < 512; i++) if (mag[i] > mag[peak]) peak = i;
  const hz = (peak * sr) / 1024;
  assert.ok(Math.abs(hz - 440) < 50, `Expected ~440Hz, got ${hz}Hz`);
});

test("Deterministic offline audio analyzer outputs frame-locked envelopes", () => {
  const sr = 48000;
  const mono = new Float32Array(sr * 2);
  for (let i = 0; i < mono.length; i++) mono[i] = Math.sin((2 * Math.PI * 95 * i) / sr) * 0.6;
  const a = analyzeAudioData(mono, sr, { fps: 30, barCount: 64 });
  const b = analyzeAudioData(mono, sr, { fps: 30, barCount: 64 });
  assert.equal(a.totalFrames, 60);
  assert.equal(a.frames[5][3], b.frames[5][3]);
  assert.ok(a.kicks[5] > 0.15);
});

test("Pure-JS GIF89a encoder outputs valid GIF header", () => {
  const gif = new GifEncoder(32, 24, { fps: 15, transparent: true });
  gif.addFrame(new Uint8Array(32 * 24 * 4));
  const bytes = gif.finish();
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a");
});

test("Pure-JS QuickTime RGBA MOV muxer packs canonical ftyp/mdat/moov/fiel/pasp/edts/co64 atoms", () => {
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const pcm = encodePcm16LE([new Float32Array(1600), new Float32Array(1600)], 0, 1600);
  const mov = buildTransparentMov({ width: 64, height: 64, fps: 30, pngFrames: [fakePng], audioPcm: pcm, sampleRate: 48000, channels: 2 });
  assert.equal(String.fromCharCode(...mov.slice(4, 8)), "ftyp");
  for (const box of ["mdat", "moov", "png ", "fiel", "pasp", "edts", "elst", "co64", "sowt"]) {
    assert.ok(findFourCC(mov, box) > 0, `Missing QuickTime atom '${box}'`);
  }
});

test("patchMp4AudioEditList injects edts/elst + sgpd/sbgp roll and shifts stco offsets for fastStart MP4", () => {
  const sampleRate = 48000;
  const mvhd = atom("mvhd", [u32(0), u32(0), u32(0), u32(1000), u32(3100), new Uint8Array(80)]);
  const tkhd = atom("tkhd", [u32(3), u32(0), u32(0), u32(1), u32(0), u32(3100), new Uint8Array(60)]);
  const mdhd = atom("mdhd", [u32(0), u32(0), u32(0), u32(sampleRate), u32(sampleRate * 3 + 2112), u32(0)]);
  const hdlr = atom("hdlr", [u32(0), u32(0), str4("soun"), new Uint8Array(12)]);
  const stsz = atom("stsz", [u32(0), u32(0), u32(143)]);
  const origOffset = 500;
  const stco = atom("stco", [u32(0), u32(1), u32(origOffset)]);
  const stbl = atom("stbl", [stsz, stco]);
  const minf = atom("minf", [stbl]);
  const mdia = atom("mdia", [mdhd, hdlr, minf]);
  const trak = atom("trak", [tkhd, mdia]);
  const moov = atom("moov", [mvhd, trak]);
  const ftyp = atom("ftyp", [str4("isom"), u32(0x200), str4("isom")]);
  const mdat = atom("mdat", new Uint8Array(64));
  const rawMp4 = concatBytes([ftyp, moov, mdat]);

  const patched = patchMp4AudioEditList(rawMp4, 2112, 3.0, 3.0, sampleRate);
  assert.ok(patched.length > rawMp4.length, "Patched MP4 should grow by edts + sgpd/sbgp bytes");
  for (const box of ["edts", "elst", "sgpd", "sbgp", "roll"]) {
    assert.ok(findFourCC(patched, box) > 0, `Missing injected box '${box}'`);
  }
  const delta = patched.length - rawMp4.length;
  const stcoPos = findFourCC(patched, "stco");
  const shiftedOffset = new DataView(patched.buffer, patched.byteOffset).getUint32(stcoPos + 12);
  assert.equal(shiftedOffset, origOffset + delta, "fastStart stco chunk offset must shift by exact injected byte delta");
});

test("patchWebmDuration injects finite IEEE-754 Float64 Duration into EBML Info box", () => {
  // Minimal EBML Header + Segment + Info(TimecodeScale=1_000_000) without Duration
  const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]);
  const infoBody = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]); // TimecodeScale = 1,000,000 ns
  const info = concatBytes([new Uint8Array([0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length]), infoBody]);
  const payload = new Uint8Array(16);
  const segSize = info.length + payload.length;
  const seg = concatBytes([new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x80 | segSize]), info, payload]);
  const rawWebm = concatBytes([ebml, seg]);

  const patched = patchWebmDuration(rawWebm, 4500);
  assert.equal(patched.length, rawWebm.length + 11);
  // Find 0x44 0x89 0x88 (Duration Float64)
  let durIdx = -1;
  for (let i = 0; i < patched.length - 10; i++) {
    if (patched[i] === 0x44 && patched[i + 1] === 0x89 && patched[i + 2] === 0x88) { durIdx = i; break; }
  }
  assert.ok(durIdx > 0, "Duration element 0x4489 must be present");
  const durTicks = new DataView(patched.buffer, patched.byteOffset + durIdx + 3, 8).getFloat64(0);
  assert.equal(durTicks, 4500);
});

test("SVG soundwave generator renders bars, radial, line, mirror & flat-fill Cricut mode", () => {
  const fakeBuf = {
    sampleRate: 48000,
    numberOfChannels: 1,
    length: 48000 * 4,
    getChannelData: () => Float32Array.from({ length: 48000 * 4 }, (_, i) => Math.sin(i * 0.05) * (i > 48000 * 2 ? 0.9 : 0.3))
  };
  const clipPeaks = extractClipOverviewPeaks(fakeBuf, null, 2, 2, 240);
  assert.equal(clipPeaks.length, 240);

  for (const style of ["bars", "radial", "line", "mirror"]) {
    const svg = generateSoundwaveSvg(clipPeaks, { style, title: "Demo Wave" });
    assert.ok(svg.includes("<svg") && svg.includes("Demo Wave") && svg.includes("<linearGradient"));
  }

  const cricutSvg = generateSoundwaveSvg(clipPeaks, {
    style: "bars",
    primaryColor: "#000000",
    secondaryColor: "#000000",
    bgColor: "transparent",
    title: ""
  });
  assert.ok(cricutSvg.includes('fill="#000000"'));
  assert.ok(!cricutSvg.includes("<linearGradient"), "Flat-fill Cricut SVG must omit linearGradient defs");
  assert.ok(!cricutSvg.includes("<text"), "Blank title must omit <text> element");
});
