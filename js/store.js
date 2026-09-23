/* ═══════════════════════════════════════════════════════════
   AURA · store — one state object, a tiny pub/sub, and
   persistence for the slices worth remembering.
   ═══════════════════════════════════════════════════════════ */
import { ls, uid } from './util.js';

const listeners = new Map();   // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}
export function off(event, fn) { listeners.get(event)?.delete(fn); }
export function emit(event, payload) {
  listeners.get(event)?.forEach(fn => {
    try { fn(payload); } catch (err) { console.error(`[aura] listener "${event}" threw`, err); }
  });
  listeners.get('*')?.forEach(fn => { try { fn(event, payload); } catch {} });
}

/* ── defaults ─────────────────────────────────────────────── */
export const DEFAULT_SETTINGS = {
  theme: 'sakura',
  mode: 'dark',
  morph: 'glass',
  artColor: true,        // pull the accent from the album art
  motion: true,          // stored as a boolean so the generic toggle works
  perf: 'auto',          // auto | full | lite
  vizMode: 0,
  bgViz: true,
  crossfade: 0,          // seconds, 0 = off
  gapless: true,
  normalize: false,
  speed: 1,
  preservePitch: true,
  eqEnabled: false,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreset: 'flat',
  bassBoost: 0,
  orbit: false,
  orbitSpeed: 0.18,
  vocal: 0,              // 0 = untouched, 1 = fully cancelled (karaoke)
  reverb: 0,
  showLyrics: true,
  tabSync: false,
  presenceMode: 'auto',  // auto | local | remote | off
  presenceEndpoint: '',
  syncEndpoint: '',      // tools/aura-worker.js deployed somewhere
  syncRoom: '',          // shared secret; the same string on every device
  liveFollow: false,     // follow the other device continuously, not just on offer
  scrollLyrics: true,
  confirmDelete: true,
  volume: 1,
};

export const state = {
  /* library */
  tracks: [],
  view: 'home',
  search: '',
  sort: ls.get('sort', 'added'),
  layout: ls.get('layout', 'list'),

  /* playback */
  queue: [],
  qIndex: -1,
  history: [],
  current: null,
  playing: false,
  time: 0,
  duration: 0,
  shuffle: ls.get('shuffle', false),
  repeat: ls.get('repeat', 'off'),
  muted: false,

  /* user data */
  favorites: new Set(ls.get('favorites', [])),
  playlists: ls.get('playlists', []),
  marks: ls.get('marks', {}),          // trackId -> [seconds]
  stats: ls.get('stats', {}),          // trackId -> {plays, ms, last, skips}
  echo: ls.get('echo', {}),            // trackId -> number[64] replay heat
  recent: ls.get('recent', []),        // trackIds, newest first
  // A streaming track's length isn't in the manifest — nothing here can read
  // it without fetching the file. The browser knows it the moment the track
  // loads, so remember it and the library stops showing 0:00 next time.
  durations: ls.get('durations', {}),  // trackId -> seconds

  /* runtime */
  settings: { ...DEFAULT_SETTINGS, ...ls.get('settings', {}) },
  presence: { online: 0, total: 0, source: 'local' },
  bpm: 0,
  ready: false,
};

/* ── mutation helper: set + emit + persist ────────────────── */
export function set(patch, event = 'change') {
  Object.assign(state, patch);
  emit(event, patch);
}

export function setSetting(key, value) {
  state.settings[key] = value;
  ls.set('settings', state.settings);
  emit('setting', { key, value });
  emit('settings', state.settings);
}

/* ── persistence for the collection slices ────────────────── */
/**
 * The echo map is the only slice that grows without bound — 64 numbers per
 * track, forever. At a few hundred tracks it is the biggest thing in
 * localStorage, and when the quota is reached `setItem` throws and every
 * other slice silently stops saving too. Drop the coldest tracks and retry.
 */
function pruneEcho(keep = 200) {
  const scored = Object.keys(state.echo).map(id => ({
    id,
    // keep what you actually listen to: recency first, then play count
    score: (state.stats[id]?.last || 0) + (state.stats[id]?.plays || 0) * 1e6,
  })).sort((a, b) => b.score - a.score);

  if (scored.length <= keep) return false;
  const next = {};
  for (const { id } of scored.slice(0, keep)) next[id] = state.echo[id];
  const dropped = scored.length - keep;
  state.echo = next;
  console.info(`[aura] storage was full — dropped echo data for ${dropped} cold tracks`);
  return true;
}

