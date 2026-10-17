/**
 * Exploration XP — small one-time rewards for discovering a map and
 * for talking to a person for the first time.
 *
 * Amounts come from the module manifest, resolved up the extends chain:
 *
 *   "settings": { "exploration_xp": { "map": 10, "npc": 5 } }
 *
 * Either key may be omitted (→ {@link DEFAULT_EXPLORATION_XP}). Each map
 * and each NPC record may also carry its own `exploration_xp` number
 * that overrides the module amount for that one place / person — `0`
 * turns the reward off (e.g. a basement or a farmable spot), a bigger
 * number makes a hidden shrine or a key character worth more.
 *
 * Every living party member gets the full amount (same rule as combat
 * and quest XP). Which maps / people have already paid out is kept on
 * the save (`party.discoveredMaps`, `party.metNpcs`) so each pays once
 * per playthrough.
 *
 * This file is pure — PlayHost owns the save writes, XP application
 * (`awardQuestXpWithLevelUps`) and the log line.
 */

export interface ExplorationXpSettings {
  /** XP for entering a map for the first time. */
  map: number;
  /** XP for talking to a person (NPC or quest giver) for the first time. */
  npc: number;
}

/** Engine defaults — deliberately small. For scale: one goblin is
 *  worth 10 XP and level 2 costs 1,500 XP (1,125 for Fast Learners),
 *  so a full town crawl (~30 maps, ~15 people ≈ 375 XP) comes to about
 *  a quarter of a level. */
export const DEFAULT_EXPLORATION_XP: ExplorationXpSettings = {
  map: 10,
  npc: 5,
};

function cleanAmount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : undefined;
}

/** Pull `{ map?, npc? }` out of a raw manifest `settings.exploration_xp`
 *  blob. Junk / negative values are dropped. Returns `undefined` when
 *  nothing valid remains. */
export function sanitizeExplorationXp(
  raw: unknown,
): Partial<ExplorationXpSettings> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: Partial<ExplorationXpSettings> = {};
  const map = cleanAmount(src.map);
  const npc = cleanAmount(src.npc);
  if (map !== undefined) out.map = map;
  if (npc !== undefined) out.npc = npc;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Fill any missing amount from the engine defaults. */
export function withExplorationDefaults(
  partial: Partial<ExplorationXpSettings> | null | undefined,
): ExplorationXpSettings {
  return {
    map: partial?.map ?? DEFAULT_EXPLORATION_XP.map,
    npc: partial?.npc ?? DEFAULT_EXPLORATION_XP.npc,
  };
}

/** The reward for one map / person: its own `exploration_xp` when it
 *  sets a valid one (0 = off), else the module amount. */
export function explorationRewardFor(
  recordOverride: unknown,
  moduleAmount: number,
): number {
  return cleanAmount(recordOverride) ?? Math.max(0, Math.floor(moduleAmount));
}

/** Save-list key for a person. NPCs use their record id; quest givers
 *  (which have no NPC record) are keyed by quest. */
export function npcMeetKey(npcId: string): string {
  return `npc:${npcId}`;
}
export function questGiverMeetKey(questId: string): string {
  return `quest:${questId}`;
}

/**
 * Starting list of discovered maps for a save that doesn't have one
 * yet — a brand-new game, or a save from before this feature. Counts
 * the map the party is standing on plus every map the save already has
 * state for, so neither the starting map nor any previously-visited
 * map pays out retroactively.
 */
export function seedDiscoveredMaps(
  currentMapId: string,
  savedMapIds: Iterable<string>,
): string[] {
  const out = new Set<string>(savedMapIds);
  if (currentMapId) out.add(currentMapId);
  return [...out];
}

/** Record `key` in `list` if it isn't there yet. `firstTime` is true
 *  only when it was newly added. Pure — returns a fresh array. */
export function markFirstTime(
  list: ReadonlyArray<string> | undefined,
  key: string,
): { firstTime: boolean; next: string[] } {
  const prev = list ?? [];
  if (prev.includes(key)) return { firstTime: false, next: [...prev] };
  return { firstTime: true, next: [...prev, key] };
}
