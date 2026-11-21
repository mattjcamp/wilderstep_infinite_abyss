/**
 * Two generator passes that keep procedural floors from feeling samey:
 *
 *  1. **Loops** (`addLoops`) — the room carver joins each new room only
 *     to the one carved before it, so a floor is one long chain with
 *     dead-end backtracking. This pass joins a few extra pairs of
 *     nearby rooms, turning the chain into circuits: route choices, a
 *     way around a hard fight, shorter walks back.
 *
 *  2. **Room roles** (`placeRoomRoles`) — some rooms become a place with
 *     a purpose (a storeroom, library, mess hall, shrine, crypt, guard
 *     post, treasure vault, parlour, camp), furnished with props from
 *     the module palette. Props are recorded on the level by kind
 *     (`DungeonLevel.props`, "col,row" → kind); the dungeon→map
 *     converter maps each kind to a palette tile for the floor's style.
 *
 * Safety: a blocking prop is only kept if every cell the party could
 * reach before it was placed (minus the prop itself) is still
 * reachable — checked by flood fill — so furnishing never cuts off a
 * room, the stairs, a chest or a monster. Room entrances are always
 * left clear. Walkable props (rugs, books, bones) never block.
 *
 * Both passes draw from their own random streams so turning them up or
 * down doesn't shift the rest of a floor's rolls.
 */

import type { RNG } from "../rng";

/** Grid surface these passes read / write (Dungeon.ts's Grid). */
export interface RoomsGrid {
  width: number;
  height: number;
  tiles: number[][];
  decorations: Record<string, number>;
}

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a furnished room is for. */
export type RoomRole =
  | "storeroom"
  | "library"
  | "mess_hall"
  | "shrine"
  | "crypt"
  | "guard_post"
  | "vault"
  | "parlour"
  | "camp"
  /** A locked cell holding a prisoner (placed, never rolled). */
  | "prison"
  /** A trader's camp: a safe room where a shopkeeper NPC sets up. */
  | "trader_camp";

/** A furnishing, by kind — the converter picks the palette tile. */
export type PropKind =
  | "crate" | "crates_stack" | "barrel" | "barrel_large" | "barrel_small" | "pots"
  | "table_l" | "table_m" | "table_r" | "table"
  | "bench" | "trough" | "lantern" | "brazier"
  | "book" | "book_closed" | "bones"
  | "statue_top" | "statue_base" | "gravestone"
  | "plant" | "armchair"
  | "rug_tl" | "rug_t" | "rug_tr" | "rug_l" | "rug_c" | "rug_r" | "rug_bl" | "rug_b" | "rug_br"
  | "rug_runner";

/** Props the party can walk over (everything else blocks). */
export const WALKABLE_PROPS: ReadonlySet<PropKind> = new Set<PropKind>([
  "book", "book_closed", "bones",
  "rug_tl", "rug_t", "rug_tr", "rug_l", "rug_c", "rug_r", "rug_bl", "rug_b", "rug_br",
  "rug_runner",
]);

/** Roles each style can roll (weights). A vault only rolls when the
 *  floor has a chest item to put in it. */
export const ROLES_BY_STYLE: Record<string, Array<[RoomRole, number]>> = {
  dungeon: [
    ["storeroom", 3], ["guard_post", 2], ["mess_hall", 2], ["library", 2],
    ["shrine", 1], ["crypt", 2], ["vault", 1],
  ],
  cavern: [
    ["storeroom", 2], ["camp", 3], ["crypt", 2], ["shrine", 1], ["vault", 1],
  ],
  deep_ones_hall: [
    ["shrine", 3], ["crypt", 2], ["library", 2], ["storeroom", 1], ["guard_post", 1], ["vault", 1],
  ],
  manor: [
    ["parlour", 3], ["library", 2], ["mess_hall", 2], ["storeroom", 1], ["shrine", 1], ["vault", 1],
  ],
};

