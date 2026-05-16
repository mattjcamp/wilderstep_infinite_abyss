import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveProjectileEffect,
  registerProjectileEffect,
  listRegisteredProjectileEffects,
  __resetProjectileRegistryForTests,
  type ProjectileEffectFn,
} from "./effectRegistry";

// The registry imports the real Vfx module, which in turn imports
// Phaser. We never *call* the rendered effects here — only resolve
// them — so the Phaser import is harmless.

describe("effectRegistry", () => {
  beforeEach(() => {
    __resetProjectileRegistryForTests();
  });

  it("seeds the standard set on load", () => {
    // Every visual a registered animation can ask for must exist
    // here. If a new animation references a new visual, register it
    // in effectRegistry.ts at the same time.
    const expected = [
      "lightning_bolt",
      "magic_dart",
      "magic_arrow",
      "projectile_line",
      "fire_projectile",
      "heal_sparkles",
      "buff_aura",
      "curse_aura",
      "radial_burst",
      "explosion_burst",
    ];
    expect(listRegisteredProjectileEffects().sort()).toEqual(expected.sort());
  });

  it("routes lightning_bolt through the zigzag renderer", () => {
    const fn = resolveProjectileEffect({ effect_type: "lightning_bolt" });
    // We don't run the renderer (would need a real Phaser scene),
    // but we can assert it's the registered entry and not the
    // default fallback. Replace it with a stub, resolve again,
    // and check the stub is what comes back.
    const stub: ProjectileEffectFn = vi.fn(async () => {});
    registerProjectileEffect("lightning_bolt", stub);
    expect(resolveProjectileEffect({ effect_type: "lightning_bolt" })).toBe(
      stub,
    );
    // Sanity: the originally-resolved function is *not* the stub
    // (proves the registry is actually swapping).
    expect(fn).not.toBe(stub);
  });

  it("resolves every animation-referenced visual to a registered fn", () => {
    // Spot-check the non-projectile visuals were registered — these
    // were the gap the second migration phase filled in.
    expect(typeof resolveProjectileEffect({ effect_type: "heal_sparkles" }))
      .toBe("function");
    expect(typeof resolveProjectileEffect({ effect_type: "buff_aura" })).toBe(
      "function",
    );
    expect(typeof resolveProjectileEffect({ effect_type: "curse_aura" }))
      .toBe("function");
    expect(typeof resolveProjectileEffect({ effect_type: "radial_burst" }))
      .toBe("function");
  });

  it("falls back to the default projectile for unknown effect_type", () => {
    const fallback = resolveProjectileEffect({
      effect_type: "this_effect_does_not_exist",
    });
    // The fallback should be a function — that's all we can assert
    // without dragging in a real Phaser scene. Crucially, it should
    // not be `undefined`, which is the bug the registry is designed
    // to prevent.
    expect(typeof fallback).toBe("function");
  });

  it("falls back to the default when spell has no effect_type at all", () => {
    const fallback = resolveProjectileEffect({});
    expect(typeof fallback).toBe("function");
  });

  it("registerProjectileEffect overrides existing entries", () => {
    const first: ProjectileEffectFn = vi.fn(async () => {});
    const second: ProjectileEffectFn = vi.fn(async () => {});
    registerProjectileEffect("custom", first);
    expect(resolveProjectileEffect({ effect_type: "custom" })).toBe(first);
    registerProjectileEffect("custom", second);
    expect(resolveProjectileEffect({ effect_type: "custom" })).toBe(second);
  });
});
