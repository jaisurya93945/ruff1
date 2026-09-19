/* ═══════════════════════════════════════════════════════════
   AURA · util — tiny helpers, no dependencies
   ═══════════════════════════════════════════════════════════ */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('div.card', {onclick}, [children]) — terse element builder */
export function el(spec, props = {}, kids = []) {
  const [tagPart, ...classes] = String(spec).split('.');
  const [tag, id] = tagPart.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className += ' ' + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const kid of [kids].flat(3)) {
    // `cond && el(...)` short-circuits to false/0/'' — those are absences,
    // not content. A genuine "0" label is passed as the string '0'.
    if (kid == null || kid === false || kid === '' || kid === 0) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(kid));
  }
  return node;
}

/** icon(name) → <svg class="ico"><use href="#i-name"/></svg> */
export function icon(name, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

export const clamp = (n, lo, hi) => n < lo ? lo : n > hi ? hi : n;
export const lerp  = (a, b, t) => a + (b - a) * t;
export const rand  = (a, b) => a + Math.random() * (b - a);
export const uid   = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 214 → "3:34" · 4021 → "1:07:01" */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}

/** 5_400_000ms → "1h 30m" */
export function fmtSpan(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
}

export function fmtCount(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

export function debounce(fn, ms = 160) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms = 60) {
  let last = 0, queued = null;
  return (...a) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(queued); queued = setTimeout(() => { last = performance.now(); fn(...a); }, ms - (now - last)); }
  };
}
export const raf = (fn) => requestAnimationFrame(fn);
export const nextFrame = () => new Promise(r => requestAnimationFrame(r));
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Fisher–Yates, returns a new array */
export function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── fuzzy search ─────────────────────────────────────────── */
/** subsequence score: higher = better, 0 = no match */
export function fuzzyScore(needle, haystack) {
  if (!needle) return 1;
  const n = needle.toLowerCase(), h = String(haystack || '').toLowerCase();
  if (!h) return 0;
  const direct = h.indexOf(n);
  if (direct === 0) return 1000;            // prefix — strongest
  if (direct > 0) return 700 - direct;      // substring
  let hi = 0, score = 0, streak = 0;
  for (let i = 0; i < n.length; i++) {
    const idx = h.indexOf(n[i], hi);
    if (idx === -1) return 0;
    streak = idx === hi ? streak + 1 : 0;
    score += 12 + streak * 6 - Math.min(idx - hi, 8);
    hi = idx + 1;
  }
  return Math.max(score, 1);
}

/** rank tracks against a query across title/artist/album */
export function searchTracks(tracks, query) {
  const q = query.trim();
  if (!q) return tracks;
  const terms = q.split(/\s+/);
  return tracks
    .map(t => {
      let total = 0;
      for (const term of terms) {
        const s = Math.max(
          fuzzyScore(term, t.title) * 1.0,
          fuzzyScore(term, t.artist) * 0.85,
          fuzzyScore(term, t.album) * 0.7,
          fuzzyScore(term, (t.genre || []).join(' ')) * 0.5,
        );
        if (!s) return null;
        total += s;
      }
      return { t, total };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total)
    .map(r => r.t);
}

/* ── colour helpers ───────────────────────────────────────── */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}
export const hsl = (h, s, l) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;

/* ── persistent settings (localStorage, namespaced, safe) ─── */
const NS = 'aura:';
export const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(NS + key, JSON.stringify(val)); return true; }
    catch { return false; }   // private mode / quota — degrade silently
  },
  del(key) { try { localStorage.removeItem(NS + key); } catch {} },
};

/* ── feature probes ───────────────────────────────────────── */
export const supports = {
  get audioCtx()   { return !!(window.AudioContext || window.webkitAudioContext); },
  get mediaSession(){ return 'mediaSession' in navigator; },
  get broadcast()  { return 'BroadcastChannel' in window; },
  get vibrate()    { return 'vibrate' in navigator; },
  get wakeLock()   { return 'wakeLock' in navigator; },
  get share()      { return 'share' in navigator; },
  get fsAccess()   { return 'showOpenFilePicker' in window; },
  get touch()      { return matchMedia('(hover:none)').matches; },
  get reducedMotion(){ return matchMedia('(prefers-reduced-motion:reduce)').matches; },
};

export const haptic = (ms = 12) => { try { supports.vibrate && navigator.vibrate(ms); } catch {} };

/** Read a File as ArrayBuffer */
export const readBuffer = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error);
  fr.readAsArrayBuffer(file);
});
export const readText = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error);
  fr.readAsText(file);
});

/** download a blob/dataURL under a filename */
export function download(data, filename) {
  const url = data instanceof Blob ? URL.createObjectURL(data) : data;
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  if (data instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** size a canvas to its CSS box at device pixel ratio; returns {w,h,dpr} */
export function fitCanvas(canvas, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w, h, dpr, cssW: r.width, cssH: r.height };
}

/** ratio of a pointer/touch event across an element, 0..1 */
export function pointerRatio(ev, node) {
  const r = node.getBoundingClientRect();
  const x = (ev.touches?.[0]?.clientX ?? ev.clientX) - r.left;
  return clamp(x / r.width, 0, 1);
}
