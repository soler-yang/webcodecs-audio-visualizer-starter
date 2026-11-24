# WebCodecs Audio Visualizer Starter (Zero-WASM, Zero-COOP/COEP)

Zero-dependency JavaScript building blocks for **offline 4–10× real-time browser audio visualization**, **0.0 ms beat-synced WebCodecs MP4 AAC export**, and **true 32-bit RGBA transparent video & Cricut-ready SVG export**, extracted from the production engine behind [**Audio Visualizer Online**](https://audiovisualizeronline.com/).

## Why Zero-WASM & Zero-COOP/COEP?

Most browser audio visualizers fall into one of two traps:
1. **`MediaRecorder` real-time screen capture**: Forces users to keep a tab open for 3 full minutes just to export a 3-minute song — and Chromium writes WebM files with infinite/missing duration metadata.
2. **`ffmpeg.wasm` multi-threaded builds**: Require downloading 25–40 MB WASM binaries and enabling `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` (`SharedArrayBuffer`), which breaks standard third-party embeds and ads.

This starter kit runs deterministic DSP, container sync patching, and multi-format muxing **100% locally in standard browser memory** with zero WASM and zero server uploads:

| Module | What It Does | Deps |
| --- | --- | --- |
| `src/audio-engine.js` | Deterministic 1024-pt Radix-2 Hann-window FFT across 64 logarithmic bands (35 Hz – 15.5 kHz) + 40–140 Hz kick envelope + RMS waveform overview | 0 deps |
| `src/mp4-aac-priming-sync.js` | **New in v1.1.0:** ~12 ms WebCodecs `AudioEncoder -> AudioDecoder` priming probe + pure-JS ISO/IEC 14496-12 `edts`/`elst` & Apple TN2258 `sgpd`/`sbgp` (`roll = -1`) MP4 patcher with automatic `stco`/`co64` offset shifting (**0.0 ms beat-sync accuracy**) | 0 deps |
| `src/webm-duration-patch.js` | **New in v1.1.0:** Pure-JS EBML `Segment > Info > Duration` injector that gives Chromium `MediaRecorder` WebM exports a finite, seekable duration | 0 deps |
| `src/muxer-mov-png.js` | Pure-JS **lossless 32-bit RGBA QuickTime `.mov`** container writer (`ftyp qt  `, `png ` depth 32, `fiel`, `pasp 1:1`, `edts/elst`, `co64` + 48 kHz 16-bit PCM `sowt`) for Premiere Pro, After Effects, DaVinci Resolve & FFmpeg | 0 deps |
| `src/muxer-gif.js` | Pure-JS **transparent GIF89a LZW encoder** with transparent palette index (`255`) and `disposal=2` frame clearing | 0 deps |
| `src/exporter-svg.js` | Exact clip-window 240-bin **vector SVG soundwave** generator (`bars`, `mirror`, `radial`, `line`) with automatic **flat-fill Cricut / plotter mode** (strips `<linearGradient>` `<defs>` when primary & secondary colors match) | 0 deps |

See **[`docs/SPECS.md`](./docs/SPECS.md)** for full container specs covering the 44 ms Chrome WebCodecs AAC priming fix, NLE alpha format compatibility (including modern macOS AVFoundation / Final Cut Pro `'png '` decoding caveats), Spotify Canvas `608×1080` (`3–8s`) rules, and flat-fill plotter SVGs.

## Recipe: Fixing the 44 ms Chrome WebCodecs AAC Drift

```js
import { measureAacPrimingSamples, patchMp4AudioEditList } from "./src/mp4-aac-priming-sync.js";

// 1. Measure the browser's exact AAC priming delay once (~12ms, cached per sampleRate:channels)
const primingSamples = await measureAacPrimingSamples(48000, 2, 192_000);

// 2. After muxer.finalize() (e.g. mp4-muxer with fastStart: "in-memory"), patch edts/elst + roll:
let mp4Bytes = new Uint8Array(target.buffer);
if (primingSamples !== null) {
  mp4Bytes = patchMp4AudioEditList(mp4Bytes, primingSamples, audioDurSec, videoDurSec, 48000);
}
```

## Chrome + FFprobe Lab Benchmarks

Measured locally on desktop Google Chrome paired with WebCodecs `VideoEncoder` (`avc1`) + `AudioEncoder` (`mp4a.40.2`) + `mp4-muxer@5.1.3` + `patchMp4AudioEditList` (from the live studio at [audiovisualizeronline.com](https://audiovisualizeronline.com/)):

| Export Format | Input Audio | Wall Render Time | Speed | FFprobe Verified Output |
| --- | --- | --- | --- | --- |
| **Offline 1080p MP4** | 8s stereo MP3 | **2.1s** | **3.8×** | `h264 (yuv420p)` 1920×1080 30fps + `aac` 48 kHz (**0.0 ms beat-sync delta**) |
| **Offline 1080p MP4** | 180s (3-min) MP3 | **35.9s** | **5.0×** | `h264 (yuv420p)` 5,400 frames + `aac` 48 kHz |
| **Transparent Alpha MOV** | 3s stereo MP3 | **1.5s** | **2.0×** | `png (rgba)` 32-bit + `pcm_s16le` (**0 ms sync delta**) |
| **Transparent GIF89a** | 3s stereo MP3 | **0.1s** | **30×** | `gif (bgra)` 45 frames (135.7 KB) |
| **Static Vector SVG** | Any audio | **0.02s** | Instant | Flat-fill or gradient `<svg>` (8.9 KB) |

## Quick Start & Tests

```bash
npm test
```

## Full Browser Studio & Editor Workflows

- **Full 17-Preset Browser Studio (MP4, MOV, WebM, GIF, SVG + Free Tap-Sync Lyrics):** [Audio Visualizer Online](https://audiovisualizeronline.com/)
- **Transparent Alpha Exporter (Premiere Pro, After Effects, DaVinci Resolve, CapCut & OBS):** [Transparent Audio Visualizer](https://audiovisualizeronline.com/transparent-audio-visualizer)
- **Flat-Fill Cricut & Print Soundwave Art Exporter:** [Sound Wave Generator](https://audiovisualizeronline.com/sound-wave-generator)
- **Spotify Canvas (`608×1080` 3–8s) & Music Visualizer Presets:** [Music Visualizer](https://audiovisualizeronline.com/music-visualizer)
- **Podcast Audiogram Maker (9:16 & 1:1 + `.srt` Captions):** [Podcast Audiogram Maker](https://audiovisualizeronline.com/podcast-audiogram-maker)
- **NLE Compositing Guide (Solving CapCut VP9 Black-Box & macOS AVFoundation Notes):** [Transparent Audio Visualizer Guide for Premiere, CapCut & DaVinci](https://audiovisualizeronline.com/guides/transparent-audio-visualizer-premiere-capcut-davinci)

## License

MIT
