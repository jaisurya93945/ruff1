'use strict';
/* ═══════════════════════════════════════════════════
   HACKER PLAYLIST v2 — script.js
   Features: Library · Favourites · Playlists · Queue
             Recently Played · Genre Filter · Search
             Speed Control · Sleep Timer · MediaSession
             Keyboard Shortcuts · Service Worker · Offline
   ═══════════════════════════════════════════════════ */

/* ── MATRIX RAIN ── */
(function matrixRain() {
  const c = document.getElementById('matrix-canvas');
  const ctx = c.getContext('2d');
  const chars = 'アイウエオカキクケコ0123456789ABCDEF<>{}[]|\\/*#@!?';
  let cols, drops, fs = 13;
  function resize() {
    c.width = innerWidth; c.height = innerHeight;
    cols = Math.floor(c.width / fs);
    drops = Array.from({length: cols}, () => Math.random() * -60);
  }
  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = fs + 'px "Courier New",monospace';
    for (let i = 0; i < drops.length; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      const bright = Math.random() > 0.95;
      ctx.fillStyle = bright ? `rgba(220,255,220,${Math.random()*.5+.5})` : `rgba(0,255,70,${Math.random()*.4+.4})`;
      ctx.fillText(ch, i * fs, drops[i] * fs);
      if (drops[i] * fs > c.height && Math.random() > .975) drops[i] = 0;
      drops[i] += 0.35;
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize', resize);
  resize(); draw();
})();

/* ── STORAGE KEYS ── */
const SK = { favs:'hp_favs', playlists:'hp_playlists', recent:'hp_recent', queue:'hp_queue', settings:'hp_settings' };

/* ── STATE ── */
const audio = new Audio();
audio.preload = 'none';

let songs       = [];          // full song list from songs.json
let currentIdx  = -1;          // index in songs[]
let isPlaying   = false;
let isLooping   = false;
let isShuffling = false;
let playContext = [];          // songs[] subset for prev/next navigation
let queue       = [];          // array of global song indices, played first
let favourites  = new Set();   // Set of audio paths
let playlists   = [];          // [{id, name, songs:[audioPaths]}]
let recentlyPlayed = [];       // [{audio,title,artist,cover,ts}] max 30
let currentView = 'library';
let activeGenre = 'all';
let currentSpeed = 1;
let sleepTimer  = null;
let sleepEnd    = 0;
let sleepTick   = null;
let ctxSongIdx  = -1;          // song index targeted by context menu
let progDrag    = false;
let barProgDrag = false;
let longPressTimer = null;

const DEFAULT_COVER = makeFallbackCover();

/* ── STORAGE ── */
function saveStorage() {
  try {
    localStorage.setItem(SK.favs,      JSON.stringify([...favourites]));
    localStorage.setItem(SK.playlists, JSON.stringify(playlists));
    localStorage.setItem(SK.recent,    JSON.stringify(recentlyPlayed));
    localStorage.setItem(SK.queue,     JSON.stringify(queue));
    localStorage.setItem(SK.settings,  JSON.stringify({ vol: audio.volume, speed: currentSpeed, loop: isLooping, shuffle: isShuffling }));
  } catch(e) {}
}
function loadStorage() {
  try {
    const f = localStorage.getItem(SK.favs);
    if (f) favourites = new Set(JSON.parse(f));
    const p = localStorage.getItem(SK.playlists);
    if (p) playlists = JSON.parse(p);
    const r = localStorage.getItem(SK.recent);
    if (r) recentlyPlayed = JSON.parse(r);
    const q = localStorage.getItem(SK.queue);
    if (q) queue = JSON.parse(q).filter(i => typeof i === 'number');
    const s = localStorage.getItem(SK.settings);
    if (s) {
      const st = JSON.parse(s);
      audio.volume = st.vol ?? 1;
      npVol.value  = (st.vol ?? 1) * 100;
      currentSpeed = st.speed ?? 1;
      audio.playbackRate = currentSpeed;
      if (st.loop)    { isLooping = true;    audio.loop = true; }
      if (st.shuffle) { isShuffling = true; }
    }
  } catch(e) {}
}

/* ── DOM REFS ── */
const $ = id => document.getElementById(id);
const playlistEl  = $('playlist');
const viewContent = $('view-content');
const viewTitle   = $('view-title');
const viewSub     = $('view-sub');
const genreBar    = $('genre-bar');
const searchInput = $('search-input');
const suggestEl   = $('suggestions');
const sidebarEl   = $('sidebar');
const sidebarOvl  = $('sidebar-overlay');
const hamburger   = $('hamburger');
const plNavEl     = $('pl-nav');
const favBadge    = $('fav-badge');
const queueBadge  = $('queue-badge');
const sfooter     = $('sidebar-footer');

// Now playing
const npOverlay = $('now-playing-overlay');
const npCard    = $('np-card');
const npBgBlur  = $('np-bg-blur');
const npBackdrop= $('np-backdrop');
const npClose   = $('np-close');
const npRing    = $('np-ring');
const npCover   = $('np-cover');
const npTitle   = $('np-title');
const npArtist  = $('np-artist');
const npHeart   = $('np-heart');
const npTrack   = $('np-track');
const npFill    = $('np-fill');
const npThumb   = $('np-thumb');
const npCur     = $('np-cur');
const npTot     = $('np-tot');
const npPPBtn   = $('np-playpause');
const npPPImg   = $('np-pp-img');
const npPrev    = $('np-prev');
const npNext    = $('np-next');
const npLoop    = $('np-loop');
const npShuffle = $('np-shuffle');
const npCtxBtn  = $('np-ctx');
const npSpeedBtn= $('np-speed-btn');
const npSleepBtn= $('np-sleep-btn');
const npQAdd    = $('np-qadd-btn');
const npPlAdd   = $('np-pladd-btn');
const npVol     = $('np-vol');
const npNextUp  = $('np-nextup');
const npNextTitle=$('np-next-title');

// Bar
const barCover  = $('bar-cover');
const barTitle  = $('bar-title');
const barArtist = $('bar-artist');
const barHeart  = $('bar-heart');
const barProg   = $('bar-prog-bar');
const barProgCont=$('bar-prog-cont');
const barCur    = $('bar-cur');
const barTot    = $('bar-tot');
const barPP     = $('bar-playpause');
const barPPImg  = $('bar-pp-img');
const barPrev   = $('bar-prev');
const barNext   = $('bar-next');
const barLoop   = $('bar-loop');
const barShuffle= $('bar-shuffle');
const barExpand = $('bar-expand');
const barInfoArea=$('bar-info-area');

// Context menu
const ctxMenu   = $('context-menu');
const ctxPlay   = $('ctx-play');
const ctxFav    = $('ctx-fav');
const ctxQueue  = $('ctx-queue');
const ctxPl     = $('ctx-pl');

// Modal
const modalOvl  = $('modal-overlay');
const modalEl   = $('modal');
const modalTitle= $('modal-title');
const modalBody = $('modal-body');
const modalClose= $('modal-close');

// Popups
const speedPopup= $('speed-popup');
const sleepPopup= $('sleep-popup');
const sleepRemEl= $('sleep-remaining');
const newPlBtn  = $('new-pl-btn');

/* ── INIT ── */
async function init() {
  loadStorage();
  showSkeletons(8);
  try {
    const res = await fetch('songs.json?' + Date.now());
    if (!res.ok) throw new Error('songs.json not found (' + res.status + ')');
    songs = await res.json();
    if (!Array.isArray(songs) || !songs.length) throw new Error('songs.json is empty');
    playContext = songs.slice();
    buildGenreBar();
    renderView('library');
    renderPlaylistNav();
    updateBadges();
    sfooter.textContent = songs.length + ' songs';
    // Restore queue indices that are still valid
    queue = queue.filter(i => i >= 0 && i < songs.length);
    updateBadges();
  } catch(err) {
    viewContent.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠</div><div class="empty-msg">Could not load songs.json</div><div class="empty-hint">${escHtml(err.message)}</div></div>`;
  }
  wireEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

/* ── GENRE BAR ── */
function buildGenreBar() {
  const all = new Set(['All']);
  songs.forEach(s => (s.genre || []).forEach(g => all.add(g)));
  genreBar.innerHTML = [...all].map(g =>
    `<button class="genre-pill${g==='All'?' active':''}" data-genre="${escAttr(g)}">${escHtml(g)}</button>`
  ).join('');
  genreBar.addEventListener('click', e => {
    const pill = e.target.closest('.genre-pill');
    if (!pill) return;
    document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeGenre = pill.dataset.genre;
    renderView(currentView);
  });
}

function filteredSongs() {
  if (activeGenre === 'All' || !activeGenre) return songs;
  return songs.filter(s => (s.genre || []).includes(activeGenre));
}

/* ── VIEW SYSTEM ── */
function renderView(view) {
  currentView = view;
  // Update sidebar nav
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.pl-nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  // Show genre bar only in library
  genreBar.style.display = (view === 'library') ? '' : 'none';

  if (view === 'library') {
    viewTitle.textContent = 'Library';
    const list = filteredSongs();
    playContext = list;
    viewSub.textContent = list.length + ' songs';
    viewContent.innerHTML = '';
    const grid = document.createElement('div');
    grid.id = 'playlist'; grid.className = 'playlist'; grid.setAttribute('role','list');
    viewContent.appendChild(grid);
    renderSongGrid(list, grid);

  } else if (view === 'favourites') {
    viewTitle.textContent = 'Favourites';
    const list = songs.filter(s => favourites.has(s.audio));
    playContext = list;
    viewSub.textContent = list.length + ' songs';
    viewContent.innerHTML = '';
    if (!list.length) { viewContent.innerHTML = emptyState('♥','No favourites yet','Tap the heart on any song to save it here'); return; }
    const grid = document.createElement('div');
    grid.id = 'playlist'; grid.className = 'playlist'; grid.setAttribute('role','list');
    viewContent.appendChild(grid);
    renderSongGrid(list, grid);

  } else if (view === 'recent') {
    viewTitle.textContent = 'Recently Played';
    viewSub.textContent = recentlyPlayed.length + ' songs';
    viewContent.innerHTML = '';
    if (!recentlyPlayed.length) { viewContent.innerHTML = emptyState('◷','Nothing played yet','Start playing songs and they\'ll show up here'); return; }
    const list = document.createElement('div');
    list.className = 'list-view';
    recentlyPlayed.slice().reverse().forEach(item => {
      const song = songs.find(s => s.audio === item.audio);
      const idx  = song ? songs.indexOf(song) : -1;
      const d    = new Date(item.ts);
      const timeStr = d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const el = document.createElement('div');
      el.className = 'list-item' + (idx === currentIdx ? ' active' : '');
      el.dataset.index = idx;
      el.innerHTML = `
        <span class="li-num">${idx === currentIdx ? '▶' : ''}</span>
        <img src="${escAttr(item.cover || DEFAULT_COVER)}" alt="${escAttr(item.title)}" loading="lazy" onerror="this.src='${DEFAULT_COVER}'">
        <div class="li-info"><div class="li-title">${escHtml(item.title)}</div><div class="li-artist">${escHtml(item.artist)}</div></div>
        <span class="li-time">${timeStr}</span>
      `;
      if (idx >= 0) el.addEventListener('click', () => { playContext = songs; playSong(idx); });
      list.appendChild(el);
    });
    viewContent.appendChild(list);

  } else if (view === 'queue') {
    viewTitle.textContent = 'Queue';
    viewSub.textContent = queue.length + ' in queue';
    renderQueueView();

  } else if (view.startsWith('playlist:')) {
    const plId = view.slice(9);
    const pl = playlists.find(p => p.id === plId);
    if (!pl) { renderView('library'); return; }
    const list = pl.songs.map(a => songs.find(s => s.audio === a)).filter(Boolean);
    playContext = list;
    viewTitle.textContent = pl.name;
    viewSub.textContent = list.length + ' songs';
    viewContent.innerHTML = '';
    // Playlist header
    const hdr = document.createElement('div');
    hdr.className = 'pl-view-hdr';
    const firstCover = list[0]?.cover || DEFAULT_COVER;
    hdr.innerHTML = `
      <img class="pl-view-cover" src="${escAttr(firstCover)}" alt="${escAttr(pl.name)}" onerror="this.src='${DEFAULT_COVER}'">
      <div class="pl-view-meta">
        <div class="pl-view-name">${escHtml(pl.name)}</div>
        <div class="pl-view-count">${list.length} songs</div>
      </div>
      <button class="pl-del-btn" data-id="${escAttr(plId)}">Delete Playlist</button>
    `;
    hdr.querySelector('.pl-del-btn').addEventListener('click', () => {
      if (confirm('Delete playlist "' + pl.name + '"?')) {
        playlists = playlists.filter(p => p.id !== plId);
        saveStorage(); renderPlaylistNav(); renderView('library'); toast('Playlist deleted');
      }
    });
    viewContent.appendChild(hdr);
    if (!list.length) { viewContent.insertAdjacentHTML('beforeend', emptyState('♪','Playlist is empty','Add songs from the context menu')); return; }
    const listEl = document.createElement('div');
    listEl.className = 'list-view';
    list.forEach((song, i) => {
      const idx = songs.indexOf(song);
      const el = document.createElement('div');
      el.className = 'list-item' + (idx === currentIdx ? ' active' : '');
      el.innerHTML = `
        <span class="li-num">${idx === currentIdx ? '▶' : i+1}</span>
        <img src="${escAttr(song.cover||DEFAULT_COVER)}" alt="${escAttr(song.title)}" loading="lazy" onerror="this.src='${DEFAULT_COVER}'">
        <div class="li-info"><div class="li-title">${escHtml(song.title)}</div><div class="li-artist">${escHtml(song.artist)}</div></div>
        <div class="li-actions">
          <button class="li-btn danger" data-audio="${escAttr(song.audio)}" data-plid="${escAttr(plId)}">Remove</button>
        </div>
      `;
      el.querySelector('.li-btn').addEventListener('click', e => {
        e.stopPropagation();
        removeFromPlaylist(plId, song.audio);
        renderView(view);
      });
      el.addEventListener('click', () => playSong(idx));
      listEl.appendChild(el);
    });
    viewContent.appendChild(listEl);
  }
}

function renderQueueView() {
  viewContent.innerHTML = '';
  const wrap = document.createElement('div');
  if (!queue.length) { wrap.innerHTML = emptyState('≡','Queue is empty','Use ⋮ on any song to add it to the queue'); viewContent.appendChild(wrap); return; }

  const hdr = document.createElement('div'); hdr.className = 'queue-hdr';
  hdr.innerHTML = `<span class="queue-hdr-title">${queue.length} songs up next</span><button class="queue-clear" id="q-clear-btn">Clear All</button>`;
  hdr.querySelector('#q-clear-btn').addEventListener('click', () => { queue = []; saveStorage(); updateBadges(); renderQueueView(); toast('Queue cleared'); });
  wrap.appendChild(hdr);

  const listEl = document.createElement('div'); listEl.className = 'list-view';
  queue.forEach((songIdx, qi) => {
    const song = songs[songIdx];
    if (!song) return;
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <span class="li-num">${qi+1}</span>
      <img src="${escAttr(song.cover||DEFAULT_COVER)}" alt="${escAttr(song.title)}" loading="lazy" onerror="this.src='${DEFAULT_COVER}'">
      <div class="li-info"><div class="li-title">${escHtml(song.title)}</div><div class="li-artist">${escHtml(song.artist)}</div></div>
      <div class="li-actions">
        <button class="li-btn" data-qi="${qi}">Play</button>
        <button class="li-btn danger" data-qi="${qi}">✕</button>
      </div>
    `;
    const btns = el.querySelectorAll('.li-btn');
    btns[0].addEventListener('click', e => { e.stopPropagation(); queue.splice(qi, 1); playSong(songIdx); saveStorage(); updateBadges(); });
    btns[1].addEventListener('click', e => { e.stopPropagation(); queue.splice(qi, 1); saveStorage(); updateBadges(); renderQueueView(); });
    el.addEventListener('click', () => playSong(songIdx));
    listEl.appendChild(el);
  });
  wrap.appendChild(listEl);
  viewContent.appendChild(wrap);
}

