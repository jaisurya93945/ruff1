/* ═══════════════════════════════════════════════════════════
   AURA · ui — the shared pieces every view leans on:
   toasts, modals, context menus, track rows, lazy images,
   the waveform (with its echo-heat overlay), and lyrics.
   ═══════════════════════════════════════════════════════════ */
import { $, $$, el, icon, fmtTime, fmtCount, clamp, lerp, fitCanvas, pointerRatio, haptic, debounce } from './util.js';
import { state, isFavorite, toggleFavorite, statFor, marksFor, addMark, removeMark, trackById } from './store.js';
import { player } from './player.js';
import { echoHeat } from './features.js';
import { placeholderPeaks } from './analysis.js';

/* ═══ toasts ═══════════════════════════════════════════════ */
const toastHost = () => $('#toasts');

export function toast(text, { icon: ico = 'check', error = false, ms = 2600, action = null } = {}) {
  const host = toastHost();
  if (!host) return;
  // collapse an identical message that's still on screen
  const dupe = [...host.children].find(c => c.dataset.text === text);
  if (dupe) { dupe.style.animation = 'none'; void dupe.offsetWidth; dupe.style.animation = ''; return dupe; }

  const node = el('div.toast', { class: error ? 'err' : '', dataset: { text } }, [
    icon(error ? 'close' : ico),
    el('span', { text }),
    action && el('button', { text: action.label, onclick: () => { action.run?.(); dismiss(); } }),
  ]);
  host.append(node);

  const timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  }
  node.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') dismiss(); });
  while (host.children.length > 3) host.firstChild.remove();
  return node;
}

/* ═══ modal ════════════════════════════════════════════════ */
let modalCleanup = null;

export function modal(content, { wide = false, onClose = null } = {}) {
  const root = $('#modalRoot');
  root.hidden = false;
  root.innerHTML = '';
  const box = el('div.modal', { class: wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true' });
  box.append(content);
  root.append(box);

  const close = () => closeModal();
  modalCleanup = () => { onClose?.(); };
  root.onclick = (e) => { if (e.target === root) close(); };
  document.addEventListener('keydown', modalKey);
  // focus a text field if there is one; never grab focus onto a button,
  // which just paints a focus ring the moment the sheet opens
  setTimeout(() => box.querySelector('input:not([type=range]),textarea,select')?.focus(), 60);
  return { close, box };
}

function modalKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } }

export function closeModal() {
  const root = $('#modalRoot');
  if (!root || root.hidden) return;
  root.hidden = true;
  root.innerHTML = '';
  document.removeEventListener('keydown', modalKey);
  modalCleanup?.(); modalCleanup = null;
}
export const modalOpen = () => !$('#modalRoot')?.hidden;

/** a titled modal with footer buttons; returns the box for further wiring */
export function sheet({ title, sub, body, actions = [], wide = false }) {
  const frag = el('div');
  frag.append(el('div.modal-head', {}, [
    el('div', {}, [el('h3', { text: title }), sub && el('p', { text: sub })]),
    el('button.icon-btn', { onclick: closeModal, 'aria-label': 'Close' }, [icon('close')]),
  ]));
  if (body) frag.append(body);
  if (actions.length) {
    frag.append(el('div.modal-foot', {}, actions.map(a =>
      el('button.btn', {
        class: a.primary ? 'primary' : a.danger ? 'danger' : '',
        onclick: () => a.run?.(),
      }, [a.icon && icon(a.icon), a.label]))));
  }
  return modal(frag, { wide });
}

export function confirm({ title, sub, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); closeModal(); } };
    sheet({
      title, sub,
      actions: [
        { label: 'Cancel', run: () => done(false) },
        { label: confirmLabel, primary: !danger, danger, run: () => done(true) },
      ],
    });
    $('#modalRoot').addEventListener('click', function once(e) {
      if (e.target.id === 'modalRoot') { done(false); e.currentTarget.removeEventListener('click', once); }
    });
  });
}

