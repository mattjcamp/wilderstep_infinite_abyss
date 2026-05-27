/**
 * Authored-encounter helpers shared between the town/interior code path
 * and CombatScene's defeat tracker.
 *
 * Historical note: this module also used to host
 * `placeQuestInteriorMonsters` / `placeQuestInteriorItems` and their
 * supporting input types — the entrypoints the v1 town spawn pass used
 * to satisfy quest kill/collect steps. Both were dead exports (their
 * call site was `TownScene`, which the v2 codebase no longer mounts)
 * and they were the only remaining readers of v1 QuestStep fields like
 * `collectItem` / `spawnCol` / `spawnRow`. Removed in the same cleanup
 * pass that dropped the v1 quest compat surface from `Quests.ts`.
 *
 * What survives here is the small set of helpers `CombatScene` actually
 * still imports: the authored-encounter id / defeat-key plumbing plus
 * the `appendAuthoredEncounters` placement routine kept around for the
 * imminent town-mode revival. `tileMapWalk` + `snapToWalkable` are also
 * preserved because they're the natural extension points if/when the
 * encounter list ever grows back into a per-cell spawn pass.
 */
import type { TileMap } from "./TileMap";
import type { EncounterTemplate } from "./Encounters";
import { rosterFor } from "./Quests";
import type { AuthoredEncounter } from "./Towns";
import type { InteriorMonster } from "../state";

/** Walkability + per-cell occupancy oracle. We don't take a TileMap
 *  directly because tests want to drive specific layouts without
 *  setting up the full tile_defs catalog. */
export interface WalkOracle {
  width: number;
  height: number;
  isWalkable(col: number, row: number): boolean;
}

/**
 * Stable id stamped onto an authored-encounter InteriorMonster. Format
 * is `auth-<spaceName>-<col>-<row>-<encName>` — encodes everything we
 * need to recognise the same encounter across re-entries without
 * keying on the InteriorMonster object itself. Exported so the defeat-
 * tracker in CombatScene can compose the same key without duplicating
 * the format string.
 */
export function authoredEncounterId(
  spaceName: string,
  enc: { col: number; row: number; name: string },
): string {
  return `auth-${spaceName}-${enc.col}-${enc.row}-${enc.name}`;
}

/**
 * Global (across-floors) defeat key for an authored encounter. We
 * prefix with the interior path so two buildings that happen to share
 * a space name (e.g. two modules both authoring a "Citadel 4") don't
 * cross-talk. Mirrors the `${path}|${authId}` shape `gameState
 * .defeatedAuthoredEncounters` uses.
 */
export function authoredDefeatKey(
  interiorPath: string,
  authId: string,
): string {
  return `${interiorPath}|${authId}`;
}

/**
 * Append every `town.encounters` entry (combat-typed only) onto the
 * placed-monster list, skipping any already on the floor (by stable
 * id) and any whose defeat was previously persisted. Returns a new
 * array; the input is left untouched.
 *
 * Two fixes ride on this helper:
 *
 *   - Floors with no active quest step now still get their authored
 *     encounters spawned. The previous "early return when nothing
 *     active to spawn" branch in TownScene meant that on the Sea
 *     Shrine's Main Hall / Citadel 2 / Citadel 3 (none of which host
 *     a Sun Sword quest row) the authored Dark Patrol / Troll &
 *     Wolves / Lone Ogre etc. encounters were silently dropped on
 *     entry, even though the module data listed them.
 *
 *   - Authored encounters defeated in a previous visit stay defeated.
 *     Before, the CombatScene-side filter only stripped the slain
 *     entry from `interiorMonsters`; the next time the player walked
 *     onto that floor `appendAuthoredEncounters` saw the missing id
 *     in `knownIds` and re-spawned it, producing the "this fight
 *     keeps coming back no matter how many times I beat it"
 *     player report on Citadel 4's Troll Den.
 */
