import { describe, it, expect } from "vitest";
import {
  canPursue,
  fleeStep,
  hasLineOfSight,
  IDLE_WANDER_CHANCE,
  PURSUIT_RADIUS,
  randomRoamStep,
  trySpawnRoamer,
  roamStep,
  findLairs,
  findPlacedEncounters,
  findQuestPlacedEncounters,
  QUEST_TARGET_TINT,
  roamerCollidesWithParty,
  type SimSpawn,
  type SimRoamer,
  type SpawnCellInfo,
} from "./spawn";
import type { SimEncounterRef } from "./types";
import { mulberry32 } from "../battle/rng";

function makeSpawn(over: Partial<SimSpawn> = {}): SimSpawn {
  return {
    id: "monster_spawn",
    name: "Monster Spawn",
    description: "A test lair.",
    spawn_monsters: ["goblin"],
    spawn_chance: 100,
    spawn_radius: 5,
    max_spawned: 2,
    boss_monsters: ["goblin"],
    xp_reward: 50,
    gold_reward: 25,
    loot: [],
    ...over,
  };
}

describe("trySpawnRoamer", () => {
  it("returns null when the chance roll fails", () => {
    // chance = 1, rng forces .99 → ceil to 100, > 1 means skip.
    const out = trySpawnRoamer({
      lair: { col: 5, row: 5 },
      spawn: makeSpawn({ spawn_chance: 1 }),
      party: { col: 0, row: 0 },
      existing: [],
      isWalkable: () => true,
      rng: () => 0.99,
    });
    expect(out).toBeNull();
  });

  it("returns null when the lair is already at max_spawned", () => {
    const existing: SimRoamer[] = [
      { id: "r1", monsterId: "goblin", col: 5, row: 5, sourceKey: "5,5" },
      { id: "r2", monsterId: "goblin", col: 6, row: 5, sourceKey: "5,5" },
    ];
    const out = trySpawnRoamer({
      lair: { col: 5, row: 5 },
      spawn: makeSpawn({ max_spawned: 2 }),
      party: { col: 0, row: 0 },
      existing,
      isWalkable: () => true,
      rng: mulberry32(1),
    });
    expect(out).toBeNull();
  });

  it("ignores roamers from other lairs when counting crowding", () => {
    // A neighbouring lair filled its area; this lair should still spawn.
    const existing: SimRoamer[] = [
      { id: "r1", monsterId: "goblin", col: 5, row: 5, sourceKey: "9,9" },
      { id: "r2", monsterId: "goblin", col: 6, row: 5, sourceKey: "9,9" },
    ];
    const out = trySpawnRoamer({
      lair: { col: 5, row: 5 },
      spawn: makeSpawn({ max_spawned: 2 }),
      party: { col: 0, row: 0 },
      existing,
      isWalkable: () => true,
      rng: mulberry32(42),
    });
    expect(out).not.toBeNull();
  });

  it("never lands adjacent to or on the party cell", () => {
    // Lair at (5,5); party at (5,7). Only neighbour cell that is
    // both walkable, not on the party, and Manhattan>1 away is the
    // north / east / west cluster.
    const out = trySpawnRoamer({
      lair: { col: 5, row: 5 },
      spawn: makeSpawn(),
      party: { col: 5, row: 7 },
      existing: [],
      isWalkable: () => true,
      rng: mulberry32(7),
    });
    expect(out).not.toBeNull();
    if (out) {
      const manhattan = Math.abs(out.col - 5) + Math.abs(out.row - 7);
      expect(manhattan).toBeGreaterThan(1);
    }
  });

  it("populates sourceKey and sprite when provided", () => {
    const out = trySpawnRoamer({
      lair: { col: 4, row: 4 },
      spawn: makeSpawn({ spawn_monsters: ["goblin"] }),
      party: { col: 0, row: 0 },
      existing: [],
      isWalkable: () => true,
      rng: mulberry32(2),
      spriteFor: (id) => (id === "goblin" ? "monster/goblin.png" : undefined),
      makeId: () => "fixed-id",
    });
    expect(out).not.toBeNull();
    expect(out?.id).toBe("fixed-id");
    expect(out?.sourceKey).toBe("4,4");
    expect(out?.sprite).toBe("monster/goblin.png");
    expect(out?.monsterId).toBe("goblin");
  });
});