/* ═══ context menu ═════════════════════════════════════════ */
export function contextMenu(items, x, y) {
  const menu = $('#ctxMenu');
  menu.innerHTML = '';
  menu.hidden = false;

  for (const item of items) {
    if (item === '-') { menu.append(el('div.ctx-sep')); continue; }
    if (item.label && !item.run) { menu.append(el('div.ctx-label', { text: item.label })); continue; }
    menu.append(el('button.ctx-item', {
      class: item.danger ? 'danger' : '',
      onclick: () => { closeContext(); item.run?.(); },
    }, [item.icon && icon(item.icon), el('span.grow', { text: item.label }), item.hint && el('kbd', { text: item.hint })]));
  }

  // keep it on screen
  menu.style.left = '0px'; menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  menu.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px';
  menu.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';

  setTimeout(() => {
    document.addEventListener('click', closeContext, { once: true });
    document.addEventListener('scroll', closeContext, { once: true, capture: true });
    document.addEventListener('keydown', ctxKey);
  }, 0);
}
function ctxKey(e) { if (e.key === 'Escape') closeContext(); }
export function closeContext() {
  const m = $('#ctxMenu');
  if (m) { m.hidden = true; m.innerHTML = ''; }
  document.removeEventListener('keydown', ctxKey);
}

/* ═══ lazy images ══════════════════════════════════════════ */
const FALLBACK_ART = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23554"/><stop offset="1" stop-color="%23332"/></linearGradient></defs><rect width="64" height="64" fill="url(%23g)"/><path d="M26 44V22l16-3v22" fill="none" stroke="%23fff" stroke-opacity=".45" stroke-width="2.4"/><circle cx="23" cy="44" r="4" fill="%23fff" fill-opacity=".45"/><circle cx="39" cy="41" r="4" fill="%23fff" fill-opacity=".45"/></svg>`);

const lazyObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        obs.unobserve(img);
        loadImg(img, img.dataset.src);
      }
    }, { rootMargin: '360px 0px', threshold: 0.01 })
  : null;

function loadImg(img, src) {
  if (!src) { img.src = FALLBACK_ART; img.classList.add('ready'); return; }
  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = () => { img.src = src; img.classList.add('ready'); };
  probe.onerror = () => { img.src = FALLBACK_ART; img.classList.add('ready'); };
  probe.src = src;
}

/** an <img> that only fetches once it's near the viewport */
export function lazyImg(src, alt = '', cls = '') {
  const img = el('img.lazy-img', { alt, class: cls, decoding: 'async', loading: 'lazy' });
  img.dataset.src = src || '';
  img.src = FALLBACK_ART;
  if (lazyObserver) lazyObserver.observe(img);
  else loadImg(img, src);
  return img;
}
export { FALLBACK_ART };

/* ═══ track row ════════════════════════════════════════════ */

/**
 * @param {object} track
 * @param {{index?:number, context?:Array, onPlay?:Function, showPlays?:boolean,
 *          draggable?:boolean, onReorder?:Function, extraMenu?:Array, queueIndex?:number}} opts
 */
