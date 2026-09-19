/* ═══════════════════════════════════════════════════════════
   AURA · features — the parts that aren't playback:
   live listener count, sleep timer, cross-tab sync,
   shareable vibe cards, Mood DJ, and the listening DNA.
   ═══════════════════════════════════════════════════════════ */
import { $, el, clamp, fmtTime, fmtSpan, fmtCount, ls, uid, download, fitCanvas, supports } from './util.js';
import { state, set, emit, on, setSetting, statFor, echoFor, ECHO_BUCKETS } from './store.js';
import { engine } from './engine.js';
import { getEnergy, guessEnergy, arrangeByCurve, arcPreset } from './analysis.js';

/* ═══════════════════════════════════════════════════════════
   1 · PRESENCE — "how many people are listening right now"

   Two providers:
     local   counts live tabs in this browser profile. Always
             works, zero setup, honest about its scope.
     remote  talks to a tiny endpoint you host (see
             tools/presence-worker.js — a free Cloudflare
             Worker) and reports a real global figure.
   ═══════════════════════════════════════════════════════════ */

const HEARTBEAT_MS = 5000;
const STALE_MS = 16000;
const PRESENCE_KEY = 'aura:presence:tabs';

export const presence = {
  tabId: uid('tab_'),
  visitorId: ls.get('visitorId') || (() => { const v = uid('v_'); ls.set('visitorId', v); return v; })(),
  channel: null,
  timer: null,
  source: 'local',
  online: 1,
  total: 0,
  failures: 0,

  start() {
    const mode = state.settings.presenceMode;
    if (mode === 'off') { this._publish(0, 0, 'off'); return; }

    // count this visit once per browser
    const visits = (ls.get('visits', 0) | 0) + 1;
    ls.set('visits', visits);
    ls.set('lastSeen', Date.now());

    if (supports.broadcast) {
      try {
        this.channel = new BroadcastChannel('aura-presence');
        this.channel.addEventListener('message', (e) => {
          if (e.data?.type === 'ping') this._beat();
          if (e.data?.type === 'bye') this._beat();
        });
      } catch {}
    }

    this._beat();
    this.timer = setInterval(() => this._beat(), HEARTBEAT_MS);
    document.addEventListener('visibilitychange', () => !document.hidden && this._beat());
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('beforeunload', () => this.stop());
  },

  stop() {
    clearInterval(this.timer);
    try {
      const tabs = this._readTabs();
      delete tabs[this.tabId];
      ls.set('presence:tabs', tabs);
      this.channel?.postMessage({ type: 'bye', id: this.tabId });
      this.channel?.close();
    } catch {}
  },

  _readTabs() {
    const raw = ls.get('presence:tabs', {}) || {};
    const now = Date.now();
    const live = {};
    for (const [id, ts] of Object.entries(raw)) if (now - ts < STALE_MS) live[id] = ts;
    return live;
  },

  async _beat() {
    // local tally always runs — it is the floor, and the fallback
    const tabs = this._readTabs();
    tabs[this.tabId] = Date.now();
    ls.set('presence:tabs', tabs);
    const localOnline = Object.keys(tabs).length;
    const localTotal = ls.get('visits', 1);

    this.channel?.postMessage({ type: 'ping', id: this.tabId });

    // one endpoint for everything: fall back to the sync worker's /presence
    const sync = (state.settings.syncEndpoint || '').trim().replace(/\/+$/, '');
    const endpoint = (state.settings.presenceEndpoint || '').trim() || (sync ? sync + '/presence' : '');
    const wantRemote = endpoint && state.settings.presenceMode !== 'local';

    if (wantRemote && this.failures < 4) {
      try {
        const url = new URL(endpoint);
        url.searchParams.set('id', this.visitorId);
        const res = await fetch(url, { method: 'GET', cache: 'no-store', mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const online = Number(json.online ?? json.live ?? json.count ?? 0);
        const total = Number(json.total ?? json.all ?? 0);
        this.failures = 0;
        return this._publish(Math.max(online, 1), total || localTotal, 'remote');
      } catch (err) {
        this.failures++;
        if (this.failures === 4) console.info('[aura] presence endpoint unreachable — using local count');
      }
    }
    this._publish(localOnline, localTotal, 'local');
  },

  _publish(online, total, source) {
    this.online = online; this.total = total; this.source = source;
    set({ presence: { online, total, source } }, 'presence');
  },
};

/** paint the two presence pills */
export function renderPresence() {
  const { online, total, source } = state.presence;
  const label = online === 1 ? 'listening' : 'listening';
  for (const id of ['presenceCount', 'presenceCountM']) {
    const node = $('#' + id);
    if (node) node.textContent = source === 'off' ? '–' : fmtCount(online);
  }
  const pill = $('#presencePill');
  if (pill) {
    pill.classList.toggle('stale', source === 'off');
    const q = pill.querySelector('.presence-label');
    if (q) q.textContent = label;
    pill.title = source === 'remote'
      ? `${fmtCount(online)} listening now · ${fmtCount(total)} all-time`
      : source === 'off'
        ? 'Listener count is switched off'
        : `${online} open ${online === 1 ? 'tab' : 'tabs'} on this device · ${fmtCount(total)} visits.\nAdd a presence endpoint in Settings for a real global count.`;
  }
}

/* ═══════════════════════════════════════════════════════════
   2 · SLEEP TIMER — with a real fade, not a hard stop
   ═══════════════════════════════════════════════════════════ */

export const sleep = {
  until: 0,
  mode: null,          // 'clock' | 'track'
  _tick: null,
  FADE: 30,            // seconds of fade-out before silence

  set(minutes) {
    this.cancel();
    this.mode = 'clock';
    this.until = Date.now() + minutes * 60000;
    this._tick = setInterval(() => this._check(), 1000);
    emit('sleep', this.info());
    return this.info();
  },

  endOfTrack() {
    this.cancel();
    this.mode = 'track';
    this.until = 0;
    emit('sleep', this.info());
    return this.info();
  },

  cancel() {
    clearInterval(this._tick);
    this._tick = null;
    this.mode = null;
    this.until = 0;
    engine.fadeTo(engine.volume, 0.4);
    emit('sleep', this.info());
  },

  _check() {
    if (this.mode !== 'clock') return;
    const left = (this.until - Date.now()) / 1000;
    if (left <= 0) {
      engine.pause();
      engine.fadeTo(engine.volume, 0.3);
      this.cancel();
      emit('sleep:done');
    } else if (left <= this.FADE) {
      engine.fadeTo(engine.volume * (left / this.FADE), 1.1);
    }
    emit('sleep', this.info());
  },

  /** called by the player when a track finishes */
  trackEnded() {
    if (this.mode !== 'track') return false;
    this.cancel();
    emit('sleep:done');
    return true;
  },

  info() {
    return {
      active: !!this.mode,
      mode: this.mode,
      left: this.mode === 'clock' ? Math.max(0, Math.round((this.until - Date.now()) / 1000)) : 0,
    };
  },
};

/* ═══════════════════════════════════════════════════════════
   3 · TAB PARTY — keep every open tab on the same second
   ═══════════════════════════════════════════════════════════ */

export const tabSync = {
  channel: null,
  muted: false,        // set while applying a remote update, to avoid echo

  start() {
    if (!supports.broadcast || this.channel) return;
    try { this.channel = new BroadcastChannel('aura-sync'); } catch { return; }
    this.channel.addEventListener('message', (e) => {
      if (!state.settings.tabSync) return;
      const msg = e.data;
      if (!msg || msg.from === presence.tabId) return;
      this.muted = true;
      try { emit('sync:in', msg); } finally { setTimeout(() => { this.muted = false; }, 60); }
    });
  },

  send(type, payload = {}) {
    if (!state.settings.tabSync || this.muted || !this.channel) return;
    try { this.channel.postMessage({ type, from: presence.tabId, at: Date.now(), ...payload }); } catch {}
  },

  stop() { try { this.channel?.close(); } catch {} this.channel = null; },
};

/* ═══════════════════════════════════════════════════════════
   4 · VIBE CARD — a shareable snapshot of what's playing
   ═══════════════════════════════════════════════════════════ */

export async function makeVibeCard(track, { peaks = null, width = 1080, height = 1350 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
  const accent = css('--accent', '#ff7eb6');
  const accent2 = css('--accent-2', '#ffa8d2');
  const accent3 = css('--accent-3', '#b96cf0');
  const bg = css('--bg-0', '#120810');
  const text = css('--text', '#f2edfa');
  const text3 = css('--text-3', '#7d7590');

  /* backdrop */
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  for (const [x, y, r, c] of [[0.2, 0.1, 0.7, accent], [0.85, 0.3, 0.6, accent3], [0.5, 0.95, 0.65, accent2]]) {
    const g = ctx.createRadialGradient(x * width, y * height, 0, x * width, y * height, r * width);
    g.addColorStop(0, c + '55'); g.addColorStop(1, c + '00');
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  }

  /* cover */
  const pad = 96, art = width - pad * 2;
  const img = await loadImage(track?.cover).catch(() => null);
  roundPath(ctx, pad, pad + 40, art, art, 52);
  ctx.save(); ctx.clip();
  if (img) {
    const s = Math.max(art / img.width, art / img.height);
    ctx.drawImage(img, pad + (art - img.width * s) / 2, pad + 40 + (art - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const g = ctx.createLinearGradient(pad, pad, pad + art, pad + art);
    g.addColorStop(0, accent); g.addColorStop(1, accent3);
    ctx.fillStyle = g; ctx.fillRect(pad, pad + 40, art, art);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 2;
  roundPath(ctx, pad, pad + 40, art, art, 52); ctx.stroke();

  /* titles */
  let y = pad + 40 + art + 92;
  ctx.textAlign = 'left';
  ctx.fillStyle = text;
  ctx.font = '700 60px Outfit, system-ui, sans-serif';
  fitText(ctx, track?.title || 'Untitled', pad, y, art, 60);
  y += 62;
  ctx.fillStyle = text3;
  ctx.font = '400 38px Outfit, system-ui, sans-serif';
  fitText(ctx, track?.artist || 'Unknown artist', pad, y, art, 38);

  /* waveform strip */
  y += 74;
  const wh = 108;
  if (peaks?.length) {
    const n = Math.min(160, peaks.length / 2);
    const bw = art / n;
    const g = ctx.createLinearGradient(pad, 0, pad + art, 0);
    g.addColorStop(0, accent); g.addColorStop(0.5, accent2); g.addColorStop(1, accent3);
    ctx.fillStyle = g;
    for (let i = 0; i < n; i++) {
      const src = Math.floor(i / n * (peaks.length / 2));
      const amp = Math.max(Math.abs(peaks[src * 2]), Math.abs(peaks[src * 2 + 1]));
      const h = Math.max(4, amp * wh);
      roundPath(ctx, pad + i * bw, y + (wh - h) / 2, Math.max(2, bw - 3), h, 2);
      ctx.fill();
    }
  }

  /* footer */
  y += wh + 74;
  ctx.fillStyle = accent;
  ctx.font = '700 30px Outfit, system-ui, sans-serif';
  ctx.fillText('AURA', pad, y);
  ctx.fillStyle = text3;
  ctx.font = '400 26px JetBrains Mono, monospace';
  const st = statFor(track?.id);
  const meta = [track?.album, st.plays ? `${st.plays} play${st.plays === 1 ? '' : 's'}` : null,
                track?.duration ? fmtTime(track.duration) : null].filter(Boolean).join('  ·  ');
  ctx.textAlign = 'right';
  ctx.fillText(meta, width - pad, y);

  return cv;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    if (!src) return rej(new Error('no src'));
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('load failed'));
    i.src = src;
  });
}
function roundPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function fitText(ctx, str, x, y, maxW, size) {
  let s = size, t = String(str);
  while (ctx.measureText(t).width > maxW && s > 20) {
    s -= 2;
    ctx.font = ctx.font.replace(/\d+px/, s + 'px');
  }
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.fillText(t, x, y);
}

export async function shareVibeCard(canvas, track) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png', 0.95));
  if (!blob) return false;
  const name = `aura-${(track?.title || 'track').replace(/[^\w]+/g, '-').toLowerCase()}.png`;
  if (supports.share && navigator.canShare?.({ files: [new File([blob], name, { type: 'image/png' })] })) {
    try {
      await navigator.share({ files: [new File([blob], name, { type: 'image/png' })], title: track?.title });
      return true;
    } catch { /* user cancelled — fall through to download */ }
  }
  download(blob, name);
  return true;
}

/* ═══════════════════════════════════════════════════════════
   5 · MOOD DJ — order a set along an energy curve
   ═══════════════════════════════════════════════════════════ */

export const ARCS = [
  { id:'journey', name:'The Journey', hint:'warm up → peak → land softly' },
  { id:'climb',   name:'The Climb',   hint:'start calm, end loud' },
  { id:'wind',    name:'Wind Down',   hint:'loud now, asleep later' },
  { id:'steady',  name:'Steady',      hint:'one mood, held' },
  { id:'waves',   name:'Waves',       hint:'peaks and valleys' },
];

/** resolve an energy score for every track (cached decode, else a genre guess) */
export async function energyMap(tracks) {
  const map = new Map();
  await Promise.all(tracks.map(async (t) => {
    const cached = await getEnergy(t);
    map.set(t.id, cached?.energy ?? guessEnergy(t).energy);
  }));
  return map;
}

export async function buildMoodSet(tracks, arcId, size = 20) {
  const pool = tracks.slice();
  if (!pool.length) return [];
  const map = await energyMap(pool);
  const curve = arcPreset(arcId, 32);
  const chosen = arrangeByCurve(pool, curve, t => map.get(t.id) ?? 0.5);
  return chosen.slice(0, Math.min(size, chosen.length));
}

/** draw the target curve + where each chosen track actually sits */
export function drawMoodCurve(canvas, curve, points = []) {
  const { w, h, dpr } = fitCanvas(canvas, 2);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = w / dpr, H = h / dpr;
  ctx.clearRect(0, 0, W, H);
  const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
  const accent = css('--accent', '#ff7eb6');
  const accent3 = css('--accent-3', '#b96cf0');

  /* grid */
  ctx.strokeStyle = css('--stroke', '#ffffff18');
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke();
  }

  /* the curve */
  const pad = 10;
  const yOf = (e) => pad + (1 - e) * (H - pad * 2);
  ctx.beginPath();
  curve.forEach((e, i) => {
    const x = (i / (curve.length - 1)) * W;
    i ? ctx.lineTo(x, yOf(e)) : ctx.moveTo(x, yOf(e));
  });
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, accent); g.addColorStop(1, accent3);
  ctx.strokeStyle = g; ctx.lineWidth = 2.5; ctx.shadowBlur = 14; ctx.shadowColor = accent;
  ctx.stroke();
  ctx.shadowBlur = 0;

  /* fill under */
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  const gf = ctx.createLinearGradient(0, 0, 0, H);
  gf.addColorStop(0, accent + '44'); gf.addColorStop(1, accent + '00');
  ctx.fillStyle = gf; ctx.fill();

  /* the actual tracks */
  points.forEach((e, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
    ctx.beginPath();
    ctx.arc(x, yOf(e), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 10; ctx.shadowColor = accent;
    ctx.fill();
  });
  ctx.shadowBlur = 0;
}

/* ═══════════════════════════════════════════════════════════
   6 · LISTENING DNA — a radial fingerprint of your habits
   ═══════════════════════════════════════════════════════════ */

export function drawDNA(canvas, tracks) {
  const size = Math.min(520, canvas.parentElement?.clientWidth || 520);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
  const cols = [css('--accent', '#ff7eb6'), css('--accent-2', '#ffa8d2'), css('--accent-3', '#b96cf0')];
  const cx = size / 2, cy = size / 2;
  const R = size * 0.42;

  const played = tracks
    .map(t => ({ t, s: statFor(t.id) }))
    .filter(x => x.s.plays > 0)
    .sort((a, b) => b.s.ms - a.s.ms);

  if (!played.length) {
    ctx.fillStyle = css('--text-3', '#888');
    ctx.font = '500 15px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Play something — your DNA draws itself.', cx, cy);
    return;
  }

  const maxMs = played[0].s.ms || 1;
  const N = Math.min(played.length, 60);

  /* rings */
  ctx.strokeStyle = css('--stroke', '#ffffff14');
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath(); ctx.arc(cx, cy, R * i / 3, 0, Math.PI * 2); ctx.stroke();
  }

  /* one petal per track, length = listening time, hue cycles the palette */
  for (let i = 0; i < N; i++) {
    const { t, s } = played[i];
    const a0 = (i / N) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.78) / N) * Math.PI * 2 - Math.PI / 2;
    const len = R * (0.18 + 0.82 * Math.pow(s.ms / maxMs, 0.55));
    const col = cols[i % cols.length];

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R * 0.14, cy + Math.sin(a0) * R * 0.14);
    ctx.arc(cx, cy, len, a0, a1);
    ctx.arc(cx, cy, R * 0.14, a1, a0, true);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, R * 0.14, cx, cy, len);
    g.addColorStop(0, col + '33'); g.addColorStop(1, col + 'dd');
    ctx.fillStyle = g;
    ctx.fill();

    // a favourite gets a bright cap
    if (state.favorites.has(t.id)) {
      ctx.beginPath();
      ctx.arc(cx, cy, len + 5, a0, a1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; ctx.stroke();
    }
  }

  /* hub */
  const totalMs = played.reduce((a, x) => a + x.s.ms, 0);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = css('--bg-1', '#12101a'); ctx.fill();
  ctx.strokeStyle = cols[0]; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = css('--text', '#fff');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 20px Outfit, system-ui, sans-serif';
  ctx.fillText(fmtSpan(totalMs), cx, cy - 2);
  ctx.font = '500 10px Outfit, system-ui, sans-serif';
  ctx.fillStyle = css('--text-3', '#888');
  ctx.fillText('listened', cx, cy + 14);
  ctx.textBaseline = 'alphabetic';
}

/* ═══════════════════════════════════════════════════════════
   7 · ECHO MAP — the replay heat overlay on the waveform
   ═══════════════════════════════════════════════════════════ */

/** normalised 0..1 heat per bucket, or null when nothing to show */
export function echoHeat(trackId) {
  const raw = echoFor(trackId);
  if (!raw) return null;
  const max = Math.max(...raw);
  if (max < 2) return null;                       // not enough signal yet
  // light smoothing so the heat reads as regions, not spikes
  const out = new Float32Array(ECHO_BUCKETS);
  for (let i = 0; i < ECHO_BUCKETS; i++) {
    const a = raw[i - 1] ?? 0, b = raw[i], c = raw[i + 1] ?? 0;
    out[i] = ((a + b * 2 + c) / 4) / max;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   8 · WAKE LOCK — keep the screen alive in full-screen mode
   ═══════════════════════════════════════════════════════════ */

export const wakeLock = {
  sentinel: null,
  async acquire() {
    if (!supports.wakeLock || this.sentinel) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; });
      return true;
    } catch { return false; }
  },
  async release() {
    try { await this.sentinel?.release(); } catch {}
    this.sentinel = null;
  },
};
