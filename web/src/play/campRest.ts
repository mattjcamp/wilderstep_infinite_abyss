/**
 * Camping Supplies "rest" logic — shared by both stash and personal-
 * inventory Use paths in PlayPartyScreenOverlay so they can't drift
 * out of sync.
 *
 * The rules (driven by user spec):
 *   - Every conscious roster member (hp > 0) is restored to their
 *     peak HP and peak MP.
 *   - Fallen members (hp <= 0) stay down — raising the dead is a
 *     separate, more expensive temple service.
 *   - If nobody needs rest (everyone already at full HP + MP, or all
 *     fallen) the supply is NOT consumed and the caller is told so
 *     it can surface "already fully rested" and skip the stack
 *     decrement.
 *
 * Peak resolution: we prefer the on-save `max_hp` / `max_mp` (back-
 * filled at PlayHost load) and only fall back to the caller-supplied
 * map for legacy members that somehow lack those fields. That keeps
 * the rest reliable even for custom characters that aren't in
 * characters.json.
 */
import type { SavedCharacterState } from "./saveTypes";

export interface CampRestResult {
  /** New members array — same reference as input if no member was
   *  actually changed (handy for memoised React state). */
  nextMembers: ReadonlyArray<SavedCharacterState>;
  /** True when at least one member was healed (HP or MP rose, or a
   *  member's max_hp / max_mp was back-filled mid-rest). Drives
   *  whether the caller consumes a charge + fires the VFX/SFX. */
  applied: boolean;
}

/**
 * Apply a camp rest to `members`. `maxHpFor` / `maxMpFor` are
 * fallback lookups for members that don't carry their own
 * `max_hp` / `max_mp` on the save record.
 */
export function applyCampRest(
  members: ReadonlyArray<SavedCharacterState>,
  maxHpFor: (id: string) => number | undefined,
  maxMpFor: (id: string) => number | undefined,
): CampRestResult {
  let applied = false;
  const nextMembers = members.map((m) => {
    if (m.hp <= 0) return m;
    // Peak source priority: saved max_hp/max_mp first, then the
    // catalog-derived fallback. Either may be undefined for a brand-
    // new save before the PlayHost load back-fill has run.
    const peakHp =
      (typeof m.max_hp === "number" ? m.max_hp : undefined) ?? maxHpFor(m.id);
    const peakMp =
      (typeof m.max_mp === "number" ? m.max_mp : undefined) ?? maxMpFor(m.id);
    const nextHp = typeof peakHp === "number" ? peakHp : m.hp;
    const nextMp = typeof peakMp === "number" ? peakMp : m.mp;
    // Stamp the resolved peak back onto the member so the next read
    // sees a complete record — belt-and-braces for any save that
    // skipped the load-time back-fill.
    const nextMaxHp = typeof peakHp === "number" ? peakHp : m.max_hp;
    const nextMaxMp = typeof peakMp === "number" ? peakMp : m.max_mp;
    if (
      nextHp === m.hp &&
      nextMp === m.mp &&
      nextMaxHp === m.max_hp &&
      nextMaxMp === m.max_mp
    ) {
      return m;
    }
    applied = true;
    const next: SavedCharacterState = {
      ...m,
      hp: nextHp,
      mp: nextMp,
    };
    if (typeof nextMaxHp === "number") next.max_hp = nextMaxHp;
    if (typeof nextMaxMp === "number") next.max_mp = nextMaxMp;
    return next;
  });
  return { nextMembers: applied ? nextMembers : members, applied };
}

/**
 * True when at least one conscious member is below their peak HP or
 * MP. Used by the caller to refuse the Use (and skip consuming the
 * stack) when nobody would benefit. Fallen members are ignored — the
 * rest doesn't raise them, so them being below peak doesn't count.
 */
export function partyNeedsRest(
  members: ReadonlyArray<SavedCharacterState>,
  maxHpFor: (id: string) => number | undefined,
  maxMpFor: (id: string) => number | undefined,
): boolean {
  return members.some((m) => {
    if (m.hp <= 0) return false;
    const peakHp =
      (typeof m.max_hp === "number" ? m.max_hp : undefined) ?? maxHpFor(m.id);
    const peakMp =
      (typeof m.max_mp === "number" ? m.max_mp : undefined) ?? maxMpFor(m.id);
    const hpLow = typeof peakHp === "number" && m.hp < peakHp;
    const mpLow = typeof peakMp === "number" && (m.mp ?? 0) < peakMp;
    return hpLow || mpLow;
  });
}
