/* ═══════════════════════════════════════════════════════════
   AURA · main — boot, wiring, keyboard, and the render loop
   that keeps the player chrome in step with the audio.
   ═══════════════════════════════════════════════════════════ */
import { $, $$, el, icon, fmtTime, clamp, debounce, throttle, supports, haptic, ls, pointerRatio, fmtDur} from './util.js';
import {
  state, set, on, emit, setSetting, trackById, tracksByIds, isFavorite, toggleFavorite,
  addMark, marksFor, persist,
} from './store.js';
import { engine, EQ_PRESETS } from './engine.js';
import { player, beat } from './player.js';
import { loadManifest, importFiles, rehydrateLocal, pruneMissing, makeTrack } from './library.js';
import { initThemes, applyArtColor, clearArtColor, openThemeDock, closeThemeDock, THEMES, paintBackdrop, initParallax } from './themes.js';
import { Visualizer, CoverRing, VIZ_MODES } from './visualizer.js';
import {
  presence, renderPresence, sleep as sleepTimer, tabSync, wakeLock, echoHeat,
} from './features.js';
import {
  toast, modal, closeModal, modalOpen, confirm, WaveformView, LyricsView, trackRow, lazyImg, FALLBACK_ART, generatedArt, closeContext,
} from './ui.js';
import { cloud, consumePairingLink } from './cloud.js';
import {
  setView, renderView, refreshCurrentView, openEQ, openVocal, openSpeed, openSleep,
  openVibeCard, openMoodDJ, openHelp, openMarks, applyLabToggle, stopMarkLoop,
} from './views.js';

/* ═══ boot ═════════════════════════════════════════════════ */

const boot = {
  say(text) { const n = $('#bootSub'); if (n) n.textContent = text; },
  done() {
    $('#boot')?.classList.add('gone');
    setTimeout(() => $('#boot')?.remove(), 700);
    $('#app').hidden = false;
    $('#playerBar').hidden = false;
    $('#mobileNav').hidden = false;
  },
};

let viz, ring, wave, lyrics;

async function start() {
  // a ?pair= link configures this device and strips itself from the URL
  const paired = consumePairingLink(setSetting);

  initThemes();
  paintBackdrop();          // placeholder is inline, so this paints immediately
  initParallax();
  engine.init();

  /* restore audio settings */
  const s = state.settings;
  engine.setVolume(s.volume ?? 1);
  engine.setCrossfade(s.crossfade);
  engine.setSpeed(s.speed);
  engine.setPreservePitch(s.preservePitch);
  engine.setNormalize(s.normalize);
  engine.setBass(s.bassBoost);
  engine.setVocal(s.vocal);
  if (s.eqEnabled) engine.setEQAll(s.eqGains);
  if (s.orbit) engine.setOrbit(true, s.orbitSpeed);
  $('#vol').value = s.volume ?? 1;
  paintVolume();
  $('#speedLabel').textContent = (s.speed || 1).toFixed(1) + '×';

  /* library */
  boot.say('reading the shelf…');
  let tracks = await loadManifest();

  const savedLocal = ls.get('localTracks', []);
  if (savedLocal.length) {
    boot.say('restoring your imports…');
    const live = await rehydrateLocal(savedLocal.map(makeTrack));
    tracks = [...live, ...tracks];
    if (live.length !== savedLocal.length) ls.set('localTracks', live.map(stripBlobURL));
  }

  if (tracks.length) {
    boot.say('checking the files…');
    tracks = await pruneMissing(tracks);
  }
  // a length we learned on a previous visit beats the manifest's 0
  for (const t of tracks) if (!t.duration && state.durations[t.id]) t.duration = state.durations[t.id];

  set({ tracks, ready: true }, 'library');

  /* views + chrome */
  wireChrome();
  wireKeyboard();
  wireDropZone();
  startVisualizers();
  presence.start();
  if (state.settings.tabSync) tabSync.start();
  cloud.start();                     // no-op unless an endpoint + room key are set

  setView('home');
  renderPresence();
  restoreSession();
  if (paired) {
    toast('Device linked — pulling your library', { icon: 'sync', ms: 5000 });
  }

  boot.done();
  registerServiceWorker();

  if (!tracks.length) {
    setTimeout(() => toast('No audio found — drag files here, or run tools/build-manifest.mjs', { icon: 'folder', ms: 6000 }), 900);
  }
}

