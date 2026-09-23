/* ═══════════════════════════════════════════════════════════
   AURA · themes — the palette registry, the picker dock, and
   the live "accent from album art" pipeline.
   ═══════════════════════════════════════════════════════════ */
import { $, el, icon, ls } from './util.js';
import { state, setSetting, emit } from './store.js';
import { extractColors } from './analysis.js';
import { blobs } from './db.js';
import { CHARACTERS } from './characters.js';

/** Each entry maps to a [data-theme] block in css/themes.css.
 *  `art` is a portrait in images/themes/ — drop your own
 *  <id>.png / .jpg / .webp there and it wins over the SVG. */
export const THEMES = [
  ...CHARACTERS.map(c => ({
    id: c.id, name: c.name, who: c.name, tag: c.tag, blurb: c.blurb,
    swatch: c.palette, lqip: c.lqip, size: c.size, hasArt: true,
  })),
  { id: 'mono', name: 'Null', who: 'Null', tag: 'no distractions',
    blurb: 'artwork off, nothing between you and the waveform',
    swatch: ['#e8e8ef', '#ffffff', '#9a9aab'], hasArt: false },
];

export const themeById = (id) => THEMES.find(t => t.id === id) || THEMES[0];

export const MORPHS = [
  { id:'glass',  name:'Glass',     hint:'frosted, translucent panels' },
  { id:'aurora', name:'Aurora',    hint:'tinted glass with a colour wash' },
  { id:'neu',    name:'Neumorph',  hint:'soft extruded surfaces' },
  { id:'flat',   name:'Flat',      hint:'no blur — fastest on old phones' },
];

const root = document.documentElement;
const artCache = new Map();

/* ── apply ────────────────────────────────────────────────── */
export function applyTheme(id) {
  const theme = THEMES.some(t => t.id === id) ? id : THEMES[0].id;
  root.dataset.theme = theme;
  setSetting('theme', theme);
  syncMetaColor();
  paintBackdrop(theme);
  emit('theme', { theme });
}
export function applyMode(mode) {
  root.dataset.mode = mode === 'light' ? 'light' : 'dark';
  setSetting('mode', root.dataset.mode);
  syncMetaColor();
  emit('theme', { mode: root.dataset.mode });
}
export function applyMorph(id) {
  const morph = MORPHS.find(m => m.id === id) ? id : 'glass';
  root.dataset.morph = morph;
  setSetting('morph', morph);
  emit('theme', { morph });
}
export function applyMotion(on) {
  root.dataset.motion = on ? 'on' : 'off';
  setSetting('motion', !!on);
}
export function applyPerf(level) {
  // 'auto' looks at the device; 'lite' drops every backdrop-filter
  const lite = level === 'lite' || (level === 'auto' && isLowPower());
  root.dataset.perf = lite ? 'lite' : 'full';
  setSetting('perf', level);
}

function isLowPower() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  return cores <= 4 && mem <= 4 && matchMedia('(max-width:820px)').matches;
}

function syncMetaColor() {
  const meta = document.querySelector('meta[name=theme-color]');
  if (!meta) return;
  const bg = getComputedStyle(root).getPropertyValue('--bg-0').trim();
  if (bg) meta.setAttribute('content', bg);
}

/** restore everything on boot */
export function initThemes() {
  const s = state.settings;
  // the theme list changed when the characters arrived; drop stale ids
  if (!THEMES.some(t => t.id === s.theme)) s.theme = THEMES[0].id;
  root.dataset.theme = s.theme;
  root.dataset.mode = s.mode;
  root.dataset.morph = s.morph;
  root.dataset.motion = (s.motion === false || s.motion === 'off') ? 'off' : 'on';
  applyPerf(s.perf);
  root.dataset.artcolor = s.artColor ? 'on' : 'off';
  syncMetaColor();
}

/* ═══════════════════════════════════════════════════════════
   Artwork resolution

   Three sources, best first:
     1. art you picked in-app        → IndexedDB, per device
     2. images/themes/overrides.json → committed to the repo
     3. images/chars/<id>.webp       → the bundled character

   (1) works from a phone without touching the repository.
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_ART = { focus: '50% 14%', fit: 'cover', scale: 1 };

/* one live object URL per theme, released before a replacement is minted */
const liveObjectURLs = new Map();
function releaseObjectURL(themeId) {
  const prev = liveObjectURLs.get(themeId);
  if (!prev) return;
  try { URL.revokeObjectURL(prev); } catch {}
  liveObjectURLs.delete(themeId);
}

