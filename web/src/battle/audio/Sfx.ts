/**
 * Chiptune sound effects, ported from src/music.py (numpy + pygame.mixer)
 * to the browser's Web Audio API.
 *
 * The Python game generates every SFX procedurally — square / triangle
 * waves, white-noise bursts, frequency sweeps, ADSR envelopes — so there
 * are no .wav files to ship. We mirror the same approach with one shared
 * AudioContext and a small set of primitive helpers (`tone`, `sweep`,
 * `noise`) that schedule notes at offsets along an absolute time axis.
 *
 * Public API:
 *   Sfx.play(name)            — plays a named effect by id (matches the
 *                                Python catalog, which spells.json
 *                                already references via `sfx`/`hit_sfx`).
 *   Sfx.setMuted(boolean)     — silence everything; persisted to
 *                                localStorage so refreshes remember it.
 *   Sfx.muted                 — getter for the current state.
 *
 * Browsers block audio until the page has seen a user gesture; the
 * AudioContext is created lazily on the first `play()` call so the
 * module is safe to import at module-load time.
 */

const STORAGE_KEY = "rpg.sfx.muted";

type Voice = "square" | "triangle" | "sawtooth" | "sine";

let _ctx: AudioContext | null = null;
let _muted = (() => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
})();

/** Resolve and (lazily) construct a shared AudioContext. */
function ctx(): AudioContext | null {
  if (_ctx) return _ctx;
  if (typeof window === "undefined") return null;
  // The webkitAudioContext fallback covers older Safari builds.
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    _ctx = new Ctor();
  } catch {
    _ctx = null;
  }
  return _ctx;
}

/** Convert a note name (C4, E5, …) to a frequency in Hz. */
function noteHz(name: string): number {
  const semitones: Record<string, number> = {
    C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
    F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9,
    "A#": 10, Bb: 10, B: 11,
  };
  const m = /^([A-G](?:#|b)?)(\d+)$/.exec(name);
  if (!m) return 440;
  const semi = semitones[m[1]];
  const oct = parseInt(m[2], 10);
  // A4 = 440 Hz; midi number 69. Compute relative semitones from A4.
  const midi = (oct + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Build a one-shot oscillator note with attack/release envelope. */
function tone(
  ac: AudioContext,
  out: AudioNode,
  freq: number,
  startAt: number,
  duration: number,
  volume = 0.25,
  voice: Voice = "square",
  attack = 0.005,
  release?: number,
): void {
  const osc = ac.createOscillator();
  osc.type = voice;
  osc.frequency.setValueAtTime(freq, startAt);
  const env = ac.createGain();
  const r = release ?? duration * 0.3;
  env.gain.setValueAtTime(0.0001, startAt);
  env.gain.exponentialRampToValueAtTime(volume, startAt + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(env).connect(out);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
  void r;
}

/** Frequency-sweeping oscillator (square or triangle). */
function sweep(
  ac: AudioContext,
  out: AudioNode,
  startFreq: number,
  endFreq: number,
  startAt: number,
  duration: number,
  volume = 0.25,
  voice: Voice = "square",
): void {
  const osc = ac.createOscillator();
  osc.type = voice;
  osc.frequency.setValueAtTime(startFreq, startAt);
  osc.frequency.linearRampToValueAtTime(endFreq, startAt + duration);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, startAt);
  env.gain.exponentialRampToValueAtTime(volume, startAt + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(env).connect(out);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** Short white-noise burst with envelope — used for hits, explosions. */
function noise(
  ac: AudioContext,
  out: AudioNode,
  startAt: number,
  duration: number,
  volume = 0.30,
  attack = 0.002,
  release?: number,
): void {
  const sampleCount = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buf = ac.createBuffer(1, sampleCount, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const env = ac.createGain();
  const r = release ?? duration * 0.3;
  env.gain.setValueAtTime(0.0001, startAt);
  env.gain.exponentialRampToValueAtTime(volume, startAt + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  src.connect(env).connect(out);
  src.start(startAt);
  src.stop(startAt + duration + 0.02);
  void r;
}

/** A master gain so the mute toggle can fade everything cleanly. */
function masterFor(ac: AudioContext): GainNode {
  const g = ac.createGain();
  g.gain.value = _muted ? 0 : 1;
  g.connect(ac.destination);
  return g;
}

// ── SFX generators (each schedules notes onto `out`, starting at `t0`) ──
//
// These mirror src/music.py's _gen_sfx_*. Durations and volumes are kept
// close to the originals so the web port "sounds like" the desktop game.

function genSwordHit(ac: AudioContext, out: AudioNode, t0: number): void {
  noise(ac, out, t0, 0.04, 0.35, 0.002, 0.02);
  sweep(ac, out, 600, 200, t0 + 0.06, 0.10, 0.30, "square");
}

function genMiss(ac: AudioContext, out: AudioNode, t0: number): void {
  noise(ac, out, t0, 0.12, 0.15, 0.005, 0.08);
  sweep(ac, out, 200, 500, t0, 0.08, 0.12, "square");
}

function genCritical(ac: AudioContext, out: AudioNode, t0: number): void {
  noise(ac, out, t0, 0.06, 0.40, 0.001, 0.03);
  sweep(ac, out, 400,  800,  t0 + 0.09, 0.08, 0.30, "square");
  sweep(ac, out, 600, 1200,  t0 + 0.13, 0.08, 0.25, "square");
}

function genArrow(ac: AudioContext, out: AudioNode, t0: number): void {
  // A quick rising whistle. Used for ranged attacks + thrown items.
  sweep(ac, out, 300, 900, t0, 0.12, 0.25, "square");
}

function genFireball(ac: AudioContext, out: AudioNode, t0: number): void {
  // Cast roar — long noise + rising tone.
  noise(ac, out, t0, 0.25, 0.20, 0.01, 0.15);
  sweep(ac, out, 150, 600, t0, 0.25, 0.25, "square");
}

/** Filtered noise source (white or brown), not yet started. The
 *  caller wires `out` onward and schedules gain. */
function noiseSource(
  ac: AudioContext,
  duration: number,
  brown = false,
): AudioBufferSourceNode {
  const n = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      // Leaky integrator → brown-ish noise: deep, rumbly, no hiss.
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = w;
    }
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}

function genFlamethrower(ac: AudioContext, out: AudioNode, t0: number): void {
  // A gout of flame, ~0.9s:
  //   1. Ignition "whoomp" — a low-passed noise thump plus a triangle
  //      pitch drop, the gas catching.
  //   2. The roar — brown noise through a wide band-pass that drifts
  //      upward as the jet opens, with a fast random tremolo for the
  //      turbulent flutter of a flame jet.
  //   3. A layer of hiss — white noise, high-passed and quiet, for
  //      the pressurised spray.
  //   4. Crackles — tiny random high clicks scattered over the body.
  const dur = 0.9;

  // 1. Ignition.
  {
    const src = noiseSource(ac, 0.18);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.18);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.2);
    sweep(ac, out, 140, 55, t0, 0.16, 0.30, "triangle");
  }

  // 2. Roar.
  {
    const src = noiseSource(ac, dur, true);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(350, t0);
    bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.35);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.75, t0 + 0.06);
    // Turbulent flutter: jitter the level every ~25ms.
    for (let t = 0.08; t < dur - 0.25; t += 0.025) {
      g.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.35, t0 + t);
    }
    g.gain.linearRampToValueAtTime(0.6, t0 + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 3. Hiss.
  {
    const src = noiseSource(ac, dur);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.1);
    g.gain.setValueAtTime(0.06, t0 + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 4. Crackles.
  for (let i = 0; i < 14; i++) {
    const at = t0 + 0.08 + Math.random() * (dur - 0.3);
    const src = noiseSource(ac, 0.012);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800 + Math.random() * 2500;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12 + Math.random() * 0.12, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.02);
  }
}

function genExplosion(ac: AudioContext, out: AudioNode, t0: number): void {
  noise(ac, out, t0, 0.15, 0.40, 0.002, 0.10);
  sweep(ac, out, 300, 50, t0, 0.20, 0.35, "triangle");
}

function genFireExplosion(ac: AudioContext, out: AudioNode, t0: number): void {
  // A fireball going off, ~1.1s — a deep boom rather than the short
  // "explosion" crack (which reads as a punch):
  //   1. Blast — a very short, bright noise crack for the initial pop.
  //   2. Boom — a sine sub-bass dropping 95Hz → 32Hz with a long decay,
  //      the weight you feel more than hear.
  //   3. Fireball bloom — brown noise through a low-pass that opens
  //      wide then closes slowly: the "whoof" of flame expanding and
  //      rolling away.
  //   4. Debris crackle — sparse high clicks in the tail as embers
  //      scatter.
  const dur = 1.1;

  // 1. Blast.
  {
    const src = noiseSource(ac, 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    src.connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.06);
  }

  // 2. Boom.
  {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, t0);
    osc.frequency.exponentialRampToValueAtTime(32, t0 + 0.7);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.82);
  }

  // 3. Bloom.
  {
    const src = noiseSource(ac, dur, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(2400, t0);
    lp.frequency.exponentialRampToValueAtTime(700, t0 + 0.25);
    lp.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 4. Debris crackle.
  for (let i = 0; i < 10; i++) {
    const at = t0 + 0.12 + Math.random() * 0.7;
    const src = noiseSource(ac, 0.01);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000 + Math.random() * 3000;
    const g = ac.createGain();
    const v = (0.08 + Math.random() * 0.1) * (1 - (at - t0) / dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.01);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.015);
  }
}

/** Soft-clip curve for a WaveShaper. Higher `k` = grittier distortion. */
function clipCurve(k: number): Float32Array {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

function genElectricZap(ac: AudioContext, out: AudioNode, t0: number): void {
  // A live electric arc, ~0.65s. Lines up with the Lightning Bolt
  // visual: ~0.2s of charge-up, then the arc.
  //   1. Charge whine: a sawtooth sweeping 300Hz → 2.4kHz through a
  //      resonant band-pass, a capacitor winding up as the plasma ball
  //      gathers.
  //   2. Arc buzz: a distorted hum stack (sawtooth ~110Hz + square
  //      ~233Hz, both wobbling in pitch) switched on and off at random
  //      every 12–30ms, the erratic crackle-buzz of a live arc rather
  //      than a steady tone.
  //   3. Fizz: band-passed white noise on the same gate, the ionised
  //      air sizzling on top of the buzz.
  //   4. Snaps: sharp high clicks scattered through the arc, plus one
  //      bright crack the moment it lets go.
  const charge = 0.2;
  const end = 0.65;

  // 1. Charge whine.
  {
    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, t0);
    osc.frequency.exponentialRampToValueAtTime(2400, t0 + charge);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(600, t0);
    bp.frequency.exponentialRampToValueAtTime(3000, t0 + charge);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + charge);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + charge + 0.04);
    osc.connect(bp).connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + charge + 0.06);
  }

  // 2 + 3. Arc buzz and fizz, through a shared random gate.
  {
    const t1 = t0 + charge;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t1);
    env.gain.exponentialRampToValueAtTime(0.3, t1 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.12, t0 + end - 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    env.connect(out);

    const gate = ac.createGain();
    gate.connect(env);

    const saw = ac.createOscillator();
    saw.type = "sawtooth";
    const sq = ac.createOscillator();
    sq.type = "square";
    const mix = ac.createGain();
    mix.gain.value = 0.9;
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(5);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 4200;
    const sqLevel = ac.createGain();
    sqLevel.gain.value = 0.55;
    saw.connect(mix);
    sq.connect(sqLevel).connect(mix);
    mix.connect(shaper).connect(lp).connect(gate);

    const fizz = noiseSource(ac, end - charge + 0.05);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3800;
    bp.Q.value = 1.1;
    const fizzLevel = ac.createGain();
    fizzLevel.gain.value = 0.9;
    fizz.connect(bp).connect(fizzLevel).connect(gate);

    // Random gate + pitch wobble, stepped together.
    gate.gain.setValueAtTime(1, t1);
    saw.frequency.setValueAtTime(110, t1);
    sq.frequency.setValueAtTime(233, t1);
    for (let t = t1 + 0.015; t < t0 + end; t += 0.012 + Math.random() * 0.018) {
      gate.gain.setValueAtTime(Math.random() < 0.25 ? 0.05 : 0.35 + Math.random() * 0.65, t);
      const wob = 0.88 + Math.random() * 0.3;
      saw.frequency.setValueAtTime(110 * wob, t);
      sq.frequency.setValueAtTime(233 * wob, t);
    }

    saw.start(t1);
    sq.start(t1);
    fizz.start(t1);
    saw.stop(t0 + end + 0.02);
    sq.stop(t0 + end + 0.02);
    fizz.stop(t0 + end + 0.02);
  }

  // 4. Snaps: one loud crack as the arc lets go, then scattered clicks.
  const snap = (at: number, vol: number, len: number, hpHz: number) => {
    const src = noiseSource(ac, len);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpHz;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  };
  snap(t0 + charge, 0.4, 0.03, 1500);
  for (let i = 0; i < 9; i++) {
    const at = t0 + charge + 0.02 + Math.random() * (end - charge - 0.1);
    snap(at, 0.12 + Math.random() * 0.18, 0.006, 3000 + Math.random() * 3000);
  }
}

