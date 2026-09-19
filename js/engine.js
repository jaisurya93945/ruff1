/* ═══════════════════════════════════════════════════════════
   AURA · engine — the Web Audio graph.

     deckA ─┐
            ├─▶ mixBus ─▶ vocal(mid/side) ─▶ EQ×10 ─▶ bass
     deckB ─┘                                          │
        ┌──────────────────────────────────────────────┘
        └─▶ dry ──────────────┬─▶ orbit(HRTF) ─▶ comp ─▶ analyser ─▶ master ─▶ out
            wet ─▶ convolver ─┘

   Two <audio> decks give us real crossfades and gapless
   hand-offs; everything downstream is shared.
   ═══════════════════════════════════════════════════════════ */
import { clamp, supports } from './util.js';

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = {
  flat:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass:      [7, 6, 4.5, 2.5, 0, -0.5, -1, -1, 0, 1],
  treble:    [-2, -2, -1.5, -0.5, 0, 1, 2.5, 4.5, 6, 6.5],
  vocal:     [-3, -2.5, -1, 1.5, 3.5, 4, 3, 1.5, 0, -1],
  lofi:      [4, 3, 1, 0, -1, -2.5, -4.5, -7, -9, -11],
  night:     [-4, -3, -1.5, 0, 1, 1.5, 0.5, -0.5, -2, -3],
  live:      [-1, 0, 1, 2, 2.5, 2, 1.5, 2, 2.5, 2],
  electronic:[6, 5, 1.5, 0, -1.5, 1.5, 0.5, 2, 5, 5.5],
  acoustic:  [3.5, 3, 2, 1, 1.5, 1, 2, 2.5, 2, 1],
  punch:     [2, 1, -1, -2.5, -1, 2, 4, 3.5, 2, 1.5],
};

