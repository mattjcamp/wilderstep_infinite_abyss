import { describe, expect, it, vi } from "vitest";

vi.mock("./Vfx", () => {
  const fn = () => vi.fn(() => Promise.resolve());
  return {
    VFX_COLOURS: { fire: 0xff7a3a, ember: 0xffce5c, lightning: 0xa9d4ff, arcane: 0xc28bff, heal: 0x88ff9c, buff: 0xffe48a, curse: 0x9d4cff, white: 0xffffff },
    breathOfFire: fn(), glowAura: fn(), healingSparkles: fn(), hellfire: fn(),
    lightningZigzag: fn(), magicArrow: fn(), magicDart: fn(), meteorStrike: fn(),
    projectileLine: fn(), radialBurst: fn(), voidOrb: fn(),
  };
});

import * as Vfx from "./Vfx";
import {
  FX_DEFS,
  cleanFxParams,
  fxParams,
  getFxDef,
  hexToNum,
  numToHex,
  playFx,
  setFxOverrides,
  setFxRecords,
  getFxRecord,
  fxVisualKey,
} from "./fxCatalog";

const scene = {} as never;
const A = { x: 0, y: 0 };
const B = { x: 100, y: 0 };

describe("fxCatalog", () => {
  it("every param default is valid for its own schema", () => {
    for (const def of FX_DEFS) {
      for (const p of def.params) {
        if (p.type === "number") {
          expect(p.default, `${def.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
          expect(p.default, `${def.id}.${p.key}`).toBeLessThanOrEqual(p.max);
        } else {
          expect(p.default).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
      if (def.colorKey) expect(def.params.some((p) => p.key === def.colorKey)).toBe(true);
      if (def.durationKey) expect(def.params.some((p) => p.key === def.durationKey)).toBe(true);
    }
  });

  it("converts colours both ways", () => {
    expect(hexToNum("#ff7a3a", 0)).toBe(0xff7a3a);
    expect(hexToNum("nope", 7)).toBe(7);
    expect(numToHex(0x0000ff)).toBe("#0000ff");
  });

  it("cleans bad override values and clamps numbers", () => {
    const def = getFxDef("hellfire")!;
    expect(cleanFxParams(def, { core: "#ABCDEF", size: 99, smoke: "blue", junk: 1 })).toEqual({
      core: "#ABCDEF",
      size: 2.5,
    });
  });

  it("module overrides merge over defaults and reach the renderer", () => {
    setFxOverrides({ fx: [{ id: "hellfire", params: { size: 1.5, core: "#ffffff" } }, { id: "nope" }] });
    expect(fxParams("hellfire").size).toBe(1.5);
    expect(fxParams("hellfire").outer).toBe("#c0260f");
    void playFx("hellfire", scene, A, B);
    const call = (Vfx.hellfire as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(call[3]).toMatchObject({ size: 1.5, core: 0xffffff, outer: 0xc0260f });
    setFxOverrides([]);
    expect(fxParams("hellfire").size).toBe(1);
  });

  it("per-call colour / duration land on the FX's mapped keys", () => {
    void playFx("magic_dart", scene, A, B, { color: 0x123456, durationMs: 999 });
    const call = (Vfx.magicDart as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(call[3]).toBe(0x123456);
    expect(call[4]).toBe(999);
  });

  it("FX records pick a visual, carry their own tuning and sounds", () => {
    setFxRecords({
      fx: [
        { id: "lich_bolt", name: "Lich Bolt", visual: "lightning_bolt", params: { width: 9 }, cast_sfx: "fireball", hit_sfx: "explosion" },
        { id: "chime", name: "Chime", visual: "none", cast_sfx: "level_up" },
      ],
    });
    expect(getFxRecord("lich_bolt")?.hit_sfx).toBe("explosion");
    expect(fxParams("lich_bolt").width).toBe(9);
    // The bare visual keeps its own defaults.
    expect(fxParams("lightning_bolt").width).not.toBe(9);
    expect(fxVisualKey(getFxRecord("lich_bolt"))).toBe("lich_bolt");
    expect(fxVisualKey(getFxRecord("chime"))).toBe("");
    // A built-in visual with no record still resolves.
    expect(getFxRecord("hellfire")?.visual).toBe("hellfire");
    expect(getFxRecord("missing")).toBeNull();
    void playFx("lich_bolt", scene, A, B);
    expect((Vfx.lightningZigzag as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    setFxRecords([]);
  });
});
