import test from "node:test";
import assert from "node:assert/strict";
import { fftMagnitude, analyzeAudioData } from "../src/audio-engine.js";
import { GifEncoder } from "../src/muxer-gif.js";
import { encodePcm16LE, buildTransparentMov } from "../src/muxer-mov-png.js";
import { generateSoundwaveSvg } from "../src/exporter-svg.js";

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

test("Pure-JS QuickTime RGBA MOV muxer packs ftyp/mdat/moov atoms", () => {
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const pcm = encodePcm16LE([new Float32Array(1600), new Float32Array(1600)], 0, 1600);
  const mov = buildTransparentMov({ width: 64, height: 64, fps: 30, pngFrames: [fakePng], audioPcm: pcm, sampleRate: 48000, channels: 2 });
  assert.equal(String.fromCharCode(...mov.slice(4, 8)), "ftyp");
});

test("SVG soundwave generator renders bars, radial, line & mirror", () => {
  const peaks = new Float32Array(96).fill(0.55);
  for (const style of ["bars", "radial", "line", "mirror"]) {
    const svg = generateSoundwaveSvg(peaks, { style, title: "Demo Wave" });
    assert.ok(svg.includes("<svg") && svg.includes("Demo Wave"));
  }
});
