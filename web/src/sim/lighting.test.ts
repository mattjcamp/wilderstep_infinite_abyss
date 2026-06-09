import { describe, it, expect } from "vitest";
import {
  computeLighting,
  DEFAULT_SIGHT_RADIUS,
  emitterVisibleAt,
  INFRAVISION_RED,
  overlayVisibleAt,
  REMEMBERED_BRIGHTNESS,
  tintForCell,
  VISIBILITY_THRESHOLD,
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

describe("computeLighting — fog memory grows for what's lit", () => {
  it("remembers a torch-lit cell beyond the sight radius (night)", () => {
    // Open corridor. Party at col 0; a torch at col 3 (range 3) the
    // party can see lights cells well past the night sight radius (1).
    const grid = makeGrid(8, 1, {
      "3,0": { light_source: true, light_range: 3 },
    });
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null, // baseline range 1 only
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set<string>(),
      // night default sight radius is 1 — far cells only get remembered
      // if they're lit by a real source (the fix under test).
    });
    // (5,0): 2 tiles from the torch → lit; 5 tiles from the party →
    // outside the radius. It must still be remembered because the party
    // can see it lit.
    expect(r.currentlyVisible.has("5,0")).toBe(true);
    // (7,0): beyond the torch's range → unlit ambient → not seen, so
    // the radius gate still keeps it out of memory (no false reveal).
    expect(r.currentlyVisible.has("7,0")).toBe(false);
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

// ─── Fog of war (remembered cells) ────────────────────────────────
// Three render bands compose:
//   - currently visible: lit (party pool / torch / infravision) →
//     bright tint, currentlyVisible set
//   - remembered + currently dim: in the host's rememberedCells set
//     but outside the current light pool → paint at the dim
//     REMEMBERED_BRIGHTNESS gray
//   - never seen + currently dim: ambient floor (~25), no fog
//
// Day mode short-circuits — every cell is already at full brightness
// so the remembered band is moot, but currentlyVisible must still
// include every cell so the host's union grows correctly.
describe("computeLighting — fog of war", () => {
  it("paints a remembered cell at REMEMBERED_BRIGHTNESS when it's currently outside the party's light pool", () => {
    // 9-wide so cell (8,0) sits well outside the party's range-1
    // baseline at (0,0).
    const grid = makeGrid(9, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set(["8,0"]),
    });
    const remembered = r.cells.get("8,0");
    expect(remembered?.isRemembered).toBe(true);
    expect(remembered?.brightness).toBe(REMEMBERED_BRIGHTNESS);
    // Tint is grayscale at the band brightness.
    const expectedTint =
      (REMEMBERED_BRIGHTNESS << 16) |
      (REMEMBERED_BRIGHTNESS << 8) |
      REMEMBERED_BRIGHTNESS;
    expect(remembered?.tint).toBe(expectedTint);
    // A cell in the same row that ISN'T remembered stays at ambient.
    const dark = r.cells.get("7,0");
    expect(dark?.isRemembered).toBe(false);
    expect(dark?.brightness).toBeLessThan(40);
  });

  it("never dims a currently-lit cell down into the remembered band", () => {
    // Party at (1,1), so (0,1), (1,0), (1,1), (2,1), (1,2) are all
    // in the range-1 baseline pool — fully bright. Mark all of them
    // remembered. They must keep their full brightness, not collapse
    // to the dim band.
    const grid = makeGrid(3, 3);
    const remembered = new Set([
      "0,1", "1,0", "1,1", "1,2", "2,1",
    ]);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: remembered,
    });
    for (const key of remembered) {
      const info = r.cells.get(key);
      expect(info?.isRemembered).toBe(false);
      expect(info?.brightness ?? 0).toBeGreaterThan(REMEMBERED_BRIGHTNESS);
    }
  });

  it("returns currentlyVisible covering every cell whose brightness clears VISIBILITY_THRESHOLD", () => {
    const grid = makeGrid(7, 1);
    const r = computeLighting({
      grid,
      party: { col: 3, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    // Party's range-1 pool covers (2,0), (3,0), (4,0). Verify all
    // three are in currentlyVisible AND clear the threshold.
    expect(r.currentlyVisible.has("3,0")).toBe(true);
    expect(r.currentlyVisible.has("2,0")).toBe(true);
    expect(r.currentlyVisible.has("4,0")).toBe(true);
    for (const key of ["2,0", "3,0", "4,0"]) {
      expect(r.cells.get(key)!.brightness).toBeGreaterThanOrEqual(
        VISIBILITY_THRESHOLD,
      );
    }
    // Dim corner — outside the pool, well below the threshold.
    expect(r.currentlyVisible.has("0,0")).toBe(false);
    expect(r.cells.get("0,0")!.brightness).toBeLessThan(VISIBILITY_THRESHOLD);
  });

  it("includes infravision-revealed cells in currentlyVisible (they count as 'currently seen')", () => {
    // Dwarf with infravision standing at (0,0) — every cell in LOS
    // gets the red band. Even (4,0) at the far end of the row
    // should be in currentlyVisible so the host's union grows to
    // cover the explored area.
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    for (let c = 0; c < 5; c++) {
      const key = `${c},0`;
      expect(r.cells.get(key)?.isInfravisionRed).toBe(true);
      expect(r.currentlyVisible.has(key)).toBe(true);
    }
  });

  it("doesn't add remembered-only cells to currentlyVisible", () => {
    // (8,0) is remembered but outside the party's pool. The fog
    // band renders it dim, but the host hasn't seen it on THIS
    // frame — so it must NOT appear in currentlyVisible (otherwise
    // the renderer would keep marking fog-of-war cells as still-
    // visited, which is a no-op but conceptually wrong).
    const grid = makeGrid(9, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set(["8,0"]),
    });
    expect(r.cells.get("8,0")?.isRemembered).toBe(true);
    expect(r.currentlyVisible.has("8,0")).toBe(false);
  });

  it("day mode renders every cell bright, none remembered; small map fully within sight is all mapped", () => {
    const grid = makeGrid(3, 3);
    const r = computeLighting({
      grid,
      party: { col: 1, row: 1 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
      // Even with a populated rememberedCells set, day mode reads
      // every cell as fully lit — the dim fog band is moot at noon.
      rememberedCells: new Set(["0,0", "2,2"]),
    });
    // Every cell is at full brightness, none in the dim band.
    for (const info of r.cells.values()) {
      expect(info.isRemembered).toBe(false);
      expect(info.brightness).toBe(255);
    }
    // The 3x3 sits entirely inside the default daylight sight radius
    // (10), so all 9 cells get mapped into the fog memory this frame.
    expect(r.currentlyVisible.size).toBe(9);
  });

  it("day mode does NOT map cells beyond the daylight sight radius (the fog-of-war bug)", () => {
    // A wide open map. Party at the far-left edge. In daylight every
    // cell renders bright, but only cells within DEFAULT_SIGHT_RADIUS
    // .day (10) of the party should be folded into the visited set —
    // the bug was that the whole grid got marked explored on entry.
    const width = 30;
    const grid = makeGrid(width, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    // Rendering: every cell is fully lit (daylight, no fog dimming).
    for (const info of r.cells.values()) {
      expect(info.brightness).toBe(255);
      expect(info.isRemembered).toBe(false);
    }
    // Memory: cells within radius 10 are mapped, cell 0..10 inclusive.
    expect(r.currentlyVisible.has("0,0")).toBe(true);
    expect(r.currentlyVisible.has(`${DEFAULT_SIGHT_RADIUS.day},0`)).toBe(true);
    // Cell just outside the radius is NOT mapped — stays unexplored
    // until the party walks closer.
    expect(r.currentlyVisible.has(`${DEFAULT_SIGHT_RADIUS.day + 1},0`)).toBe(
      false,
    );
    expect(r.currentlyVisible.has(`${width - 1},0`)).toBe(false);
  });

  it("flags never-seen cells isUnexplored in day mode (drives the cloud layer); seen/remembered cells are not", () => {
    // 30-wide daylight map, party at the left edge, an explicit
    // remembered cell far away. Cells within sight are seen (not
    // unexplored); the remembered cell is remembered (not unexplored);
    // a never-seen cell outside both is flagged for cloud cover.
    const grid = makeGrid(30, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
      rememberedCells: new Set(["20,0"]),
    });
    // In-sight cell: visible now → not unexplored.
    expect(r.cells.get("0,0")?.isUnexplored).toBe(false);
    expect(r.currentlyVisible.has("0,0")).toBe(true);
    // Remembered cell: previously seen → not unexplored (no cloud).
    expect(r.cells.get("20,0")?.isUnexplored).toBe(false);
    // Never-seen cell beyond the sight radius: clouded.
    expect(r.cells.get("29,0")?.isUnexplored).toBe(true);
  });

  it("flags never-seen cells isUnexplored at night too (renderer covers them as void)", () => {
    // The reported bug: at night, a never-seen cell fell to the
    // ambient floor and its silhouette leaked through. The flag must
    // be set in night mode as well so the renderer can cover it.
    const grid = makeGrid(9, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set(["7,0"]),
    });
    // Party cell is lit + seen → not unexplored.
    expect(r.cells.get("0,0")?.isUnexplored).toBe(false);
    // Remembered cell → not unexplored (gets the grey band, not cover).
    expect(r.cells.get("7,0")?.isUnexplored).toBe(false);
    // A far, dim, never-seen cell → flagged for cover even at night.
    const far = r.cells.get("5,0");
    expect(far?.isRemembered).toBe(false);
    expect(far?.isUnexplored).toBe(true);
  });

  it("does not flag isUnexplored when fog is disabled (no rememberedCells) or there's no party", () => {
    const grid = makeGrid(20, 1);
    // No rememberedCells → fog inactive → never clouded, even in day.
    const noFog = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    for (const info of noFog.cells.values()) {
      expect(info.isUnexplored).toBe(false);
    }
    // No party (paint view) → never clouded regardless of fog set.
    const noParty = computeLighting({
      grid,
      party: null,
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
      rememberedCells: new Set(["5,0"]),
    });
    for (const info of noParty.cells.values()) {
      expect(info.isUnexplored).toBe(false);
    }
  });

  it("no party (paint view) maps nothing even in day mode", () => {
    // The editor's painting view has no party; nothing should be
    // folded into the fog memory regardless of mode.
    const grid = makeGrid(5, 5);
    const r = computeLighting({
      grid,
      party: null,
      partyLight: null,
      partyInfravisionActive: false,
      mode: "day",
    });
    expect(r.currentlyVisible.size).toBe(0);
  });

  it("night mode maps only the party's own pool; an explicit sightRadius widens it", () => {
    // Open 1-row corridor, party at far left, no emitted light. With
    // the default night sight radius (1) only the party cell + the two
    // adjacent cells (the range-1 baseline pool with LOS) are mapped.
    const grid = makeGrid(9, 1);
    const tight = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    expect(tight.currentlyVisible.has("0,0")).toBe(true);
    expect(tight.currentlyVisible.has("1,0")).toBe(true);
    // Cell 2 is outside both the night radius (1) and the lit pool.
    expect(tight.currentlyVisible.has("2,0")).toBe(false);

    // A wider explicit radius (e.g. a Light spell extending reach to 5)
    // maps further out — but ONLY cells the party can actually see and
    // that clear the visibility threshold. Pass a real party light so
    // the pool itself extends, matching how the renderer folds
    // max(modeRadius, partyLight.range) in.
    const wide = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: { range: 5 } as never,
      partyInfravisionActive: false,
      mode: "night",
      sightRadius: 5,
    });
    expect(wide.currentlyVisible.has("3,0")).toBe(true);
  });

  it("emitterVisibleAt hides emitters on remembered-only cells", () => {
    // Without fog, a cell at brightness REMEMBERED_BRIGHTNESS (90)
    // would clear emitterVisibleAt's `>30` threshold. But a
    // remembered cell isn't being WATCHED — the party walked past.
    // The emitter (torch flame, fairy lights, etc.) must hide.
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set(["4,0"]),
    });
    expect(r.cells.get("4,0")?.isRemembered).toBe(true);
    expect(emitterVisibleAt(r, 4, 0)).toBe(false);
  });

  it("overlayVisibleAt hides roamers on remembered cells but keeps them on infravision cells", () => {
    // Remembered → false (a goblin that walked into the corridor
    // since the party left should NOT render).
    const grid = makeGrid(5, 1);
    const remOnly = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
      rememberedCells: new Set(["4,0"]),
    });
    expect(overlayVisibleAt(remOnly, 4, 0)).toBe(false);
    // Infravision → true (the party IS watching).
    const infra = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: true,
      mode: "night",
    });
    expect(overlayVisibleAt(infra, 4, 0)).toBe(true);
  });

  it("omitting rememberedCells preserves the legacy single-band behaviour", () => {
    // No remembered set passed — every cell that isn't in LOS reads
    // as plain ambient dark, no fog tint, isRemembered always false.
    const grid = makeGrid(5, 1);
    const r = computeLighting({
      grid,
      party: { col: 0, row: 0 },
      partyLight: null,
      partyInfravisionActive: false,
      mode: "night",
    });
    for (const info of r.cells.values()) {
      expect(info.isRemembered).toBe(false);
    }
    // (4,0) is just ambient-dim, not REMEMBERED_BRIGHTNESS.
    expect(r.cells.get("4,0")!.brightness).toBeLessThan(REMEMBERED_BRIGHTNESS);
  });
});
