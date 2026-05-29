/**
 * Fade behaviour for the soundtrack player. Runs against a fake
 * HTMLAudioElement + fake timers so we can assert the volume ramp
 * deterministically without a real DOM or real audio.
 *
 * The player reads localStorage at import time and creates its
 * Audio element lazily, so each test resets the module registry and
 * re-imports after installing fresh globals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static last: FakeAudio | null = null;
  volume = 1;
  src = "";
  currentTime = 0;
  duration = NaN;
  paused = true;
  preload = "";
  error: unknown = undefined;
  private handlers = new Map<string, Array<() => void>>();
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    const arr = this.handlers.get(type) ?? [];
    arr.push(fn);
    this.handlers.set(type, arr);
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  /** Test helper: fire a registered event synchronously. */
  dispatch(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
}

/** Flush pending promise microtasks (the play().then(fade) chain). */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

let Soundtrack: typeof import("./SoundtrackPlayer").Soundtrack;
let setPlaylist: typeof import("./SoundtrackPlayer").setPlaylist;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).Audio = FakeAudio as unknown;
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  // Pending forever → the gain catalog never loads, so it can't
  // interfere with the volume assertions. Per-track gain defaults to 1.
  (globalThis as Record<string, unknown>).fetch = () => new Promise(() => {});
  FakeAudio.last = null;
  const mod = await import("./SoundtrackPlayer");
  Soundtrack = mod.Soundtrack;
  setPlaylist = mod.setPlaylist;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).Audio;
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("SoundtrackPlayer fades", () => {
  it("fades a new track up from silence to the target volume", async () => {
    setPlaylist(["/audio/a.mp3", "/audio/b.mp3"]);
    Soundtrack.play();
    const el = FakeAudio.last!;
    // Starts silent the moment the track is armed.
    expect(el.volume).toBe(0);

    await flush(); // let play().then(fadeTo) run and start the ramp

    // Halfway through the fade the volume is partway to 0.5 default.
    vi.advanceTimersByTime(300);
    expect(el.volume).toBeGreaterThan(0);
    expect(el.volume).toBeLessThan(0.5);

    // After the full fade it lands on the target (0.5 * gain 1).
    vi.advanceTimersByTime(400);
    expect(el.volume).toBeCloseTo(0.5, 2);
  });

  it("fades down as the track nears its end", async () => {
    setPlaylist(["/audio/a.mp3", "/audio/b.mp3"]);
    Soundtrack.play();
    const el = FakeAudio.last!;
    await flush();
    vi.advanceTimersByTime(700); // finish the fade-in → 0.5
    expect(el.volume).toBeCloseTo(0.5, 2);

    // 200ms from the end → end fade kicks in.
    el.duration = 100;
    el.currentTime = 99.8;
    el.dispatch("timeupdate");
    vi.advanceTimersByTime(300); // past the ~200ms end-fade ramp
    expect(el.volume).toBe(0);
  });

  it("snaps to the new level and cancels the fade on an explicit volume change", async () => {
    setPlaylist(["/audio/a.mp3", "/audio/b.mp3"]);
    Soundtrack.play();
    const el = FakeAudio.last!;
    await flush();
    vi.advanceTimersByTime(150); // mid fade-in

    Soundtrack.setVolume(0.8);
    expect(el.volume).toBeCloseTo(0.8, 2);

    // Fade was cancelled — advancing time must not move the volume.
    vi.advanceTimersByTime(1000);
    expect(el.volume).toBeCloseTo(0.8, 2);
  });

  it("mute snaps to 0 and unmute restores the target", async () => {
    setPlaylist(["/audio/a.mp3"]);
    Soundtrack.play();
    const el = FakeAudio.last!;
    await flush();
    vi.advanceTimersByTime(700);
    expect(el.volume).toBeCloseTo(0.5, 2);

    Soundtrack.setMuted(true);
    expect(el.volume).toBe(0);
    Soundtrack.setMuted(false);
    expect(el.volume).toBeCloseTo(0.5, 2);
  });
});
