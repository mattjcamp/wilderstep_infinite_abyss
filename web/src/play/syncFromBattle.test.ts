import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyCombatResultToSave } from "./syncFromBattle";
import { gameState } from "@/battle/state";
import type { Party, PartyMember } from "@/battle/world/Party";
import type { SavedCharacterState, WorldSave } from "./saveTypes";

/** Minimal kernel-side PartyMember fixture. Only the fields the
 *  sync helper reads need real values; the rest get defensible
 *  defaults so a hand-rolled fixture stays terse. */
function kernelMember(over: Partial<PartyMember> = {}): PartyMember {
  return {
    id: "hero",
    name: "Hero",
    class: "fighter",
    race: "human",
    gender: "m",
    level: 1,
    exp: 0,
    hp: 10,
    max_hp: 10,
    mp: 0,
    max_mp: 0,
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    equipped: { hands: null, body: null },
    equipped_durability: { hands: null, body: null },
    inventory: [],
    sprite: "",
    ...over,
  };
}

/** Save-side SavedCharacterState fixture. */
function savedMember(over: Partial<SavedCharacterState> = {}): SavedCharacterState {
  return {
    id: "hero",
    custom: null,
    hp: 10,
    mp: 0,
    inventory: [],
    effects: [],
    ...over,
  };
}

/** Build a WorldSave around a member list. Only the fields the
 *  sync helper touches matter; everything else gets a stub
 *  shaped well enough to satisfy the type. */
function makeSave(members: SavedCharacterState[]): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "2024-01-01T00:00:00Z",
    moduleId: "test",
    party: {
      currentMapId: "world",
      col: 0,
      row: 0,
      avatar: "",
      gold: 5,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      onBoat: false,
      currentBoatSprite: null,
      roster: members.map((m) => m.id),
      members,
    },
    maps: {},
  };
}

/** Build a v1battle Party fixture wrapping the given roster. */
function kernelParty(roster: PartyMember[]): Party {
  return {
    start_position: { col: 0, row: 0 },
    gold: 5,
    roster_ids: roster.map((m) => m.id),
    roster,
    party_effects: [],
    inventory: [],
    torch_steps: 0,
    magic_light_steps: 0,
  };
}

describe("applyCombatResultToSave — XP/level propagation", () => {
  // gameState is a module-scope global; restore it between tests so
  // a stray state from one test doesn't leak into the next.
  let priorPartyData: Party | null;
  beforeEach(() => {
    priorPartyData = gameState.partyData ?? null;
  });
  afterEach(() => {
    gameState.partyData = priorPartyData;
  });

  it("propagates exp and level from the post-fight PartyMember onto the saved member", () => {
    // Player entered combat at L1 exp=100; combat awarded XP that
    // levelled them up. The save still carries the pre-fight (L1,
    // exp=100) values; after sync the new (L2, exp=1600) numbers
    // should land in members[0].
    const save = makeSave([
      savedMember({ id: "hero", level: 1, exp: 100, hp: 10, max_hp: 10 }),
    ]);
    gameState.partyData = kernelParty([
      kernelMember({
        id: "hero",
        level: 2,
        exp: 1600,
        hp: 11,
        max_hp: 15,
      }),
    ]);
    const next = applyCombatResultToSave(save);
    expect(next.party.members[0].level).toBe(2);
    expect(next.party.members[0].exp).toBe(1600);
    expect(next.party.members[0].max_hp).toBe(15);
    expect(next.party.members[0].hp).toBe(11);
  });

  it("propagates exp even when no level-up happened (mid-level gain)", () => {
    const save = makeSave([
      savedMember({ id: "hero", level: 3, exp: 200, hp: 10 }),
    ]);
    gameState.partyData = kernelParty([
      kernelMember({ id: "hero", level: 3, exp: 350 }),
    ]);
    const next = applyCombatResultToSave(save);
    expect(next.party.members[0].level).toBe(3);
    expect(next.party.members[0].exp).toBe(350);
  });

  it("propagates per-member exp/level independently across the roster", () => {
    // A fight where one member levelled and another didn't —
    // both should reflect their post-fight values, not get
    // averaged or smushed.
    const save = makeSave([
      savedMember({ id: "a", level: 1, exp: 0 }),
      savedMember({ id: "b", level: 2, exp: 1500 }),
    ]);
    gameState.partyData = kernelParty([
      kernelMember({ id: "a", level: 1, exp: 50 }),
      kernelMember({ id: "b", level: 3, exp: 3050 }),
    ]);
    const next = applyCombatResultToSave(save);
    expect(next.party.members[0].exp).toBe(50);
    expect(next.party.members[0].level).toBe(1);
    expect(next.party.members[1].exp).toBe(3050);
    expect(next.party.members[1].level).toBe(3);
  });

  it("leaves the saved member alone when no kernel-side match exists", () => {
    // applyMemberDeltas's `if (!postMember) return saved` branch —
    // members without a post-fight counterpart (id mismatch /
    // drop) carry through with their pre-fight exp/level intact.
    const save = makeSave([
      savedMember({ id: "ghost", level: 4, exp: 999 }),
    ]);
    gameState.partyData = kernelParty([]);
    const next = applyCombatResultToSave(save);
    expect(next.party.members[0].level).toBe(4);
    expect(next.party.members[0].exp).toBe(999);
  });

  it("returns the input save unchanged when gameState.partyData is null", () => {
    // Defensive — combat should always seed partyData, but a
    // host that calls sync without ever entering combat
    // shouldn't crash.
    const save = makeSave([savedMember({ id: "hero" })]);
    gameState.partyData = null;
    expect(applyCombatResultToSave(save)).toBe(save);
  });
});
