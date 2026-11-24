/**
 * Pure-JS Static Vector SVG Soundwave Art Generator.
 * Supports exact clip-window peak extraction (240-bin default), 4 distinct vector geometries
 * ("bars" | "mirror" | "radial" | "line"), and flat-fill Cricut / Silhouette plotter output
 * (omits <linearGradient> <defs> automatically when primaryColor === secondaryColor).
 */

export function extractClipOverviewPeaks(audioBuffer, analysis, clipStart = 0, clipDuration = null, targetBins = 240) {
  if (audioBuffer && typeof audioBuffer.getChannelData === "function") {
    const sr = audioBuffer.sampleRate || 48000;
    const total = audioBuffer.length || 0;
    const startSample = Math.max(0, Math.min(total - 1, Math.floor((clipStart || 0) * sr)));
    const rawLen = clipDuration && clipDuration > 0 ? Math.floor(clipDuration * sr) : (total - startSample);
    const len = Math.max(1, Math.min(total - startSample, rawLen));
    const numCh = Math.max(1, audioBuffer.numberOfChannels || 1);
    const chs = [];
    for (let c = 0; c < numCh; c++) chs.push(audioBuffer.getChannelData(c));

    const bins = Math.max(16, targetBins);
    const peaks = new Float32Array(bins);
    let maxPeak = 0.0001;
    for (let i = 0; i < bins; i++) {
      const s0 = startSample + Math.floor((i / bins) * len);
      const s1 = startSample + Math.max(s0 - startSample + 1, Math.floor(((i + 1) / bins) * len));
      const step = Math.max(1, Math.floor((s1 - s0) / 64));
      let p = 0;
      for (let s = s0; s < s1 && s < total; s += step) {
        let v = 0;
        for (let c = 0; c < numCh; c++) v += Math.abs(chs[c][s]);
        v /= numCh;
        if (v > p) p = v;
      }
      peaks[i] = p;
      if (p > maxPeak) maxPeak = p;
    }
    for (let i = 0; i < bins; i++) peaks[i] = Math.min(1, peaks[i] / maxPeak);
    return peaks;
  }

  const ov = analysis?.overview;
  if (!ov || !ov.length) return null;
  const totalDur = analysis?.duration || (analysis?.totalFrames && analysis?.fps ? analysis.totalFrames / analysis.fps : 0);
  if (!totalDur || (!clipStart && (!clipDuration || clipDuration >= totalDur - 0.05))) {
    return ov;
  }
  const f0 = Math.max(0, Math.min(1, (clipStart || 0) / totalDur));
  const f1 = Math.max(f0 + 0.01, Math.min(1, ((clipStart || 0) + (clipDuration || totalDur)) / totalDur));
  const i0 = Math.floor(f0 * ov.length);
  const i1 = Math.max(i0 + 1, Math.ceil(f1 * ov.length));
  const sliced = ov.slice(i0, i1);
  let m = 0.0001;
  for (let i = 0; i < sliced.length; i++) if (sliced[i] > m) m = sliced[i];
  const norm = new Float32Array(sliced.length);
  for (let i = 0; i < sliced.length; i++) norm[i] = Math.min(1, sliced[i] / m);
  return norm;
}

