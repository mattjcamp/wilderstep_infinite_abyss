/**
 * The tileset styles added on top of Dungeon / Cave — "deep_ones_hall"
 * and "manor": generated floors are painted entirely from their own
 * tileset in the Default palette, with the dressing actually showing.
 */
import { PROP_INFO } from "./roomProps";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeDungeonStyle, DUNGEON_STYLES, type DungeonStyle } from "@/battle/world/Dungeon";
import { generateDungeonFromRecord } from "./generateFromRecord";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";
import type { DungeonRecord } from "./types";

const tiles = JSON.parse(
  readFileSync("public/modules/default/map_tiles.json", "utf8"),
).map_tiles as Array<{ id: string; sprite: string }>;
const PROP_IDS = new Set(Object.values(PROP_INFO).map((p) => p.paletteId));
const palette = new Map(tiles.map((t) => [t.id, t.sprite]));
const knownSprites = new Set(tiles.map((t) => t.sprite));

function generate(style: DungeonStyle, seed: number, over: Partial<DungeonRecord> = {}) {
  const record: DungeonRecord = {
    id: "styled",
    name: "Styled",
    style,
    difficulty: seed % 2 ? "boss" : "normal",
    size: { width: 40, height: 30 },
    torch_density: 0.2,
    locked_doors: 0.3,
    pits: 0.6,
    bottom_exit: "opening",
    loot: { chest_item: "treasure_chest", chest_frequency: 0.5 },
    levels: [
      { id: "a", name: "A", depth: 1 },
      { id: "b", name: "B", depth: 2 },
    ],
    ...over,
  };
  return generateDungeonFromRecord(record, { seed }).map((f, i) =>
    dungeonLevelToMap(f, { dungeonId: "styled", floorIdx: i, totalFloors: 2, paletteSprites: palette }),
  );
}

const CASES: Array<{ style: DungeonStyle; prefix: string; folder: string; mustSee: string[] }> = [
  {
    style: "deep_ones_hall",
    prefix: "deep_ones_hall",
    folder: "dungeons/deep_ones_hall/",
    mustSee: [
      "walls/wall.png", "walls/wall_left.png", "walls/wall_right.png", "walls/wall_top.png",
      "floors/floor_plain.png", "floors/floor.png", "water_and_pits/pit_centre.png",
      "doors_and_stairs/stairs_up.png", "doors_and_stairs/stairs.png", "walls/wall_exit.png",
      "features/throne.png",
    ],
  },
  {
    style: "manor",
    prefix: "manor",
    folder: "dungeons/manor/",
    mustSee: [
      "walls/wall_top.png", "walls/wall_left.png", "walls/wall_right.png", "walls/wall_tapestry.png",
      "floors/floor_planks.png", "floors/floor_parquet.png", "water_and_pits/pit_centre.png",
      "doors_and_stairs/stairs_up.png", "doors_and_stairs/stairs.png", "walls/wall_exit.png",
      "features/grand_chair.png", "features/column.png",
    ],
  },
];

describe.each(CASES)("$style dungeon style", ({ style, prefix, folder, mustSee }) => {
  it("is a supported style", () => {
    expect(DUNGEON_STYLES).toContain(style);
    expect(normalizeDungeonStyle(style)).toBe(style);
  });

  it("every palette id the style borrows exists in the Default palette", () => {
    const ids = DUNGEON_PALETTE_IDS.filter((id) => id.startsWith(`${prefix}_`));
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(palette.has(id), id).toBe(true);
  });

  it("paints every cell with real art, all from the style's own tiles", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const edge of [false, true]) {
        for (const map of generate(style, seed, { edge_transitions: edge })) {
          for (const row of map.grid) {
            for (const cell of row) {
              expect(cell.sprite, `${cell.id} seed=${seed}`).not.toBe("");
              expect(knownSprites.has(cell.sprite), cell.sprite).toBe(true);
              // Tileset art only (chests, torches and room furnishings
              // are shared).
              if (cell.id !== "chest" && cell.id !== "wall_torch" && !PROP_IDS.has(cell.id)) {
                expect(cell.sprite.startsWith(folder), `${cell.id} ${cell.sprite}`).toBe(true);
              }
              seen.add(cell.sprite.replace(folder, ""));
            }
          }
        }
      }
    }
    for (const piece of mustSee) expect(seen.has(piece), piece).toBe(true);
  });
});