function emptyState(icon, msg, hint) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-msg">${escHtml(msg)}</div><div class="empty-hint">${escHtml(hint)}</div></div>`;
}

/* ── SONG GRID RENDERING ── */
function showSkeletons(n) {
  const grid = playlistEl || viewContent;
  const target = document.getElementById('playlist') || viewContent;
  target.innerHTML = Array.from({length:n}, () => `
    <div class="song song-skeleton">
      <div class="sk-img"></div>
      <div class="sk-line"></div><div class="sk-line sm"></div>
    </div>`).join('');
}

function renderSongGrid(list, container) {
  if (!list.length) { container.innerHTML = emptyState('◈','No songs found','Try a different search or genre'); return; }
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(song => {
    const idx = songs.indexOf(song);
    const isFav = favourites.has(song.audio);
    const isActive = idx === currentIdx;
    const card = document.createElement('div');
    card.className = 'song' + (isActive ? ' active' : '');
    card.dataset.index = idx;
    card.dataset.playing = isPlaying && isActive ? '▶' : (isActive ? '⏸' : '');
    card.setAttribute('role','listitem');
    card.setAttribute('tabindex','0');
    card.setAttribute('aria-label', song.title + ' by ' + song.artist);
    card.innerHTML = `
      <div class="song-art-wrap">
        <img src="${escAttr(song.cover||DEFAULT_COVER)}" alt="${escAttr(song.title)} cover" class="song-img" loading="lazy" decoding="async" onerror="this.src='${DEFAULT_COVER}'">
        <button class="card-heart${isFav?' faved':''}" data-audio="${escAttr(song.audio)}" aria-label="Favourite">♥</button>
        <button class="card-more" data-index="${idx}" aria-label="More options">⋮</button>
      </div>
      <p class="song-title">${escHtml(song.title)}</p>
      <p class="movie-name">${escHtml(song.artist)}</p>
      <button class="play-btn" data-index="${idx}" aria-label="Play ${escAttr(song.title)}">
        <img src="${isActive&&isPlaying?'img/pause1.png':'img/play1.png'}" alt="${isActive&&isPlaying?'Pause':'Play'}">
      </button>`;
    frag.appendChild(card);
  });
  container.appendChild(frag);
  // Intersection observer for lazy image loading if many songs
  if (list.length > 40) observeImages(container);
}

