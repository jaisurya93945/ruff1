/* =============================================================
   HACKER PLAYLIST – script.js
   Auto-loads songs from songs.json
   Add a song: put MP3 in audio/, optionally put cover image
   (same filename, .jpg/.png/.webp) in img/covers/, then add
   an entry to songs.json.
   ============================================================= */

'use strict';

/* ----------------------------------------------------------
   MATRIX RAIN CANVAS BACKGROUND
   ---------------------------------------------------------- */
(function initMatrix() {
  const canvas = document.getElementById('matrix-canvas');
  const ctx = canvas.getContext('2d');
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEF<>{}[]|\\/*#@!?';
  let cols, drops, fontSize;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    fontSize = 13;
    cols = Math.floor(canvas.width / fontSize);
    drops = Array.from({ length: cols }, () => Math.random() * -50);
  }

  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + 'px "Courier New", monospace';

    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      const brightness = Math.random() > 0.95 ? '255,255,255' : '0,255,70';
      ctx.fillStyle = `rgba(${brightness},${Math.random() * 0.5 + 0.5})`;
      ctx.fillText(char, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 0.35;
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
})();


/* ----------------------------------------------------------
   STATE
   ---------------------------------------------------------- */
const audio = new Audio();
audio.preload = 'none';

let songs = [];
let currentIndex = -1;
let isPlaying = false;
let isLooping = false;
let isShuffling = false;
let shuffleHistory = [];
let progressDragging = false;
let barProgressDragging = false;

const DEFAULT_COVER = generateDefaultCover();


/* ----------------------------------------------------------
   DOM REFS
   ---------------------------------------------------------- */
const playlistEl     = document.getElementById('playlist');
const npOverlay      = document.getElementById('now-playing-overlay');
const npCard         = document.getElementById('np-card');
const npBackdrop     = document.getElementById('np-backdrop');
const npClose        = document.getElementById('np-close');
const npCover        = document.getElementById('np-cover');
const npTitle        = document.getElementById('np-title');
const npArtist       = document.getElementById('np-artist');
const npCurrent      = document.getElementById('np-current');
const npTotal        = document.getElementById('np-total');
const npProgressTrack= document.getElementById('np-progress-track');
const npProgressFill = document.getElementById('np-progress-fill');
const npProgressThumb= document.getElementById('np-progress-thumb');
const npPlayPause    = document.getElementById('np-playpause');
const npPlayPauseImg = document.getElementById('np-playpause-img');
const npPrev         = document.getElementById('np-prev');
const npNext         = document.getElementById('np-next');
const npLoop         = document.getElementById('np-loop');
const npShuffle      = document.getElementById('np-shuffle');
const npVolume       = document.getElementById('np-volume');
const npArtRing      = document.querySelector('.np-art-ring');

const barCover       = document.getElementById('bar-cover');
const barTitle       = document.getElementById('bar-title');
const barArtist      = document.getElementById('bar-artist');
const barProgress    = document.getElementById('bar-progress-bar');
const barProgressCont= document.getElementById('bar-progress-container');
const barCurrent     = document.getElementById('bar-current');
const barTotal       = document.getElementById('bar-total');
const barPlayPause   = document.getElementById('bar-playpause');
const barPlayImg     = document.getElementById('bar-playpause-img');
const barPrev        = document.getElementById('bar-prev');
const barNext        = document.getElementById('bar-next');
const barLoop        = document.getElementById('bar-loop');
const barShuffle     = document.getElementById('bar-shuffle');
const barExpand      = document.getElementById('bar-expand');
const barInfoArea    = document.getElementById('bar-info-area');

const searchInput    = document.getElementById('search-input');
const suggestionsEl  = document.getElementById('suggestions');


/* ----------------------------------------------------------
   INIT – load songs
   ---------------------------------------------------------- */
async function init() {
  showSkeletons(8);
  try {
    const res = await fetch('songs.json?' + Date.now());
    if (!res.ok) throw new Error('songs.json not found');
    songs = await res.json();
    if (!Array.isArray(songs) || songs.length === 0) throw new Error('No songs in songs.json');
    renderPlaylist(songs);
  } catch (err) {
    playlistEl.innerHTML = `<div style="color:#00ff00;padding:40px;text-align:center;grid-column:1/-1;">
      ⚠ Could not load songs.json<br><small style="opacity:0.6;">${err.message}</small>
    </div>`;
    console.error('[Player]', err);
  }
}


/* ----------------------------------------------------------
   RENDER PLAYLIST
   ---------------------------------------------------------- */
function showSkeletons(count) {
  playlistEl.innerHTML = Array.from({ length: count }, () => `
    <div class="song song-skeleton" aria-hidden="true">
      <div class="skeleton-img"></div>
      <div class="skeleton-line" style="width:80%;margin-top:12px;"></div>
      <div class="skeleton-line short"></div>
    </div>
  `).join('');
}

function renderPlaylist(list) {
  if (list.length === 0) {
    playlistEl.innerHTML = '<p style="grid-column:1/-1;text-align:center;opacity:0.5;">No songs found.</p>';
    return;
  }
  playlistEl.innerHTML = list.map((song, i) => {
    const globalIdx = songs.indexOf(song);
    const coverSrc = song.cover || DEFAULT_COVER;
    const isActive = globalIdx === currentIndex;
    const activeClass = isActive ? (isPlaying ? 'active' : 'active paused') : '';
    return `
      <div class="song ${activeClass}" role="listitem" data-index="${globalIdx}" tabindex="0" aria-label="${escapeAttr(song.title)} by ${escapeAttr(song.artist)}">
        <img
          src="${escapeAttr(coverSrc)}"
          alt="${escapeAttr(song.title)} album art"
          class="song-img"
          loading="lazy"
          decoding="async"
          onerror="this.src='${DEFAULT_COVER}'"
        >
        <p class="song-title">${escapeHtml(song.title)}</p>
        <p class="movie-name">${escapeHtml(song.artist)}</p>
        <button class="play-btn" data-index="${globalIdx}" aria-label="Play ${escapeAttr(song.title)}">
          <img src="${isActive && isPlaying ? 'img/pause1.png' : 'img/play1.png'}" alt="${isActive && isPlaying ? 'Pause' : 'Play'}">
        </button>
      </div>
    `;
  }).join('');
}

/* Event delegation on playlist */
playlistEl.addEventListener('click', function(e) {
  const btn = e.target.closest('.play-btn');
  const card = e.target.closest('.song');
  if (!card) return;

  const idx = parseInt(btn ? btn.dataset.index : card.dataset.index, 10);
  if (isNaN(idx)) return;

  if (idx === currentIndex) {
    togglePlayPause();
  } else {
    playSong(idx);
  }
});

playlistEl.addEventListener('keydown', function(e) {
  const card = e.target.closest('.song');
  if (!card) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const idx = parseInt(card.dataset.index, 10);
    if (idx === currentIndex) togglePlayPause();
    else playSong(idx);
  }
});


/* ----------------------------------------------------------
   COVER AUTO-DETECTION
   When songs.json has no cover, look in img/covers/<basename>.*
   ---------------------------------------------------------- */
async function resolveCover(song) {
  if (song.cover) return song.cover;
  const basename = (song.audio || '').split('/').pop().replace(/\.[^.]+$/, '');
  const exts = ['jpg', 'jpeg', 'png', 'webp'];
  for (const ext of exts) {
    const url = `img/covers/${basename}.${ext}`;
    const ok = await imageExists(url);
    if (ok) return url;
  }
  return DEFAULT_COVER;
}

function imageExists(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function generateDefaultCover() {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 200, 200);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    for (let y = 0; y < 200; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(200, y);
      ctx.globalAlpha = Math.random() * 0.3 + 0.05;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 48px Courier New';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00ff00';
    ctx.shadowBlur = 12;
    ctx.fillText('♫', 100, 100);
    return c.toDataURL('image/png');
  } catch { return ''; }
}


/* ----------------------------------------------------------
   PLAY A SONG
   ---------------------------------------------------------- */
async function playSong(index) {
  if (index < 0 || index >= songs.length) return;

  const song = songs[index];
  currentIndex = index;

  /* Resolve cover (auto-detect if no cover set) */
  const cover = await resolveCover(song);
  song._resolvedCover = cover;

  /* Set audio source */
  audio.src = song.audio;
  audio.volume = npVolume.value / 100;
  audio.loop = isLooping;

  /* Play with error handling */
  try {
    await audio.play();
    isPlaying = true;
  } catch (err) {
    console.warn('[Player] Play failed:', err);
    /* Autoplay policy: wait for user interaction */
    isPlaying = false;
    updatePlayPauseIcons();
    return;
  }

  /* Update shuffle history */
  shuffleHistory.push(index);
  if (shuffleHistory.length > songs.length) shuffleHistory.shift();

  /* Update all UI */
  updateNowPlaying(song, cover);
  updateBarInfo(song, cover);
  updatePlayPauseIcons();
  updateActiveCard();
  openNowPlaying();
  updateMediaSession(song, cover);

  /* Preload next */
  preloadNext(index);
}

function preloadNext(currentIdx) {
  const nextIdx = (currentIdx + 1) % songs.length;
  if (nextIdx !== currentIdx && songs[nextIdx]) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'audio';
    link.href = songs[nextIdx].audio;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    setTimeout(() => link.remove(), 10000);
  }
}