function genThunderCrack(ac: AudioContext, out: AudioNode, t0: number): void {
  // The bolt connecting, ~1.2s:
  //   1. Snap: a very short, bright high-passed noise crack.
  //   2. Tear: white noise through a low-pass sweeping 7kHz → 500Hz
  //      over a quarter second, the ripping "kkrrsh" of the discharge.
  //   3. Rumble: brown noise low-passed 400Hz → 70Hz with an uneven,
  //      fading swell, thunder rolling away.
  //   4. Sizzle: high clicks thinning out over ~0.6s, the target still
  //      fizzing with leftover charge.
  const dur = 1.2;

  // 1. Snap.
  {
    const src = noiseSource(ac, 0.035);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.045);
  }

  // 2. Tear.
  {
    const src = noiseSource(ac, 0.32);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(7000, t0);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.38, t0 + 0.004);
    // A few hard dips so it rips rather than whooshes.
    for (let t = 0.03; t < 0.22; t += 0.025 + Math.random() * 0.02) {
      g.gain.setValueAtTime(0.12 + Math.random() * 0.26, t0 + t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.34);
  }

  // 3. Rumble.
  {
    const src = noiseSource(ac, dur, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.exponentialRampToValueAtTime(70, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
    for (let t = 0.1; t < dur - 0.2; t += 0.07 + Math.random() * 0.06) {
      const fall = 1 - t / dur;
      g.gain.linearRampToValueAtTime((0.2 + Math.random() * 0.3) * fall, t0 + t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 4. Sizzle.
  for (let i = 0; i < 16; i++) {
    const at = t0 + 0.04 + Math.pow(Math.random(), 1.6) * 0.6;
    const src = noiseSource(ac, 0.008);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500 + Math.random() * 3500;
    const g = ac.createGain();
    const v = (0.08 + Math.random() * 0.14) * (1 - (at - t0) / 0.7);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.008);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.012);
  }
}

function genBreathRoar(ac: AudioContext, out: AudioNode, t0: number): void {
  // A dragon breathing fire, ~1.0s. Matches the Dragon Breath visual
  // (cone ~0.5s, impact burst ~0.36s in, embers trailing after):
  //   1. Roar: the beast's throat. A sawtooth pair falling 95Hz → 55Hz,
  //      roughened by a fast ~28Hz tremolo, run through distortion and
  //      two band-pass "throat" formants so it reads as a growl, not a
  //      synth tone.
  //   2. Torrent: brown noise through a wide band-pass, swelling to its
  //      peak as the cone hits (~0.35s) with a turbulent flutter. Bigger
  //      and lower than the flamethrower cue.
  //   3. Rush: white noise through a band-pass sweeping 500Hz → 2.6kHz
  //      over the first 0.3s, the jet tearing out of the mouth.
  //   4. Spits: crackles and pops thrown out with the flame.
  const dur = 1.0;

  // 1. Roar.
  {
    const end = 0.75;
    const a = ac.createOscillator();
    a.type = "sawtooth";
    a.frequency.setValueAtTime(95, t0);
    a.frequency.exponentialRampToValueAtTime(55, t0 + end);
    const b = ac.createOscillator();
    b.type = "sawtooth";
    b.frequency.setValueAtTime(95 * 1.51, t0);
    b.frequency.exponentialRampToValueAtTime(55 * 1.49, t0 + end);
    const mix = ac.createGain();
    mix.gain.value = 0.7;
    a.connect(mix);
    b.connect(mix);
    // Rough tremolo: a ~28Hz square LFO pushing the level up and down.
    const trem = ac.createGain();
    trem.gain.value = 0.6;
    const lfo = ac.createOscillator();
    lfo.type = "square";
    lfo.frequency.setValueAtTime(28, t0);
    lfo.frequency.linearRampToValueAtTime(19, t0 + end);
    const lfoDepth = ac.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(trem.gain);
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(4);
    const f1 = ac.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 380;
    f1.Q.value = 2.5;
    const f2 = ac.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 900;
    f2.Q.value = 3;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.06);
    env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    mix.connect(trem).connect(shaper);
    shaper.connect(f1).connect(env);
    shaper.connect(f2).connect(env);
    env.connect(out);
    for (const o of [a, b, lfo]) {
      o.start(t0);
      o.stop(t0 + end + 0.02);
    }
  }

  // 2. Torrent.
  {
    const src = noiseSource(ac, dur, true);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.55;
    bp.frequency.setValueAtTime(260, t0);
    bp.frequency.exponentialRampToValueAtTime(750, t0 + 0.35);
    bp.frequency.exponentialRampToValueAtTime(320, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.08);
    g.gain.linearRampToValueAtTime(0.95, t0 + 0.35);
    // Turbulent flutter through the body of the breath.
    for (let t = 0.37; t < dur - 0.3; t += 0.02 + Math.random() * 0.015) {
      g.gain.linearRampToValueAtTime(0.55 + Math.random() * 0.4, t0 + t);
    }
    g.gain.linearRampToValueAtTime(0.5, t0 + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 3. Rush.
  {
    const src = noiseSource(ac, 0.6);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.3);
    bp.frequency.exponentialRampToValueAtTime(1400, t0 + 0.6);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.62);
  }

  // 4. Spits.
  for (let i = 0; i < 18; i++) {
    const at = t0 + 0.1 + Math.random() * 0.7;
    const len = 0.008 + Math.random() * 0.01;
    const src = noiseSource(ac, len);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500 + Math.random() * 3000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.1 + Math.random() * 0.16, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

function genFireEngulf(ac: AudioContext, out: AudioNode, t0: number): void {
  // The breath's victim catching fire, ~1.0s. A "whumpf" of flame
  // wrapping the target, not the deep boom of fire_explosion:
  //   1. Whumpf: low-passed noise thump plus a sine dropping 120Hz →
  //      45Hz, flames catching all at once.
  //   2. Blaze: brown noise through a low-pass that flares open then
  //      settles, with a slow lick-and-flicker in the level, the
  //      target burning.
  //   3. Sizzle: quiet high-passed hiss fading out.
  //   4. Crackle: pops thinning out over the tail.
  const dur = 1.0;

  // 1. Whumpf.
  {
    const src = noiseSource(ac, 0.14);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, t0);
    lp.frequency.exponentialRampToValueAtTime(250, t0 + 0.14);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.16);

    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.3);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.37);
  }

  // 2. Blaze.
  {
    const src = noiseSource(ac, dur, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(600, t0);
    lp.frequency.exponentialRampToValueAtTime(1800, t0 + 0.12);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.05);
    for (let t = 0.1; t < dur - 0.2; t += 0.045 + Math.random() * 0.04) {
      const fall = 1 - t / dur;
      g.gain.linearRampToValueAtTime((0.3 + Math.random() * 0.3) * fall + 0.05, t0 + t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 3. Sizzle.
  {
    const src = noiseSource(ac, 0.7);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.72);
  }

  // 4. Crackle.
  for (let i = 0; i < 14; i++) {
    const at = t0 + 0.06 + Math.pow(Math.random(), 1.4) * (dur - 0.2);
    const src = noiseSource(ac, 0.01);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800 + Math.random() * 2800;
    const g = ac.createGain();
    const v = (0.1 + Math.random() * 0.14) * (1 - (at - t0) / dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.01);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.015);
  }
}

