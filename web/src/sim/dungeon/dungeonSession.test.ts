import { afterEach, describe, expect, it, vi } from "vitest";
import type { DungeonLevel } from "@/v1battle/world/Dungeon";
import {
  clearAllDungeonSessions,
  clearDungeonSession,
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