const stripBlobURL = (t) => ({ ...t, src: '' });

/** put the user back where they were, paused */
function restoreSession() {
  const last = ls.get('session', null);
  if (!last?.trackId) return;
  const t = trackById(last.trackId);
  if (!t) return;
  const queue = (last.queue || []).filter(id => trackById(id));
  if (queue.length) set({ queue, qIndex: Math.max(0, queue.indexOf(last.trackId)) }, 'queue');
  else set({ queue: [t.id], qIndex: 0 }, 'queue');
  player.playAt(state.qIndex, { autoplay: false, startAt: last.time || 0 });
}

const saveSession = throttle(() => {
  if (!state.current) return;
  ls.set('session', { trackId: state.current.id, time: state.time, queue: state.queue });
}, 4000);

/* ═══ chrome wiring ════════════════════════════════════════ */

function wireChrome() {
  /* navigation */
  $$('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    setView(btn.dataset.view);
    haptic(6);
  }));
  $('#mobileMenu')?.addEventListener('click', () => setView('settings'));
  $('#railTheme')?.addEventListener('click', openThemeDock);
  $('#btnHelp')?.addEventListener('click', openHelp);
  $('#btnMoodDj')?.addEventListener('click', openMoodDJ);
  $('#mobilePresence')?.addEventListener('click', () => { setView('settings'); });

  /* search */
  const search = $('#search');
  const clear = $('#searchClear');
  const runSearch = debounce(() => {
    set({ search: search.value });
    clear.hidden = !search.value;
    if (state.view !== 'library') setView('library');
    else renderView('library');
  }, 180);
  search.addEventListener('input', runSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; set({ search: '' }); clear.hidden = true; search.blur(); renderView('library'); }
  });
  clear.addEventListener('click', () => { search.value = ''; set({ search: '' }); clear.hidden = true; renderView('library'); search.focus(); });

  /* import */
  $('#btnImport').addEventListener('click', (e) => {
    if (supports.fsAccess && 'showDirectoryPicker' in window) {
      import('./ui.js').then(({ contextMenu }) => contextMenu([
        { label: 'Choose files…', icon: 'plus', run: () => $('#filePicker').click() },
        { label: 'Choose a folder…', icon: 'folder', run: importFolder },
      ], e.clientX, e.clientY));
    } else {
      $('#filePicker').click();
    }
  });
  $('#filePicker').addEventListener('change', (e) => ingest(e.target.files));

  /* transport */
  $('#btnPlay').addEventListener('click', () => player.toggle());
  $('#npPlay').addEventListener('click', () => player.toggle());
  $('#btnNext').addEventListener('click', () => player.next());
  $('#npNext').addEventListener('click', () => player.next());
  $('#btnPrev').addEventListener('click', () => player.prev());
  $('#npPrev').addEventListener('click', () => player.prev());
  $('#btnShuffle').addEventListener('click', () => { player.toggleShuffle(); paintModes(); });
  $('#npShuffle').addEventListener('click', () => { player.toggleShuffle(); paintModes(); });
  $('#btnRepeat').addEventListener('click', () => { player.cycleRepeat(); paintModes(); });
  $('#npRepeat').addEventListener('click', () => { player.cycleRepeat(); paintModes(); });

  $('#btnLike').addEventListener('click', () => toggleLike());
  $('#btnMark').addEventListener('click', () => dropMark());
  $('#btnMute').addEventListener('click', () => { player.toggleMute(); paintVolume(); });

  const vol = $('#vol');
  vol.addEventListener('input', () => { player.setVolume(parseFloat(vol.value)); paintVolume(); });

  /* mini seek bar */
  const seek = $('#pbSeek');
  let seeking = false;
  const seekAt = (e) => player.seek(pointerRatio(e, seek) * (state.duration || 0));
  seek.addEventListener('pointerdown', (e) => { seeking = true; seek.setPointerCapture?.(e.pointerId); seekAt(e); });
  seek.addEventListener('pointermove', (e) => { if (seeking) seekAt(e); });
  seek.addEventListener('pointerup', () => { seeking = false; });
  seek.addEventListener('pointercancel', () => { seeking = false; });

  /* now playing */
  $('#btnExpand').addEventListener('click', openNowPlaying);
  $('#pbMeta').addEventListener('click', openNowPlaying);
  $('#npClose').addEventListener('click', closeNowPlaying);
  on('np:open', openNowPlaying);

  $$('.np-tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.np-tab').forEach(t => t.classList.toggle('is-on', t === tab));
    $$('.np-pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === tab.dataset.pane));
    if (tab.dataset.pane === 'up') paintNpQueue();
  }));

  $('#npVizMode').addEventListener('click', cycleViz);

  /* chips */
  $('#chipEq').addEventListener('click', openEQ);
  $('#chipKaraoke').addEventListener('click', openVocal);
  $('#chipSleep').addEventListener('click', openSleep);
  $('#chipCard').addEventListener('click', openVibeCard);
  $('#chipSpeed').addEventListener('click', openSpeed);
  $('#chipOrbit').addEventListener('click', () => {
    const on = !state.settings.orbit;
    setSetting('orbit', on);
    applyLabToggle('orbit', on);
  });

  /* waveform + lyrics */
  wave = new WaveformView($('#waveWrap'), $('#waveCanvas'), $('#waveHead'), $('#waveMarks'), $('#waveTip'));
  lyrics = new LyricsView($('#lyrics'));

  /* swipe down to close the full-screen player */
  wireSwipe();

  /* store subscriptions */
  on('presence', renderPresence);
  on('trackchange', onTrackChange);
  on('time', onTime);
  on('duration', () => { $('#pbDur').textContent = fmtDur(state.duration); $('#npDur').textContent = fmtDur(state.duration); wave.duration = state.duration; paintMarks(); });
  // a streaming track only reveals its length once it loads — show it now
  on('learned-duration', () => { if (['home', 'queue', 'library', 'playlists'].includes(state.view)) refreshCurrentView(); });
  on('playstate', paintPlayState);
  on('buffered', ({ buffered, duration }) => {
    if (duration) $('#pbBuffered').style.width = (buffered / duration * 100).toFixed(2) + '%';
  });
  on('queue', () => { paintQueueBadge(); if (state.view === 'queue') renderView('queue'); paintNpQueue(); });
  on('lyrics', ({ lines }) => lyrics.set(lines));
  on('peaks', ({ trackId, peaks, loading }) => {
    if (state.current?.id !== trackId) return;
    if (loading) wave.setPlaceholder(hash(trackId));
    else if (peaks) { wave.loading = false; wave.setPeaks(peaks.data, peaks.duration || state.duration); }
    else { wave.loading = false; wave.draw(); }
  });
  on('echo', () => wave.setHeat(state.current ? echoHeat(state.current.id) : null));
  on('favorites', () => { paintLike(); if (['home', 'playlists', 'stats'].includes(state.view)) refreshCurrentView(); });
  on('marks', paintMarks);
  on('notify', ({ text, icon: ico, error }) => toast(text, { icon: ico, error }));
  on('theme', () => { viz?.refreshColors(); wave?.draw(); if (state.view === 'home') renderView('home'); });
  on('theme:art', () => { if (state.view === 'home') renderView('home'); });
  on('accent', () => { viz?.refreshColors(); wave?.draw(); });
  on('artcolor', (onFlag) => onFlag ? applyArtColor(state.current?.cover) : clearArtColor());
  on('sleep', paintSleep);

  /* ── cross-device sync ─────────────────────────────── */
  on('cloud:merged', () => {
    refreshCurrentView();
    paintLike();
    paintMarks();
    initThemes();                    // a synced theme/mode change lands here
    toast('Synced from your other device', { icon: 'sync' });
  });

  on('cloud:handoff', ({ track, time, device, playing }) => {
    // never hijack playback — offer it
    toast(`${device}: ${track.title} at ${fmtTime(time)}`, {
      icon: 'sync', ms: 9000,
      action: {
        label: 'Continue here',
        run: () => {
          const idx = state.tracks.indexOf(track);
          player.setQueue(state.tracks, idx < 0 ? 0 : idx, { autoplay: playing });
          setTimeout(() => player.seek(time), 420);
        },
      },
    });
  });

  on('cloud:follow', ({ track, time, playing }) => {
    const idx = state.tracks.indexOf(track);
    if (idx < 0) return;
    player.setQueue(state.tracks, idx, { autoplay: playing });
    setTimeout(() => player.seek(time), 420);
  });
  on('cloud:seek', ({ time }) => engine.seek(time));
  on('cloud:playstate', ({ playing }) => { playing ? engine.play() : engine.pause(); });
  on('sleep:done', () => toast('Sleep timer finished — good night', { icon: 'moon', ms: 4000 }));
  on('queue:end', () => toast('Queue finished', { icon: 'check' }));
  on('view', () => closeContext());
  on('stats', () => { if (state.view === 'stats') refreshCurrentView(); });

  paintModes();
  paintQueueBadge();
}

