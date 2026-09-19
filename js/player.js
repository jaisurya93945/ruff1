/* ═══════════════════════════════════════════════════════════
   AURA · player — the transport. Owns the queue, the history,
   stats, the Media Session, and the hand-off between tracks.
   It talks to the UI only through events, never by importing it.
   ═══════════════════════════════════════════════════════════ */
import { clamp, shuffled, supports, haptic } from './util.js';
import { state, set, emit, on, trackById, bumpStat, bumpEcho, persist, pushRecent, ECHO_BUCKETS } from './store.js';
import { engine } from './engine.js';
import { getPeaks, BeatDetector } from './analysis.js';
import { parseLRC, fetchLRC } from './library.js';
import { sleep as sleepTimer, tabSync } from './features.js';

export const beat = new BeatDetector();

let listenStart = 0;        // performance.now() when the current segment began
let listenAccum = 0;        // ms credited to the current track
let echoClock = 0;          // last second we credited to the echo map
let statCounted = false;    // "a play" is only counted once per start

export const player = {

  /* ── queue ─────────────────────────────────────────────── */

  /**
   * Replace the queue and start playing.
   * @param {Array} tracks
   * @param {number} startIndex
   * @param {{shuffle?:boolean, autoplay?:boolean, label?:string}} opts
   */
  setQueue(tracks, startIndex = 0, { autoplay = true, label = '' } = {}) {
    if (!tracks?.length) return;
    const ids = tracks.map(t => t.id);
    let order = ids;
    let idx = clamp(startIndex, 0, ids.length - 1);

    if (state.shuffle) {
      const first = ids[idx];
      order = [first, ...shuffled(ids.filter(id => id !== first))];
      idx = 0;
    }
    set({ queue: order, qIndex: idx, queueLabel: label }, 'queue');
    this.playAt(idx, { autoplay });
  },

  /** queue a track to play right after the current one */
  playNext(trackOrId) {
    const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const q = state.queue.filter(x => x !== id);
    const at = clamp(state.qIndex + 1, 0, q.length);
    q.splice(at, 0, id);
    const newIndex = state.qIndex >= 0 ? q.indexOf(state.queue[state.qIndex] ?? id) : -1;
    set({ queue: q, qIndex: newIndex < 0 ? state.qIndex : newIndex }, 'queue');
    emit('notify', { text: 'Playing next', icon: 'queue' });
  },

  /** append to the end of the queue */
  enqueue(tracksOrIds) {
    const ids = [tracksOrIds].flat().map(t => typeof t === 'string' ? t : t.id);
    const fresh = ids.filter(id => !state.queue.includes(id));
    if (!fresh.length) { emit('notify', { text: 'Already in the queue' }); return 0; }
    set({ queue: [...state.queue, ...fresh] }, 'queue');
    emit('notify', { text: `Added ${fresh.length} to queue`, icon: 'queue' });
    if (state.qIndex < 0) this.playAt(0);
    return fresh.length;
  },

  removeAt(index) {
    if (index < 0 || index >= state.queue.length) return;
    const q = [...state.queue];
    q.splice(index, 1);
    let i = state.qIndex;
    if (index < i) i--;
    else if (index === i) i = Math.min(i, q.length - 1);
    set({ queue: q, qIndex: i }, 'queue');
    if (index === state.qIndex && q.length) this.playAt(i);
    else if (!q.length) this.stop();
  },

  moveInQueue(from, to) {
    const q = [...state.queue];
    if (from < 0 || from >= q.length || to < 0 || to >= q.length) return;
    const currentId = state.queue[state.qIndex];
    const [moved] = q.splice(from, 1);
    q.splice(to, 0, moved);
    set({ queue: q, qIndex: q.indexOf(currentId) }, 'queue');
  },

  clearQueue() {
    set({ queue: [], qIndex: -1 }, 'queue');
    this.stop();
  },

  /* ── transport ─────────────────────────────────────────── */

  async playAt(index, { autoplay = true, startAt = 0 } = {}) {
    const id = state.queue[index];
    const track = trackById(id);
    if (!track) return;

    this._commitListening();

    set({ qIndex: index, current: track, time: startAt, duration: track.duration || 0 }, 'track');
    listenStart = performance.now();
    listenAccum = 0;
    echoClock = -1;
    statCounted = false;
    beat.reset();

    await engine.load(track, { autoplay, startAt, crossfade: state.settings.crossfade });

    pushRecent(track.id);
    bumpStat(track.id, { last: Date.now() });
    this._mediaSession(track);
    this._loadExtras(track);
    this._preloadNext();

    tabSync.send('track', { id: track.id, index, time: startAt, playing: autoplay });
    emit('trackchange', track);
  },

  async play()  { await engine.play();  },
  pause()       { engine.pause(); },
  async toggle(){
    if (!state.current) {
      // nothing loaded — start the library from the top
      if (state.tracks.length) this.setQueue(state.tracks, 0);
      return;
    }
    haptic(8);
    await engine.toggle();
    tabSync.send('toggle', { playing: !engine.paused, time: engine.currentTime });
  },

  stop() {
    this._commitListening();
    engine.stop();
    set({ current: null, playing: false, time: 0, duration: 0 }, 'track');
    if (supports.mediaSession) { try { navigator.mediaSession.playbackState = 'none'; } catch {} }
    emit('trackchange', null);
  },

  next({ user = true } = {}) {
    if (!state.queue.length) return;
    if (user && state.current && engine.currentTime < engine.duration * 0.55) {
      bumpStat(state.current.id, { skips: 1 });
    }
    const last = state.queue.length - 1;

    if (state.repeat === 'one' && !user) return this.playAt(state.qIndex);

    if (state.qIndex >= last) {
      if (state.repeat === 'all') return this.playAt(0);
      if (user) return this.playAt(0);
      this.pause();
      set({ playing: false }, 'playstate');
      emit('queue:end');
      return;
    }
    this.playAt(state.qIndex + 1);
  },

  prev() {
    // the familiar behaviour: restart first, jump back only if already near the top
    if (engine.currentTime > 3.2) { this.seek(0); return; }
    if (state.qIndex <= 0) { this.seek(0); return; }
    this.playAt(state.qIndex - 1);
  },

  seek(seconds) {
    const before = engine.currentTime;
    engine.seek(seconds);
    // a jump backwards is the clearest "I want to hear that again" signal
    if (state.current && before - seconds > 2.5) {
      const d = engine.duration || state.current.duration || 1;
      for (let i = 0; i < 3; i++) bumpEcho(state.current.id, clamp(seconds / d, 0, 0.999));
      persist.echo();
      emit('echo', { trackId: state.current.id });
    }
    tabSync.send('seek', { time: seconds });
  },
  nudge(delta) { this.seek(clamp(engine.currentTime + delta, 0, engine.duration || 0)); },

  /* ── modes ─────────────────────────────────────────────── */

  toggleShuffle() {
    const on = !state.shuffle;
    set({ shuffle: on }, 'mode');
    localStorage.setItem('aura:shuffle', JSON.stringify(on));

    if (state.queue.length > 1) {
      const currentId = state.queue[state.qIndex];
      if (on) {
        const rest = shuffled(state.queue.filter(id => id !== currentId));
        set({ queue: [currentId, ...rest], qIndex: 0 }, 'queue');
      } else {
        // restore library order, keeping the current track under the cursor
        const order = state.tracks.map(t => t.id).filter(id => state.queue.includes(id));
        set({ queue: order, qIndex: Math.max(0, order.indexOf(currentId)) }, 'queue');
      }
    }
    emit('notify', { text: on ? 'Shuffle on' : 'Shuffle off', icon: 'shuffle' });
    return on;
  },

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    const next = order[(order.indexOf(state.repeat) + 1) % 3];
    set({ repeat: next }, 'mode');
    localStorage.setItem('aura:repeat', JSON.stringify(next));
    emit('notify', { text: { off: 'Repeat off', all: 'Repeat all', one: 'Repeat this track' }[next], icon: next === 'one' ? 'repeat1' : 'repeat' });
    return next;
  },

  setVolume(v) {
    engine.setVolume(v);
    set({ muted: false }, 'volume');
    state.settings.volume = v;
    localStorage.setItem('aura:settings', JSON.stringify(state.settings));
    emit('volume', v);
  },
  toggleMute() {
    const m = !state.muted;
    engine.setMuted(m);
    set({ muted: m }, 'volume');
    emit('volume', engine.volume);
    return m;
  },

  /* ── side effects ──────────────────────────────────────── */

  async _loadExtras(track) {
    // lyrics
    if (state.settings.showLyrics) {
      const raw = await fetchLRC(track).catch(() => null);
      const lines = parseLRC(raw || track.lrc);
      emit('lyrics', { trackId: track.id, lines });
    } else {
      emit('lyrics', { trackId: track.id, lines: null });
    }
    // waveform peaks (cached after the first decode)
    emit('peaks', { trackId: track.id, peaks: null, loading: true });
    const p = await getPeaks(track).catch(() => null);
    if (state.current?.id === track.id) emit('peaks', { trackId: track.id, peaks: p, loading: false });
  },

  _preloadNext() {
    if (!state.settings.gapless) return;
    const nextId = state.queue[state.qIndex + 1];
    const t = nextId && trackById(nextId);
    if (t) engine.preload(t);
  },

  _mediaSession(track) {
    if (!supports.mediaSession) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'AURA',
        artwork: track.cover ? [96, 128, 192, 256, 384, 512].map(s => ({
          src: track.cover, sizes: `${s}x${s}`, type: 'image/png',
        })) : [],
      });
      const A = navigator.mediaSession;
      A.setActionHandler('play', () => this.play());
      A.setActionHandler('pause', () => this.pause());
      A.setActionHandler('previoustrack', () => this.prev());
      A.setActionHandler('nexttrack', () => this.next());
      A.setActionHandler('seekbackward', (d) => this.nudge(-(d?.seekOffset || 10)));
      A.setActionHandler('seekforward', (d) => this.nudge(d?.seekOffset || 10));
      try { A.setActionHandler('seekto', (d) => d.seekTime != null && this.seek(d.seekTime)); } catch {}
      try { A.setActionHandler('stop', () => this.stop()); } catch {}
    } catch {}
  },

  _updatePositionState() {
    if (!supports.mediaSession || !navigator.mediaSession.setPositionState) return;
    const d = engine.duration;
    if (!d || !Number.isFinite(d)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: engine.audio.playbackRate || 1,
        position: clamp(engine.currentTime, 0, d),
      });
    } catch {}
  },

  /** credit listening time + a play, once the segment ends */
  _commitListening() {
    if (!state.current || !listenStart) return;
    const ms = listenAccum + (state.playing ? performance.now() - listenStart : 0);
    if (ms > 1500) bumpStat(state.current.id, { ms: Math.round(ms) });
    listenStart = 0; listenAccum = 0;
  },
};