describe("roamStep", () => {
  it("returns the current cell when already on the party", () => {
    const out = roamStep(
      { col: 3, row: 3 },
      { col: 3, row: 3 },
      () => true,
    );
    expect(out).toEqual({ col: 3, row: 3 });
  });

  it("picks the cardinal step that reduces Chebyshev distance", () => {
    // Roamer at (0,0), party at (5,2). The step that most reduces
    // Chebyshev distance (5) is "right" → (1,0), which lowers it to 4.
    const out = roamStep(
      { col: 0, row: 0 },
      { col: 5, row: 2 },
      () => true,
    );
    expect(out).toEqual({ col: 1, row: 0 });
  });

  it("respects the blocked predicate", () => {
    // Roamer at (0,0), party at (5,0). "Right" is the natural pick;
    // block (1,0) and the roamer should sit still rather than going
    // up/down (those don't reduce distance).
    const out = roamStep(
      { col: 0, row: 0 },
      { col: 5, row: 0 },
      () => true,
      (c, r) => c === 1 && r === 0,
    );
    expect(out).toEqual({ col: 0, row: 0 });
  });

  it("respects the isWalkable predicate", () => {
    // Same setup but the wall is on the grid itself.
    const out = roamStep(
      { col: 0, row: 0 },
      { col: 5, row: 0 },
      (c, r) => !(c === 1 && r === 0),
    );
    expect(out).toEqual({ col: 0, row: 0 });
  });
});

describe("fleeStep", () => {
  it("walks up to `distance` cells directly away from the party", () => {
    // Roamer at (3,3), party at (1,3) — flee direction is +col.
    const out = fleeStep(
      { col: 3, row: 3 },
      { col: 1, row: 3 },
      3,
      () => true,
    );
    expect(
      Math.max(Math.abs(out.col - 1), Math.abs(out.row - 3)),
    ).toBe(5); // started at distance 2, fled 3
  });

  it("never decreases distance and stops when boxed in", () => {
    // Walls everywhere except the start cell — the roamer stays put.
    const out = fleeStep(
      { col: 2, row: 2 },
      { col: 0, row: 0 },
      5,
      (c, r) => c === 2 && r === 2,
    );
    expect(out).toEqual({ col: 2, row: 2 });
  });

  it("stops early at a wall instead of teleporting through it", () => {
    // Party at (0,2), roamer at (2,2); wall at col 4 — flee right
    // reaches (3,2) and... col 4 blocked, but up/down at col 3 keep
    // distance equal (3), not greater, so it halts at (3,2).
    const out = fleeStep(
      { col: 2, row: 2 },
      { col: 0, row: 2 },
      4,
      (c) => c < 4,
    );
    expect(out).toEqual({ col: 3, row: 2 });
  });

  it("respects the blocked predicate (occupied cells)", () => {
    // Party at (0,0), roamer at (2,2) — both "right" (3,2) and
    // "down" (2,3) would grow Chebyshev distance to 3. Block right
    // (another monster sits there) and the flee takes down instead.
    const out = fleeStep(
      { col: 2, row: 2 },
      { col: 0, row: 0 },
      1,
      () => true,
      (c, r) => c === 3 && r === 2,
    );
    expect(out).toEqual({ col: 2, row: 3 });
  });

  it("stays pinned when ahead is blocked and sidesteps don't help", () => {
    // Party directly left on the same row: with "right" blocked,
    // up/down keep Chebyshev distance EQUAL (not greater), so the
    // monster is pinned rather than oscillating sideways.
    const out = fleeStep(
      { col: 2, row: 2 },
      { col: 0, row: 2 },
      3,
      () => true,
      (c, r) => c === 3 && r === 2,
    );
    expect(out).toEqual({ col: 2, row: 2 });
  });
});

