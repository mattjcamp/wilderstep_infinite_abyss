import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { generateDungeonFromRecord, resolveLevelOptions, traderFloor } from "./generateFromRecord";
import { dungeonLevelToMap } from "./dungeonLevelToMap";
import { TILE_PROP, TILE_STAIRS_DOWN, TILE_CHEST } from "@/battle/world/Dungeon";
import { addLoops, WALKABLE_PROPS } from "@/battle/world/dungeonRooms";
import { PROP_INFO } from "./roomProps";
import type { DungeonRecord } from "./types";

const tilesFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../public/modules/default/map_tiles.json"), "utf8"),
);
const tileList = Object.values(tilesFile).find(Array.isArray) as Array<{ id: string; sprite: string }>;
const palette = new Map(tileList.map((t) => [t.id, t.sprite]));

function record(over: Partial<DungeonRecord> = {}): DungeonRecord {
  return {
    id: "rr",
    name: "Rooms",
    style: "dungeon",
    difficulty: "normal",
    size: { width: 36, height: 28 },
    torch_density: 0.2,
    locked_doors: 0.3,
    pits: 0.4,
    loot: { chest_item: "treasure_chest", chest_frequency: 0.4 },
    levels: [
      { id: "a", name: "A", depth: 1 },
      { id: "b", name: "B", depth: 2 },
    ],
    ...over,
  };
}

describe("addLoops", () => {
  const rooms = Array.from({ length: 10 }, (_, i) => ({ x: (i % 5) * 7, y: Math.floor(i / 5) * 7, w: 5, h: 5 }));
  it("adds about 0.4 × loops × rooms links, never between carve-order neighbours, ≤2 per room", () => {
    const links: Array<[number, number]> = [];
    const n = addLoops(rooms, 1, () => 0.5, (a, b) => links.push([a, b]));
    expect(n).toBe(4);
    const per = new Array(10).fill(0);
    for (const [a, b] of links) {
      expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
      per[a]++;
      per[b]++;
    }
    expect(Math.max(...per)).toBeLessThanOrEqual(2);
  });
  it("adds nothing at 0 or with fewer than four rooms", () => {
    expect(addLoops(rooms, 0, Math.random, () => undefined)).toBe(0);
    expect(addLoops(rooms.slice(0, 3), 1, Math.random, () => undefined)).toBe(0);
  });
});

describe("loops + room roles — settings", () => {
  it("default to the style's dials and inherit / override per level", () => {
    const r = record();
    const o = resolveLevelOptions(r, r.levels[0], 0);
    expect(o.loops).toBe(0.35);
    expect(o.roomRoles).toBe(0.4);
    const m = record({ style: "manor" });
    expect(resolveLevelOptions(m, m.levels[0], 0).roomRoles).toBe(0.5);
    const lv = record({ loops: 0.8, room_roles: 0.1 });
    lv.levels[1] = { ...lv.levels[1], loops: 0, room_roles: 1 };
    expect(resolveLevelOptions(lv, lv.levels[0], 0)).toMatchObject({ loops: 0.8, roomRoles: 0.1 });
    expect(resolveLevelOptions(lv, lv.levels[1], 1)).toMatchObject({ loops: 0, roomRoles: 1 });
  });

  it("room_roles 0 furnishes nothing", () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const f of generateDungeonFromRecord(record({ room_roles: 0 }), { seed })) {
        expect(f.props).toBeUndefined();
        expect(f.roomRoles).toBeUndefined();
      }
    }
  });

  it("loops add corridor: more open floor than the same seed without", () => {
    let more = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const open = (loops: number) =>
        generateDungeonFromRecord(record({ loops, room_roles: 0, pits: 0 }), { seed })[0].tiles
          .flat()
          .filter((t) => t === 20).length;
      if (open(1) > open(0)) more++;
    }
    expect(more).toBeGreaterThanOrEqual(8);
  });

  it("a vault only appears when the floor has chests", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const noChest = record({ room_roles: 1, loot: undefined });
      for (const f of generateDungeonFromRecord(noChest, { seed })) {
        expect((f.roomRoles ?? []).some((r) => r.role === "vault")).toBe(false);
      }
    }
  });
});