function observeImages(container) {
  if (!('IntersectionObserver' in window)) return;
  const imgs = container.querySelectorAll('img[loading="lazy"]');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.setAttribute('loading','eager'); obs.unobserve(e.target); } });
  }, {rootMargin:'200px'});
  imgs.forEach(img => obs.observe(img));
}

/* Grid event delegation */
function setupGridEvents(container) {
  container.addEventListener('click', e => {
    const heartBtn = e.target.closest('.card-heart');
    const moreBtn  = e.target.closest('.card-more');
    const playBtn  = e.target.closest('.play-btn');
    const card     = e.target.closest('.song');
    if (!card) return;
    const idx = parseInt(card.dataset.index, 10);
    if (heartBtn) { e.stopPropagation(); toggleFav(heartBtn.dataset.audio, heartBtn); return; }
    if (moreBtn)  { e.stopPropagation(); showContextMenu(e, parseInt(moreBtn.dataset.index, 10)); return; }
    if (playBtn)  { e.stopPropagation(); if (idx === currentIdx) togglePlayPause(); else playSong(idx); return; }
    if (idx === currentIdx) openNowPlaying(); else playSong(idx);
  });
  container.addEventListener('keydown', e => {
    const card = e.target.closest('.song');
    if (!card) return;
    if (e.key==='Enter'||e.key===' ') { e.preventDefault(); const idx=parseInt(card.dataset.index,10); if(idx===currentIdx)togglePlayPause();else playSong(idx); }
  });
  // Long press → context menu (mobile)
  container.addEventListener('touchstart', e => {
    const card = e.target.closest('.song');
    if (!card) return;
    longPressTimer = setTimeout(() => { showContextMenu(e.touches[0], parseInt(card.dataset.index,10)); }, 500);
  }, {passive:true});
  container.addEventListener('touchend', () => { clearTimeout(longPressTimer); }, {passive:true});
  container.addEventListener('contextmenu', e => {
    const card = e.target.closest('.song');
    if (!card) return;
    e.preventDefault(); showContextMenu(e, parseInt(card.dataset.index,10));
  });
}
// Wire up grid events on the main playlist div
document.addEventListener('click', e => {
  // Delegate for dynamically rendered playlist
  const card = e.target.closest('#playlist .song');
  if (!card) return;
  // Already handled inside setupGridEvents when it's called; but for view-content generic delegation:
}, {passive:true});
viewContent.addEventListener('click', e => {
  const heartBtn = e.target.closest('.card-heart');
  const moreBtn  = e.target.closest('.card-more');
  const playBtn  = e.target.closest('.play-btn');
  const card     = e.target.closest('.song');
  if (!card) return;
  const idx = parseInt(card.dataset.index, 10);
  if (heartBtn) { e.stopPropagation(); toggleFav(heartBtn.dataset.audio, heartBtn); return; }
  if (moreBtn)  { e.stopPropagation(); showContextMenu(e, parseInt(moreBtn.dataset.index, 10)); return; }
  if (playBtn)  { e.stopPropagation(); if(isNaN(idx))return; if(idx===currentIdx)togglePlayPause();else playSong(idx); return; }
  if (!isNaN(idx)) { if(idx===currentIdx)openNowPlaying();else playSong(idx); }
});
viewContent.addEventListener('touchstart', e => {
  const card = e.target.closest('.song');
  if (!card) return;
  longPressTimer = setTimeout(() => showContextMenu(e.touches[0], parseInt(card.dataset.index,10)), 500);
}, {passive:true});
viewContent.addEventListener('touchend', () => clearTimeout(longPressTimer), {passive:true});
viewContent.addEventListener('contextmenu', e => {
  const card = e.target.closest('.song');
  if (!card) return;
  e.preventDefault(); showContextMenu(e, parseInt(card.dataset.index,10));
});