describe("randomRoamStep", () => {
  it("stays put when no cardinal neighbour is eligible (boxed in)", () => {
    const out = randomRoamStep(
      { col: 2, row: 2 },
      () => false, // nothing walkable
      undefined,
      () => 0,
    );
    expect(out).toEqual({ col: 2, row: 2 });
  });

  it("only ever picks a walkable, non-blocked cardinal neighbour", () => {
    // Open field; sweep the RNG across the whole [0,1) selection range
    // and confirm every result is a cardinal neighbour of the origin.
    const origin = { col: 5, row: 5 };
    const cardinals = new Set([
      "5,4",
      "5,6",
      "4,5",
      "6,5",
    ]);
    for (let i = 0; i < 12; i++) {
      const out = randomRoamStep(
        origin,
        () => true,
        undefined,
        () => i / 12,
      );
      expect(cardinals.has(`${out.col},${out.row}`)).toBe(true);
    }
  });

  it("respects the blocked predicate", () => {
    // Only (5,4) is walkable-and-unblocked; block everything else.
    const out = randomRoamStep(
      { col: 5, row: 5 },
      () => true,
      (c, r) => !(c === 5 && r === 4),
      () => 0,
    );
    expect(out).toEqual({ col: 5, row: 4 });
  });

  it("respects the isWalkable predicate", () => {
    // Only the cell above is walkable.
    const out = randomRoamStep(
      { col: 5, row: 5 },
      (c, r) => c === 5 && r === 4,
      undefined,
      () => 0.999,
    );
    expect(out).toEqual({ col: 5, row: 4 });
  });

  it("exposes a sane idle-wander rate (< the NPC rate)", () => {
    // Documents intent: monsters drift more lazily than townsfolk.
    expect(IDLE_WANDER_CHANCE).toBeGreaterThan(0);
    expect(IDLE_WANDER_CHANCE).toBeLessThan(0.5);
  });
});

describe("hasLineOfSight", () => {
  // Build a 10×3 grid of clear floor with optional walls. Cells with
  // obstructs:true block LOS; cells without obstructs (or null) don't.
  function makeRow(cols: number, walls: number[]): SpawnCellInfo[] {
    const row: SpawnCellInfo[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ walkable: !walls.includes(c), obstructs: walls.includes(c) });
    }
    return row;
  }

  it("returns true when source and destination are the same cell", () => {
    const grid = [makeRow(10, [])];
    expect(hasLineOfSight(grid, 4, 0, 4, 0)).toBe(true);
  });

  it("returns true on a clear straight horizontal line", () => {
    const grid = [makeRow(10, [])];
    expect(hasLineOfSight(grid, 0, 0, 9, 0)).toBe(true);
  });

  it("returns false when an obstructing cell sits between the endpoints", () => {
    const grid = [makeRow(10, [5])];
    expect(hasLineOfSight(grid, 0, 0, 9, 0)).toBe(false);
  });

  it("does not treat the destination cell's obstructs as a blocker", () => {
    // The wall *is* the destination — visible from outside even though
    // it would block anything trying to look past it. Mirrors the
    // lighting model: a wall's facing edge stays lit.
    const grid = [makeRow(10, [5])];
    expect(hasLineOfSight(grid, 0, 0, 5, 0)).toBe(true);
  });

  it("treats out-of-grid cells as non-obstructing", () => {
    // 3-wide grid; ask about a path that walks past col 5. Out-of-grid
    // reads as undefined which should not be treated as a wall.
    const grid = [makeRow(3, [])];
    expect(hasLineOfSight(grid, 0, 0, 2, 0)).toBe(true);
  });
});

describe("canPursue", () => {
  // 20×3 clear-floor grid for the radius tests. A single column of
  // wall at col 10 for the LOS tests.
  function clearGrid(cols: number, rows: number): SpawnCellInfo[][] {
    const grid: SpawnCellInfo[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: SpawnCellInfo[] = [];
      for (let c = 0; c < cols; c++) row.push({ walkable: true });
      grid.push(row);
    }
    return grid;
  }

  it("PURSUIT_RADIUS is 8 — anything inside the 8-tile Chebyshev box is in range", () => {
    expect(PURSUIT_RADIUS).toBe(8);
  });

  it("returns true when the party is within radius and visible", () => {
    const grid = clearGrid(20, 3);
    // Chebyshev distance 5, clear line.
    expect(canPursue({ col: 2, row: 1 }, { col: 7, row: 1 }, grid)).toBe(true);
  });

  it("returns true at the exact radius boundary (distance 8)", () => {
    const grid = clearGrid(20, 3);
    expect(canPursue({ col: 2, row: 1 }, { col: 10, row: 1 }, grid)).toBe(true);
  });

  it("returns false when the party is one tile beyond the radius", () => {
    const grid = clearGrid(20, 3);
    // Chebyshev distance 9 — out of range even with clear LOS.
    expect(canPursue({ col: 2, row: 1 }, { col: 11, row: 1 }, grid)).toBe(false);
  });

  it("returns false when an obstructs cell breaks line of sight", () => {
    const grid = clearGrid(20, 3);
    // Put a wall at col 5, row 1 — directly between monster and party.
    grid[1][5] = { walkable: false, obstructs: true };
    expect(canPursue({ col: 2, row: 1 }, { col: 7, row: 1 }, grid)).toBe(false);
  });

  it("honors a caller-supplied custom radius", () => {
    const grid = clearGrid(20, 3);
    // Distance 5 — inside the default 8 but outside an override of 3.
    expect(
      canPursue({ col: 2, row: 1 }, { col: 7, row: 1 }, grid, { radius: 3 }),
    ).toBe(false);
  });
});

