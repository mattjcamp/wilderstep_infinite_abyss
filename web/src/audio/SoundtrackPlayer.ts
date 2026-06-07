/**
 * Background music player — module / map / dungeon soundtrack.
 *
 * Authors define a `soundtrack: string[]` on the module (the default
 * playlist), on individual maps (override per-map), and on dungeons
 * (override per-dungeon). The host calls `setPlaylist(urls)` whenever
 * the active scope changes; the player picks a random track from the
 * list, streams it via an HTMLAudioElement, and rolls onto another
 * random pick when the track ends. With a single-track playlist it
 * loops that one track; with multiple tracks it avoids playing the
 * same track twice in a row.
 *
 * Why HTMLAudioElement (not Web Audio API like Sfx.ts):
 *
 *   - Streaming an MP3 / OGG via `new Audio(url)` is one line and
 *     covers every common encoding browsers ship.
 *   - We don't need per-sample precision the way Sfx (chiptune
 *     squares / triangles + envelopes) does — the soundtrack is a
 *     pre-rendered piece, just play it.
 *   - The `ended` event is exactly the hook we need for "pick the
 *     next track on completion."
 *
 * Browser autoplay restriction: most browsers refuse `audio.play()`
 * until the page has seen a user gesture (a click / key press). The
 * player swallows the rejected promise so a failed first attempt
 * doesn't surface as an uncaught error; the next `play()` call after
 * a gesture will succeed. PlayHost wires `play()` to user-driven
 * mount + the first move's `moved` event, so the soundtrack starts
 * the moment the player steps into the world.
 *
 * Persistence: the mute flag lives in localStorage so a refresh
 * remembers it. Volume is in-memory only — the player ships at a
 * comfortable default that doesn't drown out SFX.
 *
 * Per-track gain: some tracks are mastered louder than others. The
 * audio catalog (/audio/index.json) can carry an optional `gain`
 * (0..1) per track; the player loads it once and folds it into the
 * effective volume — `el.volume = userVolume * trackGain` — so a
 * too-loud track sits level with the rest without the player having
 * to ride the master volume slider. Authors set these in the
 * Soundtrack editor.
 *
 * Fades: transitions between tracks are eased with a brief volume
 * ramp rather than a hard cut. A new track fades up from silence to
 * its effective volume; a track nearing its end (or being replaced by
 * a scope change) fades down to silence first. Fades always ramp
 * toward the gain-aware target, so per-track levelling and the master
 * volume are respected throughout. An explicit volume / mute change
 * cancels any in-flight fade and snaps to the new target.
 */

import { withBasePath } from "@/util/basePath";

const STORAGE_KEY = "wsia.soundtrack.muted";
const VOLUME_KEY = "wsia.soundtrack.volume";
/** Default volume — moderate so sound effects ride on top of it. */
const DEFAULT_VOLUME = 0.5;
/** Fade duration (ms) for track-to-track transitions. Brief on
 *  purpose — long enough to soften the seam, short enough not to
 *  feel like a gap. */
const FADE_MS = 600;
/** Step interval (ms) for the fade ramp. ~20 steps over FADE_MS —
 *  smooth to the ear without flooding the event loop. */
const FADE_STEP_MS = 30;

let _audio: HTMLAudioElement | null = null;
let _playlist: ReadonlyArray<string> = [];
/** Index of the most recently-started track. `null` while idle.
 *  Used to bias `pickNextIndex` away from the previous track when
 *  the playlist has more than one entry. */
let _lastIndex: number | null = null;
/** True while the player intends to be sounding. Pauses on stop /
 *  mute, picks back up when `play()` is called again. Independent
 *  from the audio element's `paused` state because the element may
 *  also be paused while a track loads. */
let _playing = false;

/** Handle for the in-flight fade ramp (setInterval id), or null. */
let _fadeHandle: ReturnType<typeof setInterval> | null = null;
/** Guards the end-of-track fade so a single track only kicks off one
 *  fade-out as it approaches its end. Reset when a new track starts. */
let _endFadeStarted = false;

let _muted = (() => {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
})();

let _volume = (() => {
  if (typeof localStorage === "undefined") return DEFAULT_VOLUME;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw == null) return DEFAULT_VOLUME;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
})();