/* ═══════════════════════════════════════════════════════════
   engine → store wiring
   ═══════════════════════════════════════════════════════════ */

engine.addEventListener('play', () => {
  document.body.classList.add('playing');
  set({ playing: true }, 'playstate');
  listenStart = performance.now();
  if (supports.mediaSession) { try { navigator.mediaSession.playbackState = 'playing'; } catch {} }
  emit('playstate', true);
});

engine.addEventListener('pause', () => {
  document.body.classList.remove('playing');
  if (listenStart) { listenAccum += performance.now() - listenStart; listenStart = 0; }
  set({ playing: false }, 'playstate');
  if (supports.mediaSession) { try { navigator.mediaSession.playbackState = 'paused'; } catch {} }
  emit('playstate', false);
});

engine.addEventListener('loaded', (e) => {
  const d = e.detail.duration || 0;
  if (state.current && d && !state.current.duration) state.current.duration = d;
  set({ duration: d }, 'duration');
  player._updatePositionState();
  emit('duration', d);
});

engine.addEventListener('time', (e) => {
  const { time, duration } = e.detail;
  state.time = time;
  if (duration) state.duration = duration;

  // a play counts once you're 20 seconds or 25% in — whichever comes first
  if (!statCounted && state.current && (time > 20 || (duration && time / duration > 0.25))) {
    statCounted = true;
    bumpStat(state.current.id, { plays: 1 });
    emit('stats', state.current.id);
  }

  // echo map: credit the bucket you're actually hearing, once a second
  if (state.current && duration) {
    const sec = Math.floor(time);
    if (sec !== echoClock) {
      echoClock = sec;
      bumpEcho(state.current.id, clamp(time / duration, 0, 0.999));
      if (sec % 12 === 0) persist.echo();
    }
  }

  emit('time', { time, duration });
});

