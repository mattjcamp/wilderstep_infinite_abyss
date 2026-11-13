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
