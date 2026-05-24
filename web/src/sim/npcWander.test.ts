import { describe, it, expect } from "vitest";
import { mulberry32 } from "../battle/rng";
import {
  NPC_WANDER_CHANCE,
  findNpcCells,
  isWanderDestination,
  runNpcWander,
} from "./npcWander";
import type { SimCell, SimGrid } from "./types";

/** Plain walkable floor — the default cell most fixtures start from. */
function floor(over: Partial<SimCell> = {}): SimCell {
  return {
    id: "grass",
    sprite: "map/grass.png",
    walkable: true,
    obstructs: false,
    light_source: false,
    light_range: 0,
    ...over,
  };
}

/** Build a square grid of plain walkable floor. Tests overlay tags
 *  on specific cells after construction. */
function gridOf(size: number): SimCell[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => floor()),
  );
}

const NO_ONE = () => false;

describe("NPC_WANDER_CHANCE", () => {
  it("is 50% per the product spec", () => {
    expect(NPC_WANDER_CHANCE).toBe(0.5);
  });
});

describe("findNpcCells", () => {
  it("returns coords for every cell with npc or quest set", () => {
    const g = gridOf(3) as SimGrid;
    (g[0][1] as SimCell).npc = "guard";
    (g[2][2] as SimCell).quest = "help";
    (g[1][1] as SimCell).npc = "blacksmith";
    expect(findNpcCells(g)).toEqual([
      { col: 1, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 2 },
    ]);
  });

  it("returns an empty list when nothing's tagged", () => {
    expect(findNpcCells(gridOf(3) as SimGrid)).toEqual([]);
  });
});

describe("isWanderDestination", () => {
  it("accepts plain walkable floor", () => {
    expect(isWanderDestination(floor())).toBe(true);
  });

  it("rejects non-walkable floor", () => {
    expect(isWanderDestination(floor({ walkable: false }))).toBe(false);
  });

  it("rejects water-tagged tiles", () => {
    expect(isWanderDestination(floor({ tag: "water" }))).toBe(false);
  });

  it("rejects null / undefined cells (off-grid bounds)", () => {
    expect(isWanderDestination(null)).toBe(false);
    expect(isWanderDestination(undefined)).toBe(false);
  });

  it("rejects cells already holding gameplay tags", () => {
    expect(isWanderDestination(floor({ npc: "other" }))).toBe(false);
    expect(isWanderDestination(floor({ quest: "other" }))).toBe(false);
    expect(isWanderDestination(floor({ counter: "shop" }))).toBe(false);
    expect(isWanderDestination(floor({ encounter: "wolves" }))).toBe(false);
    expect(isWanderDestination(floor({ spawn: "lair" }))).toBe(false);
    expect(isWanderDestination(floor({ dungeon: "cave" }))).toBe(false);
    expect(
      isWanderDestination(
        floor({ link: { map_id: "m2", x: 0, y: 0 } }),
      ),
    ).toBe(false);
    expect(isWanderDestination(floor({ boat: true }))).toBe(false);
    expect(isWanderDestination(floor({ locked: true }))).toBe(false);
    expect(isWanderDestination(floor({ trap: true }))).toBe(false);
    expect(
      isWanderDestination(floor({ ...{ item: "key" } } as Partial<SimCell>)),
    ).toBe(false);
  });
});

