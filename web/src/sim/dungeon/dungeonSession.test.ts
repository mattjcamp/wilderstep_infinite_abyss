import { afterEach, describe, expect, it, vi } from "vitest";
import type { DungeonLevel } from "@/battle/world/Dungeon";
import {
  clearAllDungeonSessions,
  clearDungeonSession,
  dungeonInstanceKey,
  getFloorMutations,
  getOrCreateDungeonSession,
  peekDungeonSession,
  writeFloorMutations,
} from "./dungeonSession";

/** Build a stand-in DungeonLevel quickly — only fields the session
 *  store carries through matter; mutation tests don't touch grid
 *  contents. */
function fakeLevel(name: string): DungeonLevel {
  return {
    name,
    width: 4,
    height: 4,
    tiles: [],
    decorations: {},
    tileProperties: {},
    entryCol: 0,
    entryRow: 0,
    style: "ruins",
    monsters: [],
    openedChests: new Set<string>(),
    triggeredTraps: new Set<string>(),
    detectedTraps: new Set<string>(),
    exploredTiles: new Set<string>(),
    overworldExits: new Set<string>(),
    questArtifacts: {},
    chestItem: "",
  };
}

// Module-scoped store leaks between tests by design (sessions persist
// across React unmounts). Reset before every case.
afterEach(() => {
  clearAllDungeonSessions();
});

