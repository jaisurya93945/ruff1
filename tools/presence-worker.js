/* ═══════════════════════════════════════════════════════════
   AURA · presence worker

   Deploy this to a free Cloudflare Worker and AURA will show a
   real, global "N listening right now" instead of counting the
   tabs open on your own device.

   ── Setup ───────────────────────────────────────────────────
   1. dash.cloudflare.com → Workers & Pages → Create → Worker
   2. Paste this file in, deploy.
   3. Settings → Variables → KV Namespace Bindings:
        add a binding named  AURA  pointing at a new KV namespace.
        (Without it the worker still runs — it just can't count
         all-time visitors, only live ones.)
   4. Copy the worker URL into AURA:
        Settings → Listener count → Presence endpoint

   ── What it does ────────────────────────────────────────────
   Each client pings every 5 seconds with a stable random id.
   Anyone seen in the last 20 seconds counts as online. Nothing
   else is stored: no IP, no user agent, no listening history.
   ═══════════════════════════════════════════════════════════ */

const WINDOW_MS = 20_000;     // how long a ping keeps you "online"
const SWEEP_EVERY = 25;       // prune stale ids every N requests

let live = new Map();         // id → last-seen timestamp (per worker isolate)
let requests = 0;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const id = (url.searchParams.get('id') || '').slice(0, 64);
    const now = Date.now();

    if (id) live.set(id, now);

    if (++requests % SWEEP_EVERY === 0) {
      for (const [key, seen] of live) if (now - seen > WINDOW_MS) live.delete(key);
    }

    let online = 0;
    for (const seen of live.values()) if (now - seen <= WINDOW_MS) online++;

    // all-time unique visitors, if a KV namespace is bound
    let total = 0;
    if (env.AURA && id) {
      try {
        const seenBefore = await env.AURA.get('v:' + id);
        if (!seenBefore) {
          await env.AURA.put('v:' + id, '1', { expirationTtl: 60 * 60 * 24 * 365 });
          total = parseInt(await env.AURA.get('total') || '0', 10) + 1;
          await env.AURA.put('total', String(total));
        } else {
          total = parseInt(await env.AURA.get('total') || '0', 10);
        }
      } catch { /* KV hiccup — the live count still works */ }
    }

    return new Response(JSON.stringify({ online: Math.max(online, 1), total, at: now }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};

/* ── Other hosts ─────────────────────────────────────────────
   Any endpoint works as long as a GET returns JSON shaped like
       { "online": 12, "total": 480 }
   and sends CORS headers. Deno Deploy, Vercel Edge, a Netlify
   function or a five-line Express route are all fine.
   ─────────────────────────────────────────────────────────── */
