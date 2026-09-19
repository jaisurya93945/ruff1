/* ═══════════════════════════════════════════════════════════
   AURA · cloud — optional cross-device sync.

   BroadcastChannel (features.js → tabSync) only ever reaches
   other tabs in the same browser. This module is what actually
   crosses devices: it talks to the worker in tools/aura-worker.js.

   Two independent things:

     Sync        playlists, favourites, marks, stats and the
                 appearance settings, merged rather than
                 overwritten, so two devices editing offline
                 both keep their additions.

     Handoff     the track and position you were on, so the
                 other device can offer "continue from here".
                 With Live Follow on it follows continuously
                 (poll-based, so expect a second or two of drift
                 — sample-accurate lockstep would need a
                 WebSocket, which a KV-backed worker is not).

   Everything is keyed by track `src`, not by the internal id,
   so it survives the library being re-indexed in a different
   order on another device.
   ═══════════════════════════════════════════════════════════ */
import { ls, uid, debounce, fmtTime } from './util.js';
import {
  state, set, emit, on, persist, trackById, statFor,
} from './store.js';

/* ── throttles, tuned to stay well inside the KV free tier ── */
const STATE_PUSH_MIN_MS = 30_000;
const NOW_PUSH_MIN_MS   = 15_000;
const POLL_IDLE_MS      = 20_000;
const POLL_FOLLOW_MS    = 3_000;
const FOLLOW_DRIFT_S    = 4;        // re-seek only if we drift more than this