describe("findLairs", () => {
  it("returns every cell whose spawn id resolves in the catalog", () => {
    const catalog = new Map<string, SimSpawn>([["monster_spawn", makeSpawn()]]);
    const grid: SpawnCellInfo[][] = [
      [{ walkable: true }, { walkable: true, spawn: "monster_spawn" }],
      [{ walkable: true, spawn: "unknown" }, { walkable: true, spawn: "monster_spawn" }],
    ];
    const out = findLairs(grid, catalog);
    expect(out.length).toBe(2);
    expect(out.map((o) => `${o.col},${o.row}`).sort()).toEqual([
      "1,0",
      "1,1",
    ]);
  });
});

describe("findPlacedEncounters", () => {
  const catalog = new Map<string, SimEncounterRef>([
    [
      "goblin_band",
      {
        id: "goblin_band",
        name: "Goblin Band",
        monster_party_tile: "monster/goblin.png",
        monsters: ["goblin", "goblin"],
      },
    ],
  ]);

  it("seeds one entity per cell whose encounter id resolves", () => {
    const grid: SpawnCellInfo[][] = [
      [{ walkable: true }, { walkable: true, encounter: "goblin_band" }],
      [{ walkable: true, encounter: "unknown" }, { walkable: true }],
    ];
    const out = findPlacedEncounters(grid, catalog);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      encounterId: "goblin_band",
      col: 1,
      row: 0,
      sourceKey: "1,0",
      sprite: "monster/goblin.png",
    });
    expect(out[0].id).toBe("placed-1-0");
  });

  it("skips cells listed in the excluded set", () => {
    const grid: SpawnCellInfo[][] = [
      [{ walkable: true, encounter: "goblin_band" }],
    ];
    const out = findPlacedEncounters(grid, catalog, new Set(["0,0"]));
    expect(out.length).toBe(0);
  });
});

describe("roamerCollidesWithParty", () => {
  it("is true on the party cell", () => {
    expect(
      roamerCollidesWithParty({ col: 5, row: 5 }, { col: 5, row: 5 }),
    ).toBe(true);
  });

  it("is true Chebyshev-adjacent (incl. diagonals)", () => {
    expect(
      roamerCollidesWithParty({ col: 4, row: 4 }, { col: 5, row: 5 }),
    ).toBe(true);
    expect(
      roamerCollidesWithParty({ col: 6, row: 5 }, { col: 5, row: 5 }),
    ).toBe(true);
  });

  it("is false two steps away", () => {
    expect(
      roamerCollidesWithParty({ col: 3, row: 5 }, { col: 5, row: 5 }),
    ).toBe(false);
  });
});

