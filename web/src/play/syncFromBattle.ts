/**
 * syncFromBattle — read post-fight gameState.partyData back into the
 * play save.
 *
 * CombatScene mutates `gameState.partyData` in place during a fight:
 * HP, MP, exp + level-ups, per-member inventory, the shared stash,
 * gold rewards. The play save's `members[]` array seeded the kernel
 * BEFORE combat ran; without this reconciliation it carries the
 * pre-fight state, and the next link-traversal save write commits
 * those stale numbers — a player wins a fight, takes damage, and on
 * reload shows full HP again.
 *
 * Called from PlayHost.onCombatResolved (win path) before the save is
 * written. Pure: returns a new WorldSave with the updated fields,
 * leaves the input untouched.
 */

import { gameState } from "@/battle/state";
import type { PartyMember, InventoryItem } from "@/battle/world/Party";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";

/** Convert a v1battle InventoryItem to the save's inventory entry
 *  shape. Both have `item: string` + optional `charges` + optional
 *  per-instance `durability` (the latter carries wear on non-stackable
 *  gear so it survives across the combat ↔ save boundary). */
function toSavedInventoryEntry(it: InventoryItem): {
  item: string;
  charges?: number;
  durability?: number;
} {
  const entry: { item: string; charges?: number; durability?: number } = {
    item: it.item,
  };
  if (typeof it.charges === "number") entry.charges = it.charges;
  if (typeof it.durability === "number") entry.durability = it.durability;
  return entry;
}

/** Build the post-fight SavedCharacterState for one save member. If
 *  the kernel-side PartyMember isn't present (id mismatch, drop), we
 *  fall back to the pre-fight save record so the member doesn't
 *  vanish from the roster. */
function applyMemberDeltas(
  saved: SavedCharacterState,
  postMember: PartyMember | undefined,
): SavedCharacterState {
  if (!postMember) return saved;
  // Rebuild the saved `equipped` map from the kernel's view so an
  // item that shattered in combat (slot was cleared by
  // useEquippedDurability) actually disappears from the save. Only
  // include non-null entries; the slot's absence is the save's
  // "unequipped" signal.
  const nextEquipped: Record<string, string> = {};
  if (postMember.equipped.hands) nextEquipped.hands = postMember.equipped.hands;
  if (postMember.equipped.body) nextEquipped.body = postMember.equipped.body;
  // Capture the current per-slot wear so a reload-mid-adventure
  // resumes with the same durability the player just spent steps
  // wearing down.
  const nextEd: NonNullable<SavedCharacterState["equipped_durability"]> = {
    hands: postMember.equipped_durability.hands,
    body: postMember.equipped_durability.body,
  };
  return {
    ...saved,
    hp: postMember.hp,
    mp: postMember.mp,
    inventory: postMember.inventory.map(toSavedInventoryEntry),
    equipped: nextEquipped,
    equipped_durability: nextEd,
    // Effects ride on the save but the v1 PartyMember doesn't expose
    // per-member effects directly; party_effects is on the Party. We
    // leave the saved effects list as-is for now — combat doesn't
    // commonly apply long-duration per-member effects, and the v2
    // effects pipeline isn't fully wired through combat yet.
  };
}

/**
 * Reconcile the play save with gameState.partyData. Returns a new
 * WorldSave with:
 *   - party.gold       ← gameState.partyData.gold
 *   - party.inventory  ← gameState.partyData.inventory (shared stash)
 *   - party.members[]  ← per-id hp/mp/inventory from the v1 roster
 *
 * Other party-level fields (torch_steps, galadriels_light_steps,
 * infravision_active, position) survive intact — those live on the
 * world-sim kernel which isn't disposed during combat, so the host's
 * separate saveCurrent() snapshots them correctly.
 *
 * If no party is available in gameState (combat never seeded it for
 * some reason — should not happen in production but defensive), the
 * input save is returned unchanged.
 */
export function applyCombatResultToSave(save: WorldSave): WorldSave {
  const post = gameState.partyData;
  if (!post) return save;
  const postById = new Map<string, PartyMember>();
  for (const m of post.roster) postById.set(m.id, m);
  const updatedMembers = save.party.members.map((m) =>
    applyMemberDeltas(m, postById.get(m.id)),
  );
  const updatedParty: SavedPartyState = {
    ...save.party,
    gold: post.gold,
    inventory: post.inventory.map(toSavedInventoryEntry),
    members: updatedMembers,
  };
  return { ...save, party: updatedParty };
}
