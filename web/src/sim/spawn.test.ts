import { describe, it, expect } from "vitest";
import {
  trySpawnRoamer,
  roamStep,
  findLairs,
  findPlacedEncounters,
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