class Engine extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.decks = [];
    this.active = 0;
    this.ready = false;
    this.bypass = false;        // true when Web Audio can't touch the stream (CORS)
    this._volume = 1;
    this._muted = false;
    this._crossfade = 0;
    this._fading = false;
    this._lastTimeEmit = 0;
    this._pendingSeek = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /* ── build the graph once ──────────────────────────────── */
  init() {
    if (this.ready) return this;

    for (let i = 0; i < 2; i++) {
      const a = new Audio();
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.volume = 1;
      this.decks.push({ audio: a, src: null, gain: null, node: null, track: null });
    }

    if (supports.audioCtx) {
      try { this._buildGraph(); }
      catch (err) { console.warn('[aura] Web Audio unavailable, falling back to plain playback', err); this.bypass = true; }
    } else {
      this.bypass = true;
    }

    this._wireDeckEvents();
    this.ready = true;
    return this;
  }

  _buildGraph() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new Ctx({ latencyHint: 'playback' });

    /* decks → mix bus */
    this.mixBus = ctx.createGain();
    for (const deck of this.decks) {
      deck.node = ctx.createMediaElementSource(deck.audio);
      deck.gain = ctx.createGain();
      deck.gain.gain.value = 0;
      deck.node.connect(deck.gain).connect(this.mixBus);
    }
    this.decks[0].gain.gain.value = 1;

    /* ── vocal isolation: mid/side re-encode ─────────────── */
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.midSum  = ctx.createGain();       // (L+R)/2
    this.sideSum = ctx.createGain();       // (L-R)/2
    this.midAtten = ctx.createGain();      // 1 - vocalKill
    this.midAtten.gain.value = 1;
    const sideInv = g(-1);

    this.mixBus.connect(split);
    this._msIn = { split, merge, sideInv, g };
    this._wireMidSide();

    /* ── 10-band EQ ───────────────────────────────────────── */
    this.eq = EQ_BANDS.map((hz, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = hz;
      f.Q.value = 1.1;
      f.gain.value = 0;
      return f;
    });
    let node = merge;
    for (const f of this.eq) node = node.connect(f);

    /* extra bass shelf, independent of the EQ sliders */
    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 110;
    this.bass.gain.value = 0;
    node = node.connect(this.bass);

    /* ── reverb: generated impulse, dry/wet ──────────────── */
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._impulse(2.4, 2.6);
    node.connect(this.dry);
    node.connect(this.convolver).connect(this.wet);

    /* ── orbit: HRTF panner circling the listener ────────── */
    this.orbit = ctx.createPanner();
    this.orbit.panningModel = 'HRTF';
    this.orbit.distanceModel = 'inverse';
    this.orbit.refDistance = 1;
    this.orbit.positionZ.value = 0;
    this.orbit.positionY.value = 0;
    this.orbit.positionX.value = 0;
    this._orbitOn = false;
    this._orbitOsc = null;

    this.orbitIn  = ctx.createGain();     // feeds the panner when orbit is on
    this.orbitOut = ctx.createGain();     // panner result
    this.direct   = ctx.createGain();     // straight-through when orbit is off
    this.direct.gain.value = 1;
    this.orbitIn.gain.value = 0;

    this.dry.connect(this.direct);  this.wet.connect(this.direct);
    this.dry.connect(this.orbitIn); this.wet.connect(this.orbitIn);
    this.orbitIn.connect(this.orbit).connect(this.orbitOut);

    /* ── tail: compressor → analyser → master ────────────── */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.compBypass = ctx.createGain();
    this.compBypass.gain.value = 1;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.analyser.minDecibels = -88;
    this.analyser.maxDecibels = -22;   // real music rarely nears 0 dBFS per-bin

    this.master = ctx.createGain();
    this.master.gain.value = this._volume;

    this.direct.connect(this.compBypass);
    this.orbitOut.connect(this.compBypass);
    this.compBypass.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
  }

  /** wire the mid/side network (kept separate for legibility) */
  _wireMidSide() {
    const { split, merge, sideInv, g } = this._msIn;
    const lToMid = g(0.5), rToMid = g(0.5);
    const lToSide = g(0.5), rToSide = g(-0.5);

    split.connect(lToMid, 0); split.connect(rToMid, 1);
    lToMid.connect(this.midSum); rToMid.connect(this.midSum);

    split.connect(lToSide, 0); split.connect(rToSide, 1);
    lToSide.connect(this.sideSum); rToSide.connect(this.sideSum);

    this.midSum.connect(this.midAtten);
    this.sideSum.connect(sideInv);

    // L = mid + side ; R = mid − side  → identity when midAtten = 1
    this.midAtten.connect(merge, 0, 0);
    this.sideSum.connect(merge, 0, 0);
    this.midAtten.connect(merge, 0, 1);
    sideInv.connect(merge, 0, 1);
  }

  /** synthesised impulse response — exponentially decaying stereo noise */
  _impulse(seconds = 2.4, decay = 2.6) {
    const ctx = this.ctx, rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /* ── deck events ───────────────────────────────────────── */
  _wireDeckEvents() {
    this.decks.forEach((deck, i) => {
      const a = deck.audio;
      a.addEventListener('timeupdate', () => {
        if (i !== this.active) return;
        const now = performance.now();
        if (now - this._lastTimeEmit < 90) return;      // ~11 Hz is plenty for the UI
        this._lastTimeEmit = now;
        this.emit('time', { time: a.currentTime, duration: a.duration || 0 });
        this._maybeCrossfade();
      });
      a.addEventListener('loadedmetadata', () => {
        if (i !== this.active) return;
        if (this._pendingSeek != null) { a.currentTime = this._pendingSeek; this._pendingSeek = null; }
        this.emit('loaded', { duration: a.duration || 0, track: deck.track });
      });
      a.addEventListener('progress', () => {
        if (i !== this.active) return;
        let buffered = 0;
        try { if (a.buffered.length) buffered = a.buffered.end(a.buffered.length - 1); } catch {}
        this.emit('progress', { buffered, duration: a.duration || 0 });
      });
      a.addEventListener('ended', () => { if (i === this.active && !this._fading) this.emit('ended', { track: deck.track }); });
      a.addEventListener('play',  () => { if (i === this.active) this.emit('play',  { track: deck.track }); });
      a.addEventListener('pause', () => { if (i === this.active && !this._fading) this.emit('pause', { track: deck.track }); });
      a.addEventListener('waiting', () => { if (i === this.active) this.emit('waiting'); });
      a.addEventListener('canplay', () => { if (i === this.active) this.emit('canplay'); });
      a.addEventListener('error', () => {
        if (i !== this.active) return;
        const code = a.error?.code;
        this.emit('error', { track: deck.track, code, message: this._errText(code) });
      });
    });
  }

  _errText(code) {
    return ({
      1: 'Playback was aborted.',
      2: 'Network dropped while loading this track.',
      3: 'This file could not be decoded.',
      4: 'This audio format is not supported here, or the file is missing.',
    })[code] || 'Could not play this track.';
  }

  /* ── transport ─────────────────────────────────────────── */
  get deck()    { return this.decks[this.active]; }
  get audio()   { return this.deck.audio; }
  get track()   { return this.deck.track; }
  get currentTime() { return this.audio.currentTime || 0; }
  get duration()    { return this.audio.duration || this.deck.track?.duration || 0; }
  get paused()      { return this.audio.paused; }

  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch {} }
  }

  /**
   * Load a track onto a deck.
   * @param {object} track  needs {src}
   * @param {{autoplay?:boolean, startAt?:number, crossfade?:number}} opts
   */
  async load(track, { autoplay = true, startAt = 0, crossfade = this._crossfade } = {}) {
    if (!track?.src) return;
    await this.resume();

    const useFade = crossfade > 0 && !this.bypass && !this.audio.paused && this.deck.track;
    const target = useFade ? (this.active ^ 1) : this.active;
    const deck = this.decks[target];

    // if this deck was already pre-warmed with the same src, keep the buffer
    if (deck.src !== track.src) {
      deck.audio.src = track.src;
      deck.src = track.src;
      deck.audio.load();
    }
    deck.track = track;
    deck.audio.playbackRate = this.audio.playbackRate || 1;
    if ('preservesPitch' in deck.audio) deck.audio.preservesPitch = this.audio.preservesPitch ?? true;

    if (startAt > 0) {
      if (deck.audio.readyState >= 1) deck.audio.currentTime = startAt;
      else this._pendingSeek = startAt;
    } else if (deck.audio.currentTime > 0.05) {
      deck.audio.currentTime = 0;
    }

    if (useFade) {
      await this._crossTo(target, crossfade, autoplay);
    } else {
      this.active = target;
      if (!this.bypass) {
        this.decks.forEach((d, i) => { if (d.gain) d.gain.gain.value = i === target ? 1 : 0; });
      }
      this.decks.forEach((d, i) => { if (i !== target) { d.audio.pause(); } });
      if (autoplay) await this._safePlay(deck.audio);
    }
    this.emit('trackchange', { track });
  }

  /** pre-buffer the *next* track on the idle deck — makes hand-offs gapless */
  preload(track) {
    if (!track?.src || this.bypass) return;
    const idle = this.decks[this.active ^ 1];
    if (idle.src === track.src) return;
    try {
      idle.audio.src = track.src;
      idle.src = track.src;
      idle.audio.load();
    } catch {}
  }

  async _crossTo(target, seconds, autoplay = true) {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const from = this.decks[this.active], to = this.decks[target];
    this._fading = true;
    this.active = target;

    if (autoplay) await this._safePlay(to.audio);

    // equal-power-ish ramps, clamped to something musical
    const d = clamp(seconds, 0.15, 12);
    from.gain.gain.cancelScheduledValues(t0);
    to.gain.gain.cancelScheduledValues(t0);
    from.gain.gain.setValueAtTime(from.gain.gain.value, t0);
    to.gain.gain.setValueAtTime(Math.max(to.gain.gain.value, 0.0001), t0);
    from.gain.gain.linearRampToValueAtTime(0, t0 + d);
    to.gain.gain.linearRampToValueAtTime(1, t0 + d);

    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => {
      from.audio.pause();
      try { from.audio.currentTime = 0; } catch {}
      this._fading = false;
    }, d * 1000 + 60);
  }

  /** near the end of the track? tell the app so it can hand over early */
  _maybeCrossfade() {
    if (this._crossfade <= 0 || this._fading || this.bypass) return;
    const a = this.audio;
    if (!a.duration || !Number.isFinite(a.duration)) return;
    const left = a.duration - a.currentTime;
    if (left <= this._crossfade && left > 0.05) {
      this._fading = true;                       // guard against repeat fires
      this.emit('nearend', { left, track: this.deck.track });
      setTimeout(() => { this._fading = false; }, 400);
    }
  }

  async _safePlay(audio) {
    try { await audio.play(); }
    catch (err) {
      if (err?.name === 'NotAllowedError') this.emit('blocked', { message: 'Tap play to start — the browser needs a gesture first.' });
      else if (err?.name !== 'AbortError') this.emit('error', { message: this._errText(4) });
    }
  }

  async play()  { await this.resume(); await this._safePlay(this.audio); }
  pause()       { this.audio.pause(); }
  async toggle(){ this.audio.paused ? await this.play() : this.pause(); }
  stop()        { this.audio.pause(); try { this.audio.currentTime = 0; } catch {} }

  seek(sec) {
    const d = this.duration;
    const t = clamp(sec, 0, d ? d - 0.05 : sec);
    try { this.audio.currentTime = t; } catch {}
    this.emit('time', { time: t, duration: d });
    this.emit('seek', { time: t });
  }
  nudge(delta) { this.seek(this.currentTime + delta); }

  /* ── mix controls ──────────────────────────────────────── */
  setVolume(v) {
    this._volume = clamp(v, 0, 1);
    const out = this._muted ? 0 : this._volume;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(out, t, 0.015);
    } else {
      this.decks.forEach(d => d.audio.volume = out);
    }
  }
  setMuted(m) { this._muted = !!m; this.setVolume(this._volume); }
  get volume() { return this._volume; }
  get muted()  { return this._muted; }

  /** smooth fade to a level over `sec` — used by the sleep timer */
  fadeTo(level, sec) {
    if (!this.master) { this.decks.forEach(d => d.audio.volume = level); return; }
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(Math.max(level, 0.0001), t + Math.max(sec, 0.05));
  }

  setSpeed(rate) {
    const r = clamp(rate, 0.25, 4);
    this.decks.forEach(d => {
      d.audio.playbackRate = r;
      if ('preservesPitch' in d.audio) d.audio.preservesPitch = this._preservePitch !== false;
    });
  }
  setPreservePitch(on) {
    this._preservePitch = !!on;
    this.decks.forEach(d => { if ('preservesPitch' in d.audio) d.audio.preservesPitch = !!on; });
  }
  setCrossfade(sec) { this._crossfade = clamp(sec || 0, 0, 12); }
  get crossfade()   { return this._crossfade; }

  /* ── effects ───────────────────────────────────────────── */
  setEQ(index, db) {
    if (!this.eq?.[index]) return;
    const t = this.ctx.currentTime;
    this.eq[index].gain.setTargetAtTime(clamp(db, -12, 12), t, 0.02);
  }
  setEQAll(gains) { gains.forEach((db, i) => this.setEQ(i, db)); }
  resetEQ() { this.setEQAll(EQ_PRESETS.flat); }

  setBass(db) {
    if (!this.bass) return;
    this.bass.gain.setTargetAtTime(clamp(db, -12, 14), this.ctx.currentTime, 0.03);
  }

  /** 0 = untouched, 1 = centre channel fully removed (karaoke) */
  setVocal(k) {
    if (!this.midAtten) return;
    this.midAtten.gain.setTargetAtTime(1 - clamp(k, 0, 1), this.ctx.currentTime, 0.04);
  }

  setReverb(k) {
    if (!this.wet) return;
    const w = clamp(k, 0, 1), t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(w * 0.55, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - w * 0.35, t, 0.05);
  }

  /** circle the listener — two quadrature LFOs drive the HRTF panner */
  setOrbit(on, speedHz = 0.18) {
    if (!this.orbit) return;
    const t = this.ctx.currentTime;
    if (on && !this._orbitOn) {
      const real = new Float32Array([0, 1]), imagZero = new Float32Array([0, 0]);
      const cosWave = this.ctx.createPeriodicWave(real, imagZero);
      const sinWave = this.ctx.createPeriodicWave(imagZero, real);

      const oscX = this.ctx.createOscillator(); oscX.setPeriodicWave(cosWave);
      const oscZ = this.ctx.createOscillator(); oscZ.setPeriodicWave(sinWave);
      const radius = this.ctx.createGain(); radius.gain.value = 2.6;
      const radius2 = this.ctx.createGain(); radius2.gain.value = 2.6;

      oscX.frequency.value = speedHz;
      oscZ.frequency.value = speedHz;
      oscX.connect(radius).connect(this.orbit.positionX);
      oscZ.connect(radius2).connect(this.orbit.positionZ);
      oscX.start(); oscZ.start();
      this._orbitOsc = { oscX, oscZ, radius, radius2 };

      this.orbitIn.gain.setTargetAtTime(1, t, 0.12);
      this.direct.gain.setTargetAtTime(0, t, 0.12);
      this._orbitOn = true;
    } else if (!on && this._orbitOn) {
      this.orbitIn.gain.setTargetAtTime(0, t, 0.12);
      this.direct.gain.setTargetAtTime(1, t, 0.12);
      setTimeout(() => {
        try { this._orbitOsc?.oscX.stop(); this._orbitOsc?.oscZ.stop(); } catch {}
        this._orbitOsc = null;
      }, 400);
      this._orbitOn = false;
    } else if (on && this._orbitOsc) {
      this._orbitOsc.oscX.frequency.setTargetAtTime(speedHz, t, 0.1);
      this._orbitOsc.oscZ.frequency.setTargetAtTime(speedHz, t, 0.1);
    }
  }
  get orbitOn() { return this._orbitOn; }

  setNormalize(on) {
    if (!this.comp) return;
    const t = this.ctx.currentTime;
    this.comp.threshold.setTargetAtTime(on ? -22 : -6, t, 0.05);
    this.comp.ratio.setTargetAtTime(on ? 6 : 1.2, t, 0.05);
  }

  /* ── analysis taps for the visualiser ──────────────────── */
  getFrequency() { if (!this.analyser) return null; this.analyser.getByteFrequencyData(this.freqData); return this.freqData; }
  getWaveform()  { if (!this.analyser) return null; this.analyser.getByteTimeDomainData(this.timeData); return this.timeData; }

  /** average energy 0..1 in a frequency slice, for beat detection */
  bandEnergy(loHz, hiHz) {
    const data = this.getFrequency();
    if (!data) return 0;
    const nyquist = this.ctx.sampleRate / 2;
    const lo = Math.max(0, Math.floor(loHz / nyquist * data.length));
    const hi = Math.min(data.length - 1, Math.ceil(hiHz / nyquist * data.length));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += data[i];
    return (sum / Math.max(1, hi - lo + 1)) / 255;
  }
}

export const engine = new Engine();