export function appendAuthoredEncounters(
  placed: ReadonlyArray<InteriorMonster>,
  encounters: ReadonlyArray<AuthoredEncounter>,
  encounterTable: Record<string, EncounterTemplate[]>,
  opts: {
    /** Display / catalog name of the current space — used as part of
     *  the stable auth id. */
    spaceName: string;
    /** Per-run defeat memory. Authored encounters whose key is in this
     *  set are skipped entirely on this entry. */
    defeated: ReadonlySet<string>;
    /** Interior path used by `defeatedAuthoredEncounters` to disambiguate
     *  same-named spaces across buildings. Combined with the auth id
     *  to form the lookup key. */
    interiorPath: string;
  },
): InteriorMonster[] {
  const list: InteriorMonster[] = [...placed];
  const knownIds = new Set(list.map((m) => m.id));
  for (const enc of encounters) {
    if (enc.encounterType !== "combat") continue;
    const id = authoredEncounterId(opts.spaceName, enc);
    if (knownIds.has(id)) continue;
    if (opts.defeated.has(authoredDefeatKey(opts.interiorPath, id))) continue;
    const tmpl = rosterFor(encounterTable, enc.name);
    if (!tmpl || tmpl.monsters.length === 0) continue;
    list.push({
      id,
      col: enc.col,
      row: enc.row,
      name: tmpl.monsterPartyTile,
      encounterNames: [...tmpl.monsters],
      encounterName: tmpl.name,
      // Sentinel quest metadata: the cleanup-on-quest-complete pass
      // skips entries whose `questName` isn't in moduleQuestStates,
      // so authored encounters survive correctly until killed.
      questName: "__authored",
      stepIdx: -1,
    });
    knownIds.add(id);
  }
  return list;
}

/**
 * True when the given InteriorMonster id is the stable id stamped by
 * `appendAuthoredEncounters`. CombatScene uses this to decide whether
 * a victory should record an authored-encounter defeat in
 * `gameState.defeatedAuthoredEncounters`.
 */
export function isAuthoredEncounterId(id: string): boolean {
  return id.startsWith("auth-");
}

/**
 * Build a `WalkOracle` from a TileMap. Trivial wrapper, kept here so
 * TownScene doesn't have to know about the oracle shape.
 */
export function tileMapWalk(tileMap: TileMap): WalkOracle {
  return {
    width: tileMap.width,
    height: tileMap.height,
    isWalkable: (c, r) => tileMap.isWalkable(c, r),
  };
}

/**
 * If `(col, row)` is walkable (and reachable from `reachable`, when
 * provided), return it as-is. Otherwise spiral outward looking for the
 * nearest walkable cell that satisfies the same constraints, returning
 * the first hit. Returns the original coords as a last-resort fallback
 * — the caller can decide whether to render anyway.
 *
 * Used to fix authoring mistakes where an NPC / quest-giver position
 * lands on a wall or water tile (Calla in Shanty Town, Laird Marrowen
 * in the Seat of the Realm). Without this, the player would see a
 * bandit standing on a brick wall — and couldn't talk to them because
 * the bump-to-converse flow needs an adjacent walkable cell to end up
 * on.
 *
 * Search radius caps at `maxRadius` so a giver in a sealed-off region
 * doesn't trigger a whole-map scan; defaults to a conservative 8 tiles
 * which is plenty for "the author was off by one".
 */
export function snapToWalkable(
  walk: WalkOracle,
  col: number,
  row: number,
  opts: {
    reachable?: Set<string> | null;
    maxRadius?: number;
    /** Cells to treat as occupied — e.g. other NPCs already placed.
     *  Skipping them prevents two snapped NPCs from sharing a tile. */
    occupied?: Iterable<readonly [number, number]>;
  } = {},
): { col: number; row: number } {
  const reach = opts.reachable ?? null;
  const occupied = new Set<string>();
  for (const [c, r] of opts.occupied ?? []) occupied.add(`${c},${r}`);
  const acceptable = (c: number, r: number): boolean => {
    if (c < 0 || c >= walk.width || r < 0 || r >= walk.height) return false;
    if (!walk.isWalkable(c, r)) return false;
    if (reach && !reach.has(`${c},${r}`)) return false;
    if (occupied.has(`${c},${r}`)) return false;
    return true;
  };
  if (acceptable(col, row)) return { col, row };
  const maxR = opts.maxRadius ?? 8;
  for (let r = 1; r <= maxR; r++) {
    // Walk the ring at Chebyshev distance r and pick the first hit.
    // Ring iteration mirrors the Python game's nearest-empty search
    // in `_find_quest_dungeon_location`.
    for (let dc = -r; dc <= r; dc++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (acceptable(nc, nr)) return { col: nc, row: nr };
      }
    }
  }
  return { col, row };
}
