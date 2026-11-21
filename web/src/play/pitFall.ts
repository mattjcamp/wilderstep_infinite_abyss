/**
 * Fall damage for a dungeon pit drop-through.
 *
 * Every conscious party member takes 1–4 damage when the party drops
 * into a pit and lands on the floor below. A fall is meant to sting,
 * not kill: nobody is taken below 1 HP by it, and members already down
 * (0 HP) are left alone. Pure — the host persists the result and
 * appends the log lines.
 */

export interface PitFallMember {
  id: string;
  hp: number;
}

export function applyPitFall<M extends PitFallMember>(
  members: readonly M[],
  rng: () => number,
  nameOf: (m: M) => string = (m) => m.id,
): { members: M[]; lines: string[] } {
  const lines = ["The party plunges into the pit and lands hard on the floor below!"];
  const next = members.map((m) => {
    if (m.hp <= 0) return m;
    const damage = 1 + Math.floor(rng() * 4);
    const hp = Math.max(1, m.hp - damage);
    const taken = m.hp - hp;
    if (taken > 0) lines.push(`${nameOf(m)} takes ${taken} damage from the fall.`);
    return { ...m, hp };
  });
  return { members: next, lines };
}

/** One roster line on the fall card. */
export interface PitFallLine {
  id: string;
  name: string;
  sprite?: string;
  /** HP lost to the fall (0 for a member already at 1 HP or down). */
  taken: number;
  hp: number;
  maxHp?: number;
  /** Already down before the fall — the fall doesn't touch them. */
  fallen: boolean;
}

/** What the fall card shows: per-member damage, diffed from the roster
 *  before and after {@link applyPitFall}. Pure; members match by id. */
export function pitFallReport<M extends PitFallMember & { max_hp?: number }>(
  before: readonly M[],
  after: readonly M[],
  info: (id: string) => { name?: string; sprite?: string } | undefined,
): PitFallLine[] {
  const prev = new Map(before.map((m) => [m.id, m]));
  return after.map((m) => {
    const b = prev.get(m.id) ?? m;
    const meta = info(m.id);
    return {
      id: m.id,
      name: meta?.name || m.id,
      sprite: meta?.sprite,
      taken: Math.max(0, b.hp - m.hp),
      hp: m.hp,
      maxHp: m.max_hp,
      fallen: b.hp <= 0,
    };
  });
}
