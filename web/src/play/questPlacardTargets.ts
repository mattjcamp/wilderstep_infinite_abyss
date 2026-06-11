/**
 * Quest-relevance lookup for the place placard (LinkPlacard).
 *
 * When the party steps onto a flagged link tile or dungeon entrance,
 * the placard names the destination. This helper answers the follow-up
 * question the player actually has: "is this where one of my quests
 * wants me to go?" — by scanning every ACTIVE quest for an incomplete
 * step that targets the destination.
 *
 * Matching rules:
 *   - Link placards match steps whose structured `mapId` equals the
 *     destination map id (kill / retrieve / discover steps authored
 *     with `location_kind: "map"`, and any step that carries a map_id).
 *   - Dungeon placards match steps whose `dungeonId` equals the
 *     destination dungeon id (reach / spelunking steps, dungeon kill
 *     steps). The floor (`dungeonLevel`) is deliberately ignored —
 *     from the entrance, ANY floor objective makes the dungeon
 *     quest-relevant.
 *   - Only the FIRST incomplete matching step per quest is reported:
 *     steps are linear, so that's the next thing the player will do
 *     there. One line per quest keeps the placard compact even when a
 *     quest has five steps on the same map.
 *
 * Pure function over the already-parsed defs + runtime states — no
 * fetches, no save access — so both the play host and the editor's
 * sim mode can call it, and it unit-tests without a DOM.
 */

import type { QuestDef, QuestState } from "@/battle/world/Quests";

/** One placard line: "⚜ <questName> — <stepName>". Ids carried for
 *  keys / future deep-linking into the quest log. */
export interface QuestPlacardTarget {
  questId: string;
  questName: string;
  stepId: string;
  stepName: string;
}

/** The destination the placard is being shown for. */
export type PlacardPlace =
  | { placeKind: "link"; mapId: string }
  | { placeKind: "dungeon"; dungeonId: string };

export function questsTargetingPlace(
  defs: ReadonlyArray<QuestDef>,
  states: ReadonlyMap<string, QuestState>,
  place: PlacardPlace,
): QuestPlacardTarget[] {
  const out: QuestPlacardTarget[] = [];
  for (const def of defs) {
    const st = states.get(def.id);
    if (!st || st.status !== "active") continue;
    for (let i = 0; i < def.steps.length; i++) {
      if (st.stepProgress[i]) continue; // step already done
      const step = def.steps[i];
      const matches =
        place.placeKind === "link"
          ? step.mapId !== "" && step.mapId === place.mapId
          : step.dungeonId !== "" && step.dungeonId === place.dungeonId;
      if (matches) {
        out.push({
          questId: def.id,
          questName: def.name,
          stepId: step.id,
          stepName: step.name,
        });
        break; // one line per quest — the next objective there
      }
    }
  }
  return out;
}