/* ── PLAY ENGINE ── */
async function playSong(idx) {
  if (idx < 0 || idx >= songs.length) return;
  currentIdx = idx;
  const song = songs[idx];
  const cover = song.cover || DEFAULT_COVER;

  audio.src = song.audio;
  audio.volume = npVol.value / 100;
  audio.loop = isLooping;
  audio.playbackRate = currentSpeed;

  try {
    await audio.play();
    isPlaying = true;
  } catch(err) {
    isPlaying = false;
    updatePPIcons(); updateActiveCards();
    return;
  }

  addToRecent(song, cover);
  updateNowPlayingCard(song, cover);
  updateBarInfo(song, cover);
  updatePPIcons();
  updateActiveCards();
  updateFavUI();
  updateNextUp();
  preloadNext(idx);
  updateMediaSession(song, cover);
  saveStorage();
}

function togglePlayPause() {
  if (currentIdx < 0) { if(songs.length) playSong(0); return; }
  if (isPlaying) { audio.pause(); isPlaying = false; }
  else {
    audio.play().then(() => { isPlaying = true; updatePPIcons(); updateActiveCards(); npRing.classList.toggle('spin', true); npCover.classList.toggle('spin', true); }).catch(()=>{});
    return;
  }
  updatePPIcons(); updateActiveCards();
}

function playNext() {
  if (!songs.length) return;
  // Queue takes priority
  if (queue.length) {
    const ni = queue.shift();
    updateBadges(); saveStorage();
    playSong(ni);
    if (currentView === 'queue') renderView('queue');
    return;
  }
  const ctx = playContext.length ? playContext : songs;
  const cur = ctx.indexOf(songs[currentIdx]);
  let ni;
  if (isShuffling) {
    let tries = 0;
    do { ni = Math.floor(Math.random() * ctx.length); tries++; } while(ni===cur && ctx.length>1 && tries<20);
  } else { ni = (cur + 1) % ctx.length; }
  playSong(songs.indexOf(ctx[ni]));
}

function playPrev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const ctx = playContext.length ? playContext : songs;
  const cur = ctx.indexOf(songs[currentIdx]);
  const ni = (cur - 1 + ctx.length) % ctx.length;
  playSong(songs.indexOf(ctx[ni]));
}

function preloadNext(curIdx) {
  const ctx = playContext.length ? playContext : songs;
  const pos = ctx.indexOf(songs[curIdx]);
  const nxt = ctx[(pos+1)%ctx.length];
  if (!nxt || nxt === songs[curIdx]) return;
  const link = document.createElement('link');
  link.rel = 'preload'; link.as = 'audio'; link.href = nxt.audio; link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
  setTimeout(() => link.remove(), 12000);
}

