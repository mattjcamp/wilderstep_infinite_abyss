import { describe, expect, it } from "vitest";
import {
  beginStep,
  clearStepAnim,
  DEFAULT_STEP_ANIM,
  STEP_BOB_KEY,
  type StepTarget,
} from "./stepAnim";

/**
 * Unit tests for the step-animation maths shared by the overworld
 * renderer and the battle screen. Pure property writes, so these run
 * against plain objects — no Phaser, no scene, no tween.
 */

interface FakeTarget extends StepTarget {
  flipX: boolean;
  flipCalls: number;
}

/** A body that can flip — an Image in either scene. */
function flippable(x = 0, y = 0, scale = 1): FakeTarget {
  const data = new Map<string, unknown>();
  const t: FakeTarget = {
    x,
    y,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
    flipX: false,
    flipCalls: 0,
    setData: (k, v) => data.set(k, v),
    getData: (k) => data.get(k),
    setFlipX(v: boolean) {
      t.flipX = v;
      t.flipCalls += 1;
      return t;
    },
  };
  return t;
}

/** A body that CANNOT flip — the battle screen renders monsters with
 *  no sprite art as a Rectangle, which has no setFlipX. */
function unflippable(x = 0, y = 0): StepTarget {
  const data = new Map<string, unknown>();
  return {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    setData: (k, v) => data.set(k, v),
    getData: (k) => data.get(k),
  };
}

const CFG = DEFAULT_STEP_ANIM;

describe("stepAnim — arc", () => {
  it("peaks at mid-step and is flat at both ends", () => {
    const t = flippable(0, 100);
    const step = beginStep(t, { x: 0, y: 100 }, { x: 32, y: 100 }, CFG);

    step(0);
    expect(t.y).toBeCloseTo(100, 5);
    step(0.5);
    expect(t.y).toBeCloseTo(100 - CFG.bobPx, 5);
    step(1);
    expect(t.y).toBeCloseTo(100, 5);
  });

  it("recomputes from the endpoints so the bob cannot compound", () => {
    const t = flippable(0, 100);
    const step = beginStep(t, { x: 0, y: 100 }, { x: 0, y: 132 }, CFG);
    for (let i = 0; i < 20; i++) step(0.5);
    expect(t.y).toBeCloseTo(116 - CFG.bobPx, 5);
  });

  it("interpolates y across a vertical move", () => {
    const t = flippable(0, 100);
    const step = beginStep(t, { x: 0, y: 100 }, { x: 0, y: 132 }, CFG);
    step(0.25);
    const arc = Math.sin(0.25 * Math.PI);
    expect(t.y).toBeCloseTo(108 - arc * CFG.bobPx, 5);
  });
});

describe("stepAnim — squash", () => {
  it("multiplies the target's own resting scale, not 1", () => {
    // Overworld roamers rest at 0.95; boss monsters in combat rest at 2.
    for (const base of [0.95, 1, 2]) {
      const t = flippable(0, 0, base);
      const step = beginStep(t, { x: 0, y: 0 }, { x: 32, y: 0 }, CFG);
      step(0.5);
      expect(t.scaleY).toBeCloseTo(base * (1 + CFG.squashFactor), 5);
      expect(t.scaleX).toBeCloseTo(base * (1 - CFG.squashFactor / 2), 5);
      clearStepAnim(t);
      expect(t.scaleY).toBeCloseTo(base, 5);
      expect(t.scaleX).toBeCloseTo(base, 5);
    }
  });

  it("captures the base once, not per step", () => {
    // Capturing again mid-hop would lock in the stretched scale and
    // ratchet the sprite larger with every tile it walks.
    const t = flippable(0, 0, 1);
    const first = beginStep(t, { x: 0, y: 0 }, { x: 32, y: 0 }, CFG);
    first(0.5);
    const second = beginStep(t, { x: 32, y: 0 }, { x: 64, y: 0 }, CFG);
    second(0.5);
    expect(t.scaleY).toBeCloseTo(1 + CFG.squashFactor, 5);
    clearStepAnim(t);
    expect(t.scaleY).toBeCloseTo(1, 5);
  });
});

describe("stepAnim — facing", () => {
  it("faces the direction of horizontal travel", () => {
    const t = flippable(64, 0);
    beginStep(t, { x: 64, y: 0 }, { x: 32, y: 0 }, CFG);
    expect(t.flipX).toBe(true);
    beginStep(t, { x: 32, y: 0 }, { x: 64, y: 0 }, CFG);
    expect(t.flipX).toBe(false);
  });

  it("leaves facing alone on a vertical move", () => {
    const t = flippable(0, 0);
    beginStep(t, { x: 0, y: 0 }, { x: -32, y: 0 }, CFG); // west
    const calls = t.flipCalls;
    beginStep(t, { x: -32, y: 0 }, { x: -32, y: 32 }, CFG); // south
    expect(t.flipX).toBe(true);
    expect(t.flipCalls).toBe(calls);
  });

  it("survives clearStepAnim — a turn outlives the step", () => {
    const t = flippable(0, 0);
    beginStep(t, { x: 0, y: 0 }, { x: -32, y: 0 }, CFG);
    clearStepAnim(t);
    expect(t.flipX).toBe(true);
  });

  it("skips the flip on a target that cannot flip", () => {
    // Rectangle bodies in combat. Must not throw.
    const t = unflippable(64, 0);
    const step = beginStep(t, { x: 64, y: 0 }, { x: 32, y: 0 }, CFG);
    expect(() => step(0.5)).not.toThrow();
    expect(t.y).toBeCloseTo(-CFG.bobPx, 5);
  });
});

describe("stepAnim — clearStepAnim", () => {
  it("unwinds a half-finished hop exactly", () => {
    const t = flippable(0, 100);
    const step = beginStep(t, { x: 0, y: 100 }, { x: 32, y: 100 }, CFG);
    step(0.5);
    expect(t.y).not.toBe(100);

    clearStepAnim(t);

    expect(t.y).toBeCloseTo(100, 5);
    expect(t.getData(STEP_BOB_KEY)).toBe(0);
    expect(t.rotation).toBe(0);
  });

  it("is idempotent on an untouched target", () => {
    const t = flippable(0, 100);
    clearStepAnim(t);
    clearStepAnim(t);
    expect(t.y).toBe(100);
    expect(t.scaleY).toBe(1);
  });
});

describe("stepAnim — disabled knobs", () => {
  it("writes nothing when every field is zeroed", () => {
    const t = flippable(0, 100);
    const step = beginStep(t, { x: 0, y: 100 }, { x: -32, y: 100 }, {
      bobPx: 0,
      squashFactor: 0,
      flipToFaceTravel: false,
      leanDegrees: 0,
    });
    step(0.5);
    expect(t.y).toBe(100);
    expect(t.scaleY).toBe(1);
    expect(t.flipX).toBe(false);
    expect(t.rotation).toBe(0);
  });

  it("applies lean only when configured", () => {
    const t = flippable(0, 0);
    const step = beginStep(t, { x: 0, y: 0 }, { x: 32, y: 0 }, {
      ...CFG,
      leanDegrees: 6,
    });
    step(0.5);
    expect(t.rotation).toBeCloseTo((6 * Math.PI) / 180, 5);
    clearStepAnim(t);
    expect(t.rotation).toBe(0);
  });

  it("leans the opposite way heading west", () => {
    const t = flippable(0, 0);
    const step = beginStep(t, { x: 0, y: 0 }, { x: -32, y: 0 }, {
      ...CFG,
      leanDegrees: 6,
    });
    step(0.5);
    expect(t.rotation).toBeLessThan(0);
  });
});