function genVoidHum(ac: AudioContext, out: AudioNode, t0: number): void {
  // The Void Orb in flight, ~0.62s. Ends at the orb's implosion, where
  // void_burst takes over:
  //   1. Warp drone: three detuned sawtooths an unsettling tritone
  //      apart, wobbling under a slow vibrato, through a resonant
  //      band-pass that sweeps up and down like a wah. A hum that seems
  //      to bend space.
  //   2. Shimmer: high, glassy sine tones on an inharmonic cluster with
  //      fast tremolo, the multi-coloured sparks trailing it.
  //   3. Inrush: noise swelling and rising in pitch into the implosion,
  //      like a reversed cymbal.
  //   4. Suck: a quick upward "fwip" as the orb collapses to a point,
  //      then a hard cut, a beat of vacuum before the burst.
  const end = 0.62;

  // 1. Warp drone.
  {
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(1100, t0 + 0.25);
    bp.frequency.exponentialRampToValueAtTime(400, t0 + 0.45);
    bp.frequency.exponentialRampToValueAtTime(1500, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
    g.gain.setValueAtTime(0.3, t0 + end - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    bp.connect(g).connect(out);
    const vib = ac.createOscillator();
    vib.type = "sine";
    vib.frequency.setValueAtTime(5, t0);
    vib.frequency.linearRampToValueAtTime(11, t0 + end);
    const vibDepth = ac.createGain();
    vibDepth.gain.value = 9;
    vib.connect(vibDepth);
    for (const [f, det] of [[65, -12], [65, 9], [92, 0]] as const) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 1.5, t0 + end);
      o.detune.value = det;
      vibDepth.connect(o.detune);
      const lvl = ac.createGain();
      lvl.gain.value = 0.45;
      o.connect(lvl).connect(bp);
      o.start(t0);
      o.stop(t0 + end + 0.02);
    }
    vib.start(t0);
    vib.stop(t0 + end + 0.02);
  }

  // 2. Shimmer.
  {
    const trem = ac.createGain();
    trem.gain.value = 0.5;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 17;
    const depth = ac.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    trem.connect(g).connect(out);
    for (const f of [1318, 1864, 2489, 3135]) {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t0);
      o.frequency.linearRampToValueAtTime(f * 1.06, t0 + end);
      o.connect(trem);
      o.start(t0);
      o.stop(t0 + end + 0.02);
    }
    lfo.start(t0);
    lfo.stop(t0 + end + 0.02);
  }

  // 3. Inrush.
  {
    const src = noiseSource(ac, end);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(4500, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + end - 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + end);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + end + 0.01);
  }

  // 4. Suck.
  {
    const at = t0 + end - 0.1;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(180, at);
    o.frequency.exponentialRampToValueAtTime(1900, at + 0.09);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.08);
    g.gain.linearRampToValueAtTime(0, at + 0.095);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.1);
  }
}

function genVoidBurst(ac: AudioContext, out: AudioNode, t0: number): void {
  // The Void Orb erupting, ~1.4s:
  //   1. Crack: a short, bright noise snap for the white flash.
  //   2. Collapse: a sine sub-bass plunging 170Hz → 28Hz, a hole
  //      opening in the world.
  //   3. Resonant sweep: noise through a high-Q band-pass diving
  //      3.2kHz → 140Hz, a sci-fi "pyoww" riding the shockwave rings.
  //   4. Ring-mod chime: two sines multiplied together for an
  //      inharmonic, metallic, alien tone, slowly sagging in pitch and
  //      fed through a short echo so it rings out into the void.
  const dur = 1.4;

  // 1. Crack.
  {
    const src = noiseSource(ac, 0.04);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.05);
  }

  // 2. Collapse.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(28, t0 + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 1.02);
  }

  // 3. Resonant sweep.
  {
    const src = noiseSource(ac, 0.9);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(3200, t0);
    bp.frequency.exponentialRampToValueAtTime(140, t0 + 0.8);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.92);
  }

  // 4. Ring-mod chime through an echo.
  {
    const carrier = ac.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(523, t0);
    carrier.frequency.exponentialRampToValueAtTime(415, t0 + dur);
    const mod = ac.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(347, t0);
    mod.frequency.exponentialRampToValueAtTime(290, t0 + dur);
    // carrier × mod: the mod drives the gain of a 0-based VCA.
    const vca = ac.createGain();
    vca.gain.value = 0;
    mod.connect(vca.gain);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur - 0.3);
    carrier.connect(vca).connect(g);
    g.connect(out);
    const delay = ac.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const fb = ac.createGain();
    fb.gain.value = 0.38;
    const wet = ac.createGain();
    wet.gain.value = 0.6;
    g.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(out);
    for (const o of [carrier, mod]) {
      o.start(t0);
      o.stop(t0 + dur);
    }
  }
}

function genSmallExplosion(ac: AudioContext, out: AudioNode, t0: number): void {
  // A small explosion, ~0.75s: a grenade or powder keg rather than
  // fire_explosion's big fireball boom.
  //   1. Pop: a very short, bright noise crack, the detonation itself.
  //   2. Thump: a sine dropping 110Hz → 38Hz plus a short low triangle,
  //      the punch in the chest.
  //   3. Blast: white noise, lightly distorted, through a low-pass
  //      closing 5kHz → 250Hz, the "kssh" of the blast spreading and
  //      dying away.
  //   4. Debris: grit and small stones pattering down in the tail.
  const dur = 0.75;

  // 1. Pop.
  {
    const src = noiseSource(ac, 0.03);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.04);
  }

  // 2. Thump.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.28);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.34);
    tone(ac, out, 70, t0, 0.09, 0.3, "triangle", 0.002);
  }

  // 3. Blast.
  {
    const src = noiseSource(ac, 0.5);
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(3);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(5000, t0);
    lp.frequency.exponentialRampToValueAtTime(900, t0 + 0.12);
    lp.frequency.exponentialRampToValueAtTime(250, t0 + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    src.connect(shaper).connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.52);
  }

  // 4. Debris: gritty ticks and a few duller stone clicks.
  for (let i = 0; i < 12; i++) {
    const at = t0 + 0.12 + Math.pow(Math.random(), 1.3) * (dur - 0.2);
    const stone = Math.random() < 0.35;
    const len = stone ? 0.02 : 0.008;
    const src = noiseSource(ac, len);
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = stone ? 4 : 1;
    f.frequency.value = stone ? 600 + Math.random() * 900 : 2500 + Math.random() * 3500;
    const g = ac.createGain();
    const v = (stone ? 0.25 : 0.12) * (0.5 + Math.random() * 0.5) * (1 - (at - t0) / dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

function genMeteorFall(ac: AudioContext, out: AudioNode, t0: number): void {
  // A meteor plunging in, ~0.45s, ending as it lands (meteor_impact
  // takes over there):
  //   1. Whistle: a sine falling 1.6kHz → 380Hz, the classic incoming
  //      shriek, getting louder as it nears.
  //   2. Roar: brown noise through a band-pass, swelling hard into the
  //      landing, the rock tearing through the air on fire.
  //   3. Crackle: burning pops riding the roar.
  const end = 0.45;

  // 1. Whistle.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1600, t0);
    o.frequency.exponentialRampToValueAtTime(380, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + end - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + end + 0.02);
  }

  // 2. Roar.
  {
    const src = noiseSource(ac, end, true);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1200, t0);
    bp.frequency.exponentialRampToValueAtTime(420, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.75, t0 + end - 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + end);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + end + 0.01);
  }

  // 3. Crackle.
  for (let i = 0; i < 8; i++) {
    const at = t0 + 0.1 + Math.random() * (end - 0.15);
    const src = noiseSource(ac, 0.01);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000 + Math.random() * 2500;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.08 + Math.random() * 0.1, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.01);
    src.connect(hp).connect(g).connect(out);
    src.start(at);
    src.stop(at + 0.015);
  }
}