export const persist = {
  favorites: () => ls.set('favorites', [...state.favorites]),
  playlists: () => ls.set('playlists', state.playlists),
  marks:     () => ls.set('marks', state.marks),
  stats:     () => ls.set('stats', state.stats),
  echo() {
    if (ls.set('echo', state.echo)) return true;
    // out of room: shed the coldest history and try once more
    if (pruneEcho() && ls.set('echo', state.echo)) return true;
    emit('notify', { text: 'Storage is full — older listening history was trimmed', icon: 'trash' });
    return false;
  },
  recent:    () => ls.set('recent', state.recent.slice(0, 60)),
  durations: () => ls.set('durations', state.durations),
  all() { Object.keys(this).forEach(k => k !== 'all' && typeof this[k] === 'function' && this[k]()); },
};

/* ── favourites ───────────────────────────────────────────── */
export function toggleFavorite(id) {
  const has = state.favorites.has(id);
  has ? state.favorites.delete(id) : state.favorites.add(id);
  persist.favorites();
  emit('favorites', { id, on: !has });
  return !has;
}
export const isFavorite = (id) => state.favorites.has(id);

/* ── playlists ────────────────────────────────────────────── */
export function createPlaylist(name, trackIds = []) {
  const now = Date.now();
  const pl = { id: uid('pl_'), name: name.trim() || 'Untitled', trackIds: [...trackIds], createdAt: now, updatedAt: now };
  state.playlists.unshift(pl);
  persist.playlists();
  emit('playlists', state.playlists);
  return pl;
}
export function updatePlaylist(id, patch) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return null;
  Object.assign(pl, patch, { updatedAt: Date.now() });
  persist.playlists();
  emit('playlists', state.playlists);
  return pl;
}
export function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  persist.playlists();
  emit('playlists', state.playlists);
}
export function addToPlaylist(playlistId, trackIds) {
  const pl = state.playlists.find(p => p.id === playlistId);
  if (!pl) return 0;
  const ids = [trackIds].flat();
  const fresh = ids.filter(id => !pl.trackIds.includes(id));
  pl.trackIds.push(...fresh);
  pl.updatedAt = Date.now();
  persist.playlists();
  emit('playlists', state.playlists);
  return fresh.length;
}
export function removeFromPlaylist(playlistId, trackId) {
  const pl = state.playlists.find(p => p.id === playlistId);
  if (!pl) return;
  pl.trackIds = pl.trackIds.filter(t => t !== trackId);
  pl.updatedAt = Date.now();
  persist.playlists();
  emit('playlists', state.playlists);
}

/* ── moment marks ─────────────────────────────────────────── */
export function addMark(trackId, seconds) {
  const list = state.marks[trackId] ||= [];
  const t = Math.round(seconds * 10) / 10;
  if (list.some(m => Math.abs(m - t) < 1.2)) return false;   // dedupe near-identical marks
  list.push(t); list.sort((a, b) => a - b);
  persist.marks();
  emit('marks', { trackId, marks: list });
  return true;
}
export function removeMark(trackId, seconds) {
  const list = state.marks[trackId];
  if (!list) return;
  state.marks[trackId] = list.filter(m => Math.abs(m - seconds) > 0.05);
  if (!state.marks[trackId].length) delete state.marks[trackId];
  persist.marks();
  emit('marks', { trackId, marks: state.marks[trackId] || [] });
}
export const marksFor = (trackId) => state.marks[trackId] || [];

/* ── listening stats ──────────────────────────────────────── */
export function bumpStat(trackId, patch) {
  const s = state.stats[trackId] ||= { plays: 0, ms: 0, last: 0, skips: 0 };
  if (patch.plays) s.plays += patch.plays;
  if (patch.ms)    s.ms    += patch.ms;
  if (patch.skips) s.skips += patch.skips;
  if (patch.last)  s.last   = patch.last;
  persist.stats();
}
export const statFor = (id) => state.stats[id] || { plays: 0, ms: 0, last: 0, skips: 0 };

/* ── echo map: which 1/64th of a track you keep replaying ─── */
export const ECHO_BUCKETS = 64;
export function bumpEcho(trackId, ratio) {
  const arr = state.echo[trackId] ||= new Array(ECHO_BUCKETS).fill(0);
  const i = Math.min(ECHO_BUCKETS - 1, Math.max(0, Math.floor(ratio * ECHO_BUCKETS)));
  arr[i]++;
  return arr;
}
export const echoFor = (id) => state.echo[id] || null;

/* ── recently played ──────────────────────────────────────── */
export function pushRecent(trackId) {
  state.recent = [trackId, ...state.recent.filter(t => t !== trackId)].slice(0, 60);
  persist.recent();
  emit('recent', state.recent);
}

/* ── lookups ──────────────────────────────────────────────── */
export const trackById = (id) => state.tracks.find(t => t.id === id) || null;
export const tracksByIds = (ids) => ids.map(trackById).filter(Boolean);