const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 9999;

/* ═══ painting ═════════════════════════════════════════════ */

function onTrackChange(track) {
  const miss = track ? generatedArt(track) : FALLBACK_ART;
  const art = track?.cover || miss;
  $('#pbTitle').textContent = track?.title || 'Nothing playing';
  $('#pbArtist').textContent = track ? [track.artist, track.album].filter(Boolean).join(' · ') : 'pick a track to begin';
  $('#npTitle').textContent = track?.title || '—';
  $('#npArtist').textContent = track ? [track.artist, track.album].filter(Boolean).join(' · ') : '—';

  setArt($('#pbArt'), art, miss);
  setArt($('#npArt'), art, miss);

  const bgArt = $('#bgArt');
  if (track?.cover) { bgArt.style.backgroundImage = `url("${track.cover}")`; bgArt.classList.add('on'); }
  else bgArt.classList.remove('on');

  if (state.settings.artColor) applyArtColor(track?.cover).then(() => { viz?.refreshColors(); wave?.draw(); });

  paintLike();
  paintMarks();
  wave.duration = track?.duration || state.duration || 0;
  wave.setHeat(track ? echoHeat(track.id) : null);
  wave.setProgress(0);
  $('#pbCur').textContent = '0:00';
  $('#npCur').textContent = '0:00';
  $('#pbDur').textContent = fmtDur(track?.duration || 0);
  $('#npDur').textContent = fmtDur(track?.duration || 0);
  $('#pbBuffered').style.width = '0%';
  stopMarkLoop();
  beat.reset();
  paintNpQueue();
  if (['home', 'queue', 'library'].includes(state.view)) refreshCurrentView();
  document.title = track ? `${track.title} — ${track.artist} · AURA` : 'AURA — Music Player';
}

