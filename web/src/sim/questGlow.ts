/**
 * Quest-relevance glow computation — pure, no Phaser, no DOM.
 *
 * Returns the set of `"col,row"` cell keys that should carry a soft
 * golden halo on the map: quest-giver cells, kill-step encounter
 * cells, fetch-step item cells. Used by both the editor (which paints
 * the halo into its Phaser scene) and the play runtime (same idea,
 * different renderer).
 *
 * The editor passes no status filter so authors see every quest's
 * relevant cells at all times — that's the "what's authored where"
 * view. The play runtime passes `acceptedQuests` so kill-step targets
 * and fetch-step items only glow once the player has actually accepted
 * the quest. Quest givers always glow regardless of status: they're
 * the breadcrumb that draws the player TO the quest in the first place,
 * so suppressing them until accepted would defeat the purpose.
 */

/** Minimal cell shape consumed by the glow computation. The wider
 *  TileType / DungeonMapCell records both satisfy this. */
export interface QuestGlowCell {
  quest?: string;
  encounter?: string;
  item?: string;
}

/** Minimal quest shape — id plus a steps array with `kind` plus the
 *  per-kind target fields (kill: `encounter_id`, fetch: `item_id`).
 *  Mirrors what both the editor's QuestRecord and the play-runtime
 *  quest definitions carry. `params` is a legacy nesting that older
 *  on-disk data may still use; the resolver below reads it as a
 *  fallback so a module that hasn't been re-saved through the new
 *  editor still glows correctly. */
export interface QuestGlowQuest {
  id: string;
  steps?: ReadonlyArray<{
    kind?: string;
    encounter_id?: string;
    item_id?: string;
    /** @deprecated Read fallback for legacy quests.json data. */
    params?: Record<string, unknown> | null;
  }>;
}

export interface QuestGlowOptions {
  /** When supplied, only kill-step encounters and fetch-step items
   *  belonging to one of these quest ids will glow. Quest givers
   *  glow regardless (see module doc). Omit to glow every relevant
   *  cell unconditionally — the editor's authoring view. */
  acceptedQuests?: ReadonlySet<string>;
}

/**
 * Compute the cells that should be lit by the quest-relevance halo.
 *
 * A cell glows when ANY of the following is true:
 *
 *   - it has a non-empty `quest` field (quest giver sits here).
 *     Always lit.
 *   - it has an `encounter` named by a `kill`-step's `encounter_id`,
 *     AND (if `acceptedQuests` is supplied) the quest is accepted.
 *   - it has an `item` named by a `retrieve`-step's `item_id` or a
 *     legacy `fetch`-step's `item_id`, AND (if `acceptedQuests` is
 *     supplied) the quest is accepted.
 *
 * `visit` and `talk` steps don't drive glow today — they refer to
 * coordinates / NPCs the engine surfaces differently.
 */
export function computeQuestGlowCells(
  grid: ReadonlyArray<ReadonlyArray<QuestGlowCell | null | undefined>>,
  quests: ReadonlyArray<QuestGlowQuest>,
  opts: QuestGlowOptions = {},
): Set<string> {
  // Build per-quest-status maps: encounter id → set of quest ids that
  // want it, same for items. When the play runtime supplies an
  // acceptedQuests filter we use these maps to gate per-cell.
  const encounterToQuests = new Map<string, Set<string>>();
  const itemToQuests = new Map<string, Set<string>>();
  for (const q of quests) {
    for (const s of q.steps ?? []) {
      // First-class field first; fall back to params.* for legacy
      // pre-cleanup data that still nests these inside `params`.
      const params = (s.params ?? {}) as Record<string, unknown>;
      if (s.kind === "kill") {
        const eid =
          s.encounter_id ??
          (typeof params.encounter_id === "string"
            ? params.encounter_id
            : undefined);
        if (typeof eid === "string" && eid) {
          (encounterToQuests.get(eid) ?? encounterToQuests.set(eid, new Set()).get(eid)!).add(q.id);
        }
      } else if (s.kind === "fetch" || s.kind === "retrieve") {
        // `retrieve` is the current shape (item_id is first-class);
        // `fetch` is the legacy kind name some pre-cleanup data may
        // still carry. Both point at the cell that ends up holding
        // the named item, so they share a glow rule.
        const iid =
          s.item_id ??
          (typeof params.item_id === "string"
            ? params.item_id
            : undefined);
        if (typeof iid === "string" && iid) {
          (itemToQuests.get(iid) ?? itemToQuests.set(iid, new Set()).get(iid)!).add(q.id);
        }
      }
    }
  }

  const filter = opts.acceptedQuests;
  // Helper: when filter is undefined the glow is unconditional. When
  // filter is supplied, at least one of the candidate quest ids must
  // be accepted.
  const anyAccepted = (questIds: ReadonlySet<string>): boolean => {
    if (!filter) return true;
    for (const id of questIds) {
      if (filter.has(id)) return true;
    }
    return false;
  };

  const glow = new Set<string>();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      // Quest givers — always glow.
      if (cell.quest) {
        glow.add(`${c},${r}`);
        continue;
      }
      const enc = cell.encounter;
      if (enc) {
        const qs = encounterToQuests.get(enc);
        if (qs && anyAccepted(qs)) {
          glow.add(`${c},${r}`);
          continue;
        }
      }
      const it = cell.item;
      if (it) {
        const qs = itemToQuests.get(it);
        if (qs && anyAccepted(qs)) {
          glow.add(`${c},${r}`);
        }
      }
    }
  }
  return glow;
}

/** Visual constants shared between the editor halo and the play-time
 *  halo. Centralised so re-tuning the look only needs one edit. */
export const QUEST_GLOW = {
  /** Soft gold — bright enough to read at full ambient, muted enough
   *  to feel "glow" rather than "spotlight". */
  baseColor: { r: 0xff, g: 0xd7, b: 0x50 },
  /** Alpha at full ambient. Multiplied by per-cell brightness in
   *  practice so dim cells get a dim halo. */
  alpha: 0.22,
  /** Halo radius as a fraction of TILE_SIZE — slightly wider than
   *  the cell so the halo bleeds past sprite edges. */
  radiusFactor: 0.72,
} as const;