/* ----------------------------------------------------------
   PLAY / PAUSE / TOGGLE
   ---------------------------------------------------------- */
function togglePlayPause() {
  if (currentIndex < 0) {
    playSong(0);
    return;
  }
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
  } else {
    audio.play().then(() => {
      isPlaying = true;
      updatePlayPauseIcons();
      updateActiveCard();
      updateMediaSession(songs[currentIndex], songs[currentIndex]._resolvedCover);
    }).catch(console.warn);
    return;
  }
  updatePlayPauseIcons();
  updateActiveCard();
}

function playNext() {
  if (songs.length === 0) return;
  let next;
  if (isShuffling) {
    let tries = 0;
    do {
      next = Math.floor(Math.random() * songs.length);
      tries++;
    } while (next === currentIndex && songs.length > 1 && tries < 20);
  } else {
    next = (currentIndex + 1) % songs.length;
  }
  playSong(next);
}

function playPrev() {
  if (songs.length === 0) return;
  /* If more than 3s played, restart; else go previous */
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (isShuffling && shuffleHistory.length >= 2) {
    shuffleHistory.pop();
    const prev = shuffleHistory.pop();
    playSong(prev);
  } else {
    const prev = (currentIndex - 1 + songs.length) % songs.length;
    playSong(prev);
  }
}


