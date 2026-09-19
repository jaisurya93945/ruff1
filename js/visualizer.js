/* ═══════════════════════════════════════════════════════════
   AURA · visualizer — six canvas modes sharing one rAF loop.
   Reads the live AnalyserNode; degrades to a gentle idle
   animation when there is no audio graph (or nothing playing).
   ═══════════════════════════════════════════════════════════ */
import { fitCanvas, clamp, lerp } from './util.js';

export const VIZ_MODES = [
  { id: 'bars',      name: 'Spectrum',  hint: 'mirrored frequency bars' },
  { id: 'ribbon',    name: 'Ribbon',    hint: 'flowing waveform' },
  { id: 'radial',    name: 'Radial',    hint: 'spectrum ring' },
  { id: 'particles', name: 'Starfield', hint: 'bass-driven particles' },
  { id: 'aurora',    name: 'Aurora',    hint: 'soft light curtains' },
  { id: 'terrain',   name: 'Terrain',   hint: 'scrolling spectrogram' },
];

/**
 * Bin ranges for `bands` bars spread logarithmically over the audible
 * range. A power curve wastes half the bars above 8 kHz, where most
 * encoded music is already silent; octaves are how we actually hear.
 */
const binCache = new Map();
export function logBands(bands, binCount, nyquist, fMin = 32, fMax = 14000) {
  const key = `${bands}|${binCount}|${nyquist}|${fMin}|${fMax}`;
  const hit = binCache.get(key);
  if (hit) return hit;

  const top = Math.min(fMax, nyquist * 0.94);
  const ratio = top / fMin;
  const table = new Uint16Array(bands * 2);
  for (let i = 0; i < bands; i++) {
    const f0 = fMin * Math.pow(ratio, i / bands);
    const f1 = fMin * Math.pow(ratio, (i + 1) / bands);
    let lo = Math.floor(f0 / nyquist * binCount);
    let hi = Math.ceil(f1 / nyquist * binCount);
    lo = Math.max(0, Math.min(binCount - 1, lo));
    hi = Math.max(lo + 1, Math.min(binCount, hi));
    table[i * 2] = lo;
    table[i * 2 + 1] = hi;
  }
  binCache.set(key, table);
  return table;
}