engine.addEventListener('progress', (e) => emit('buffered', e.detail));

engine.addEventListener('ended', () => {
  player._commitListening();
  if (sleepTimer.trackEnded()) { player.pause(); return; }
  if (state.repeat === 'one') { player.playAt(state.qIndex); return; }
  player.next({ user: false });
});

// crossfade: start the next track early so the two overlap
engine.addEventListener('nearend', () => {
  if (state.repeat === 'one') return;
  const nextIdx = state.qIndex + 1;
  if (nextIdx >= state.queue.length && state.repeat !== 'all') return;
  const idx = nextIdx >= state.queue.length ? 0 : nextIdx;
  player._commitListening();
  player.playAt(idx);
});

engine.addEventListener('error', (e) => {
  emit('notify', { text: e.detail.message || 'Playback failed', error: true, icon: 'close' });
  // skip past a dead file rather than stalling the queue
  if (state.queue.length > 1) setTimeout(() => player.next({ user: false }), 900);
});

engine.addEventListener('blocked', (e) => emit('notify', { text: e.detail.message, icon: 'play' }));

/* ── tab party: follow whatever another tab does ──────────── */
on('sync:in', (msg) => {
  if (!state.settings.tabSync) return;
  switch (msg.type) {
    case 'track': {
      if (state.current?.id === msg.id && Math.abs(engine.currentTime - msg.time) < 2.5) return;
      const idx = state.queue.indexOf(msg.id);
      if (idx >= 0) player.playAt(idx, { autoplay: msg.playing, startAt: msg.time });
      break;
    }
    case 'toggle':
      if (msg.playing && engine.paused) engine.play();
      else if (!msg.playing && !engine.paused) engine.pause();
      if (Math.abs(engine.currentTime - msg.time) > 2.5) engine.seek(msg.time);
      break;
    case 'seek':
      if (Math.abs(engine.currentTime - msg.time) > 1.2) engine.seek(msg.time);
      break;
  }
});

/* keep the OS position bar honest */
setInterval(() => { if (state.playing) player._updatePositionState(); }, 4000);
