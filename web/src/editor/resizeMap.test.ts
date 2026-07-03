import { describe, expect, it } from "vitest";
import {
  dominantGroundTileId,
  resizeMapRecord,
  resizeValidationError,
  sanitizeFillCell,
  shiftPartyStart,
  shiftRefsIntoMap,
  type ResizeCell,
  type ResizeMapRecord,
} from "./resizeMap";

/** Terse cell builder — id + walkable, plus any extras. */
function cell(id: string, extra?: Partial<ResizeCell>): ResizeCell {
  return { id, walkable: id === "grass", ...extra };
}

/** 3×2 fixture (width 3, height 2):
 *    grass grass wall
 *    grass water grass
 */
function makeMap(id = "isle"): ResizeMapRecord {
  return {
    id,
    width: 3,
    height: 2,
    grid: [
      [cell("grass"), cell("grass"), cell("wall")],
      [cell("grass"), cell("water"), cell("grass")],
    ],
  };
}

describe("dominantGroundTileId", () => {
  it("picks the most common walkable id", () => {
    expect(dominantGroundTileId(makeMap().grid)).toBe("grass");
  });

  it("falls back to most common overall when nothing is walkable", () => {
    const grid = [
      [cell("wall"), cell("wall")],
      [cell("water"), cell("wall")],
    ];
    expect(dominantGroundTileId(grid)).toBe("wall");
  });

  it("returns null for an empty grid", () => {
    expect(dominantGroundTileId([])).toBeNull();
  });
});

describe("sanitizeFillCell", () => {
  it("scrubs gameplay refs but keeps terrain fields", () => {
    const dirty = cell("grass", {
      sprite: "map/grass.png",
      link: { map_id: "town", x: 1, y: 1 },
      pressure_plate: { map_id: "town", col: 0, row: 0, tile_id: "door" },
      npc: "mayor",
      item: "iron_key",
      encounter: "goblins",
      spawn: "rat_nest",
      text: "A sign.",
    });
    const clean = sanitizeFillCell(dirty);
    expect(clean.id).toBe("grass");
    expect(clean.sprite).toBe("map/grass.png");
    expect(clean.link).toBeUndefined();
    expect(clean.pressure_plate).toBeUndefined();
    expect(clean.npc).toBeUndefined();
    expect(clean.item).toBeUndefined();
    expect(clean.encounter).toBeUndefined();
    expect(clean.spawn).toBeUndefined();
    expect(clean.text).toBe("");
    // Input untouched.
    expect(dirty.npc).toBe("mayor");
  });
});

describe("resizeValidationError", () => {
  it("rejects no-op, negatives, non-integers, and cap overflow", () => {
    const e0 = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(resizeValidationError(3, 2, e0)).toMatch(/at least one/);
    expect(
      resizeValidationError(3, 2, { ...e0, left: -1 }),
    ).toMatch(/whole numbers/);
    expect(
      resizeValidationError(3, 2, { ...e0, top: 1.5 }),
    ).toMatch(/whole numbers/);
    expect(
      resizeValidationError(250, 2, { ...e0, right: 10 }),
    ).toMatch(/capped/);
    expect(resizeValidationError(3, 2, { ...e0, right: 2 })).toBeNull();
  });
});

