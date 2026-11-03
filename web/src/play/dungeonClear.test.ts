import { describe, expect, it } from "vitest";

import { dungeonClearProgress, dungeonClearXp, isDungeonCleared } from "./dungeonClear";

const mon = (col: number, row: number, roster = ["goblin"]) => ({
  col,
  row,
  encounterNames: roster,
});

describe("dungeon clear", () => {
  const levels = [
    { monsters: [mon(1, 1), mon(4, 2)] },
    { monsters: [mon(3, 3), mon(9, 9, [])] }, // rosterless = scenery, ignored
  ];

  it("counts every rostered monster on every floor", () => {
    const p = dungeonClearProgress(levels, () => undefined);
    expect(p).toEqual({ total: 3, defeated: 0 });
    expect(isDungeonCleared(p)).toBe(false);
  });

  it("is cleared only when every floor's monsters are defeated", () => {
    const floors = new Map<number, Set<string>>([[0, new Set(["1,1", "4,2"])]]);
    const partial = dungeonClearProgress(levels, (i) => floors.get(i));
    expect(partial).toEqual({ total: 3, defeated: 2 });
    expect(isDungeonCleared(partial)).toBe(false); // floor 2 still has one

    floors.set(1, new Set(["3,3"]));
    expect(isDungeonCleared(dungeonClearProgress(levels, (i) => floors.get(i)))).toBe(true);
  });

  it("an empty dungeon never clears", () => {
    expect(isDungeonCleared(dungeonClearProgress([{ monsters: [] }], () => new Set()))).toBe(false);
  });

  it("uses the dungeon's clear_xp when set, else the module amount", () => {
    expect(dungeonClearXp(undefined, 250)).toBe(250);
    expect(dungeonClearXp(400, 250)).toBe(400);
    expect(dungeonClearXp(0, 250)).toBe(0);
    expect(dungeonClearXp(-5, 250)).toBe(250);
  });
});