export interface RoomTiles {
  floor: number;
  wall: number;
  /** Grid tile a blocking prop becomes. */
  prop: number;
  chest: number;
  /** Door tiles (plain + locked). */
  doors: ReadonlySet<number>;
  /** Tile a sealed vault's doorways become. */
  lockedDoor: number;
  /** Tiles the party can cross (for the reachability check). */
  passable: ReadonlySet<number>;
}

function at(g: RoomsGrid, c: number, r: number): number {
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return -1;
  return g.tiles[r][c];
}

// ── Loops ────────────────────────────────────────────────────────────

/**
 * Join extra pairs of nearby rooms so the floor has circuits. About
 * `0.4 × loops × rooms` extra links (at least one when `loops` > 0 and
 * there are four or more rooms), between rooms that aren't already
 * neighbours in carve order, nearest pairs first, each room getting at
 * most two extra links. `connect` carves the corridor (the generator's
 * own L-shaped tunnel). Returns the number of links added.
 */
export function addLoops(
  rooms: ReadonlyArray<RoomRect>,
  loops: number,
  rng: RNG,
  connect: (a: number, b: number) => void,
): number {
  const n = rooms.length;
  if (!(loops > 0) || n < 4) return 0;
  const target = Math.max(1, Math.round(n * 0.4 * Math.min(1, loops)));
  const centre = (r: RoomRect) => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)];
  const dist = (a: RoomRect, b: RoomRect) => {
    const [ax, ay] = centre(a);
    const [bx, by] = centre(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  };
  // Typical step between consecutive rooms — loops link rooms that are
  // about as close as that, so corridors stay short.
  const steps = rooms.slice(1).map((r, i) => dist(rooms[i], r)).sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)] ?? 12;
  const maxD = Math.max(10, Math.round(median * 1.6));
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      const d = dist(rooms[i], rooms[j]);
      if (d <= maxD) pairs.push([i, j, d + rng() * 4]);
    }
  }
  pairs.sort((a, b) => a[2] - b[2]);
  const extra = new Array<number>(n).fill(0);
  let added = 0;
  for (const [i, j] of pairs) {
    if (added >= target) break;
    if (extra[i] >= 2 || extra[j] >= 2) continue;
    connect(i, j);
    extra[i]++;
    extra[j]++;
    added++;
  }
  return added;
}

// ── Room roles ───────────────────────────────────────────────────────

export interface RoomRolesResult {
  props: Record<string, PropKind>;
  roles: Array<{ room: number; role: RoomRole }>;
  /** Every cell of every furnished room — later passes (pits, clutter)
   *  leave these rooms alone. */
  claimed: Set<string>;
  /** Sealed rooms (vaults and prison cells): the room, its role and
   *  its now-locked doorways. */
  vaults: Array<{ room: number; doors: string[]; role: RoomRole }>;
  /** Where people stand: a prisoner in a prison cell, a trader in a
   *  trader's camp. Their cells are `tiles.prop` on the grid (nothing
   *  else lands there) but carry no prop. */
  people: Array<{ room: number; role: RoomRole; col: number; row: number }>;
}

/**
 * Furnish some rooms. Each room past the entrance with at least a 4×4
 * interior rolls `chance` for a role from the style's table (no role
 * twice on a floor while others are left). `skip` lists rooms to leave
 * alone (e.g. a boss floor's throne room). Blocking props become
 * `tiles.prop` on the grid; walkable ones stay floor. A vault gets a
 * real chest (`tiles.chest`) bound to the floor's chest item.
 */
