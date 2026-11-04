import { describe, it, expect } from "vitest";
import {
  generateDungeonLevel,
  TILE_DWALL,
  TILE_PILLAR,
  TILE_RUBBLE,
  TILE_THRONE,
  TILE_PIT,
  type DungeonLevel,
  type DungeonStyle,
} from "@/battle/world/Dungeon";
import { TILE_DFLOOR } from "@/battle/world/Tiles";
import { dungeonLevelToMap, floorMapId } from "./dungeonLevelToMap";
import { DUNGEON_PALETTE_IDS } from "./tileMapping";
import { generateDungeonFromRecord, resolveLevelOptions } from "./generateFromRecord";
import { STYLE_DEFAULTS, type DungeonRecord } from "./types";
import { applyPitFall } from "@/play/pitFall";

const OBJECTS = new Set([TILE_PILLAR, TILE_RUBBLE, TILE_THRONE]);
const palette = new Map(DUNGEON_PALETTE_IDS.map((id) => [id, `s/${id}.png`]));

function gen(style: DungeonStyle, seed: number, extra: Partial<Parameters<typeof generateDungeonLevel>[0]> = {}) {
  return generateDungeonLevel({
    name: "F", width: 40, height: 30, style, difficulty: "normal", floorIdx: 0,
    placeStairsDown: true, lockProbability: 0, torchProbability: 0.15,
    chestItemId: "chest", chestProbability: 0.5, seed, ...extra,
  });
}

function reachable(l: DungeonLevel): Set<string> {
  const blocked = new Set<number>([TILE_DWALL, TILE_PIT, ...OBJECTS]);
  const seen = new Set([`${l.entryCol},${l.entryRow}`]);
  const q: Array<[number, number]> = [[l.entryCol, l.entryRow]];
  while (q.length) {
    const [c, r] = q.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = l.tiles[r + dr]?.[c + dc];
      const k = `${c + dc},${r + dr}`;
      if (t === undefined || blocked.has(t) || seen.has(k)) continue;
      seen.add(k);
      q.push([c + dc, r + dr]);
    }
  }
  return seen;
}

