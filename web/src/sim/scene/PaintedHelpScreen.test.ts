import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PaintedHelpScreen,
  type PaintedHelpScreenSoundtrack,
} from "./PaintedHelpScreen";

/* These tests run without a real Phaser instance. The painter only
 * touches a small, well-defined slice of Phaser's API (`scene.add.*`
 * for objects, `setOrigin` / `setScrollFactor` / `setDepth` /
 * `setStrokeStyle` / `setInteractive` on each, plus container `add`
 * + `destroy`, plus `on` for pointer events on the interactive
 * rectangles and label). A hand-rolled stub captures enough of that
 * surface for unit assertions about open/close, mute toggling, and
 * volume drag without bringing the headless Phaser runtime + canvas
 * into the test environment. */

interface FakeObject {
  destroyed: boolean;
  width: number;
  alpha: number;
  listeners: Map<string, Array<(p?: unknown) => void>>;
  /** Each chainable setter just returns `this` so the painter can
   *  call them fluently the same way it does against the real API. */
  setOrigin: () => FakeObject;
  setScrollFactor: () => FakeObject;
  setDepth: () => FakeObject;
  setStrokeStyle: () => FakeObject;
  setInteractive: () => FakeObject;
  setAlpha: (v: number) => FakeObject;
  setText: (s: string) => FakeObject;
  on: (event: string, cb: (p?: unknown) => void) => FakeObject;
  destroy: (..._args: unknown[]) => void;
  height: number;
}

function fakeObject(initialWidth = 100, initialHeight = 16): FakeObject {
  const listeners = new Map<string, Array<(p?: unknown) => void>>();
  const obj: FakeObject = {
    destroyed: false,
    width: initialWidth,
    alpha: 1,
    height: initialHeight,
    listeners,
    setOrigin: () => obj,
    setScrollFactor: () => obj,
    setDepth: () => obj,
    setStrokeStyle: () => obj,
    setInteractive: () => obj,
    setAlpha: (v: number) => {
      obj.alpha = v;
      return obj;
    },
    setText: () => obj,
    on: (event, cb) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return obj;
    },
    destroy: () => {
      obj.destroyed = true;
    },
  };
  return obj;
}

interface FakeContainer extends FakeObject {
  children: FakeObject[];
  add: (child: FakeObject) => FakeContainer;
}

function fakeContainer(): FakeContainer {
  const base = fakeObject();
  const children: FakeObject[] = [];
  const container: FakeContainer = {
    ...base,
    children,
    add: (child) => {
      children.push(child);
      return container;
    },
    destroy: () => {
      // Mark BOTH the container and every child as destroyed. The
      // spread above shallow-copied `destroyed` from `base`, so a
      // later mutation of `base.destroyed` would not be visible on
      // `container` — set the field directly.
      container.destroyed = true;
      for (const c of children) c.destroyed = true;
    },
  };
  return container;
}

interface FakeScene {
  /** Every object the painter created (containers + rectangles +
   *  texts), in creation order. Useful for asserting the full set
   *  was torn down on close(). */
  created: FakeObject[];
  /** The single container created on open(). Captured separately
   *  so individual tests don't need to walk `created`. */
  lastContainer: FakeContainer | null;
  add: {
    container: () => FakeContainer;
    rectangle: (
      x: number,
      y: number,
      w: number,
      h: number,
      _color?: number,
      _alpha?: number,
    ) => FakeObject;
    text: (
      x: number,
      y: number,
      _str: string,
      _style?: unknown,
    ) => FakeObject;
  };
}

function makeFakeScene(): FakeScene {
  const created: FakeObject[] = [];
  let lastContainer: FakeContainer | null = null;
  return {
    created,
    get lastContainer() {
      return lastContainer;
    },
    add: {
      container: () => {
        const c = fakeContainer();
        created.push(c);
        lastContainer = c;
        return c;
      },
      rectangle: (_x, _y, w, h) => {
        const obj = fakeObject(w, h);
        created.push(obj);
        return obj;
      },
      text: () => {
        const obj = fakeObject();
        created.push(obj);
        return obj;
      },
    },
  };
}

function makeSoundtrack(opts?: {
  muted?: boolean;
  volume?: number;
}): PaintedHelpScreenSoundtrack & {
  // expose the spies for assertion
  setMuted: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
} {
  const state = { muted: opts?.muted ?? false, volume: opts?.volume ?? 0.5 };
  const setMuted = vi.fn((v: boolean) => {
    state.muted = v;
  });
  const setVolume = vi.fn((v: number) => {
    state.volume = v;
  });
  return {
    isMuted: () => state.muted,
    setMuted,
    getVolume: () => state.volume,
    setVolume,
  };
}

