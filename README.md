# WebCodecs Audio Visualizer Starter (Zero-WASM, Zero-COOP/COEP)

Zero-dependency JavaScript building blocks for **offline 4–10× real-time browser audio visualization** and **true 32-bit RGBA transparent video export**, extracted from the production engine behind [**Audio Visualizer Online**](https://audiovisualizeronline.com/).

## Why Zero-WASM & Zero-COOP/COEP?

Most web audio visualizers fall into one of two traps:
1. **`MediaRecorder` real-time screen capture**: Forces users to keep a tab open for 3 full minutes just to export a 3-minute song.
2. **`ffmpeg.wasm` multi-threaded builds**: Require downloading 25–40 MB WASM binaries and enabling `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` (`SharedArrayBuffer`), which breaks standard third-party embeds and ads.

This starter kit shows how to run deterministic DSP and multi-format container muxing **100% locally in standard browser memory** with zero WASM and zero server uploads:

| Module | What It Does | Size / Deps |
| --- | --- | --- |
| `src/audio-engine.js` | Deterministic 1024-pt Radix-2 Hann-window FFT across 64 logarithmic bands (35 Hz – 15.5 kHz) + 40–140 Hz kick envelope + RMS waveform overview | 0 deps |
| `src/muxer-mov-png.js` | Pure-JS **lossless 32-bit RGBA QuickTime `.mov`** container writer (`png ` depth 32 + 48 kHz 16-bit PCM `sowt`, verified 0 ms A/V drift) for Final Cut Pro, Premiere Pro & DaVinci Resolve | 0 deps (~4 KB) |
| `src/muxer-gif.js` | Pure-JS **transparent GIF89a LZW encoder** with transparent palette index (`255`) and `disposal=2` frame clearing | 0 deps |
| `src/exporter-svg.js` | Instant **static vector SVG soundwave** generator (`bars`, `mirror`, `radial`, `line`) for print, logos, and thumbnails | 0 deps |

## Chrome + FFprobe Lab Benchmarks

Measured locally on desktop Google Chrome paired with WebCodecs `VideoEncoder` (`avc1`) + `AudioEncoder` (`mp4a.40.2`) and `mp4-muxer@5.1.3` (from the live studio at [audiovisualizeronline.com](https://audiovisualizeronline.com/)):

| Export Format | Input Audio | Wall Render Time | Speed | FFprobe Verified Output |
| --- | --- | --- | --- | --- |
| **Offline 1080p MP4** | 8s stereo MP3 | **2.1s** | **3.8×** | `h264 (yuv420p)` 1920×1080 30fps + `aac` 48 kHz |
| **Offline 1080p MP4** | 180s (3-min) MP3 | **35.9s** | **5.0×** | `h264 (yuv420p)` 5,400 frames + `aac` 48 kHz |
| **Transparent Alpha MOV** | 3s stereo MP3 | **1.5s** | **2.0×** | `png (rgba)` 32-bit + `pcm_s16le` (**0 ms sync delta**) |
| **Transparent GIF89a** | 3s stereo MP3 | **0.1s** | **30×** | `gif (bgra)` 45 frames (135.7 KB) |
| **Static Vector SVG** | Any audio | **0.02s** | Instant | Scalable `<svg>` (8.9 KB) |

## Quick Start & Tests

```bash
npm test
```

## Full Browser Studio & Editor Workflows

- **Full 16-Preset Browser Studio (MP4, MOV, WebM, GIF, SVG + Free Tap-Sync Lyrics):** [Audio Visualizer Online](https://audiovisualizeronline.com/)
- **Transparent Alpha Exporter (Premiere, Final Cut Pro, DaVinci, OBS & CapCut):** [Transparent Audio Visualizer](https://audiovisualizeronline.com/transparent-audio-visualizer)
- **NLE Compositing Guide (Solving CapCut's VP9 Black-Box Bug):** [Transparent Audio Visualizer Guide for Premiere, CapCut & FCP](https://audiovisualizeronline.com/guides/transparent-audio-visualizer-premiere-capcut-davinci)

## License

MIT