function setArt(img, src, miss = FALLBACK_ART) {
  if (!img) return;
  const probe = new Image();
  probe.onload = () => { img.src = src; };
  probe.onerror = () => { img.src = miss; };
  probe.src = src;
}

function onTime({ time, duration }) {
  const d = duration || state.duration || 0;
  const ratio = d ? clamp(time / d, 0, 1) : 0;
  $('#pbPlayed').style.width = (ratio * 100).toFixed(3) + '%';
  $('#pbHead').style.left = (ratio * 100).toFixed(3) + '%';
  $('#pbCur').textContent = fmtTime(time);
  $('#npCur').textContent = fmtTime(time);
  if (npOpen) {
    wave.setProgress(ratio);
    lyrics.update(time);
  }
  saveSession();
}

function paintPlayState(playing) {
  document.body.classList.toggle('playing', playing);
  const label = playing ? 'Pause' : 'Play';
  $('#btnPlay').title = `${label} (Space)`;
  $('#npPlay').title = label;
  if (playing) wakeLockIfNeeded();
}

function paintModes() {
  $('#btnShuffle').classList.toggle('is-on', state.shuffle);
  $('#npShuffle').classList.toggle('is-on', state.shuffle);
  for (const id of ['#btnRepeat', '#npRepeat']) {
    const b = $(id);
    b.classList.toggle('is-on', state.repeat !== 'off');
    b.querySelector('use').setAttribute('href', state.repeat === 'one' ? '#i-repeat1' : '#i-repeat');
  }
}

