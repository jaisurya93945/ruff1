/* ═══════════════════════════════════════════════════════════
   AURA · views — everything inside #views, plus the dialogs
   that hang off them.
   ═══════════════════════════════════════════════════════════ */
import { $, $$, el, icon, fmtTime, fmtSpan, fmtCount, clamp, searchTracks, debounce, supports, download, ls } from './util.js';
import {
  state, set, emit, on, setSetting, trackById, tracksByIds, isFavorite, toggleFavorite,
  statFor, marksFor, addMark, removeMark, createPlaylist, updatePlaylist, deletePlaylist,
  addToPlaylist as addTracksToPlaylist, removeFromPlaylist, persist, DEFAULT_SETTINGS,
} from './store.js';
import { player } from './player.js';
import { engine, EQ_BANDS, EQ_PRESETS } from './engine.js';
import { SORTS, groupBy, importFiles, pickFolder, makeTrack } from './library.js';
import { THEMES, MORPHS, applyTheme, applyMode, applyMorph, applyMotion, applyPerf, openThemeDock, portraitURL } from './themes.js';
import {
  toast, modal, sheet, closeModal, confirm, contextMenu, lazyImg, trackRow, emptyState,
  stagger, sectionHead, statTile, registerDialogs, FALLBACK_ART,
} from './ui.js';
import {
  sleep as sleepTimer, ARCS, buildMoodSet, drawMoodCurve, energyMap, drawDNA,
  makeVibeCard, shareVibeCard, presence, tabSync, echoHeat,
} from './features.js';
import { arcPreset } from './analysis.js';
import { usage, persistStorage, nuke } from './db.js';

const view = (name) => $(`.view[data-view="${name}"]`);

/* ═══ dispatcher ═══════════════════════════════════════════ */
const RENDERERS = {};
export function renderView(name) {
  const node = view(name);
  if (!node) return;
  node.innerHTML = '';
  RENDERERS[name]?.(node);
  node.scrollTop = 0;
}
export function refreshCurrentView() { renderView(state.view); }

/* ═══════════════════════════════════════════════════════════
   HOME
   ═══════════════════════════════════════════════════════════ */
RENDERERS.home = (root) => {
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Still awake' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Late night';
  const theme = THEMES.find(t => t.id === state.settings.theme) || THEMES[0];

  /* ── hero ── */
  const hero = el('div.hero');
  const waifu = el('div.hero-waifu');
  portraitURL(theme.id).then(url => { waifu.style.backgroundImage = `url("${url}")`; });
  hero.append(waifu);

  const totalMs = Object.values(state.stats).reduce((a, s) => a + (s.ms || 0), 0);
  hero.append(
    el('div.hero-greet', {}, [icon('aura'), `${greet} — ${theme.who} is on shift`]),
    el('h1', { html: state.tracks.length
      ? `Your library, <em>${state.tracks.length}</em> ${state.tracks.length === 1 ? 'track' : 'tracks'} deep.`
      : `Nothing here yet.<br><em>Let's fix that.</em>` }),
    el('p.hero-sub', { text: state.tracks.length
      ? `${fmtSpan(totalMs)} listened · ${state.favorites.size} favourites · ${state.playlists.length} playlists. Everything stays on this device.`
      : 'Drop your mp3s into the audio/ folder and run the manifest builder, or just drag files straight onto this window.' }),
    el('div.hero-actions', {}, [
      state.tracks.length && el('button.btn.primary', {
        onclick: () => player.setQueue(state.tracks, Math.floor(Math.random() * state.tracks.length)),
      }, [icon('shuffle'), 'Shuffle everything']),
      state.tracks.length && el('button.btn', { onclick: openMoodDJ }, [icon('wand'), 'Mood DJ']),
      el('button.btn', { onclick: () => $('#filePicker').click() }, [icon('plus'), 'Add tracks']),
      el('button.btn', { onclick: openThemeDock }, [icon('palette'), theme.name]),
    ]),
  );
  root.append(hero);

  if (!state.tracks.length) {
    root.append(emptyState('folder', 'Your library is empty',
      'Put audio files in the <code>audio/</code> folder and run <code>node tools/build-manifest.mjs</code>, ' +
      'or drag files onto this window to play them straight away.',
      { label: 'Choose files', icon: 'plus', run: () => $('#filePicker').click() }));
    return;
  }

  /* ── continue listening ── */
  const recent = tracksByIds(state.recent).slice(0, 12);
  if (recent.length) {
    root.append(rowSection('Jump back in', 'where you left off', recent, { icon: 'clock' }));
  }

  /* ── favourites ── */
  const favs = state.tracks.filter(t => isFavorite(t.id));
  if (favs.length) {
    root.append(rowSection('Favourites', `${favs.length} loved`, favs.slice(0, 12), {
      icon: 'heart',
      more: () => { setView('playlists'); },
    }));
  }

  /* ── most played ── */
  const top = state.tracks
    .map(t => ({ t, s: statFor(t.id) }))
    .filter(x => x.s.plays > 0)
    .sort((a, b) => b.s.plays - a.s.plays)
    .slice(0, 12)
    .map(x => x.t);
  if (top.length) root.append(rowSection('On repeat', 'your most-played', top, { icon: 'fire' }));

  /* ── marked moments ── */
  const marked = state.tracks.filter(t => marksFor(t.id).length);
  if (marked.length) {
    const sec = el('div.sec');
    sec.append(sectionHead('Marked moments', `${marked.reduce((a, t) => a + marksFor(t.id).length, 0)} saved spots across ${marked.length} tracks`));
    const list = el('div');
    marked.slice(0, 6).forEach((t, i) => list.append(trackRow(t, {
      index: i, context: marked, onChange: refreshCurrentView,
      extraMenu: [{ label: 'Open marks', icon: 'mark', run: () => openMarks(t) }],
    })));
    sec.append(stagger(list));
    root.append(sec);
  }

  /* ── recently added ── */
  const fresh = [...state.tracks].sort(SORTS.added).slice(0, 8);
  const sec = el('div.sec');
  sec.append(sectionHead('Recently added', 'newest in your library', [
    el('button.btn.sm', { onclick: () => setView('library') }, ['Open library', icon('chevdown')]),
  ]));
  const list = el('div');
  fresh.forEach((t, i) => list.append(trackRow(t, { index: i, context: fresh, onChange: refreshCurrentView })));
  sec.append(stagger(list));
  root.append(sec);
};

/** a horizontally scrolling shelf of cards */
function rowSection(title, sub, tracks, { icon: ico, more } = {}) {
  const sec = el('div.sec');
  sec.append(sectionHead(title, sub, more ? [el('button.btn.sm', { onclick: more }, ['See all'])] : []));
  const scroller = el('div.scroll-x');
  tracks.forEach(t => scroller.append(trackCard(t, tracks)));
  sec.append(scroller);
  return sec;
}

function trackCard(track, context) {
  const card = el('div.card', { role: 'button', tabindex: '0' });
  const art = el('div.card-art');
  art.append(lazyImg(track.cover, ''), el('div.card-stack'));
  const play = el('button.card-play', {
    'aria-label': `Play ${track.title}`,
    onclick: (e) => { e.stopPropagation(); player.setQueue(context, context.indexOf(track)); },
  }, [icon('play')]);
  art.append(play);
  card.append(art,
    el('div.card-title', { text: track.title, title: track.title }),
    el('div.card-sub', { text: track.artist }));
  card.addEventListener('click', () => player.setQueue(context, context.indexOf(track)));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') player.setQueue(context, context.indexOf(track)); });
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu([
      { label: track.title },
      { label: 'Play now', icon: 'play', run: () => player.setQueue(context, context.indexOf(track)) },
      { label: 'Play next', icon: 'queue', run: () => player.playNext(track) },
      { label: 'Add to queue', icon: 'plus', run: () => player.enqueue(track) },
      { label: isFavorite(track.id) ? 'Unfavourite' : 'Favourite', icon: 'heart', run: () => { toggleFavorite(track.id); refreshCurrentView(); } },
      { label: 'Add to playlist…', icon: 'playlist', run: () => openAddToPlaylist(track) },
    ], e.clientX, e.clientY);
  });
  return card;
}