function genMeteorImpact(ac: AudioContext, out: AudioNode, t0: number): void {
  // A rock slamming into the ground, ~1.2s:
  //   1. Crack: a short, bright noise snap, the moment of contact.
  //   2. Slam: a heavy sine thud dropping 90Hz → 30Hz with a low
  //      triangle under it, the weight of the hit.
  //   3. Crunch: mid-band noise chopped up at random, stone shattering.
  //   4. Rumble: brown noise low-passed 260Hz → 55Hz, the ground
  //      shaking afterwards.
  //   5. Clatter: rock chips and gravel raining back down, duller
  //      stone knocks mixed with fine grit.
  const dur = 1.2;

  // 1. Crack.
  {
    const src = noiseSource(ac, 0.03);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.45, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.04);
  }

  // 2. Slam.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t0);
    o.frequency.exponentialRampToValueAtTime(30, t0 + 0.45);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.57);
    tone(ac, out, 55, t0, 0.14, 0.32, "triangle", 0.002);
  }

  // 3. Crunch.
  {
    const src = noiseSource(ac, 0.2);
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(3);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(1100, t0);
    bp.frequency.exponentialRampToValueAtTime(450, t0 + 0.2);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.003);
    for (let t = 0.02; t < 0.17; t += 0.012 + Math.random() * 0.014) {
      g.gain.setValueAtTime((0.05 + Math.random() * 0.35) * (1 - t / 0.2), t0 + t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    src.connect(shaper).connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.22);
  }

  // 4. Rumble.
  {
    const src = noiseSource(ac, dur, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(260, t0);
    lp.frequency.exponentialRampToValueAtTime(55, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 5. Clatter.
  for (let i = 0; i < 16; i++) {
    const at = t0 + 0.15 + Math.pow(Math.random(), 1.2) * 0.75;
    const stone = Math.random() < 0.45;
    const len = stone ? 0.025 : 0.008;
    const src = noiseSource(ac, len);
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = stone ? 5 : 1;
    f.frequency.value = stone ? 450 + Math.random() * 900 : 2500 + Math.random() * 3000;
    const g = ac.createGain();
    const v = (stone ? 0.24 : 0.1) * (0.5 + Math.random() * 0.5) * (1 - (at - t0) / dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, v), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

/** A cathedral-ish reverb: a convolver loaded with a decaying stereo
 *  noise burst. Built per play (cheap) and fed into `out`. */
function cathedralReverb(ac: AudioContext, out: AudioNode, seconds = 3, wet = 0.5): AudioNode {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  const g = ac.createGain();
  g.gain.value = wet;
  conv.connect(g).connect(out);
  return conv;
}

/** One sustained choir chord ("aah"), sung by `notes` (one voice each).
 *  Each voice is three slightly detuned sawtooths with a shared slow
 *  vibrato, all pushed through a vowel formant bank ("ah": F1 ~700Hz,
 *  F2 ~1.2kHz, F3 ~2.6kHz; "oo": ~330Hz / 870Hz / 2.3kHz), so the
 *  result reads as voices, not synths. */
function choirChord(
  ac: AudioContext,
  dry: AudioNode,
  verb: AudioNode,
  notes: string[],
  start: number,
  end: number,
  level: number,
  attack = 0.3,
  release = 0.5,
  vowel: "ah" | "oo" = "ah",
): void {
  const sum = ac.createGain();
  sum.gain.value = 1;
  const vib = ac.createOscillator();
  vib.frequency.value = 5.2;
  const vibDepth = ac.createGain();
  vibDepth.gain.setValueAtTime(0, start);
  vibDepth.gain.linearRampToValueAtTime(14, start + attack + 0.2);
  vib.connect(vibDepth);
  for (const note of notes) {
    const f = noteHz(note);
    for (const det of [-9, 0, 8]) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det + (Math.random() - 0.5) * 4;
      vibDepth.connect(o.detune);
      o.connect(sum);
      o.start(start);
      o.stop(end + release + 0.05);
    }
  }
  vib.start(start);
  vib.stop(end + release + 0.05);

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(level, start + attack);
  env.gain.setValueAtTime(level, end);
  env.gain.exponentialRampToValueAtTime(0.0001, end + release);
  // Formant bank: "ah" (open, bright) or "oo" (soft, rounded).
  const formants: ReadonlyArray<readonly [number, number, number]> =
    vowel === "oo"
      ? [[330, 4, 1], [870, 9, 0.45], [2300, 14, 0.18]]
      : [[700, 6, 1], [1220, 10, 0.55], [2600, 14, 0.3]];
  for (const [fq, q, g] of formants) {
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = fq;
    bp.Q.value = q;
    const fg = ac.createGain();
    fg.gain.value = g;
    sum.connect(bp).connect(fg).connect(env);
  }
  env.connect(dry);
  env.connect(verb);
}

/** A struck church bell: inharmonic sine partials with long, staggered
 *  decays (the higher the partial, the faster it dies). */
function bell(ac: AudioContext, dry: AudioNode, verb: AudioNode, freq: number, at: number, level: number): void {
  const partials: [number, number, number][] = [
    [0.5, 0.5, 3.2],   // hum
    [1, 1, 2.6],       // strike
    [1.2, 0.45, 2.0],  // minor third
    [2, 0.5, 1.6],
    [2.76, 0.35, 1.1],
    [5.4, 0.18, 0.6],
  ];
  for (const [ratio, amp, decay] of partials) {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * ratio;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level * amp, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g);
    g.connect(dry);
    g.connect(verb);
    o.start(at);
    o.stop(at + decay + 0.05);
  }
}

function genHolyChoir(ac: AudioContext, out: AudioNode, t0: number): void {
  // Turn Undead's sacred cue, ~4.5s with the reverb tail. Lines up
  // with the visual: the caster channels for ~0.9s, the shockwave
  // releases, then pillars of light smite each undead.
  //   1. Choir, three chords through a cathedral reverb:
  //      D minor (hushed, swelling as the light gathers) → Bb major
  //      (rising) → a huge D major on the release, the "Picardy third"
  //      that turns the minor opening into triumph, sopranos on top.
  //   2. Bells: a low bell tolls at the start; a bright pair rings out
  //      as the power is released.
  //   3. Shimmer: a rising glissando of glassy high sines into the
  //      release, the light breaking through.
  //   4. Release swell: a soft low "whoom" of air under the big chord.
  const verb = cathedralReverb(ac, out, 3.2, 0.55);
  const dry = ac.createGain();
  dry.gain.value = 0.8;
  dry.connect(out);

  // 1. Choir.
  choirChord(ac, dry, verb, ["D3", "A3", "D4", "F4"], t0, t0 + 0.55, 0.22, 0.35, 0.35);
  choirChord(ac, dry, verb, ["Bb2", "F3", "D4", "Bb4"], t0 + 0.5, t0 + 0.9, 0.26, 0.15, 0.25);
  choirChord(ac, dry, verb, ["D3", "A3", "F#4", "A4", "D5"], t0 + 0.88, t0 + 2.9, 0.34, 0.08, 1.1);

  // 2. Bells.
  bell(ac, dry, verb, noteHz("D3"), t0, 0.16);
  bell(ac, dry, verb, noteHz("D5"), t0 + 0.9, 0.12);
  bell(ac, dry, verb, noteHz("A5"), t0 + 1.02, 0.08);

  // 3. Shimmer.
  {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.88);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
    g.connect(dry);
    g.connect(verb);
    for (const [a, b] of [[1175, 2349], [1480, 2960], [1760, 3520]] as const) {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(a, t0 + 0.3);
      o.frequency.exponentialRampToValueAtTime(b, t0 + 0.9);
      o.connect(g);
      o.start(t0 + 0.3);
      o.stop(t0 + 1.85);
    }
  }

  // 4. Release swell.
  {
    const src = noiseSource(ac, 1.2, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 300;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.85);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);
    src.connect(lp).connect(g);
    g.connect(dry);
    g.connect(verb);
    src.start(t0 + 0.85);
    src.stop(t0 + 2.05);
  }
}

function genHolySmite(ac: AudioContext, out: AudioNode, t0: number): void {
  // One pillar of light striking, ~1s. Kept lighter than the choir it
  // plays over (several can land in a row):
  //   1. Strike: a short, bright noise "tsss" opening and closing, the
  //      beam hitting.
  //   2. Chime: a high bell partial cluster ringing out.
  //   3. Thump: a soft low sine drop for weight.
  //   4. Sear: a quiet high sizzle, the undead burning.
  const verb = cathedralReverb(ac, out, 1.6, 0.35);

  // 1. Strike.
  {
    const src = noiseSource(ac, 0.18);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(7000, t0);
    bp.frequency.exponentialRampToValueAtTime(2500, t0 + 0.18);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.2);
  }

  // 2. Chime.
  bell(ac, out, verb, noteHz("A5") * (0.98 + Math.random() * 0.04), t0, 0.07);

  // 3. Thump.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(55, t0 + 0.25);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.32);
  }

  // 4. Sear.
  {
    const src = noiseSource(ac, 0.6);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
    src.connect(hp).connect(g).connect(out);
    src.start(t0 + 0.05);
    src.stop(t0 + 0.66);
  }
}

