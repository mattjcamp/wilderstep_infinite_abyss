/**
 * "Dungeon cleared" — the one-time XP bonus for wiping out a generated
 * dungeon (dungeons.json).
 *
 * Cleared means every hostile on every floor has been defeated: each
 * floor's placed monsters (the generator's random encounters plus any
 * quest monsters still on the floor) must all be in that floor's
 * `defeatedEncounters` set ("col,row" of the cell the monster was
 * placed on — the same key the kernel records on victory). Generated
 * dungeons have no monster lairs (spawns), so monsters are the whole
 * count. A dungeon with no monsters at all never "clears" — there was
 * nothing to fight. Floors the party hasn't reached have no defeated
 * set yet, so their monsters count as still standing.
 *
 * Pure — PlayHost owns the save write, the XP award, log line and the
 * celebration placard.
 */

export interface ClearMonster {
  col: number;
  row: number;
  /** Monsters with no roster are scenery to the kernel (no encounter
   *  is stamped on their cell), so they don't count. */
  encounterNames: ReadonlyArray<string>;
}

export interface ClearProgress {
  total: number;
  defeated: number;
}

export function dungeonClearProgress(
  levels: ReadonlyArray<{ monsters: ReadonlyArray<ClearMonster> }>,
  defeatedByFloor: (floorIdx: number) => ReadonlySet<string> | undefined,
): ClearProgress {
  let total = 0;
  let defeated = 0;
  levels.forEach((lvl, floorIdx) => {
    const done = defeatedByFloor(floorIdx);
    for (const m of lvl.monsters) {
      if (m.encounterNames.length === 0) continue;
      total++;
      if (done?.has(`${m.col},${m.row}`)) defeated++;
    }
  });
  return { total, defeated };
}

export function isDungeonCleared(p: ClearProgress): boolean {
  return p.total > 0 && p.defeated >= p.total;
}

/** The reward for one dungeon: its own `clear_xp` when valid (0 =
 *  off), else the module amount. */
export function dungeonClearXp(recordOverride: unknown, moduleAmount: number): number {
  if (
    typeof recordOverride === "number" &&
    Number.isFinite(recordOverride) &&
    recordOverride >= 0
  ) {
    return Math.floor(recordOverride);
  }
  return Math.max(0, Math.floor(moduleAmount));
}
