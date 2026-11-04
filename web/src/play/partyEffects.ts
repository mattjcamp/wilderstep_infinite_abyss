/**
 * Party-effect bookkeeping shared by the play host (save checkpoints)
 * and the Party screen (what reads as "on").
 */

/**
 * Reconcile `party_effects` with the per-step counters the sim ticked.
 * The Cleric's Light spell, Push's repel and the Torch auto-expire when
 * their counter hits zero — drop the id so the Party screen no longer
 * renders the effect as active. Infravision stays in lockstep with its
 * own flag since the player turns that off explicitly.
 */
export function reconcilePartyEffects(
  ids: readonly string[],
  party: {
    magic_light_steps?: number;
    repel_monsters_steps?: number;
    torch_steps: number;
    infravision_active?: boolean;
  },
): string[] {
  return ids.filter((id) => {
    if (id === "magic_light") return (party.magic_light_steps ?? 0) > 0;
    if (id === "repel_monsters") return (party.repel_monsters_steps ?? 0) > 0;
    if (id === "torch") return party.torch_steps > 0;
    if (id === "infravision") return !!party.infravision_active;
    return true;
  });
}

/**
 * Whether a party effect reads as active. A timed effect (one with a
 * step counter — Light, Torch, Push's repel) is on only while its
 * counter runs: its id can linger in `party_effects` after it burns out
 * until the next save checkpoint reconciles it, so the counter wins.
 * Effects without a counter follow the active list.
 */
export function isPartyEffectActive(
  id: string,
  activeIds: readonly string[],
  durations?: ReadonlyMap<string, number>,
): boolean {
  const dur = durations?.get(id);
  if (dur !== undefined) return dur > 0;
  return activeIds.includes(id);
}