function genCurseHex(ac: AudioContext, out: AudioNode, t0: number): void {
  // A curse being laid, ~2.4s with its tail. The visual builds for
  // ~0.8s, then the curse takes:
  //   1. Drone: sawtooths a semitone apart (A1 against Bb1) with a
  //      tritone above, slowly opening through a low-pass. The clash
  //      beats and grinds: dread.
  //   2. Whispers: band-passed noise in short, syllable-like bursts
  //      with sweeping "mouth" filters, scattered left and right, many
  //      voices muttering the hex.
  //   3. Inrush: noise swelling into the moment the curse takes, then
  //      cut dead.
  //   4. Groan: a demonic "hhuoo", a distorted low sawtooth through
  //      "oh" vowel formants, sagging in pitch, as the curse takes.
  //   5. Sour bell: a low bell with a clashing partial, tolling into a
  //      dark reverb.
  const hit = 0.8;
  const verb = cathedralReverb(ac, out, 2.6, 0.5);
  const darkVerbIn = ac.createBiquadFilter();
  darkVerbIn.type = "lowpass";
  darkVerbIn.frequency.value = 1800;
  darkVerbIn.connect(verb);
  const dry = ac.createGain();
  dry.gain.value = 0.85;
  dry.connect(out);

  // 1. Drone.
  {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(140, t0);
    lp.frequency.exponentialRampToValueAtTime(700, t0 + hit);
    lp.frequency.exponentialRampToValueAtTime(160, t0 + 2.0);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.35);
    g.gain.setValueAtTime(0.3, t0 + hit);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.1);
    lp.connect(g);
    g.connect(dry);
    g.connect(darkVerbIn);
    for (const [f, lvl] of [[55, 0.5], [58.27, 0.5], [77.78, 0.3]] as const) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, t0 + 2.1);
      const og = ac.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(lp);
      o.start(t0);
      o.stop(t0 + 2.15);
    }
  }

  // 2. Whispers.
  for (let i = 0; i < 22; i++) {
    const at = t0 + Math.random() * (hit - 0.05);
    const len = 0.06 + Math.random() * 0.12;
    const src = noiseSource(ac, len);
    const bp1 = ac.createBiquadFilter();
    bp1.type = "bandpass";
    bp1.Q.value = 6;
    const f = 900 + Math.random() * 1800;
    bp1.frequency.setValueAtTime(f, at);
    bp1.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.9), at + len);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 600;
    const g = ac.createGain();
    // Louder as the curse nears.
    const v = (0.05 + Math.random() * 0.07) * (0.5 + (at - t0) / hit);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + len * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    src.connect(bp1).connect(hp).connect(g).connect(pan);
    pan.connect(dry);
    pan.connect(verb);
    src.start(at);
    src.stop(at + len + 0.01);
  }

  // 3. Inrush.
  {
    const src = noiseSource(ac, hit);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t0);
    bp.frequency.exponentialRampToValueAtTime(2200, t0 + hit);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + hit - 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + hit);
    src.connect(bp).connect(g).connect(dry);
    src.start(t0 + 0.2);
    src.stop(t0 + hit + 0.01);
  }

  // 4. Groan.
  {
    const at = t0 + hit;
    const end = at + 0.9;
    const o = ac.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(92, at);
    o.frequency.exponentialRampToValueAtTime(48, end);
    const o2 = ac.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.setValueAtTime(92 * 1.012, at);
    o2.frequency.exponentialRampToValueAtTime(48 * 1.02, end);
    const mix = ac.createGain();
    mix.gain.value = 0.7;
    o.connect(mix);
    o2.connect(mix);
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(3);
    mix.connect(shaper);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.75, at + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const [fq, q, gain] of [[420, 5, 1], [820, 8, 0.5]] as const) {
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(fq, at);
      bp.frequency.exponentialRampToValueAtTime(fq * 0.75, end);
      bp.Q.value = q;
      const fg = ac.createGain();
      fg.gain.value = gain;
      shaper.connect(bp).connect(fg).connect(env);
    }
    env.connect(dry);
    env.connect(darkVerbIn);
    for (const x of [o, o2]) {
      x.start(at);
      x.stop(end + 0.02);
    }
  }

  // 5. Sour bell: a low bell plus a partial a semitone off.
  bell(ac, dry, darkVerbIn, noteHz("C3"), t0 + hit, 0.14);
  bell(ac, dry, darkVerbIn, noteHz("C#4"), t0 + hit, 0.05);
}

function genArcaneArrowCast(ac: AudioContext, out: AudioNode, t0: number): void {
  // Magic Arrow loosed, ~0.6s. The visual conjures for ~0.12s, then
  // flies for ~0.28s:
  //   1. Conjure: a quick rising sparkle arpeggio (E6 B6 E7 G#7), the
  //      arrow forming out of light.
  //   2. Twang: a magic bowstring, a sine and a bright harmonic bending
  //      down, plus a short noise "thwip" as the arrow is released.
  //   3. Flight: a whistling resonant whoosh rising in pitch, the
  //      arrow streaking away.
  const verb = cathedralReverb(ac, out, 1.2, 0.3);
  const rel = t0 + 0.12;

  // 1. Conjure.
  ["E6", "B6", "E7", "G#7"].forEach((n, i) => {
    const at = t0 + i * 0.025;
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = noteHz(n);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.07, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    o.connect(g);
    g.connect(out);
    g.connect(verb);
    o.start(at);
    o.stop(at + 0.16);
  });

  // 2. Twang + thwip.
  for (const [f, lvl] of [[330, 0.22], [990, 0.07]] as const) {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f * 1.06, rel);
    o.frequency.exponentialRampToValueAtTime(f * 0.92, rel + 0.15);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, rel);
    g.gain.exponentialRampToValueAtTime(lvl, rel + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.18);
    o.connect(g);
    g.connect(out);
    g.connect(verb);
    o.start(rel);
    o.stop(rel + 0.2);
  }
  {
    const src = noiseSource(ac, 0.06);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(2500, rel);
    bp.frequency.exponentialRampToValueAtTime(900, rel + 0.06);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, rel);
    g.gain.exponentialRampToValueAtTime(0.25, rel + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, rel + 0.06);
    src.connect(bp).connect(g).connect(out);
    src.start(rel);
    src.stop(rel + 0.07);
  }

  // 3. Flight.
  {
    const dur = 0.32;
    const src = noiseSource(ac, dur);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(900, rel);
    bp.frequency.exponentialRampToValueAtTime(3200, rel + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, rel);
    g.gain.exponentialRampToValueAtTime(0.3, rel + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, rel + dur);
    src.connect(bp).connect(g);
    g.connect(out);
    g.connect(verb);
    src.start(rel);
    src.stop(rel + dur + 0.01);
  }
}

function genArcaneArrowHit(ac: AudioContext, out: AudioNode, t0: number): void {
  // Magic Arrow striking, ~0.9s:
  //   1. Thunk: a short low thud and click, the arrow hitting home.
  //   2. Shatter: glassy pings at random high pitches plus a hiss, the
  //      arrow bursting into shards of light.
  //   3. Bloom: a shimmering two-note chord (E6 + B6) with tremolo,
  //      ringing out through a short reverb.
  const verb = cathedralReverb(ac, out, 1.4, 0.35);

  // 1. Thunk.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.12);
    const src = noiseSource(ac, 0.015);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2000;
    const cg = ac.createGain();
    cg.gain.setValueAtTime(0.0001, t0);
    cg.gain.exponentialRampToValueAtTime(0.3, t0 + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.015);
    src.connect(hp).connect(cg).connect(out);
    src.start(t0);
    src.stop(t0 + 0.02);
  }

  // 2. Shatter.
  for (let i = 0; i < 7; i++) {
    const at = t0 + 0.01 + Math.random() * 0.12;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = 2200 + Math.random() * 3200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.04, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08 + Math.random() * 0.1);
    o.connect(g);
    g.connect(out);
    g.connect(verb);
    o.start(at);
    o.stop(at + 0.2);
  }
  {
    const src = noiseSource(ac, 0.2);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.21);
  }

  // 3. Bloom.
  {
    const trem = ac.createGain();
    trem.gain.value = 0.6;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 11;
    const depth = ac.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(trem.gain);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
    trem.connect(g);
    g.connect(out);
    g.connect(verb);
    for (const n of ["E6", "B6"]) {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = noteHz(n);
      o.connect(trem);
      o.start(t0 + 0.02);
      o.stop(t0 + 0.82);
    }
    lfo.start(t0 + 0.02);
    lfo.stop(t0 + 0.82);
  }
}

function genHealChoir(ac: AudioContext, out: AudioNode, t0: number): void {
  // Healing Sparkles, ~2.2s with the reverb tail. Gentle and warm
  // rather than triumphant (Turn Undead's choir is the big one):
  //   1. Choir: high voices on a soft "ooh", an open G major (add9)
  //      chord that blooms into C major (add9) as the sparkles rise,
  //      a plagal "amen" lift.
  //   2. Harp: a quick plucked arpeggio rising underneath, the
  //      sparkles drifting up.
  //   3. Chime: a soft high bell as the heal lands.
  const verb = cathedralReverb(ac, out, 2.4, 0.5);
  const dry = ac.createGain();
  dry.gain.value = 0.75;
  dry.connect(out);

  // 1. Choir.
  choirChord(ac, dry, verb, ["G3", "D4", "A4", "B4"], t0, t0 + 0.55, 0.18, 0.18, 0.35, "oo");
  choirChord(ac, dry, verb, ["C4", "G4", "D5", "E5"], t0 + 0.5, t0 + 1.3, 0.22, 0.12, 0.7, "oo");

  // 2. Harp.
  ["G4", "B4", "D5", "G5", "B5", "D6"].forEach((n, i) => {
    const at = t0 + 0.05 + i * 0.07;
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = noteHz(n);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.08, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    o.connect(g);
    g.connect(dry);
    g.connect(verb);
    o.start(at);
    o.stop(at + 0.52);
  });

  // 3. Chime.
  bell(ac, dry, verb, noteHz("E6"), t0 + 0.5, 0.05);
}

function genShieldUp(ac: AudioContext, out: AudioNode, t0: number): void {
  // A magical barrier going up, ~1.6s with its tail. The visual raises
  // the dome for ~0.55s, then it locks:
  //   1. Charge: a warm detuned sawtooth pad (C3 G3 C4) through a
  //      low-pass sweeping open 250Hz → 3kHz, with a fast shimmering
  //      tremolo, energy gathering into the dome.
  //   2. Lock: a solid low "thoom" plus a crystalline chime chord
  //      (C6 G6 C7) as the barrier seals.
  //   3. Hum: two slightly detuned glassy sines beating slowly,
  //      ringing out through a reverb, the dome humming with power.
  const lock = 0.55;
  const verb = cathedralReverb(ac, out, 1.8, 0.4);
  const dry = ac.createGain();
  dry.gain.value = 0.85;
  dry.connect(out);

  // 1. Charge.
  {
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(250, t0);
    lp.frequency.exponentialRampToValueAtTime(3000, t0 + lock);
    const trem = ac.createGain();
    trem.gain.value = 0.7;
    const lfo = ac.createOscillator();
    lfo.frequency.setValueAtTime(12, t0);
    lfo.frequency.linearRampToValueAtTime(26, t0 + lock);
    const depth = ac.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(trem.gain);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + lock - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + lock + 0.12);
    lp.connect(trem).connect(g);
    g.connect(dry);
    g.connect(verb);
    for (const n of ["C3", "G3", "C4"]) {
      for (const det of [-7, 7]) {
        const o = ac.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(noteHz(n), t0);
        o.frequency.exponentialRampToValueAtTime(noteHz(n) * 1.06, t0 + lock);
        o.detune.value = det;
        o.connect(lp);
        o.start(t0);
        o.stop(t0 + lock + 0.15);
      }
    }
    lfo.start(t0);
    lfo.stop(t0 + lock + 0.15);
  }

  // 2. Lock.
  {
    const at = t0 + lock;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(75, at + 0.25);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.4, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(dry);
    o.start(at);
    o.stop(at + 0.32);
    bell(ac, dry, verb, noteHz("C6"), at, 0.07);
    bell(ac, dry, verb, noteHz("G6"), at + 0.01, 0.05);
    bell(ac, dry, verb, noteHz("C7"), at + 0.02, 0.035);
  }

  // 3. Hum.
  {
    const at = t0 + lock;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.0);
    g.connect(dry);
    g.connect(verb);
    for (const f of [noteHz("G5"), noteHz("G5") * 1.008]) {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      o.start(at);
      o.stop(at + 1.02);
    }
  }
}