/** read a CSS custom property off :root */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Visualizer {
  constructor(canvas, engine, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.engine = engine;
    this.mode = opts.mode ?? 0;
    this.intensity = opts.intensity ?? 1;
    this.mirror = opts.mirror ?? true;
    this.running = false;
    this.t = 0;
    this.smooth = null;        // smoothed spectrum
    this.particles = [];
    this.terrain = [];
    this.colors = { a: '#ff7eb6', b: '#ffa8d2', c: '#b96cf0' };
    this._onResize = () => { this._sized = false; };
    this.refreshColors();
  }

  refreshColors() {
    this.colors.a = cssVar('--accent', '#ff7eb6');
    this.colors.b = cssVar('--accent-2', '#ffa8d2');
    this.colors.c = cssVar('--accent-3', '#b96cf0');
  }

  setMode(i) {
    this.mode = ((i % VIZ_MODES.length) + VIZ_MODES.length) % VIZ_MODES.length;
    this.particles.length = 0;
    this.terrain.length = 0;
    return VIZ_MODES[this.mode];
  }
  nextMode() { return this.setMode(this.mode + 1); }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('resize', this._onResize);
    this._loop();
  }
  stop() {
    this.running = false;
    window.removeEventListener('resize', this._onResize);
    cancelAnimationFrame(this._raf);
  }

  _loop = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    if (document.hidden) return;
    this.draw();
  };

  draw() {
    const { canvas, ctx } = this;
    if (!canvas.isConnected || !canvas.offsetParent && canvas.offsetWidth === 0) return;

    const { w, h, dpr } = fitCanvas(canvas, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr, H = h / dpr;
    ctx.clearRect(0, 0, W, H);
    this.t += 0.016;

    const freq = this.engine.getFrequency?.();
    const wave = this.engine.getWaveform?.();
    const spectrum = this._smoothed(freq);

    const draw = [this._bars, this._ribbon, this._radial, this._particles, this._aurora, this._terrain][this.mode];
    draw.call(this, ctx, W, H, spectrum, wave);
  }

  /** smooth the spectrum over time so bars don't strobe */
  _smoothed(freq) {
    const N = 96;
    if (!this.smooth) this.smooth = new Float32Array(N);
    if (!freq || !freq.length) {
      // idle breathing when nothing is playing
      for (let i = 0; i < N; i++) {
        const idle = 0.055 * (1 + Math.sin(this.t * 1.5 + i * 0.22)) * (1 - i / N) ** 0.8;
        this.smooth[i] = lerp(this.smooth[i], idle, 0.06);
      }
      return this.smooth;
    }
    const len = freq.length;
    const nyquist = (this.engine.ctx?.sampleRate || 48000) / 2;
    const bands = logBands(N, len, nyquist);

    for (let i = 0; i < N; i++) {
      const lo = bands[i * 2], hi = bands[i * 2 + 1];
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += freq[j];
      const v = (sum / (hi - lo)) / 255;
      // even spread across octaves, the top still sits quieter — tilt it up
      const boosted = clamp(v * (1 + Math.pow(i / N, 1.2) * 1.5), 0, 1) * this.intensity;
      this.smooth[i] = lerp(this.smooth[i], boosted, boosted > this.smooth[i] ? 0.44 : 0.13);
    }
    return this.smooth;
  }

  _grad(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, this.colors.a);
    g.addColorStop(0.5, this.colors.b);
    g.addColorStop(1, this.colors.c);
    return g;
  }

  /* ── 0 · mirrored spectrum bars ────────────────────────── */
  _bars(ctx, W, H, s) {
    const N = s.length;
    const gap = W > 700 ? 3 : 2;
    const bw = Math.max(1.5, (W - gap * (N - 1)) / N);
    const base = this.mirror ? H * 0.5 : H;
    ctx.fillStyle = this._grad(ctx, 0, H, W, 0);
    ctx.shadowBlur = 18;
    ctx.shadowColor = this.colors.a;

    for (let i = 0; i < N; i++) {
      const v = s[i];
      const bh = Math.max(1.5, v * (this.mirror ? H * 0.46 : H * 0.9));
      const x = i * (bw + gap);
      const r = Math.min(bw / 2, 3);
      // a band with no content fades away rather than drawing a flat stub,
      // which otherwise reads as a dashed line across the whole width
      ctx.globalAlpha = clamp(v * 9, 0.06, 1);
      roundRect(ctx, x, base - bh, bw, bh, r);
      ctx.fill();
      if (this.mirror) {
        ctx.globalAlpha *= 0.3;
        roundRect(ctx, x, base, bw, bh * 0.62, r);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ── 1 · waveform ribbon ───────────────────────────────── */
  _ribbon(ctx, W, H, s, wave) {
    const mid = H / 2;
    const layers = 3;
    ctx.lineCap = 'round';

    for (let L = 0; L < layers; L++) {
      const amp = (H * 0.34) * (1 - L * 0.26);
      const phase = this.t * (0.8 + L * 0.35);
      ctx.beginPath();
      const N = wave?.length || 256;
      const step = Math.max(1, Math.floor(N / Math.min(W, 420)));
      let first = true;
      for (let i = 0; i < N; i += step) {
        const x = (i / (N - 1)) * W;
        const v = wave ? (wave[i] - 128) / 128 : Math.sin(i * 0.05 + phase) * 0.22;
        const env = Math.sin((i / N) * Math.PI);          // taper the ends
        const y = mid + v * amp * env + Math.sin(x * 0.012 + phase) * 6 * (L + 1);
        first ? (ctx.moveTo(x, y), first = false) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = [this.colors.a, this.colors.b, this.colors.c][L];
      ctx.globalAlpha = 0.9 - L * 0.26;
      ctx.lineWidth = 2.6 - L * 0.6;
      ctx.shadowBlur = 22 - L * 6;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ── 2 · radial spectrum ring ──────────────────────────── */
  _radial(ctx, W, H, s) {
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.29;
    const N = s.length;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 16;

    let bass = 0;
    for (let i = 0; i < 8; i++) bass += s[i];
    bass /= 8;

    // pulsing halo
    ctx.beginPath();
    ctx.arc(cx, cy, R * (1 + bass * 0.12), 0, Math.PI * 2);
    ctx.strokeStyle = this.colors.a;
    ctx.globalAlpha = 0.24 + bass * 0.4;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = this.colors.a;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const grad = this._grad(ctx, cx - R, cy - R, cx + R, cy + R);
    ctx.strokeStyle = grad;
    ctx.shadowColor = this.colors.b;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 - Math.PI / 2 + this.t * 0.06;
      const len = 6 + s[i] * Math.min(W, H) * 0.19;
      const r0 = R * (1 + bass * 0.08) + 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
      ctx.lineWidth = 2.6;
      ctx.globalAlpha = 0.45 + s[i] * 0.55;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ── 3 · bass-driven starfield ─────────────────────────── */
  _particles(ctx, W, H, s) {
    let bass = 0;
    for (let i = 0; i < 10; i++) bass += s[i];
    bass /= 10;
    let treble = 0;
    for (let i = 60; i < s.length; i++) treble += s[i];
    treble /= (s.length - 60);

    const want = Math.min(180, 60 + Math.floor(bass * 150));
    while (this.particles.length < want) this.particles.push(newParticle(W, H));
    if (this.particles.length > want + 40) this.particles.length = want;

    const cx = W / 2, cy = H / 2;
    for (const p of this.particles) {
      p.z -= (0.6 + bass * 5.5) * p.speed;
      if (p.z <= 0.05) Object.assign(p, newParticle(W, H), { z: 1 });
      const k = 0.9 / p.z;
      const x = cx + p.x * k;
      const y = cy + p.y * k;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) { Object.assign(p, newParticle(W, H), { z: 1 }); continue; }
      const r = clamp((1 - p.z) * 2.6 + bass * 2.2, 0.4, 5);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.hue < 0.4 ? this.colors.a : p.hue < 0.75 ? this.colors.b : this.colors.c;
      ctx.globalAlpha = clamp((1 - p.z) * 0.95, 0, 1) * (0.5 + treble * 0.6);
      ctx.shadowBlur = 12; ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ── 4 · aurora curtains ───────────────────────────────── */
  _aurora(ctx, W, H, s) {
    let low = 0;
    for (let i = 0; i < 20; i++) low += s[i];
    low /= 20;

    ctx.globalCompositeOperation = 'lighter';
    const bands = 4;
    for (let b = 0; b < bands; b++) {
      const hueColor = [this.colors.a, this.colors.b, this.colors.c, this.colors.a][b];
      const yBase = H * (0.32 + b * 0.13);
      const amp = H * (0.09 + low * 0.2) * (1 - b * 0.12);
      const speed = this.t * (0.35 + b * 0.16);

      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) {
        const n = Math.sin(x * 0.006 + speed) * 0.6 + Math.sin(x * 0.014 - speed * 1.4) * 0.4;
        const idx = Math.floor((x / W) * s.length);
        ctx.lineTo(x, yBase + n * amp - s[idx] * H * 0.12);
      }
      ctx.lineTo(W, H);
      ctx.closePath();

      const g = ctx.createLinearGradient(0, yBase - amp, 0, H);
      g.addColorStop(0, hueColor);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.14 + low * 0.2;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /* ── 5 · scrolling spectrogram terrain ─────────────────── */
  _terrain(ctx, W, H, s) {
    const ROWS = 34;
    this.terrain.push(Float32Array.from(s));
    if (this.terrain.length > ROWS) this.terrain.shift();

    const horizon = H * 0.26;
    for (let r = 0; r < this.terrain.length; r++) {
      const row = this.terrain[r];
      const depth = r / ROWS;                                   // 0 = oldest/far
      const y0 = horizon + Math.pow(depth, 1.7) * (H - horizon);
      const squeeze = 0.34 + depth * 0.66;
      const amp = (H - horizon) * 0.19 * (0.35 + depth);

      ctx.beginPath();
      for (let i = 0; i < row.length; i++) {
        const x = W / 2 + ((i / (row.length - 1)) - 0.5) * W * squeeze;
        const y = y0 - row[i] * amp;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = depth > 0.62 ? this.colors.a : depth > 0.3 ? this.colors.b : this.colors.c;
      ctx.globalAlpha = 0.14 + depth * 0.66;
      ctx.lineWidth = 0.6 + depth * 1.7;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function newParticle(W, H) {
  return {
    x: (Math.random() - 0.5) * W * 1.6,
    y: (Math.random() - 0.5) * H * 1.6,
    z: Math.random() * 0.9 + 0.1,
    speed: 0.4 + Math.random() * 1.2,
    hue: Math.random(),
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ═══════════════════════════════════════════════════════════
   The thin ring that hugs the album art in Now Playing
   ═══════════════════════════════════════════════════════════ */
export class CoverRing {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.smooth = new Float32Array(72);
    this.running = false;
  }
  start() { if (!this.running) { this.running = true; this._loop(); } }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  _loop = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    if (document.hidden) return;
    this.draw();
  };
  draw() {
    const { w, h, dpr } = fitCanvas(this.canvas, 2);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr, H = h / dpr;
    ctx.clearRect(0, 0, W, H);

    const freq = this.engine.getFrequency?.();
    const N = this.smooth.length;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.425;   // just clear of the cover's edge
    const accent = cssVar('--accent', '#ff7eb6');
    const accent2 = cssVar('--accent-2', '#ffa8d2');
    const nyquist = (this.engine.ctx?.sampleRate || 48000) / 2;
    const bands = logBands(N, freq?.length || 1024, nyquist);

    ctx.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (freq) {
        const lo = bands[i * 2], hi = bands[i * 2 + 1];
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += freq[j];
        v = clamp((sum / (hi - lo)) / 255 * (1 + Math.pow(i / N, 1.2) * 1.5), 0, 1);
      } else {
        v = 0.05 + 0.04 * Math.sin(performance.now() / 700 + i * 0.4);
      }
      this.smooth[i] = lerp(this.smooth[i], v, v > this.smooth[i] ? 0.5 : 0.12);

      const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
      const len = 3 + this.smooth[i] * Math.min(W, H) * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.lineTo(cx + Math.cos(ang) * (R + len), cy + Math.sin(ang) * (R + len));
      ctx.strokeStyle = i % 2 ? accent : accent2;
      ctx.globalAlpha = 0.35 + this.smooth[i] * 0.65;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = accent;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
