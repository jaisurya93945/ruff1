/* ═══════════════════════════════════════════════════════════
   AURA · eqgraph — the equalizer as a curve you drag.

   Ten vertical sliders tell you nothing about what the filters
   are actually doing to the sound. This draws the real combined
   response, straight out of the BiquadFilterNodes via
   getFrequencyResponse(), so neighbouring bands visibly overlap
   and interact the way they really do — with the live spectrum
   behind it for context.

   Drag a node to change its band. Works with mouse and touch.
   ═══════════════════════════════════════════════════════════ */
import { clamp, fitCanvas } from './util.js';

const F_MIN = 20, F_MAX = 20000;
const DB_RANGE = 14;              // a little headroom past the ±12 limit
const CURVE_POINTS = 200;

const GRID_HZ = [
  { f: 50, label: '50' }, { f: 100, label: '100' }, { f: 200, label: '200' },
  { f: 500, label: '500' }, { f: 1000, label: '1k' }, { f: 2000, label: '2k' },
  { f: 5000, label: '5k' }, { f: 10000, label: '10k' },
];

export class EQGraph {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} engine       the AURA engine (needs .eq, .bass, .analyser)
   * @param {number[]} gains      live reference to the gain array
   * @param {(i:number, db:number)=>void} onChange
   */
  constructor(canvas, engine, gains, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.gains = gains;
    this.onChange = onChange;
    this.bands = engine.eq || [];
    this.active = -1;          // index being dragged
    this.hover = -1;
    this.running = false;
    this.spectrum = null;

    this._freqs = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) {
      this._freqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (CURVE_POINTS - 1));
    }
    this._mag = new Float32Array(CURVE_POINTS);
    this._phase = new Float32Array(CURVE_POINTS);
    this._total = new Float32Array(CURVE_POINTS);
    this._smoothSpec = new Float32Array(CURVE_POINTS);

    this._bind();
  }

  /* ── coordinate mapping ────────────────────────────────── */
  get pad() { return { l: 34, r: 18, t: 14, b: 21 }; }   // r leaves room for the 16k handle
  xOf(f, W) {
    const p = this.pad;
    const inner = W - p.l - p.r;
    return p.l + (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * inner;
  }
  fOf(x, W) {
    const p = this.pad;
    const inner = W - p.l - p.r;
    return F_MIN * Math.pow(F_MAX / F_MIN, clamp((x - p.l) / inner, 0, 1));
  }
  yOf(db, H) {
    const p = this.pad;
    const inner = H - p.t - p.b;
    return p.t + (0.5 - db / (DB_RANGE * 2)) * inner;
  }
  dbOf(y, H) {
    const p = this.pad;
    const inner = H - p.t - p.b;
    return (0.5 - (y - p.t) / inner) * (DB_RANGE * 2);
  }

  /* ── interaction ───────────────────────────────────────── */
  _bind() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';

    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
    };

    const nearest = ({ x, y, W, H }) => {
      let best = -1, bestD = Infinity;
      this.bands.forEach((band, i) => {
        const bx = this.xOf(band.frequency.value, W);
        const by = this.yOf(this.gains[i], H);
        // weight x heavily: bands are chosen by frequency, nudged by height
        const d = Math.hypot((x - bx) * 1.6, (y - by) * 0.55);
        if (d < bestD) { bestD = d; best = i; }
      });
      return bestD < 70 ? best : -1;
    };

    cv.addEventListener('pointerdown', (e) => {
      const pt = local(e);
      const i = nearest(pt);
      if (i < 0) return;
      this.active = i;
      cv.setPointerCapture?.(e.pointerId);
      this._apply(i, this.dbOf(pt.y, pt.H));
      e.preventDefault();
    });

    cv.addEventListener('pointermove', (e) => {
      const pt = local(e);
      if (this.active >= 0) {
        this._apply(this.active, this.dbOf(pt.y, pt.H));
        e.preventDefault();
      } else {
        const h = nearest(pt);
        if (h !== this.hover) { this.hover = h; cv.style.cursor = h >= 0 ? 'grab' : 'default'; }
      }
    });

    const end = () => { this.active = -1; this.canvas.style.cursor = this.hover >= 0 ? 'grab' : 'default'; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (this.active < 0) { this.hover = -1; cv.style.cursor = 'default'; } });

    // double-tap a node to zero it
    cv.addEventListener('dblclick', (e) => {
      const i = nearest(local(e));
      if (i >= 0) this._apply(i, 0);
    });
  }

  _apply(i, db) {
    const v = Math.round(clamp(db, -12, 12) * 2) / 2;     // 0.5 dB steps
    if (v === this.gains[i]) return;
    this.gains[i] = v;
    this.onChange?.(i, v);
  }

  /* ── loop ──────────────────────────────────────────────── */
  start() { if (!this.running) { this.running = true; this._loop(); } }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  _loop = () => {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    if (document.hidden || !this.canvas.isConnected) return;
    this.draw();
  };

  /** true combined response of every filter in the chain */
  _response() {
    const total = this._total.fill(1);
    const chain = [...this.bands];
    if (this.engine.bass) chain.push(this.engine.bass);
    for (const f of chain) {
      try {
        f.getFrequencyResponse(this._freqs, this._mag, this._phase);
        for (let i = 0; i < CURVE_POINTS; i++) total[i] *= this._mag[i];
      } catch { /* a filter not ready yet — skip it */ }
    }
    return total;
  }

  draw() {
    const { canvas, ctx } = this;
    const { w, h, dpr } = fitCanvas(canvas, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr, H = h / dpr;
    ctx.clearRect(0, 0, W, H);

    const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
    const accent = css('--accent', '#ff7eb6');
    const accent2 = css('--accent-2', '#ffa8d2');
    const accent3 = css('--accent-3', '#b96cf0');
    const stroke = css('--stroke', '#ffffff18');
    const text3 = css('--text-3', '#7d7590');
    const p = this.pad;

    /* ── live spectrum, behind everything ── */
    const freq = this.engine.getFrequency?.();
    if (freq) {
      const nyq = (this.engine.ctx?.sampleRate || 48000) / 2;
      ctx.beginPath();
      ctx.moveTo(p.l, H - p.b);
      for (let i = 0; i < CURVE_POINTS; i++) {
        const bin = Math.min(freq.length - 1, Math.round(this._freqs[i] / nyq * freq.length));
        const v = freq[bin] / 255;
        this._smoothSpec[i] = this._smoothSpec[i] * 0.72 + v * 0.28;
        const x = this.xOf(this._freqs[i], W);
        const y = (H - p.b) - this._smoothSpec[i] * (H - p.t - p.b) * 0.92;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W - p.r, H - p.b);
      ctx.closePath();
      const sg = ctx.createLinearGradient(0, p.t, 0, H - p.b);
      sg.addColorStop(0, accent + '44');
      sg.addColorStop(1, accent + '08');
      ctx.fillStyle = sg;
      ctx.fill();
    }

    /* ── grid ── */
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = text3;

    for (const db of [12, 6, 0, -6, -12]) {
      const y = Math.round(this.yOf(db, H)) + 0.5;
      ctx.beginPath();
      ctx.setLineDash(db === 0 ? [] : [3, 4]);
      ctx.moveTo(p.l, y); ctx.lineTo(W - p.r, y);
      ctx.globalAlpha = db === 0 ? 0.9 : 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(db > 0 ? `+${db}` : `${db}`, p.l - 6, y);
    }
    ctx.setLineDash([]);

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const g of GRID_HZ) {
      const x = Math.round(this.xOf(g.f, W)) + 0.5;
      if (x < p.l || x > W - p.r) continue;
      ctx.beginPath();
      ctx.setLineDash([3, 5]);
      ctx.moveTo(x, p.t); ctx.lineTo(x, H - p.b);
      ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(g.label, x, H - p.b + 5);
    }
    ctx.setLineDash([]);

    /* ── the response curve ── */
    const mag = this._response();
    ctx.beginPath();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const db = 20 * Math.log10(Math.max(mag[i], 1e-6));
      const x = this.xOf(this._freqs[i], W);
      const y = this.yOf(clamp(db, -DB_RANGE, DB_RANGE), H);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }

    // fill between the curve and the 0 dB line
    const zero = this.yOf(0, H);
    ctx.save();
    ctx.lineTo(W - p.r, zero);
    ctx.lineTo(p.l, zero);
    ctx.closePath();
    const fg = ctx.createLinearGradient(p.l, 0, W - p.r, 0);
    fg.addColorStop(0, accent + '3a');
    fg.addColorStop(0.5, accent2 + '3a');
    fg.addColorStop(1, accent3 + '3a');
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.restore();

    // the line itself
    ctx.beginPath();
    for (let i = 0; i < CURVE_POINTS; i++) {
      const db = 20 * Math.log10(Math.max(mag[i], 1e-6));
      const x = this.xOf(this._freqs[i], W);
      const y = this.yOf(clamp(db, -DB_RANGE, DB_RANGE), H);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const lg = ctx.createLinearGradient(p.l, 0, W - p.r, 0);
    lg.addColorStop(0, accent);
    lg.addColorStop(0.5, accent2);
    lg.addColorStop(1, accent3);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 12;
    ctx.shadowColor = accent;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* ── band handles ── */
    this.bands.forEach((band, i) => {
      const r0 = 11;
      const x = clamp(this.xOf(band.frequency.value, W), p.l + r0, W - p.r - r0);
      const y = this.yOf(this.gains[i], H);
      const on = i === this.active;
      const hot = on || i === this.hover;
      const r = on ? 9 : hot ? 8 : 6.5;

      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = accent + (hot ? '3a' : '1e');
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hot ? '#fff' : accent;
      ctx.strokeStyle = css('--bg-1', '#12101a');
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      if (on) {
        const label = `${this.gains[i] > 0 ? '+' : ''}${this.gains[i].toFixed(1)} dB`;
        ctx.font = '600 11px ui-monospace, monospace';
        const tw = ctx.measureText(label).width + 12;
        const bx = clamp(x - tw / 2, p.l, W - p.r - tw);
        const by = clamp(y - 30, p.t, H - p.b - 22);
        ctx.fillStyle = css('--bg-2', '#1a1524');
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, tw, 20, 6);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = css('--text', '#fff');
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + tw / 2, by + 10);
      }
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