export function generateSoundwaveSvg(overviewPeaks, opts = {}) {
  const {
    style = "bars", // "bars" | "mirror" | "radial" | "line"
    width = 1600,
    height = 520,
    primaryColor = "#f59e0b",
    secondaryColor = "#22d3ee",
    bgColor = "transparent",
    barCount = 96,
    title = ""
  } = opts;

  const peaks = resamplePeaks(overviewPeaks, barCount);
  const flat = String(primaryColor).trim().toLowerCase() === String(secondaryColor).trim().toLowerCase();
  const paintH = flat ? esc(primaryColor) : "url(#swGrad)";
  const paintV = flat ? esc(primaryColor) : "url(#swVert)";
  const bgRect = bgColor && bgColor !== "transparent"
    ? `<rect width="${width}" height="${height}" fill="${esc(bgColor)}"/>`
    : "";
  const gradDef = flat ? "" : `<defs>` +
    `<linearGradient id="swGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${esc(primaryColor)}"/><stop offset="100%" stop-color="${esc(secondaryColor)}"/></linearGradient>` +
    `<linearGradient id="swVert" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="${esc(secondaryColor)}"/><stop offset="100%" stop-color="${esc(primaryColor)}"/></linearGradient>` +
    `</defs>`;

  let body = "";
  if (style === "radial") {
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const r0 = size * 0.22;
    const maxLen = size * 0.24;
    const parts = [
      `<circle cx="${cx}" cy="${cy}" r="${(r0 - 8).toFixed(2)}" fill="none" stroke="${paintH}" stroke-width="2" opacity="0.35"/>`
    ];
    for (let i = 0; i < peaks.length; i++) {
      const a = (i / peaks.length) * Math.PI * 2 - Math.PI / 2;
      const len = Math.max(4, peaks[i] * maxLen);
      const x1 = (cx + Math.cos(a) * r0).toFixed(2);
      const y1 = (cy + Math.sin(a) * r0).toFixed(2);
      const x2 = (cx + Math.cos(a) * (r0 + len)).toFixed(2);
      const y2 = (cy + Math.sin(a) * (r0 + len)).toFixed(2);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${paintH}" stroke-width="5" stroke-linecap="round"/>`);
    }
    body = parts.join("");
  } else if (style === "line") {
    const padX = width * 0.06;
    const span = width - padX * 2;
    const midY = height / 2;
    const amp = height * 0.36;
    const pts = [];
    for (let i = 0; i < peaks.length; i++) {
      const x = (padX + (i / (peaks.length - 1)) * span).toFixed(2);
      const sign = i % 2 === 0 ? -1 : 1;
      const y = (midY + sign * peaks[i] * amp).toFixed(2);
      pts.push(`${i === 0 ? "M" : "L"}${x},${y}`);
    }
    body = `<line x1="${padX.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${(width - padX).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${paintH}" stroke-width="1.5" opacity="0.25"/>` +
      `<path d="${pts.join(" ")}" fill="none" stroke="${paintH}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (style === "mirror") {
    const padX = width * 0.05;
    const span = width - padX * 2;
    const slot = span / peaks.length;
    const bw = Math.max(3, slot * 0.58);
    const midY = height * 0.48;
    const maxHalf = height * 0.38;
    const gap = 3;
    const parts = [
      `<line x1="${padX.toFixed(1)}" y1="${midY.toFixed(1)}" x2="${(width - padX).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="${paintH}" stroke-width="1.5" opacity="0.32"/>`
    ];
    for (let i = 0; i < peaks.length; i++) {
      const upper = Math.max(6, peaks[i] * maxHalf);
      const lower = Math.max(5, upper * 0.78);
      const x = (padX + i * slot + (slot - bw) / 2).toFixed(2);
      const r = (bw / 2).toFixed(2);
      parts.push(`<rect x="${x}" y="${(midY - gap - upper).toFixed(2)}" width="${bw.toFixed(2)}" height="${upper.toFixed(2)}" rx="${r}" fill="${paintH}"/>`);
      parts.push(`<rect x="${x}" y="${(midY + gap).toFixed(2)}" width="${bw.toFixed(2)}" height="${lower.toFixed(2)}" rx="${r}" fill="${paintH}" opacity="0.58"/>`);
    }
    body = parts.join("");
  } else {
    const padX = width * 0.05;
    const span = width - padX * 2;
    const slot = span / peaks.length;
    const bw = Math.max(3, slot * 0.66);
    const baseY = height * 0.82;
    const maxH = height * 0.68;
    const parts = [
      `<line x1="${padX.toFixed(1)}" y1="${(baseY + 4).toFixed(1)}" x2="${(width - padX).toFixed(1)}" y2="${(baseY + 4).toFixed(1)}" stroke="${paintH}" stroke-width="2" opacity="0.38"/>`
    ];
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(8, peaks[i] * maxH);
      const x = (padX + i * slot + (slot - bw) / 2).toFixed(2);
      const y = (baseY - h).toFixed(2);
      parts.push(`<rect x="${x}" y="${y}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(6, bw / 2).toFixed(2)}" fill="${paintV}"/>`);
    }
    body = parts.join("");
  }

  const label = title
    ? `<text x="${width / 2}" y="${height - 20}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="22" fill="${esc(primaryColor)}" opacity="0.9">${esc(title)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${gradDef}${bgRect}${body}${label}</svg>`;
}

function resamplePeaks(peaks, target) {
  if (!peaks || peaks.length === 0) {
    return Array.from({ length: target }, (_, i) => 0.25 + 0.65 * Math.abs(Math.sin(i * 0.28)));
  }
  const out = new Array(target);
  for (let i = 0; i < target; i++) {
    const start = Math.floor((i / target) * peaks.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / target) * peaks.length));
    let m = 0;
    for (let j = start; j < end && j < peaks.length; j++) if (peaks[j] > m) m = peaks[j];
    out[i] = m;
  }
  return out;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