/* ── AUDIO EVENTS ── */
audio.addEventListener('ended', () => { if (!isLooping) playNext(); });
audio.addEventListener('play',  () => { isPlaying=true;  updatePPIcons(); updateActiveCards(); npRing.classList.add('spin'); npCover.classList.add('spin'); });
audio.addEventListener('pause', () => { isPlaying=false; updatePPIcons(); updateActiveCards(); npRing.classList.remove('spin'); npCover.classList.remove('spin'); });
audio.addEventListener('error', () => { toast('Could not load song — skipping...','error'); setTimeout(playNext,1200); });
audio.addEventListener('timeupdate', () => {
  if (!audio.duration || progDrag || barProgDrag) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  npFill.style.width = pct + '%';
  npThumb.style.left = pct + '%';
  barProg.style.width = pct + '%';
  const cur = fmtTime(audio.currentTime);
  const tot = fmtTime(audio.duration);
  npCur.textContent = cur; barCur.textContent = cur;
  if (!isNaN(audio.duration)) { npTot.textContent = tot; barTot.textContent = tot; }
});

/* ── FAVOURITES ── */
function toggleFav(audioPath, btnEl) {
  if (favourites.has(audioPath)) {
    favourites.delete(audioPath);
    toast('Removed from favourites');
  } else {
    favourites.add(audioPath);
    toast('Added to favourites ♥');
  }
  // Update all heart buttons for this song
  document.querySelectorAll(`.card-heart[data-audio="${CSS.escape(audioPath)}"]`).forEach(b => b.classList.toggle('faved', favourites.has(audioPath)));
  updateFavUI();
  updateBadges();
  saveStorage();
  if (currentView === 'favourites') renderView('favourites');
}

function updateFavUI() {
  if (currentIdx < 0) return;
  const cur = songs[currentIdx];
  const faved = cur && favourites.has(cur.audio);
  npHeart.classList.toggle('faved', faved);
  barHeart.classList.toggle('faved', faved);
  npHeart.setAttribute('aria-pressed', faved);
}

/* ── PLAYLISTS ── */
function renderPlaylistNav() {
  plNavEl.innerHTML = '';
  playlists.forEach(pl => {
    const btn = document.createElement('button');
    btn.className = 'nav-item pl-nav-item' + (currentView === 'playlist:'+pl.id ? ' active' : '');
    btn.dataset.view = 'playlist:' + pl.id;
    btn.innerHTML = `<span class="nav-ico pl-ico">♪</span><span class="pl-name">${escHtml(pl.name)}</span><button class="pl-del" data-id="${escAttr(pl.id)}" aria-label="Delete playlist">✕</button>`;
    btn.addEventListener('click', e => {
      if (e.target.closest('.pl-del')) {
        e.stopPropagation();
        if (confirm('Delete "' + pl.name + '"?')) { playlists = playlists.filter(p=>p.id!==pl.id); saveStorage(); renderPlaylistNav(); if(currentView==='playlist:'+pl.id)renderView('library'); toast('Playlist deleted'); }
        return;
      }
      closeSidebar(); renderView('playlist:'+pl.id);
    });
    plNavEl.appendChild(btn);
  });
}

function createPlaylist(name) {
  name = name.trim();
  if (!name) return null;
  const pl = { id: Date.now().toString(), name, songs: [] };
  playlists.push(pl);
  renderPlaylistNav();
  saveStorage();
  return pl;
}

function addToPlaylist(plId, audioPath) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  if (!pl.songs.includes(audioPath)) pl.songs.push(audioPath);
  saveStorage();
}

function removeFromPlaylist(plId, audioPath) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  pl.songs = pl.songs.filter(a => a !== audioPath);
  saveStorage();
}

/* ── QUEUE ── */
function addToQueue(songIdx) {
  if (!queue.includes(songIdx)) {
    queue.push(songIdx);
    updateBadges();
    saveStorage();
    toast('Added to queue → ' + songs[songIdx].title);
    if (currentView === 'queue') renderView('queue');
  } else {
    toast('Already in queue', 'warn');
  }
}

function updateBadges() {
  const fCount = favourites.size;
  const qCount = queue.length;
  favBadge.textContent   = fCount ? fCount : '';
  favBadge.style.display = fCount ? '' : 'none';
  queueBadge.textContent   = qCount ? qCount : '';
  queueBadge.style.display = qCount ? '' : 'none';
}

/* ── RECENTLY PLAYED ── */
function addToRecent(song, cover) {
  recentlyPlayed = recentlyPlayed.filter(r => r.audio !== song.audio);
  recentlyPlayed.push({ audio:song.audio, title:song.title, artist:song.artist, cover:cover||DEFAULT_COVER, ts:Date.now() });
  if (recentlyPlayed.length > 30) recentlyPlayed.shift();
}

/* ── NOW PLAYING OVERLAY ── */
function updateNowPlayingCard(song, cover) {
  npCover.src  = cover || DEFAULT_COVER;
  npCover.onerror = () => { npCover.src = DEFAULT_COVER; };
  npTitle.textContent  = song.title;
  npArtist.textContent = song.artist;
  npBgBlur.style.backgroundImage = `url('${cover||DEFAULT_COVER}')`;
  // Marquee for long titles
  npTitle.classList.toggle('scrolling', song.title.length > 24);
  updateNextUp();
}

function updateBarInfo(song, cover) {
  barCover.src = cover || DEFAULT_COVER;
  barCover.onerror = () => { barCover.src = DEFAULT_COVER; };
  barTitle.textContent  = song.title;
  barArtist.textContent = song.artist;
}

function updateNextUp() {
  const ctx = playContext.length ? playContext : songs;
  const pos = ctx.indexOf(songs[currentIdx]);
  const nxt = ctx[(pos+1) % ctx.length];
  npNextTitle.textContent = nxt ? nxt.title : '—';
}

function openNowPlaying() {
  if (currentIdx < 0) return;
  npOverlay.classList.add('open');
  npOverlay.setAttribute('aria-hidden','false');
  document.body.style.overflow = 'hidden';
}

function closeNowPlaying() {
  npOverlay.classList.remove('open');
  npOverlay.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}