export function trackRow(track, opts = {}) {
  const { index = 0, context = null, showPlays = true, draggable = false, queueIndex = null } = opts;
  const st = statFor(track.id);
  const isCurrent = state.current?.id === track.id;

  const row = el('div.track', {
    class: isCurrent ? 'is-current' : '',
    dataset: { id: track.id, index: String(index) },
    tabindex: '0',
    role: 'button',
    'aria-label': `${track.title} by ${track.artist}`,
  });

  /* index / now-playing bars */
  const idxWrap = el('div.t-idx-wrap');
  idxWrap.append(
    isCurrent
      ? el('div.eq-bars', {}, [el('i'), el('i'), el('i')])
      : el('span.t-idx', { text: String(index + 1) }),
    el('span.t-play', {}, [icon('play')]),
  );

  const art = lazyImg(track.cover, '', 't-art');

  const main = el('div.t-main', {}, [
    el('div.t-title', { text: track.title, title: track.title }),
    el('div.t-sub', { text: [track.artist, track.album].filter(Boolean).join(' · '), title: track.artist }),
  ]);

  const right = el('div.t-right');
  if (showPlays && st.plays > 0) {
    right.append(el('div.t-plays', { title: `${st.plays} plays` }, [icon('fire'), String(st.plays)]));
  }
  if (marksFor(track.id).length) {
    right.append(el('div.t-plays', { title: `${marksFor(track.id).length} moment marks` }, [icon('mark')]));
  }
  right.append(el('div.t-dur.mono', { text: fmtTime(track.duration || 0) }));

  const fav = el('button.icon-btn.tiny.t-act', {
    class: isFavorite(track.id) ? 'is-on' : '',
    title: 'Favourite',
    onclick: (e) => {
      e.stopPropagation();
      const on = toggleFavorite(track.id);
      fav.classList.toggle('is-on', on);
      haptic(8);
    },
  }, [icon('heart')]);
  const more = el('button.icon-btn.tiny.t-act', {
    title: 'More',
    onclick: (e) => { e.stopPropagation(); openTrackMenu(track, e.clientX, e.clientY, opts); },
  }, [icon('more')]);
  right.append(fav, more);

  row.append(idxWrap, art, main, right);

  /* interactions */
  const play = () => {
    if (state.current?.id === track.id) { player.toggle(); return; }
    if (opts.onPlay) opts.onPlay(track, index);
    else if (context) player.setQueue(context, index);
    else player.setQueue([track], 0);
  };
  row.addEventListener('click', play);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openTrackMenu(track, e.clientX, e.clientY, opts);
  });

  /* long-press → menu, on touch */
  let pressTimer;
  row.addEventListener('touchstart', (e) => {
    pressTimer = setTimeout(() => {
      haptic(18);
      const t = e.touches[0];
      openTrackMenu(track, t.clientX, t.clientY, opts);
    }, 520);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev =>
    row.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

  if (draggable) makeDraggable(row, opts.onReorder, queueIndex ?? index);
  return row;
}

function openTrackMenu(track, x, y, opts = {}) {
  const items = [
    { label: track.title },
    { label: 'Play now', icon: 'play', run: () => opts.context ? player.setQueue(opts.context, opts.index || 0) : player.setQueue([track], 0) },
    { label: 'Play next', icon: 'queue', run: () => player.playNext(track) },
    { label: 'Add to queue', icon: 'plus', run: () => player.enqueue(track) },
    '-',
    { label: isFavorite(track.id) ? 'Remove favourite' : 'Add to favourites', icon: 'heart', run: () => { toggleFavorite(track.id); opts.onChange?.(); } },
    { label: 'Add to playlist…', icon: 'playlist', run: () => openAddToPlaylist(track) },
  ];
  if (marksFor(track.id).length) {
    items.push({ label: `Moment marks (${marksFor(track.id).length})`, icon: 'mark', run: () => openMarks(track) });
  }
  if (opts.extraMenu?.length) items.push('-', ...opts.extraMenu);
  contextMenu(items, x, y);
}

/* set by views.js at boot — keeps ui.js from importing views.js */
let addToPlaylistImpl = null, marksImpl = null;
export function registerDialogs({ addToPlaylist, marks }) { addToPlaylistImpl = addToPlaylist; marksImpl = marks; }
const openAddToPlaylist = (t) => addToPlaylistImpl?.(t);
const openMarks = (t) => marksImpl?.(t);

/* ═══ drag to reorder ══════════════════════════════════════ */
function makeDraggable(row, onReorder, index) {
  row.draggable = true;
  row.dataset.pos = String(index);

  row.addEventListener('dragstart', (e) => {
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    $$('.track').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = row.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const r = row.getBoundingClientRect();
    let to = index;
    if (e.clientY > r.top + r.height / 2) to = index + (from < index ? 0 : 1);
    else to = index - (from < index ? 1 : 0);
    row.classList.remove('drop-before', 'drop-after');
    if (Number.isInteger(from) && from !== to) onReorder?.(from, clamp(to, 0, 9999));
  });
}

/* ═══ waveform + echo heat ═════════════════════════════════ */

export class WaveformView {
  constructor(wrap, canvas, headEl, marksEl, tipEl) {
    this.wrap = wrap;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.head = headEl;
    this.marksEl = marksEl;
    this.tip = tipEl;
    this.peaks = null;
    this.heat = null;
    this.duration = 0;
    this.progress = 0;
    this.loading = false;
    this.seeking = false;
    this._bind();
  }

  setPeaks(peaks, duration) {
    this.peaks = peaks?.data || peaks || null;
    if (duration) this.duration = duration;
    this.draw();
  }
  setPlaceholder(seed) { this.peaks = placeholderPeaks(seed); this.loading = true; this.draw(); }
  setHeat(heat) { this.heat = heat; this.draw(); }
  setProgress(ratio) {
    this.progress = clamp(ratio, 0, 1);
    if (this.head) this.head.style.left = (this.progress * 100).toFixed(3) + '%';
    this.draw();
  }
  setMarks(marks, duration, onJump, onDelete) {
    if (!this.marksEl) return;
    this.marksEl.innerHTML = '';
    const d = duration || this.duration || 1;
    for (const m of marks) {
      const i = el('i', { style: { left: (clamp(m / d, 0, 1) * 100).toFixed(3) + '%' }, title: `Jump to ${fmtTime(m)} — right-click to remove` });
      i.style.pointerEvents = 'auto';
      i.style.cursor = 'pointer';
      i.addEventListener('click', (e) => { e.stopPropagation(); onJump?.(m); });
      i.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); onDelete?.(m); });
      this.marksEl.append(i);
    }
  }

  _bind() {
    const seekTo = (ev) => {
      const r = pointerRatio(ev, this.wrap);
      this.setProgress(r);
      return r;
    };
    const commit = (ev) => {
      const r = seekTo(ev);
      player.seek(r * (this.duration || player_duration()));
    };

    this.wrap.addEventListener('pointerdown', (e) => {
      this.seeking = true;
      this.wrap.setPointerCapture?.(e.pointerId);
      seekTo(e);
    });
    this.wrap.addEventListener('pointermove', (e) => {
      if (this.seeking) { seekTo(e); this._showTip(e); }
      else if (e.pointerType === 'mouse') this._showTip(e);
    });
    this.wrap.addEventListener('pointerup', (e) => {
      if (!this.seeking) return;
      this.seeking = false;
      commit(e);
      this._hideTip();
    });
    this.wrap.addEventListener('pointercancel', () => { this.seeking = false; this._hideTip(); });
    this.wrap.addEventListener('pointerleave', () => { if (!this.seeking) this._hideTip(); });
    window.addEventListener('resize', debounce(() => this.draw(), 140));
  }

  _showTip(ev) {
    if (!this.tip) return;
    const r = pointerRatio(ev, this.wrap);
    const d = this.duration || player_duration();
    this.tip.hidden = false;
    this.tip.textContent = fmtTime(r * d);
    this.tip.style.left = (r * 100).toFixed(2) + '%';
  }
  _hideTip() { if (this.tip) this.tip.hidden = true; }

  draw() {
    const { canvas, ctx } = this;
    if (!canvas.isConnected) return;
    const { w, h, dpr } = fitCanvas(canvas, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = w / dpr, H = h / dpr;
    ctx.clearRect(0, 0, W, H);
    if (!this.peaks?.length) return;

    const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
    const accent = css('--accent', '#ff7eb6');
    const accent2 = css('--accent-2', '#ffa8d2');
    const dim = css('--stroke-2', '#4a3a52');

    const pairs = this.peaks.length / 2;
    const barW = 2.5, gap = 1.2;
    const n = Math.max(24, Math.floor(W / (barW + gap)));
    const mid = H / 2;
    const playedX = this.progress * W;

    /* echo heat sits behind the bars */
    if (this.heat) {
      for (let i = 0; i < n; i++) {
        const hv = this.heat[Math.floor(i / n * this.heat.length)] || 0;
        if (hv < 0.06) continue;
        const x = i * (barW + gap);
        ctx.fillStyle = accent;
        ctx.globalAlpha = hv * 0.3;
        ctx.fillRect(x - gap / 2, 0, barW + gap, H);
      }
      ctx.globalAlpha = 1;
    }

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, accent2);

    for (let i = 0; i < n; i++) {
      const src = Math.floor(i / n * pairs);
      const lo = this.peaks[src * 2], hi = this.peaks[src * 2 + 1];
      const amp = Math.max(Math.abs(lo), Math.abs(hi));
      const bh = Math.max(2, amp * (H - 6));
      const x = i * (barW + gap);
      ctx.fillStyle = x + barW <= playedX ? grad : dim;
      ctx.globalAlpha = this.loading ? 0.35 : (x + barW <= playedX ? 1 : 0.55);
      roundBar(ctx, x, mid - bh / 2, barW, bh, barW / 2);
    }
    ctx.globalAlpha = 1;
  }
}