/* ----------------------------------------------------------
   LOOP & SHUFFLE TOGGLES
   ---------------------------------------------------------- */
function toggleLoop() {
  isLooping = !isLooping;
  audio.loop = isLooping;
  npLoop.classList.toggle('active-toggle', isLooping);
  barLoop.classList.toggle('active-toggle', isLooping);
  npLoop.setAttribute('aria-pressed', isLooping);
  barLoop.querySelector('img').style.opacity = isLooping ? '1' : '0.6';
}

function toggleShuffle() {
  isShuffling = !isShuffling;
  if (isShuffling) shuffleHistory = currentIndex >= 0 ? [currentIndex] : [];
  npShuffle.classList.toggle('active-toggle', isShuffling);
  barShuffle.classList.toggle('active-toggle', isShuffling);
  npShuffle.setAttribute('aria-pressed', isShuffling);
}


/* ----------------------------------------------------------
   AUDIO EVENTS
   ---------------------------------------------------------- */
audio.addEventListener('ended', () => {
  if (!isLooping) playNext();
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration || progressDragging || barProgressDragging) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  const time = formatTime(audio.currentTime);
  const dur  = formatTime(audio.duration);

  npProgressFill.style.width = pct + '%';
  npProgressThumb.style.left = pct + '%';
  barProgress.style.width = pct + '%';

  npCurrent.textContent = time;
  barCurrent.textContent = time;

  if (!isNaN(audio.duration)) {
    npTotal.textContent = dur;
    barTotal.textContent = dur;
  }
});

audio.addEventListener('error', () => {
  console.warn('[Player] Audio load error, skipping to next...');
  showErrorToast();
  setTimeout(playNext, 1500);
});

audio.addEventListener('play',  () => { isPlaying = true;  updatePlayPauseIcons(); updateActiveCard(); npArtRing.classList.add('spinning'); });
audio.addEventListener('pause', () => { isPlaying = false; updatePlayPauseIcons(); updateActiveCard(); npArtRing.classList.remove('spinning'); });


/* ----------------------------------------------------------
   PROGRESS BAR – click & drag (now playing)
   ---------------------------------------------------------- */
function seekTo(pct, el) {
  if (!audio.duration) return;
  const clamped = Math.max(0, Math.min(1, pct));
  audio.currentTime = clamped * audio.duration;
  npProgressFill.style.width = (clamped * 100) + '%';
  npProgressThumb.style.left = (clamped * 100) + '%';
  barProgress.style.width = (clamped * 100) + '%';
}

