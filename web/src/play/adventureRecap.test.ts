import { describe, it, expect } from "vitest";
import { computeAdventureRecap } from "./adventureRecap";
import type { WorldSave } from "./saveTypes";

function save(): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "",
    moduleId: "default",
    clockMinutes: 3 * 24 * 60 + 600,
    startClockMinutes: 600,
    party: {
      currentMapId: "town",
      col: 0,
      row: 0,
      avatar: "",
      gold: 412,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      roster: ["b", "a"],
      members: [
        { id: "a", custom: null, hp: 10, mp: 0, level: 3, exp: 900, inventory: [], effects: [] },
        { id: "b", custom: null, hp: 0, mp: 0, level: 2, exp: 400, inventory: [], effects: [] },
      ],
      clearedDungeons: ["g@m:1,1", "g@m:1,1", "c@m:2,2"],
      discoveredMaps: ["town", "forest"],
      metNpcs: ["smith"],
    },
    maps: {
      town: { unlockedCells: [], defeatedEncounters: ["1,1", "2,2"], destroyedLairs: ["5,5"] },
    },
    dungeons: {
      x: {
        dungeonId: "g",
        seed: 1,
        levels: [],
        floors: [
          { floorIdx: 0, state: { unlockedCells: [], defeatedEncounters: ["3,3"], destroyedLairs: [] } },
          { floorIdx: 1, state: { unlockedCells: [], defeatedEncounters: ["4,4", "6,6"], destroyedLairs: [] } },
        ],
      },
    },
    turnedInQuests: ["q1", "q2", "main"],
  } as unknown as WorldSave;
}

describe("computeAdventureRecap", () => {
  it("derives every stat from the save", () => {
    const r = computeAdventureRecap(save(), "The Crystal Skull", [
      { id: "a", name: "Ayla" },
      { id: "b", name: "Bram" },
    ]);
    expect(r.questName).toBe("The Crystal Skull");
    expect(r.questsCompleted).toBe(3);
    expect(r.encountersWon).toBe(6); // 2 + 1 lair + 1 + 2
    expect(r.dungeonsCleared).toBe(2); // de-duplicated
    expect(r.placesDiscovered).toBe(2);
    expect(r.peopleMet).toBe(1);
    expect(r.totalXp).toBe(1300);
    expect(r.gold).toBe(412);
    expect(r.days).toBe(4);
    // Roster order, names resolved, downed flagged.
    expect(r.members.map((m) => m.name)).toEqual(["Bram", "Ayla"]);
    expect(r.members[0]).toMatchObject({ level: 2, alive: false });
  });

  it("tolerates a sparse legacy save", () => {
    const s = save();
    const sparse = {
      ...s,
      maps: {},
      dungeons: {},
      turnedInQuests: undefined,
      startClockMinutes: undefined,
      party: { ...s.party, clearedDungeons: undefined, discoveredMaps: undefined, metNpcs: undefined },
    } as unknown as WorldSave;
    const r = computeAdventureRecap(sparse, "Q", []);
    expect(r).toMatchObject({ questsCompleted: 0, encountersWon: 0, dungeonsCleared: 0, days: 1 });
    expect(r.members[0].name).toBe("b");
  });
});