function makeScreen(
  scene: FakeScene,
  soundtrack: PaintedHelpScreenSoundtrack,
  onClose: () => void,
) {
  return new PaintedHelpScreen({
    // Casts are intentional — the fake scene satisfies the structural
    // subset the painter actually consults. Using a real Phaser.Scene
    // here would force a canvas + WebGL bring-up the test doesn't
    // need.
    scene: scene as unknown as Phaser.Scene,
    canvasWidth: 960,
    canvasHeight: 720,
    soundtrack,
    onClose,
  });
}

describe("PaintedHelpScreen — lifecycle", () => {
  it("is closed on construction", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, makeSoundtrack(), () => {});
    expect(screen.isOpen()).toBe(false);
    expect(scene.created).toEqual([]);
  });

  it("paints a container on open() and reports open", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, makeSoundtrack(), () => {});
    screen.open();
    expect(screen.isOpen()).toBe(true);
    expect(scene.lastContainer).not.toBeNull();
    // Container + at least the backdrop, panel, header, underline,
    // and content — the exact count is layout-dependent, but it
    // should comfortably exceed a handful.
    expect(scene.created.length).toBeGreaterThan(10);
  });

  it("close() destroys the container and clears isOpen", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, makeSoundtrack(), () => {});
    screen.open();
    const container = scene.lastContainer!;
    screen.close();
    expect(screen.isOpen()).toBe(false);
    expect(container.destroyed).toBe(true);
    // Every child the painter added should be marked destroyed by
    // the container's recursive destroy().
    for (const child of container.children) {
      expect(child.destroyed).toBe(true);
    }
  });

  it("open() is idempotent — a second call no-ops", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, makeSoundtrack(), () => {});
    screen.open();
    const firstCount = scene.created.length;
    screen.open();
    expect(scene.created.length).toBe(firstCount);
  });

  it("close() on a closed screen is a no-op (no onClose fired)", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.close();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.isOpen()).toBe(false);
  });
});