// Swipe down to close
let npSwipeY = 0;
npCard.addEventListener('touchstart', e => { npSwipeY = e.touches[0].clientY; }, {passive:true});
npCard.addEventListener('touchend', e => { if (e.changedTouches[0].clientY - npSwipeY > 90) closeNowPlaying(); }, {passive:true});

/* ── PROGRESS BARS ── */
function seekPct(pct) {
  if (!audio.duration) return;
  const clamped = Math.max(0, Math.min(1, pct));
  audio.currentTime = clamped * audio.duration;
  const p = clamped * 100;
  npFill.style.width = p + '%'; npThumb.style.left = p + '%'; barProg.style.width = p + '%';
}
function getPct(e, el) {
  const r = el.getBoundingClientRect();
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  return (x - r.left) / r.width;
}

npTrack.addEventListener('mousedown', e => { progDrag=true; npTrack.classList.add('dragging'); seekPct(getPct(e,npTrack)); });
document.addEventListener('mousemove', e => { if(progDrag) seekPct(getPct(e,npTrack)); });
document.addEventListener('mouseup', () => { if(progDrag){progDrag=false; npTrack.classList.remove('dragging');} });
npTrack.addEventListener('touchstart', e => { progDrag=true; npTrack.classList.add('dragging'); seekPct(getPct(e,npTrack)); }, {passive:true});
document.addEventListener('touchmove', e => { if(progDrag) seekPct(getPct(e,npTrack)); }, {passive:true});
document.addEventListener('touchend', () => { if(progDrag){progDrag=false; npTrack.classList.remove('dragging');} });
barProgCont.addEventListener('click', e => seekPct(getPct(e,barProgCont)));

/* ── SPEED CONTROL ── */
function setSpeed(rate) {
  currentSpeed = rate;
  audio.playbackRate = rate;
  npSpeedBtn.textContent = rate === 1 ? '1.0×' : rate + '×';
  npSpeedBtn.classList.toggle('active', rate !== 1);
  document.querySelectorAll('.popup-opt[data-speed]').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed)===rate));
  saveStorage();
}

npSpeedBtn.addEventListener('click', e => { e.stopPropagation(); positionPopup(speedPopup, e.currentTarget); togglePopup(speedPopup); });
speedPopup.addEventListener('click', e => {
  const btn = e.target.closest('.popup-opt');
  if (!btn) return;
  setSpeed(parseFloat(btn.dataset.speed));
  hidePopups();
});

