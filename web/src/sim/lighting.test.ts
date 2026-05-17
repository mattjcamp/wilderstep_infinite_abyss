import { describe, it, expect } from "vitest";
import {
  computeLighting,
  emitterVisibleAt,
  INFRAVISION_RED,
  tintForCell,
} from "./lighting";
import type { SimCell, SimGrid } from "./types";

/** Build a minimal cell with the fields the lighting helper reads.
 *  Everything else defaults to walkable open floor. */
function cell(over: Partial<SimCell> = {}): SimCell {
  return {
    id: "floor",
    walkable: true,
    obstructs: false,
    light_source: false,
    light_range: 0,
    ...over,
  };
}

/** Compact `WxH` grid generator. `cells[r][c]` overrides each cell;
 *  unspecified cells are plain open floor. */
function makeGrid(
  width: number,
  height: number,
  overrides: Record<string, Partial<SimCell>> = {},
): SimGrid {
  const out: SimCell[][] = [];
  for (let r = 0; r < height; r++) {
    const row: SimCell[] = [];
    for (let c = 0; c < width; c++) {
      row.push(cell(overrides[`${c},${r}`] ?? {}));
    }
    out.push(row);
  }
  return out;
}

describe("computeLighting — day mode", () => {
  it("clears every cell tint and marks every source visible", () => {
    const grid = makeGrid(3, 3, {
      "1,1": { light_source: true, light_range: 2 },
    });
    const r = computeLighting({
      grid,
      party: null,
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    expect(r.cells.size).toBe(9);
    for (const info of r.cells.values()) {
      expect(info.tint).toBeNull();
      expect(info.brightness).toBe(255);
      expect(info.isInfravisionRed).toBe(false);
    }
    expect(r.sourceVisible.get("1,1")).toBe(true);
  });
});

describe("computeLighting — night mode, no party", () => {
  it("dims every cell to ambient and gates source visibility safely", () => {
    // Painting view of the editor: no party on the map. Helper
    // should treat every torch as "visible" (no LOS to gate on)
    // so the renderer still draws the floor at ambient-plus-pool.
    const grid = makeGrid(7, 7, {
      "3,3": { light_source: true, light_range: 1 },
    });
    const r = computeLighting({
      grid,
      party: null,
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Torch is visible (no LOS gate).
    expect(r.sourceVisible.get("3,3")).toBe(true);
    // Cell under the torch — distance 0 from its own source,
    // fully lit (brightness 255 → null tint).
    expect(r.cells.get("3,3")?.tint).toBeNull();
    // Far corner is well outside the torch's 1-tile pool — stays
    // ambient (~0.1 of 255 ≈ 25).
    const corner = r.cells.get("6,6");
    expect(corner?.brightness).toBeLessThan(40);
  });
});

describe("computeLighting — party baseline (range 1)", () => {
  it("lights the party cell + adjacent cells, leaves further cells dim", () => {
    const grid = makeGrid(5, 5);
    const r = computeLighting({
      grid,
      party: { col: 2, row: 2 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Party cell — distance 0 from baseline source, fully lit.
    expect(r.cells.get("2,2")?.brightness).toBe(255);
    // Adjacent cell (Chebyshev 1) — half lit by falloff.
    expect(r.cells.get("3,2")?.brightness).toBeGreaterThan(100);
    expect(r.cells.get("3,2")?.brightness).toBeLessThan(180);
    // Two cells away — outside baseline range, stays ambient.
    expect(r.cells.get("4,2")?.brightness).toBeLessThan(40);
  });
});

describe("computeLighting — torch with party LOS", () => {
  it("lights torch's pool when party has LOS", () => {
    const grid = makeGrid(7, 3, {
      "5,1": { light_source: true, light_range: 2 },
    });
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Torch is visible from party (open corridor).
    expect(r.sourceVisible.get("5,1")).toBe(true);
    // Cell adjacent to the torch should be lit by the torch.
    expect(r.cells.get("4,1")?.brightness).toBeGreaterThan(100);
  });

  it("hides a torch behind a wall and casts no light from it", () => {
    // Party at (1,1); torch at (5,1); wall at (3,1) blocks LOS.
    const grid = makeGrid(7, 3, {
      "3,1": { walkable: false, obstructs: true },
      "5,1": { light_source: true, light_range: 2 },
    });
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    expect(r.sourceVisible.get("5,1")).toBe(false);
    // Cell adjacent to the (hidden) torch should NOT be lit.
    expect(r.cells.get("6,1")?.brightness).toBeLessThan(40);
  });
});

describe("computeLighting — infravision", () => {
  it("renders LOS cells in red when no other source reaches them", () => {
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    // Far cell — outside baseline range, but in LOS of party →
    // infravision red applies.
    const far = r.cells.get("4,0");
    expect(far?.isInfravisionRed).toBe(true);
    expect(far?.brightness).toBe(INFRAVISION_RED);
    expect(far?.tint).toBe((INFRAVISION_RED << 16) | 0 | 0);
  });

  it("respects walls — cells beyond a wall stay dark, not red", () => {
    const grid = makeGrid(5, 1, {
      "2,0": { walkable: false, obstructs: true },
    });
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    // (4,0) is behind the wall — no infravision, ambient only.
    const behind = r.cells.get("4,0");
    expect(behind?.isInfravisionRed).toBe(false);
    expect(behind?.brightness).toBeLessThan(40);
  });

  it("does not overwrite a torch-lit cell with red", () => {
    const grid = makeGrid(5, 1, {
      "3,0": { light_source: true, light_range: 1 },
    });
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    // (3,0) is the torch itself — lit by a real source, no red.
    const torchCell = r.cells.get("3,0");
    expect(torchCell?.isInfravisionRed).toBe(false);
    expect(torchCell?.brightness).toBe(255);
  });
});

describe("tintForCell", () => {
  it('returns mode "clear" when the cell is fully lit', () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Party cell is brightness 255 → no tint needed.
    expect(tintForCell(r, 1, 1).mode).toBe("clear");
  });

  it('returns mode "tint" with grayscale RGB when partially lit', () => {
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    const adj = tintForCell(r, 1, 0);
    expect(adj.mode).toBe("tint");
    // Same byte across R/G/B → no colour, just dim white.
    const red = (adj.value >> 16) & 0xff;
    const green = (adj.value >> 8) & 0xff;
    const blue = adj.value & 0xff;
    expect(red).toBe(green);
    expect(green).toBe(blue);
  });

  it('returns mode "tint" with red-only RGB for infravision cells', () => {
    // Multiply mode (not fill) so transparent-ish sprite pixels
    // stay transparent and the colored detail pixels are what
    // read as red. Tiles like grass (mostly black with scattered
    // green specks) render as "black with red specks" rather
    // than a uniform red rectangle that loses every detail.
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    const far = tintForCell(r, 4, 0);
    expect(far.mode).toBe("tint");
    expect((far.value >> 16) & 0xff).toBe(INFRAVISION_RED);
    expect((far.value >> 8) & 0xff).toBe(0);
    expect(far.value & 0xff).toBe(0);
  });

  it("returns clear for off-grid lookups", () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    expect(tintForCell(r, 99, 99).mode).toBe("clear");
  });
});

describe("emitterVisibleAt", () => {
  it("hides emitters on cells at night-ambient (party can't see)", () => {
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Cell (4,0) is outside the 1-tile baseline → ambient.
    expect(emitterVisibleAt(r, 4, 0)).toBe(false);
  });

  it("shows emitters on cells the party can see (lit)", () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Party cell is fully lit by the baseline.
    expect(emitterVisibleAt(r, 1, 1)).toBe(true);
  });

  it("hides emitters on infravision-red cells", () => {
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    // Far cell renders red — emitter should NOT pop through.
    expect(emitterVisibleAt(r, 4, 0)).toBe(false);
  });

  it("shows emitters in day mode regardless of position", () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    expect(emitterVisibleAt(r, 0, 0)).toBe(true);
    expect(emitterVisibleAt(r, 2, 2)).toBe(true);
  });

  it("returns false for off-grid lookups", () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: null,
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    expect(emitterVisibleAt(r, 99, 99)).toBe(false);
  });
});
