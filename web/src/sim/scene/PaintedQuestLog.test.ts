import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PaintedQuestLog,
  bucketQuests,
  type PaintedQuestLogData,
  type PaintedQuestLogQuest,
} from "./PaintedQuestLog";

/* Same fake-Phaser shape used by PaintedHelpScreen.test.ts, extended
 * for the few extra surfaces this painter touches: `make.graphics`
 * (used to build the scroll mask), `input.on/off` for wheel events,
 * and `container.setMask` / `container.setPosition` for scrolling. */

interface FakeObject {
  destroyed: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  alpha: number;
  listeners: Map<string, Array<(p?: unknown) => void>>;
  setOrigin: () => FakeObject;
  setScrollFactor: () => FakeObject;
  setDepth: () => FakeObject;
  setStrokeStyle: () => FakeObject;
  setInteractive: () => FakeObject;
  setAlpha: (v: number) => FakeObject;
  setText: (s: string) => FakeObject;
  setPosition: (x: number, y: number) => FakeObject;
  setMask: (m: unknown) => FakeObject;
  on: (event: string, cb: (p?: unknown) => void) => FakeObject;
  destroy: () => void;
}

function fakeObject(initialWidth = 100, initialHeight = 16): FakeObject {
  const listeners = new Map<string, Array<(p?: unknown) => void>>();
  const obj: FakeObject = {
    destroyed: false,
    width: initialWidth,
    height: initialHeight,
    x: 0,
    y: 0,
    alpha: 1,
    listeners,
    setOrigin: () => obj,
    setScrollFactor: () => obj,
    setDepth: () => obj,
    setStrokeStyle: () => obj,
    setInteractive: () => obj,
    setAlpha: (v) => {
      obj.alpha = v;
      return obj;
    },
    setText: () => obj,
    setPosition: (x, y) => {
      obj.x = x;
      obj.y = y;
      return obj;
    },
    setMask: () => obj,
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
    setPosition: (x, y) => {
      container.x = x;
      container.y = y;
      return container;
    },
    destroy: () => {
      container.destroyed = true;
      for (const c of children) c.destroyed = true;
    },
  };
  return container;
}

interface FakeGraphics {
  fillStyle: (color: number) => FakeGraphics;
  fillRect: (x: number, y: number, w: number, h: number) => FakeGraphics;
  createGeometryMask: () => { kind: "geometry-mask" };
}

function fakeGraphics(): FakeGraphics {
  const g: FakeGraphics = {
    fillStyle: () => g,
    fillRect: () => g,
    createGeometryMask: () => ({ kind: "geometry-mask" as const }),
  };
  return g;
}

interface FakeScene {
  created: FakeObject[];
  lastContainer: FakeContainer | null;
  /** Wheel + key listeners registered via `scene.input.on`. The
   *  painter uses this for mouse-wheel scrolling. */
  inputListeners: Map<string, Array<(...args: unknown[]) => void>>;
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
  make: {
    graphics: (cfg?: unknown) => FakeGraphics;
  };
  input: {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    off: (event: string, cb: (...args: unknown[]) => void) => void;
  };
}

function makeFakeScene(): FakeScene {
  const created: FakeObject[] = [];
  let lastContainer: FakeContainer | null = null;
  const inputListeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  return {
    created,
    get lastContainer() {
      return lastContainer;
    },
    inputListeners,
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
        // Pretend a single line of text is ~14px tall — close enough
        // for the painter's "row stacking" math without invoking the
        // real Phaser text measurement pipeline.
        obj.height = 14;
        created.push(obj);
        return obj;
      },
    },
    make: {
      graphics: () => fakeGraphics(),
    },
    input: {
      on: (event, cb) => {
        const list = inputListeners.get(event) ?? [];
        list.push(cb);
        inputListeners.set(event, list);
      },
      off: (event, cb) => {
        const list = inputListeners.get(event) ?? [];
        inputListeners.set(
          event,
          list.filter((fn) => fn !== cb),
        );
      },
    },
  };
}

function makeScreen(scene: FakeScene, onClose: () => void) {
  return new PaintedQuestLog({
    scene: scene as unknown as Phaser.Scene,
    canvasWidth: 960,
    canvasHeight: 720,
    onClose,
  });
}

const QUESTS: PaintedQuestLogQuest[] = [
  {
    id: "rescue-cat",
    name: "Rescue the Cat",
    description: "Mrs. Henwick's cat is stuck up a tree.",
    steps: [
      { name: "Find the tree", description: "Somewhere in the orchard." },
      { name: "Get the cat down", description: "Climbing skill check." },
    ],
  },
  {
    id: "slay-orc",
    name: "Slay the Orc",
    description: "An orc is terrorizing the eastern path.",
    steps: [
      { name: "Find the orc", description: "Track him through the woods." },
      { name: "Defeat the orc" },
    ],
  },
  {
    id: "deliver-letter",
    name: "Deliver the Letter",
    description: "A simple errand.",
    steps: [{ name: "Take the letter to the priest" }],
  },
  {
    id: "trivial",
    name: "Trivial Quest",
    description: "No steps at all — an oddity in the catalog.",
    steps: [],
  },
];

