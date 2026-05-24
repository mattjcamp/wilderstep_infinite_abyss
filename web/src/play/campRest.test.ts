/**
 * Tests for the Camping Supplies "rest" logic. These exist to lock in
 * the persistence behavior — the heal happens IN the returned members
 * array (and the result.applied flag drives whether the caller
 * consumes a charge) so any future regression where the heal silently
 * no-ops will fail here instead of shipping.
 */
import { describe, expect, it } from "vitest";

import type { SavedCharacterState } from "./saveTypes";
import { applyCampRest, partyNeedsRest } from "./campRest";

/** Tiny helper to build a wounded member without spelling out every
 *  required field on every test. */
function member(
  id: string,
  fields: Partial<SavedCharacterState> & { hp: number; mp: number },
): SavedCharacterState {
  return {
    id,
    custom: null,
    inventory: [],
    effects: [],
    ...fields,
  };
}

describe("applyCampRest", () => {
  it("restores HP and MP to peak for every conscious member", () => {
    const members: SavedCharacterState[] = [
      member("selina", { hp: 4, mp: 7, max_hp: 9, max_mp: 11 }),
      member("aldric", { hp: 2, mp: 0, max_hp: 12, max_mp: 0 }),
    ];
    const { nextMembers, applied } = applyCampRest(
      members,
      () => undefined,
      () => undefined,
    );
    expect(applied).toBe(true);
    expect(nextMembers[0].hp).toBe(9);
    expect(nextMembers[0].mp).toBe(11);
    expect(nextMembers[1].hp).toBe(12);
    expect(nextMembers[1].mp).toBe(0);
  });

  it("leaves fallen members (hp <= 0) untouched", () => {
    const fallen = member("pippin", { hp: 0, mp: 0, max_hp: 7, max_mp: 0 });
    const input: SavedCharacterState[] = [fallen];
    const { nextMembers, applied } = applyCampRest(
      input,
      () => undefined,
      () => undefined,
    );
    expect(applied).toBe(false);
    // No mutation needed → helper returns the SAME input reference
    // so React state-equality checks can short-circuit.
    expect(nextMembers).toBe(input);
    expect(nextMembers[0]).toBe(fallen);
    expect(nextMembers[0].hp).toBe(0);
  });

  it("reports applied=false when nobody needs healing", () => {
    const members: SavedCharacterState[] = [
      member("selina", { hp: 9, mp: 11, max_hp: 9, max_mp: 11 }),
    ];
    const { nextMembers, applied } = applyCampRest(
      members,
      () => undefined,
      () => undefined,
    );
    expect(applied).toBe(false);
    // No mutation → same reference passes through.
    expect(nextMembers).toBe(members);
  });

  it("falls back to the catalog map when the member lacks on-save max", () => {
    const members: SavedCharacterState[] = [
      member("selina", { hp: 3, mp: 5 }), // no max_hp / max_mp on the save
    ];
    const { nextMembers, applied } = applyCampRest(
      members,
      (id) => (id === "selina" ? 9 : undefined),
      (id) => (id === "selina" ? 11 : undefined),
    );
    expect(applied).toBe(true);
    expect(nextMembers[0].hp).toBe(9);
    expect(nextMembers[0].mp).toBe(11);
    // Helper also back-fills max_hp / max_mp onto the result so the
    // next read doesn't have to re-derive from the catalog.
    expect(nextMembers[0].max_hp).toBe(9);
    expect(nextMembers[0].max_mp).toBe(11);
  });

  it("prefers on-save max over the catalog fallback", () => {
    // Save tracks selina's level-up peak of 14; catalog still says 9.
    // The rest should heal to 14 (the live peak), NOT 9 (stale).
    const members: SavedCharacterState[] = [
      member("selina", { hp: 5, mp: 8, max_hp: 14, max_mp: 18 }),
    ];
    const { nextMembers } = applyCampRest(
      members,
      () => 9,
      () => 11,
    );
    expect(nextMembers[0].hp).toBe(14);
    expect(nextMembers[0].mp).toBe(18);
  });

  it("works for custom characters with no catalog entry", () => {
    // Custom characters made via CharacterCreator carry their peak
    // on the save itself — the catalog lookup is undefined for them.
    // Heal must still work.
    const custom = member("__custom_brenna", {
      hp: 2,
      mp: 3,
      max_hp: 8,
      max_mp: 6,
      custom: { id: "__custom_brenna", name: "Brenna" },
    });
    const { nextMembers, applied } = applyCampRest(
      [custom],
      () => undefined, // catalog has no entry for custom characters
      () => undefined,
    );
    expect(applied).toBe(true);
    expect(nextMembers[0].hp).toBe(8);
    expect(nextMembers[0].mp).toBe(6);
  });

  it("returns a new member object reference for any healed member", () => {
    // Critical for React state propagation: if we mutated in place
    // or returned the same reference, setState would skip the
    // re-render and the bars wouldn't update.
    const wounded = member("selina", {
      hp: 3,
      mp: 5,
      max_hp: 9,
      max_mp: 11,
    });
    const { nextMembers } = applyCampRest(
      [wounded],
      () => undefined,
      () => undefined,
    );
    expect(nextMembers[0]).not.toBe(wounded);
  });
});

describe("partyNeedsRest", () => {
  it("returns true when at least one conscious member is below peak HP", () => {
    const members = [
      member("selina", { hp: 9, mp: 11, max_hp: 9, max_mp: 11 }),
      member("aldric", { hp: 3, mp: 0, max_hp: 12, max_mp: 0 }),
    ];
    expect(
      partyNeedsRest(
        members,
        () => undefined,
        () => undefined,
      ),
    ).toBe(true);
  });

  it("returns true when only MP is below peak", () => {
    const members = [
      member("selina", { hp: 9, mp: 4, max_hp: 9, max_mp: 11 }),
    ];
    expect(
      partyNeedsRest(
        members,
        () => undefined,
        () => undefined,
      ),
    ).toBe(true);
  });

  it("returns false when everyone alive is at peak", () => {
    const members = [
      member("selina", { hp: 9, mp: 11, max_hp: 9, max_mp: 11 }),
    ];
    expect(
      partyNeedsRest(
        members,
        () => undefined,
        () => undefined,
      ),
    ).toBe(false);
  });

  it("ignores fallen members when deciding whether a rest is needed", () => {
    // Fallen members never count — they can't be healed by a rest.
    const members = [
      member("selina", { hp: 9, mp: 11, max_hp: 9, max_mp: 11 }),
      member("pippin", { hp: 0, mp: 0, max_hp: 7, max_mp: 0 }),
    ];
    expect(
      partyNeedsRest(
        members,
        () => undefined,
        () => undefined,
      ),
    ).toBe(false);
  });
});