/** Authored per-track gain, keyed by the catalog path (e.g.
 *  "/audio/foo.mp3"). Populated lazily from /audio/index.json the
 *  first time the player is used. Missing entries default to 1. */
const _gainByPath = new Map<string, number>();
let _gainsLoaded = false;
let _gainsInflight: Promise<void> | null = null;

/** Effective gain for the currently-loaded track. 1 when unknown
 *  (catalog not loaded yet, or the track carries no override). */
function currentTrackGain(): number {
  if (_lastIndex == null) return 1;
  const url = _playlist[_lastIndex];
  if (!url) return 1;
  const g = _gainByPath.get(url);
  return typeof g === "number" && Number.isFinite(g) ? g : 1;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The volume the current track should ultimately sit at:
 *  `muted ? 0 : userVolume * trackGain`. Fades ramp toward this. */
function targetVolume(): number {
  return _muted ? 0 : clamp01(_volume * currentTrackGain());
}

/** Stop any in-flight fade ramp. */
function cancelFade(): void {
  if (_fadeHandle != null) {
    clearInterval(_fadeHandle);
    _fadeHandle = null;
  }
}

/** Push the effective volume onto the audio element immediately,
 *  cancelling any fade in progress. Single chokepoint for explicit
 *  changes — mute, master volume, per-track gain — that should snap
 *  rather than ramp. */
function applyVolume(): void {
  cancelFade();
  const el = _audio;
  if (!el) return;
  el.volume = targetVolume();
}

/** Ramp the element's volume to `target` over `ms`, then run `done`.
 *  Cancels any prior fade. Falls back to an instant set when there's
 *  no element, no timer environment, or a zero/no-op duration. */
function fadeTo(target: number, ms: number, done?: () => void): void {
  cancelFade();
  const el = _audio;
  if (!el) {
    done?.();
    return;
  }
  const to = clamp01(target);
  const from = clamp01(el.volume);
  if (
    typeof setInterval === "undefined" ||
    ms <= 0 ||
    Math.abs(to - from) < 0.001
  ) {
    el.volume = to;
    done?.();
    return;
  }
  const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
  let i = 0;
  _fadeHandle = setInterval(() => {
    i += 1;
    el.volume = clamp01(from + (to - from) * (i / steps));
    if (i >= steps) {
      el.volume = to;
      cancelFade();
      done?.();
    }
  }, FADE_STEP_MS);
}

/** Fetch /audio/index.json once and cache each track's gain. Safe to
 *  call repeatedly — only the first call hits the network. Re-applies
 *  the volume on completion so a track already playing picks up its
 *  gain as soon as the catalog arrives. No-op outside the browser. */
function ensureGainsLoaded(): void {
  if (_gainsLoaded || _gainsInflight) return;
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  _gainsInflight = fetch(withBasePath("/audio/index.json"))
    .then((r) => (r.ok ? r.json() : null))
    .then((idx: unknown) => {
      const tracks =
        idx && typeof idx === "object" && Array.isArray((idx as { tracks?: unknown }).tracks)
          ? ((idx as { tracks: Array<{ path?: unknown; gain?: unknown }> }).tracks)
          : [];
      for (const t of tracks) {
        if (t && typeof t.path === "string" && Number.isFinite(t.gain as number)) {
          _gainByPath.set(t.path, Math.max(0, Math.min(1, Number(t.gain))));
        }
      }
      _gainsLoaded = true;
      // Re-level a track that's already playing — but don't stomp an
      // in-flight fade (it already ramps toward the gain-aware
      // target and will land correctly).
      if (_fadeHandle == null) applyVolume();
    })
    .catch(() => {
      // Catalog missing / malformed → every track plays at gain 1.
      _gainsLoaded = true;
    })
    .finally(() => {
      _gainsInflight = null;
    });
}

/** Acquire the shared HTMLAudioElement, lazily building it on first
 *  use. Returns `null` when there's no `window` (SSR / Node test). */
function audioEl(): HTMLAudioElement | null {
  if (_audio) return _audio;
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  const el = new Audio();
  el.preload = "auto";
  _audio = el;
  // Load per-track gains in the background; applyVolume re-runs when
  // they arrive.
  ensureGainsLoaded();
  applyVolume();
  // When a track finishes, slide into the next random pick (which
  // fades in). Defensive against an empty / single-track playlist
  // (handled in pickNextIndex).
  el.addEventListener("ended", () => {
    if (!_playing) return;
    startRandom();
  });
  // Fade the current track down as it approaches its end so the seam
  // into the next track is a soft dip-and-rise rather than a hard
  // cut. Guarded by `_endFadeStarted` so it fires once per track; the
  // `ended` handler then rolls into the next pick.
  el.addEventListener("timeupdate", () => {
    if (!_playing || _muted || _endFadeStarted) return;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const remainingMs = (d - el.currentTime) * 1000;
    if (remainingMs > 0 && remainingMs <= FADE_MS) {
      _endFadeStarted = true;
      fadeTo(0, Math.min(FADE_MS, remainingMs));
    }
  });
  // Surface playback errors (404, codec, CORS) so the player can
  // see why a track isn't playing instead of sitting silently.
  // Cheap to leave wired since the event only fires on actual
  // failure.
  el.addEventListener("error", () => {
    // eslint-disable-next-line no-console
    console.warn(
      "[soundtrack] audio error",
      { src: el.src, code: el.error?.code, message: el.error?.message },
    );
  });
  return el;
}

/** Pick the next index to play. Returns `-1` when the playlist is
 *  empty. With a multi-entry list, avoids returning `_lastIndex` so
 *  the same track doesn't immediately repeat. */
function pickNextIndex(): number {
  const n = _playlist.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  let idx = Math.floor(Math.random() * n);
  // Re-roll once if we landed on the previous track. One rejection
  // pass is enough to make repeats rare without infinite looping on
  // a degenerate RNG.
  if (idx === _lastIndex) {
    idx = (idx + 1) % n;
  }
  return idx;
}

/** Internal: load + start the track at `pickNextIndex()`. No-op on
 *  empty playlist. Swallows the play()-rejected promise so failed
 *  autoplay attempts don't bubble up. */
function startRandom(): void {
  const idx = pickNextIndex();
  if (idx < 0) return;
  const el = audioEl();
  if (!el) return;
  _lastIndex = idx;
  // Apply the deploy basePath. Authored paths live under `/audio/...`
  // but on GH Pages the real URL is `/wilderstep_infinite_abyss/audio/...`;
  // <audio src> doesn't auto-apply the basePath the way Next's
  // <Link>/<Image> do, so we route through the helper. In local dev
  // basePath is empty and the path passes through untouched.
  el.src = withBasePath(_playlist[idx]);
  el.currentTime = 0;
  // Fresh track: re-arm the end-of-track fade guard and start from
  // silence so we can ramp up. fadeTo ramps toward the gain-aware
  // target, so per-track levelling is respected.
  _endFadeStarted = false;
  cancelFade();
  el.volume = 0;
  // Browser autoplay policy: the first play after a fresh page load
  // may reject until the user has interacted. Warn but swallow —
  // the next user-triggered play() call will succeed.
  el.play()
    .then(() => fadeTo(targetVolume(), FADE_MS))
    .catch((err: unknown) => {
      // Autoplay blocked: don't leave the element stuck at 0 — set
      // the target directly so a later resume isn't silent.
      el.volume = targetVolume();
      // eslint-disable-next-line no-console
      console.warn(
        "[soundtrack] play() rejected — likely autoplay policy",
        err instanceof Error ? err.message : err,
      );
    });
}

/**
 * Swap in a new playlist. If the new list is empty, the player
 * stops and clears its source. If the currently-playing track is
 * still in the new list, playback continues; otherwise the player
 * picks a fresh random track from the new list (only when
 * `_playing` is true — a stopped player waits for an explicit
 * `play()` call so the host can defer audio start until the first
 * user gesture).
 */
export function setPlaylist(urls: ReadonlyArray<string>): void {
  const clean = urls.filter(
    (u) => typeof u === "string" && u.trim().length > 0,
  );
  // Identity-stable swap when nothing changed — avoids re-rolling
  // the current track on a save that pings setPlaylist with the
  // same data.
  const sameAsCurrent =
    clean.length === _playlist.length &&
    clean.every((u, i) => u === _playlist[i]);
  if (sameAsCurrent) return;

  _playlist = clean;
  const el = audioEl();
  if (clean.length === 0) {
    _lastIndex = null;
    if (el) {
      // Fade out before clearing so leaving a scored area doesn't
      // cut to silence abruptly.
      fadeTo(0, FADE_MS, () => {
        el.pause();
        el.removeAttribute("src");
      });
    }
    return;
  }
  // If the previously-playing track is still in the new list, keep
  // playing it (point _lastIndex at its new position). Otherwise
  // restart with a fresh random pick if we were playing.
  const prevSrc = el?.src ?? null;
  const stillThere = prevSrc
    ? clean.findIndex((u) => u === prevSrc || prevSrc.endsWith(u))
    : -1;
  if (stillThere >= 0) {
    _lastIndex = stillThere;
    return;
  }
  if (_playing) {
    // Scope change to a different track: fade the outgoing track down,
    // then startRandom fades the incoming one up.
    fadeTo(0, FADE_MS, () => startRandom());
  }
}

/** Begin playback. Idempotent: calling again while already playing
 *  is a no-op. With an empty playlist this is a no-op too. */
export function play(): void {
  if (_playing) return;
  if (_playlist.length === 0) return;
  _playing = true;
  const el = audioEl();
  if (!el) return;
  // Resume the in-flight track when one is loaded; otherwise pick a
  // fresh random one. `el.src` is set the first time startRandom
  // runs — before that, paused + no src means "start something".
  if (el.src && el.paused) {
    el.play().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        "[soundtrack] resume rejected",
        err instanceof Error ? err.message : err,
      );
    });
  } else if (!el.src) {
    startRandom();
  }
}