describe("furnished rooms never cut anything off", () => {
  const styles = ["dungeon", "cavern", "deep_ones_hall", "manor"] as const;
  it("stairs, way out, chests and monsters stay reachable from the entrance", () => {
    for (const style of styles) {
      for (const size of [20, 36]) {
        for (let seed = 1; seed <= 12; seed++) {
          const rec = record({
            style,
            size: { width: size, height: size },
            room_roles: 1,
            loops: 1,
            bottom_exit: "opening",
          });
          const floors = generateDungeonFromRecord(rec, { seed });
          floors.forEach((f, i) => {
            const label = `${style} ${size} seed=${seed} floor=${i}`;
            const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
            const ok = (c: number, r: number) => {
              const cell = map.grid[r]?.[c];
              return !!cell && (cell.walkable || !!cell.locked || !!cell.link);
            };
            const seen = new Set<string>([`${f.entryCol},${f.entryRow}`]);
            const q: Array<[number, number]> = [[f.entryCol, f.entryRow]];
            for (let k = 0; k < q.length; k++) {
              const [c, r] = q[k];
              for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
                const key = `${c + dc},${r + dr}`;
                if (seen.has(key) || !ok(c + dc, r + dr)) continue;
                seen.add(key);
                q.push([c + dc, r + dr]);
              }
            }
            for (let r = 0; r < f.height; r++) {
              for (let c = 0; c < f.width; c++) {
                const t = f.tiles[r][c];
                if (t === TILE_STAIRS_DOWN || t === TILE_CHEST) expect(seen.has(`${c},${r}`), `${label} tile ${t} @${c},${r}`).toBe(true);
              }
            }
            for (const key of f.overworldExits) expect(seen.has(key), `${label} exit`).toBe(true);
            for (const m of f.monsters) expect(seen.has(`${m.col},${m.row}`), `${label} monster`).toBe(true);
          });
        }
      }
    }
  });

  it("paints each prop from its palette tile; blocking props block, rugs and books don't", () => {
    let seenProps = 0;
    for (const style of styles) {
      for (let seed = 1; seed <= 6; seed++) {
        const floors = generateDungeonFromRecord(record({ style, room_roles: 1 }), { seed });
        floors.forEach((f, i) => {
          const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
          for (const [key, kind] of Object.entries(f.props ?? {})) {
            const [c, r] = key.split(",").map(Number);
            const cell = map.grid[r][c];
            expect(cell.id).toBe(PROP_INFO[kind].paletteId);
            expect(cell.sprite).toBe(palette.get(PROP_INFO[kind].paletteId));
            expect(cell.background_sprite).toBeTruthy();
            expect(cell.walkable).toBe(WALKABLE_PROPS.has(kind));
            if (!WALKABLE_PROPS.has(kind)) expect(f.tiles[r][c]).toBe(TILE_PROP);
            seenProps++;
          }
        });
      }
    }
    expect(seenProps).toBeGreaterThan(100);
  });

  it("a palette without the furnishing art leaves plain walkable floor", () => {
    const f = generateDungeonFromRecord(record({ room_roles: 1 }), { seed: 3 })[0];
    const bare = new Map([...palette].filter(([id]) => !Object.values(PROP_INFO).some((p) => p.paletteId === id)));
    const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: 0, totalFloors: 2, paletteSprites: bare });
    const keys = Object.keys(f.props ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const [c, r] = key.split(",").map(Number);
      expect(map.grid[r][c].walkable).toBe(true);
    }
  });
});