function paintVolume() {
  const v = engine.volume;
  const vol = $('#vol');
  vol.value = state.muted ? 0 : v;
  vol.style.setProperty('--p', ((state.muted ? 0 : v) * 100) + '%');
  $('#btnMute').querySelector('use').setAttribute('href', state.muted || v === 0 ? '#i-mute' : '#i-vol');
}

function paintLike() {
  const on = state.current && isFavorite(state.current.id);
  $('#btnLike').classList.toggle('is-on', !!on);
}

function paintMarks() {
  if (!state.current || !wave) return;
  wave.setMarks(
    marksFor(state.current.id),
    state.duration || state.current.duration,
    (t) => player.seek(t),
    (t) => { import('./store.js').then(m => { m.removeMark(state.current.id, t); toast('Mark removed'); }); },
  );
}

function paintQueueBadge() {
  const badge = $('#queueBadge');
  if (!badge) return;
  const left = Math.max(0, state.queue.length - state.qIndex - 1);
  badge.textContent = String(left);
  badge.style.display = left ? '' : 'none';
}

function paintSleep(info) {
  const chip = $('#chipSleep');
  if (!chip) return;
  chip.classList.toggle('is-on', info.active);
  if (info.active && info.mode === 'clock') chip.lastChild.textContent = ' ' + fmtTime(info.left);
  else if (info.active) chip.lastChild.textContent = ' End of track';
  else chip.lastChild.textContent = 'Sleep';
}

function paintNpQueue() {
  const host = $('#npQueue');
  if (!host || !npOpen) return;
  host.innerHTML = '';
  const tracks = tracksByIds(state.queue);
  if (!tracks.length) { host.append(el('p.muted', { style: { fontSize: '13px', textAlign: 'center' }, text: 'Nothing queued.' })); return; }
  tracks.forEach((t, i) => {
    if (i < state.qIndex) return;
    host.append(trackRow(t, { index: i, showPlays: false, onPlay: () => player.playAt(i) }));
  });
}

/* ═══ actions ══════════════════════════════════════════════ */

function toggleLike() {
  if (!state.current) return;
  const on = toggleFavorite(state.current.id);
  paintLike();
  haptic(10);
  toast(on ? 'Added to favourites' : 'Removed from favourites', { icon: 'heart' });
}

function dropMark() {
  if (!state.current) { toast('Play something first', { error: true }); return; }
  const t = engine.currentTime;
  if (addMark(state.current.id, t)) {
    haptic(14);
    toast(`Marked ${fmtTime(t)}`, { icon: 'mark', action: { label: 'View', run: () => openMarks(state.current) } });
    paintMarks();
  } else {
    toast('Already marked around there');
  }
}

async function ingest(fileList) {
  if (!fileList?.length) return;
  const t = toast('Reading files…', { icon: 'folder', ms: 60000 });
  try {
    const added = await importFiles(fileList, {
      onProgress: (i, n, name) => { const s = t?.querySelector('span'); if (s) s.textContent = `Reading ${i}/${n} — ${name}`; },
    });
    t?.remove();
    if (!added.length) { toast('No playable audio in that selection', { error: true }); return; }

    set({ tracks: [...added, ...state.tracks] }, 'library');
    const saved = ls.get('localTracks', []);
    ls.set('localTracks', [...added.map(stripBlobURL), ...saved].slice(0, 2000));

    toast(`Added ${added.length} ${added.length === 1 ? 'track' : 'tracks'}`, {
      icon: 'check', action: { label: 'Play', run: () => player.setQueue(added, 0) },
    });
    refreshCurrentView();
  } catch (err) {
    t?.remove();
    console.error(err);
    toast('Import failed', { error: true });
  }
}

async function importFolder() {
  try {
    const files = await (await import('./library.js')).pickFolder();
    if (!files.length) { toast('No audio in that folder', { error: true }); return; }
    ingest(files);
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Could not read that folder', { error: true });
  }
}

/* ═══ now playing ══════════════════════════════════════════ */

let npOpen = false;

