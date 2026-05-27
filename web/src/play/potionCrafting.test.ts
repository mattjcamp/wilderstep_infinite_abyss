import { describe, it, expect } from "vitest";
import {
  attemptBrew,
  canBrew,
  findAliveBrewer,
  recipeShortages,
  type RecipeRef,
} from "./potionCrafting";
import type { RaceAbilityCharacterRef } from "./raceAbilities";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";
import type { StackableItemRef } from "./inventoryStacking";

function savedMember(over: Partial<SavedCharacterState> = {}): SavedCharacterState {
  return {
    id: "?",
    custom: null,
    hp: 10,
    mp: 0,
    inventory: [],
    effects: [],
    ...over,
  };
}

function makeSave(
  partyOver: Partial<SavedPartyState> = {},
  members: SavedCharacterState[] = [savedMember({ id: "p1" })],
): WorldSave {
  return {
    schemaVersion: 1,
    savedAt: "2024-01-01T00:00:00Z",
    moduleId: "test",
    clockMinutes: 0,
    party: {
      currentMapId: "world",
      col: 0,
      row: 0,
      avatar: "",
      gold: 0,
      inventory: [],
      torch_steps: 0,
      infravision_active: false,
      onBoat: false,
      currentBoatSprite: null,
      roster: members.map((m) => m.id),
      members,
      ...partyOver,
    },
    maps: {},
  };
}

const ALCHEMIST: RaceAbilityCharacterRef & { class?: string } = {
  id: "p1",
  name: "Briar",
  race: "human",
  class: "alchemist",
};

const FIGHTER: RaceAbilityCharacterRef & { class?: string } = {
  id: "p1",
  name: "Aldric",
  race: "human",
  class: "fighter",
};

const HEALING_RECIPE: RecipeRef = {
  id: "healing_potion",
  name: "Healing Potion",
  result_item: "healing_potion",
  reagents: { moonpetal: 1, spring_water: 1 },
};

const FIRE_OIL_RECIPE: RecipeRef = {
  id: "fire_oil",
  name: "Fire Oil",
  result_item: "fire_oil",
  reagents: { brimite_ore: 1, glowcap_mushroom: 1 },
};

function makeItems(): StackableItemRef[] {
  return [
    // Reagents — stackable so the consume path runs the shared
    // stack-row decrement.
    { id: "moonpetal", stackable: true },
    { id: "spring_water", stackable: true },
    { id: "brimite_ore", stackable: true },
    { id: "glowcap_mushroom", stackable: true },
    // Potion outputs — stackable too (matches items.json).
    { id: "healing_potion", stackable: true, charges: 1 },
    { id: "fire_oil", stackable: true, charges: 1 },
  ];
}

describe("findAliveBrewer + canBrew", () => {
  it("finds an alive Alchemist", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(findAliveBrewer(save, [ALCHEMIST])).toEqual({
      id: "p1",
      name: "Briar",
    });
    expect(canBrew(save, [ALCHEMIST])).toBe(true);
  });

  it("returns null when no Alchemist is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(findAliveBrewer(save, [FIGHTER])).toBeNull();
    expect(canBrew(save, [FIGHTER])).toBe(false);
  });

  it("skips fallen Alchemists", () => {
    const save = makeSave({}, [savedMember({ id: "p1", hp: 0 })]);
    expect(findAliveBrewer(save, [ALCHEMIST])).toBeNull();
  });
});

describe("recipeShortages", () => {
  it("returns empty when the party can brew the recipe", () => {
    const save = makeSave({
      inventory: [
        { item: "moonpetal", charges: 2 },
        { item: "spring_water", charges: 3 },
      ],
    });
    expect(recipeShortages(save, HEALING_RECIPE, makeItems())).toEqual({});
  });

  it("reports the missing count when a reagent is short", () => {
    const save = makeSave({
      inventory: [{ item: "moonpetal", charges: 1 }],
    });
    // Spring water is fully missing (needs 1, have 0).
    expect(recipeShortages(save, HEALING_RECIPE, makeItems())).toEqual({
      spring_water: 1,
    });
  });

  it("reports zero / absent reagents as the full shortfall", () => {
    const save = makeSave({ inventory: [] });
    expect(recipeShortages(save, HEALING_RECIPE, makeItems())).toEqual({
      moonpetal: 1,
      spring_water: 1,
    });
  });
});

describe("attemptBrew — refusals", () => {
  it("refuses when no Alchemist is in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptBrew(save, [FIGHTER], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no alchemist/i);
  });

  it("refuses an unknown recipe", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "love_potion");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/unknown recipe/i);
  });

  it("refuses when a reagent is missing — message names the shortfall", () => {
    const save = makeSave({ inventory: [{ item: "moonpetal", charges: 1 }] });
    const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/missing/i);
    expect(r.message).toMatch(/spring_water/i);
  });
});

describe("attemptBrew — success", () => {
  it("consumes the reagent stack and adds the produced potion", () => {
    const save = makeSave({
      inventory: [
        { item: "moonpetal", charges: 3 },
        { item: "spring_water", charges: 3 },
      ],
    });
    const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/brews/i);
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "moonpetal", charges: 2 },
      { item: "spring_water", charges: 2 },
      { item: "healing_potion", charges: 1 },
    ]);
  });

  it("splices the row when the last unit of a reagent is consumed", () => {
    const save = makeSave({
      inventory: [
        { item: "moonpetal", charges: 1 },
        { item: "spring_water", charges: 1 },
      ],
    });
    const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(r.ok).toBe(true);
    // Both reagent rows fully consumed; only the produced potion
    // row remains.
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "healing_potion", charges: 1 },
    ]);
  });

  it("merges onto an existing potion stack rather than pushing a duplicate row", () => {
    const save = makeSave({
      inventory: [
        { item: "moonpetal", charges: 1 },
        { item: "spring_water", charges: 1 },
        { item: "healing_potion", charges: 2 },
      ],
    });
    const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(r.ok).toBe(true);
    expect(r.nextSave!.party.inventory).toEqual([
      // Reagent rows consumed entirely; healing_potion stack
      // incremented by 1.
      { item: "healing_potion", charges: 3 },
    ]);
  });

  it("consecutive brews drain reagents predictably (no race / mutation surprise)", () => {
    // Three brews from three units of each reagent. The third
    // succeeds; a hypothetical fourth would refuse.
    let save = makeSave({
      inventory: [
        { item: "moonpetal", charges: 3 },
        { item: "spring_water", charges: 3 },
      ],
    });
    for (let i = 0; i < 3; i++) {
      const r = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
      expect(r.ok).toBe(true);
      save = r.nextSave!;
    }
    expect(save.party.inventory).toEqual([
      { item: "healing_potion", charges: 3 },
    ]);
    const fourth = attemptBrew(save, [ALCHEMIST], makeItems(), [HEALING_RECIPE], "healing_potion");
    expect(fourth.ok).toBe(false);
  });
});
