/**
 * Deterministic Offline FFT, Kick Envelope, RMS Waveform Analyzer,
 * Built-in 15s Mastering Desk Demo Beat Synthesizer & Cover Auto-Palette.
 * Zero external dependencies — works identically in Browser & Node tests.
 */

const FFT_SIZE = 1024;
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

// Precompute bit-reversal and twiddle tables for ultra-fast Radix-2 FFT
const BIT_REV = new Uint16Array(FFT_SIZE);
const HALF_FFT = FFT_SIZE >> 1;
const COS_TAB = new Float32Array(HALF_FFT);
const SIN_TAB = new Float32Array(HALF_FFT);
{
  const bits = Math.log2(FFT_SIZE) | 0;
  for (let i = 0; i < FFT_SIZE; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    BIT_REV[i] = r;
  }
  for (let i = 0; i < HALF_FFT; i++) {
    const a = (-2 * Math.PI * i) / FFT_SIZE;
    COS_TAB[i] = Math.cos(a);
    SIN_TAB[i] = Math.sin(a);
  }
}

export function fftMagnitude(samples, offset, outMag) {
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const len = samples.length;
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = offset + i;
    const s = idx >= 0 && idx < len ? samples[idx] : 0;
    re[BIT_REV[i]] = s * HANN[i];
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      let t = 0;
      for (let j = 0; j < half; j++) {
        const k = i + j;
        const l = k + half;
        const c = COS_TAB[t];
        const s = SIN_TAB[t];
        const tr = re[l] * c - im[l] * s;
        const ti = re[l] * s + im[l] * c;
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
        t += step;
      }
    }
  }
  const norm = 2 / FFT_SIZE;
  for (let i = 0; i < HALF_FFT; i++) {
    outMag[i] = Math.hypot(re[i], im[i]) * norm;
  }
  return outMag;
}

/**
 * Downmix AudioBuffer (or plain { numberOfChannels, sampleRate, getChannelData, length })
 * to mono Float32Array for deterministic spectral analysis.
 */
export function downmixMono(audioBuffer) {
  const ch = audioBuffer.numberOfChannels || 1;
  const len = audioBuffer.length;
  const mono = new Float32Array(len);
  if (ch === 1) {
    mono.set(audioBuffer.getChannelData(0));
    return mono;
  }
  const c0 = audioBuffer.getChannelData(0);
  const c1 = audioBuffer.getChannelData(1);
  for (let i = 0; i < len; i++) mono[i] = 0.5 * (c0[i] + c1[i]);
  return mono;
}

/**
 * Precompute frame-accurate spectral bars (log-spaced 35Hz..15kHz),
 * kick energy, peak-hold envelopes, oscilloscope samples, and global RMS waveform.
 */
