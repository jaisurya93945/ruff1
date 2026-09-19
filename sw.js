/* ═══════════════════════════════════════════════════════════
   AURA · service worker

   App shell  → cache-first, refreshed in the background.
   Audio      → network-first with range support, never cached
                whole (files are large; the browser's own HTTP
                cache handles re-listens better than we can).
   Everything else → stale-while-revalidate.
   ═══════════════════════════════════════════════════════════ */

const VERSION = 'aura-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/core.css',
  './css/themes.css',
  './css/components.css',
  './css/anim.css',
  './js/main.js',
  './js/util.js',
  './js/store.js',
  './js/db.js',
  './js/engine.js',
  './js/analysis.js',
  './js/library.js',
  './js/visualizer.js',
  './js/themes.js',
  './js/features.js',
  './js/player.js',
  './js/ui.js',
  './js/views.js',
];

const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(\?.*)?$/i;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll is all-or-nothing; add individually so one 404 can't
    // stop the whole worker from installing
    await Promise.all(SHELL_FILES.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('aura-') && !k.startsWith(VERSION))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;            // let CDNs and APIs through untouched
  if (request.headers.has('range')) return;              // seeking audio — don't interfere
  if (AUDIO_RE.test(url.pathname)) return;               // audio streams straight from the network

  // navigations: serve the shell so deep links work offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async (res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const cache = await caches.open(isShell(url) ? SHELL : RUNTIME);
        cache.put(request, res.clone());
        await trimCache(RUNTIME, 90);
      }
      return res;
    }).catch(() => null);

    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});

const isShell = (url) => SHELL_FILES.some(f => url.pathname.endsWith(f.replace('./', '/')));

/** keep the runtime cache from growing without bound */
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
}