/** Pause playback. Keeps the current src loaded so a subsequent
 *  `play()` resumes where the track left off (rather than picking a
 *  brand-new random one). Idempotent. */
export function pause(): void {
  if (!_playing) return;
  _playing = false;
  const el = audioEl();
  if (el) el.pause();
}

/** Stop playback completely. Clears the current track so the next
 *  `play()` rolls a fresh random pick. Used when leaving a scope
 *  entirely (e.g. unmounting the play host). */
export function stop(): void {
  _playing = false;
  _lastIndex = null;
  const el = audioEl();
  if (el) {
    // Fade out, then clear — but only if we're still stopped when the
    // ramp finishes, so a quick stop→play (e.g. a remount) doesn't get
    // its fresh track yanked out from under it.
    fadeTo(0, FADE_MS, () => {
      if (!_playing) {
        el.pause();
        el.removeAttribute("src");
      }
    });
  }
}

/** Set the mute flag. Persisted so the player remembers across
 *  reloads. When muted the audio element's volume is forced to 0
 *  rather than calling `pause` — that way the track keeps streaming
 *  in the background, ready to come back when the player unmutes. */
export function setMuted(b: boolean): void {
  _muted = b;
  if (typeof localStorage !== "undefined") {
    if (b) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  }
  audioEl();
  applyVolume();
}

/** Current mute state. */
export function isMuted(): boolean {
  return _muted;
}

/** Set the volume in the `[0, 1]` range. Out-of-range values are
 *  clamped. Volume is persisted to localStorage so a refresh keeps
 *  the chosen level. */
export function setVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  _volume = clamped;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(VOLUME_KEY, String(clamped));
  }
  audioEl();
  applyVolume();
}

/** Current volume — useful for a slider UI. */
export function getVolume(): number {
  return _volume;
}

/** True when the player currently holds a non-empty playlist. The host
 *  uses this to decide whether a location with no soundtrack of its own
 *  should inherit (continue) the current music or — when nothing is
 *  playing yet — seed the module default. */
export function hasPlaylist(): boolean {
  return _playlist.length > 0;
}

/** Bundled-export shape so callers can keep one import and write
 *  `Soundtrack.play()` / `Soundtrack.setPlaylist(...)`. */
export const Soundtrack = {
  setPlaylist,
  play,
  pause,
  stop,
  setMuted,
  isMuted,
  setVolume,
  getVolume,
  hasPlaylist,
};