export const cloud = {
  deviceId: ls.get('deviceId') || (() => { const v = uid('d_'); ls.set('deviceId', v); return v; })(),
  deviceName: detectDevice(),
  status: 'off',          // off | ready | syncing | error
  lastPull: 0,
  lastStatePush: 0,
  lastNowPush: 0,
  remoteNow: null,
  _poll: null,
  _offered: null,         // remote `at` we have already prompted about
  _applying: false,       // suppress push-on-change while applying a pull

  get enabled() {
    const s = state.settings;
    return !!(s.syncEndpoint || '').trim() && (s.syncRoom || '').trim().length >= 8;
  },

  base() {
    let url = (state.settings.syncEndpoint || '').trim().replace(/\/+$/, '');
    return url;
  },

  async start() {
    this.stopPolling();
    if (!this.enabled) { this.setStatus('off'); return; }
    this.setStatus('syncing');
    await this.pull();
    await this.pushNow({ force: true });
    this.schedulePoll();
  },

  setStatus(s, detail = '') {
    this.status = s;
    this.detail = detail;
    emit('cloud', { status: s, detail, lastPull: this.lastPull });
  },

  schedulePoll() {
    this.stopPolling();
    if (!this.enabled) return;
    const every = state.settings.liveFollow ? POLL_FOLLOW_MS : POLL_IDLE_MS;
    this._poll = setInterval(() => this.tick(), every);
  },
  stopPolling() { clearInterval(this._poll); this._poll = null; },

  async tick() {
    if (document.hidden && !state.settings.liveFollow) return;
    await this.pullNow();
  },

  /* ── request helper ──────────────────────────────────── */
  async call(path, { method = 'GET', body = null } = {}) {
    const room = encodeURIComponent((state.settings.syncRoom || '').trim());
    const url = `${this.base()}${path}${path.includes('?') ? '&' : '?'}room=${room}`;
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? ' — ' + text.slice(0, 160) : ''}`);
    }
    return res.json();
  },

  /* ═══ library state ═══════════════════════════════════ */

  /** what this device currently knows, keyed by track src */
  snapshot() {
    const srcOf = (id) => trackById(id)?.src || null;
    const portable = (src) => src && !/^(blob|data):/.test(src);

    const favorites = [...state.favorites].map(srcOf).filter(portable);

    const marks = {};
    for (const [id, times] of Object.entries(state.marks)) {
      const src = srcOf(id);
      if (portable(src) && times?.length) marks[src] = times;
    }

    const stats = {};
    for (const [id, s] of Object.entries(state.stats)) {
      const src = srcOf(id);
      if (portable(src)) stats[src] = { plays: s.plays | 0, ms: s.ms | 0, last: s.last | 0, skips: s.skips | 0 };
    }

    const playlists = state.playlists.map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt || 0,
      updatedAt: p.updatedAt || p.createdAt || 0,
      tracks: p.trackIds.map(srcOf).filter(portable),
    }));

    const recent = state.recent.map(srcOf).filter(portable).slice(0, 60);

    const s = state.settings;
    const settings = {
      theme: s.theme, mode: s.mode, morph: s.morph, artColor: s.artColor,
      eqEnabled: s.eqEnabled, eqGains: s.eqGains, eqPreset: s.eqPreset, bassBoost: s.bassBoost,
      crossfade: s.crossfade, normalize: s.normalize, showLyrics: s.showLyrics, vizMode: s.vizMode,
    };

    return { favorites, marks, stats, playlists, recent, settings, at: Date.now() };
  },

  async push({ force = false } = {}) {
    if (!this.enabled || this._applying) return;
    const now = Date.now();
    if (!force && now - this.lastStatePush < STATE_PUSH_MIN_MS) return;
    this.lastStatePush = now;
    try {
      await this.call('/state', { method: 'PUT', body: { data: this.snapshot(), device: this.deviceName } });
      this.setStatus('ready');
    } catch (err) {
      this.setStatus('error', err.message);
    }
  },

  async pull() {
    if (!this.enabled) return null;
    try {
      const remote = await this.call('/state');
      this.lastPull = Date.now();
      if (remote?.empty || !remote?.data) {
        this.setStatus('ready', 'nothing stored yet — pushing this device');
        await this.push({ force: true });
        return null;
      }
      const changed = this.merge(remote.data);
      this.setStatus('ready', changed ? `merged from ${remote.device || 'another device'}` : 'up to date');
      // our merge may have added things the remote lacks — send the union back
      if (changed) await this.push({ force: true });
      return remote;
    } catch (err) {
      this.setStatus('error', err.message);
      return null;
    }
  },

  /**
   * Merge remote into local. Additive wherever a union is safe, so an
   * offline edit on one device never silently erases the other's.
   */
  merge(remote) {
    const bySrc = new Map();
    for (const t of state.tracks) if (t.src) bySrc.set(t.src, t.id);
    const idOf = (src) => bySrc.get(src) || null;

    this._applying = true;
    let changed = false;

    try {
      /* favourites — union */
      for (const src of remote.favorites || []) {
        const id = idOf(src);
        if (id && !state.favorites.has(id)) { state.favorites.add(id); changed = true; }
      }

      /* marks — union per track, deduped within 1.2s */
      for (const [src, times] of Object.entries(remote.marks || {})) {
        const id = idOf(src);
        if (!id) continue;
        const list = state.marks[id] ||= [];
        for (const t of times) {
          if (!list.some(m => Math.abs(m - t) < 1.2)) { list.push(t); changed = true; }
        }
        list.sort((a, b) => a - b);
      }

      /* stats — take the higher counter on each side */
      for (const [src, rs] of Object.entries(remote.stats || {})) {
        const id = idOf(src);
        if (!id) continue;
        const local = state.stats[id] ||= { plays: 0, ms: 0, last: 0, skips: 0 };
        const merged = {
          plays: Math.max(local.plays | 0, rs.plays | 0),
          ms:    Math.max(local.ms | 0, rs.ms | 0),
          last:  Math.max(local.last | 0, rs.last | 0),
          skips: Math.max(local.skips | 0, rs.skips | 0),
        };
        if (merged.plays !== local.plays || merged.ms !== local.ms) changed = true;
        state.stats[id] = merged;
      }

      /* playlists — by id, newest wins; unknown ones are added */
      for (const rp of remote.playlists || []) {
        const ids = (rp.tracks || []).map(idOf).filter(Boolean);
        const mine = state.playlists.find(p => p.id === rp.id);
        if (!mine) {
          state.playlists.push({ id: rp.id, name: rp.name, trackIds: ids, createdAt: rp.createdAt, updatedAt: rp.updatedAt });
          changed = true;
        } else if ((rp.updatedAt || 0) > (mine.updatedAt || mine.createdAt || 0)) {
          mine.name = rp.name;
          mine.trackIds = ids;
          mine.updatedAt = rp.updatedAt;
          changed = true;
        }
      }

      /* recently played — remote first, then ours, deduped */
      const remoteRecent = (remote.recent || []).map(idOf).filter(Boolean);
      if (remoteRecent.length) {
        const merged = [...new Set([...remoteRecent, ...state.recent])].slice(0, 60);
        if (merged.join() !== state.recent.join()) { state.recent = merged; changed = true; }
      }

      /* appearance + playback settings — remote wins if it differs */
      for (const [k, v] of Object.entries(remote.settings || {})) {
        if (v === undefined) continue;
        if (JSON.stringify(state.settings[k]) !== JSON.stringify(v)) {
          state.settings[k] = v;
          changed = true;
        }
      }

      if (changed) {
        persist.all();
        ls.set('settings', state.settings);
        emit('cloud:merged', remote);
      }
    } finally {
      this._applying = false;
    }
    return changed;
  },

  /* ═══ now playing / handoff ═══════════════════════════ */

  async pushNow({ force = false } = {}) {
    if (!this.enabled) return;
    const t = state.current;
    if (!t || !t.src || /^(blob|data):/.test(t.src)) return;
    const now = Date.now();
    if (!force && now - this.lastNowPush < NOW_PUSH_MIN_MS) return;
    this.lastNowPush = now;
    try {
      await this.call('/now', {
        method: 'PUT',
        body: {
          src: t.src, title: t.title, artist: t.artist,
          time: state.time, duration: state.duration,
          playing: state.playing, device: this.deviceName, deviceId: this.deviceId,
        },
      });
    } catch (err) {
      this.setStatus('error', err.message);
    }
  },

  async pullNow() {
    if (!this.enabled) return null;
    try {
      const r = await this.call('/now');
      if (r?.empty || !r?.src) return null;
      if (r.deviceId === this.deviceId) return null;      // our own echo
      this.remoteNow = r;
      emit('cloud:now', r);

      if (state.settings.liveFollow) this.follow(r);
      else this.offerHandoff(r);
      return r;
    } catch (err) {
      this.setStatus('error', err.message);
      return null;
    }
  },

  /** estimate where the other device is right now, allowing for poll lag */
  projected(r) {
    const drift = (Date.now() - r.at) / 1000;
    return r.playing ? r.time + drift : r.time;
  },

  follow(r) {
    const target = trackSrcToTrack(r.src);
    if (!target) return;
    const want = this.projected(r);

    if (state.current?.id !== target.id) {
      emit('cloud:follow', { track: target, time: want, playing: r.playing, device: r.device });
      return;
    }
    if (Math.abs(state.time - want) > FOLLOW_DRIFT_S) {
      emit('cloud:seek', { time: want });
    }
    if (r.playing !== state.playing) {
      emit('cloud:playstate', { playing: r.playing });
    }
  },

  /** a one-time, dismissible prompt — never hijack playback unasked */
  offerHandoff(r) {
    if (this._offered === r.at) return;
    if (!r.playing && Date.now() - r.at > 60_000) return;      // stale and paused
    const target = trackSrcToTrack(r.src);
    if (!target) return;
    if (state.current?.id === target.id && Math.abs(state.time - this.projected(r)) < 20) return;
    this._offered = r.at;
    emit('cloud:handoff', { track: target, time: this.projected(r), device: r.device, playing: r.playing });
  },

  async reset() {
    this.stopPolling();
    this.remoteNow = null;
    this._offered = null;
    this.lastStatePush = 0;
    this.lastNowPush = 0;
    await this.start();
  },

  /** Settings screen uses this to prove the endpoint works */
  async test() {
    if (!(state.settings.syncEndpoint || '').trim()) return { ok: false, error: 'No endpoint set.' };
    try {
      const res = await fetch(this.base() + '/health', { cache: 'no-store' });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const j = await res.json();
      if (!j.kv) return { ok: false, error: 'Worker is up, but no KV namespace is bound. Add a binding named AURA.' };
      if ((state.settings.syncRoom || '').trim().length < 8) return { ok: false, error: 'Room key must be at least 8 characters.' };
      await this.call('/state');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

function trackSrcToTrack(src) {
  return state.tracks.find(t => t.src === src) || null;
}

function detectDevice() {
  const ua = navigator.userAgent;
  const nav = navigator.userAgentData;
  if (nav?.platform) {
    if (/android/i.test(nav.platform)) return 'Android';
    if (/mac/i.test(nav.platform)) return 'Mac';
    if (/windows/i.test(nav.platform)) return 'Windows PC';
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return 'a device';
}

/* ── change hooks: anything worth syncing schedules a push ── */
const schedulePush = debounce(() => cloud.push(), 5000);

for (const ev of ['favorites', 'playlists', 'marks', 'recent']) {
  on(ev, () => { if (!cloud._applying) schedulePush(); });
}
on('setting', ({ key }) => {
  if (['syncEndpoint', 'syncRoom', 'liveFollow'].includes(key)) return;   // handled explicitly
  if (!cloud._applying) schedulePush();
});
on('trackchange', () => cloud.pushNow({ force: true }));
on('playstate', () => cloud.pushNow({ force: true }));
on('time', () => cloud.pushNow());