export function analyzeAudioData(mono, sampleRate, opts = {}) {
  const fps = opts.fps || 30;
  const barCount = opts.barCount || 64;
  const smoothing = opts.smoothing ?? 0.68;
  const duration = mono.length / sampleRate;
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const samplesPerFrame = sampleRate / fps;

  // Logarithmic frequency bin boundaries from 35Hz to min(15500Hz, Nyquist*0.92)
  const minFreq = 35;
  const maxFreq = Math.min(15500, sampleRate * 0.46);
  const binHz = sampleRate / FFT_SIZE;
  const binRanges = new Array(barCount);
  for (let b = 0; b < barCount; b++) {
    const f0 = minFreq * Math.pow(maxFreq / minFreq, b / barCount);
    const f1 = minFreq * Math.pow(maxFreq / minFreq, (b + 1) / barCount);
    const i0 = Math.max(1, Math.floor(f0 / binHz));
    const i1 = Math.min(HALF_FFT - 1, Math.max(i0 + 1, Math.ceil(f1 / binHz)));
    binRanges[b] = [i0, i1];
  }

  const frames = new Array(totalFrames);
  const peakHold = new Array(totalFrames);
  const kicks = new Float32Array(totalFrames);
  const rmsFrames = new Float32Array(totalFrames);
  const scopeFrames = new Array(totalFrames);

  const mag = new Float32Array(HALF_FFT);
  const prevBars = new Float32Array(barCount);
  const holdBars = new Float32Array(barCount);
  let prevKick = 0;

  for (let f = 0; f < totalFrames; f++) {
    const center = Math.floor((f + 0.5) * samplesPerFrame);
    const start = center - (FFT_SIZE >> 1);
    fftMagnitude(mono, start, mag);

    const bars = new Float32Array(barCount);
    const holds = new Float32Array(barCount);
    for (let b = 0; b < barCount; b++) {
      const [i0, i1] = binRanges[b];
      let sum = 0;
      let peak = 0;
      for (let i = i0; i <= i1; i++) {
        const v = mag[i];
        sum += v;
        if (v > peak) peak = v;
      }
      const avg = sum / (i1 - i0 + 1);
      // Weight highs slightly so treble shimmers naturally like a mastering analyzer
      const tilt = 1 + (b / barCount) * 1.45;
      const mixed = (avg * 0.6 + peak * 0.4) * tilt;
      const db = 20 * Math.log10(mixed + 1e-6);
      const norm = Math.max(0, Math.min(1, (db + 58) / 48));
      const smoothed = Math.max(norm, prevBars[b] * smoothing + norm * (1 - smoothing));
      prevBars[b] = smoothed;
      bars[b] = smoothed;

      if (smoothed >= holdBars[b]) {
        holdBars[b] = smoothed;
      } else {
        holdBars[b] = Math.max(smoothed, holdBars[b] - 0.018);
      }
      holds[b] = holdBars[b];
    }
    frames[f] = bars;
    peakHold[f] = holds;

    // Low-end kick envelope (40Hz - 140Hz)
    let lowSum = 0;
    const lowEnd = Math.min(HALF_FFT - 1, Math.ceil(140 / binHz));
    for (let i = 1; i <= lowEnd; i++) lowSum += mag[i];
    const kickRaw = Math.min(1, (lowSum / lowEnd) * 5.2);
    const kickSm = kickRaw > prevKick ? kickRaw : prevKick * 0.78 + kickRaw * 0.22;
    prevKick = kickSm;
    kicks[f] = kickSm;

    // Frame RMS & compact 96-point oscilloscope snapshot
    let sq = 0;
    const scope = new Float32Array(96);
    for (let i = 0; i < 96; i++) {
      const idx = start + Math.floor((i / 96) * FFT_SIZE);
      const s = idx >= 0 && idx < mono.length ? mono[idx] : 0;
      scope[i] = s;
      sq += s * s;
    }
    rmsFrames[f] = Math.min(1, Math.sqrt(sq / 96) * 2.4);
    scopeFrames[f] = scope;
  }

  // Global overview waveform (240 buckets) for scrub timeline & static SVG soundwave
  const overviewBuckets = 240;
  const overview = new Float32Array(overviewBuckets);
  const step = Math.max(1, Math.floor(mono.length / overviewBuckets));
  let maxOv = 0.001;
  for (let i = 0; i < overviewBuckets; i++) {
    let peak = 0;
    const s0 = i * step;
    const s1 = Math.min(mono.length, s0 + step);
    for (let j = s0; j < s1; j += Math.max(1, Math.floor((s1 - s0) / 128))) {
      const a = Math.abs(mono[j]);
      if (a > peak) peak = a;
    }
    overview[i] = peak;
    if (peak > maxOv) maxOv = peak;
  }
  for (let i = 0; i < overviewBuckets; i++) overview[i] /= maxOv;

  return {
    fps,
    barCount,
    duration,
    sampleRate,
    totalFrames,
    frames,
    peakHold,
    kicks,
    rmsFrames,
    scopeFrames,
    overview
  };
}

/**
 * Synthesize a catchy, studio-mixed 15-second 118 BPM Synthwave/Lo-Fi demo AudioBuffer
 * directly in memory (0 KB network cost, immediate zero-latency preview).
 */
