import { describe, it, expect } from "vitest";
import { trapFxId, trapFxOrigin } from "./trapFx";

describe("trapFxId", () => {
  it("uses the trap's own fx_id, else a default by type", () => {
    expect(trapFxId({ fx_id: "explosion", damage_type: "fire" })).toBe("explosion");
    expect(trapFxId({ damage_type: "fire" })).toBe("trap_fire");
    expect(trapFxId({ damage_type: "piercing" })).toBe("trap_darts");
    expect(trapFxId({ trap_type: "teleport", damage_type: "magic" })).toBe("teleport_blink");
    expect(trapFxId({ damage_type: "poison" })).toBe("");
    expect(trapFxId({ fx_id: "none", damage_type: "fire" })).toBe("");
    expect(trapFxId(null)).toBe("");
  });
});

describe("trapFxOrigin", () => {
  const W = { walkable: false };
  const F = { walkable: true };
  it("comes from the nearest wall", () => {
    const grid = [
      [W, W, W, W, W],
      [W, F, F, F, F],
      [W, F, F, F, F],
    ];
    // From (2,2): up hits the wall at (2,0); left hits (0,2); right/down run off.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const o = trapFxOrigin(grid, 2, 2);
      seen.add(`${o.col},${o.row}`);
    }
    expect(seen).toEqual(new Set(["2,0", "0,2"]));
  });
  it("falls back to a few cells left with no wall in reach", () => {
    const grid = [[F, F, F, F, F, F, F, F, F]];
    expect(trapFxOrigin(grid, 6, 0)).toEqual({ col: 3, row: 0 });
  });
});