describe("room-role gameplay", () => {
  const encounters = {
    dungeon: [
      { id: "rats", area: "dungeon", name: "Rats", level: 3, weight: 1, monsterPartyTile: "rat", monsters: ["rat"], tags: [] },
    ],
  } as never;
  const styles = ["dungeon", "cavern", "deep_ones_hall", "manor"] as const;

  /** Cells reachable from the entry with `blocked` cells shut. */
  function reach(map: ReturnType<typeof dungeonLevelToMap>, from: [number, number], blocked: ReadonlySet<string>) {
    const seen = new Set<string>([`${from[0]},${from[1]}`]);
    const q: Array<[number, number]> = [from];
    for (let k = 0; k < q.length; k++) {
      const [c, r] = q[k];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const key = `${c + dc},${r + dr}`;
        const cell = map.grid[r + dr]?.[c + dc];
        if (seen.has(key) || !cell || blocked.has(key)) continue;
        if (!(cell.walkable || cell.locked || cell.link)) continue;
        seen.add(key);
        q.push([c + dc, r + dr]);
      }
    }
    return seen;
  }

  it("seals vaults behind locked doors, chest inside, key reachable outside", () => {
    let vaults = 0;
    for (const style of styles) {
      for (let seed = 1; seed <= 25; seed++) {
        const rec = record({ style, room_roles: 1, vault_key: "iron_key", doors: 1 });
        const floors = generateDungeonFromRecord(rec, { seed, encounters });
        floors.forEach((f, i) => {
          const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
          const vaultRooms = (f.roomRoles ?? []).filter((x) => x.role === "vault").map((x) => f.rooms![x.room]);
          if (vaultRooms.length === 0) return;
          vaults += vaultRooms.length;
          const label = `${style} seed=${seed} floor=${i}`;
          // Doors: every way into a vault is a locked door.
          const shut = new Set<string>();
          for (const rm of vaultRooms) {
            const inRoom = (c: number, r: number) => c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h;
            let chest = false;
            for (let r = rm.y - 1; r <= rm.y + rm.h; r++) {
              for (let c = rm.x - 1; c <= rm.x + rm.w; c++) {
                const cell = map.grid[r]?.[c];
                if (!cell) continue;
                if (inRoom(c, r)) {
                  if (cell.id === "chest") chest = true;
                  continue;
                }
                const edge = (c >= rm.x && c < rm.x + rm.w) || (r >= rm.y && r < rm.y + rm.h);
                if (edge && (cell.walkable || cell.locked)) {
                  expect(cell.locked, `${label} vault opening @${c},${r}`).toBe(true);
                  shut.add(`${c},${r}`);
                }
              }
            }
            expect(chest, `${label} vault chest`).toBe(true);
          }
          // The key lies outside the vaults and can be reached without
          // opening them.
          const keys = Object.entries(f.items ?? {}).filter(([, id]) => id === "iron_key");
          expect(keys.length, `${label} keys`).toBe(vaultRooms.length);
          const open = reach(map, [f.entryCol, f.entryRow], shut);
          for (const [k] of keys) {
            const [c, r] = k.split(",").map(Number);
            expect(map.grid[r][c].item).toBe("iron_key");
            expect(open.has(k), `${label} key reachable`).toBe(true);
          }
          // Locking a vault cuts nothing else off: the stairs down and
          // every monster outside the vaults stay reachable.
          for (const m of f.monsters) {
            const inVault = vaultRooms.some((rm) => m.col >= rm.x && m.col < rm.x + rm.w && m.row >= rm.y && m.row < rm.y + rm.h);
            if (!inVault) expect(open.has(`${m.col},${m.row}`), `${label} monster`).toBe(true);
          }
        });
      }
    }
    expect(vaults).toBeGreaterThan(10);
  });

  it("no vault key set → vaults still locked, no key on the floor", () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const f of generateDungeonFromRecord(record({ room_roles: 1, doors: 1 }), { seed })) {
        expect(f.items).toBeUndefined();
      }
    }
  });

  it("every guard post holds a fight", () => {
    let posts = 0;
    for (const style of styles) {
      for (let seed = 1; seed <= 15; seed++) {
        for (const f of generateDungeonFromRecord(record({ style, room_roles: 1 }), { seed, encounters })) {
          for (const { room, role } of f.roomRoles ?? []) {
            if (role !== "guard_post") continue;
            posts++;
            const rm = f.rooms![room];
            const inside = f.monsters.some((m) => m.col >= rm.x && m.col < rm.x + rm.w && m.row >= rm.y && m.row < rm.y + rm.h);
            expect(inside, `${style} seed=${seed}`).toBe(true);
          }
        }
      }
    }
    expect(posts).toBeGreaterThan(5);
  });

  it("libraries and shrines make the dungeon's lore readable, each once, in order", () => {
    const lore = ["l1", "l2", "l3", "l4", "l5", "l6"];
    const rec = record({ style: "deep_ones_hall", room_roles: 1, lore });
    const floors = generateDungeonFromRecord(rec, { seed: 4 });
    const used: string[] = [];
    floors.forEach((f, i) => {
      const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
      for (const [k, id] of Object.entries(f.propLore ?? {})) {
        const [c, r] = k.split(",").map(Number);
        expect(["book", "book_closed", "statue_top"]).toContain(f.props![k]);
        expect((map.grid[r][c] as { lore?: string }).lore).toBe(id);
        used.push(id);
      }
    });
    expect(used.length).toBeGreaterThan(0);
    expect(used).toEqual(lore.slice(0, used.length));
    // No lore list → nothing readable.
    for (const f of generateDungeonFromRecord(record({ style: "deep_ones_hall", room_roles: 1 }), { seed: 4 })) {
      expect(f.propLore).toBeUndefined();
    }
  });
});