describe("resizeMapRecord", () => {
  const fill = cell("grass", { sprite: "map/grass.png" });

  it("grows bottom/right without moving existing content", () => {
    const out = resizeMapRecord(
      makeMap(),
      { top: 0, right: 2, bottom: 1, left: 0 },
      fill,
    );
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    // Original cells at original coordinates.
    expect(out.grid[0][2].id).toBe("wall");
    expect(out.grid[1][1].id).toBe("water");
    // New cells filled.
    expect(out.grid[0][4].id).toBe("grass");
    expect(out.grid[2][0].id).toBe("grass");
  });

  it("grows top/left by shifting content down/right", () => {
    const out = resizeMapRecord(
      makeMap(),
      { top: 2, right: 0, bottom: 0, left: 1 },
      fill,
    );
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    // (col, row) → (col+1, row+2)
    expect(out.grid[2][3].id).toBe("wall");
    expect(out.grid[3][2].id).toBe("water");
    // New border cells filled.
    expect(out.grid[0][0].id).toBe("grass");
    expect(out.grid[2][0].id).toBe("grass");
  });

  it("deep-copies the fill so new cells never alias each other", () => {
    const out = resizeMapRecord(
      makeMap(),
      { top: 0, right: 1, bottom: 0, left: 0 },
      fill,
    );
    expect(out.grid[0][3]).not.toBe(out.grid[1][3]);
    expect(out.grid[0][3]).not.toBe(fill);
  });

  it("does not mutate the input map", () => {
    const input = makeMap();
    resizeMapRecord(input, { top: 1, right: 0, bottom: 0, left: 1 }, fill);
    expect(input.width).toBe(3);
    expect(input.height).toBe(2);
    expect(input.grid[0][2].id).toBe("wall");
  });

  it("throws on an invalid resize", () => {
    expect(() =>
      resizeMapRecord(
        makeMap(),
        { top: 0, right: 0, bottom: 0, left: 0 },
        fill,
      ),
    ).toThrow(/at least one/);
  });
});

describe("shiftRefsIntoMap", () => {
  it("shifts links + pressure plates targeting the map, including self-links", () => {
    const resized = makeMap("isle");
    resized.grid[0][0] = cell("portal", {
      link: { map_id: "isle", x: 2, y: 1 }, // self-link
    });
    const other: ResizeMapRecord = {
      id: "town",
      width: 2,
      height: 1,
      grid: [
        [
          cell("gate", { link: { map_id: "isle", x: 0, y: 0 } }),
          cell("plate", {
            pressure_plate: { map_id: "isle", col: 1, row: 1, tile_id: "t" },
            link: { map_id: "elsewhere", x: 5, y: 5 }, // untouched
          }),
        ],
      ],
    };
    const [out, changed] = shiftRefsIntoMap([resized, other], "isle", 1, 2);
    expect(changed).toBe(3);
    expect(out[0].grid[0][0].link).toEqual({ map_id: "isle", x: 3, y: 3 });
    expect(out[1].grid[0][0].link).toEqual({ map_id: "isle", x: 1, y: 2 });
    expect(out[1].grid[0][1].pressure_plate).toEqual({
      map_id: "isle",
      col: 2,
      row: 3,
      tile_id: "t",
    });
    expect(out[1].grid[0][1].link).toEqual({
      map_id: "elsewhere",
      x: 5,
      y: 5,
    });
    // Untouched inputs.
    expect(other.grid[0][0].link).toEqual({ map_id: "isle", x: 0, y: 0 });
  });

  it("passes unaffected maps through by reference and is a no-op at 0,0", () => {
    const a = makeMap("a");
    const b = makeMap("b");
    const [out, changed] = shiftRefsIntoMap([a, b], "isle", 1, 1);
    expect(changed).toBe(0);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
    const [out2, changed2] = shiftRefsIntoMap([a], "a", 0, 0);
    expect(changed2).toBe(0);
    expect(out2[0]).toBe(a);
  });
});

describe("shiftPartyStart", () => {
  const party = {
    start_position: { map_id: "isle", col: 4, row: 16 },
    gold: 50,
  };

  it("shifts when the start map matches", () => {
    const [out, changed] = shiftPartyStart(party, "isle", 2, 3);
    expect(changed).toBe(true);
    expect(out.start_position).toEqual({ map_id: "isle", col: 6, row: 19 });
    expect(out.gold).toBe(50);
    // Input untouched.
    expect(party.start_position.col).toBe(4);
  });

  it("no-ops for other maps, missing start, or zero delta", () => {
    expect(shiftPartyStart(party, "town", 1, 1)[1]).toBe(false);
    expect(shiftPartyStart({ gold: 1 }, "isle", 1, 1)[1]).toBe(false);
    expect(shiftPartyStart(party, "isle", 0, 0)[1]).toBe(false);
  });
});