export function placeRoomRoles(
  g: RoomsGrid,
  rooms: ReadonlyArray<RoomRect>,
  opts: {
    style: string;
    chance: number;
    tiles: RoomTiles;
    /** Cells nothing may be placed on (stairs, monsters, entry…). */
    occupied: ReadonlySet<string>;
    /** Where the party enters — the reachability check starts here. */
    entry: { col: number; row: number };
    hasChestItem: boolean;
    skip?: ReadonlySet<number>;
    /** Rooms whose role is fixed (e.g. a carved vault). */
    forced?: ReadonlyMap<number, RoomRole>;
    /** Rows actually drawn; a room running past them can't be a vault
     *  (its chest could end up off the map). */
    height?: number;
    rng: RNG;
  },
): RoomRolesResult {
  const { tiles, occupied, rng } = opts;
  const result: RoomRolesResult = { props: {}, roles: [], claimed: new Set(), vaults: [], people: [] };
  const chance = Math.min(1, Math.max(0, opts.chance));
  if (chance <= 0 && !opts.forced?.size) return result;
  // One vault per floor: a carved vault (forced) rules out another.
  const carvedVault = [...(opts.forced?.values() ?? [])].includes("vault");
  const table = (ROLES_BY_STYLE[opts.style] ?? ROLES_BY_STYLE.dungeon).filter(
    ([role]) => role !== "vault" || (opts.hasChestItem && !carvedVault),
  );
  if (table.length === 0 && !opts.forced?.size) return result;

  const key = (c: number, r: number) => `${c},${r}`;
  const passable = (c: number, r: number) => tiles.passable.has(at(g, c, r));

  // Reachability from the entry; blocking props must not reduce it by
  // more than the cell they sit on.
  const countReachable = (): number => {
    const seen = new Set<string>([key(opts.entry.col, opts.entry.row)]);
    const q: Array<[number, number]> = [[opts.entry.col, opts.entry.row]];
    for (let i = 0; i < q.length; i++) {
      const [c, r] = q[i];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        const k = key(nc, nr);
        if (seen.has(k) || !passable(nc, nr)) continue;
        seen.add(k);
        q.push([nc, nr]);
      }
    }
    return seen.size;
  };
  let reach = countReachable();

  /** Cells reachable from the entry, optionally treating `blocked`
   *  cells as walls. */
  const reachableSet = (blocked?: ReadonlySet<string>): Set<string> => {
    const start = key(opts.entry.col, opts.entry.row);
    const seen = new Set<string>([start]);
    const q: Array<[number, number]> = [[opts.entry.col, opts.entry.row]];
    for (let k = 0; k < q.length; k++) {
      const [c, r] = q[k];
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        const kk = key(nc, nr);
        if (seen.has(kk) || !passable(nc, nr) || blocked?.has(kk)) continue;
        seen.add(kk);
        q.push([nc, nr]);
      }
    }
    return seen;
  };

  /**
   * The doorways that would seal `room` as a vault, or null when it
   * can't be sealed. Every way in must be a one-cell gap in the room's
   * top or bottom wall (where the tilesets draw doors) with wall either
   * side, and the room must be a dead end: with those doorways locked,
   * everything outside the room is still reachable from the entrance.
   */
  const vaultDoors = (room: RoomRect): string[] | null => {
    const inRoom = (c: number, r: number) =>
      c >= room.x && c < room.x + room.w && r >= room.y && r < room.y + room.h;
    if (inRoom(opts.entry.col, opts.entry.row)) return null;
    if (room.y + room.h + 1 > (opts.height ?? g.height)) return null;
    const doors: string[] = [];
    const ring: Array<[number, number, boolean]> = [];
    for (let c = room.x; c < room.x + room.w; c++) {
      ring.push([c, room.y - 1, true]);
      ring.push([c, room.y + room.h, true]);
    }
    for (let r = room.y; r < room.y + room.h; r++) {
      ring.push([room.x - 1, r, false]);
      ring.push([room.x + room.w, r, false]);
    }
    for (const [c, r, horizontal] of ring) {
      if (!passable(c, r)) continue;
      const t = at(g, c, r);
      if (!horizontal) return null;
      if (t !== tiles.floor && !tiles.doors.has(t)) return null;
      if (at(g, c - 1, r) !== tiles.wall || at(g, c + 1, r) !== tiles.wall) return null;
      doors.push(key(c, r));
    }
    if (doors.length === 0) return null;
    const before = reachableSet();
    const after = reachableSet(new Set(doors));
    for (const k of before) {
      const [c, r] = k.split(",").map(Number);
      if (inRoom(c, r) || doors.includes(k)) continue;
      if (!after.has(k)) return null;
    }
    return doors;
  };

  const used = new Map<RoomRole, number>();
  for (let i = 1; i < rooms.length; i++) {
    if (opts.skip?.has(i)) continue;
    const room = rooms[i];
    const forcedRole = opts.forced?.get(i);
    if (!forcedRole) {
      if (room.w < 4 || room.h < 4) continue;
      if (rng() >= chance) continue;
    }
    // A vault (or prison cell) needs a room that can be sealed off.
    const sealDoors =
      forcedRole === "vault" || forcedRole === "prison" ||
      (!forcedRole && table.some(([r]) => r === "vault"))
        ? vaultDoors(room)
        : null;
    if (forcedRole === "vault" && !sealDoors) continue;
    let role: RoomRole;
    if (forcedRole) {
      role = forcedRole;
    } else {
      // Sealable rooms are scarce, so a room that can be one leans vault.
      const options: Array<[RoomRole, number]> = sealDoors
        ? table.map(([r, w]) => [r, r === "vault" && !used.has("vault") ? w * 4 : w])
        : table.filter(([r]) => r !== "vault");
      if (options.length === 0) continue;
      // Prefer roles not used yet on this floor.
      const fresh = options.filter(([r]) => !used.has(r));
      const pool = fresh.length > 0 ? fresh : options;
      const total = pool.reduce((a, [, w]) => a + w, 0);
      let roll = rng() * total;
      role = pool[pool.length - 1][0];
      for (const [r, w] of pool) {
        roll -= w;
        if (roll < 0) { role = r; break; }
      }
    }

    // Seal a vault first, so its doorways count as doors below.
    if ((role === "vault" || role === "prison") && sealDoors) {
      for (const k of sealDoors) {
        const [c, r] = k.split(",").map(Number);
        g.tiles[r][c] = tiles.lockedDoor;
        delete g.decorations[k];
      }
      result.vaults.push({ room: i, doors: sealDoors, role });
    }

    // Cells just inside the room's openings stay clear.
    const entrances = new Set<string>();
    for (let c = room.x; c < room.x + room.w; c++) {
      for (let r = room.y; r < room.y + room.h; r++) {
        const edge = c === room.x || c === room.x + room.w - 1 || r === room.y || r === room.y + room.h - 1;
        if (!edge) continue;
        for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const nc = c + dc;
          const nr = r + dr;
          const outside = nc < room.x || nc >= room.x + room.w || nr < room.y || nr >= room.y + room.h;
          if (outside && passable(nc, nr)) {
            entrances.add(key(c, r));
            // A doorway also keeps the cell in front of it clear, so a
            // door never opens onto a crate.
            if (tiles.doors.has(at(g, nc, nr))) entrances.add(key(c - dc, r - dr));
          }
        }
      }
    }
    const free = (c: number, r: number) =>
      c >= room.x && c < room.x + room.w && r >= room.y && r < room.y + room.h &&
      at(g, c, r) === tiles.floor &&
      !occupied.has(key(c, r)) &&
      !entrances.has(key(c, r)) &&
      !(key(c, r) in result.props);

    let placed = 0;
    /** Place one prop; blocking props only if nothing gets cut off. */
    const put = (c: number, r: number, kind: PropKind): boolean => {
      if (!free(c, r)) return false;
      if (WALKABLE_PROPS.has(kind)) {
        result.props[key(c, r)] = kind;
        placed++;
        return true;
      }
      g.tiles[r][c] = tiles.prop;
      const after = countReachable();
      if (after !== reach - 1) {
        g.tiles[r][c] = tiles.floor;
        return false;
      }
      reach = after;
      delete g.decorations[key(c, r)];
      result.props[key(c, r)] = kind;
      placed++;
      return true;
    };
    /** Stand a person (prisoner / trader) on the first spot that keeps
     *  every route open, nearest the room's centre first. */
    const placePerson = (): boolean => {
      const spots: Array<[number, number]> = [];
      for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) spots.push([c, r]);
      spots.sort((a, b) =>
        Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)),
      );
      for (const [c, r] of spots) {
        if (!free(c, r)) continue;
        g.tiles[r][c] = tiles.prop;
        const after = countReachable();
        if (after !== reach - 1) {
          g.tiles[r][c] = tiles.floor;
          continue;
        }
        reach = after;
        delete g.decorations[key(c, r)];
        result.people.push({ room: i, role, col: c, row: r });
        placed++;
        return true;
      }
      return false;
    };
    /** A run of props that only stays if every piece fits. */
    const putAll = (cells: Array<[number, number, PropKind]>): boolean => {
      const done: Array<[number, number]> = [];
      for (const [c, r, kind] of cells) {
        if (!put(c, r, kind)) {
          for (const [dc, dr] of done) {
            const k = key(dc, dr);
            if (!WALKABLE_PROPS.has(result.props[k])) g.tiles[dr][dc] = tiles.floor;
            delete result.props[k];
            placed--;
          }
          if (done.length > 0) reach = countReachable();
          return false;
        }
        done.push([c, r]);
      }
      return true;
    };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const x0 = room.x;
    const y0 = room.y;
    const x1 = room.x + room.w - 1;
    const y1 = room.y + room.h - 1;
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    const area = room.w * room.h;
    const wallCells = (): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let c = x0; c <= x1; c++) { out.push([c, y0]); out.push([c, y1]); }
      for (let r = y0 + 1; r < y1; r++) { out.push([x0, r]); out.push([x1, r]); }
      return out;
    };
    const shuffle = <T,>(xs: T[]): T[] => {
      for (let k = xs.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1));
        [xs[k], xs[j]] = [xs[j], xs[k]];
      }
      return xs;
    };
    const scatter = (kinds: readonly PropKind[], n: number, cells: Array<[number, number]>) => {
      let k = 0;
      for (const [c, r] of shuffle(cells)) {
        if (k >= n) break;
        if (put(c, r, pick(kinds))) k++;
      }
    };
    const interior = (): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) out.push([c, r]);
      return out;
    };
    /** A table run along row `r`, centred, `len` long. */
    const tableRow = (r: number, len: number): boolean => {
      if (len < 2) return put(cx, r, "table");
      const start = cx - Math.floor(len / 2);
      const run: Array<[number, number, PropKind]> = [];
      for (let k = 0; k < len; k++) {
        run.push([start + k, r, k === 0 ? "table_l" : k === len - 1 ? "table_r" : "table_m"]);
      }
      return putAll(run);
    };

    switch (role) {
      case "storeroom": {
        const n = Math.max(3, Math.round(wallCells().length * 0.35));
        scatter(["crate", "crates_stack", "barrel", "barrel_large", "barrel_small", "pots"], n, wallCells());
        break;
      }
      case "library": {
        // Reading tables in rows, lanterns in the back corners, books
        // lying about.
        const len = Math.min(5, room.w - 2);
        put(x0, y0, "lantern");
        put(x1, y0, "lantern");
        for (let r = y0 + 2; r <= y1 - 1; r += 3) tableRow(r, len);
        scatter(["book", "book_closed"], 2 + Math.floor(area / 12), interior());
        break;
      }
      case "mess_hall": {
        // Long tables with benches either side.
        const len = Math.min(5, room.w - 2);
        const start = cx - Math.floor(len / 2);
        for (let r = y0 + 1; r <= y1 - 1; r += 4) {
          if (!tableRow(r + (room.h >= 5 ? 1 : 0), len)) continue;
          const tr = r + (room.h >= 5 ? 1 : 0);
          for (let k = 0; k < len; k += 2) {
            put(start + k, tr - 1, "bench");
            put(start + k, tr + 1, "bench");
          }
        }
        scatter(["pots", "barrel_small", "trough"], 1 + Math.floor(area / 20), wallCells());
        break;
      }
      case "shrine": {
        // A statue against the back wall, braziers either side.
        if (putAll([[cx, y0, "statue_top"], [cx, y0 + 1, "statue_base"]])) {
          put(cx - 2, y0 + 1, "brazier");
          put(cx + 2, y0 + 1, "brazier");
          if (opts.style === "manor") {
            for (let r = y0 + 2; r <= y1; r++) put(cx, r, "rug_runner");
          } else {
            scatter(["bones"], 1, interior());
          }
        } else {
          put(cx, cy, "brazier");
        }
        break;
      }
      case "crypt": {
        for (let r = y0 + 1; r < y1; r += 2) {
          for (let c = x0 + 1; c < x1; c += 2) {
            if (rng() < 0.8) put(c, r, "gravestone");
          }
        }
        scatter(["bones"], 2 + Math.floor(rng() * 2), interior());
        break;
      }
      case "guard_post": {
        // A watch fire with a bench, supplies stacked by the walls.
        put(cx, cy, "brazier");
        put(cx - 1, cy + 1, "bench");
        if (area >= 30) put(cx + 1, cy - 1, "bench");
        scatter(["crate", "barrel", "barrel_small", "crates_stack"], Math.max(3, Math.round(wallCells().length * 0.2)), wallCells());
        scatter(["bones"], 1 + Math.floor(area / 30), interior());
        break;
      }
      case "vault": {
        // The chest against a wall away from the door, braziers
        // flanking it.
        const spots: Array<[number, number]> = [];
        for (const row of [y0, y1]) {
          for (let c = x0; c <= x1; c++) spots.push([c, row]);
        }
        spots.sort((a, b) => Math.abs(a[0] - cx) - Math.abs(b[0] - cx));
        const spot = spots.find(([c, r]) => free(c, r));
        if (spot) {
          const [sc, sr] = spot;
          g.tiles[sr][sc] = tiles.chest;
          delete g.decorations[key(sc, sr)];
          placed++;
          put(sc - 2, sr, "brazier");
          put(sc + 2, sr, "brazier");
        }
        scatter(["pots", "crate", "barrel_small"], 2 + Math.floor(area / 15), wallCells());
        break;
      }
      case "parlour": {
        // A rug over the middle of the room, plants in the corners and
        // an armchair at the back.
        const rx0 = x0 + 1;
        const rx1 = x1 - 1;
        const ry0 = y0 + 1;
        const ry1 = y1 - 1;
        if (rx1 - rx0 >= 1 && ry1 - ry0 >= 1) {
          const rug: Array<[number, number, PropKind]> = [];
          for (let r = ry0; r <= ry1; r++) {
            for (let c = rx0; c <= rx1; c++) {
              const top = r === ry0, bot = r === ry1, left = c === rx0, right = c === rx1;
              const kind: PropKind =
                top && left ? "rug_tl" : top && right ? "rug_tr" : bot && left ? "rug_bl" : bot && right ? "rug_br"
                  : top ? "rug_t" : bot ? "rug_b" : left ? "rug_l" : right ? "rug_r" : "rug_c";
              rug.push([c, r, kind]);
            }
          }
          // Whole rug or none — a rug with a hole reads as a bug.
          putAll(rug);
        }
        put(x0, y0, "plant");
        put(x1, y0, "plant");
        put(x0, y1, "plant");
        put(x1, y1, "plant");
        put(cx, y0, "armchair");
        break;
      }
      case "prison": {
        // The prisoner in the middle, a few bones and a slop pot.
        placePerson();
        scatter(["bones"], 1, interior());
        scatter(["pots", "barrel_small"], 1, wallCells());
        break;
      }
      case "trader_camp": {
        // The trader by a fire, goods stacked about.
        placePerson();
        put(cx + 1, cy - 1, "brazier") || put(cx - 1, cy - 1, "brazier");
        put(cx - 1, cy + 1, "table") || put(cx + 1, cy + 1, "table");
        scatter(["crate", "crates_stack", "barrel", "barrel_small", "pots"], Math.max(3, Math.round(wallCells().length * 0.2)), wallCells());
        break;
      }
      case "camp": {
        // A fire in the middle, seats and gear around it.
        if (put(cx, cy, "brazier")) {
          put(cx - 1, cy + 1, "bench");
          put(cx + 1, cy - 1, "bench");
        }
        scatter(["barrel_small", "pots", "crate"], 2, wallCells());
        scatter(["bones"], 2, interior());
        break;
      }
    }

    // A sealed vault counts even if nothing else fitted in it.
    if (placed === 0 && role !== "vault" && role !== "prison") continue;
    used.set(role, (used.get(role) ?? 0) + 1);
    result.roles.push({ room: i, role });
    for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) result.claimed.add(key(c, r));
  }
  return result;
}

