/**
 * Regression: a dungeon's layout comes from its seed. Different seeds
 * must give different floors (otherwise "Regenerate" in the simulator
 * and a fresh / respawned run in game look identical), and the same
 * seed must reproduce the same floors (saves + the simulator's seed
 * field rely on that). Runs against every real dungeon record shipped
 * in public/modules so a style or record that ignores the seed is
 * caught.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDungeonFromRecord } from "./generateFromRecord";
import type { DungeonRecord } from "./types";

const MODULES_DIR = join(__dirname, "../../../public/modules");

function shippedDungeons(): Array<{ module: string; record: DungeonRecord }> {
  const out: Array<{ module: string; record: DungeonRecord }> = [];
  for (const mod of readdirSync(MODULES_DIR)) {
    const file = join(MODULES_DIR, mod, "dungeons.json");
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, "utf8")) as {
      dungeons?: DungeonRecord[];
    };
    for (const record of json.dungeons ?? []) out.push({ module: mod, record });
  }
  return out;
}

/** Floor layout fingerprint: every floor's tile grid. */
function layout(record: DungeonRecord, seed: number): string {
  return JSON.stringify(
    generateDungeonFromRecord(record, { seed }).map((f) => f.tiles),
  );
}

const SEEDS = [1, 2, 1234567, 987654321, 0x7ffffffe];

describe("dungeon seeds", () => {
  const dungeons = shippedDungeons();

  it("finds shipped dungeon records to check", () => {
    expect(dungeons.length).toBeGreaterThan(0);
  });

  for (const { module, record } of dungeons) {
    it(`${module}/${record.id}: different seeds give different layouts`, () => {
      const layouts = SEEDS.map((s) => layout(record, s));
      expect(new Set(layouts).size).toBe(SEEDS.length);
    });

    it(`${module}/${record.id}: the same seed reproduces the layout`, () => {
      expect(layout(record, 424242)).toBe(layout(record, 424242));
    });
  }
});