/* ═══════════════════════════════════════════════════════════
   LIBRARY
   ═══════════════════════════════════════════════════════════ */
let libGroup = 'all';

RENDERERS.library = (root) => {
  const q = state.search.trim();
  let tracks = q ? searchTracks(state.tracks, q) : [...state.tracks].sort(SORTS[state.sort] || SORTS.added);

  const tools = [
    el('div.seg', {}, ['all', 'artist', 'album', 'genre'].map(g =>
      el('button', {
        class: libGroup === g ? 'is-on' : '',
        text: g === 'all' ? 'Tracks' : g[0].toUpperCase() + g.slice(1) + 's',
        onclick: () => { libGroup = g; renderView('library'); },
      }))),
    el('button.btn.sm', {
      title: 'Sort',
      onclick: (e) => contextMenu(Object.keys(SORTS).map(k => ({
        label: { added: 'Recently added', title: 'Title A–Z', artist: 'Artist A–Z', album: 'Album A–Z', longest: 'Longest first' }[k],
        icon: state.sort === k ? 'check' : 'list',
        run: () => { set({ sort: k }); ls.set('sort', k); renderView('library'); },
      })), e.clientX, e.clientY),
    }, [icon('list'), 'Sort']),
    el('button.btn.sm', {
      title: 'Toggle grid / list',
      onclick: () => { const l = state.layout === 'grid' ? 'list' : 'grid'; set({ layout: l }); ls.set('layout', l); renderView('library'); },
    }, [icon(state.layout === 'grid' ? 'list' : 'grid'), state.layout === 'grid' ? 'List' : 'Grid']),
  ];

  root.append(sectionHead(
    q ? `“${q}”` : 'Library',
    q ? `${tracks.length} ${tracks.length === 1 ? 'match' : 'matches'}` : `${state.tracks.length} tracks · ${fmtSpan(state.tracks.reduce((a, t) => a + (t.duration || 0) * 1000, 0))}`,
    tools));

  if (!tracks.length) {
    root.append(emptyState('search', q ? 'Nothing matched' : 'Library is empty',
      q ? `No track, artist or album looks like <b>“${q}”</b>.` : 'Add some audio to get started.',
      q ? { label: 'Clear search', icon: 'close', run: () => { $('#search').value = ''; set({ search: '' }); renderView('library'); } }
        : { label: 'Add tracks', icon: 'plus', run: () => $('#filePicker').click() }));
    return;
  }

  if (libGroup !== 'all' && !q) {
    for (const [name, group] of groupBy(tracks, libGroup)) {
      const sec = el('div.sec');
      sec.append(sectionHead(name, `${group.length} ${group.length === 1 ? 'track' : 'tracks'} · ${fmtTime(group.reduce((a, t) => a + (t.duration || 0), 0))}`, [
        el('button.btn.sm', { onclick: () => player.setQueue(group, 0, { label: name }) }, [icon('play'), 'Play']),
        el('button.btn.sm', { onclick: () => player.enqueue(group) }, [icon('plus'), 'Queue']),
      ]));
      const list = el('div');
      group.forEach((t, i) => list.append(trackRow(t, { index: i, context: group, onChange: refreshCurrentView })));
      sec.append(list);
      root.append(sec);
    }
    return;
  }

  if (state.layout === 'grid') {
    const grid = el('div.card-grid');
    tracks.forEach(t => grid.append(trackCard(t, tracks)));
    root.append(stagger(grid));
  } else {
    root.append(virtualList(tracks));
  }
};

/**
 * Only the rows near the viewport exist in the DOM. Keeps a
 * 5,000-track library scrolling at 60fps on a phone.
 */