describe("reasons to go deeper — trader and prisoner", () => {
  const encounters = {
    dungeon: [
      { id: "rats", area: "dungeon", name: "Rats", level: 3, weight: 1, monsterPartyTile: "rat", monsters: ["rat"], tags: [] },
    ],
  } as never;
  const styles = ["dungeon", "cavern", "deep_ones_hall", "manor"] as const;
  const threeFloors = [
    { id: "a", name: "A", depth: 1 },
    { id: "b", name: "B", depth: 2 },
    { id: "c", name: "C", depth: 3 },
  ];

  it("the trader camps on the middle floor", () => {
    expect([1, 2, 3, 4, 5].map(traderFloor)).toEqual([0, 1, 1, 2, 2]);
  });

  it("puts the trader in a quiet, reachable room on the middle floor only", () => {
    let placed = 0;
    for (const style of styles) {
      for (let seed = 1; seed <= 12; seed++) {
        const rec = record({ style, levels: threeFloors, trader_npc: "olga", room_roles: 0.4 });
        const floors = generateDungeonFromRecord(rec, { seed, encounters });
        floors.forEach((f, i) => {
          const traders = Object.entries(f.npcs ?? {}).filter(([, id]) => id === "olga");
          if (i !== 1) {
            expect(traders.length, `${style} floor ${i}`).toBe(0);
            return;
          }
          if (traders.length === 0) return;
          placed++;
          expect(traders.length).toBe(1);
          const [c, r] = traders[0][0].split(",").map(Number);
          const camp = (f.roomRoles ?? []).find((x) => x.role === "trader_camp")!;
          const rm = f.rooms![camp.room];
          expect(c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h).toBe(true);
          expect(f.monsters.some((m) => m.col >= rm.x && m.col < rm.x + rm.w && m.row >= rm.y && m.row < rm.y + rm.h)).toBe(false);
          const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
          expect((map.grid[r][c] as { npc?: string }).npc).toBe("olga");
          // The party can walk up to the trader: a neighbour is reachable.
          const seen = new Set<string>([`${f.entryCol},${f.entryRow}`]);
          const q: Array<[number, number]> = [[f.entryCol, f.entryRow]];
          for (let k = 0; k < q.length; k++) {
            const [qc, qr] = q[k];
            for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
              const cell = map.grid[qr + dr]?.[qc + dc];
              const key = `${qc + dc},${qr + dr}`;
              if (!cell || seen.has(key) || (cell as { npc?: string }).npc) continue;
              if (!(cell.walkable || cell.locked || cell.link)) continue;
              seen.add(key);
              q.push([qc + dc, qr + dr]);
            }
          }
          const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]].some(([x, y]) => seen.has(`${x},${y}`));
          expect(next, `${style} seed=${seed}`).toBe(true);
        });
      }
    }
    expect(placed).toBeGreaterThan(30);
  });

  it("holds the prisoner in a locked cell on the bottom floor, with the key elsewhere", () => {
    let celled = 0;
    let held = 0;
    for (const style of styles) {
      for (let seed = 1; seed <= 12; seed++) {
        const rec = record({
          style,
          levels: threeFloors,
          prisoner_npc: "brom",
          prisoner_reward: "potion",
          vault_key: "iron_key",
          size: { width: 32, height: 28 },
        });
        const floors = generateDungeonFromRecord(rec, { seed, encounters });
        floors.forEach((f, i) => {
          const at = Object.entries(f.npcs ?? {}).filter(([, id]) => id === "brom");
          if (i !== floors.length - 1) {
            expect(at.length).toBe(0);
            expect(f.prisoner).toBeUndefined();
            return;
          }
          if (at.length === 0) return;
          held++;
          expect(f.prisoner).toEqual({ npc: "brom", reward: "potion" });
          const sealed = (f.roomRoles ?? []).find((x) => x.role === "prison");
          if (!sealed) return;
          const rm = f.rooms![sealed.room];
          const [c, r] = at[0][0].split(",").map(Number);
          expect(c >= rm.x && c < rm.x + rm.w && r >= rm.y && r < rm.y + rm.h).toBe(true);
          const map = dungeonLevelToMap(f, { dungeonId: "rr", floorIdx: i, totalFloors: floors.length, paletteSprites: palette });
          // A carved cell (3×3) is locked in, and its key lies outside.
          if (rm.w === 3 && rm.h === 3) {
            celled++;
            let locked = 0;
            for (let y = rm.y - 1; y <= rm.y + rm.h; y++) {
              for (let x = rm.x - 1; x <= rm.x + rm.w; x++) if (map.grid[y]?.[x]?.locked) locked++;
            }
            expect(locked, `${style} seed=${seed}`).toBeGreaterThan(0);
            const keys = Object.entries(f.items ?? {}).filter(([, id]) => id === "iron_key");
            expect(keys.length).toBeGreaterThan(0);
            for (const [k] of keys) {
              const [kc, kr] = k.split(",").map(Number);
              expect(kc >= rm.x && kc < rm.x + rm.w && kr >= rm.y && kr < rm.y + rm.h).toBe(false);
            }
          }
        });
      }
    }
    expect(held).toBeGreaterThan(30);
    expect(celled).toBeGreaterThan(20);
  });
});