export function synthesizeDemoAudioBuffer(audioCtx, durationSec = 15) {
  const sr = audioCtx.sampleRate || 48000;
  const len = Math.floor(sr * durationSec);
  const buffer = audioCtx.createBuffer(2, len, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  const bpm = 118;
  const beatSec = 60 / bpm;
  const stepSec = beatSec / 4; // 16th notes
  // Warm Am9 -> Fmaj7 -> Cmaj9 -> G6 chord progression (Hz)
  const chords = [
    [220.0, 261.63, 329.63, 392.0, 493.88],
    [174.61, 220.0, 261.63, 329.63, 392.0],
    [261.63, 329.63, 392.0, 493.88, 587.33],
    [196.0, 246.94, 293.66, 329.63, 440.0]
  ];
  const bassNotes = [55.0, 43.65, 65.41, 49.0];
  const arpPattern = [0, 2, 4, 2, 1, 3, 4, 3];

  // Deterministic PRNG for crisp hi-hat / snare noise
  let seed = 133791;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const beatIdx = Math.floor(t / beatSec);
    const beatPhase = (t % beatSec) / beatSec;
    const barIdx = Math.floor(beatIdx / 4) % 4;
    const stepIdx = Math.floor(t / stepSec);
    const stepPhase = (t % stepSec) / stepSec;

    // 1. Punchy Analog Kick on beats 0, 1, 2, 3 (four-on-the-floor + syncopation)
    let kick = 0;
    if (beatPhase < 0.45) {
      const kEnv = Math.exp(-beatPhase * 11.5);
      const kFreq = 46 + 115 * Math.exp(-beatPhase * 28);
      kick = Math.sin(2 * Math.PI * kFreq * (beatPhase * beatSec)) * kEnv * 0.62;
    }

    // 2. Crisp Snare on beats 1 and 3
    let snare = 0;
    if (beatIdx % 2 === 1 && beatPhase < 0.32) {
      const sEnv = Math.exp(-beatPhase * 16);
      const tone = Math.sin(2 * Math.PI * 195 * t) * Math.exp(-beatPhase * 24) * 0.25;
      snare = (rand() * 0.32 + tone) * sEnv;
    }

    // 3. 16th-note Hi-hat groove
    let hat = 0;
    const hatAccent = stepIdx % 2 === 0 ? 0.12 : 0.06;
    if (stepPhase < 0.28) {
      hat = rand() * Math.exp(-stepPhase * 24) * hatAccent;
    }

    // 4. Warm Sidechained Analog Pad Chords
    const sidechain = 0.35 + 0.65 * Math.min(1, beatPhase * 2.6);
    const chord = chords[barIdx];
    let padL = 0;
    let padR = 0;
    for (let n = 0; n < chord.length; n++) {
      const f = chord[n];
      padL += Math.sin(2 * Math.PI * f * t + n * 0.3) * 0.055;
      padR += Math.sin(2 * Math.PI * (f * 1.003) * t + n * 0.7) * 0.055;
    }
    padL *= sidechain;
    padR *= sidechain;

    // 5. Rolling Synth Bass
    const bf = bassNotes[barIdx];
    const bEnv = Math.exp(-stepPhase * 4.5);
    const bass = (Math.sin(2 * Math.PI * bf * t) + 0.35 * Math.sin(4 * Math.PI * bf * t)) * bEnv * 0.22;

    // 6. Bright Pluck Arpeggio (adds crisp upper-mid & high spectrum motion)
    const noteFreq = chord[arpPattern[stepIdx % arpPattern.length]] * 2;
    const arpEnv = Math.exp(-stepPhase * 9.5);
    const arp = (Math.sin(2 * Math.PI * noteFreq * t) + 0.4 * Math.sin(4 * Math.PI * noteFreq * t)) * arpEnv * 0.14;

    // Smooth fade-in (0.15s) & fade-out (0.6s)
    const fade = Math.min(1, t / 0.15) * Math.min(1, (durationSec - t) / 0.6);
    const outL = Math.tanh((kick + snare + hat * 0.9 + padL + bass + arp * 1.15) * fade * 1.15);
    const outR = Math.tanh((kick + snare + hat * 1.1 + padR + bass + arp * 0.85) * fade * 1.15);
    L[i] = outL;
    R[i] = outR;
  }
  return buffer;
}

/**
 * Extract primary & accent hex colors from an Image/Canvas for Auto-Palette styling.
 */
export function extractPaletteFromImage(img) {
  if (typeof document === "undefined" || !img) {
    return { primary: "#f59e0b", secondary: "#22d3ee", bg: "#111520" };
  }
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let bestSat = -1;
  let bestRgb = [245, 158, 11];
  let secScore = -1;
  let secRgb = [34, 211, 238];
  let avgR = 0, avgG = 0, avgB = 0, count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    avgR += r; avgG += g; avgB += b; count++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const s = max === min ? 0 : (max - min) / (max + min > 255 ? 510 - max - min : max + min);
    const score = s * (1 - Math.abs(l - 0.56) * 1.6);
    if (score > bestSat) {
      bestSat = score;
      bestRgb = [r, g, b];
    }
  }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const dist = Math.hypot(r - bestRgb[0], g - bestRgb[1], b - bestRgb[2]);
    if (dist < 85) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const s = max === min ? 0 : (max - min) / (max + min > 255 ? 510 - max - min : max + min);
    const score = s * (1 - Math.abs(l - 0.58) * 1.5);
    if (score > secScore) {
      secScore = score;
      secRgb = [r, g, b];
    }
  }
  const toHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const darkBg = count > 0 ? [avgR / count * 0.22, avgG / count * 0.22, avgB / count * 0.26] : [15, 17, 21];
  return {
    primary: bestSat > 0.15 ? toHex(bestRgb) : "#f59e0b",
    secondary: secScore > 0.12 ? toHex(secRgb) : "#22d3ee",
    bg: toHex(darkBg)
  };
}
