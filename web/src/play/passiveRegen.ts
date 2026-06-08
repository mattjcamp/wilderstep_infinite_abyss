/**
 * Passive HP/MP regen for "restful" maps (towns, taverns).
 *
 * Some maps carry a `passive_regen: { hp, mp }` attribute. While the
 * party is on such a map, each turn — a step OR a wait — trickles a
 * little health and mana back into every LIVING member, capped at
 * their peak (`max_hp` / `max_mp`). It's a convenience for safe zones,
 * not a combat heal: the maps it applies to have no encounters, and
 * dungeons never carry it (the host gates that separately).
 *
 * Deliberately does NOT touch downed members (hp <= 0) — passive rest
 * never revives the dead; that stays a temple / spell cost. Members
 * with no `max_hp` (or `max_mp`) recorded yet are left alone on that
 * stat so we never heal past an unknown ceiling. This module is pure
 * (no I/O) so it's trivially unit-testable; PlayHost wires it to the
 * `moved` / `waited` events and persists the result.
 */

/** Per-turn regen amounts. Both clamped to non-negative integers. */
export interface RegenRate {
  hp: number;
  mp: number;
}

/** The slice of a saved member this module reads / writes. Matches
 *  `SavedCharacterState` structurally so callers pass members straight
 *  through. */
export interface RegenMember {
  hp: number;
  mp: number;
  max_hp?: number;
  max_mp?: number;
}

export interface PassiveRegenResult<T> {
  nextMembers: T[];
  /** True when at least one member's hp or mp actually increased — lets
   *  the caller skip a save write on a no-op turn (everyone topped off). */
  changed: boolean;
}

/**
 * Apply one turn of passive regen to a roster. Returns fresh member
 * objects (callers treat saves as immutable) and whether anything
 * changed. Living members below their cap gain `rate.hp` / `rate.mp`,
 * clamped to `max_hp` / `max_mp`; dead members and unknown-cap stats
 * are left untouched.
 */
export function applyPassiveRegen<T extends RegenMember>(
  members: ReadonlyArray<T>,
  rate: RegenRate,
): PassiveRegenResult<T> {
  const hpRate = Math.max(0, Math.floor(rate.hp || 0));
  const mpRate = Math.max(0, Math.floor(rate.mp || 0));
  if (hpRate === 0 && mpRate === 0) {
    return { nextMembers: members.map((m) => ({ ...m })), changed: false };
  }
  let changed = false;
  const nextMembers = members.map((m) => {
    // Downed members don't passively heal — no free revives.
    if (m.hp <= 0) return { ...m };
    let hp = m.hp;
    let mp = m.mp;
    if (hpRate > 0 && typeof m.max_hp === "number" && hp < m.max_hp) {
      hp = Math.min(hp + hpRate, m.max_hp);
    }
    if (
      mpRate > 0 &&
      typeof m.max_mp === "number" &&
      typeof mp === "number" &&
      mp < m.max_mp
    ) {
      mp = Math.min(mp + mpRate, m.max_mp);
    }
    if (hp !== m.hp || mp !== m.mp) changed = true;
    return { ...m, hp, mp };
  });
  return { nextMembers, changed };
}

/** True when a rate actually heals something (used to gate work). */
export function regenHasEffect(rate: RegenRate | null | undefined): boolean {
  if (!rate) return false;
  return (rate.hp ?? 0) > 0 || (rate.mp ?? 0) > 0;
}
