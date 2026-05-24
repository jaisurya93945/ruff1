/* Service Worker – Hacker Playlist */
const CACHE = 'hacker-playlist-v1';
const STATIC = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/songs.json',
  '/img/favi.png',
  '/img/search.png',
  '/img/play1.png',
  '/img/pause1.png',
  '/img/previous.png',
  '/img/next.png',
  '/img/shuffle.png',
  '/img/arrow.png',
  '/img/all.png',
  '/img/hgf.jpg',
  '/img/nadaniya.jpg',
  '/img/jan.gif'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  /* Skip non-GET and chrome-extension etc */
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;

  /* Audio files: network-first (don't cache large MP3s to avoid quota) */
  if (e.request.url.match(/\.(mp3|ogg|wav|aac|m4a)$/i)) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  /* Everything else: cache-first */
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