describe("getOrCreateDungeonSession", () => {
  it("runs the generator on first call for a given id+seed", () => {
    const gen = vi.fn(() => [fakeLevel("F1")]);
    const session = getOrCreateDungeonSession("the_hole", 42, gen);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(session.dungeonId).toBe("the_hole");
    expect(session.seed).toBe(42);
    expect(session.levels[0].name).toBe("F1");
  });

  it("reuses the existing session on subsequent calls", () => {
    const gen = vi.fn(() => [fakeLevel("F1")]);
    const a = getOrCreateDungeonSession("the_hole", 42, gen);
    const b = getOrCreateDungeonSession("the_hole", 42, gen);
    // Same object reference + only one generator invocation.
    expect(b).toBe(a);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("rerolls when the seed changes for the same id", () => {
    const gen1 = vi.fn(() => [fakeLevel("F1@42")]);
    const gen2 = vi.fn(() => [fakeLevel("F1@99")]);
    const first = getOrCreateDungeonSession("the_hole", 42, gen1);
    const second = getOrCreateDungeonSession("the_hole", 99, gen2);
    expect(second).not.toBe(first);
    expect(second.seed).toBe(99);
    expect(second.levels[0].name).toBe("F1@99");
  });
});

describe("dungeonInstanceKey", () => {
  it("folds the entrance map + cell into the dungeon id", () => {
    expect(
      dungeonInstanceKey({
        dungeonId: "grotto",
        mapId: "overworld",
        col: 3,
        row: 7,
      }),
    ).toBe("grotto@overworld:3,7");
  });

  it("is distinct for two entrances of the same record", () => {
    const a = dungeonInstanceKey({
      dungeonId: "grotto",
      mapId: "overworld",
      col: 3,
      row: 7,
    });
    const b = dungeonInstanceKey({
      dungeonId: "grotto",
      mapId: "overworld",
      col: 20,
      row: 2,
    });
    expect(a).not.toBe(b);
  });
});

describe("per-entrance instancing", () => {
  it("generates two independent runs for one record at two entrances", () => {
    // The same dungeon record ("grotto") placed at two map mouths
    // resolves to two distinct instance keys → two sessions, each
    // rolled once, with its own mutation state.
    const keyA = dungeonInstanceKey({
      dungeonId: "grotto",
      mapId: "overworld",
      col: 3,
      row: 7,
    });
    const keyB = dungeonInstanceKey({
      dungeonId: "grotto",
      mapId: "overworld",
      col: 20,
      row: 2,
    });
    const genA = vi.fn(() => [fakeLevel("grottoA")]);
    const genB = vi.fn(() => [fakeLevel("grottoB")]);
    const a = getOrCreateDungeonSession(keyA, 11, genA, "grotto");
    const b = getOrCreateDungeonSession(keyB, 22, genB, "grotto");

    // Distinct sessions, distinct layouts, but both carry the shared
    // record id for catalog lookups.
    expect(a).not.toBe(b);
    expect(a.dungeonId).toBe("grotto");
    expect(b.dungeonId).toBe("grotto");
    expect(a.instanceId).toBe(keyA);
    expect(b.instanceId).toBe(keyB);
    expect(a.levels[0].name).toBe("grottoA");
    expect(b.levels[0].name).toBe("grottoB");

    // Mutating one instance's floor state doesn't bleed into the
    // other — independent exploration / cleared rooms.
    getFloorMutations(a, 0).defeatedEncounters.add("5,5");
    expect(getFloorMutations(b, 0).defeatedEncounters.has("5,5")).toBe(
      false,
    );

    // Re-entering via the SAME mouth resumes the same instance.
    expect(getOrCreateDungeonSession(keyA, 11, genA, "grotto")).toBe(a);
    expect(genA).toHaveBeenCalledTimes(1);
  });
});

describe("getFloorMutations", () => {
  it("returns an empty Set bundle on first call", () => {
    const session = getOrCreateDungeonSession("d", 1, () => [
      fakeLevel("F1"),
    ]);
    const muts = getFloorMutations(session, 0);
    expect(muts.unlockedCells.size).toBe(0);
    expect(muts.defeatedEncounters.size).toBe(0);
    expect(muts.destroyedLairs.size).toBe(0);
  });

  it("returns the same reference on subsequent calls", () => {
    const session = getOrCreateDungeonSession("d", 1, () => [
      fakeLevel("F1"),
    ]);
    const a = getFloorMutations(session, 0);
    a.defeatedEncounters.add("3,4");
    const b = getFloorMutations(session, 0);
    expect(b).toBe(a);
    expect(b.defeatedEncounters.has("3,4")).toBe(true);
  });

  it("keeps floors independent", () => {
    const session = getOrCreateDungeonSession("d", 1, () => [
      fakeLevel("F1"),
      fakeLevel("F2"),
    ]);
    getFloorMutations(session, 0).defeatedEncounters.add("a");
    getFloorMutations(session, 1).defeatedEncounters.add("b");
    expect(getFloorMutations(session, 0).defeatedEncounters.has("a")).toBe(
      true,
    );
    expect(getFloorMutations(session, 0).defeatedEncounters.has("b")).toBe(
      false,
    );
  });
});

describe("writeFloorMutations", () => {
  it("replaces the floor's stored state", () => {
    const session = getOrCreateDungeonSession("d", 1, () => [
      fakeLevel("F1"),
    ]);
    writeFloorMutations(session, 0, {
      unlockedCells: new Set(["1,1"]),
      defeatedEncounters: new Set(["2,2"]),
      destroyedLairs: new Set(["3,3"]),
    });
    const muts = getFloorMutations(session, 0);
    expect([...muts.unlockedCells]).toEqual(["1,1"]);
    expect([...muts.defeatedEncounters]).toEqual(["2,2"]);
    expect([...muts.destroyedLairs]).toEqual(["3,3"]);
  });
});

describe("clearDungeonSession", () => {
  it("forces a regeneration on the next call", () => {
    const gen1 = vi.fn(() => [fakeLevel("v1")]);
    const gen2 = vi.fn(() => [fakeLevel("v2")]);
    getOrCreateDungeonSession("d", 1, gen1);
    clearDungeonSession("d");
    const next = getOrCreateDungeonSession("d", 1, gen2);
    expect(gen2).toHaveBeenCalledTimes(1);
    expect(next.levels[0].name).toBe("v2");
  });
});

describe("peekDungeonSession", () => {
  it("returns undefined when no session exists", () => {
    expect(peekDungeonSession("nothing")).toBeUndefined();
  });

  it("returns the live session after creation", () => {
    const session = getOrCreateDungeonSession("d", 1, () => [
      fakeLevel("F1"),
    ]);
    expect(peekDungeonSession("d")).toBe(session);
  });
});

describe("instance-keyed mutations survive a floor re-mount (regression)", () => {
  // Regression for "defeated dungeon monsters reappear after leaving
  // and returning." Floor mutations are WRITTEN under the per-placement
  // instance id, but the floor re-mount path read them back keyed by
  // the bare dungeon RECORD id. Since the instance id folds in the
  // entrance cell, the two never match in normal play, so the re-mount
  // got a fresh empty session and lost the defeated-encounter set.
  // This pins the invariant: the same instance id that wrote the
  // mutation reads it back, and the bare record id does NOT.
  it("re-fetches the same session + mutations via the instance id", () => {
    const dungeonId = "grotto";
    const instanceId = dungeonInstanceKey({
      dungeonId,
      mapId: "shop_cavern",
      col: 5,
      row: 8,
    });
    const seed = 42;

    // First mount: create the session under the instance id, record a
    // defeated encounter on floor 0.
    const created = getOrCreateDungeonSession(
      instanceId,
      seed,
      () => [fakeLevel("F1"), fakeLevel("F2")],
      dungeonId,
    );
    writeFloorMutations(created, 0, {
      unlockedCells: new Set<string>(),
      defeatedEncounters: new Set(["12,7"]),
      destroyedLairs: new Set<string>(),
    });

    // Re-mount via the INSTANCE id (the host's fixed path): same
    // session object, defeated set intact.
    const reMount = getOrCreateDungeonSession(
      instanceId,
      seed,
      () => {
        throw new Error("should not regenerate — session must be reused");
      },
      dungeonId,
    );
    expect(reMount).toBe(created);
    expect(
      [...getFloorMutations(reMount, 0).defeatedEncounters],
    ).toEqual(["12,7"]);

    // The bare record id is a DIFFERENT key — the old (buggy) lookup.
    // It must create a separate, empty session, proving the two ids
    // are not interchangeable.
    const wrong = getOrCreateDungeonSession(dungeonId, seed, () => [
      fakeLevel("X"),
    ]);
    expect(wrong).not.toBe(created);
    expect(getFloorMutations(wrong, 0).defeatedEncounters.size).toBe(0);
  });
});
