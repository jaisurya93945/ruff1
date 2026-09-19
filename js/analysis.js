/* ═══════════════════════════════════════════════════════════
   AURA · analysis — everything derived from the audio itself:
   waveform peaks, track energy, live beat detection, and the
   accent colour pulled out of the album art.
   ═══════════════════════════════════════════════════════════ */
import { clamp, rgbToHsl } from './util.js';
import { peaks as peakStore, meta } from './db.js';
import { blobs } from './db.js';

export const PEAK_BUCKETS = 1024;

/* ═══ waveform peaks ═══════════════════════════════════════ */

const inflight = new Map();

/**
 * Peaks for a track as a Float32Array of [min,max] pairs.
 * Cached in IndexedDB; decoding happens once per track, ever.
 */
export async function getPeaks(track, { buckets = PEAK_BUCKETS } = {}) {
  if (!track) return null;
  const key = peakKey(track);

  const cached = await peakStore.get(key);
  if (cached && cached.buckets === buckets) return cached;

  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const arrayBuf = await fetchAudioBuffer(track);
      if (!arrayBuf) return null;

      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;

      // a short-lived context purely for decoding
      const tmp = new AC();
      let audioBuf;
      try { audioBuf = await tmp.decodeAudioData(arrayBuf); }
      finally { tmp.close?.(); }
      if (!audioBuf) return null;

      const data = computePeaks(audioBuf, buckets);
      const result = { data, duration: audioBuf.duration, buckets };
      await peakStore.put(key, data, audioBuf.duration, buckets);

      // while we have the samples, bank the energy profile too
      const energy = computeEnergy(audioBuf);
      await meta.set('energy:' + key, energy);

      return result;
    } catch (err) {
      console.info('[aura] peaks unavailable for', track.title, '—', err.message);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

function peakKey(track) {
  return track.blobKey ? 'b:' + track.blobKey : 's:' + track.src;
}

async function fetchAudioBuffer(track) {
  if (track.blobKey) {
    const blob = await blobs.get(track.blobKey);
    if (blob) return blob.arrayBuffer();
  }
  if (!track.src) return null;
  const res = await fetch(track.src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** min/max pairs, mixed to mono */
function computePeaks(audioBuf, buckets) {
  const chans = Math.min(audioBuf.numberOfChannels, 2);
  const len = audioBuf.length;
  const step = Math.max(1, Math.floor(len / buckets));
  const out = new Float32Array(buckets * 2);
  const chData = [];
  for (let c = 0; c < chans; c++) chData.push(audioBuf.getChannelData(c));

  for (let b = 0; b < buckets; b++) {
    const start = b * step;
    const end = Math.min(len, start + step);
    let min = 0, max = 0;
    // stride large buckets — 512 samples is plenty to find the envelope
    const stride = Math.max(1, Math.floor((end - start) / 512));
    for (let i = start; i < end; i += stride) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += chData[c][i];
      v /= chans;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

/** a believable stand-in while the real peaks decode */
export function placeholderPeaks(seed = 1, buckets = 256) {
  const out = new Float32Array(buckets * 2);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let b = 0; b < buckets; b++) {
    const env = 0.35 + 0.45 * Math.sin((b / buckets) * Math.PI * 2.4) ** 2;
    const v = env * (0.45 + rnd() * 0.55);
    out[b * 2] = -v; out[b * 2 + 1] = v;
  }
  return out;
}

/* ═══ track energy — drives Mood DJ ════════════════════════ */

/** { rms, peak, energy 0..1, brightness 0..1 } */
function computeEnergy(audioBuf) {
  const ch = audioBuf.getChannelData(0);
  const n = ch.length;
  const stride = Math.max(1, Math.floor(n / 240000));   // ~240k samples is plenty
  let sumSq = 0, peak = 0, crossings = 0, count = 0, prev = 0;

  for (let i = 0; i < n; i += stride) {
    const v = ch[i];
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if ((v >= 0) !== (prev >= 0)) crossings++;
    prev = v;
    count++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count));
  const zcr = crossings / Math.max(1, count);
  return {
    rms,
    peak,
    brightness: clamp(zcr * 7, 0, 1),
    energy: clamp(rms * 3.1 * 0.7 + clamp(zcr * 7, 0, 1) * 0.3, 0, 1),
  };
}

export async function getEnergy(track) {
  if (!track) return null;
  const key = 'energy:' + peakKey(track);
  const cached = await meta.get(key);
  if (cached) return cached;
  return null;   // filled opportunistically by getPeaks()
}

/** cheap fallback when the file was never decoded: guess from metadata */
export function guessEnergy(track) {
  const g = (track.genre || []).join(' ').toLowerCase();
  const hot = /(dance|edm|electro|techno|house|trance|rock|metal|punk|rap|hip.?hop|party|workout|drill|phonk)/;
  const cool = /(ambient|lo.?fi|chill|acoustic|piano|sleep|classical|instrumental|romantic|ballad|sad|soft)/;
  if (hot.test(g)) return { energy: 0.78, brightness: 0.7, guessed: true };
  if (cool.test(g)) return { energy: 0.3, brightness: 0.35, guessed: true };
  return { energy: 0.52, brightness: 0.5, guessed: true };
}

/* ═══ live beat detection ══════════════════════════════════ */

export class BeatDetector {
  constructor({ history = 43, sensitivity = 1.32 } = {}) {
    this.hist = [];
    this.historyLen = history;
    this.sensitivity = sensitivity;
    this.lastBeat = 0;
    this.intervals = [];
    this.bpm = 0;
  }

  /** feed bass energy (0..1) each frame; returns true on a beat */
  push(energy, now = performance.now()) {
    this.hist.push(energy);
    if (this.hist.length > this.historyLen) this.hist.shift();
    if (this.hist.length < 12) return false;

    const avg = this.hist.reduce((a, b) => a + b, 0) / this.hist.length;
    const variance = this.hist.reduce((a, b) => a + (b - avg) ** 2, 0) / this.hist.length;
    // adaptive threshold: loud, dynamic passages need a higher bar
    const thresh = avg * this.sensitivity + Math.sqrt(variance) * 0.55;

    const gap = now - this.lastBeat;
    if (energy > thresh && energy > 0.055 && gap > 240) {
      if (gap < 2200) {
        this.intervals.push(gap);
        if (this.intervals.length > 14) this.intervals.shift();
        this.bpm = this._estimate();
      }
      this.lastBeat = now;
      return true;
    }
    return false;
  }

  _estimate() {
    if (this.intervals.length < 5) return this.bpm;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    // discard outliers more than 28% from the median
    const kept = this.intervals.filter(i => Math.abs(i - median) / median < 0.28);
    if (kept.length < 4) return this.bpm;
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    let bpm = 60000 / mean;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm);
  }

  reset() { this.hist.length = 0; this.intervals.length = 0; this.bpm = 0; this.lastBeat = 0; }
}

/* ═══ album-art colour extraction ══════════════════════════ */

const colorCache = new Map();

/**
 * Pull three usable accent colours out of an image.
 * Returns { accent, accent2, accent3, rgb } or null.
 */
export async function extractColors(src) {
  if (!src) return null;
  if (colorCache.has(src)) return colorCache.get(src);

  const result = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (v) => resolve(v);
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const S = 48;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);

        // bucket by hue, weight by saturation × mid-lightness
        const bins = new Array(24).fill(null).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const [h, s, l] = rgbToHsl(r, g, b);
          if (l < 0.12 || l > 0.94) continue;               // skip near-black / near-white
          const weight = s * (1 - Math.abs(l - 0.55) * 1.4);
          if (weight <= 0.02) continue;
          const bin = bins[Math.floor(h / 15) % 24];
          bin.w += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
        }

        const ranked = bins.filter(b => b.w > 0)
          .map(b => ({ w: b.w, rgb: [b.r / b.w, b.g / b.w, b.b / b.w] }))
          .sort((a, b) => b.w - a.w);

        if (!ranked.length) return done(null);

        const pick = (i) => {
          const c = ranked[Math.min(i, ranked.length - 1)].rgb;
          return liftForUi(c);
        };
        done({
          accent: pick(0),
          accent2: pick(1),
          accent3: pick(2),
          rgb: ranked[0].rgb.map(Math.round),
        });
      } catch { done(null); }
    };
    img.src = src;
  });

  colorCache.set(src, result);
  if (colorCache.size > 120) colorCache.delete(colorCache.keys().next().value);
  return result;
}

