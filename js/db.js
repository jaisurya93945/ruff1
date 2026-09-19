/* ═══════════════════════════════════════════════════════════
   AURA · db — IndexedDB for things too big for localStorage:
   imported audio blobs, cover blobs, and waveform peak caches.
   Every call degrades to a no-op if IDB is unavailable.
   ═══════════════════════════════════════════════════════════ */

const DB_NAME = 'aura';
const DB_VERSION = 2;
const STORES = ['blobs', 'peaks', 'meta'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { return resolve(null); }

    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { try { req.result.close(); } catch {} dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => { console.warn('[aura] IndexedDB unavailable:', req.error?.message); resolve(null); };
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => {
    if (!db) return null;
    return new Promise((resolve) => {
      let t;
      try { t = db.transaction(store, mode); }
      catch { return resolve(null); }
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result ?? null);
      t.onerror = t.onabort = () => resolve(null);
    });
  }).catch(() => null);
}

export const db = {
  get:  (store, key)        => tx(store, 'readonly',  s => s.get(key)),
  set:  (store, key, value) => tx(store, 'readwrite', s => s.put(value, key)),
  del:  (store, key)        => tx(store, 'readwrite', s => s.delete(key)),
  keys: (store)             => tx(store, 'readonly',  s => s.getAllKeys()),
  all:  (store)             => tx(store, 'readonly',  s => s.getAll()),
  clear:(store)             => tx(store, 'readwrite', s => s.clear()),
};

/* ── audio blobs for locally imported files ───────────────── */
export const blobs = {
  put:  (key, blob) => db.set('blobs', key, blob),
  get:  (key)       => db.get('blobs', key),
  del:  (key)       => db.del('blobs', key),
  keys: ()          => db.keys('blobs'),
};

/* ── waveform peaks cache (Float32 pairs, min/max per bucket)  */
export const peaks = {
  async get(key) {
    const rec = await db.get('peaks', key);
    if (!rec || !rec.data) return null;
    return { data: new Float32Array(rec.data), duration: rec.duration, buckets: rec.buckets };
  },
  put(key, float32, duration, buckets) {
    // store the underlying buffer — structured-cloneable and compact
    return db.set('peaks', key, { data: float32.buffer.slice(0), duration, buckets, at: Date.now() });
  },
  del: (key) => db.del('peaks', key),
  clear: () => db.clear('peaks'),
};

/* ── misc key/value that outgrew localStorage ─────────────── */
export const meta = {
  get: (k, fallback = null) => db.get('meta', k).then(v => v ?? fallback),
  set: (k, v) => db.set('meta', k, v),
  del: (k) => db.del('meta', k),
};

/** rough storage report for the Settings screen */
export async function usage() {
  try {
    if (navigator.storage?.estimate) {
      const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
      return { used, quota };
    }
  } catch {}
  return { used: 0, quota: 0 };
}

/** ask the browser to keep our data around (best effort) */
export async function persistStorage() {
  try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
}

/** wipe every AURA store — used by Settings → Reset */
export async function nuke() {
  for (const s of STORES) await db.clear(s);
}
