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
