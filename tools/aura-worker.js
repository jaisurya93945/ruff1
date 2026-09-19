/* ═══════════════════════════════════════════════════════════
   AURA · cloud worker

   One free Cloudflare Worker that gives AURA three things a
   static site cannot do on its own:

     • a real global listener count
     • your playlists / favourites / marks / stats on every device
     • "continue on this device" playback handoff

   ── Setup (about three minutes) ─────────────────────────────
   1. dash.cloudflare.com → Workers & Pages → Create → Worker.
      Name it anything. Deploy the hello-world, then Edit code,
      paste this file over it, Deploy again.

   2. Settings → Bindings → Add → KV namespace.
        Variable name:  AURA
        KV namespace:   create one, call it aura
      (Presence works without it. Sync does not — it needs KV.)

   3. In AURA: Settings → Sync across devices
        Endpoint:  https://<your-worker>.workers.dev
        Room key:  any long private string, the SAME on each
                   device. This is the only credential — anyone
                   who knows it can read and write your data, so
                   treat it like a password.

   ── What is stored ──────────────────────────────────────────
   Under your room key: playlists, favourite ids, moment marks,
   play counts, and the path + position of the current track.
   Never: your audio, your IP, your user agent. Presence stores
   a random browser id and a timestamp, nothing else.

   ── Free-tier budget ────────────────────────────────────────
   KV on the free plan allows 1,000 writes and 100,000 reads a
   day. The client throttles hard (state at most every 30s,
   now-playing every 15s), so ordinary use lands in the low
   hundreds of writes. Live Follow polls reads, which are the
   plentiful ones.
   ═══════════════════════════════════════════════════════════ */

const PRESENCE_WINDOW_MS = 20_000;   // a ping keeps you "online" this long
const SWEEP_EVERY = 25;              // prune stale ids every N requests
const NOW_TTL = 60 * 60 * 12;        // forget a stale "now playing" after 12h
const STATE_TTL = 60 * 60 * 24 * 400;
const MIN_ROOM_LEN = 8;
const MAX_BODY = 512 * 1024;         // 512 KB is a very large library blob

let live = new Map();                // presence: id → last seen (per isolate)
let requests = 0;

export default {
  async fetch(request, env) {
    const cors = corsFor(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      switch (path) {
        case '/':
        case '/presence':
          return presence(url, env, cors);
        case '/state':
          return state(request, url, env, cors);
        case '/now':
          return now(request, url, env, cors);
        case '/health':
          return json({ ok: true, kv: !!env.AURA }, cors);
        default:
          return json({ error: 'not found', paths: ['/presence', '/state', '/now'] }, cors, 404);
      }
    } catch (err) {
      return json({ error: 'worker error', detail: String(err && err.message || err) }, cors, 500);
    }
  },
};

/* ── presence ─────────────────────────────────────────────── */
async function presence(url, env, cors) {
  const id = (url.searchParams.get('id') || '').slice(0, 64);
  const ts = Date.now();
  if (id) live.set(id, ts);

  if (++requests % SWEEP_EVERY === 0) {
    for (const [key, seen] of live) if (ts - seen > PRESENCE_WINDOW_MS) live.delete(key);
  }

  let online = 0;
  for (const seen of live.values()) if (ts - seen <= PRESENCE_WINDOW_MS) online++;

  let total = 0;
  if (env.AURA && id) {
    try {
      if (await env.AURA.get('v:' + id)) {
        total = parseInt(await env.AURA.get('total') || '0', 10);
      } else {
        await env.AURA.put('v:' + id, '1', { expirationTtl: 60 * 60 * 24 * 365 });
        total = parseInt(await env.AURA.get('total') || '0', 10) + 1;
        await env.AURA.put('total', String(total));
      }
    } catch { /* KV hiccup — the live count still works */ }
  }
  return json({ online: Math.max(online, 1), total, at: ts }, cors);
}

/* ── library state: playlists, favourites, marks, stats ───── */
async function state(request, url, env, cors) {
  const room = roomOf(url);
  if (!room.ok) return json({ error: room.error }, cors, 400);
  if (!env.AURA) return json({ error: 'no KV namespace bound — add a binding named AURA' }, cors, 503);

  const key = 'state:' + room.value;

  if (request.method === 'GET') {
    const raw = await env.AURA.get(key);
    if (!raw) return json({ empty: true, version: 0 }, cors);
    return new Response(raw, { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: body.error }, cors, 400);

    const prev = await env.AURA.get(key, 'json').catch(() => null);
    const payload = {
      data: body.value.data ?? {},
      device: String(body.value.device || 'unknown').slice(0, 40),
      version: ((prev && prev.version) || 0) + 1,
      updatedAt: Date.now(),
    };
    await env.AURA.put(key, JSON.stringify(payload), { expirationTtl: STATE_TTL });
    return json({ ok: true, version: payload.version, updatedAt: payload.updatedAt }, cors);
  }

  return json({ error: 'method not allowed' }, cors, 405);
}

/* ── now playing: for handoff and Live Follow ─────────────── */
async function now(request, url, env, cors) {
  const room = roomOf(url);
  if (!room.ok) return json({ error: room.error }, cors, 400);
  if (!env.AURA) return json({ error: 'no KV namespace bound — add a binding named AURA' }, cors, 503);

  const key = 'now:' + room.value;

  if (request.method === 'GET') {
    const raw = await env.AURA.get(key);
    return raw
      ? new Response(raw, { headers: { ...cors, 'Content-Type': 'application/json' } })
      : json({ empty: true }, cors);
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: body.error }, cors, 400);
    const v = body.value;
    const payload = {
      src: String(v.src || '').slice(0, 512),
      title: String(v.title || '').slice(0, 200),
      artist: String(v.artist || '').slice(0, 200),
      time: Number(v.time) || 0,
      duration: Number(v.duration) || 0,
      playing: !!v.playing,
      device: String(v.device || 'a device').slice(0, 40),
      deviceId: String(v.deviceId || '').slice(0, 64),
      at: Date.now(),
    };
    await env.AURA.put(key, JSON.stringify(payload), { expirationTtl: NOW_TTL });
    return json({ ok: true, at: payload.at }, cors);
  }

  return json({ error: 'method not allowed' }, cors, 405);
}

/* ── helpers ──────────────────────────────────────────────── */
function roomOf(url) {
  const raw = (url.searchParams.get('room') || '').trim();
  if (!raw) return { ok: false, error: 'missing ?room=' };
  if (raw.length < MIN_ROOM_LEN) return { ok: false, error: `room key must be at least ${MIN_ROOM_LEN} characters` };
  if (raw.length > 128) return { ok: false, error: 'room key too long' };
  // namespace it so a room key can never collide with a presence key
  return { ok: true, value: encodeURIComponent(raw) };
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return { ok: false, error: 'payload too large' };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return { ok: false, error: 'payload too large' };
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'body must be JSON' };
  }
}

function corsFor(request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
}

const json = (obj, cors, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* ── Not using Cloudflare? ───────────────────────────────────
   Any host works. The client needs exactly this contract:

     GET  /presence?id=<browser-id>        → {online, total}
     GET  /state?room=<key>                → {data, version, updatedAt, device}
     PUT  /state?room=<key>   body {data, device}
     GET  /now?room=<key>                  → {src, time, playing, at, device, deviceId}
     PUT  /now?room=<key>     body {src, title, artist, time, duration, playing, device, deviceId}

   …plus CORS headers. Deno Deploy, Vercel Edge, a Netlify
   function or a small Express app all fit in under 60 lines.
   ─────────────────────────────────────────────────────────── */
