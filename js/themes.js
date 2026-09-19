/* ═══════════════════════════════════════════════════════════
   AURA · themes — the palette registry, the picker dock, and
   the live "accent from album art" pipeline.
   ═══════════════════════════════════════════════════════════ */
import { $, el, icon, ls } from './util.js';
import { state, setSetting, emit } from './store.js';
import { extractColors } from './analysis.js';
import { blobs } from './db.js';

/** Each entry maps to a [data-theme] block in css/themes.css.
 *  `art` is a portrait in images/themes/ — drop your own
 *  <id>.png / .jpg / .webp there and it wins over the SVG. */
export const THEMES = [
  { id:'sakura', name:'Sakura Drift',    who:'Sakura',   tag:'petals & dusk',       swatch:['#ff7eb6','#ffa8d2','#b96cf0'] },
  { id:'neon',   name:'Cyber Rin',       who:'Rin',      tag:'rain-slick neon',     swatch:['#28e6ff','#6af7d2','#ff3ea5'] },
  { id:'yuki',   name:'Midnight Yuki',   who:'Yuki',     tag:'snowfall & silver',   swatch:['#9ec5ff','#dbe9ff','#7f8dff'] },
  { id:'ember',  name:'Ember Hana',      who:'Hana',     tag:'forge-light',         swatch:['#ff8c42','#ffd166','#ff4d6d'] },
  { id:'mint',   name:'Aoi Mint',        who:'Aoi',      tag:'sea glass',           swatch:['#4fe0c0','#a6f5c9','#48b4ff'] },
  { id:'violet', name:'Violet Nocturne', who:'Nocturne', tag:'velvet & moonlight',  swatch:['#a78bfa','#e0c3fc','#5b8cff'] },
  { id:'hikari', name:'Solar Hikari',    who:'Hikari',   tag:'dawn & gold leaf',    swatch:['#ffd84d','#fff3b0','#ff9e58'] },
  { id:'kurone', name:'Abyss Kurone',    who:'Kurone',   tag:'void & toxic bloom',  swatch:['#8fff6b','#d4ff8f','#00e0c6'] },
  { id:'mono',   name:'Monochrome',      who:'Null',     tag:'no distractions',     swatch:['#e8e8ef','#ffffff','#9a9aab'] },
];

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
  const theme = THEMES.find(t => t.id === id) ? id : 'sakura';
  root.dataset.theme = theme;
  setSetting('theme', theme);
  syncMetaColor();
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
  root.dataset.theme = s.theme;
  root.dataset.mode = s.mode;
  root.dataset.morph = s.morph;
  root.dataset.motion = (s.motion === false || s.motion === 'off') ? 'off' : 'on';
  applyPerf(s.perf);
  root.dataset.artcolor = s.artColor ? 'on' : 'off';
  syncMetaColor();
}

/* ═══════════════════════════════════════════════════════════
   Portrait resolution

   Three sources, best first:
     1. art you picked in-app        → IndexedDB, per device
     2. images/themes/overrides.json → committed to the repo
     3. images/themes/<id>.svg       → the bundled fallback

   (1) means you can set artwork from your phone without
   touching the repository at all. (2) is how you make it
   permanent for every device.

   overrides.json accepts either a bare path or an object, so
   you can tune how a real image is framed:

     {
       "sakura": "images/art/sakura.png",
       "neon":   { "src": "images/art/rin.jpg",
                   "focus": "54% 22%",   // what to keep in frame
                   "fit": "cover",       // cover | contain
                   "scale": 1.08 }
     }
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_ART = { focus: '50% 18%', fit: 'contain', scale: 1 };

let overridesPromise = null;
function loadOverrides() {
  overridesPromise ??= fetch('images/themes/overrides.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : {}))
    .then(map => (map && typeof map === 'object' ? map : {}))
    .catch(() => ({}));
  return overridesPromise;
}

function normalise(entry, fallbackSrc) {
  if (typeof entry === 'string' && entry.trim()) return { ...DEFAULT_ART, src: entry.trim(), fit: 'cover' };
  if (entry && typeof entry === 'object' && entry.src) {
    return { ...DEFAULT_ART, fit: 'cover', ...entry, src: String(entry.src) };
  }
  return { ...DEFAULT_ART, src: fallbackSrc };
}

/** @returns {Promise<{src,focus,fit,scale,custom:boolean}>} */
export async function portraitArt(themeId) {
  if (artCache.has(themeId)) return artCache.get(themeId);

  const resolved = (async () => {
    // 1 — art the user picked in this browser
    try {
      const rec = await customArt.get(themeId);
      if (rec?.blob) {
        return { ...DEFAULT_ART, fit: 'cover', ...(rec.tune || {}), src: URL.createObjectURL(rec.blob), custom: true };
      }
    } catch {}

    // 2 — committed overrides, 3 — bundled SVG
    const map = await loadOverrides();
    return { ...normalise(map[themeId], `images/themes/${themeId}.svg`), custom: false };
  })();

  artCache.set(themeId, resolved);
  return resolved;
}

/** back-compat: callers that only need a URL */
export async function portraitURL(themeId) {
  return (await portraitArt(themeId)).src;
}

/** apply an art record to any element as a background */
export function paintArt(node, art) {
  if (!node || !art) return;
  node.style.backgroundImage = `url("${art.src}")`;
  node.style.backgroundSize = art.fit === 'contain' ? 'contain' : 'cover';
  node.style.backgroundPosition = art.focus || '50% 18%';
  node.style.backgroundRepeat = 'no-repeat';
  if (art.scale && art.scale !== 1) {
    node.style.transform = `scale(${art.scale})`;
    node.style.transformOrigin = art.focus || 'center top';
  } else {
    node.style.transform = '';
  }
}

/* ── per-device custom art, stored as blobs in IndexedDB ──── */
export const customArt = {
  key: (id) => 'art:' + id,
  get(id)       { return blobs.get(this.key(id)).then(v => (v && v.blob ? v : v ? { blob: v } : null)); },
  async set(id, file, tune = {}) {
    if (!(file instanceof Blob)) return false;
    if (file.size > 12 * 1024 * 1024) throw new Error('That image is over 12 MB — resize it first.');
    await blobs.put(this.key(id), { blob: file, tune, at: Date.now() });
    artCache.delete(id);
    emit('theme:art', { theme: id });
    return true;
  },
  async clear(id) {
    await blobs.del(this.key(id));
    artCache.delete(id);
    emit('theme:art', { theme: id });
  },
  async has(id) { return !!(await this.get(id)); },
};

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
      el('p', { text: 'Nine palettes, four surface styles. Everything recolours instantly.' }),
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
    const paint = () => portraitArt(t.id).then(a => {
      paintArt(art, a);
      card.classList.toggle('has-custom', !!a.custom);
    });
    paint();

    card.append(
      art,
      el('div.tc-wash', { style: { background: `linear-gradient(160deg, ${t.swatch[0]}22, transparent 45%, #000000cc)` } }),
      el('div.tc-check', {}, [icon('check')]),
      el('div.tc-body', {}, [
        el('div.tc-name', { text: t.name }),
        el('div.tc-tag', { text: t.tag }),
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
      html: 'The bundled portraits are simple generated vectors. Tap <b>+</b> on any card to use your own image instead — it is stored on this device only, so nothing is uploaded anywhere. To make it permanent across every device, drop the files in <code>images/themes/</code> and list them in <code>overrides.json</code>.' }),
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
