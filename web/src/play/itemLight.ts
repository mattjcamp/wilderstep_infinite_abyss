/**
 * Equipment-granted Light — an item whose `grants_effect` is the Light
 * effect (`magic_light`, e.g. the Sun Sword) keeps the party lit on the
 * map for as long as a living member has it equipped, and lights the
 * wielder's surroundings in battle. Same radius as the Light spell.
 */

/** Effect ids that make an equipped item a permanent light source.
 *  `sun_sword_aura` is kept for older module data that still points
 *  the Sun Sword at its aura effect. */
const LIGHT_EFFECT_IDS: ReadonlySet<string> = new Set([
  "magic_light",
  "sun_sword_aura",
]);

/** Radius (tiles) of item-granted light — matches the Light spell
 *  (`MAGIC_LIGHT_RANGE` on the map, the spell's default in battle). */
export const ITEM_LIGHT_RADIUS = 5;

export function itemGrantsLight(
  item: { grants_effect?: string | null } | null | undefined,
): boolean {
  return !!item?.grants_effect && LIGHT_EFFECT_IDS.has(item.grants_effect);
}

/** True when any equipped slot holds a light-granting item. */
export function equippedGrantsLight(
  /** Slot → item id (the save's `equipped` record, or the battle
   *  runtime's EquipmentSlots). */
  equipped: object | null | undefined,
  itemById: (id: string) => { grants_effect?: string | null } | undefined,
): boolean {
  if (!equipped) return false;
  return Object.values(equipped).some(
    (id) => typeof id === "string" && !!id && itemGrantsLight(itemById(id)),
  );
}

/** True when a living roster member has a light-granting item equipped. */
export function partyHasItemLight(
  party: {
    roster: ReadonlyArray<string>;
    members: ReadonlyArray<{
      id: string;
      hp: number;
      equipped?: object;
    }>;
  },
  itemById: (id: string) => { grants_effect?: string | null } | undefined,
): boolean {
  const roster = new Set(party.roster);
  return party.members.some(
    (m) => roster.has(m.id) && m.hp > 0 && equippedGrantsLight(m.equipped, itemById),
  );
}

/** Names of the Light-granting items living roster members have
 *  equipped (deduped, in roster order) — "Sun Sword". Empty when the
 *  party carries no item light. */
export function partyItemLightSources(
  party: Parameters<typeof partyHasItemLight>[0],
  itemById: (
    id: string,
  ) => { name?: string; grants_effect?: string | null } | undefined,
): string[] {
  const roster = new Set(party.roster);
  const names: string[] = [];
  for (const m of party.members) {
    if (!roster.has(m.id) || m.hp <= 0 || !m.equipped) continue;
    for (const id of Object.values(m.equipped)) {
      if (typeof id !== "string" || !id) continue;
      const def = itemById(id);
      if (!itemGrantsLight(def)) continue;
      const name = def?.name ?? id;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}