/* ── SLEEP TIMER ── */
function setSleep(seconds) {
  clearTimeout(sleepTimer); clearInterval(sleepTick);
  if (!seconds) {
    sleepEnd = 0; sleepTick = null;
    npSleepBtn.textContent = '💤 Off';
    npSleepBtn.classList.remove('active');
    sleepRemEl.hidden = true;
    document.querySelectorAll('.popup-opt[data-sleep]').forEach(b => b.classList.toggle('active', b.dataset.sleep==='0'));
    return;
  }
  sleepEnd = Date.now() + seconds * 1000;
  npSleepBtn.classList.add('active');
  sleepRemEl.hidden = false;
  document.querySelectorAll('.popup-opt[data-sleep]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.sleep)===seconds));

  function tick() {
    const rem = sleepEnd - Date.now();
    if (rem <= 0) { audio.pause(); setSleep(0); toast('Sleep timer ended — good night 🌙'); return; }
    const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
    const ts = m + ':' + String(s).padStart(2,'0');
    npSleepBtn.textContent = '💤 ' + ts;
    sleepRemEl.textContent = 'Stops in ' + ts;
  }
  tick();
  sleepTick = setInterval(tick, 1000);
  sleepTimer = setTimeout(() => { audio.pause(); setSleep(0); toast('Sleep timer ended — good night 🌙'); }, seconds * 1000);
}

npSleepBtn.addEventListener('click', e => { e.stopPropagation(); positionPopup(sleepPopup, e.currentTarget); togglePopup(sleepPopup); });
sleepPopup.addEventListener('click', e => {
  const btn = e.target.closest('.popup-opt');
  if (!btn) return;
  setSleep(parseInt(btn.dataset.sleep));
  hidePopups();
});

/* ── CONTEXT MENU ── */
function showContextMenu(e, idx) {
  ctxSongIdx = idx;
  const song = songs[idx];
  if (!song) return;
  const isFav = favourites.has(song.audio);
  ctxFav.textContent = (isFav ? '♥ Remove Favourite' : '♥ Add to Favourites');
  ctxFav.className   = 'ctx-item' + (isFav ? ' ctx-faved' : '');
  ctxMenu.removeAttribute('hidden');

  // Position within viewport
  const mx = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
  const my = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
  ctxMenu.style.left = Math.min(mx, innerWidth - 200) + 'px';
  ctxMenu.style.top  = Math.min(my, innerHeight - 180) + 'px';
}
function hideCtxMenu() { ctxMenu.setAttribute('hidden',''); ctxSongIdx = -1; }

ctxPlay.addEventListener('click', () => { if(ctxSongIdx>=0) playSong(ctxSongIdx); hideCtxMenu(); });
ctxFav.addEventListener('click', () => {
  if (ctxSongIdx < 0) return;
  toggleFav(songs[ctxSongIdx].audio, null);
  hideCtxMenu();
});
ctxQueue.addEventListener('click', () => { if(ctxSongIdx>=0) addToQueue(ctxSongIdx); hideCtxMenu(); });
ctxPl.addEventListener('click', () => { if(ctxSongIdx>=0) openAddToPlaylistModal(ctxSongIdx); hideCtxMenu(); });

/* ── MODAL ── */
function openAddToPlaylistModal(songIdx) {
  const song = songs[songIdx];
  modalTitle.textContent = 'Add to Playlist';
  modalBody.innerHTML = '';

  if (playlists.length) {
    playlists.forEach(pl => {
      const inPl = pl.songs.includes(song.audio);
      const item = document.createElement('div');
      item.className = 'modal-pl-item' + (inPl ? ' selected' : '');
      item.innerHTML = `<span class="modal-pl-ico">♪</span><span class="modal-pl-name">${escHtml(pl.name)}</span>${inPl?'<span class="modal-pl-check">✓</span>':''}`;
      item.addEventListener('click', () => {
        if (inPl) { removeFromPlaylist(pl.id, song.audio); toast('Removed from '+pl.name); }
        else       { addToPlaylist(pl.id, song.audio);    toast('Added to '+pl.name+' ♪'); }
        openAddToPlaylistModal(songIdx); // refresh modal
      });
      modalBody.appendChild(item);
    });
  }

  // New playlist section
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:10px;border-top:1px solid rgba(0,255,0,.1);padding-top:12px;display:flex;flex-direction:column;gap:8px;';
  const inp = document.createElement('input');
  inp.className = 'modal-input'; inp.placeholder = 'New playlist name...'; inp.type = 'text';
  const btn = document.createElement('button');
  btn.className = 'modal-btn'; btn.textContent = '+ Create & Add';
  btn.addEventListener('click', () => {
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    const pl = createPlaylist(name);
    addToPlaylist(pl.id, song.audio);
    toast('Created "'+name+'" and added song ♪');
    closeModal();
  });
  inp.addEventListener('keydown', e => { if(e.key==='Enter') btn.click(); });
  div.appendChild(inp); div.appendChild(btn);
  modalBody.appendChild(div);

  modalOvl.removeAttribute('hidden');
}

function openCreatePlaylistModal() {
  modalTitle.textContent = 'New Playlist';
  modalBody.innerHTML = '';
  const inp = document.createElement('input');
  inp.className = 'modal-input'; inp.placeholder = 'Playlist name...'; inp.type = 'text';
  const btn = document.createElement('button');
  btn.className = 'modal-btn'; btn.textContent = '+ Create Playlist';
  btn.style.marginTop = '10px';
  btn.addEventListener('click', () => {
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    createPlaylist(name);
    toast('Playlist "'+name+'" created!');
    closeModal();
    renderPlaylistNav();
  });
  inp.addEventListener('keydown', e => { if(e.key==='Enter') btn.click(); });
  modalBody.appendChild(inp); modalBody.appendChild(btn);
  modalOvl.removeAttribute('hidden');
  setTimeout(() => inp.focus(), 100);
}

function closeModal() { modalOvl.setAttribute('hidden',''); }

/* ── UI UPDATERS ── */
function updatePPIcons() {
  const src = isPlaying ? 'img/pause1.png' : 'img/play1.png';
  const alt = isPlaying ? 'Pause' : 'Play';
  npPPImg.src = src; npPPImg.alt = alt;
  barPPImg.src= src; barPPImg.alt= alt;
}

function updateActiveCards() {
  document.querySelectorAll('.song').forEach(card => {
    const idx = parseInt(card.dataset.index, 10);
    const isActive = idx === currentIdx;
    card.classList.toggle('active', isActive);
    card.dataset.playing = isActive ? (isPlaying ? '▶' : '⏸') : '';
    const pbi = card.querySelector('.play-btn img');
    if (pbi) { pbi.src = (isActive&&isPlaying)?'img/pause1.png':'img/play1.png'; pbi.alt=(isActive&&isPlaying)?'Pause':'Play'; }
  });
}

function toggleLoop() {
  isLooping = !isLooping; audio.loop = isLooping;
  npLoop.classList.toggle('toggled', isLooping);
  barLoop.classList.toggle('toggled', isLooping);
  npLoop.setAttribute('aria-pressed', isLooping);
  saveStorage();
}
function toggleShuffle() {
  isShuffling = !isShuffling;
  npShuffle.classList.toggle('toggled', isShuffling);
  barShuffle.classList.toggle('toggled', isShuffling);
  npShuffle.setAttribute('aria-pressed', isShuffling);
  saveStorage();
}

/* ── SEARCH ── */
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) { suggestEl.style.display='none'; if(currentView==='library')renderView('library'); return; }
  const res = songs.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
    .sort((a,b) => {
      const aS = (a.title.toLowerCase().includes(q)?2:0)+(a.artist.toLowerCase().includes(q)?1:0);
      const bS = (b.title.toLowerCase().includes(q)?2:0)+(b.artist.toLowerCase().includes(q)?1:0);
      return bS - aS;
    });
  // Suggestions dropdown
  suggestEl.innerHTML = res.slice(0,6).map(s => `
    <div class="sugg-item" data-audio="${escAttr(s.audio)}" tabindex="0" role="option">
      <img src="${escAttr(s.cover||DEFAULT_COVER)}" alt="${escAttr(s.title)}" loading="lazy" onerror="this.src='${DEFAULT_COVER}'">
      <span class="sugg-text">${hl(escHtml(s.title),q)} &mdash; ${escHtml(s.artist)}</span>
    </div>`).join('');
  suggestEl.style.display = res.length ? 'block' : 'none';
  // Filter main grid
  if (currentView === 'library') {
    playContext = res;
    const grid = document.getElementById('playlist');
    if (grid) { grid.innerHTML=''; renderSongGrid(res, grid); }
    viewSub.textContent = res.length + ' results';
  }
});

suggestEl.addEventListener('click', e => {
  const item = e.target.closest('.sugg-item');
  if (!item) return;
  const audio_ = item.dataset.audio;
  const song = songs.find(s => s.audio === audio_);
  if (song) { playSong(songs.indexOf(song)); suggestEl.style.display='none'; searchInput.value=''; if(currentView==='library')renderView('library'); }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) suggestEl.style.display='none';
  if (!ctxMenu.contains(e.target)) hideCtxMenu();
  if (!speedPopup.contains(e.target) && e.target!==npSpeedBtn) speedPopup.setAttribute('hidden','');
  if (!sleepPopup.contains(e.target) && e.target!==npSleepBtn) sleepPopup.setAttribute('hidden','');
});

/* ── SIDEBAR ── */
function openSidebar()  { sidebarEl.classList.add('open'); sidebarOvl.classList.add('open'); hamburger.classList.add('open'); }
function closeSidebar() { sidebarEl.classList.remove('open'); sidebarOvl.classList.remove('open'); hamburger.classList.remove('open'); }
hamburger.addEventListener('click', () => { sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar(); });
sidebarOvl.addEventListener('click', closeSidebar);