describe("runNpcWander", () => {
  it("never moves an NPC when every roll is above 0.5 (50% threshold)", () => {
    const g = gridOf(5);
    g[2][2].npc = "guard";
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.99);
    expect(moves).toEqual([]);
    // Grid is unchanged — guard still at its origin.
    expect(g[2][2].npc).toBe("guard");
  });

  it("moves an NPC when the roll passes the 50% gate", () => {
    const g = gridOf(5);
    g[2][2].npc = "guard";
    // First roll: 0.0 → passes the < 0.5 gate.
    // Second roll: 0.0 → picks index 0 of the eligible neighbours.
    // CARDINALS order is up, down, left, right, so neighbour 0 is
    // (col=2, row=1).
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toHaveLength(1);
    expect(moves[0].from).toEqual({ col: 2, row: 2 });
    expect(moves[0].to).toEqual({ col: 2, row: 1 });
    expect(moves[0].npcId).toBe("guard");
    // Grid mutated — tag follows.
    expect(g[2][2].npc).toBe("");
    expect(g[1][2].npc).toBe("guard");
  });

  it("moves a quest giver and carries the questId through the diff", () => {
    const g = gridOf(5);
    (g[2][2] as SimCell).quest = "help_wolves";
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toHaveLength(1);
    expect(moves[0].questId).toBe("help_wolves");
    expect((g[2][2] as SimCell).quest).toBe("");
    expect((g[1][2] as SimCell).quest).toBe("help_wolves");
  });

  it("carries both npc and quest tags together when a cell holds both", () => {
    // A single person who hands out a quest — same entity, two tags
    // on the cell. Wander moves both atomically.
    const g = gridOf(5);
    g[2][2].npc = "jerald";
    (g[2][2] as SimCell).quest = "rescue";
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toHaveLength(1);
    expect(moves[0].npcId).toBe("jerald");
    expect(moves[0].questId).toBe("rescue");
    expect(g[2][2].npc).toBe("");
    expect((g[2][2] as SimCell).quest).toBe("");
    expect(g[1][2].npc).toBe("jerald");
    expect((g[1][2] as SimCell).quest).toBe("rescue");
  });

  it("won't step onto non-walkable tiles (walls)", () => {
    // Surround the guard with walls except for one walkable cell
    // to the right; force the move roll to succeed. The picker
    // should land on the only eligible neighbour regardless of
    // which direction the RNG would otherwise prefer.
    const g = gridOf(5);
    g[2][2].npc = "guard";
    g[1][2].walkable = false; // up
    g[3][2].walkable = false; // down
    g[2][1].walkable = false; // left
    // (2,3) right stays walkable
    // mulberry32(7) gives < 0.5 on first call (passes gate) then
    // any direction-index — but with only one eligible neighbour
    // the pick is deterministic regardless.
    const moves = runNpcWander(g as SimGrid, NO_ONE, mulberry32(7));
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ col: 3, row: 2 });
  });

  it("stays put when surrounded by ineligible cells (and consumes no second roll)", () => {
    // Every neighbour blocked — wander roll passes but no candidate.
    const g = gridOf(5);
    g[2][2].npc = "guard";
    g[1][2].walkable = false;
    g[3][2].walkable = false;
    g[2][1].walkable = false;
    g[2][3].walkable = false;
    // RNG returns 0 forever — gate passes, no eligible target.
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toEqual([]);
    expect(g[2][2].npc).toBe("guard");
  });

  it("respects the isOccupied callback (party / roamers / placed encounters)", () => {
    // Only the up-neighbour is "occupied" by the party. The next
    // eligible neighbour in cardinal order (down) should win.
    const g = gridOf(5);
    g[2][2].npc = "guard";
    const moves = runNpcWander(
      g as SimGrid,
      (c, r) => c === 2 && r === 1,
      () => 0.0,
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ col: 2, row: 3 });
  });

  it("won't step onto a cell that already holds another NPC", () => {
    // Pin the guard so its ONLY non-wall neighbour is the cell
    // the blacksmith is standing on. Wander roll passes (0.0) but
    // the blacksmith's tag disqualifies the destination, so the
    // guard stays put. We freeze the blacksmith with walls of its
    // own so the test isolates the "neighbour holds an NPC" rule
    // without the blacksmith wandering off and uncovering the cell.
    const g = gridOf(5);
    g[2][2].npc = "guard";
    g[2][3].npc = "blacksmith"; // right of guard
    g[1][2].walkable = false; // guard up
    g[3][2].walkable = false; // guard down
    g[2][1].walkable = false; // guard left
    g[1][3].walkable = false; // blacksmith up
    g[3][3].walkable = false; // blacksmith down
    g[2][4].walkable = false; // blacksmith right
    // RNG=0.0 → both wander rolls pass; both NPCs look for a
    // neighbour. Guard's only candidate is blacksmith's cell
    // (rejected). Blacksmith's only candidate is guard's cell
    // (rejected). Neither moves.
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toEqual([]);
    expect(g[2][2].npc).toBe("guard");
    expect(g[2][3].npc).toBe("blacksmith");
  });

  it("snapshots candidates at the start so an early mover can't be re-considered", () => {
    // Single NPC, RNG returns 0 forever. Without the snapshot the
    // pass would keep finding the NPC at its new location and
    // moving it again. The snapshot pins the candidate list to
    // pre-pass coords so each NPC is considered at most once per
    // step.
    const g = gridOf(5);
    g[2][2].npc = "guard";
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    expect(moves).toHaveLength(1);
  });

  it("makes prior moves visible to later candidates in the same pass", () => {
    // Two NPCs on row 2. First (col 2) moves up to (col 2, row 1).
    // Second (col 3) considers up to (col 3, row 1) — which is
    // unrelated to the first move — and moves up too. The mutation
    // visibility test is about NOT moving onto col 2 row 1.
    // Construct a pinch where the second NPC's only legal neighbour
    // overlaps with the first's destination.
    const g = gridOf(5);
    g[2][2].npc = "first";
    g[2][3].npc = "second";
    // Block every neighbour of "second" except up (col 3, row 1)
    // and left (col 2, row 2). Left is "first"'s home, which will
    // be vacated by the time second is considered.
    g[2][4].walkable = false; // right of second
    g[3][3].walkable = false; // down of second
    // With RNG=0.0 always: first moves up to (2,1). Then second
    // is considered; eligible neighbours are up (3,1) and left
    // (2,2) — the now-vacated cell. CARDINALS order picks up
    // first.
    const moves = runNpcWander(g as SimGrid, NO_ONE, () => 0.0);
    // Both move; first up, second up.
    expect(moves).toHaveLength(2);
    expect(moves[0].from).toEqual({ col: 2, row: 2 });
    expect(moves[0].to).toEqual({ col: 2, row: 1 });
    expect(moves[1].from).toEqual({ col: 3, row: 2 });
    expect(moves[1].to).toEqual({ col: 3, row: 1 });
  });

  it("over many trials with a uniform RNG, ~50% of NPCs move", () => {
    // Statistical sanity check: with a well-distributed RNG, the
    // observed move rate converges on 50%. Loose bounds keep the
    // test deterministic-ish without hand-tuning the seed.
    const trials = 1000;
    let moved = 0;
    const rng = mulberry32(1234);
    for (let i = 0; i < trials; i++) {
      const g = gridOf(5);
      g[2][2].npc = "guard";
      const m = runNpcWander(g as SimGrid, NO_ONE, rng);
      if (m.length > 0) moved += 1;
    }
    // Expect ~500 ± a generous margin so the test never flakes.
    expect(moved).toBeGreaterThan(400);
    expect(moved).toBeLessThan(600);
  });
});
