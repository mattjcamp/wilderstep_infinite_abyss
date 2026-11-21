import { describe, it, expect } from "vitest";
import { generateDungeonFromRecord } from "./generateFromRecord";
import { dungeonLevelToMap, EXIT_TO_OVERWORLD_MAP_ID, floorMapId } from "./dungeonLevelToMap";
import { stairsPlacardText } from "@/play/stairsPlacard";
import type { DungeonRecord } from "./types";

function record(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "exit_test",
    name: "Exit Test",
    style: "dungeon",
    difficulty: "normal",
    size: { width: 36, height: 28 },
    torch_density: 0.1,
    locked_doors: 0,
    levels: [
      { id: "f0", name: "Area 1", depth: 1 },
      { id: "f1", name: "Area 2", depth: 2 },
    ],
    ...over,
  };
}

const palette = new Map<string, string>([
  ["dungeon_stairs_up", "dungeon/doors_and_stairs/stairs_up.png"],
  ["dungeon_ladder_up", "dungeon/doors_and_stairs/ladder_up.png"],
  ["cave_stairs_up", "cave/doors_and_stairs/stairs_up.png"],
  ["cave_ladder_up", "cave/doors_and_stairs/ladder_up.png"],
]);

describe("bottom-floor exit → map cells", () => {
  it("links the way out to the overworld; the entrance stairs still go up one floor", () => {
    const floors = generateDungeonFromRecord(record({ bottom_exit: "stairs" }), { seed: 3 });
    const bottom = floors[1];
    const map = dungeonLevelToMap(bottom, { dungeonId: "exit_test", floorIdx: 1, totalFloors: 2, paletteSprites: palette });
    const [ec, er] = [...bottom.overworldExits][0].split(",").map(Number);
    const exit = map.grid[er][ec];
    expect(exit.link?.map_id).toBe(EXIT_TO_OVERWORLD_MAP_ID);
    expect(exit.stairs).toBe("up");
    expect(exit.show_link_placard).toBe(true);
    expect(exit.sprite).toContain("stairs_up");
    const entry = map.grid[bottom.entryRow][bottom.entryCol];
    expect(entry.link?.map_id).toBe(floorMapId("exit_test", 0));
  });

  it("draws the way out as a ladder in either style when asked", () => {
    for (const style of ["dungeon", "cavern"] as const) {
      const floors = generateDungeonFromRecord(record({ style, bottom_exit: "ladder" }), { seed: 11 });
      const bottom = floors[1];
      const map = dungeonLevelToMap(bottom, { dungeonId: "exit_test", floorIdx: 1, totalFloors: 2, paletteSprites: palette });
      const [ec, er] = [...bottom.overworldExits][0].split(",").map(Number);
      const exit = map.grid[er][ec];
      expect(exit.sprite).toBe(style === "cavern" ? "cave/doors_and_stairs/ladder_up.png" : "dungeon/doors_and_stairs/ladder_up.png");
      expect(exit.link?.map_id).toBe(EXIT_TO_OVERWORLD_MAP_ID);
    }
  });
});

describe("stairs placard — way out", () => {
  it("tells the player the bottom-floor exit leaves the area", () => {
    const t = stairsPlacardText({
      stairs: "up",
      linkMapId: EXIT_TO_OVERWORLD_MAP_ID,
      dungeonName: "Hidden Grotto",
      totalFloors: 4,
      fromFloorIdx: 3,
      exitAppearance: "ladder",
    });
    expect(t.leavesArea).toBe(true);
    expect(t.name).toMatch(/Way Out/);
    expect(t.description).toMatch(/out of Hidden Grotto/);
    expect(t.description).toMatch(/leaves the area/);
  });

  it("keeps the plain wording for the entrance stairs on floor 1", () => {
    const t = stairsPlacardText({
      stairs: "up",
      linkMapId: EXIT_TO_OVERWORLD_MAP_ID,
      dungeonName: "Hidden Grotto",
      totalFloors: 4,
      fromFloorIdx: 0,
    });
    expect(t.leavesArea).toBeUndefined();
    expect(t.description).toBe("These stairs lead up and out of Hidden Grotto.");
  });
});
