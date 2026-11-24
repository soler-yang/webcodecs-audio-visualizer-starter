/**
 * Pure-JS Static Vector SVG & High-Res PNG Soundwave Art Generator.
 * Serves /sound-wave-generator (tattoo, poster, podcast logo, print-ready vector soundwaves).
 */

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
  const bgRect = bgColor && bgColor !== "transparent"
    ? `<rect width="${width}" height="${height}" fill="${esc(bgColor)}"/>`
    : "";
  const gradDef = `<defs><linearGradient id="swGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="${esc(primaryColor)}"/><stop offset="100%" stop-color="${esc(secondaryColor)}"/></linearGradient></defs>`;

  let body = "";
  if (style === "radial") {
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;
    const r0 = size * 0.22;
    const maxLen = size * 0.24;
    const parts = [];
    for (let i = 0; i < peaks.length; i++) {
      const a = (i / peaks.length) * Math.PI * 2 - Math.PI / 2;
      const len = Math.max(4, peaks[i] * maxLen);
      const x1 = (cx + Math.cos(a) * r0).toFixed(2);
      const y1 = (cy + Math.sin(a) * r0).toFixed(2);
      const x2 = (cx + Math.cos(a) * (r0 + len)).toFixed(2);
      const y2 = (cy + Math.sin(a) * (r0 + len)).toFixed(2);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="url(#swGrad)" stroke-width="5" stroke-linecap="round"/>`);
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
    body = `<path d="${pts.join(" ")}" fill="none" stroke="url(#swGrad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    // "bars" or "mirror" (symmetrical rounded soundwave pills)
    const padX = width * 0.05;
    const span = width - padX * 2;
    const slot = span / peaks.length;
    const bw = Math.max(3, slot * 0.62);
    const midY = height / 2;
    const maxHalf = height * 0.40;
    const rects = [];
    for (let i = 0; i < peaks.length; i++) {
      const half = Math.max(6, peaks[i] * maxHalf);
      const x = (padX + i * slot + (slot - bw) / 2).toFixed(2);
      const y = (midY - half).toFixed(2);
      const h = (half * 2).toFixed(2);
      rects.push(`<rect x="${x}" y="${y}" width="${bw.toFixed(2)}" height="${h}" rx="${(bw / 2).toFixed(2)}" fill="url(#swGrad)"/>`);
    }
    body = rects.join("");
  }

  const label = title
    ? `<text x="${width / 2}" y="${height - 22}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="600" font-size="22" fill="${esc(primaryColor)}" opacity="0.9">${esc(title)}</text>`
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
