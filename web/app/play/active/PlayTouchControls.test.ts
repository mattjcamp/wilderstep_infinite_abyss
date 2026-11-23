import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sendKey } from "./PlayTouchControls";

// No DOM in the test env: stand in a window EventTarget + a minimal
// KeyboardEvent so we can check what sendKey dispatches.
class FakeKeyboardEvent extends Event {
  key: string;
  repeat: boolean;
  constructor(type: string, init: { key: string; repeat?: boolean } & EventInit) {
    super(type, init);
    this.key = init.key;
    this.repeat = init.repeat ?? false;
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let savedWindow: unknown;
let savedKE: unknown;

beforeAll(() => {
  savedWindow = g.window;
  savedKE = g.KeyboardEvent;
  g.window = new EventTarget();
  g.KeyboardEvent = FakeKeyboardEvent;
});
afterAll(() => {
  g.window = savedWindow;
  g.KeyboardEvent = savedKE;
});

describe("sendKey", () => {
  it("dispatches on window with key + Phaser-readable keyCode", () => {
    const seen: Array<{ type: string; key: string; keyCode: number; repeat: boolean }> = [];
    const w = g.window as EventTarget;
    const on = (e: Event) => {
      const k = e as unknown as { key: string; keyCode: number; repeat: boolean };
      seen.push({ type: e.type, key: k.key, keyCode: k.keyCode, repeat: k.repeat });
    };
    w.addEventListener("keydown", on);
    w.addEventListener("keyup", on);
    sendKey("ArrowUp");
    sendKey(" ");
    sendKey("Escape");
    sendKey("z", "keyup");
    sendKey("ArrowLeft", "keydown", true);
    expect(seen).toEqual([
      { type: "keydown", key: "ArrowUp", keyCode: 38, repeat: false },
      { type: "keydown", key: " ", keyCode: 32, repeat: false },
      { type: "keydown", key: "Escape", keyCode: 27, repeat: false },
      { type: "keyup", key: "z", keyCode: 90, repeat: false },
      { type: "keydown", key: "ArrowLeft", keyCode: 37, repeat: true },
    ]);
  });
});