let overridesPromise = null;
function loadOverrides() {
  overridesPromise ??= fetch('images/themes/overrides.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {}))
    .then(m => (m && typeof m === 'object' ? m : {}))
    .catch(() => ({}));
  return overridesPromise;
}

function normalise(entry, fallback) {
  if (typeof entry === 'string' && entry.trim()) return { ...DEFAULT_ART, backdrop: entry.trim(), card: entry.trim() };
  if (entry && typeof entry === 'object' && entry.src) {
    return { ...DEFAULT_ART, ...entry, backdrop: String(entry.src), card: String(entry.card || entry.src) };
  }
  return fallback;
}

/** @returns {Promise<{backdrop,card,lqip,focus,fit,scale,custom,none}>} */
export async function themeArt(themeId) {
  if (artCache.has(themeId)) return artCache.get(themeId);

  const resolved = (async () => {
    try {
      const rec = await customArt.get(themeId);
      if (rec?.blob) {
        // Each call used to mint a fresh blob URL and drop the previous one
        // on the floor — the browser holds the blob alive until the URL is
        // revoked, so swapping art repeatedly pinned every image in memory.
        releaseObjectURL(themeId);
        const url = URL.createObjectURL(rec.blob);
        liveObjectURLs.set(themeId, url);
        return { ...DEFAULT_ART, ...(rec.tune || {}), backdrop: url, card: url, lqip: '', custom: true };
      }
    } catch {}
    releaseObjectURL(themeId);

    const meta = themeById(themeId);
    const bundled = meta.hasArt
      ? { ...DEFAULT_ART, backdrop: `images/chars/${themeId}.webp`, card: `images/chars/${themeId}-card.webp`, lqip: meta.lqip || '' }
      : { ...DEFAULT_ART, backdrop: '', card: '', lqip: '', none: true };

    const map = await loadOverrides();
    return { ...normalise(map[themeId], bundled), custom: false };
  })();

  artCache.set(themeId, resolved);
  return resolved;
}

/* back-compat for callers that only want one URL */
export const portraitArt = themeArt;
export async function portraitURL(themeId) { return (await themeArt(themeId)).card; }

/** apply an art record to an element as a background */
export function paintArt(node, art, which = 'card') {
  if (!node || !art) return;
  const src = art[which] || art.card || art.backdrop;
  node.style.backgroundImage = src ? `url("${src}")` : 'none';
  node.style.backgroundSize = art.fit === 'contain' ? 'contain' : 'cover';
  node.style.backgroundPosition = art.focus || '50% 14%';
  node.style.backgroundRepeat = 'no-repeat';
  node.style.transform = art.scale && art.scale !== 1 ? `scale(${art.scale})` : '';
}

/* ── per-device custom art, stored as blobs in IndexedDB ──── */
export const customArt = {
  key: (id) => 'art:' + id,
  get(id) {
    return blobs.get(this.key(id)).then(v => (v && v.blob ? v : v ? { blob: v } : null));
  },
  async set(id, file, tune = {}) {
    if (!(file instanceof Blob)) return false;
    if (file.size > 12 * 1024 * 1024) throw new Error('That image is over 12 MB — resize it first.');
    await blobs.put(this.key(id), { blob: file, tune, at: Date.now() });
    artCache.delete(id);
    releaseObjectURL(id);
    emit('theme:art', { theme: id });
    return true;
  },
  async clear(id) {
    await blobs.del(this.key(id));
    artCache.delete(id);
    releaseObjectURL(id);
    emit('theme:art', { theme: id });
  },
  async has(id) { return !!(await this.get(id)); },
};

/* ═══════════════════════════════════════════════════════════
   The full-bleed backdrop
   The low-res placeholder is inlined in the registry, so the
   character is on screen the moment the CSS parses; the real
   image fades over it once decoded.
   ═══════════════════════════════════════════════════════════ */
let backdropToken = 0;

export async function paintBackdrop(themeId = state.settings.theme) {
  const lq = document.getElementById('bgCharLq');
  const hi = document.getElementById('bgCharHi');
  const host = document.getElementById('bgChar');
  if (!host) return;

  const token = ++backdropToken;
  const art = await themeArt(themeId);
  if (token !== backdropToken) return;

  if (art.none || !art.backdrop) {
    host.classList.remove('on');
    hi.style.backgroundImage = 'none';
    lq.style.backgroundImage = 'none';
    return;
  }

  host.classList.add('on');
  host.style.setProperty('--art-focus', art.focus || '50% 14%');
  const meta = themeById(themeId);
  if (meta?.size?.w && meta?.size?.h) {
    host.style.setProperty('--art-ar', (meta.size.w / meta.size.h).toFixed(3));
  }

  if (art.lqip) { lq.style.backgroundImage = `url("${art.lqip}")`; lq.style.opacity = '1'; }
  else lq.style.opacity = '0';

  hi.classList.remove('ready');
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (token !== backdropToken) return;
    hi.style.backgroundImage = `url("${art.backdrop}")`;
    requestAnimationFrame(() => hi.classList.add('ready'));
  };
  img.onerror = () => { if (token === backdropToken) lq.style.opacity = '1'; };
  img.src = art.backdrop;
}

