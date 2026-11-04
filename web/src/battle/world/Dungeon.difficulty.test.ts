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