function genGroundRift(ac: AudioContext, out: AudioNode, t0: number): void {
  // The ground tearing open for a summoning, ~2.2s with the tail. The
  // visual cracks for ~0.6s, then the pit opens and the creature rises:
  //   1. Rumble: deep brown noise and a trembling 42Hz sine, building
  //      as the cracks spread.
  //   2. Cracking: sharp, gritty snaps getting closer together, with a
  //      stone-grinding layer under them, the earth splitting.
  //   3. Opening: a deep "whumf" and a rush of air out of the pit.
  //   4. Moan: two ghostly voices on a soft "oo", gliding up a minor
  //      third with a slow wobble, rising out of the pit into reverb.
  //   5. Rattle: hollow bone-like knocks as the creature claws free.
  const open = 0.6;
  const verb = cathedralReverb(ac, out, 2.4, 0.45);
  const dry = ac.createGain();
  dry.gain.value = 0.85;
  dry.connect(out);

  // 1. Rumble.
  {
    const src = noiseSource(ac, open + 0.5, true);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.7, t0 + open);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + open + 0.5);
    src.connect(lp).connect(g).connect(dry);
    src.start(t0);
    src.stop(t0 + open + 0.52);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = 42;
    const am = ac.createGain();
    am.gain.value = 0.5;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 9;
    const lfoD = ac.createGain();
    lfoD.gain.value = 0.5;
    lfo.connect(lfoD).connect(am.gain);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.35, t0 + open);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + open + 0.3);
    o.connect(am).connect(og).connect(dry);
    for (const x of [o, lfo]) {
      x.start(t0);
      x.stop(t0 + open + 0.32);
    }
  }

  // 2. Cracking: snaps bunching up toward the opening.
  for (let i = 0; i < 16; i++) {
    const at = t0 + 0.04 + Math.pow(Math.random(), 0.6) * (open - 0.06);
    const len = 0.015 + Math.random() * 0.02;
    const src = noiseSource(ac, len);
    const shaper = ac.createWaveShaper();
    shaper.curve = clipCurve(4);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.5;
    bp.frequency.value = 900 + Math.random() * 2200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.12 + Math.random() * 0.18, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(shaper).connect(bp).connect(g).connect(dry);
    src.start(at);
    src.stop(at + len + 0.01);
  }
  {
    const src = noiseSource(ac, open);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 450;
    lp.Q.value = 2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.1);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + open - 0.05);
    for (let t = 0.15; t < open - 0.05; t += 0.03 + Math.random() * 0.03) {
      g.gain.setValueAtTime(0.06 + Math.random() * 0.16, t0 + t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + open + 0.05);
    src.connect(lp).connect(g).connect(dry);
    src.start(t0 + 0.1);
    src.stop(t0 + open + 0.06);
  }

  // 3. Opening.
  {
    const at = t0 + open;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.55, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    o.connect(g).connect(dry);
    o.start(at);
    o.stop(at + 0.47);
    const src = noiseSource(ac, 0.6);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1;
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(1600, at + 0.5);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, at);
    ng.gain.exponentialRampToValueAtTime(0.28, at + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    src.connect(bp).connect(ng);
    ng.connect(dry);
    ng.connect(verb);
    src.start(at);
    src.stop(at + 0.62);
  }

  // 4. Moan: two ghostly voices.
  {
    const at = t0 + open + 0.05;
    const end = at + 1.1;
    for (const [from, to, det] of [["A3", "C4", -10], ["E4", "G4", 12]] as const) {
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(noteHz(from), at);
      o.frequency.exponentialRampToValueAtTime(noteHz(to), at + 0.5);
      o.frequency.exponentialRampToValueAtTime(noteHz(to) * 0.94, end);
      o.detune.value = det;
      const vib = ac.createOscillator();
      vib.frequency.value = 4.5;
      const vd = ac.createGain();
      vd.gain.value = 22;
      vib.connect(vd).connect(o.detune);
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 520;
      bp.Q.value = 1.4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.16, at + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(bp).connect(g);
      g.connect(dry);
      g.connect(verb);
      for (const x of [o, vib]) {
        x.start(at);
        x.stop(end + 0.02);
      }
    }
  }

  // 5. Rattle: hollow, bone-like knocks.
  for (let i = 0; i < 12; i++) {
    const at = t0 + open + 0.15 + Math.random() * 0.7;
    const len = 0.03;
    const src = noiseSource(ac, len);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 9;
    bp.frequency.value = 1100 + Math.random() * 1400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.14, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(bp).connect(g).connect(dry);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

function genEnchantSpell(ac: AudioContext, out: AudioNode, t0: number): void {
  // An enchantment taking hold, ~2.3s with the tail. The visual
  // spirals in for ~0.7s, then blooms:
  //   1. Glissando: a harp-like run sweeping up a dreamy Lydian scale
  //      (with the raised fourth, F#), quickening as the orbits close.
  //   2. Voices: a soft choir swelling on a floating, unresolved chord
  //      (C, G, B, F#): mysterious rather than heroic.
  //   3. Swirl: an airy whoosh panning left and right faster and
  //      faster, the orbits circling the target.
  //   4. Bloom: a soft low pulse and a bright bell chord as the spell
  //      takes hold, ringing into the reverb.
  const bloom = 0.7;
  const verb = cathedralReverb(ac, out, 2.6, 0.55);
  const dry = ac.createGain();
  dry.gain.value = 0.75;
  dry.connect(out);

  // 1. Glissando: notes get closer together toward the bloom.
  const scale = ["C5", "D5", "E5", "F#5", "G5", "A5", "B5", "C6", "D6", "E6", "F#6", "G6"];
  scale.forEach((n, i) => {
    const u = i / (scale.length - 1);
    const at = t0 + bloom * (1 - Math.pow(1 - u, 0.6)) * 0.95;
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.value = noteHz(n);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06 + u * 0.03, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    o.connect(g);
    g.connect(dry);
    g.connect(verb);
    o.start(at);
    o.stop(at + 0.47);
  });

  // 2. Voices.
  choirChord(ac, dry, verb, ["C4", "G4", "B4", "F#5"], t0, t0 + bloom + 0.6, 0.16, bloom * 0.8, 0.9);

  // 3. Swirl.
  {
    const src = noiseSource(ac, bloom + 0.1);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.exponentialRampToValueAtTime(2800, t0 + bloom);
    const pan = ac.createStereoPanner();
    const lfo = ac.createOscillator();
    lfo.frequency.setValueAtTime(2, t0);
    lfo.frequency.exponentialRampToValueAtTime(9, t0 + bloom);
    const depth = ac.createGain();
    depth.gain.value = 0.8;
    lfo.connect(depth).connect(pan.pan);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + bloom - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + bloom + 0.1);
    src.connect(bp).connect(g).connect(pan);
    pan.connect(dry);
    pan.connect(verb);
    for (const x of [src, lfo]) {
      x.start(t0);
      x.stop(t0 + bloom + 0.12);
    }
  }

  // 4. Bloom.
  {
    const at = t0 + bloom;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, at);
    o.frequency.exponentialRampToValueAtTime(65, at + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    o.connect(g).connect(dry);
    o.start(at);
    o.stop(at + 0.37);
    bell(ac, dry, verb, noteHz("G5"), at, 0.06);
    bell(ac, dry, verb, noteHz("B5"), at + 0.015, 0.045);
    bell(ac, dry, verb, noteHz("F#6"), at + 0.03, 0.035);
  }
}

function genTeleportBlink(ac: AudioContext, out: AudioNode, t0: number): void {
  // A teleport, ~1.3s with the tail. Matches the visual: the caster is
  // pulled into a portal for ~0.22s, streaks across for ~0.22s, then
  // bursts out of a second portal:
  //   1. Suck-in: noise rising in pitch into a hard cut, with an upward
  //      sine "fwoop" as the portal swallows the caster.
  //   2. Zip: a whooshing streak plus a gliding tone that sweeps from
  //      one ear to the other as the light crosses the battlefield.
  //   3. Arrival: a bright "shwing" (a noise burst and a bell pair) over
  //      a soft thump, shimmering into a short reverb.
  const zip = 0.22;
  const land = 0.44;
  const verb = cathedralReverb(ac, out, 1.6, 0.4);
  const dry = ac.createGain();
  dry.gain.value = 0.85;
  dry.connect(out);

  // 1. Suck-in.
  {
    const src = noiseSource(ac, zip);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t0);
    bp.frequency.exponentialRampToValueAtTime(4000, t0 + zip);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + zip - 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + zip);
    src.connect(bp).connect(g).connect(dry);
    src.start(t0);
    src.stop(t0 + zip + 0.01);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(200, t0 + 0.06);
    o.frequency.exponentialRampToValueAtTime(1600, t0 + zip);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t0 + 0.06);
    og.gain.exponentialRampToValueAtTime(0.18, t0 + zip - 0.01);
    og.gain.linearRampToValueAtTime(0, t0 + zip);
    o.connect(og).connect(dry);
    o.start(t0 + 0.06);
    o.stop(t0 + zip + 0.01);
  }

  // 2. Zip, panned left → right.
  {
    const at = t0 + zip;
    const pan = ac.createStereoPanner();
    pan.pan.setValueAtTime(-0.8, at);
    pan.pan.linearRampToValueAtTime(0.8, at + land - zip);
    pan.connect(dry);
    pan.connect(verb);
    const src = noiseSource(ac, land - zip + 0.05);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(3200, at);
    bp.frequency.exponentialRampToValueAtTime(1200, at + land - zip);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + land - zip + 0.04);
    src.connect(bp).connect(g).connect(pan);
    src.start(at);
    src.stop(at + land - zip + 0.05);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(2400, at);
    o.frequency.exponentialRampToValueAtTime(800, at + land - zip);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(0.08, at + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, at + land - zip);
    o.connect(og).connect(pan);
    o.start(at);
    o.stop(at + land - zip + 0.02);
  }

  // 3. Arrival.
  {
    const at = t0 + land;
    const src = noiseSource(ac, 0.25);
    const hp = ac.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(6000, at);
    hp.frequency.exponentialRampToValueAtTime(2500, at + 0.25);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    src.connect(hp).connect(g);
    g.connect(dry);
    g.connect(verb);
    src.start(at);
    src.stop(at + 0.26);
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(60, at + 0.2);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(0.3, at + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.connect(og).connect(dry);
    o.start(at);
    o.stop(at + 0.27);
    bell(ac, dry, verb, noteHz("E6"), at, 0.06);
    bell(ac, dry, verb, noteHz("B6"), at + 0.02, 0.04);
  }
}