/* ── parallax: a few pixels of drift, nothing seasick ────── */
export function initParallax() {
  const host = document.getElementById('bgChar');
  if (!host || matchMedia('(prefers-reduced-motion:reduce)').matches) return;

  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const step = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    host.style.setProperty('--px', cx.toFixed(2) + 'px');
    host.style.setProperty('--py', cy.toFixed(2) + 'px');
    raf = Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1 ? requestAnimationFrame(step) : 0;
  };
  const kick = () => { if (!raf && state.settings.motion !== false) raf = requestAnimationFrame(step); };

  if (matchMedia('(hover:hover)').matches) {
    window.addEventListener('pointermove', (e) => {
      tx = (e.clientX / innerWidth - 0.5) * -26;
      ty = (e.clientY / innerHeight - 0.5) * -16;
      kick();
    }, { passive: true });
  }
  document.getElementById('views')?.addEventListener('scroll', (e) => {
    ty = -Math.min(e.target.scrollTop * 0.04, 40);
    kick();
  }, { passive: true, capture: true });
}

/* ── accent pulled live from the album art ────────────────── */
let lastArtSrc = null;

export async function applyArtColor(coverSrc) {
  if (!state.settings.artColor) {
    root.dataset.artcolor = 'off';
    return;
  }
  root.dataset.artcolor = 'on';
  if (!coverSrc || coverSrc === lastArtSrc) return;
  lastArtSrc = coverSrc;

  const colors = await extractColors(coverSrc);
  if (!colors) {
    // no usable colour — fall back to the theme's own palette
    root.style.removeProperty('--art-accent');
    root.style.removeProperty('--art-accent-2');
    root.style.removeProperty('--art-accent-3');
    root.dataset.artcolor = 'off';
    return;
  }
  root.style.setProperty('--art-accent', colors.accent);
  root.style.setProperty('--art-accent-2', colors.accent2);
  root.style.setProperty('--art-accent-3', colors.accent3);
  emit('accent', colors);
}

export function clearArtColor() {
  lastArtSrc = null;
  root.dataset.artcolor = 'off';
  root.style.removeProperty('--art-accent');
  root.style.removeProperty('--art-accent-2');
  root.style.removeProperty('--art-accent-3');
  emit('accent', null);
}

