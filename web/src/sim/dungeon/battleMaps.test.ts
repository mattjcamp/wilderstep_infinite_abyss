/**
 * Dungeon `battle_maps`: every fight in a generated dungeon runs on one
 * of the dungeon's arena maps (per Level override allowed); without
 * them, an encounter's own `custom_map` applies; and the choice reaches
 * the encounter refs the kernel turns into combat.
 */
import { describe, expect, it } from "vitest";
import type { EncounterTemplate } from "@/battle/world/Encounters";
import { generateDungeonFromRecord } from "./generateFromRecord";
import { dungeonEncounterRefs } from "./dungeonLevelToMap";
import type { DungeonRecord } from "./types";

const encounters: Record<string, EncounterTemplate[]> = {
  dungeon: [
    {
      id: "cellar_rats", area: "dungeon", name: "Cellar Rats", level: 2, weight: 1,
      monsterPartyTile: "monster/giant_rat.png", monsters: ["giant_rat"],
      arenaId: "rat_arena",
    } as EncounterTemplate,
    {
      id: "goblins", area: "dungeon", name: "Goblins", level: 3, weight: 1,
      monsterPartyTile: "monster/goblin.png", monsters: ["goblin"],
    } as EncounterTemplate,
  ],
};

function record(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "crypt", name: "Crypt", style: "dungeon", difficulty: "normal",
    size: { width: 40, height: 30 }, torch_density: 0, locked_doors: 0,
    levels: [
      { id: "a", name: "A", depth: 1 },
      { id: "b", name: "B", depth: 2 },
    ],
    ...over,
  } as DungeonRecord;
}

const gen = (r: DungeonRecord, seed = 5) => generateDungeonFromRecord(r, { seed, encounters });

describe("dungeon battle maps", () => {
  it("every monster group fights on one of the dungeon's battle maps", () => {
    const maps = ["crypt_arena_1", "crypt_arena_2"];
    let groups = 0;
    const used = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      for (const lvl of gen(record({ battle_maps: maps }), seed)) {
        for (const m of lvl.monsters) {
          expect(maps).toContain(m.customMap);
          used.add(m.customMap!);
          groups++;
        }
      }
    }
    expect(groups).toBeGreaterThan(5);
    expect(used.size).toBe(2); // both get used across fights
  });

  it("the pick is stable for a given seed", () => {
    const r = record({ battle_maps: ["x", "y", "z"] });
    const a = gen(r).flatMap((l) => l.monsters.map((m) => m.customMap));
    const b = gen(r).flatMap((l) => l.monsters.map((m) => m.customMap));
    expect(a).toEqual(b);
  });

  it("does not change the layout or monster placement for a seed", () => {
    const plain = gen(record());
    const withMaps = gen(record({ battle_maps: ["x"] }));
    expect(withMaps.map((l) => l.tiles)).toEqual(plain.map((l) => l.tiles));
    expect(withMaps.map((l) => l.monsters.map((m) => [m.col, m.row, m.encounterId])))
      .toEqual(plain.map((l) => l.monsters.map((m) => [m.col, m.row, m.encounterId])));
  });

  it("a Level's list replaces the Dungeon's", () => {
    const r = record({
      battle_maps: ["upper"],
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2, battle_maps: ["lower"] },
      ],
    });
    for (let seed = 1; seed <= 5; seed++) {
      const [a, b] = gen(r, seed);
      for (const m of a.monsters) expect(m.customMap).toBe("upper");
      for (const m of b.monsters) expect(m.customMap).toBe("lower");
    }
  });

  it("without battle maps, an encounter's own arena applies", () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const lvl of gen(record(), seed)) {
        for (const m of lvl.monsters) {
          expect(m.customMap).toBe(m.encounterId === "cellar_rats" ? "rat_arena" : undefined);
        }
      }
    }
  });

  it("reaches the encounter refs as custom_map", () => {
    const [lvl] = gen(record({ battle_maps: ["crypt_arena_1"] }));
    const refs = dungeonEncounterRefs(lvl);
    expect(refs.length).toBe(lvl.monsters.length);
    for (const ref of refs) expect(ref.custom_map).toBe("crypt_arena_1");
  });
});