describe("findQuestPlacedEncounters", () => {
  const catalog: ReadonlyMap<string, SimEncounterRef> = new Map([
    ["cellar_rats", {
      id: "cellar_rats",
      name: "Cellar Rats",
      monsters: ["giant_rat"],
      monster_party_tile: "monster/giant_rat.png",
    }],
  ]);

  it("places `count` encounters onto distinct walkable cells", () => {
    const walkable: Array<[number, number]> = [
      [0, 0], [1, 0], [2, 0], [3, 0],
    ];
    const rng = mulberry32(42);
    const out = findQuestPlacedEncounters(
      [{ questId: "rats", stepIdx: 0, encounterId: "cellar_rats", count: 3 }],
      catalog,
      walkable,
      { rng },
    );
    expect(out).toHaveLength(3);
    // Three distinct cells consumed from the pool.
    const cells = new Set(out.map((p) => `${p.col},${p.row}`));
    expect(cells.size).toBe(3);
    // Walkable pool shrank.
    expect(walkable).toHaveLength(1);
  });

  it("populates the placed-encounter shape MapSimulation expects", () => {
    const walkable: Array<[number, number]> = [[5, 7]];
    const out = findQuestPlacedEncounters(
      [{ questId: "rats", stepIdx: 0, encounterId: "cellar_rats", count: 1 }],
      catalog,
      walkable,
      { rng: () => 0 },
    );
    expect(out).toEqual([
      {
        id: "q-rats-0-0",
        encounterId: "cellar_rats",
        col: 5,
        row: 7,
        sourceKey: "5,7",
        sprite: "monster/giant_rat.png",
        tint: QUEST_TARGET_TINT,
      },
    ]);
  });

  it("drops requests whose encounter id is unknown to the catalog", () => {
    const out = findQuestPlacedEncounters(
      [
        { questId: "missing", stepIdx: 0, encounterId: "no_such", count: 1 },
        { questId: "rats", stepIdx: 0, encounterId: "cellar_rats", count: 1 },
      ],
      catalog,
      [[0, 0]],
      { rng: () => 0 },
    );
    expect(out.map((p) => p.questId ?? p.id)).toEqual(["q-rats-0-0"]);
  });

  it("stops early when the walkable pool runs out", () => {
    const out = findQuestPlacedEncounters(
      [{ questId: "rats", stepIdx: 0, encounterId: "cellar_rats", count: 5 }],
      catalog,
      [[0, 0], [1, 0]],
      { rng: () => 0 },
    );
    expect(out).toHaveLength(2);
  });

  it("honours an encounter's own `tint` over the default quest-target tint", () => {
    const catalogWithTint: ReadonlyMap<string, SimEncounterRef> = new Map([
      ["red_rats", {
        id: "red_rats",
        name: "Red Rats",
        monsters: ["giant_rat"],
        tint: 0xff0000,
      }],
    ]);
    const out = findQuestPlacedEncounters(
      [{ questId: "rats", stepIdx: 0, encounterId: "red_rats", count: 1 }],
      catalogWithTint,
      [[0, 0]],
      { rng: () => 0 },
    );
    expect(out[0].tint).toBe(0xff0000);
  });

  it("honours authored positions in order when each cell is walkable", () => {
    const walkable: Array<[number, number]> = [
      [0, 0], [1, 0], [2, 0], [5, 12], [8, 12], [11, 12],
    ];
    const out = findQuestPlacedEncounters(
      [
        {
          questId: "rats",
          stepIdx: 0,
          encounterId: "cellar_rats",
          count: 3,
          positions: [
            { col: 5, row: 12 },
            { col: 8, row: 12 },
            { col: 11, row: 12 },
          ],
        },
      ],
      catalog,
      walkable,
      // The rng must not be called when every position is honoured —
      // throwing here proves we never fell through to the random pick.
      { rng: () => { throw new Error("rng should not run"); } },
    );
    expect(out.map((p) => [p.col, p.row])).toEqual([
      [5, 12], [8, 12], [11, 12],
    ]);
    // Authored cells consumed from the pool; the four random-only
    // cells remain.
    expect(walkable).toHaveLength(3);
    expect(walkable).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it("falls back to a random pick when an authored position isn't walkable", () => {
    const walkable: Array<[number, number]> = [[0, 0], [1, 0], [2, 0]];
    const out = findQuestPlacedEncounters(
      [
        {
          questId: "rats",
          stepIdx: 0,
          encounterId: "cellar_rats",
          count: 2,
          // First cell isn't in `walkable` → fall back to random.
          // Second cell is in `walkable` → honoured.
          positions: [
            { col: 99, row: 99 },
            { col: 1, row: 0 },
          ],
        },
      ],
      catalog,
      walkable,
      { rng: () => 0 }, // picks index 0 → [0,0]
    );
    expect(out.map((p) => [p.col, p.row])).toEqual([
      [0, 0], // fell back to random — rng index 0 of the pool
      [1, 0], // authored
    ]);
  });

  it("falls back to random for copies beyond positions.length", () => {
    const walkable: Array<[number, number]> = [[7, 7], [0, 0], [1, 0]];
    const out = findQuestPlacedEncounters(
      [
        {
          questId: "rats",
          stepIdx: 0,
          encounterId: "cellar_rats",
          count: 3,
          // Only one authored position; copies 2 and 3 use random.
          positions: [{ col: 7, row: 7 }],
        },
      ],
      catalog,
      walkable,
      { rng: () => 0 },
    );
    expect(out).toHaveLength(3);
    // First copy honoured the authored position.
    expect([out[0].col, out[0].row]).toEqual([7, 7]);
    // Remaining two copies are pulled from the random pool.
    expect(walkable).toHaveLength(0);
  });
});
