/**
 * Unit tests for the pressure-plate toggle layer.
 *
 * Covers the contract end to end at the save level: a press writes a
 * tile override (the same shape quest tile_adds use, so the existing
 * mount-time apply pass repaints it), a second press removes it, and
 * the live-map mutation path (grid swap + sprite repaint + relight +
 * pristine restore) fires only when the target map is mounted.
 */
import { describe, expect, it } from "vitest";

import {
  plateIsActive,
  readPressurePlate,
  togglePressurePlate,
  type PlatePaletteTile,
  type PressurePlateDef,
} from "./pressurePlates";
import type { WorldSave } from "./saveTypes";

function baseSave(): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "2026-01-01T00:00:00.000Z",
    moduleId: "default",
    clockMinutes: 0,
    party: {
      currentMapId: "town",
      col: 2,
      row: 2,
      avatar: "person/fighter18.png",
      gold: 0,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      roster: [],
      members: [],
    },
    maps: {},
    dungeons: {},
  };
}

const PALETTE: PlatePaletteTile[] = [
  { id: "floor", sprite: "tile/floor.png", walkable: true },
  { id: "door_open", sprite: "tile/door_open.png", walkable: true },
  { id: "door_closed", sprite: "tile/door_closed.png", walkable: false },
  { id: "bridge", sprite: "tile/bridge.png", walkable: true },
];

const PLATE: PressurePlateDef = {
  map_id: "town",
  col: 5,
  row: 3,
  tile_id: "door_open",
};

/** A minimal live-map ctx with spies for renderer calls. */
function liveCtx(mapId = "town") {
  const calls: string[] = [];
  const grid: Array<Array<Record<string, unknown>>> = Array.from(
    { length: 6 },
    (_, r) =>
      Array.from({ length: 8 }, (_, c) => ({
        id: r === 3 && c === 5 ? "door_closed" : "floor",
        sprite:
          r === 3 && c === 5 ? "tile/door_closed.png" : "tile/floor.png",
        walkable: !(r === 3 && c === 5),
      })),
  );
  return {
    calls,
    grid,
    ctx: {
      liveMapId: mapId,
      liveMap: { width: 8, height: 6, grid: grid as Array<Array<unknown>> },
      palette: PALETTE,
      renderer: {
        setCellSprite: (col: number, row: number, sprite: string) =>
          void calls.push(`sprite:${col},${row}:${sprite}`),
        relight: () => void calls.push("relight"),
      },
      sim: {
        addBoatAt: (col: number, row: number, sprite: string) =>
          void calls.push(`boat:${col},${row}:${sprite}`),
      },
      pristine: new Map<string, unknown>(),
    },
  };
}

describe("readPressurePlate", () => {
  it("reads a valid block and rejects malformed ones", () => {
    expect(
      readPressurePlate({ pressure_plate: PLATE }),
    ).toEqual(PLATE);
    expect(readPressurePlate(null)).toBeNull();
    expect(readPressurePlate({})).toBeNull();
    expect(readPressurePlate({ pressure_plate: null })).toBeNull();
    expect(
      readPressurePlate({ pressure_plate: { ...PLATE, map_id: "" } }),
    ).toBeNull();
    expect(
      readPressurePlate({ pressure_plate: { ...PLATE, tile_id: "" } }),
    ).toBeNull();
    expect(
      readPressurePlate({ pressure_plate: { ...PLATE, col: NaN } }),
    ).toBeNull();
  });
});

describe("togglePressurePlate — save semantics", () => {
  it("first press writes the override, second press removes it", () => {
    const { ctx } = liveCtx();
    const s0 = baseSave();
    expect(plateIsActive(s0, PLATE)).toBe(false);

    const r1 = togglePressurePlate(s0, PLATE, ctx);
    expect(r1.kind).toBe("activated");
    expect(r1.nextSave.maps["town"].tileOverrides).toEqual([
      { col: 5, row: 3, tileId: "door_open" },
    ]);
    expect(plateIsActive(r1.nextSave, PLATE)).toBe(true);

    const r2 = togglePressurePlate(r1.nextSave, PLATE, ctx);
    expect(r2.kind).toBe("deactivated");
    expect(r2.nextSave.maps["town"].tileOverrides).toEqual([]);
    expect(plateIsActive(r2.nextSave, PLATE)).toBe(false);
  });

  it("preserves unrelated overrides (e.g. a quest bridge)", () => {
    const { ctx } = liveCtx();
    const s0: WorldSave = {
      ...baseSave(),
      maps: {
        town: {
          unlockedCells: [],
          defeatedEncounters: [],
          destroyedLairs: [],
          tileOverrides: [{ col: 1, row: 1, tileId: "bridge" }],
        },
      },
    };
    const r1 = togglePressurePlate(s0, PLATE, ctx);
    const r2 = togglePressurePlate(r1.nextSave, PLATE, ctx);
    expect(r2.nextSave.maps["town"].tileOverrides).toEqual([
      { col: 1, row: 1, tileId: "bridge" },
    ]);
  });

  it("targets another map without touching the live grid", () => {
    const { ctx, calls, grid } = liveCtx("town");
    const remote: PressurePlateDef = { ...PLATE, map_id: "crypt" };
    const before = JSON.stringify(grid);
    const r1 = togglePressurePlate(baseSave(), remote, ctx);
    expect(r1.kind).toBe("activated");
    expect(r1.nextSave.maps["crypt"].tileOverrides).toEqual([
      { col: 5, row: 3, tileId: "door_open" },
    ]);
    expect(JSON.stringify(grid)).toBe(before);
    expect(calls).toEqual([]);
  });

  it("no-ops (invalid) when the replace tile isn't in the palette", () => {
    const { ctx } = liveCtx();
    const bad: PressurePlateDef = { ...PLATE, tile_id: "no_such_tile" };
    const s0 = baseSave();
    const r = togglePressurePlate(s0, bad, ctx);
    expect(r.kind).toBe("invalid");
    expect(r.nextSave).toBe(s0);
  });
});