function openNowPlaying() {
  if (!state.current) { toast('Nothing playing yet'); return; }
  npOpen = true;
  document.body.classList.add('np-open');
  const np = $('#nowPlaying');
  np.hidden = false;
  np.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => np.classList.add('open'));
  viz?.start();
  ring?.start();
  wave.setProgress(state.duration ? state.time / state.duration : 0);
  wave.draw();
  paintMarks();
  paintNpQueue();
  lyrics.update(state.time);
  $('#npOrbit')?.classList.toggle('on', state.settings.orbit);
  $('#chipOrbit')?.classList.toggle('is-on', state.settings.orbit);
  $('#chipKaraoke')?.classList.toggle('is-on', state.settings.vocal > 0.05);
  $('#chipSpeed')?.classList.toggle('is-on', Math.abs(state.settings.speed - 1) > 0.01);
  wakeLockIfNeeded();
}

function closeNowPlaying() {
  npOpen = false;
  document.body.classList.remove('np-open');
  const np = $('#nowPlaying');
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  setTimeout(() => { if (!npOpen) np.hidden = true; }, 540);
  ring?.stop();
  wakeLock.release();
}

function wakeLockIfNeeded() {
  if (npOpen && state.playing) wakeLock.acquire();
  else if (!npOpen) wakeLock.release();
}

function cycleViz() {
  const mode = viz.nextMode();
  setSetting('vizMode', viz.mode);
  toast(`${mode.name} — ${mode.hint}`, { icon: 'viz', ms: 1800 });
}

/** swipe down on the full-screen player to dismiss it */
function wireSwipe() {
  const np = $('#nowPlaying');
  let y0 = 0, dragging = false;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('.np-queue, .lyrics, .wave-wrap, .np-chips, input')) return;
    y0 = e.touches[0].clientY; dragging = true;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) np.style.transform = `translateY(${dy * 0.55}px)`;
  }, { passive: true });
  np.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = (e.changedTouches[0].clientY - y0);
    np.style.transform = '';
    if (dy > 110) closeNowPlaying();
  });

  /* swipe left/right on the mini bar to change track */
  const bar = $('#playerBar');
  let x0 = 0, t0 = 0;
  bar.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; t0 = Date.now(); }, { passive: true });
  bar.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - x0;
    if (Date.now() - t0 > 600 || Math.abs(dx) < 70) return;
    dx < 0 ? player.next() : player.prev();
    haptic(12);
  });
}

/* ═══ visualizers ══════════════════════════════════════════ */

function startVisualizers() {
  viz = new Visualizer($('#npViz'), engine, { mode: state.settings.vizMode || 0 });
  ring = new CoverRing($('#npRing'), engine);

  /* The faint background spectrum. With nothing playing it has no data and
     draws a synthetic idle wave — motion that costs a rAF loop and buys
     nothing, since the aurora layer is already moving underneath it. Run it
     only while there is actually audio to show. */
  const bg = new Visualizer($('#bgViz'), engine, { mode: 4, intensity: 0.85 });
  const syncBgViz = () => {
    const want = state.playing && state.settings.bgViz !== false;
    want ? bg.start() : bg.stop();
    $('#bgViz').style.opacity = want ? '' : '0';
  };
  on('playstate', syncBgViz);
  on('bgviz', syncBgViz);
  syncBgViz();

  /* beat detection drives the UI pulse + the BPM readout */
  let raf;
  const pulse = () => {
    raf = requestAnimationFrame(pulse);
    if (document.hidden || !state.playing) return;
    const energy = engine.bandEnergy(40, 160);
    if (beat.push(energy)) {
      document.body.classList.add('beat');
      setTimeout(() => document.body.classList.remove('beat'), 120);
      if (beat.bpm && beat.bpm !== state.bpm) set({ bpm: beat.bpm }, 'bpm');
    }
  };
  pulse();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { viz?.stop(); ring?.stop(); bg.stop(); }
    else { if (npOpen) { viz?.start(); ring?.start(); } syncBgViz(); }
  });
}

/* ═══ drag & drop ══════════════════════════════════════════ */

