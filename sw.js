/* ═══════════════════════════════════════════════════════════
   AURA · service worker

   ── Why this is network-first for code ──────────────────────
   The first version was cache-first for everything, which is
   fine until you deploy. Then a returning visitor gets the new
   index.html (navigations were network-first) which asks for
   the new stylesheets — a cache miss, so those arrive fresh —
   while every .js file is still served from the old cache.

   The result is new markup and new CSS running on old
   JavaScript. It does not throw: the old code is internally
   consistent, so the app boots and renders the *previous*
   release. Nothing looks broken, nothing appears to have
   changed, and there is no error to chase.

   So: code is network-first and only falls back to cache when
   the network actually fails. Media stays cache-first, because
   an image cannot be out of step with anything.
   ═══════════════════════════════════════════════════════════ */

const VERSION = 'aura-v5';
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;
const NET_TIMEOUT = 4000;

const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/core.css', './css/themes.css', './css/chars.css',
  './css/components.css', './css/backdrop.css', './css/polish.css', './css/anim.css',
  './fonts/outfit-variable.woff2',
  './js/main.js', './js/util.js', './js/store.js', './js/db.js',
  './js/engine.js', './js/analysis.js', './js/library.js',
  './js/visualizer.js', './js/themes.js', './js/characters.js',
  './js/features.js', './js/player.js', './js/ui.js', './js/views.js',
  './js/cloud.js', './js/eqgraph.js',
];

const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(\?.*)?$/i;
const CODE_RE  = /\.(html|js|mjs|css|json|webmanifest)(\?.*)?$/i;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // individually, so one 404 cannot stop the worker installing
    await Promise.all(SHELL_FILES.map(u =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache from an older release — a half-updated set is worse
    // than no cache at all.
    const keys = await caches.keys();
    const stale = keys.filter(k => k.startsWith('aura-') && !k.startsWith(VERSION));
    await Promise.all(stale.map(k => caches.delete(k)));

    await self.clients.claim();

    // Anything open right now was served by the previous worker, so it is
    // running the old JavaScript however fresh the markup is. Tell it — the
    // page decides what to do, because forcing a navigation from here would
    // cut off whatever is playing without warning.
    if (!stale.length) return;
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.postMessage({ type: 'aura:updated', version: VERSION });
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting' || e.data?.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;   // CDNs and your sync worker go direct
  if (request.headers.has('range')) return;     // seeking audio
  if (AUDIO_RE.test(url.pathname)) return;      // audio streams from the network

  if (request.mode === 'navigate' || CODE_RE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

/** the current release, or the last one we saw if the network is gone */
async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(request), NET_TIMEOUT);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** images and fonts: instant from cache, refreshed quietly behind you */
async function cacheFirst(request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request);
  const update = fetch(request).then(async (res) => {
    if (res && res.ok && res.type === 'basic') {
      await cache.put(request, res.clone());
      await trim(MEDIA, 120);
    }
    return res;
  }).catch(() => null);

  return cached || (await update) || new Response('', { status: 504 });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const k of keys.slice(0, keys.length - max)) await cache.delete(k);
}
