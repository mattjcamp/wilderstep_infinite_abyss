/**
 * Encounter-screen choices — pure helpers behind the Fight / Run /
 * Talk prompt the play host shows on `spawn_encountered`.
 *
 *   - `summarizeRoster` groups the roster by monster id (portrait,
 *     name, count, authored description) for display.
 *   - Run: a D&D-style group Dexterity saving throw. Every alive
 *     member rolls d20 + DEX mod against
 *     DC = 10 + the fastest enemy's DEX mod (never below 10).
 *     The party escapes when at least half the rollers pass. Walking
 *     away from a lair the party approached itself needs no roll.
 *   - Talk: humanoid-only (every monster in the roster must be
 *     humanoid). A small flat chance nudged by the party's best
 *     INT/WIS modifier, clamped to 5–25%, minus 5 points at a lair.
 *
 * Rng-injectable for tests (returns [0, 1) like Math.random).
 */

import type { SimMonsterRef } from "@/sim/types";

export type Rng = () => number;

export interface RosterEntry {
  id: string;
  name: string;
  sprite?: string;
  description?: string;
  count: number;
  humanoid: boolean;
  dexterity: number;
}

/** One alive party member as the rollers see them. */
export interface EncounterRoller {
  name: string;
  dexterity?: number;
  intelligence?: number;
  wisdom?: number;
}

export interface MemberRunRoll {
  name: string;
  roll: number;
  mod: number;
  total: number;
  success: boolean;
}

export interface RunResult {
  success: boolean;
  dc: number;
  /** Empty when no roll was needed (withdrawing from a lair). */
  rolls: MemberRunRoll[];
  passed: number;
  needed: number;
  message: string;
}

export interface TalkResult {
  success: boolean;
  /** Chance that was rolled against, 0–1. */
  chance: number;
  /** Whose words carried the parley (best INT/WIS). */
  speaker: string;
  message: string;
}

export type EncounterKind = "boss" | "roamer" | "placed";

export const abilityMod = (score: number | undefined): number =>
  Math.floor(((typeof score === "number" ? score : 10) - 10) / 2);

const d20 = (rng: Rng) => Math.floor(rng() * 20) + 1;

export function summarizeRoster(
  monsterIds: ReadonlyArray<string>,
  catalog: ReadonlyArray<SimMonsterRef>,
): RosterEntry[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const out: RosterEntry[] = [];
  const idx = new Map<string, number>();
  for (const id of monsterIds) {
    const at = idx.get(id);
    if (at !== undefined) {
      out[at].count += 1;
      continue;
    }
    const m = byId.get(id);
    idx.set(id, out.length);
    out.push({
      id,
      name: m?.name ?? id,
      sprite: m?.sprite,
      description:
        typeof m?.description === "string" && m.description.trim()
          ? m.description.trim()
          : undefined,
      count: 1,
      humanoid: !!m?.humanoid,
      dexterity: typeof m?.dexterity === "number" ? m.dexterity : 10,
    });
  }
  return out;
}

/** Talk is only on the table when every foe can be reasoned with. */
export function canTalk(roster: ReadonlyArray<RosterEntry>): boolean {
  return roster.length > 0 && roster.every((r) => r.humanoid);
}

export function runDc(roster: ReadonlyArray<RosterEntry>): number {
  const best = roster.reduce((m, r) => Math.max(m, abilityMod(r.dexterity)), 0);
  return 10 + best;
}

export function rollRun(
  members: ReadonlyArray<EncounterRoller>,
  roster: ReadonlyArray<RosterEntry>,
  kind: EncounterKind,
  rng: Rng = Math.random,
): RunResult {
  const dc = runDc(roster);
  if (kind === "boss") {
    return {
      success: true,
      dc,
      rolls: [],
      passed: 0,
      needed: 0,
      message: "The party backs away from the lair.",
    };
  }
  const rolls = members.map((m) => {
    const roll = d20(rng);
    const mod = abilityMod(m.dexterity);
    const total = roll + mod;
    // Natural 20 always passes, natural 1 always fails.
    const success = roll === 20 || (roll !== 1 && total >= dc);
    return { name: m.name, roll, mod, total, success };
  });
  const passed = rolls.filter((r) => r.success).length;
  const needed = Math.ceil(rolls.length / 2);
  const success = rolls.length > 0 && passed >= needed;
  return {
    success,
    dc,
    rolls,
    passed,
    needed,
    message: success
      ? "The party slips away!"
      : "The party fails to escape — the enemy closes in!",
  };
}

export function talkChance(
  members: ReadonlyArray<EncounterRoller>,
  kind: EncounterKind,
): { chance: number; speaker: string } {
  let speaker = members[0]?.name ?? "The party";
  let bestMod = -Infinity;
  for (const m of members) {
    const mod = Math.max(abilityMod(m.intelligence), abilityMod(m.wisdom));
    if (mod > bestMod) {
      bestMod = mod;
      speaker = m.name;
    }
  }
  if (!Number.isFinite(bestMod)) bestMod = 0;
  let chance = 0.1 + 0.03 * bestMod;
  if (kind === "boss") chance -= 0.05;
  chance = Math.min(0.25, Math.max(0.05, chance));
  return { chance, speaker };
}

export function rollTalk(
  members: ReadonlyArray<EncounterRoller>,
  roster: ReadonlyArray<RosterEntry>,
  kind: EncounterKind,
  rng: Rng = Math.random,
): TalkResult {
  const { chance, speaker } = talkChance(members, kind);
  if (!canTalk(roster)) {
    return {
      success: false,
      chance: 0,
      speaker,
      message: "These creatures can't be reasoned with.",
    };
  }
  const success = rng() < chance;
  return {
    success,
    chance,
    speaker,
    message: success
      ? `${speaker} talks the party out of trouble. The foes let you pass.`
      : `${speaker}'s words fall flat. Steel is drawn!`,
  };
}