/* ── POPUPS HELPER ── */
function positionPopup(popup, anchor) {
  const r = anchor.getBoundingClientRect();
  popup.style.bottom = (innerHeight - r.top + 10) + 'px';
  popup.style.left   = Math.max(8, Math.min(r.left, innerWidth-200)) + 'px';
}
function togglePopup(popup) {
  const hidden = popup.hasAttribute('hidden');
  hidePopups();
  if (hidden) popup.removeAttribute('hidden');
}
function hidePopups() { speedPopup.setAttribute('hidden',''); sleepPopup.setAttribute('hidden',''); }

/* ── MEDIA SESSION ── */
function updateMediaSession(song, cover) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title:song.title, artist:song.artist, artwork: cover ? [{src:cover,sizes:'512x512'}] : [] });
  navigator.mediaSession.setActionHandler('play',  togglePlayPause);
  navigator.mediaSession.setActionHandler('pause', togglePlayPause);
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('stop', () => { audio.pause(); audio.currentTime=0; isPlaying=false; updatePPIcons(); });
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown', e => {
  if (e.target === searchInput || e.target.matches('input,textarea,select')) return;
  switch(e.key) {
    case ' ': e.preventDefault(); togglePlayPause(); break;
    case 'ArrowRight': e.preventDefault(); e.shiftKey ? playNext() : (audio.duration && (audio.currentTime=Math.min(audio.duration,audio.currentTime+5))); break;
    case 'ArrowLeft':  e.preventDefault(); e.shiftKey ? playPrev() : (audio.duration && (audio.currentTime=Math.max(0,audio.currentTime-5))); break;
    case 'ArrowUp':    e.preventDefault(); npVol.value=Math.min(100,+npVol.value+10); audio.volume=npVol.value/100; break;
    case 'ArrowDown':  e.preventDefault(); npVol.value=Math.max(0,+npVol.value-10);  audio.volume=npVol.value/100; break;
    case 'l': case 'L': toggleLoop();    break;
    case 's': case 'S': toggleShuffle(); break;
    case 'm': case 'M': audio.muted=!audio.muted; toast(audio.muted?'Muted 🔇':'Unmuted 🔊'); break;
    case 'f': case 'F': if(currentIdx>=0) toggleFav(songs[currentIdx].audio, null); break;
    case 'q': case 'Q': if(currentIdx>=0) addToQueue(currentIdx); break;
    case 'Escape': closeNowPlaying(); hideCtxMenu(); closeModal(); hidePopups(); break;
    case 'n': case 'N': playNext(); break;
    case 'p': case 'P': playPrev(); break;
    case '?': toast('Space=Play/Pause | N=Next | P=Prev | L=Loop | S=Shuffle | F=Fav | Q=Queue | M=Mute | Esc=Close',''); break;
  }
});

/* ── TOAST ── */
const toastRoot = $('toast-root');
function toast(msg, type='success') {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' '+type : '');
  t.textContent = msg;
  toastRoot.appendChild(t);
  requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

/* ── HELPERS ── */
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s/60); const sec = Math.floor(s%60);
  return m + ':' + (sec<10?'0':'') + sec;
}
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function hl(text, q) {
  const rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')','gi');
  return text.replace(rx,'<span class="highlight">$1</span>');
}
function makeFallbackCover() {
  try {
    const c = document.createElement('canvas'); c.width=c.height=200;
    const ctx = c.getContext('2d');
    ctx.fillStyle='#000'; ctx.fillRect(0,0,200,200);
    for(let i=0;i<8;i++){ctx.strokeStyle=`rgba(0,255,0,${.04+i*.01})`;ctx.lineWidth=1;ctx.beginPath();ctx.rect(i*12,i*12,200-i*24,200-i*24);ctx.stroke();}
    ctx.fillStyle='#00ff00'; ctx.font='bold 56px Courier New';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='#00ff00'; ctx.shadowBlur=16;
    ctx.fillText('♫',100,100);
    return c.toDataURL('image/png');
  } catch { return ''; }
}

/* ── WIRE ALL EVENTS ── */
function wireEvents() {
  // Sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => { closeSidebar(); renderView(btn.dataset.view); });
  });

  // Now playing controls
  npClose.addEventListener('click', closeNowPlaying);
  npBackdrop.addEventListener('click', closeNowPlaying);
  npPPBtn.addEventListener('click', togglePlayPause);
  npPrev.addEventListener('click', playPrev);
  npNext.addEventListener('click', playNext);
  npLoop.addEventListener('click', toggleLoop);
  npShuffle.addEventListener('click', toggleShuffle);
  npHeart.addEventListener('click', () => { if(currentIdx>=0) toggleFav(songs[currentIdx].audio, npHeart); });
  npVol.addEventListener('input', () => { audio.volume = npVol.value / 100; });
  npCtxBtn.addEventListener('click', e => { e.stopPropagation(); if(currentIdx>=0) showContextMenu(e,currentIdx); });
  npQAdd.addEventListener('click', () => { if(currentIdx>=0) addToQueue(currentIdx); });
  npPlAdd.addEventListener('click', () => { if(currentIdx>=0){ closeNowPlaying(); openAddToPlaylistModal(currentIdx); } });
  npNextUp.addEventListener('click', () => { closeNowPlaying(); playNext(); });

  // Bar controls
  barPP.addEventListener('click', togglePlayPause);
  barPrev.addEventListener('click', playPrev);
  barNext.addEventListener('click', playNext);
  barLoop.addEventListener('click', toggleLoop);
  barShuffle.addEventListener('click', toggleShuffle);
  barHeart.addEventListener('click', () => { if(currentIdx>=0) toggleFav(songs[currentIdx].audio, barHeart); });
  barExpand.addEventListener('click', () => { if(currentIdx>=0) openNowPlaying(); });
  barInfoArea.addEventListener('click', () => { if(currentIdx>=0) openNowPlaying(); });

  // Modal
  modalClose.addEventListener('click', closeModal);
  modalOvl.addEventListener('click', e => { if(e.target===modalOvl) closeModal(); });

  // New playlist button
  newPlBtn.addEventListener('click', openCreatePlaylistModal);

  // Toggle loop/shuffle initial state
  if (isLooping)   { npLoop.classList.add('toggled');    barLoop.classList.add('toggled'); }
  if (isShuffling) { npShuffle.classList.add('toggled'); barShuffle.classList.add('toggled'); }
  npSpeedBtn.textContent = currentSpeed === 1 ? '1.0×' : currentSpeed + '×';
}

/* ── SERVICE WORKER ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

/* ── BOOT ── */
init();