function virtualList(tracks) {
  const ROW_H = 64;
  const BUFFER = 8;
  const host = el('div', { style: { position: 'relative' } });
  const spacer = el('div', { style: { height: tracks.length * ROW_H + 'px' } });
  const layer = el('div', { style: { position: 'absolute', inset: '0 0 auto 0' } });
  host.append(spacer, layer);

  let first = -1, last = -1;
  const scroller = () => host.closest('.view') || document.scrollingElement;

  function paint() {
    const sc = scroller();
    if (!sc) return;
    const top = Math.max(0, sc.scrollTop - host.offsetTop);
    const visible = Math.ceil(sc.clientHeight / ROW_H) + BUFFER * 2;
    const start = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
    const end = Math.min(tracks.length, start + visible);
    if (start === first && end === last) return;
    first = start; last = end;

    layer.innerHTML = '';
    layer.style.transform = `translateY(${start * ROW_H}px)`;
    for (let i = start; i < end; i++) {
      const row = trackRow(tracks[i], { index: i, context: tracks, onChange: refreshCurrentView });
      row.style.height = ROW_H + 'px';
      layer.append(row);
    }
  }

  // small libraries don't need any of this
  if (tracks.length <= 120) {
    host.innerHTML = '';
    const plain = el('div');
    tracks.forEach((t, i) => plain.append(trackRow(t, { index: i, context: tracks, onChange: refreshCurrentView })));
    host.append(stagger(plain));
    return host;
  }

  requestAnimationFrame(() => {
    paint();
    const sc = scroller();
    const onScroll = () => requestAnimationFrame(paint);
    sc?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    host._cleanup = () => { sc?.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  });
  return host;
}

/* ═══════════════════════════════════════════════════════════
   QUEUE
   ═══════════════════════════════════════════════════════════ */
RENDERERS.queue = (root) => {
  const tracks = tracksByIds(state.queue);
  const upcoming = tracks.length - state.qIndex - 1;

  root.append(sectionHead('Queue',
    tracks.length ? `${tracks.length} tracks · ${upcoming > 0 ? `${upcoming} still to come` : 'last one playing'}` : 'nothing lined up',
    tracks.length ? [
      el('button.btn.sm', { onclick: () => { const n = createPlaylist(`Queue · ${new Date().toLocaleDateString()}`, state.queue); toast(`Saved as “${n.name}”`, { icon: 'playlist' }); } }, [icon('playlist'), 'Save as playlist']),
      el('button.btn.sm', {
        onclick: async () => {
          if (!state.settings.confirmDelete || await confirm({ title: 'Clear the queue?', sub: 'Playback stops. Your library is untouched.', confirmLabel: 'Clear', danger: true })) {
            player.clearQueue(); renderView('queue');
          }
        },
      }, [icon('trash'), 'Clear']),
    ] : []));

  if (!tracks.length) {
    root.append(emptyState('queue', 'The queue is empty',
      'Play anything from your library, or hit <b>Shuffle everything</b> on the home screen.',
      { label: 'Go to library', icon: 'library', run: () => setView('library') }));
    return;
  }

  if (state.qIndex >= 0) {
    const now = el('div.sec');
    now.append(el('div.eyebrow', { text: 'Now playing' }));
    now.append(trackRow(tracks[state.qIndex], {
      index: state.qIndex, onPlay: () => player.toggle(), showPlays: false, onChange: refreshCurrentView,
    }));
    root.append(now);
  }

  const next = el('div.sec');
  next.append(el('div.eyebrow', { text: upcoming > 0 ? 'Up next — drag to reorder' : 'Queue' }));
  const list = el('div');
  tracks.forEach((t, i) => {
    if (i === state.qIndex) return;
    list.append(trackRow(t, {
      index: i,
      queueIndex: i,
      draggable: true,
      showPlays: false,
      onPlay: () => player.playAt(i),
      onChange: refreshCurrentView,
      onReorder: (from, to) => { player.moveInQueue(from, to); renderView('queue'); },
      extraMenu: [{ label: 'Remove from queue', icon: 'trash', danger: true, run: () => { player.removeAt(i); renderView('queue'); } }],
    }));
  });
  next.append(list);
  root.append(next);
};

/* ═══════════════════════════════════════════════════════════
   PLAYLISTS
   ═══════════════════════════════════════════════════════════ */
RENDERERS.playlists = (root) => {
  root.append(sectionHead('Playlists', `${state.playlists.length} of your own, plus the smart ones`, [
    el('button.btn.sm.primary', { onclick: () => openNewPlaylist() }, [icon('plus'), 'New playlist']),
  ]));

  /* smart playlists */
  const smart = [
    { id: '__fav', name: 'Favourites', icon: 'heart', get: () => state.tracks.filter(t => isFavorite(t.id)) },
    { id: '__recent', name: 'Recently played', icon: 'clock', get: () => tracksByIds(state.recent) },
    { id: '__top', name: 'Most played', icon: 'fire', get: () => state.tracks.map(t => ({ t, s: statFor(t.id) })).filter(x => x.s.plays).sort((a, b) => b.s.plays - a.s.plays).map(x => x.t) },
    { id: '__marks', name: 'Marked moments', icon: 'mark', get: () => state.tracks.filter(t => marksFor(t.id).length) },
  ];
  const smartGrid = el('div.card-grid');
  for (const s of smart) {
    const list = s.get();
    smartGrid.append(playlistCard({
      name: s.name, count: list.length, iconName: s.icon, smart: true,
      covers: list.slice(0, 4).map(t => t.cover),
      onOpen: () => openPlaylistDetail({ id: s.id, name: s.name, trackIds: list.map(t => t.id), smart: true }),
      onPlay: () => list.length ? player.setQueue(list, 0, { label: s.name }) : toast('Nothing in here yet'),
    }));
  }
  const smartSec = el('div.sec');
  smartSec.append(el('div.eyebrow', { text: 'Smart' }), smartGrid);
  root.append(smartSec);

  /* user playlists */
  const mineSec = el('div.sec');
  mineSec.append(el('div.eyebrow', { text: 'Yours' }));
  if (!state.playlists.length) {
    mineSec.append(emptyState('playlist', 'No playlists yet',
      'Build one from the queue, or from any track’s menu.',
      { label: 'Create playlist', icon: 'plus', run: () => openNewPlaylist() }));
  } else {
    const grid = el('div.card-grid');
    for (const pl of state.playlists) {
      const tracks = tracksByIds(pl.trackIds);
      grid.append(playlistCard({
        name: pl.name, count: tracks.length,
        covers: tracks.slice(0, 4).map(t => t.cover),
        onOpen: () => openPlaylistDetail(pl),
        onPlay: () => tracks.length ? player.setQueue(tracks, 0, { label: pl.name }) : toast('This playlist is empty'),
        onMenu: (x, y) => contextMenu([
          { label: pl.name },
          { label: 'Play', icon: 'play', run: () => tracks.length && player.setQueue(tracks, 0) },
          { label: 'Add to queue', icon: 'plus', run: () => player.enqueue(tracks) },
          { label: 'Rename…', icon: 'playlist', run: () => openNewPlaylist(pl) },
          '-',
          { label: 'Export as JSON', icon: 'download', run: () => exportPlaylist(pl) },
          { label: 'Delete', icon: 'trash', danger: true, run: async () => {
            if (!state.settings.confirmDelete || await confirm({ title: `Delete “${pl.name}”?`, sub: 'The tracks stay in your library.', confirmLabel: 'Delete', danger: true })) {
              deletePlaylist(pl.id); renderView('playlists'); toast('Playlist deleted');
            }
          } },
        ], x, y),
      }));
    }
    mineSec.append(stagger(grid));
  }
  root.append(mineSec);
};

function playlistCard({ name, count, covers = [], iconName, smart, onOpen, onPlay, onMenu }) {
  const card = el('div.card', { role: 'button', tabindex: '0' });
  const art = el('div.card-art');

  if (covers.filter(Boolean).length >= 4) {
    const mosaic = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', width: '100%', height: '100%' } });
    covers.slice(0, 4).forEach(c => mosaic.append(lazyImg(c, '', '')));
    art.append(mosaic);
  } else if (covers.filter(Boolean)[0]) {
    art.append(lazyImg(covers.filter(Boolean)[0], ''));
  } else {
    art.append(el('div', {
      style: { width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'var(--accent-grad)' },
    }, [icon(iconName || 'playlist', 'ico')]));
    art.querySelector('svg').style.cssText = 'width:44px;height:44px;color:#fff;opacity:.9';
  }
  art.append(el('div.card-stack'));
  art.append(el('button.card-play', { 'aria-label': `Play ${name}`, onclick: (e) => { e.stopPropagation(); onPlay?.(); } }, [icon('play')]));

  card.append(art,
    el('div.card-title', { text: name }),
    el('div.card-sub', { text: `${count} ${count === 1 ? 'track' : 'tracks'}${smart ? ' · auto' : ''}` }));
  card.addEventListener('click', () => onOpen?.());
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpen?.(); });
  if (onMenu) card.addEventListener('contextmenu', (e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); });
  return card;
}

function openPlaylistDetail(pl) {
  const tracks = tracksByIds(pl.trackIds);
  const body = el('div');

  if (!tracks.length) {
    body.append(emptyState('playlist', 'Nothing in here', 'Add tracks from any track’s ••• menu.'));
  } else {
    const list = el('div', { style: { maxHeight: '54vh', overflow: 'auto', margin: '0 -8px' } });
    tracks.forEach((t, i) => list.append(trackRow(t, {
      index: i, context: tracks, showPlays: false,
      onPlay: () => { player.setQueue(tracks, i, { label: pl.name }); closeModal(); },
      extraMenu: pl.smart ? [] : [{
        label: 'Remove from this playlist', icon: 'trash', danger: true,
        run: () => { removeFromPlaylist(pl.id, t.id); closeModal(); renderView('playlists'); toast('Removed'); },
      }],
    })));
    body.append(list);
  }

  sheet({
    title: pl.name,
    sub: `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} · ${fmtSpan(tracks.reduce((a, t) => a + (t.duration || 0) * 1000, 0))}`,
    body, wide: true,
    actions: [
      tracks.length && { label: 'Shuffle', icon: 'shuffle', run: () => { if (!state.shuffle) player.toggleShuffle(); player.setQueue(tracks, 0, { label: pl.name }); closeModal(); } },
      tracks.length && { label: 'Play', icon: 'play', primary: true, run: () => { player.setQueue(tracks, 0, { label: pl.name }); closeModal(); } },
    ].filter(Boolean),
  });
}

function openNewPlaylist(existing = null) {
  const input = el('input', { type: 'text', value: existing?.name || '', placeholder: 'Late night drive', maxlength: '64' });
  const body = el('div.field', {}, [el('label', { text: 'Playlist name' }), input]);
  const save = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (existing) { updatePlaylist(existing.id, { name }); toast('Renamed'); }
    else { createPlaylist(name); toast(`“${name}” created`, { icon: 'playlist' }); }
    closeModal(); renderView('playlists');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet({
    title: existing ? 'Rename playlist' : 'New playlist',
    sub: existing ? null : 'Playlists live in this browser — export them from the ••• menu to keep a copy.',
    body,
    actions: [{ label: 'Cancel', run: closeModal }, { label: existing ? 'Save' : 'Create', primary: true, run: save }],
  });
}

function exportPlaylist(pl) {
  const tracks = tracksByIds(pl.trackIds);
  const json = JSON.stringify({
    name: pl.name, createdAt: pl.createdAt, exportedAt: new Date().toISOString(),
    tracks: tracks.map(t => ({ title: t.title, artist: t.artist, album: t.album, src: t.src })),
  }, null, 2);
  download(new Blob([json], { type: 'application/json' }), `${pl.name.replace(/\W+/g, '-').toLowerCase()}.json`);
  toast('Playlist exported');
}