describe("togglePressurePlate — live map mutation", () => {
  it("swaps the live cell, repaints, relights, and restores on the second press", () => {
    const { ctx, calls, grid } = liveCtx();
    const s0 = baseSave();

    const r1 = togglePressurePlate(s0, PLATE, ctx);
    expect(r1.kind).toBe("activated");
    // Grid cell replaced by the palette tile — walkability flipped.
    expect(grid[3][5].id).toBe("door_open");
    expect(grid[3][5].walkable).toBe(true);
    expect(calls).toContain("sprite:5,3:tile/door_open.png");
    expect(calls).toContain("relight");
    // Original stashed for the restore.
    expect(
      (ctx.pristine.get("5,3") as { id: string }).id,
    ).toBe("door_closed");

    calls.length = 0;
    const r2 = togglePressurePlate(r1.nextSave, PLATE, ctx);
    expect(r2.kind).toBe("deactivated");
    // Authored cell restored from the pristine stash.
    expect(grid[3][5].id).toBe("door_closed");
    expect(grid[3][5].walkable).toBe(false);
    expect(calls).toContain("sprite:5,3:tile/door_closed.png");
    expect(calls).toContain("relight");
  });

  it("restore falls back to a remaining override on the same cell", () => {
    const { ctx, grid } = liveCtx();
    // A quest already painted the target cell to a bridge.
    const s0: WorldSave = {
      ...baseSave(),
      maps: {
        town: {
          unlockedCells: [],
          defeatedEncounters: [],
          destroyedLairs: [],
          tileOverrides: [{ col: 5, row: 3, tileId: "bridge" }],
        },
      },
    };
    const r1 = togglePressurePlate(s0, PLATE, ctx);
    expect(grid[3][5].id).toBe("door_open");
    const r2 = togglePressurePlate(r1.nextSave, PLATE, ctx);
    expect(r2.kind).toBe("deactivated");
    // Restored to the bridge (the still-applicable override), not
    // the authored door.
    expect(grid[3][5].id).toBe("bridge");
    expect(r2.nextSave.maps["town"].tileOverrides).toEqual([
      { col: 5, row: 3, tileId: "bridge" },
    ]);
  });

  it("registers a boat-flagged replacement with the kernel", () => {
    const { ctx, calls } = liveCtx();
    const boatPalette = [
      ...PALETTE,
      { id: "rowboat", sprite: "tile/rowboat.png", boat: true },
    ];
    const r = togglePressurePlate(
      baseSave(),
      { ...PLATE, tile_id: "rowboat" },
      { ...ctx, palette: boatPalette },
    );
    expect(r.kind).toBe("activated");
    expect(calls).toContain("boat:5,3:tile/rowboat.png");
  });

  it("skips out-of-bounds targets but still persists the override", () => {
    const { ctx, calls } = liveCtx();
    const oob: PressurePlateDef = { ...PLATE, col: 99, row: 99 };
    const r = togglePressurePlate(baseSave(), oob, ctx);
    expect(r.kind).toBe("activated");
    expect(r.nextSave.maps["town"].tileOverrides).toEqual([
      { col: 99, row: 99, tileId: "door_open" },
    ]);
    expect(calls).toEqual([]);
  });

  it("round-trips through JSON like the save layer does", () => {
    const { ctx } = liveCtx();
    const r1 = togglePressurePlate(baseSave(), PLATE, ctx);
    const reloaded = JSON.parse(JSON.stringify(r1.nextSave)) as WorldSave;
    expect(plateIsActive(reloaded, PLATE)).toBe(true);
    const r2 = togglePressurePlate(reloaded, PLATE, ctx);
    expect(plateIsActive(r2.nextSave, PLATE)).toBe(false);
  });
});
