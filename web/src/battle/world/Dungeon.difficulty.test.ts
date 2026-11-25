import { describe, it, expect } from "vitest";
import { generateDungeonLevel, getDifficultyProfile } from "./Dungeon";
import type { EncounterTemplate } from "./Encounters";

describe("difficulty comes solely from the tier", () => {
  it("profile does not depend on floor depth", () => {
    expect(getDifficultyProfile("easy")).toMatchObject({ encMin: 1, encMax: 2 });
    expect(getDifficultyProfile("bogus")).toEqual(getDifficultyProfile("normal"));
  });

  it("a deep floor of an easy dungeon still spawns easy-band encounters", () => {
    const enc = (id: string, level: number): EncounterTemplate =>
      ({
        id, area: "dungeon", name: id, level, weight: 1,
        monsterPartyTile: "rat", monsters: ["rat"], tags: [],
      }) as EncounterTemplate;
    const encounters = { dungeon: [enc("low", 1), enc("high", 8)] };
    const base = {
      name: "F", width: 40, height: 30, style: "dungeon" as const,
      difficulty: "easy" as const, placeStairsDown: true,
      lockProbability: 0, torchProbability: 0, encounters,
    };
    let placed = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const deep = generateDungeonLevel({ ...base, floorIdx: 9, seed });
      for (const m of deep.monsters) expect(m.encounterName).toBe("low");
      placed += deep.monsters.length;
    }
    expect(placed).toBeGreaterThan(0);
  });
});

describe('"any" difficulty ignores monster difficulty', () => {
  const enc = (id: string, level: number, monster: string): EncounterTemplate =>
    ({
      id, area: "dungeon", name: id, level, weight: 1,
      monsterPartyTile: monster, monsters: [monster], tags: [],
    }) as EncounterTemplate;
  const encounters = {
    dungeon: [
      enc("rats", 1, "rat"), // easy, level 1
      enc("orcs", 3, "orc"), // normal, level 3
      enc("troll", 6, "troll"), // hard, level 6
      enc("dragon", 8, "dragon"), // deadly, level 8
    ],
  };
  const tierOf: Record<string, string> = { rat: "easy", orc: "normal", troll: "hard", dragon: "deadly" };
  const base = {
    name: "F", width: 40, height: 30, style: "dungeon" as const,
    placeStairsDown: true, lockProbability: 0, torchProbability: 0,
    encounters, monsterDifficulty: (id: string) => tierOf[id],
  };
  const placedNames = (difficulty: "any" | "normal") => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const lvl = generateDungeonLevel({ ...base, difficulty, floorIdx: 0, seed });
      for (const m of lvl.monsters) seen.add(m.encounterName ?? "");
    }
    return seen;
  };

  it("places encounters of every level and monster tier", () => {
    expect([...placedNames("any")].sort()).toEqual(["dragon", "orcs", "rats", "troll"]);
  });

  it("a tiered floor still only places its own tier", () => {
    expect([...placedNames("normal")]).toEqual(["orcs"]);
  });

  it("lays out like normal", () => {
    const { encMin, encMax, ...layout } = getDifficultyProfile("any");
    const { encMin: _a, encMax: _b, ...normal } = getDifficultyProfile("normal");
    expect(layout).toEqual(normal);
    expect([encMin, encMax]).toEqual([1, 8]);
  });
});