function roundBar(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

const player_duration = () => state.duration || state.current?.duration || 0;

/* ═══ lyrics ═══════════════════════════════════════════════ */

export class LyricsView {
  constructor(node) {
    this.node = node;
    this.lines = null;
    this.active = -1;
    this.userScrolled = false;
    let t;
    node.addEventListener('scroll', () => {
      this.userScrolled = true;
      clearTimeout(t);
      t = setTimeout(() => { this.userScrolled = false; }, 3200);
    }, { passive: true });
  }

  set(lines) {
    this.lines = lines;
    this.active = -1;
    this.node.innerHTML = '';

    if (!lines?.length) {
      this.node.append(el('div.ly-empty', {}, [
        el('b', { text: 'No lyrics for this one.' }),
        el('p', { html: 'Drop a <code>.lrc</code> file next to the mp3 (same name) or import it with the track — synced lyrics light up line by line.' }),
      ]));
      return;
    }

    const synced = lines[0].t >= 0;
    lines.forEach((line, i) => {
      const node = el('div.ly-line', { text: line.text || '♪', dataset: { i: String(i) } });
      if (synced) node.addEventListener('click', () => player.seek(Math.max(0, line.t - 0.15)));
      this.node.append(node);
    });
    if (!synced) this.node.classList.add('unsynced');
    else this.node.classList.remove('unsynced');
  }

  update(time) {
    if (!this.lines?.length || this.lines[0].t < 0) return;
    let idx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].t <= time + 0.12) idx = i; else break;
    }
    if (idx === this.active) return;
    this.active = idx;

    const kids = this.node.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('on', i === idx);
      kids[i].classList.toggle('past', i < idx);
    }
    if (idx >= 0 && !this.userScrolled && state.settings.scrollLyrics) {
      kids[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

/* ═══ misc ═════════════════════════════════════════════════ */

export function emptyState(iconName, title, body, action) {
  return el('div.empty', {}, [
    icon(iconName),
    el('b', { text: title }),
    el('p', { html: body }),
    action && el('button.btn.primary', { onclick: action.run }, [action.icon && icon(action.icon), action.label]),
  ]);
}

/** stagger children in on first paint */
export function stagger(container) {
  container.classList.add('stagger');
  [...container.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 18))));
  return container;
}

export function sectionHead(title, sub, tools = []) {
  return el('div.sec-head', {}, [
    el('div', {}, [el('h2', { text: title }), sub && el('p', { text: sub })]),
    tools.length && el('div.sec-tools', {}, tools),
  ]);
}

export function statTile(label, value, sub) {
  return el('div.stat', {}, [
    el('div.stat-k', { text: label }),
    el('div.stat-v', { text: value }),
    sub && el('div.stat-s', { text: sub }),
  ]);
}