/**
 * Carve a small treasure vault: a 3×3 chamber in solid rock behind a
 * one-cell doorway in a room's top or bottom wall (where the tilesets
 * draw doors). Only where the whole chamber and its surrounding ring
 * are rock, so it never breaks into another space. Tries rooms from
 * the last carved back (room 0, the entrance, is skipped). Carves the
 * chamber and the doorway as floor; returns the chamber's rectangle,
 * or null when no wall has room for one. `placeRoomRoles` (forced role
 * "vault") then locks the doorway and puts the chest in.
 */
export function carveVault(
  g: RoomsGrid,
  rooms: ReadonlyArray<RoomRect>,
  tiles: { floor: number; wall: number },
  avoid: ReadonlySet<string>,
  rng: RNG,
  /** Rows actually drawn (the grid carries a few spare rows below). */
  height: number = g.height,
): RoomRect | null {
  const rows = Math.min(height, g.height);
  const rock = (c: number, r: number) =>
    c >= 1 && r >= 1 && c < g.width - 1 && r < rows - 1 && at(g, c, r) === tiles.wall &&
    g.decorations[`${c},${r}`] === undefined;
  const spots: Array<{ door: [number, number]; vault: RoomRect }> = [];
  for (let i = rooms.length - 1; i >= 1; i--) {
    const room = rooms[i];
    for (let x = room.x + 1; x <= room.x + room.w - 2; x++) {
      // Above (door in the top wall) and below (bottom wall).
      for (const up of [true, false]) {
        const dy = up ? room.y - 1 : room.y + room.h;
        const inFront = up ? room.y : room.y + room.h - 1;
        if (at(g, x, inFront) !== tiles.floor || avoid.has(`${x},${inFront}`)) continue;
        if (!rock(x, dy) || !rock(x - 1, dy) || !rock(x + 1, dy)) continue;
        const vy = up ? dy - 3 : dy + 1;
        const vault = { x: x - 1, y: vy, w: 3, h: 3 };
        let ok = true;
        for (let r = vault.y - 1; r <= vault.y + 3 && ok; r++) {
          for (let c = vault.x - 1; c <= vault.x + 3 && ok; c++) {
            if (c === x && r === dy) continue;
            if (!rock(c, r)) ok = false;
          }
        }
        if (ok) spots.push({ door: [x, dy], vault });
      }
    }
    if (spots.length > 0) break;
  }
  if (spots.length === 0) return null;
  const { door, vault } = spots[Math.floor(rng() * spots.length)];
  for (let r = vault.y; r < vault.y + 3; r++) {
    for (let c = vault.x; c < vault.x + 3; c++) g.tiles[r][c] = tiles.floor;
  }
  g.tiles[door[1]][door[0]] = tiles.floor;
  return vault;
}