function getProgressPct(e, el) {
  const rect = el.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return (clientX - rect.left) / rect.width;
}

npProgressTrack.addEventListener('mousedown', e => {
  progressDragging = true;
  npProgressTrack.classList.add('dragging');
  seekTo(getProgressPct(e, npProgressTrack));
});

document.addEventListener('mousemove', e => {
  if (progressDragging) seekTo(getProgressPct(e, npProgressTrack));
});

document.addEventListener('mouseup', () => {
  if (progressDragging) { progressDragging = false; npProgressTrack.classList.remove('dragging'); }
});

npProgressTrack.addEventListener('touchstart', e => {
  progressDragging = true;
  npProgressTrack.classList.add('dragging');
  seekTo(getProgressPct(e, npProgressTrack));
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (progressDragging) seekTo(getProgressPct(e, npProgressTrack));
}, { passive: true });

document.addEventListener('touchend', () => {
  if (progressDragging) { progressDragging = false; npProgressTrack.classList.remove('dragging'); }
});

/* Bar progress click */
barProgressCont.addEventListener('click', e => {
  seekTo(getProgressPct(e, barProgressCont));
});


/* ----------------------------------------------------------
   VOLUME
   ---------------------------------------------------------- */
npVolume.addEventListener('input', () => {
  audio.volume = npVolume.value / 100;
});


/* ----------------------------------------------------------
   NOW PLAYING OVERLAY
   ---------------------------------------------------------- */
function openNowPlaying() {
  npOverlay.classList.add('open');
  npOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeNowPlaying() {
  npOverlay.classList.remove('open');
  npOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

npClose.addEventListener('click', closeNowPlaying);
npBackdrop.addEventListener('click', closeNowPlaying);
barExpand.addEventListener('click', () => {
  if (currentIndex >= 0) openNowPlaying();
});
barInfoArea.addEventListener('click', () => {
  if (currentIndex >= 0) openNowPlaying();
});

/* Swipe down to close on mobile */
let swipeStartY = 0;
npCard.addEventListener('touchstart', e => {
  swipeStartY = e.touches[0].clientY;
}, { passive: true });

npCard.addEventListener('touchend', e => {
  const delta = e.changedTouches[0].clientY - swipeStartY;
  if (delta > 80) closeNowPlaying();
}, { passive: true });


/* ----------------------------------------------------------
   BUTTON WIRING
   ---------------------------------------------------------- */
npPlayPause.addEventListener('click', togglePlayPause);
npPrev.addEventListener('click', playPrev);
npNext.addEventListener('click', playNext);
npLoop.addEventListener('click', toggleLoop);
npShuffle.addEventListener('click', toggleShuffle);

barPlayPause.addEventListener('click', togglePlayPause);
barPrev.addEventListener('click', playPrev);
barNext.addEventListener('click', playNext);
barLoop.addEventListener('click', toggleLoop);
barShuffle.addEventListener('click', toggleShuffle);


/* ----------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------- */
function updateNowPlaying(song, cover) {
  npTitle.textContent  = song.title;
  npArtist.textContent = song.artist;
  npCover.src = cover || DEFAULT_COVER;
  npCover.onerror = () => { npCover.src = DEFAULT_COVER; };
}

function updateBarInfo(song, cover) {
  barTitle.textContent  = song.title;
  barArtist.textContent = song.artist;
  barCover.src = cover || DEFAULT_COVER;
  barCover.onerror = () => { barCover.src = DEFAULT_COVER; };
}

function updatePlayPauseIcons() {
  const playImg   = isPlaying ? 'img/pause1.png' : 'img/play1.png';
  const playAlt   = isPlaying ? 'Pause' : 'Play';
  npPlayPauseImg.src = playImg;
  npPlayPauseImg.alt = playAlt;
  barPlayImg.src     = playImg;
  barPlayImg.alt     = playAlt;
}

function updateActiveCard() {
  document.querySelectorAll('.song').forEach(card => {
    const idx = parseInt(card.dataset.index, 10);
    card.classList.toggle('active', idx === currentIndex);
    card.classList.toggle('paused', idx === currentIndex && !isPlaying);
    const btn = card.querySelector('.play-btn img');
    if (btn && idx === currentIndex) {
      btn.src = isPlaying ? 'img/pause1.png' : 'img/play1.png';
      btn.alt = isPlaying ? 'Pause' : 'Play';
    } else if (btn) {
      btn.src = 'img/play1.png';
      btn.alt = 'Play';
    }
  });
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showErrorToast() {
  const t = document.createElement('div');
  t.textContent = '⚠ Could not load song, skipping...';
  t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:#00ff00;border:1px solid #00ff00;padding:10px 18px;border-radius:6px;font-family:Courier New;font-size:0.85em;z-index:999;box-shadow:0 0 12px rgba(0,255,0,0.4);';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}


/* ----------------------------------------------------------
   MEDIA SESSION API (lock screen / headphone controls)
   ---------------------------------------------------------- */
function updateMediaSession(song, cover) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title:  song.title,
    artist: song.artist,
    album:  '',
    artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : []
  });
  navigator.mediaSession.setActionHandler('play',          togglePlayPause);
  navigator.mediaSession.setActionHandler('pause',         togglePlayPause);
  navigator.mediaSession.setActionHandler('nexttrack',     playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('stop', () => {
    audio.pause();
    audio.currentTime = 0;
    isPlaying = false;
    updatePlayPauseIcons();
  });
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}


/* ----------------------------------------------------------
   KEYBOARD SHORTCUTS
   ---------------------------------------------------------- */
document.addEventListener('keydown', e => {
  /* Don't intercept when typing in search */
  if (e.target === searchInput) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayPause();
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) playNext();
      else if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) playPrev();
      else if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      npVolume.value = Math.min(100, +npVolume.value + 10);
      audio.volume = npVolume.value / 100;
      break;
    case 'ArrowDown':
      e.preventDefault();
      npVolume.value = Math.max(0, +npVolume.value - 10);
      audio.volume = npVolume.value / 100;
      break;
    case 'l': case 'L':
      toggleLoop();
      break;
    case 's': case 'S':
      toggleShuffle();
      break;
    case 'm': case 'M':
      audio.muted = !audio.muted;
      break;
    case 'Escape':
      closeNowPlaying();
      break;
    case 'n': case 'N':
      playNext();
      break;
    case 'p': case 'P':
      playPrev();
      break;
  }
});