function wireDropZone() {
  const zone = $('#dropZone');
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    depth++; zone.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (!zone.hidden) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.hidden = true; } });
  window.addEventListener('drop', (e) => {
    if (zone.hidden) return;
    e.preventDefault();
    depth = 0; zone.hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) ingest(files);
  });
}

/* ═══ keyboard ═════════════════════════════════════════════ */

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (modalOpen()) return;                       // the modal handles its own Esc
      if (!$('#themeDock').hidden) return closeThemeDock();
      if (npOpen) return closeNowPlaying();
      if (typing) e.target.blur();
      return;
    }

    if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (modalOpen()) return;

    const k = e.key;
    const handlers = {
      ' ':  () => player.toggle(),
      'k':  () => player.toggle(),
      'j':  () => player.nudge(-10),
      'l':  () => player.nudge(10),
      'ArrowLeft':  () => e.shiftKey ? player.prev() : player.nudge(-5),
      'ArrowRight': () => e.shiftKey ? player.next() : player.nudge(5),
      'ArrowUp':    () => { player.setVolume(clamp(engine.volume + 0.05, 0, 1)); paintVolume(); },
      'ArrowDown':  () => { player.setVolume(clamp(engine.volume - 0.05, 0, 1)); paintVolume(); },
      'M':  () => { player.toggleMute(); paintVolume(); },
      'm':  () => dropMark(),
      's':  () => { player.toggleShuffle(); paintModes(); },
      'r':  () => { player.cycleRepeat(); paintModes(); },
      'f':  () => toggleLike(),
      'e':  () => npOpen ? closeNowPlaying() : openNowPlaying(),
      'v':  () => { if (!npOpen) openNowPlaying(); cycleViz(); },
      't':  () => openThemeDock(),
      '?':  () => openHelp(),
    };

    if (handlers[k]) { e.preventDefault(); handlers[k](); return; }

    /* 1–7 jump between sections, 0–9 with shift seek through the track */
    if (/^[0-9]$/.test(k)) {
      const n = parseInt(k, 10);
      if (e.shiftKey) {
        if (state.duration) { e.preventDefault(); player.seek(state.duration * n / 10); }
      } else if (n >= 1 && n <= 7) {
        e.preventDefault();
        setView(['home', 'library', 'queue', 'playlists', 'stats', 'lab', 'settings'][n - 1]);
      }
    }
  });
}

/* ═══ service worker ═══════════════════════════════════════ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  /* A page rendered before a new worker took over is running the previous
     release's JavaScript. Refresh it — but never mid-song: interrupting
     playback to apply a cosmetic update is a worse bug than the stale code.
     The session flag stops a worker that keeps re-activating from looping. */
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'aura:updated') return;
    if (sessionStorage.getItem('aura:reloaded') === e.data.version) return;
    try { sessionStorage.setItem('aura:reloaded', e.data.version); } catch {}

    if (state.playing) {
      toast('An update is ready', {
        icon: 'download', ms: 12000,
        action: { label: 'Reload', run: () => location.reload() },
      });
    } else {
      location.reload();
    }
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update().catch(() => {});
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Updating to the latest version…', { icon: 'download', ms: 4000 });
        }
      });
    });
  }).catch(() => { /* offline support is a bonus, not a requirement */ });
}

/* ═══ lifecycle ════════════════════════════════════════════ */

window.addEventListener('pagehide', () => {
  player._commitListening();
  persist.all();
  if (state.current) ls.set('session', { trackId: state.current.id, time: state.time, queue: state.queue });
});

/* resume the audio context after the first gesture — required on iOS */
['pointerdown', 'keydown'].forEach(ev =>
  window.addEventListener(ev, () => engine.resume(), { once: true, passive: true }));

window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver')) return;
  console.error('[aura]', e.error || e.message);
});

/* expose a tiny console handle — handy when tinkering */
window.AURA = { state, player, engine, setView, renderView, toast, get viz() { return viz; } };

start().catch(err => {
  console.error('[aura] boot failed', err);
  boot.say('something went wrong — check the console');
  setTimeout(() => { boot.done(); toast('AURA had trouble starting. Check the browser console.', { error: true, ms: 8000 }); }, 1200);
});