function dataOf(opts: {
  accepted?: string[];
  progress?: Record<string, number>;
  turnedIn?: string[];
}): PaintedQuestLogData {
  return {
    quests: QUESTS,
    acceptedQuests: opts.accepted ?? [],
    questStepProgress: opts.progress ?? {},
    turnedInQuests: opts.turnedIn ?? [],
  };
}

describe("bucketQuests", () => {
  it("buckets a single in-progress quest into `active`", () => {
    const buckets = bucketQuests(
      dataOf({ accepted: ["rescue-cat"], progress: { "rescue-cat": 1 } }),
    );
    expect(buckets.active.map((q) => q.id)).toEqual(["rescue-cat"]);
    expect(buckets.pending).toEqual([]);
    expect(buckets.turnedIn).toEqual([]);
  });

  it("buckets all-steps-complete into `pending`", () => {
    const buckets = bucketQuests(
      dataOf({ accepted: ["rescue-cat"], progress: { "rescue-cat": 2 } }),
    );
    expect(buckets.pending.map((q) => q.id)).toEqual(["rescue-cat"]);
    expect(buckets.active).toEqual([]);
  });

  it("buckets turned-in quests last", () => {
    const buckets = bucketQuests(
      dataOf({
        accepted: ["rescue-cat", "slay-orc"],
        progress: { "rescue-cat": 2, "slay-orc": 1 },
        turnedIn: ["rescue-cat"],
      }),
    );
    expect(buckets.turnedIn.map((q) => q.id)).toEqual(["rescue-cat"]);
    expect(buckets.active.map((q) => q.id)).toEqual(["slay-orc"]);
    expect(buckets.pending).toEqual([]);
  });

  it("ignores unknown quest ids in `accepted`", () => {
    // A save referencing a quest the current catalog doesn't include
    // should not throw — just skip the unknown id.
    const buckets = bucketQuests(
      dataOf({ accepted: ["ghost-quest", "rescue-cat"] }),
    );
    expect(buckets.active.map((q) => q.id)).toEqual(["rescue-cat"]);
  });

  it("treats a quest with zero steps as in-progress (not pending)", () => {
    // The complete-pending rule requires at least one step. A quest
    // authored without steps stays in `active` because we can't say
    // it's done — matches the React overlay's behavior.
    const buckets = bucketQuests(dataOf({ accepted: ["trivial"] }));
    expect(buckets.active.map((q) => q.id)).toEqual(["trivial"]);
    expect(buckets.pending).toEqual([]);
  });
});

describe("PaintedQuestLog — lifecycle", () => {
  it("is closed on construction", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, () => {});
    expect(screen.isOpen()).toBe(false);
    expect(scene.created).toEqual([]);
  });

  it("paints a container on open() and reports open", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, () => {});
    screen.open(
      dataOf({ accepted: ["rescue-cat"], progress: { "rescue-cat": 1 } }),
    );
    expect(screen.isOpen()).toBe(true);
    expect(scene.lastContainer).not.toBeNull();
    // Backdrop + panel + 2 header texts + header rule + content
    // container + section header + entry bg + entry name + entry tag
    // (+ optional description, step name, step description) is well
    // over 10 painted objects.
    expect(scene.created.length).toBeGreaterThan(10);
  });

  it("renders the empty-state when nothing is accepted", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, () => {});
    screen.open(dataOf({}));
    expect(screen.isOpen()).toBe(true);
    // No entries means contentHeight should be small — basically the
    // empty-state text's height plus padding.
    expect(screen.getContentHeight()).toBeLessThan(80);
  });

  it("close() destroys the container and clears state", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, () => {});
    screen.open(
      dataOf({ accepted: ["rescue-cat"], progress: { "rescue-cat": 1 } }),
    );
    const container = scene.lastContainer!;
    screen.close();
    expect(screen.isOpen()).toBe(false);
    expect(container.destroyed).toBe(true);
    expect(screen.getScrollOffset()).toBe(0);
  });

  it("open() is idempotent — a second call no-ops", () => {
    const scene = makeFakeScene();
    const screen = makeScreen(scene, () => {});
    screen.open(dataOf({}));
    const first = scene.created.length;
    screen.open(dataOf({}));
    expect(scene.created.length).toBe(first);
  });
});

