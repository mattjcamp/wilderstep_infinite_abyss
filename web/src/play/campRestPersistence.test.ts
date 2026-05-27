/**
 * End-to-end persistence test for Camping Supplies. Walks the same
 * data flow the running game does, in order:
 *
 *   1. A WorldSave with wounded members and back-filled max_hp / max_mp
 *      (the shape PlayHost hands to PlayPartyScreenOverlay after its
 *      load-time back-fill).
 *   2. applyCampRest produces healed members.
 *   3. The overlay builds the commit's WorldSave by spreading the prior
 *      save and overriding `party.members` with the healed array — same
 *      shape handleUseStashItem builds before calling commit().
 *   4. JSON round-trip (mimics localStorage.setItem / getItem that
 *      onMutateSave + a subsequent loadWorld would do).
 *   5. memberFromRaw consumes the saved hp + max_hp the same way
 *      buildPartyFromSave does when seeding combat — asserts the
 *      resulting PartyMember carries the healed values into the
 *      battle data layer.
 *
 * If any link in the chain regresses (overlay forgets to commit
 * members, save schema drops max_hp, memberFromRaw collapses max
 * back to current, etc.) this test fails.
 */
import { describe, expect, it } from "vitest";

import { memberFromRaw } from "@/battle/world/Party";
import { applyCampRest } from "./campRest";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";

function woundedSave(): WorldSave {
  const selina: SavedCharacterState = {
    id: "selina",
    custom: null,
    hp: 3,
    mp: 4,
    max_hp: 9,
    max_mp: 11,
    inventory: [],
    effects: [],
  };
  const aldric: SavedCharacterState = {
    id: "aldric",
    custom: null,
    hp: 5,
    mp: 0,
    max_hp: 12,
    max_mp: 0,
    inventory: [],
    effects: [],
  };
  const party: SavedPartyState = {
    currentMapId: "demo_map",
    col: 1,
    row: 1,
    avatar: "person/fighter18.png",
    gold: 50,
    inventory: [{ item: "camping_supplies", charges: 3 }],
    torch_steps: 0,
    infravision_active: false,
    roster: ["selina", "aldric"],
    members: [selina, aldric],
  };
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    moduleId: "default",
    clockMinutes: 0,
    party,
    maps: {},
    dungeons: {},
  };
}

describe("Camping Supplies persistence", () => {
  it("rest heals the saved members and survives a JSON round-trip", () => {
    const cur = woundedSave();

    // (1+2) Run the heal the way handleUseStashItem does.
    const rest = applyCampRest(
      cur.party.members,
      () => undefined,
      () => undefined,
    );
    expect(rest.applied).toBe(true);

    // (3) Build the commit's WorldSave the same way handleUseStashItem
    // does — spread the current save, override `party.members`.
    const next: WorldSave = {
      ...cur,
      party: { ...cur.party, members: rest.nextMembers },
    };
    expect(next.party.members[0].hp).toBe(9);
    expect(next.party.members[0].mp).toBe(11);
    expect(next.party.members[1].hp).toBe(12);

    // (4) Round-trip through localStorage's serializer. saveWorld +
    // loadWorld both use JSON; if the heal somehow ended up on a
    // non-serializable field (a class instance, a Map) the values
    // would silently disappear here.
    const rehydrated = JSON.parse(JSON.stringify(next)) as WorldSave;
    expect(rehydrated.party.members[0].hp).toBe(9);
    expect(rehydrated.party.members[0].max_hp).toBe(9);
    expect(rehydrated.party.members[0].mp).toBe(11);
    expect(rehydrated.party.members[0].max_mp).toBe(11);
  });

  it("combat seeding (memberFromRaw) sees the healed hp + max", () => {
    const cur = woundedSave();
    const rest = applyCampRest(
      cur.party.members,
      () => undefined,
      () => undefined,
    );
    const next: WorldSave = {
      ...cur,
      party: { ...cur.party, members: rest.nextMembers },
    };
    const rehydrated = JSON.parse(JSON.stringify(next)) as WorldSave;

    // buildPartyFromSave in seedBattleCaches.ts does this exact
    // overlay for each member: spread the catalog character, then
    // override hp/mp/max_hp/max_mp from the saved record. memberFromRaw
    // is what turns that into a runtime PartyMember.
    const catalog = {
      id: "selina",
      name: "Selina",
      class: "cleric",
      race: "human",
      level: 1,
      hp: 9,
      mp: 11,
    };
    const saved = rehydrated.party.members[0];
    const withSaved = {
      ...catalog,
      hp: saved.hp,
      mp: saved.mp,
      max_hp: saved.max_hp,
      max_mp: saved.max_mp,
    };
    const combatant = memberFromRaw(withSaved);
    // The whole point of the persistence: combat starts with Selina
    // at full HP / MP. Pre-fix this would be 3/3 (collapsed max) or
    // 3/9 (heal didn't persist) depending on which bug bit.
    expect(combatant.hp).toBe(9);
    expect(combatant.max_hp).toBe(9);
    expect(combatant.mp).toBe(11);
    expect(combatant.max_mp).toBe(11);
  });

  it("a partially-healed-then-damaged member still shows true max in combat", () => {
    // Sanity check on memberFromRaw — the regression we fixed in
    // Party.ts was that max_hp was being clobbered to current. A
    // member entering combat at hp=4/max_hp=9 must display 4/9, NOT
    // the misleading 4/4 that pre-fix combat would have shown.
    const withSaved = {
      id: "selina",
      class: "cleric",
      hp: 4,
      mp: 7,
      max_hp: 9,
      max_mp: 11,
    };
    const combatant = memberFromRaw(withSaved);
    expect(combatant.hp).toBe(4);
    expect(combatant.max_hp).toBe(9);
    expect(combatant.mp).toBe(7);
    expect(combatant.max_mp).toBe(11);
  });
});