function openAddToPlaylist(track) {
  const body = el('div');
  const list = el('div', { style: { maxHeight: '46vh', overflow: 'auto', display: 'grid', gap: '6px' } });

  if (!state.playlists.length) {
    list.append(el('p.muted', { style: { fontSize: '13px', padding: '8px 0' }, text: 'No playlists yet — make one below.' }));
  }
  for (const pl of state.playlists) {
    const has = pl.trackIds.includes(track.id);
    list.append(el('button.set-row', {
      style: { width: '100%', textAlign: 'left', cursor: 'pointer' },
      onclick: () => {
        if (has) { removeFromPlaylist(pl.id, track.id); toast(`Removed from “${pl.name}”`); }
        else { addTracksToPlaylist(pl.id, track.id); toast(`Added to “${pl.name}”`, { icon: 'playlist' }); }
        closeModal();
      },
    }, [
      el('div.grow', {}, [el('b', { text: pl.name }), el('small', { text: `${pl.trackIds.length} tracks` })]),
      has ? icon('check') : icon('plus'),
    ]));
  }
  body.append(list);

  const nameInput = el('input', { type: 'text', placeholder: 'New playlist name…', maxlength: '64' });
  const create = () => {
    const n = nameInput.value.trim();
    if (!n) return;
    const pl = createPlaylist(n, [track.id]);
    toast(`“${pl.name}” created with this track`, { icon: 'playlist' });
    closeModal();
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  body.append(el('div.field', { style: { marginTop: '16px' } }, [el('label', { text: 'Or start a new one' }), nameInput]));

  sheet({ title: 'Add to playlist', sub: track.title, body, actions: [{ label: 'Create', primary: true, run: create }] });
}

/* ═══════════════════════════════════════════════════════════
   MOMENT MARKS
   ═══════════════════════════════════════════════════════════ */
function openMarks(track) {
  const marks = marksFor(track.id);
  const body = el('div');

  if (!marks.length) {
    body.append(el('p.muted', { style: { fontSize: '13.5px', lineHeight: '1.6' },
      html: 'No marks on this track yet. Press <kbd>M</kbd> while it plays to pin the exact second you’re hearing — then jump straight back to it any time.' }));
  } else {
    const list = el('div', { style: { display: 'grid', gap: '6px' } });
    marks.forEach((m, i) => list.append(el('div.set-row', {}, [
      el('div.grow', {}, [
        el('b', { text: `Mark ${i + 1}` }),
        el('small', { text: `at ${fmtTime(m)}` }),
      ]),
      el('button.btn.sm', {
        onclick: () => {
          if (state.current?.id !== track.id) {
            const idx = state.tracks.indexOf(track);
            player.setQueue(state.tracks, idx >= 0 ? idx : 0);
            setTimeout(() => player.seek(m), 420);
          } else player.seek(m);
          closeModal();
        },
      }, [icon('play'), 'Jump']),
      el('button.icon-btn.tiny', {
        title: 'Remove',
        onclick: (e) => { removeMark(track.id, m); e.currentTarget.closest('.set-row').remove(); refreshCurrentView(); },
      }, [icon('trash')]),
    ])));
    body.append(list);

    if (marks.length >= 2) {
      body.append(el('div.set-row', { style: { marginTop: '14px' } }, [
        el('div.grow', {}, [
          el('b', { text: 'Loop between two marks' }),
          el('small', { text: 'plays the stretch from the first mark to the last, over and over' }),
        ]),
        el('button.btn.sm.primary', {
          onclick: () => { startMarkLoop(track, marks[0], marks[marks.length - 1]); closeModal(); },
        }, [icon('repeat'), 'Loop']),
      ]));
    }
  }

  sheet({ title: 'Moment marks', sub: track.title, body });
}

/* a loop between two points, torn down as soon as anything else happens */
let loopHandle = null;
export function startMarkLoop(track, from, to) {
  stopMarkLoop();
  if (state.current?.id !== track.id) {
    const idx = state.tracks.indexOf(track);
    player.setQueue(state.tracks, idx >= 0 ? idx : 0);
  }
  setTimeout(() => player.seek(from), 260);
  loopHandle = setInterval(() => {
    if (state.current?.id !== track.id) return stopMarkLoop();
    if (engine.currentTime >= to || engine.currentTime < from - 1) player.seek(from);
  }, 220);
  toast(`Looping ${fmtTime(from)} → ${fmtTime(to)}`, { icon: 'repeat', ms: 3400, action: { label: 'Stop', run: stopMarkLoop } });
}
export function stopMarkLoop() {
  if (loopHandle) { clearInterval(loopHandle); loopHandle = null; }
}

/* ═══════════════════════════════════════════════════════════
   DNA / STATS
   ═══════════════════════════════════════════════════════════ */
RENDERERS.stats = (root) => {
  const played = state.tracks.map(t => ({ t, s: statFor(t.id) })).filter(x => x.s.plays > 0);
  const totalMs = played.reduce((a, x) => a + x.s.ms, 0);
  const totalPlays = played.reduce((a, x) => a + x.s.plays, 0);

  root.append(sectionHead('Listening DNA', 'built from what you actually play — nothing leaves this device', [
    played.length ? el('button.btn.sm', { onclick: () => exportStats() }, [icon('download'), 'Export']) : null,
    played.length ? el('button.btn.sm.danger', {
      onclick: async () => {
        if (await confirm({ title: 'Reset all stats?', sub: 'Play counts, listening time and the echo maps are erased. Favourites and playlists stay.', confirmLabel: 'Reset', danger: true })) {
          state.stats = {}; state.echo = {}; persist.stats(); persist.echo(); renderView('stats'); toast('Stats reset');
        }
      },
    }, [icon('trash'), 'Reset']) : null,
  ].filter(Boolean)));

  const grid = el('div.stat-grid');
  grid.append(
    statTile('Listening time', fmtSpan(totalMs), played.length ? `across ${played.length} tracks` : 'nothing yet'),
    statTile('Plays', fmtCount(totalPlays), 'counted past 20s'),
    statTile('Favourites', String(state.favorites.size), `${state.playlists.length} playlists`),
    statTile('Moment marks', String(Object.values(state.marks).reduce((a, m) => a + m.length, 0)), 'saved spots'),
  );
  root.append(grid);

  /* the fingerprint */
  const dnaSec = el('div.sec', { style: { marginTop: 'var(--s-6)' } });
  dnaSec.append(sectionHead('Your fingerprint', 'one petal per track, length = time spent, white rim = favourite'));
  const wrap = el('div.dna-wrap.pane');
  const canvas = el('canvas#dnaCanvas');
  wrap.append(canvas);
  dnaSec.append(wrap);
  root.append(dnaSec);
  requestAnimationFrame(() => drawDNA(canvas, state.tracks));

  if (!played.length) {
    root.append(emptyState('dna', 'Nothing to chart yet', 'Play a few tracks and this page fills itself in.'));
    return;
  }

  /* top tracks */
  const topSec = el('div.sec');
  topSec.append(sectionHead('Most played', 'by time spent, not clicks'));
  const list = el('div');
  played.sort((a, b) => b.s.ms - a.s.ms).slice(0, 15).forEach((x, i) => {
    const row = trackRow(x.t, { index: i, context: played.map(p => p.t), onChange: refreshCurrentView });
    row.querySelector('.t-right').prepend(el('div.t-badge', { text: fmtSpan(x.s.ms) }));
    list.append(row);
  });
  topSec.append(stagger(list));
  root.append(topSec);

  /* top artists */
  const byArtist = new Map();
  for (const { t, s } of played) byArtist.set(t.artist, (byArtist.get(t.artist) || 0) + s.ms);
  const artists = [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (artists.length) {
    const sec = el('div.sec');
    sec.append(sectionHead('Top artists', 'where your hours go'));
    const max = artists[0][1] || 1;
    const bars = el('div', { style: { display: 'grid', gap: '10px' } });
    for (const [name, ms] of artists) {
      bars.append(el('div', {}, [
        el('div.row', { style: { justifyContent: 'space-between', marginBottom: '5px' } }, [
          el('b', { style: { fontSize: '13.5px' }, text: name }),
          el('span.mono.muted', { style: { fontSize: '12px' }, text: fmtSpan(ms) }),
        ]),
        el('div', { style: { height: '8px', borderRadius: '99px', background: 'var(--surface-2)', overflow: 'hidden' } }, [
          el('i', { style: { display: 'block', height: '100%', width: (ms / max * 100).toFixed(1) + '%', background: 'var(--accent-grad)', borderRadius: '99px' } }),
        ]),
      ]));
    }
    sec.append(bars);
    root.append(sec);
  }
};

function exportStats() {
  const data = {
    exportedAt: new Date().toISOString(),
    stats: state.stats, favorites: [...state.favorites], marks: state.marks,
    playlists: state.playlists, recent: state.recent, echo: state.echo,
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'aura-listening-data.json');
  toast('Exported your listening data');
}

/* ═══════════════════════════════════════════════════════════
   LAB — the experimental shelf
   ═══════════════════════════════════════════════════════════ */
RENDERERS.lab = (root) => {
  root.append(sectionHead('The Lab', 'things most players don’t have. All of it is live — change it while something plays.'));

  const cards = [
    { icon:'eq', title:'Equalizer', body:'Ten bands plus ten presets, applied in real time.', action:{ label:'Open', run: openEQ } },
    { icon:'orbit', title:'Orbit — spatial audio', body:'Sends the track circling around your head using an HRTF panner. Best on headphones.', toggle:'orbit' },
    { icon:'mic', title:'Vocal isolate', body:'Cancels the centre channel so the lead vocal drops out — instant karaoke. Slide it back for a subtle dip.', action:{ label:'Adjust', run: openVocal } },
    { icon:'wand', title:'Mood DJ', body:'Reads the energy of every track and orders a set along a curve: warm up, peak, land softly.', action:{ label:'Build a set', run: openMoodDJ } },
    { icon:'fire', title:'Echo map', body:'The player remembers which seconds you replay and paints them as heat on the waveform. Your hot loops, visible.', action:{ label:'How it looks', run: explainEcho } },
    { icon:'mark', title:'Moment marks', body:'Pin the exact second of a drop, a lyric, a laugh. Jump back or loop between two marks.', action:{ label:'See marks', run: () => { const t = state.current || state.tracks[0]; t ? openMarks(t) : toast('Add some music first'); } } },
    { icon:'sync', title:'Tab party', body:'Every open tab on this device stays on the same track and the same second. Control it from any of them.', toggle:'tabSync' },
    { icon:'card', title:'Vibe card', body:'Renders what’s playing as a share-ready image — cover, waveform, your play count.', action:{ label:'Make one', run: openVibeCard } },
    { icon:'moon', title:'Sleep timer', body:'Fades out over the last 30 seconds instead of cutting off mid-bar.', action:{ label:'Set', run: openSleep } },
    { icon:'speed', title:'Speed & pitch', body:'0.5× to 2×, with pitch preserved so it still sounds like the song.', action:{ label:'Adjust', run: openSpeed } },
  ];

  const grid = el('div.card-grid', { style: { gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' } });
  for (const c of cards) {
    const card = el('div.pane', { style: { padding: 'var(--s-5)', display: 'grid', gap: '10px', alignContent: 'start' } });
    const head = el('div.row', {}, [
      el('span', { style: { width: '38px', height: '38px', borderRadius: '11px', display: 'grid', placeItems: 'center', background: 'var(--accent-grad)', color: '#fff', flex: 'none' } }, [icon(c.icon)]),
      el('b', { style: { fontSize: '15px' }, text: c.title }),
    ]);
    card.append(head, el('p.muted', { style: { fontSize: '13px', lineHeight: '1.6' }, text: c.body }));

    if (c.toggle) {
      const on = !!state.settings[c.toggle];
      const sw = el('div.switch', { class: on ? 'on' : '' });
      const row = el('div.row', { style: { justifyContent: 'space-between', marginTop: '4px' } }, [
        el('span.muted', { style: { fontSize: '12.5px' }, text: on ? 'On' : 'Off' }), sw,
      ]);
      row.addEventListener('click', () => {
        const next = !state.settings[c.toggle];
        setSetting(c.toggle, next);
        sw.classList.toggle('on', next);
        row.firstChild.textContent = next ? 'On' : 'Off';
        applyLabToggle(c.toggle, next);
      });
      row.style.cursor = 'pointer';
      card.append(row);
    } else if (c.action) {
      card.append(el('button.btn.sm', { style: { marginTop: '4px', justifySelf: 'start' }, onclick: c.action.run }, [c.action.label]));
    }
    grid.append(card);
  }
  root.append(stagger(grid));
};

export function applyLabToggle(key, on) {
  if (key === 'orbit') {
    engine.setOrbit(on, state.settings.orbitSpeed);
    $('#npOrbit')?.classList.toggle('on', on);
    $('#chipOrbit')?.classList.toggle('is-on', on);
    toast(on ? 'Orbit on — headphones recommended' : 'Orbit off', { icon: 'orbit' });
  }
  if (key === 'tabSync') {
    on ? tabSync.start() : tabSync.stop();
    toast(on ? 'Tab party on — other tabs will follow' : 'Tab party off', { icon: 'sync' });
  }
}

function explainEcho() {
  const t = state.current;
  const heat = t ? echoHeat(t.id) : null;
  sheet({
    title: 'Echo map',
    sub: t ? t.title : 'Play something to build one',
    body: el('div', {}, [
      el('p.muted', { style: { fontSize: '13.5px', lineHeight: '1.7' },
        html: 'Every second you listen to is counted against a slot in the track. Replay a chorus three times and that slot gets three times the heat — so the waveform in the full-screen player slowly stains where you keep going back.' }),
      el('div.heat-legend', { style: { marginTop: '14px' } }, [el('span', { text: 'cold' }), el('i'), el('span', { text: 'hot' })]),
      heat
        ? el('p', { style: { marginTop: '14px', fontSize: '13px' }, text: `This track has ${Math.round(heat.reduce((a, b) => a + b, 0) * 10) / 10} units of heat so far — open the full-screen player to see it.` })
        : el('p.muted', { style: { marginTop: '14px', fontSize: '13px' }, text: 'Not enough listening on this track yet. Keep playing.' }),
    ]),
    actions: [{ label: 'Open full screen', primary: true, icon: 'expand', run: () => { closeModal(); emit('np:open'); } }],
  });
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════ */
RENDERERS.settings = (root) => {
  root.append(sectionHead('Settings', 'everything is stored in this browser only'));

  const group = (title, rows) => {
    const g = el('div.set-group');
    g.append(el('h3', { text: title }));
    rows.filter(Boolean).forEach(r => g.append(r));
    return g;
  };

  const toggleRow = (title, sub, key, onChange) => {
    const on = !!state.settings[key];
    const sw = el('div.switch', { class: on ? 'on' : '' });
    const row = el('div.set-row', { style: { cursor: 'pointer' } }, [
      el('div.grow', {}, [el('b', { text: title }), el('small', { text: sub })]), sw,
    ]);
    row.addEventListener('click', () => {
      const next = !state.settings[key];
      setSetting(key, next);
      sw.classList.toggle('on', next);
      onChange?.(next);
    });
    return row;
  };

  const sliderRow = (title, sub, key, { min, max, step, fmt, onInput }) => {
    const val = el('b.mono', { style: { fontSize: '13px', color: 'var(--accent)', minWidth: '52px', textAlign: 'right' }, text: fmt(state.settings[key]) });
    const input = el('input.range', { type: 'range', min, max, step, value: state.settings[key], style: { maxWidth: '190px' } });
    const paint = () => input.style.setProperty('--p', ((input.value - min) / (max - min) * 100) + '%');
    paint();
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      setSetting(key, v); val.textContent = fmt(v); paint(); onInput?.(v);
    });
    return el('div.set-row', {}, [el('div.grow', {}, [el('b', { text: title }), el('small', { text: sub })]), input, val]);
  };

  /* ── appearance ── */
  const themeRow = el('div.set-row', {}, [
    el('div.grow', {}, [el('b', { text: 'Theme' }), el('small', { text: `${THEMES.find(t => t.id === state.settings.theme)?.name} · ${MORPHS.find(m => m.id === state.settings.morph)?.name} surfaces` })]),
    el('button.btn.sm', { onclick: openThemeDock }, [icon('palette'), 'Change']),
  ]);
  const modeSeg = el('div.seg', {}, ['dark', 'light'].map(m =>
    el('button', { class: state.settings.mode === m ? 'is-on' : '', text: m === 'dark' ? 'Dark' : 'Light',
      onclick: (e) => { applyMode(m); [...e.currentTarget.parentElement.children].forEach(b => b.classList.toggle('is-on', b.textContent.toLowerCase() === m)); } })));
  const perfSeg = el('div.seg', {}, ['auto', 'full', 'lite'].map(p =>
    el('button', { class: state.settings.perf === p ? 'is-on' : '', text: p[0].toUpperCase() + p.slice(1),
      onclick: (e) => { applyPerf(p); [...e.currentTarget.parentElement.children].forEach(b => b.classList.toggle('is-on', b.textContent.toLowerCase() === p)); toast(`Graphics: ${p}`); } })));

  root.append(group('Appearance', [
    themeRow,
    el('div.set-row', {}, [el('div.grow', {}, [el('b', { text: 'Light / dark' }), el('small', { text: 'every palette has both' })]), modeSeg]),
    el('div.set-row', {}, [el('div.grow', {}, [el('b', { text: 'Graphics' }), el('small', { text: 'Lite turns off the frosted-glass blur — much lighter on older phones' })]), perfSeg]),
    toggleRow('Accent from cover art', 'recolour the whole UI from whatever is playing', 'artColor', (on) => {
      emit('artcolor', on);
    }),
    toggleRow('Animations', 'ambient drift, breathing artwork, staggered entrances', 'motion', (on) => applyMotion(on)),
    toggleRow('Background visualiser', 'a faint spectrum behind everything', 'bgViz', (on) => emit('bgviz', on)),
  ]));

  /* ── playback ── */
  root.append(group('Playback', [
    sliderRow('Crossfade', 'overlap the end of one track with the start of the next', 'crossfade',
      { min: 0, max: 12, step: 0.5, fmt: v => v ? `${v}s` : 'off', onInput: v => engine.setCrossfade(v) }),
    sliderRow('Playback speed', 'pitch stays correct', 'speed',
      { min: 0.5, max: 2, step: 0.05, fmt: v => `${v.toFixed(2)}×`, onInput: v => { engine.setSpeed(v); $('#speedLabel').textContent = `${v.toFixed(1)}×`; } }),
    toggleRow('Gapless preload', 'buffer the next track while this one plays', 'gapless'),
    toggleRow('Volume levelling', 'even out loud and quiet tracks', 'normalize', (on) => engine.setNormalize(on)),
    toggleRow('Preserve pitch when speeding up', 'off gives you the chipmunk effect', 'preservePitch', (on) => engine.setPreservePitch(on)),
    toggleRow('Show lyrics', 'reads .lrc files next to your audio', 'showLyrics'),
    toggleRow('Auto-scroll lyrics', 'follow the active line', 'scrollLyrics'),
    el('div.set-row', {}, [
      el('div.grow', {}, [el('b', { text: 'Equalizer' }), el('small', { text: state.settings.eqEnabled ? `On · ${state.settings.eqPreset}` : 'Off' })]),
      el('button.btn.sm', { onclick: openEQ }, [icon('eq'), 'Open']),
    ]),
  ]));

  /* ── listeners ── */
  const endpoint = el('input', { type: 'url', value: state.settings.presenceEndpoint || '', placeholder: 'https://your-worker.workers.dev/presence' });
  endpoint.addEventListener('change', () => {
    setSetting('presenceEndpoint', endpoint.value.trim());
    presence.failures = 0;
    presence._beat();
    toast(endpoint.value.trim() ? 'Presence endpoint saved' : 'Back to local counting');
  });
  const modeSegP = el('div.seg', {}, ['auto', 'local', 'off'].map(m =>
    el('button', { class: state.settings.presenceMode === m ? 'is-on' : '', text: m[0].toUpperCase() + m.slice(1),
      onclick: (e) => {
        setSetting('presenceMode', m);
        [...e.currentTarget.parentElement.children].forEach(b => b.classList.toggle('is-on', b.textContent.toLowerCase() === m));
        presence.failures = 0; presence._beat();
      } })));

  root.append(group('Listener count', [
    el('div.set-row', {}, [
      el('div.grow', {}, [
        el('b', { text: `Currently showing ${state.presence.online}` }),
        el('small', { text: state.presence.source === 'remote'
          ? 'Live global count from your endpoint.'
          : state.presence.source === 'off' ? 'Counting is switched off.'
          : 'Counting open tabs on this device. Add an endpoint below for a real global figure.' }),
      ]),
      modeSegP,
    ]),
    el('div.set-row', { style: { display: 'block' } }, [
      el('div.field', { style: { margin: 0 } }, [
        el('label', { text: 'Presence endpoint (optional)' }),
        endpoint,
        el('small', { html: 'Deploy <code>tools/presence-worker.js</code> to a free Cloudflare Worker and paste the URL here. It must return <code>{"online":N,"total":N}</code>.' }),
      ]),
    ]),
  ]));

  /* ── data ── */
  const storageRow = el('div.set-row', {}, [
    el('div.grow', {}, [el('b', { text: 'Storage' }), el('small', { text: 'measuring…' })]),
    el('button.btn.sm', { onclick: async () => { const ok = await persistStorage(); toast(ok ? 'Storage marked persistent' : 'Browser declined persistent storage'); } }, ['Make persistent']),
  ]);
  usage().then(({ used, quota }) => {
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    storageRow.querySelector('small').textContent = quota
      ? `${mb(used)} used of ${(quota / 1073741824).toFixed(1)} GB available — cached waveforms and imported files.`
      : 'Cached waveforms and any files you imported.';
  });

  root.append(group('Your data', [
    toggleRow('Confirm before deleting', 'ask first when clearing queues and playlists', 'confirmDelete'),
    storageRow,
    el('div.set-row', {}, [
      el('div.grow', {}, [el('b', { text: 'Export everything' }), el('small', { text: 'playlists, favourites, marks, stats — one JSON file' })]),
      el('button.btn.sm', { onclick: exportStats }, [icon('download'), 'Export']),
    ]),
    el('div.set-row', {}, [
      el('div.grow', {}, [el('b', { text: 'Import data' }), el('small', { text: 'restore from an exported file' })]),
      el('button.btn.sm', { onclick: importData }, [icon('folder'), 'Import']),
    ]),
    el('div.set-row', {}, [
      el('div.grow', {}, [el('b', { text: 'Reset everything' }), el('small', { text: 'clears settings, playlists, stats and cached waveforms' })]),
      el('button.btn.sm.danger', {
        onclick: async () => {
          if (await confirm({ title: 'Reset AURA?', sub: 'Every playlist, favourite, mark and statistic is erased. Your audio files are untouched.', confirmLabel: 'Erase everything', danger: true })) {
            await nuke();
            Object.keys(localStorage).filter(k => k.startsWith('aura:')).forEach(k => localStorage.removeItem(k));
            location.reload();
          }
        },
      }, [icon('trash'), 'Reset']),
    ]),
  ]));

  /* ── about ── */
  root.append(group('About', [
    el('div.set-row', { style: { display: 'block' } }, [
      el('b', { text: 'AURA' }),
      el('small', { style: { marginTop: '6px' }, html:
        'A private, offline-first music player. No account, no server, no telemetry — the library, your playlists and every statistic live in this browser. ' +
        'Add music by dropping files onto the window, or by putting them in <code>audio/</code> and running <code>node tools/build-manifest.mjs</code>.' }),
      el('div.row', { style: { marginTop: '14px', flexWrap: 'wrap' } }, [
        el('button.btn.sm', { onclick: openHelp }, [icon('keyboard'), 'Keyboard shortcuts']),
        el('button.btn.sm', { onclick: () => { setView('lab'); } }, [icon('lab'), 'Open the Lab']),
      ]),
    ]),
  ]));
};

function importData() {
  const input = el('input', { type: 'file', accept: 'application/json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.favorites) state.favorites = new Set(data.favorites);
      if (data.playlists) state.playlists = data.playlists;
      if (data.marks) state.marks = data.marks;
      if (data.stats) state.stats = data.stats;
      if (data.echo) state.echo = data.echo;
      if (data.recent) state.recent = data.recent;
      persist.all();
      toast('Imported — reloading');
      setTimeout(() => location.reload(), 700);
    } catch {
      toast('That file could not be read', { error: true });
    }
  });
  input.click();
}

/* ═══════════════════════════════════════════════════════════
   DIALOGS: EQ · vocal · speed · sleep · vibe card · mood DJ
   ═══════════════════════════════════════════════════════════ */

export function openEQ() {
  const body = el('div.eq-panel');

  const enableRow = el('div.set-row', {}, [
    el('div.grow', {}, [el('b', { text: 'Equalizer' }), el('small', { text: 'ten bands, applied live' })]),
    (() => {
      const sw = el('div.switch', { class: state.settings.eqEnabled ? 'on' : '' });
      const w = el('div', { style: { cursor: 'pointer' }, onclick: () => {
        const on = !state.settings.eqEnabled;
        setSetting('eqEnabled', on);
        sw.classList.toggle('on', on);
        engine.setEQAll(on ? state.settings.eqGains : EQ_PRESETS.flat);
      } }, [sw]);
      return w;
    })(),
  ]);
  body.append(enableRow);

  const bands = el('div.eq-bands');
  const labels = [];
  EQ_BANDS.forEach((hz, i) => {
    const db = el('div.eq-db', { text: fmtDb(state.settings.eqGains[i]) });
    const slider = el('input.eq-slider', {
      type: 'range', min: '-12', max: '12', step: '0.5',
      value: String(state.settings.eqGains[i]),
      'aria-label': `${hz} hertz`,
    });
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      state.settings.eqGains[i] = v;
      setSetting('eqGains', state.settings.eqGains);
      setSetting('eqPreset', 'custom');
      db.textContent = fmtDb(v);
      if (state.settings.eqEnabled) engine.setEQ(i, v);
    });
    labels.push({ slider, db });
    bands.append(el('div.eq-band', {}, [db, slider, el('div.eq-hz', { text: hz >= 1000 ? (hz / 1000) + 'k' : String(hz) })]));
  });
  body.append(bands);

  const presets = el('div.preset-row');
  for (const name of Object.keys(EQ_PRESETS)) {
    presets.append(el('button.chip', {
      class: state.settings.eqPreset === name ? 'is-on' : '',
      text: name[0].toUpperCase() + name.slice(1),
      onclick: () => {
        const gains = [...EQ_PRESETS[name]];
        setSetting('eqGains', gains);
        setSetting('eqPreset', name);
        if (!state.settings.eqEnabled) { setSetting('eqEnabled', true); enableRow.querySelector('.switch').classList.add('on'); }
        engine.setEQAll(gains);
        gains.forEach((v, i) => { labels[i].slider.value = v; labels[i].db.textContent = fmtDb(v); });
        [...presets.children].forEach(c => c.classList.toggle('is-on', c.textContent.toLowerCase() === name));
      },
    }));
  }
  body.append(el('div', {}, [el('h4', { style: { fontSize: '12px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '10px' }, text: 'Presets' }), presets]));

  /* extra bass shelf */
  const bassVal = el('b.mono', { style: { color: 'var(--accent)', minWidth: '48px', textAlign: 'right' }, text: fmtDb(state.settings.bassBoost) });
  const bassIn = el('input.range', { type: 'range', min: '0', max: '14', step: '0.5', value: String(state.settings.bassBoost), style: { maxWidth: '200px' } });
  bassIn.addEventListener('input', () => {
    const v = parseFloat(bassIn.value);
    setSetting('bassBoost', v); bassVal.textContent = fmtDb(v); engine.setBass(v);
  });
  body.append(el('div.set-row', {}, [
    el('div.grow', {}, [el('b', { text: 'Extra bass' }), el('small', { text: 'a low shelf below 110 Hz, on top of the bands' })]),
    bassIn, bassVal,
  ]));

  sheet({
    title: 'Equalizer', sub: 'Changes are audible immediately — no need to restart the track.',
    body, wide: true,
    actions: [{ label: 'Reset to flat', run: () => {
      setSetting('eqGains', [...EQ_PRESETS.flat]); setSetting('eqPreset', 'flat');
      setSetting('bassBoost', 0); engine.setBass(0); engine.resetEQ();
      labels.forEach(l => { l.slider.value = 0; l.db.textContent = fmtDb(0); });
      bassIn.value = 0; bassVal.textContent = fmtDb(0);
      [...presets.children].forEach(c => c.classList.toggle('is-on', c.textContent === 'Flat'));
    } }, { label: 'Done', primary: true, run: closeModal }],
  });
}
const fmtDb = (v) => (v > 0 ? '+' : '') + Number(v).toFixed(1);

export function openVocal() {
  const val = el('b.mono', { style: { color: 'var(--accent)' }, text: Math.round(state.settings.vocal * 100) + '%' });
  const input = el('input.range', { type: 'range', min: '0', max: '1', step: '0.02', value: String(state.settings.vocal) });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    setSetting('vocal', v);
    engine.setVocal(v);
    val.textContent = Math.round(v * 100) + '%';
    $('#chipKaraoke')?.classList.toggle('is-on', v > 0.05);
  });
  sheet({
    title: 'Vocal isolate',
    sub: 'Removes whatever sits dead-centre in the stereo image — usually the lead vocal.',
    body: el('div', {}, [
      el('div.set-row', {}, [el('div.grow', {}, [el('b', { text: 'Amount' }), el('small', { text: '0% is the original mix, 100% is full karaoke' })]), input, val]),
      el('p.muted', { style: { fontSize: '12.5px', lineHeight: '1.65', marginTop: '10px' },
        text: 'How well this works depends on the mix. Anything else panned to the centre — kick, snare, bass — dips with the vocal. Mono recordings will go near-silent.' }),
    ]),
    actions: [
      { label: 'Off', run: () => { setSetting('vocal', 0); engine.setVocal(0); input.value = 0; val.textContent = '0%'; $('#chipKaraoke')?.classList.remove('is-on'); } },
      { label: 'Full karaoke', primary: true, run: () => { setSetting('vocal', 1); engine.setVocal(1); input.value = 1; val.textContent = '100%'; $('#chipKaraoke')?.classList.add('is-on'); } },
    ],
  });
}

export function openSpeed() {
  const val = el('b.mono', { style: { color: 'var(--accent)', minWidth: '58px', textAlign: 'right' }, text: state.settings.speed.toFixed(2) + '×' });
  const input = el('input.range', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(state.settings.speed) });
  const apply = (v) => {
    setSetting('speed', v); engine.setSpeed(v);
    val.textContent = v.toFixed(2) + '×';
    $('#speedLabel').textContent = v.toFixed(1) + '×';
    $('#chipSpeed')?.classList.toggle('is-on', Math.abs(v - 1) > 0.01);
  };
  input.addEventListener('input', () => apply(parseFloat(input.value)));
  const quick = el('div.preset-row', {}, [0.75, 1, 1.25, 1.5, 2].map(v =>
    el('button.chip', { text: v + '×', onclick: () => { input.value = v; apply(v); } })));

  sheet({
    title: 'Playback speed',
    body: el('div', {}, [
      el('div.set-row', {}, [el('div.grow', {}, [el('b', { text: 'Rate' })]), input, val]),
      quick,
      (() => {
        const on = state.settings.preservePitch;
        const sw = el('div.switch', { class: on ? 'on' : '' });
        return el('div.set-row', { style: { cursor: 'pointer', marginTop: '10px' }, onclick: () => {
          const n = !state.settings.preservePitch;
          setSetting('preservePitch', n); engine.setPreservePitch(n); sw.classList.toggle('on', n);
        } }, [el('div.grow', {}, [el('b', { text: 'Preserve pitch' }), el('small', { text: 'keeps the key correct at any speed' })]), sw]);
      })(),
    ]),
    actions: [{ label: 'Back to 1×', run: () => { input.value = 1; apply(1); } }, { label: 'Done', primary: true, run: closeModal }],
  });
}

export function openSleep() {
  const info = sleepTimer.info();
  const body = el('div');
  const status = el('p.muted', { style: { fontSize: '13px', marginBottom: '14px' },
    text: info.active
      ? (info.mode === 'track' ? 'Stopping at the end of this track.' : `Fading out in ${fmtTime(info.left)}.`)
      : 'No timer running.' });
  body.append(status);

  const row = el('div.preset-row');
  for (const m of [5, 15, 30, 45, 60, 90]) {
    row.append(el('button.chip', { text: `${m} min`, onclick: () => { sleepTimer.set(m); toast(`Sleeping in ${m} minutes`, { icon: 'moon' }); closeModal(); } }));
  }
  row.append(el('button.chip', { onclick: () => { sleepTimer.endOfTrack(); toast('Stopping after this track', { icon: 'moon' }); closeModal(); } }, [icon('mark'), 'End of track']));
  body.append(row);
  body.append(el('p.muted', { style: { fontSize: '12.5px', marginTop: '14px', lineHeight: '1.6' },
    text: 'The volume eases down over the final 30 seconds, so nothing cuts off mid-bar.' }));

  sheet({
    title: 'Sleep timer', body,
    actions: info.active ? [{ label: 'Cancel timer', danger: true, run: () => { sleepTimer.cancel(); toast('Sleep timer cancelled'); closeModal(); } }] : [],
  });
}

export async function openVibeCard() {
  const track = state.current;
  if (!track) { toast('Play something first', { error: true }); return; }

  const preview = el('img', { style: { width: '100%', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', aspectRatio: '1080/1350' }, alt: 'Vibe card preview' });
  const { box } = sheet({
    title: 'Vibe card', sub: 'A share-ready snapshot of what’s playing.',
    body: el('div', {}, [preview]),
    actions: [
      { label: 'Download PNG', icon: 'download', run: async () => { const cv = await build(); if (cv) { const b = await new Promise(r => cv.toBlob(r, 'image/png')); download(b, `aura-${track.title.replace(/\W+/g, '-').toLowerCase()}.png`); toast('Saved'); } } },
      { label: supports.share ? 'Share' : 'Copy', primary: true, icon: 'card', run: async () => { const cv = await build(); if (cv) { await shareVibeCard(cv, track); } } },
    ],
  });

  let cached = null;
  async function build() {
    if (cached) return cached;
    const { getPeaks } = await import('./analysis.js');
    const p = await getPeaks(track).catch(() => null);
    cached = await makeVibeCard(track, { peaks: p?.data || null });
    return cached;
  }
  const cv = await build();
  preview.src = cv.toDataURL('image/png');
}

export async function openMoodDJ() {
  if (!state.tracks.length) { toast('Add some music first', { error: true }); return; }

  let arcId = 'journey';
  let size = Math.min(20, state.tracks.length);
  let chosen = [];
  let emap = null;

  const canvas = el('canvas.mood-canvas');
  const listWrap = el('div', { style: { maxHeight: '32vh', overflow: 'auto', marginTop: '14px' } });
  const sizeVal = el('b.mono', { style: { color: 'var(--accent)', minWidth: '38px', textAlign: 'right' }, text: String(size) });

  const arcRow = el('div.preset-row', { style: { marginBottom: '14px' } });
  for (const a of ARCS) {
    arcRow.append(el('button.chip', {
      class: a.id === arcId ? 'is-on' : '', title: a.hint, text: a.name,
      onclick: (e) => {
        arcId = a.id;
        [...arcRow.children].forEach(c => c.classList.toggle('is-on', c.textContent === a.name));
        rebuild();
      },
    }));
  }

  const sizeInput = el('input.range', { type: 'range', min: '5', max: String(Math.max(5, Math.min(60, state.tracks.length))), step: '1', value: String(size), style: { maxWidth: '180px' } });
  sizeInput.addEventListener('input', () => { size = parseInt(sizeInput.value, 10); sizeVal.textContent = String(size); rebuild(); });

  const body = el('div', {}, [
    el('p.muted', { style: { fontSize: '13px', lineHeight: '1.6', marginBottom: '14px' },
      text: 'Every track gets an energy score — decoded from the audio when it has been analysed, guessed from its genre otherwise. Then the set is ordered to trace the curve you pick.' }),
    arcRow,
    canvas,
    el('div.set-row', { style: { marginTop: '12px' } }, [
      el('div.grow', {}, [el('b', { text: 'Set length' })]), sizeInput, sizeVal,
    ]),
    listWrap,
  ]);

  sheet({
    title: 'Mood DJ', sub: 'Build a set that goes somewhere.', body, wide: true,
    actions: [
      { label: 'Shuffle pool', icon: 'shuffle', run: rebuild },
      { label: 'Play this set', primary: true, icon: 'play', run: () => {
        if (!chosen.length) return;
        player.setQueue(chosen, 0, { label: `Mood DJ · ${ARCS.find(a => a.id === arcId).name}` });
        closeModal();
        toast(`${chosen.length}-track set queued`, { icon: 'wand' });
      } },
    ],
  });

  async function rebuild() {
    listWrap.innerHTML = '<p class="muted" style="font-size:13px">Scoring tracks…</p>';
    emap = emap || await energyMap(state.tracks);
    chosen = await buildMoodSet(state.tracks, arcId, size);
    drawMoodCurve(canvas, arcPreset(arcId, 48), chosen.map(t => emap.get(t.id) ?? 0.5));
    listWrap.innerHTML = '';
    chosen.forEach((t, i) => {
      const row = trackRow(t, { index: i, showPlays: false, onPlay: () => { player.setQueue(chosen, i); closeModal(); } });
      const e = Math.round((emap.get(t.id) ?? 0.5) * 100);
      row.querySelector('.t-right').prepend(el('div.t-badge', { text: `${e}` }));
      listWrap.append(row);
    });
  }
  rebuild();
}

/* ═══ keyboard help ════════════════════════════════════════ */
export function openHelp() {
  const keys = [
    ['Space', 'Play / pause'], ['K', 'Play / pause'], ['J / L', 'Back / forward 10s'],
    ['← / →', 'Back / forward 5s'], ['Shift + ← / →', 'Previous / next track'],
    ['↑ / ↓', 'Volume'], ['Shift + M', 'Mute'], ['S', 'Shuffle'], ['R', 'Repeat'],
    ['F', 'Favourite this track'], ['M', 'Drop a moment mark'], ['E', 'Full-screen player'],
    ['V', 'Cycle visualiser'], ['T', 'Theme picker'], ['/', 'Search'], ['1 – 7', 'Jump to a section'],
    ['0 – 9', 'Seek to 0–90%'], ['?', 'This list'], ['Esc', 'Close whatever is open'],
  ];
  sheet({
    title: 'Keyboard shortcuts', sub: 'Everything the mouse can do, faster.', wide: true,
    body: el('div.kbd-grid', {}, keys.map(([k, d]) =>
      el('div.kbd-row', {}, [el('span', { text: d }), el('kbd', { text: k })]))),
  });
}

/* ═══ view switching ═══════════════════════════════════════ */
export function setView(name) {
  if (!view(name)) return;
  set({ view: name }, 'view');
  $$('.view').forEach(v => v.classList.toggle('is-on', v.dataset.view === name));
  $$('.rail-btn[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === name));
  $$('.mnav-btn[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === name));
  renderView(name);
}

registerDialogs({ addToPlaylist: openAddToPlaylist, marks: openMarks });
export { openMarks, openAddToPlaylist };