describe("PaintedQuestLog — keyboard close", () => {
  beforeEach(() => {
    if (typeof window === "undefined") {
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
    // Leave the shim in place across tests — vitest runs them in
    // declaration order in the same worker and the next describe
    // block expects the same shim.
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

  it("closes on Q", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, onClose);
    screen.open(dataOf({}));
    fireKey("q");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.isOpen()).toBe(false);
  });

  it("closes on Escape", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, onClose);
    screen.open(dataOf({}));
    fireKey("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated keys", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, onClose);
    screen.open(dataOf({}));
    fireKey("p");
    fireKey("Enter");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.isOpen()).toBe(true);
  });

  it("does not fire after close()", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, onClose);
    screen.open(dataOf({}));
    screen.close();
    fireKey("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PaintedQuestLog — scrolling", () => {
  /** Construct a screen with enough content to overflow the viewport.
   *  We pad the accepted list with the same quest copied multiple
   *  times — `bucketQuests` deduplicates internally only via the
   *  byId map, so a many-times-accepted same-id only appears once.
   *  Use distinct ids so the painter draws every entry. */
  function manyQuests(scene: FakeScene): PaintedQuestLog {
    const ids = Array.from({ length: 25 }, (_, i) => `q-${i}`);
    const padded: PaintedQuestLogQuest[] = ids.map((id, i) => ({
      id,
      name: `Quest ${i}`,
      description:
        "A long description that wraps onto multiple lines and pushes the entry's total height up so the screen has plenty of content to scroll past.",
      steps: [{ name: "Step 1", description: "Step 1 description" }],
    }));
    const data: PaintedQuestLogData = {
      quests: padded,
      acceptedQuests: ids,
      questStepProgress: Object.fromEntries(ids.map((id) => [id, 0])),
      turnedInQuests: [],
    };
    const screen = new PaintedQuestLog({
      scene: scene as unknown as Phaser.Scene,
      canvasWidth: 960,
      canvasHeight: 720,
      onClose: () => {},
    });
    screen.open(data);
    return screen;
  }

  it("registers a wheel listener with the scene's input plugin", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    expect((scene.inputListeners.get("wheel") ?? []).length).toBe(1);
    screen.close();
  });

  it("unregisters the wheel listener on close()", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    screen.close();
    expect(scene.inputListeners.get("wheel") ?? []).toEqual([]);
  });

  it("scroll offset starts at 0", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    expect(screen.getScrollOffset()).toBe(0);
    screen.close();
  });

  it("wheel down decreases the offset (content moves up)", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    const wheelFn = scene.inputListeners.get("wheel")![0]!;
    wheelFn(null, [], 0, 100); // deltaY = 100, one wheel notch
    expect(screen.getScrollOffset()).toBeLessThan(0);
    screen.close();
  });

  it("scroll offset clamps so you can't scroll above content origin", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    const wheelFn = scene.inputListeners.get("wheel")![0]!;
    wheelFn(null, [], 0, -1000); // try to scroll "up" past the top
    expect(screen.getScrollOffset()).toBe(0);
    screen.close();
  });

  it("scroll offset clamps to (viewport - content) at the bottom", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    const wheelFn = scene.inputListeners.get("wheel")![0]!;
    // Fire many wheel notches to push past the bottom.
    for (let i = 0; i < 100; i++) wheelFn(null, [], 0, 1000);
    const offset = screen.getScrollOffset();
    const contentHeight = screen.getContentHeight();
    // We can't read viewportHeight directly, but with PANEL_HEIGHT=600,
    // HEADER_HEIGHT=44, PANEL_PADDING/2=10 the viewport is 546. Offset
    // is clamped to -(content - 546).
    const expectedMin = -(contentHeight - 546);
    // Be lenient on the exact value (height computations from fake
    // text objects aren't pixel-perfect); just assert the offset is
    // within ~10px of the expected clamp.
    expect(offset).toBeGreaterThanOrEqual(expectedMin - 1);
    expect(offset).toBeLessThanOrEqual(expectedMin + 10);
    screen.close();
  });

  it("ArrowDown scrolls down via the keydown listener", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    const ev = {
      key: "ArrowDown",
      type: "keydown",
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    window.dispatchEvent(ev);
    expect(screen.getScrollOffset()).toBeLessThan(0);
    screen.close();
  });

  it("ArrowUp from offset 0 stays at 0 (clamped)", () => {
    const scene = makeFakeScene();
    const screen = manyQuests(scene);
    const ev = {
      key: "ArrowUp",
      type: "keydown",
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    window.dispatchEvent(ev);
    expect(screen.getScrollOffset()).toBe(0);
    screen.close();
  });
});

describe("PaintedQuestLog — backdrop click", () => {
  it("clicking the backdrop closes the screen", () => {
    const scene = makeFakeScene();
    const onClose = vi.fn();
    const screen = makeScreen(scene, onClose);
    screen.open(dataOf({}));
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
