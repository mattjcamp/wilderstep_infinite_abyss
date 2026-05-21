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
 */

import { withBasePath } from "@/util/basePath";

const STORAGE_KEY = "wsia.soundtrack.muted";
const VOLUME_KEY = "wsia.soundtrack.volume";
/** Default volume — moderate so sound effects ride on top of it. */
const DEFAULT_VOLUME = 0.5;

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

/** Acquire the shared HTMLAudioElement, lazily building it on first
 *  use. Returns `null` when there's no `window` (SSR / Node test). */
function audioEl(): HTMLAudioElement | null {
  if (_audio) return _audio;
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    return null;
  }
  const el = new Audio();
  el.preload = "auto";
  el.volume = _muted ? 0 : _volume;
  // When a track finishes, slide into the next random pick. Defensive
  // against an empty / single-track playlist (handled in pickNextIndex).
  el.addEventListener("ended", () => {
    if (!_playing) return;
    startRandom();
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
  _audio = el;
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
  // Browser autoplay policy: the first play after a fresh page load
  // may reject until the user has interacted. Warn but swallow —
  // the next user-triggered play() call will succeed.
  el.play().catch((err: unknown) => {
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
      el.pause();
      el.removeAttribute("src");
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
    startRandom();
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
    el.pause();
    el.removeAttribute("src");
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
  const el = audioEl();
  if (el) el.volume = b ? 0 : _volume;
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
  const el = audioEl();
  if (el && !_muted) el.volume = clamped;
}

/** Current volume — useful for a slider UI. */
export function getVolume(): number {
  return _volume;
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
};