/* ----------------------------------------------------------
   SEARCH
   ---------------------------------------------------------- */
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length < 1) {
    suggestionsEl.style.display = 'none';
    renderPlaylist(songs);
    return;
  }

  const results = songs.filter(s =>
    s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  ).sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(q) ? 2 : 0;
    const bTitle = b.title.toLowerCase().includes(q) ? 2 : 0;
    return (bTitle + (b.artist.toLowerCase().includes(q) ? 1 : 0))
         - (aTitle + (a.artist.toLowerCase().includes(q) ? 1 : 0));
  });

  /* Show suggestion dropdown */
  suggestionsEl.innerHTML = results.slice(0, 6).map(s => `
    <div class="suggestion-item" data-title="${escapeAttr(s.title)}" data-artist="${escapeAttr(s.artist)}" tabindex="0" role="option">
      <img src="${escapeAttr(s.cover || DEFAULT_COVER)}" alt="${escapeAttr(s.title)}" loading="lazy" onerror="this.src='${DEFAULT_COVER}'">
      <span class="suggestion-text">${highlight(escapeHtml(s.title), q)} &mdash; ${escapeHtml(s.artist)}</span>
    </div>
  `).join('');
  suggestionsEl.style.display = results.length ? 'block' : 'none';

  /* Also filter the main playlist */
  renderPlaylist(results);
});

suggestionsEl.addEventListener('click', e => {
  const item = e.target.closest('.suggestion-item');
  if (!item) return;
  const title  = item.dataset.title;
  const artist = item.dataset.artist;
  const song = songs.find(s => s.title === title && s.artist === artist);
  if (song) {
    const idx = songs.indexOf(song);
    suggestionsEl.style.display = 'none';
    searchInput.value = '';
    renderPlaylist(songs);
    playSong(idx);
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest('.search-container')) {
    suggestionsEl.style.display = 'none';
  }
});

document.getElementById('search-btn').addEventListener('click', () => {
  searchInput.dispatchEvent(new Event('input'));
});

function highlight(text, q) {
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}


/* ----------------------------------------------------------
   SERVICE WORKER (offline support)
   ---------------------------------------------------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('[Player] SW registration failed (ok in file://):', err.message);
    });
  });
}


/* ----------------------------------------------------------
   BOOT
   ---------------------------------------------------------- */
init();
