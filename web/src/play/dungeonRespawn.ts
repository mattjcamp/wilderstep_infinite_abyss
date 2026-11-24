/**
 * Dungeon respawn ("reclaimed") — lets a map re-populate the generated
 * dungeons whose entrances sit on it, some in-game days after the party
 * cleared them.
 *
 * A map opts in with `dungeon_respawn_days` (whole in-game days, ≥ 1;
 * absent / 0 = never, the original behavior). When the party clears a
 * dungeon the host stamps the game clock in
 * `party.clearedDungeonsAt[instanceId]`. The next time the party steps
 * into that entrance after the delay has passed, the old run is
 * forgotten — its saved session, its cleared mark and its timestamp —
 * so the entrance rolls a brand-new layout with fresh monsters and
 * loot, and pays its clear bonus again when beaten.
 *
 * Saves from before this feature have cleared dungeons with no
 * timestamp; the host stamps "now" the first time it notices one, so
 * the countdown starts then rather than respawning on the spot.
 *
 * Pure — PlayHost owns the save write and the session store.
 */

import { MINUTES_PER_DAY } from "@/battle/world/GameTime";
import type { WorldSave } from "./saveTypes";

/** The map's respawn delay in whole days, or undefined when off. */
export function respawnDays(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const d = Math.floor(raw);
  return d >= 1 ? d : undefined;
}

export type RespawnStatus =
  /** Not cleared — nothing to do. */
  | { kind: "not-cleared" }
  /** Cleared, and this map never respawns (or the clock hasn't run out). */
  | { kind: "cleared"; readyAtMinutes?: number }
  /** Cleared on an old save with no timestamp — stamp `now`. */
  | { kind: "needs-stamp" }
  /** Cleared long enough ago — monsters have moved back in. */
  | { kind: "reclaimed" };

export function dungeonRespawnStatus(args: {
  save: Pick<WorldSave, "party">;
  instanceId: string;
  /** The entrance map's `dungeon_respawn_days` (raw). */
  mapRespawnDays: unknown;
  nowMinutes: number;
}): RespawnStatus {
  const { save, instanceId, nowMinutes } = args;
  if (!(save.party.clearedDungeons ?? []).includes(instanceId)) {
    return { kind: "not-cleared" };
  }
  const days = respawnDays(args.mapRespawnDays);
  const at = save.party.clearedDungeonsAt?.[instanceId];
  if (days === undefined) return { kind: "cleared" };
  if (typeof at !== "number" || !Number.isFinite(at)) return { kind: "needs-stamp" };
  const readyAt = at + days * MINUTES_PER_DAY;
  return nowMinutes >= readyAt
    ? { kind: "reclaimed" }
    : { kind: "cleared", readyAtMinutes: readyAt };
}

/** Record when a dungeon was cleared (game-clock minutes). */
export function stampDungeonCleared(
  save: WorldSave,
  instanceId: string,
  nowMinutes: number,
): WorldSave {
  return {
    ...save,
    party: {
      ...save.party,
      clearedDungeonsAt: {
        ...(save.party.clearedDungeonsAt ?? {}),
        [instanceId]: nowMinutes,
      },
    },
  };
}

/** Forget a cleared run so the entrance rolls a fresh dungeon: drops
 *  the saved session, the cleared mark and the cleared timestamp. */
export function reclaimDungeon(save: WorldSave, instanceId: string): WorldSave {
  const dungeons = { ...save.dungeons };
  delete dungeons[instanceId];
  const at = { ...(save.party.clearedDungeonsAt ?? {}) };
  delete at[instanceId];
  return {
    ...save,
    dungeons,
    party: {
      ...save.party,
      clearedDungeons: (save.party.clearedDungeons ?? []).filter((id) => id !== instanceId),
      clearedDungeonsAt: at,
    },
  };
}