describe("room objects", () => {
  it("objects: 0 places none; objects never cut off anything reachable", () => {
    let placed = 0;
    for (const style of ["dungeon", "cavern"] as const) {
      for (let seed = 1; seed <= 30; seed++) {
        const base = gen(style, seed, { objectProbability: 0, pitProbability: 0.5 });
        expect(base.tiles.flat().some((t) => OBJECTS.has(t))).toBe(false);
        const full = gen(style, seed, { objectProbability: 1, pitProbability: 0.5 });
        const objs = new Set<string>();
        full.tiles.forEach((row, r) => row.forEach((t, c) => { if (OBJECTS.has(t)) objs.add(`${c},${r}`); }));
        placed += objs.size;
        const after = reachable(full);
        for (const k of reachable(base)) {
          if (!objs.has(k)) expect(after.has(k), `${style} ${seed} lost ${k}`).toBe(true);
        }
        for (const m of full.monsters) expect(objs.has(`${m.col},${m.row}`)).toBe(false);
      }
    }
    expect(placed).toBeGreaterThan(50);
  });

  it("boss dungeon floors get a throne against the back wall; caverns don't", () => {
    let thrones = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const l = gen("dungeon", seed, { difficulty: "boss" });
      l.tiles.forEach((row, r) => row.forEach((t, c) => {
        if (t !== TILE_THRONE) return;
        thrones++;
        expect(l.tiles[r - 1][c]).toBe(TILE_DWALL);
      }));
      expect(gen("cavern", seed, { difficulty: "boss" }).tiles.flat()).not.toContain(TILE_THRONE);
      expect(gen("dungeon", seed).tiles.flat()).not.toContain(TILE_THRONE);
    }
    expect(thrones).toBeGreaterThan(10);
  });

  it("converter paints objects per style over the floor beneath", () => {
    const d = dungeonLevelToMap(gen("dungeon", 4, { objectProbability: 1 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const c = dungeonLevelToMap(gen("cavern", 4, { objectProbability: 1 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const ids = (m: typeof d) => new Set(m.grid.flat().filter((x) => x.object).map((x) => x.id));
    expect([...ids(d)].every((id) => id === "dungeon_pillar" || id === "dungeon_rubble")).toBe(true);
    expect([...ids(c)].every((id) => id === "cave_stalagmite" || id === "cave_rubble")).toBe(true);
    for (const cell of d.grid.flat().filter((x) => x.object)) {
      expect(cell.walkable).toBe(false);
      expect(cell.background_sprite).toMatch(/floor/);
      expect(cell.obstructs).toBe(cell.id === "dungeon_pillar");
    }
  });
});

describe("floor variety + wall decor", () => {
  it("dungeon rooms take alternate floors at full variety, none at 0", () => {
    const plain = dungeonLevelToMap(gen("dungeon", 9, { floorVariety: 0 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const varied = dungeonLevelToMap(gen("dungeon", 9, { floorVariety: 1 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const floors = (m: typeof plain) => new Set(m.grid.flat().map((x) => x.id).filter((id) => id.startsWith("dungeon_floor_") && id !== "dungeon_floor_trap"));
    expect([...floors(plain)]).toEqual(["dungeon_floor_flagstone"]);
    expect(floors(varied).size).toBeGreaterThan(1);
  });

  it("cavern floor variety 0 is plain dirt; default keeps patches", () => {
    const plain = dungeonLevelToMap(gen("cavern", 9, { floorVariety: 0 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const patchy = dungeonLevelToMap(gen("cavern", 9, { floorVariety: 0.6 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    const floors = (m: typeof plain) => new Set(m.grid.flat().map((x) => x.id).filter((id) => id.startsWith("cave_floor_")));
    expect([...floors(plain)]).toEqual(["cave_floor_dirt"]);
    expect(floors(patchy).size).toBeGreaterThan(2);
  });

  it("wall decor appears only at > 0; glowing cracks are light sources", () => {
    const none = dungeonLevelToMap(gen("cavern", 2, { wallDecor: 0 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
    expect(none.grid.flat().some((x) => /wall_(crack|crystals|webs)/.test(x.id))).toBe(false);
    let decorated = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = dungeonLevelToMap(gen("cavern", seed, { wallDecor: 1 }), { dungeonId: "d", floorIdx: 0, totalFloors: 1, paletteSprites: palette });
      for (const x of m.grid.flat()) {
        if (!/wall_(crack|crystals|webs)/.test(x.id)) continue;
        decorated++;
        expect(x.walkable).toBe(false);
        if (x.id === "cave_wall_crack") expect(x.light_source).toBe(true);
      }
    }
    expect(decorated).toBeGreaterThan(5);
  });
});

describe("pit drop-through", () => {
  const rec = (over: Partial<DungeonRecord> = {}): DungeonRecord => ({
    id: "pd", name: "PD", style: "dungeon", pits: 1, size: { width: 40, height: 30 },
    levels: [
      { id: "a", name: "A", depth: 1 },
      { id: "b", name: "B", depth: 2 },
    ],
    ...over,
  });

  it("pits on upper floors link to the floor below at an open landing; bottom-floor pits stay solid", () => {
    const [f0, f1] = generateDungeonFromRecord(rec(), { seed: 5 });
    expect(f0.pitLandings && Object.keys(f0.pitLandings).length).toBeGreaterThan(0);
    for (const [, [lc, lr]] of Object.entries(f0.pitLandings!)) {
      expect(f1.tiles[lr][lc]).toBe(TILE_DFLOOR);
    }
    expect(f1.pitLandings).toBeUndefined();
    const m0 = dungeonLevelToMap(f0, { dungeonId: "pd", floorIdx: 0, totalFloors: 2, paletteSprites: palette });
    const pits0 = m0.grid.flat().filter((x) => x.pit);
    expect(pits0.length).toBeGreaterThan(0);
    for (const p of pits0) {
      expect(p.walkable).toBe(true);
      expect(p.link?.fall).toBe(true);
      expect(p.link?.map_id).toBe(floorMapId("pd", 1));
    }
    const m1 = dungeonLevelToMap(f1, { dungeonId: "pd", floorIdx: 1, totalFloors: 2, paletteSprites: palette });
    for (const p of m1.grid.flat().filter((x) => x.pit)) {
      expect(p.walkable).toBe(false);
      expect(p.link ?? null).toBeNull();
    }
  });

  it("pit_falls: false keeps every pit a solid chasm", () => {
    const [f0] = generateDungeonFromRecord(rec({ pit_falls: false }), { seed: 5 });
    expect(f0.pitLandings).toBeUndefined();
  });

  it("fall damage stings but never knocks anyone out", () => {
    const members = [{ id: "a", hp: 10 }, { id: "b", hp: 2 }, { id: "c", hp: 0 }];
    const { members: after, lines } = applyPitFall(members, () => 0.99);
    expect(after[0].hp).toBe(6);
    expect(after[1].hp).toBe(1);
    expect(after[2].hp).toBe(0);
    expect(lines[0]).toMatch(/plunges/);
  });
});

describe("dressing dials resolve level → parent → style default", () => {
  it("uses the style default when unset, parent when set, level when overridden", () => {
    const r: DungeonRecord = {
      id: "x", name: "X", style: "cavern", wall_decor: 0.4,
      levels: [
        { id: "a", name: "A", depth: 1 },
        { id: "b", name: "B", depth: 2, style: "dungeon", objects: 0.2, pit_falls: false },
      ],
    };
    const a = resolveLevelOptions(r, r.levels[0], 0);
    expect(a.objectFrequency).toBe(STYLE_DEFAULTS.cavern.objects);
    expect(a.floorVariety).toBe(STYLE_DEFAULTS.cavern.floor_variety);
    expect(a.wallDecor).toBe(0.4);
    expect(a.pitFalls).toBe(true);
    const b = resolveLevelOptions(r, r.levels[1], 1);
    expect(b.objectFrequency).toBe(0.2);
    expect(b.floorVariety).toBe(STYLE_DEFAULTS.dungeon.floor_variety);
    expect(b.pitFalls).toBe(false);
  });
});