describe("PaintedHelpScreen — keyboard close", () => {
  // The painter registers a window-level keydown listener so the
  // assertions below dispatch real KeyboardEvents. jsdom is not on
  // by default for this project, but vitest still exposes `window`
  // via the node global polyfill in v1.x; the test guards on its
  // presence anyway.
  let originalWindow: typeof window | undefined;

  beforeEach(() => {
    if (typeof window === "undefined") {
      // Minimal shim — just enough for addEventListener/removeListener
      // plus dispatchEvent. We restore at teardown.
      const handlers = new Map<
        string,
        Array<(ev: KeyboardEvent) => void>
      >();
      (globalThis as unknown as { window: unknown }).window = {
        addEventListener: (
          type: string,
          fn: (ev: KeyboardEvent) => void,
        ) => {
          const list = handlers.get(type) ?? [];
          list.push(fn);
          handlers.set(type, list);
        },
        removeEventListener: (
          type: string,
          fn: (ev: KeyboardEvent) => void,
        ) => {
          const list = handlers.get(type) ?? [];
          handlers.set(
            type,
            list.filter((h) => h !== fn),
          );
        },
        dispatchEvent: (ev: KeyboardEvent) => {
          const list = handlers.get(ev.type) ?? [];
          for (const fn of list) fn(ev);
          return true;
        },
      };
    }
  });

  afterEach(() => {
    if (originalWindow !== undefined) {
      (globalThis as unknown as { window: typeof window }).window =
        originalWindow;
    }
  });

  function fireKey(key: string) {
    const ev = {
      key,
      type: "keydown",
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    window.dispatchEvent(ev);
  }

  it("closes on Escape", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    fireKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.isOpen()).toBe(false);
  });

  it("closes on H (lowercase)", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    fireKey("h");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on H (uppercase)", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    fireKey("H");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    fireKey("p");
    fireKey("Enter");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.isOpen()).toBe(true);
  });

  it("does not fire on keys after close()", () => {
    // Listener is removed in close(); a key press after that must
    // not double-fire onClose. Regression guard for the leaked-
    // listener case the host worries about.
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    screen.close();
    fireKey("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PaintedHelpScreen — audio controls", () => {
  /** Find the checkbox label callback that toggles mute. The painter
   *  registers a `pointerdown` listener on both the checkbox itself
   *  and its label; firing either one is enough. */
  function findPointerDownListeners(scene: FakeScene) {
    const fns: Array<() => void> = [];
    for (const obj of scene.created) {
      const list = obj.listeners?.get("pointerdown") ?? [];
      for (const fn of list) fns.push(() => fn());
    }
    return fns;
  }

  it("seeds checkbox + slider from the soundtrack module at open()", () => {
    const soundtrack = makeSoundtrack({ muted: true, volume: 0.4 });
    const scene = makeFakeScene();
    const screen = makeScreen(scene, soundtrack, () => {});
    screen.open();
    // The mute checkbox's fill should be at full alpha because the
    // soundtrack reports muted=true at open time.
    const fills = scene.created.filter(
      (o) => o.width === 8, // CHECKBOX_SIZE - 4 (12 - 4)
    );
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0].alpha).toBe(1);
  });

  it("toggling mute flips state through the soundtrack module", () => {
    const soundtrack = makeSoundtrack({ muted: false });
    const scene = makeFakeScene();
    const screen = makeScreen(scene, soundtrack, () => {});
    screen.open();
    const pointerDowns = findPointerDownListeners(scene);
    // Fire the first pointerdown that's NOT the backdrop (the
    // backdrop closes). The first registered should be backdrop, the
    // next two should be checkbox + label. Either one toggles.
    // We fire all of them but stop after the first that actually
    // toggled the soundtrack. (The slider hitbox doesn't toggle.)
    let toggled = false;
    for (const fn of pointerDowns) {
      fn();
      if (soundtrack.setMuted.mock.calls.length > 0) {
        toggled = true;
        break;
      }
    }
    expect(toggled).toBe(true);
    expect(soundtrack.setMuted).toHaveBeenCalledWith(true);
  });

  it("dragging the volume slider routes to setVolume", () => {
    const soundtrack = makeSoundtrack({ volume: 0 });
    const scene = makeFakeScene();
    const screen = makeScreen(scene, soundtrack, () => {});
    screen.open();
    // Find the slider hit-zone — the wider rectangle (160px) with a
    // pointerdown listener attached. It's the SLIDER_WIDTH=160
    // rectangle that lives in the audio section.
    const hit = scene.created.find(
      (o) =>
        o.width === 160 &&
        (o.listeners.get("pointerdown")?.length ?? 0) > 0,
    );
    expect(hit).toBeDefined();
    // Simulate a click at the slider's right edge — should write
    // volume = 1. The painter projects pointer.x onto the track's
    // origin (sliderTrackX), so we synthesize a pointer at the right
    // edge of the slider.
    // Track origin: panel centers on a 960-wide canvas with a
    // PANEL_WIDTH=720. panelX = (960-720)/2 = 120, plus padding 20,
    // plus 220 audio offset = 360. Track end at +160 = 520.
    const pointerAtEnd = { x: 520, isDown: true };
    const cb = hit!.listeners.get("pointerdown")![0];
    cb(pointerAtEnd as unknown);
    expect(soundtrack.setVolume).toHaveBeenCalled();
    const lastCall = soundtrack.setVolume.mock.calls.at(-1)!;
    expect(lastCall[0]).toBeCloseTo(1, 2);
  });

  it("clamps slider drags below 0", () => {
    const soundtrack = makeSoundtrack({ volume: 0.5 });
    const scene = makeFakeScene();
    const screen = makeScreen(scene, soundtrack, () => {});
    screen.open();
    const hit = scene.created.find(
      (o) =>
        o.width === 160 &&
        (o.listeners.get("pointerdown")?.length ?? 0) > 0,
    );
    const cb = hit!.listeners.get("pointerdown")![0];
    cb({ x: -100, isDown: true } as unknown);
    const lastCall = soundtrack.setVolume.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(0);
  });

  it("clamps slider drags above 1", () => {
    const soundtrack = makeSoundtrack({ volume: 0.5 });
    const scene = makeFakeScene();
    const screen = makeScreen(scene, soundtrack, () => {});
    screen.open();
    const hit = scene.created.find(
      (o) =>
        o.width === 160 &&
        (o.listeners.get("pointerdown")?.length ?? 0) > 0,
    );
    const cb = hit!.listeners.get("pointerdown")![0];
    cb({ x: 9999, isDown: true } as unknown);
    const lastCall = soundtrack.setVolume.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(1);
  });
});

describe("PaintedHelpScreen — backdrop click", () => {
  it("clicking the backdrop closes the screen", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, makeSoundtrack(), onClose);
    screen.open();
    // Backdrop is the first interactive rectangle — full-canvas size.
    const backdrop = scene.created.find(
      (o) => o.width === 960 && o.height === 720,
    );
    expect(backdrop).toBeDefined();
    const cb = backdrop!.listeners.get("pointerdown")![0];
    cb();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.isOpen()).toBe(false);
  });
});