/** nudge a colour into a range that stays legible against dark *and* light UI */
function liftForUi([r, g, b]) {
  let [h, s, l] = rgbToHsl(r, g, b);
  s = clamp(s < 0.32 ? s + 0.3 : s, 0.42, 0.95);
  l = clamp(l, 0.52, 0.74);
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

/* ═══ energy arc for the Mood DJ ═══════════════════════════ */

/**
 * Order tracks along a target energy curve.
 * @param {Array} tracks
 * @param {number[]} curve  target energy 0..1, sampled across the set
 */
export function arrangeByCurve(tracks, curve, energyOf) {
  const pool = tracks.map(t => ({ t, e: energyOf(t) }));
  const out = [];
  const n = Math.min(tracks.length, curve.length ? tracks.length : 0);

  for (let i = 0; i < n && pool.length; i++) {
    const target = curve[Math.floor(i / Math.max(1, n - 1) * (curve.length - 1))] ?? 0.5;
    let bestIdx = 0, bestDist = Infinity;
    for (let j = 0; j < pool.length; j++) {
      const d = Math.abs(pool[j].e - target);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    out.push(pool.splice(bestIdx, 1)[0].t);
  }
  return out;
}

/** the classic DJ arc: warm up, peak, cool down */
export function arcPreset(name, points = 32) {
  const f = {
    journey: (x) => 0.28 + 0.62 * Math.sin(Math.PI * x) ** 1.4,
    climb:   (x) => 0.2 + 0.72 * x,
    wind:    (x) => 0.9 - 0.68 * x,
    steady:  () => 0.55,
    waves:   (x) => 0.5 + 0.34 * Math.sin(x * Math.PI * 3),
  }[name] || ((x) => 0.5 + 0.4 * Math.sin(Math.PI * x));
  return Array.from({ length: points }, (_, i) => clamp(f(i / (points - 1)), 0, 1));
}
