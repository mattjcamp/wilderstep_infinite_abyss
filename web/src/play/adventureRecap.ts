/**
 * Adventure recap — the stats shown on the main-quest finale.
 *
 * Everything is DERIVED from what the save already records, so the
 * recap works for saves that predate it (no new bookkeeping):
 *
 *   - quests completed  ← `turnedInQuests`
 *   - encounters won    ← every `defeatedEncounters` set, overworld /
 *                         interior maps plus every dungeon floor, plus
 *                         destroyed monster lairs
 *   - dungeons cleared  ← `party.clearedDungeons`
 *   - places discovered ← `party.discoveredMaps`
 *   - people met        ← `party.metNpcs`
 *   - experience        ← sum of every member's `exp`
 *   - days              ← adventure day of the clock vs. the start
 *
 * Pure: no React, no Phaser. PlayHost builds it at the turn-in moment.
 */

import { adventureDay, makeClock } from "@/battle/world/GameTime";
import type { WorldSave } from "./saveTypes";

export interface RecapMember {
  id: string;
  name: string;
  level: number;
  exp: number;
  alive: boolean;
}

export interface AdventureRecap {
  questName: string;
  questsCompleted: number;
  encountersWon: number;
  dungeonsCleared: number;
  placesDiscovered: number;
  peopleMet: number;
  totalXp: number;
  gold: number;
  days: number;
  members: RecapMember[];
}

export function computeAdventureRecap(
  save: WorldSave,
  questName: string,
  characters: ReadonlyArray<{ id: string; name?: string }>,
): AdventureRecap {
  let encountersWon = 0;
  for (const m of Object.values(save.maps ?? {})) {
    encountersWon += m?.defeatedEncounters?.length ?? 0;
    encountersWon += m?.destroyedLairs?.length ?? 0;
  }
  for (const d of Object.values(save.dungeons ?? {})) {
    for (const f of d?.floors ?? []) {
      encountersWon += f?.state?.defeatedEncounters?.length ?? 0;
      encountersWon += f?.state?.destroyedLairs?.length ?? 0;
    }
  }

  const nameById = new Map(characters.map((c) => [c.id, c.name ?? c.id]));
  const memberById = new Map(save.party.members.map((m) => [m.id, m]));
  const order = save.party.roster.length
    ? save.party.roster
    : save.party.members.map((m) => m.id);
  const members: RecapMember[] = [];
  for (const id of order) {
    const m = memberById.get(id);
    if (!m) continue;
    members.push({
      id,
      name: nameById.get(id) ?? id,
      level: m.level ?? 1,
      exp: m.exp ?? 0,
      alive: m.hp > 0,
    });
  }

  const days = adventureDay(
    makeClock(save.clockMinutes ?? 0),
    makeClock(save.startClockMinutes ?? save.clockMinutes ?? 0),
  );

  return {
    questName,
    questsCompleted: new Set(save.turnedInQuests ?? []).size,
    encountersWon,
    dungeonsCleared: new Set(save.party.clearedDungeons ?? []).size,
    placesDiscovered: new Set(save.party.discoveredMaps ?? []).size,
    peopleMet: new Set(save.party.metNpcs ?? []).size,
    totalXp: members.reduce((n, m) => n + m.exp, 0),
    gold: save.party.gold ?? 0,
    days,
    members,
  };
}
