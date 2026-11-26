'use strict';
// PokeVault interface sounds. All of them are synthesised here with the Web Audio API
// (no audio files), so they are original sounds made in a "handheld menu" style.
(() => {
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('pv.muted') === '1'; } catch { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers only allow sound after the first click or key press.
  const unlock = () => { ensure(); musicUpdate(); };
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });

  // One enveloped oscillator note, optionally sliding in pitch.
  function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.5, to = null, attack = 0.005 } = {}) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  // A short burst of filtered noise (for clicks and whooshes).
  function noise({ at = 0, dur = 0.08, from = 3000, to = 800, q = 1.2, gain = 0.3 } = {}) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + at;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }


  // ---------------- background music ----------------
  // An original, procedurally written calm piece (soft pads, a round bass and little bell melodies),
  // generated live so it never loops exactly the same way. Not taken from any game soundtrack.
  const BPM = 76, BEAT = 60 / BPM, BAR = BEAT * 4;
  // Gmaj9 · A6 · F#m7 · Bm9 · Em9 · A13sus · Dmaj9 · D6 — two bars each.
  const CHORDS = [
    [43, [55, 59, 62, 66, 69]], [45, [57, 61, 64, 66, 69]], [42, [54, 57, 61, 64, 69]], [47, [54, 59, 62, 66, 73]],
    [40, [55, 59, 62, 66, 71]], [45, [55, 59, 62, 64, 66]], [38, [54, 57, 61, 64, 66]], [38, [54, 57, 59, 62, 66]],
  ];
  const SCALE = [74, 76, 78, 81, 83, 86, 88, 90]; // D major pentatonic, upper register
  const hz = n => 440 * 2 ** ((n - 69) / 12);
  const mus = { on: true, paused: false, out: null, wet: null, timer: null, next: 0, step: 0, mel: 2, silentSince: 0 };
  try { mus.on = localStorage.getItem('pv.music') !== '0'; } catch { /* ignore */ }
  const audible = () => mus.on && !mus.paused && !muted && !document.hidden;

  function musicGraph(c) {
    if (mus.out) return;
    mus.out = c.createGain(); mus.out.gain.value = 0.0001; mus.out.connect(c.destination);
    // a soft room: generated stereo impulse, so the bells ring out
    const len = Math.floor(c.sampleRate * 2.8), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2; }
    const rev = c.createConvolver(); rev.buffer = ir;
    mus.wet = c.createGain(); mus.wet.gain.value = 0.55;
    mus.wet.connect(rev).connect(mus.out);
  }
  function voice(c, t, { freq, type = 'sine', dur, gain, attack = 0.01, release = null, detune = 0, cutoff = 0, wet = 0.3, pan = 0 }) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    let node = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; node.connect(f); node = f; }
    const p = c.createStereoPanner(); p.pan.value = pan;
    node.connect(g).connect(p);
    p.connect(mus.out); if (wet) { const w = c.createGain(); w.gain.value = wet; p.connect(w).connect(mus.wet); }
    const rel = release ?? dur * 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur - rel), rel / 3);
    o.start(t); o.stop(t + dur + rel + 0.1);
  }
  const bell = (c, t, n, v = 1, pan = 0) => {
    voice(c, t, { freq: hz(n), dur: 1.6, gain: 0.055 * v, attack: 0.004, release: 1.4, wet: 0.7, pan });
    voice(c, t, { freq: hz(n) * 3.01, dur: 0.35, gain: 0.012 * v, attack: 0.002, release: 0.3, wet: 0.6, pan });
  };
  // one eighth-note step of music at time t
  function musicStep(c, t, step) {
    const bar = Math.floor(step / 8), e = step % 8, [root, tones] = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const firstBar = bar % 2 === 0;
    if (e === 0 && firstBar) {
      tones.slice(0, 4).forEach((n, i) => {
        voice(c, t, { freq: hz(n), type: 'triangle', dur: BAR * 2, gain: 0.022, attack: 1.1, release: 1.6, detune: -6, cutoff: 1300, wet: 0.5, pan: -0.35 + i * 0.23 });
        voice(c, t, { freq: hz(n), type: 'sine', dur: BAR * 2, gain: 0.02, attack: 1.3, release: 1.6, detune: 7, wet: 0.5, pan: 0.35 - i * 0.23 });
      });
    }
    if (e === 0) voice(c, t, { freq: hz(root), type: 'sine', dur: BEAT * 2.6, gain: 0.11, attack: 0.03, release: 0.9, wet: 0.1 });
    if (e === 5 && Math.random() < 0.6) voice(c, t, { freq: hz(root + 12), type: 'sine', dur: BEAT * 1.2, gain: 0.05, attack: 0.03, release: 0.5, wet: 0.1 });
    // gentle plucked arpeggio through the chord
    if (e % 2 === 0 || Math.random() < 0.25) {
      const n = tones[(e + (firstBar ? 0 : 2)) % tones.length] + 12;
      voice(c, t, { freq: hz(n), type: 'triangle', dur: 0.5, gain: 0.02, attack: 0.006, release: 0.45, cutoff: 2600, wet: 0.45, pan: e % 4 ? 0.3 : -0.3 });
    }
    // a wandering bell melody, resting at the end of each four-bar phrase
    const phraseEnd = bar % 4 === 3 && e >= 4;
    const chance = e === 0 ? 0.75 : e % 2 === 0 ? 0.45 : 0.18;
    if (!phraseEnd && Math.random() < chance) {
      mus.mel = Math.max(0, Math.min(SCALE.length - 1, mus.mel + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
      let n = SCALE[mus.mel];
      if (e === 0) n = tones.map(x => x + 24).reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a); // land on a chord tone
      bell(c, t, n, e === 0 ? 1 : 0.75, (Math.random() - 0.5) * 0.5);
    }
  }
  function musicTick() {
    const c = ctx; if (!c) return;
    if (!audible()) {
      if (performance.now() - mus.silentSince > 3000) { clearInterval(mus.timer); mus.timer = null; }
      return;
    }
    if (mus.next < c.currentTime) mus.next = c.currentTime + 0.1;
    while (mus.next < c.currentTime + 0.5) { musicStep(c, mus.next, mus.step++); mus.next += BEAT / 2; }
  }
  function musicUpdate() {
    const c = ctx; if (!c) return;
    musicGraph(c);
    const t = c.currentTime;
    mus.out.gain.cancelScheduledValues(t);
    mus.out.gain.setValueAtTime(Math.max(0.0001, mus.out.gain.value), t);
    if (audible()) {
      mus.out.gain.exponentialRampToValueAtTime(0.5, t + 1.8);
      if (!mus.timer) { mus.next = t + 0.15; mus.step = 0; mus.timer = setInterval(musicTick, 100); }
    } else {
      mus.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      mus.silentSince = performance.now();
    }
  }
  document.addEventListener('visibilitychange', musicUpdate);

  let lastTick = 0;
  window.sfx = {
    get muted() { return muted; },
    // The shared audio output (for the Meadow's cries and battle sounds); null until sound is allowed.
    audio() { const c = ensure(); return c ? { ctx: c, master } : null; },
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem('pv.muted', muted ? '1' : '0'); } catch { /* ignore */ }
      musicUpdate();
    },
    // Background music: on/off (remembered) and paused while another scene has its own sound (the Meadow).
    get musicOn() { return mus.on; },
    setMusic(v) {
      mus.on = !!v;
      try { localStorage.setItem('pv.music', mus.on ? '1' : '0'); } catch { /* ignore */ }
      musicUpdate();
    },
    pauseMusic(v) { if (mus.paused !== !!v) { mus.paused = !!v; musicUpdate(); } },
    // Opening the Pokémon menu: a soft two-note pop.
    menu() {
      tone(740, { dur: 0.06, type: 'sine', gain: 0.32 });
      tone(1108.7, { at: 0.05, dur: 0.1, type: 'sine', gain: 0.28 });
      noise({ dur: 0.02, from: 5000, to: 3500, gain: 0.05 });
    },
    // Backing out of a menu or page: a soft falling blip.
    back() {
      tone(988, { dur: 0.09, type: 'sine', gain: 0.3, to: 587 });
      tone(494, { at: 0.04, dur: 0.08, type: 'triangle', gain: 0.1 });
    },
    // Turning to the next Pokémon on the summary: a light swish and a bell.
    page() {
      noise({ dur: 0.13, from: 1800, to: 5200, q: 0.9, gain: 0.14 });
      tone(1318.5, { at: 0.06, dur: 0.22, type: 'sine', gain: 0.16 });
    },
    // Opening the summary page: a bright shimmering rise.
    sheet() {
      noise({ dur: 0.22, from: 900, to: 6000, q: 0.7, gain: 0.12 });
      [587.33, 880, 1174.66, 1479.98].forEach((f, i) => tone(f, { at: 0.03 + i * 0.055, dur: 0.3, type: 'sine', gain: 0.2 }));
      tone(2349.3, { at: 0.26, dur: 0.5, type: 'sine', gain: 0.06 });
    },
    // Opening the boxes: a bright rising digital start-up chime.
    open() {
      [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.22, type: 'triangle', gain: 0.32 }));
      tone(2093, { at: 0.3, dur: 0.35, type: 'sine', gain: 0.12 });
    },
    // Leaving the boxes: a short descending power-down.
    close() {
      tone(1046.5, { dur: 0.3, type: 'triangle', gain: 0.28, to: 392 });
      tone(523.25, { at: 0.12, dur: 0.28, type: 'sine', gain: 0.18, to: 196 });
    },
    // Moving the cursor: a very soft, quick digital tick.
    tick() {
      const now = performance.now();
      if (now - lastTick < 35) return;
      lastTick = now;
      tone(1900, { dur: 0.03, type: 'square', gain: 0.045 });
    },
    // Picking / opening something: a crisp rising pop.
    select() {
      tone(880, { dur: 0.07, type: 'sine', gain: 0.4, to: 1480 });
      noise({ dur: 0.02, from: 4000, to: 3000, gain: 0.08 });
    },
    // Dropping a Pokémon into a slot: a deeper, grounded thud-click.
    place() {
      tone(260, { dur: 0.11, type: 'sine', gain: 0.5, to: 120 });
      noise({ at: 0.005, dur: 0.035, from: 2200, to: 900, gain: 0.18 });
    },
    // Changing box: an airy electronic whoosh with a click.
    flip() {
      noise({ dur: 0.16, from: 2600, to: 500, q: 0.8, gain: 0.22 });
      tone(1250, { at: 0.11, dur: 0.035, type: 'square', gain: 0.06 });
    },
    // Multi-select on / off: a two-note chime, rising or falling.
    multi(on) {
      const notes = on ? [987.77, 1318.51] : [1318.51, 987.77];
      notes.forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.16, type: 'triangle', gain: 0.28 }));
    },
    // A new Pokémon turned up in one of your games: a bright little three-note fanfare.
    catch() {
      [783.99, 987.77, 1174.66].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.16, type: 'triangle', gain: 0.3 }));
      tone(1567.98, { at: 0.27, dur: 0.45, type: 'triangle', gain: 0.26 });
      tone(2349.32, { at: 0.3, dur: 0.5, type: 'sine', gain: 0.07 });
    },
    // Something went wrong: a short low double-buzz.
    error() {
      tone(196, { dur: 0.09, type: 'square', gain: 0.12 });
      tone(165, { at: 0.11, dur: 0.12, type: 'square', gain: 0.12 });
    },
  };
})();
