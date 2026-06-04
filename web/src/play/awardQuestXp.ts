/**
 * Quest XP banking — pure helper.
 *
 * Quest turn-in awards XP. Combat's reward path (`awardXp` in
 * battle/world/Leveling.ts) needs the full class template + race
 * info + spells catalog to run its level-up math; PlayHost doesn't
 * load those eagerly (they live behind the v1battle loaders and are
 * only primed when `seedBattleCaches` runs on combat entry), so
 * mirroring the same call chain here would mean threading several
 * extra catalogs through to satisfy a non-combat reward.
 *
 * Instead, this helper banks the quest XP directly into the saved
 * `exp` field on each alive party member. The persisted value flows
 * back into the kernel the next time combat starts — `seedBattleCaches`
 * overlays the save's `exp` / `level` onto the raw character before
 * `memberFromRaw`, so the in-combat `awardXp` pass sees the banked
 * XP. Its threshold loop (cumulative exp vs. the rising-increment
 * curve — see Leveling.ts `xpTotalForLevel`) then catches up every
 * pending threshold in one go — i.e. the first
 * combat after a streak of XP-only quests fires all the deferred
 * level-up events at once.
 *
 * Tradeoffs of this design:
 *   - Level-up placards don't fire at quest-turn-in time. The Party
 *     screen will briefly show a member's `XP / xpNext` bar above
 *     100% between the turn-in and their next combat — a visible
 *     "you have a level pending" cue that we deemed acceptable.
 *   - Pure-quest playthroughs (no combat ever) never trigger
 *     level-ups. The XP keeps accruing on the save and stays
 *     visible, but the member's `level` stays put. Same
 *     limitation the legacy combat-only path had; quest XP
 *     visibility was the immediate gap we're closing.
 *
 * XP distribution matches the combat reward semantics: every alive
 * member gets the FULL quest XP value, not a per-member split. The
 * dead don't get to brag.
 */

import type { SavedCharacterState } from "./saveTypes";

export interface AwardQuestXpResult {
  /** Per-member result rows in input order. `nextMembers[i]` is the
   *  updated record for `members[i]` — never the same object reference
   *  even when no change applies, so callers can pass it straight
   *  into the next save commit. */
  nextMembers: SavedCharacterState[];
  /** True iff at least one member's `exp` actually changed. Callers
   *  use this to decide whether to commit a save (skipping the
   *  write when no XP was banked — e.g. a 0-XP quest or a wiped
   *  party). */
  changed: boolean;
}

/**
 * Bank `xpPerMember` XP into every alive member's `exp`, leaving
 * fallen members (hp <= 0) untouched. Returns the next members[]
 * + a `changed` flag so callers can short-circuit a no-op save
 * commit.
 *
 * Pure: input is not mutated; every returned member is a fresh
 * object whose `exp` field is incremented from the saved baseline
 * (defaulting absent `exp` to 0). `level` is intentionally NOT
 * touched here — see the module doc for why the level-up math
 * defers to the next combat.
 *
 * `xpPerMember <= 0` short-circuits to `{ nextMembers: members
 * spread, changed: false }`. The XP-zero case is common (a
 * "talk-only" quest with no reward bundle declared) and shouldn't
 * burn a save commit.
 */
export function awardQuestXpToSavedMembers(
  members: ReadonlyArray<SavedCharacterState>,
  xpPerMember: number,
): AwardQuestXpResult {
  if (!Number.isFinite(xpPerMember) || xpPerMember <= 0) {
    return { nextMembers: members.map((m) => ({ ...m })), changed: false };
  }
  let changed = false;
  const nextMembers = members.map((m) => {
    // Dead members don't bank XP — matches the combat path's
    // "alive only" gate.
    if (m.hp <= 0) return { ...m };
    changed = true;
    const baseline = typeof m.exp === "number" ? m.exp : 0;
    return { ...m, exp: baseline + xpPerMember };
  });
  return { nextMembers, changed };
}