function genPitFall(ac: AudioContext, out: AudioNode, t0: number): void {
  // The floor giving way and the party dropping, ~0.55s (the fall
  // animation plays for ~0.45s before the floor changes):
  //   1. Crack: splintering boards / crumbling stone, a few sharp
  //      gritty snaps.
  //   2. Drop: a whistle falling 900Hz → 140Hz, the party plunging.
  //   3. Rush: noise through a band-pass sweeping down, air rushing
  //      past as they fall.
  const end = 0.55;
  for (let i = 0; i < 6; i++) {
    const at = t0 + Math.random() * 0.12;
    const len = 0.02 + Math.random() * 0.02;
    const src = noiseSource(ac, len);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.value = 700 + Math.random() * 1800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.15, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(bp).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  }
  {
    const o = ac.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(900, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(140, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    o.connect(g).connect(out);
    o.start(t0 + 0.05);
    o.stop(t0 + end + 0.02);
  }
  {
    const src = noiseSource(ac, end);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(350, t0 + end);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + end + 0.01);
  }
}

function genPitLand(ac: AudioContext, out: AudioNode, t0: number): void {
  // The party hitting the floor below, ~0.8s: a heavy body thud, a
  // gear-and-grit clatter, and dust and pebbles settling.
  {
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.22);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.3);
  }
  {
    const src = noiseSource(ac, 0.18);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2200, t0);
    lp.frequency.exponentialRampToValueAtTime(300, t0 + 0.18);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.2);
  }
  for (let i = 0; i < 10; i++) {
    const at = t0 + 0.06 + Math.pow(Math.random(), 1.3) * 0.6;
    const len = 0.012 + Math.random() * 0.012;
    const src = noiseSource(ac, len);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 4;
    bp.frequency.value = 600 + Math.random() * 2400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime((0.06 + Math.random() * 0.1) * (1 - (at - t0) / 0.8), at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(bp).connect(g).connect(out);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

function genHeal(ac: AudioContext, out: AudioNode, t0: number): void {
  // Gentle ascending arpeggio: C5 → E5 → G5 → C6 (square 25% duty).
  const seq = ["C5", "E5", "G5", "C6"];
  for (let i = 0; i < seq.length; i++) {
    tone(ac, out, noteHz(seq[i]), t0 + i * 0.08, 0.08, 0.20, "square", 0.005, 0.04);
  }
}

function genMonsterHit(ac: AudioContext, out: AudioNode, t0: number): void {
  tone(ac, out, 80, t0, 0.06, 0.35, "triangle", 0.002, 0.04);
  noise(ac, out, t0, 0.06, 0.25, 0.002, 0.04);
}

function genPlayerHurt(ac: AudioContext, out: AudioNode, t0: number): void {
  sweep(ac, out, 500, 150, t0, 0.15, 0.25, "square");
  noise(ac, out, t0, 0.05, 0.30, 0.002, 0.03);
}

function genVictory(ac: AudioContext, out: AudioNode, t0: number): void {
  const seq = ["C4", "E4", "G4", "C5", "E5", "G5", "C6"];
  for (let i = 0; i < seq.length; i++) {
    tone(ac, out, noteHz(seq[i]), t0 + i * 0.10, 0.10, 0.25, "square", 0.005, 0.05);
  }
}

function genDefeat(ac: AudioContext, out: AudioNode, t0: number): void {
  const seq = ["C4", "B3", "A3", "G3", "F3", "E3", "D3", "C3"];
  for (let i = 0; i < seq.length; i++) {
    tone(ac, out, noteHz(seq[i]), t0 + i * 0.15, 0.15, 0.25, "triangle", 0.01, 0.10);
  }
}

function genShield(ac: AudioContext, out: AudioNode, t0: number): void {
  // Crystalline ascending shimmer + bright chime.
  const seq = ["C5", "E5", "G5"];
  for (let i = 0; i < seq.length; i++) {
    tone(ac, out, noteHz(seq[i]), t0 + i * 0.08, 0.08, 0.18, "triangle", 0.005, 0.05);
  }
  tone(ac, out, noteHz("C6"), t0 + 0.24, 0.15, 0.15, "triangle", 0.005, 0.12);
  tone(ac, out, noteHz("E6"), t0 + 0.24, 0.12, 0.10, "triangle", 0.01, 0.10);
}

function genTurnUndead(ac: AudioContext, out: AudioNode, t0: number): void {
  // Holy chord → rising sweep → bright high-octave blast + crackle.
  const dur1 = 0.18;
  tone(ac, out, noteHz("C4"), t0, dur1, 0.12, "triangle", 0.01, 0.12);
  tone(ac, out, noteHz("E4"), t0, dur1, 0.10, "triangle", 0.01, 0.12);
  tone(ac, out, noteHz("G4"), t0, dur1, 0.10, "triangle", 0.01, 0.12);
  sweep(ac, out, noteHz("C5"), noteHz("C6"), t0 + 0.18, 0.15, 0.15, "square");
  const dur2 = 0.20;
  tone(ac, out, noteHz("C6"), t0 + 0.33, dur2, 0.14, "triangle", 0.005, 0.15);
  tone(ac, out, noteHz("E6"), t0 + 0.33, dur2, 0.12, "triangle", 0.005, 0.15);
  tone(ac, out, noteHz("G6"), t0 + 0.33, dur2, 0.10, "triangle", 0.005, 0.15);
  noise(ac, out, t0 + 0.33, 0.08, 0.08, 0.002, 0.06);
}

function genMagicBurst(ac: AudioContext, out: AudioNode, t0: number): void {
  // Used by Magic Arrow / Magic Dart in spells.json. Bright zap + sparkle.
  sweep(ac, out, 200, 1100, t0, 0.10, 0.20, "square");
  tone(ac, out, noteHz("E6"), t0 + 0.10, 0.08, 0.16, "triangle", 0.003, 0.06);
  tone(ac, out, noteHz("A6"), t0 + 0.16, 0.06, 0.14, "triangle", 0.003, 0.05);
}

function genLockPickSuccess(ac: AudioContext, out: AudioNode, t0: number): void {
  const freqs = [800, 1000, 1200, 1500];
  for (let i = 0; i < freqs.length; i++) {
    tone(ac, out, freqs[i], t0 + i * 0.07, 0.03, 0.20, "square", 0.001, 0.02);
  }
  tone(ac, out, 200, t0 + freqs.length * 0.07, 0.08, 0.30, "triangle", 0.002, 0.05);
}

function genEncounter(ac: AudioContext, out: AudioNode, t0: number): void {
  tone(ac, out, 900, t0, 0.06, 0.30, "square", 0.001, 0.03);
  noise(ac, out, t0, 0.08, 0.20, 0.002, 0.05);
  sweep(ac, out, 700, 200, t0 + 0.08, 0.18, 0.25, "square");
}

function genChirp(ac: AudioContext, out: AudioNode, t0: number): void {
  tone(ac, out, noteHz("E5"), t0, 0.05, 0.18, "square", 0.002, 0.03);
  tone(ac, out, noteHz("A5"), t0 + 0.05, 0.07, 0.18, "square", 0.002, 0.04);
}

/** Exploration-log chime — a soft two-note bell (B5 → E6) with a faint
 *  octave shimmer. Quiet on purpose: it plays on every notable log
 *  line, so it has to sit under pickups, fanfares and the soundtrack. */
function genLogChime(ac: AudioContext, out: AudioNode, t0: number): void {
  tone(ac, out, noteHz("B5"), t0, 0.22, 0.09, "triangle", 0.004, 0.15);
  tone(ac, out, noteHz("E6"), t0 + 0.07, 0.34, 0.08, "triangle", 0.004, 0.22);
  tone(ac, out, noteHz("E7"), t0 + 0.07, 0.2, 0.025, "sine", 0.004, 0.15);
}

function genRestComplete(ac: AudioContext, out: AudioNode, t0: number): void {
  // "Camp rest complete" cue. Three beats:
  //   1. A low triangle bed (~G3) opening softly — settles the ear,
  //      reads as "resting".
  //   2. A faint noise wash riding underneath the first half-second —
  //      the suggestion of a small fire crackling without sounding
  //      anything like the combat noise bursts.
  //   3. A gentle ascending major-third chime (G5 → B5 → D6) that
  //      finishes on a sustained high note — the "we're rested,
  //      let's go" wake-up beat. Triangle voice keeps it warm and
  //      avoids the harsher square-wave timbre the combat SFX use.
  tone(ac, out, noteHz("G3"), t0,       0.55, 0.12, "triangle", 0.06, 0.30);
  noise(ac, out,                t0,       0.45, 0.05,                0.04, 0.30);
  const chime = ["G5", "B5", "D6"];
  for (let i = 0; i < chime.length; i++) {
    tone(
      ac, out, noteHz(chime[i]),
      t0 + 0.30 + i * 0.10,
      0.18, 0.16, "triangle", 0.01, 0.12,
    );
  }
  // Sustained top note — held a touch longer so the cue tails off
  // naturally instead of cutting on the last arpeggio step.
  tone(ac, out, noteHz("D6"), t0 + 0.62, 0.45, 0.14, "triangle", 0.01, 0.30);
  tone(ac, out, noteHz("G6"), t0 + 0.62, 0.45, 0.08, "triangle", 0.01, 0.30);
}

function genBuy(ac: AudioContext, out: AudioNode, t0: number): void {
  // Counter "buy" cue. Reads as "item set on the counter":
  //   1. A low, short triangle thump (~F3) suggesting weight landing
  //      on wood — anchors the action with body, not melody.
  //   2. A single mid-bright square chime on top (~B4) acknowledging
  //      the transaction without sounding like victory or healing.
  // Kept under ~0.20s total so the player can buy multiple items in
  // quick succession without notes piling up. Voices intentionally
  // different from the sell cue so a player rebuying after a sell
  // hears the direction change.
  tone(ac, out, noteHz("F3"), t0,        0.08, 0.22, "triangle", 0.002, 0.06);
  tone(ac, out, noteHz("B4"), t0 + 0.04, 0.10, 0.18, "square",   0.003, 0.07);
}

function genSell(ac: AudioContext, out: AudioNode, t0: number): void {
  // Counter "sell" cue. Twin high pings spaced just enough to read
  // as two coins dropping into the till — bright, fast, distinct
  // from the buy cue's woodier thump. Triangle voice keeps the
  // tone clean so it doesn't blend with combat hit SFX. Total
  // length stays under 0.20s so rapid-fire sells don't overlap
  // themselves into a buzz.
  tone(ac, out, noteHz("C6"), t0,        0.06, 0.18, "triangle", 0.001, 0.04);
  tone(ac, out, noteHz("E6"), t0 + 0.06, 0.07, 0.18, "triangle", 0.001, 0.05);
}

function genChestOpen(ac: AudioContext, out: AudioNode, t0: number): void {
  // Treasure-chest "Open" cue. Two beats stacked into ~0.7s so the
  // dialog can dismiss without the SFX getting cut off:
  //   1. Lid creak — a brief noise wash plus a low triangle sweep
  //      rising from ~120Hz to ~280Hz. Reads as wood scraping
  //      against wood; intentionally short so it doesn't sound like
  //      the noisier combat hit SFX.
  //   2. Ascending arpeggio (C5 → E5 → G5 → C6) on a triangle
  //      voice — the "loot revealed" beat. Triangle keeps it warm
  //      and clearly different from the brighter square-wave
  //      level-up arpeggio, which has a similar shape but a more
  //      triumphant timbre. A held E6 sparkle on top finishes the
  //      cue so it tails off naturally instead of cutting on the
  //      last arpeggio step.
  noise(ac, out, t0, 0.08, 0.10, 0.005, 0.05);
  sweep(ac, out, 120, 280, t0, 0.10, 0.15, "triangle");
  const seq = ["C5", "E5", "G5", "C6"];
  for (let i = 0; i < seq.length; i++) {
    tone(
      ac, out, noteHz(seq[i]),
      t0 + 0.12 + i * 0.08,
      0.10, 0.20, "triangle", 0.005, 0.06,
    );
  }
  tone(ac, out, noteHz("E6"), t0 + 0.50, 0.18, 0.14, "triangle", 0.005, 0.14);
}

function genStoneSlide(ac: AudioContext, out: AudioNode, t0: number): void {
  // Pressure-plate cue — heavy stone grinding across a floor, ~0.8s:
  //   1. The grind body: a sustained noise wash pushed through a
  //      low-pass filter (~420Hz, sweeping down to ~260Hz) so the
  //      white noise reads as stone-on-stone friction instead of the
  //      bright hiss the combat bursts use. Slow attack — the slab
  //      has to overcome friction before it moves.
  //   2. A very low triangle rumble sweeping 95Hz → 60Hz underneath,
  //      giving the slab physical weight.
  //   3. A soft low "settle" thunk at the end as the stone comes to
  //      rest.
  // The filter is built inline because the shared noise() helper is
  // unfiltered by design — this is the only cue (so far) that wants
  // shaped noise; promote a filteredNoise() helper if a second one
  // appears.
  const dur = 0.6;
  const sampleCount = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, sampleCount, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(420, t0);
  filter.frequency.linearRampToValueAtTime(260, t0 + dur);
  filter.Q.value = 0.8;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.34, t0 + 0.08);
  env.gain.setValueAtTime(0.34, t0 + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
  // Weight under the grind.
  sweep(ac, out, 95, 60, t0, dur, 0.20, "triangle");
  // Settling thunk.
  tone(ac, out, 70, t0 + dur, 0.09, 0.26, "triangle", 0.003, 0.06);
}

function genLevelUp(ac: AudioContext, out: AudioNode, t0: number): void {
  // Bright triumphant arpeggio with a sparkle tail.
  const seq = ["C5", "E5", "G5", "C6"];
  for (let i = 0; i < seq.length; i++) {
    tone(ac, out, noteHz(seq[i]), t0 + i * 0.07, 0.10, 0.22, "triangle", 0.005, 0.05);
  }
  // Held bright chord on top.
  const t1 = t0 + seq.length * 0.07;
  tone(ac, out, noteHz("C6"), t1, 0.32, 0.18, "triangle", 0.01, 0.18);
  tone(ac, out, noteHz("E6"), t1, 0.32, 0.14, "triangle", 0.01, 0.18);
  tone(ac, out, noteHz("G6"), t1, 0.32, 0.10, "triangle", 0.01, 0.18);
  // High-octave shimmer at the end.
  tone(ac, out, noteHz("C7"), t1 + 0.14, 0.18, 0.12, "triangle", 0.005, 0.18);
}

type Generator = (ac: AudioContext, out: AudioNode, t0: number) => void;

const GENERATORS: Record<string, Generator> = {
  // Core combat
  sword_hit:          genSwordHit,
  melee_hit:          genSwordHit,    // alias
  miss:               genMiss,
  critical:           genCritical,
  arrow:              genArrow,
  monster_hit:        genMonsterHit,
  player_hurt:        genPlayerHurt,
  // Spell-driven (names match spells.json sfx / hit_sfx)
  fireball:           genFireball,
  flamethrower:       genFlamethrower,
  fire_explosion:     genFireExplosion,
  explosion:          genExplosion,
  electric_zap:       genElectricZap,
  thunder_crack:      genThunderCrack,
  breath_roar:        genBreathRoar,
  fire_engulf:        genFireEngulf,
  void_hum:           genVoidHum,
  void_burst:         genVoidBurst,
  small_explosion:    genSmallExplosion,
  meteor_fall:        genMeteorFall,
  meteor_impact:      genMeteorImpact,
  holy_choir:         genHolyChoir,
  holy_smite:         genHolySmite,
  curse_hex:          genCurseHex,
  arcane_arrow_cast:  genArcaneArrowCast,
  arcane_arrow_hit:   genArcaneArrowHit,
  heal_choir:         genHealChoir,
  shield_up:          genShieldUp,
  ground_rift:        genGroundRift,
  enchant_spell:      genEnchantSpell,
  teleport_blink:     genTeleportBlink,
  pit_fall:           genPitFall,
  pit_land:           genPitLand,
  heal:               genHeal,
  shield:             genShield,
  turn_undead:        genTurnUndead,
  magic_burst:        genMagicBurst,
  lock_pick_success:  genLockPickSuccess,
  // Encounter-state
  victory:            genVictory,
  defeat:             genDefeat,
  encounter:          genEncounter,
  chirp:              genChirp,
  // Exploration log — a notable line just landed in the side panel.
  log_chime:          genLogChime,
  level_up:           genLevelUp,
  // Item-driven
  rest_complete:      genRestComplete,
  // World mechanisms — pressure plates (PlayHost plays this on both
  // press and release; the same slab grinds either way).
  stone_slide:        genStoneSlide,
  // Treasure-chest "Open" cue — heard from the chest dialog when
  // the player commits to opening (or curiosity-opening an empty
  // chest). Distinct timbre from level_up / victory so the player
  // can tell a loot grab apart from a milestone.
  chest_open:         genChestOpen,
  // Town / shop transactions — heard from the counter shop overlay
  // on a successful buy or sell. Distinct from one another so the
  // player can hear which direction the transaction went without
  // looking at the gold readout.
  buy:                genBuy,
  sell:               genSell,
};

/** Names of all SFX known to the catalog — handy for tests. */
export const SFX_NAMES = Object.freeze(Object.keys(GENERATORS));

export const Sfx = {
  /** Play a named SFX. Unknown names and audio-less environments are no-ops. */
  play(name: string | undefined | null): void {
    if (!name || _muted) return;
    const gen = GENERATORS[name];
    if (!gen) return;
    const ac = ctx();
    if (!ac) return;
    // Browser autoplay policy: contexts created before a user gesture
    // start in `suspended`. resume() returns a promise; we fire-and-
    // forget — if it resolves later, future plays will sound, and
    // missing this one note is acceptable.
    if (ac.state === "suspended") {
      ac.resume().catch(() => undefined);
    }
    try {
      const master = masterFor(ac);
      gen(ac, master, ac.currentTime);
    } catch {
      // Audio failures are never fatal — drop silently.
    }
  },

  /** Whether the catalog knows this name (used for diagnostics). */
  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(GENERATORS, name);
  },

  /** Mute or unmute every future SFX. Persists to localStorage. */
  setMuted(value: boolean): void {
    _muted = !!value;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, _muted ? "1" : "0");
    }
  },

  get muted(): boolean {
    return _muted;
  },
};

/** Test-only escape hatch: drop the cached AudioContext between runs. */
export function _resetSfx(): void {
  if (_ctx) {
    try { _ctx.close(); } catch { /* ignore */ }
    _ctx = null;
  }
}
