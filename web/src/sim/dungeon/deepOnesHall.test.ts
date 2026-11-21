/**
 * The "deep_ones_hall" dungeon style: generated floors are painted
 * entirely from the Deep Ones Hall tileset in the Default palette.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeDungeonStyle, DUNGEON_STYLES } from "@/battle/world/Dungeon";
import { generateDungeonFromRecord } from "./generateFromRecord";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";
import type { DungeonRecord } from "./types";

const tiles = JSON.parse(
  readFileSync("public/modules/default/map_tiles.json", "utf8"),
).map_tiles as Array<{ id: string; sprite: string }>;
const palette = new Map(tiles.map((t) => [t.id, t.sprite]));
const knownSprites = new Set(tiles.map((t) => t.sprite));

function hall(seed: number, over: Partial<DungeonRecord> = {}) {
  const record: DungeonRecord = {
    id: "hall",
    name: "Drowned Hall",
    style: "deep_ones_hall",
    difficulty: seed % 2 ? "boss" : "normal",
    size: { width: 40, height: 30 },
    torch_density: 0.2,
    locked_doors: 0.3,
    pits: 0.6,
    bottom_exit: "ladder",
    loot: { chest_item: "treasure_chest", chest_frequency: 0.5 },
    levels: [
      { id: "a", name: "Antechamber", depth: 1 },
      { id: "b", name: "Sanctum", depth: 2 },
    ],
    ...over,
  };
  return generateDungeonFromRecord(record, { seed }).map((f, i) =>
    dungeonLevelToMap(f, { dungeonId: "hall", floorIdx: i, totalFloors: 2, paletteSprites: palette }),
  );
}

describe("Deep Ones Hall dungeon style", () => {
  it("is a supported style", () => {
    expect(DUNGEON_STYLES).toContain("deep_ones_hall");
    expect(normalizeDungeonStyle("deep_ones_hall")).toBe("deep_ones_hall");
  });

  it("every palette id the style borrows exists in the Default palette", () => {
    const hallIds = DUNGEON_PALETTE_IDS.filter((id) => id.startsWith("deep_ones_hall"));
    expect(hallIds.length).toBeGreaterThan(20);
    for (const id of hallIds) expect(palette.has(id), id).toBe(true);
  });

  it("paints every cell with real art, all from the Hall's own tiles", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const edge of [false, true]) {
        for (const map of hall(seed, { edge_transitions: edge })) {
          for (const row of map.grid) {
            for (const cell of row) {
              expect(cell.sprite, `${cell.id} seed=${seed}`).not.toBe("");
              expect(knownSprites.has(cell.sprite), cell.sprite).toBe(true);
              // Tileset art only (chests and torches are shared).
              if (cell.id !== "chest" && cell.id !== "wall_torch") {
                expect(cell.sprite, `${cell.id}`).toMatch(/^dungeons\/deep_ones_hall\//);
              }
              seen.add(cell.sprite.replace("dungeons/deep_ones_hall/", ""));
            }
          }
        }
      }
    }
    // The dressing actually shows up: faces, strips, carved panels /
    // windows, sigil floors, pits, stairs, the boss throne, the exit.
    for (const piece of [
      "walls/wall.png",
      "walls/wall_left.png",
      "walls/wall_right.png",
      "walls/wall_top.png",
      "floors/floor_plain.png",
      "floors/floor.png",
      "water_and_pits/pit_centre.png",
      "doors_and_stairs/stairs_up.png",
      "doors_and_stairs/stairs.png",
      "doors_and_stairs/ladder_up.png",
      "features/throne.png",
    ]) {
      expect(seen.has(piece), piece).toBe(true);
    }
  });
});
