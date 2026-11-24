# Browser Audio Visualizer Container & Platform Engineering Specs

Production-verified engineering notes extracted from [**Audio Visualizer Online**](https://audiovisualizeronline.com/).

---

## 1. Eliminating the 44 ms Chrome WebCodecs AAC Priming Offset (`0.0 ms` Sync)

When encoding AAC (`mp4a.40.2`) through WebCodecs `AudioEncoder` and muxing with `mp4-muxer`, the underlying OS AAC encoder (Apple CoreAudio on macOS, Media Foundation on Windows, FDK/platform codecs on Linux) prepends **encoder priming silence** — typically **2,112 samples (`44.0 ms` at `48 kHz`)** — and pads the final 1,024-sample frame.

Without container metadata telling decoders to skip those leading samples:
- Kick drums and audio-reactive waveform peaks visually fire **44 ms early** relative to decoded audio.
- FFprobe reports audio duration slightly longer than the video track due to trailing AAC frame padding.

### Two-Step Pure-JS Fix (`src/mp4-aac-priming-sync.js`)

1. **Dynamic Runtime Probe (`measureAacPrimingSamples`)**: Encode a synthetic 1,024-sample Hann-windowed dual-sine burst at offset `2048` via `AudioEncoder`, immediately decode it via `AudioDecoder`, and cross-correlate against the reference burst (~12 ms once per session, cached per `(sampleRate, channels)`).
2. **ISO/IEC 14496-12 + Apple TN2258 Patch (`patchMp4AudioEditList`)**:
   - Inserts `edts > elst` on the `soun` track with `media_time = primingSamples` and `segment_duration = exactAudioDuration`.
   - Inserts `sgpd` + `sbgp` (`grouping_type = 'roll'`, `roll_distance = -1`) inside `stbl` per Apple Technical Note TN2258 so CoreAudio/AVFoundation decodes the pre-roll frame cleanly.
   - Clamps `mvhd` and audio `tkhd` durations to trim trailing AAC padding.
   - Shifts every `stco` / `co64` chunk offset across all tracks when `moov` precedes `mdat` (`fastStart: "in-memory"`).

**FFprobe / Waveform Verification**: Three synthetic onset clicks at `250 ms`, `1000 ms`, and `2500 ms` decode at exact `250.0 ms`, `1000.0 ms`, and `2500.0 ms` (`0.0 ms` delta), container duration `3.000 s`.

---

## 2. Transparent Alpha Video NLE Compatibility Matrix

Pure-JS `PNG-in-MOV` (`src/muxer-mov-png.js`) writes canonical QuickTime atoms (`ftyp qt  `, `png ` depth `32`, `fiel`, `pasp 1:1`, `edts/elst`, `url ` `dref`, `co64`, 16-bit LE PCM `sowt`) completely offline without WASM.

| Target Editor / Platform | Best Format | Notes |
| --- | --- | --- |
| **Adobe Premiere Pro / After Effects** | Transparent Alpha `.mov` (`png ` 32-bit RGBA) | Imports natively with straight alpha — zero chroma keying. |
| **DaVinci Resolve** | Transparent Alpha `.mov` (`png ` 32-bit RGBA) | Reads straight alpha natively in Media Pool / Fusion. |
| **OBS Studio / Browser Sources** | Transparent VP9 Alpha `.webm` (Chrome/Edge) | Lightweight real-time overlay; use `patchWebmDuration()` so seekable duration is finite. |
| **CapCut (Desktop / Mobile)** | Transparent `.mov` or `#00FF00` Green Screen `.mp4` | CapCut often renders VP9 WebM alpha as solid black; see [Transparent Audio Visualizer NLE Guide](https://audiovisualizeronline.com/guides/transparent-audio-visualizer-premiere-capcut-davinci). |
| **Apple Final Cut Pro (modern macOS)** | Green Screen `.mp4` or ProRes 4444 transcode | Modern macOS AVFoundation removed legacy QuickTime `'png '` video decoding (`-11833/-12906`). Transcode locally with:<br>`ffmpeg -i overlay.mov -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -c:a copy overlay_prores4444.mov` |
| **Firefox `MediaRecorder` caveat** | Transparent Alpha `.mov` | Firefox `MediaRecorder` records opaque black VP8 even when `video/webm` is accepted; do not promise VP9 Alpha WebM on Firefox. |

---

## 3. Spotify Canvas Specification (`608×1080` 9:16)

For Spotify for Artists Canvas uploads (live preset at [`/music-visualizer`](https://audiovisualizeronline.com/music-visualizer)):

- **Dimensions**: `608×1080` (9:16 vertical, exact even pixel width/height)
- **Duration**: Strictly **`3.0s` – `8.0s`** loop (warn users explicitly when clip duration is `< 3s` or `> 8s`)
- **Container & Codec**: `.mp4` (`H.264 / avc1`) — Spotify rejects `.webm` uploads, so browsers falling back to `MediaRecorder` WebM should display a clear MP4 conversion warning.

---

## 4. Plotter / Cricut / Laser-Cutter SVG Waveform Spec

Vector importers like Cricut Design Space and Silhouette Studio often misinterpret `<linearGradient>` `<defs>` as rasterized black boxes. In `src/exporter-svg.js`:
- Pass equal `primaryColor` and `secondaryColor` (e.g. `#000000` / `#000000`) with `bgColor: "transparent"` and `title: ""`.
- The generator automatically strips `<defs><linearGradient>...</linearGradient></defs>` and outputs pure flat-fill `<rect>` / `<path>` / `<line>` primitives ready for cutting or vinyl plotting (try it online at [`/sound-wave-generator`](https://audiovisualizeronline.com/sound-wave-generator)).