/* ── the picker dock ──────────────────────────────────────── */
export function openThemeDock() {
  const dock = $('#themeDock');
  dock.hidden = false;
  dock.innerHTML = '';

  const panel = el('div.dock-panel', { role: 'dialog', 'aria-label': 'Themes' });

  panel.append(el('div.dock-head', {}, [
    el('div', {}, [
      el('h3', { text: 'Pick a mood' }),
      el('p', { text: 'Every palette is read out of the artwork. Four surface styles. Recolours instantly.' }),
    ]),
    el('button.icon-btn', { onclick: closeThemeDock, 'aria-label': 'Close' }, [icon('close')]),
  ]));

  /* palettes */
  const grid = el('div.theme-grid');
  for (const t of THEMES) {
    const card = el('button.theme-card', {
      class: t.id === state.settings.theme ? 'is-on' : '',
      dataset: { theme: t.id },
      onclick: () => {
        applyTheme(t.id);
        [...grid.children].forEach(c => c.classList.toggle('is-on', c.dataset.theme === t.id));
      },
    });
    const art = el('div.tc-art');
    const paint = () => themeArt(t.id).then(a => {
      if (a.lqip) art.style.backgroundImage = `url("${a.lqip}")`;
      paintArt(art, a, 'card');
      card.classList.toggle('has-custom', !!a.custom);
      card.classList.toggle('no-art', !!a.none);
    });
    paint();

    card.append(
      art,
      el('div.tc-wash', { style: { background: `linear-gradient(160deg, ${t.swatch[0]}22, transparent 45%, #000000cc)` } }),
      el('div.tc-check', {}, [icon('check')]),
      el('div.tc-body', {}, [
        el('div.tc-name', { text: t.name }),
        el('div.tc-tag', { text: t.blurb || t.tag }),
        el('div.tc-swatches', {}, t.swatch.map(c => el('i', { style: { background: c } }))),
      ]),
      el('button.tc-art-btn', {
        title: 'Use your own image for this theme',
        onclick: async (e) => { e.stopPropagation(); await pickArtFor(t, paint); },
      }, [icon('plus')]),
    );
    grid.append(card);
  }
  panel.append(grid);

  /* surface style */
  const morphRow = el('div.preset-row');
  for (const m of MORPHS) {
    const b = el('button.chip', {
      class: m.id === state.settings.morph ? 'is-on' : '',
      title: m.hint,
      text: m.name,
      onclick: () => {
        applyMorph(m.id);
        [...morphRow.children].forEach(c => c.classList.toggle('is-on', c.textContent === m.name));
      },
    });
    morphRow.append(b);
  }
  panel.append(el('div.dock-section', {}, [el('h4', { text: 'Surface style' }), morphRow]));

  /* light / dark */
  const modeRow = el('div.preset-row');
  for (const m of ['dark', 'light']) {
    modeRow.append(el('button.chip', {
      class: m === state.settings.mode ? 'is-on' : '',
      text: m === 'dark' ? 'Dark' : 'Light',
      onclick: () => {
        applyMode(m);
        [...modeRow.children].forEach(c => c.classList.toggle('is-on', c.textContent.toLowerCase() === m));
      },
    }));
  }
  const artBtn = el('button.chip', {
    class: state.settings.artColor ? 'is-on' : '',
    title: 'Recolour the whole UI from the current album art',
    onclick: () => {
      const on = !state.settings.artColor;
      setSetting('artColor', on);
      artBtn.classList.toggle('is-on', on);
      on ? applyArtColor(state.current?.cover) : clearArtColor();
    },
  }, [icon('palette'), 'Accent from cover']);
  modeRow.append(artBtn);
  panel.append(el('div.dock-section', {}, [el('h4', { text: 'Mode' }), modeRow]));

  panel.append(el('div.dock-section', {}, [
    el('h4', { text: 'Artwork' }),
    el('p', { style: { fontSize: '12.5px', color: 'var(--text-3)', lineHeight: '1.6', marginBottom: '10px' },
      html: 'Tap <b>+</b> on any card to swap in your own image — stored on this device only, nothing is uploaded. To make it permanent everywhere, drop a file in <code>images/chars/</code> as <code>&lt;id&gt;-src.png</code> and run <code>npm run art</code>; the palette rebuilds itself from the new artwork.' }),
    el('div.preset-row', {}, [
      el('button.chip', { onclick: async () => { await clearAllArt(); closeThemeDock(); openThemeDock(); } }, [icon('trash'), 'Reset to bundled art']),
    ]),
  ]));

  dock.append(panel);
  dock.addEventListener('click', (e) => { if (e.target === dock) closeThemeDock(); });
  document.addEventListener('keydown', escClose);
}

/** let the user choose an image for one theme, straight from the device */
export function pickArtFor(theme, onDone) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(false);
      try {
        await customArt.set(theme.id, file, { focus: '50% 18%', fit: 'cover' });
        await onDone?.();
        emit('notify', { text: `${theme.who}'s art updated`, icon: 'check' });
        resolve(true);
      } catch (err) {
        emit('notify', { text: err.message || 'Could not read that image', error: true });
        resolve(false);
      }
    });
    input.click();
  });
}

export async function clearAllArt() {
  await Promise.all(THEMES.map(t => customArt.clear(t.id)));
  emit('notify', { text: 'Back to the bundled portraits', icon: 'palette' });
}

export function closeThemeDock() {
  $('#themeDock').hidden = true;
  document.removeEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeThemeDock(); }
