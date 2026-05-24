import { describe, it, expect } from "vitest";
import {
  herbalismOnStep,
  herbalismReagentPool,
  herbalismTerrain,
  type HerbalismAbilityRef,
  type HerbalismCharacterRef,
  type HerbalismItemRef,
} from "./herbalism";
import type {
  SavedCharacterState,
  SavedPartyState,
  WorldSave,
} from "./saveTypes";

/** Compact saved-member fixture — same shape used by the craft /
 *  race-ability tests. Only `id` + `hp` carry meaningful values
 *  for the herbalism gate. */
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
      galadriels_light_steps: 0,
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

const DRUID: HerbalismCharacterRef = {
  id: "p1",
  name: "Mistral",
  class: "druid",
};

const ALCHEMIST: HerbalismCharacterRef = {
  id: "p2",
  name: "Briar",
  class: "alchemist",
};

const FIGHTER: HerbalismCharacterRef = {
  id: "p1",
  name: "Aldric",
  class: "fighter",
};

/** Reagent pool — three reagents + one non-reagent (Torch) so
 *  the filter is exercised. Stackable so addToInventory's merge
 *  path runs. */
function makeItems(): HerbalismItemRef[] {
  return [
    { id: "healing_herb", name: "Healing Herb", stackable: true, item_type: "herb" },
    { id: "moonpetal", name: "Moonpetal", stackable: true, item_type: "reagent" },
    { id: "glowcap_mushroom", name: "Glowcap Mushroom", stackable: true, item_type: "reagent" },
    // Non-reagent noise — should never come back from the pool.
    { id: "torch", name: "Torch", stackable: true, item_type: "torch" },
  ];
}

/** Ability catalog with explicit knobs so the tests don't rely
 *  on the hard defaults. Mirrors the live abilities.json record. */
function makeAbilities(
  over: Partial<HerbalismAbilityRef["params"]> = {},
): HerbalismAbilityRef[] {
  return [
    {
      id: "herbalism",
      params: {
        find_chance: 0.1, // bumped from 0.02 so seeded-rng tests
                          // can land hits without burning many calls
        alchemist_multiplier: 2,
        terrain: ["grass", "forest"],
        ...(over ?? {}),
      },
    },
  ];
}

// rng stubs — return predictable values so each test deterministically
// either hits or misses the chance check + picks the desired pool entry.
const alwaysHit = () => 0; // < any chance → hit; floor(0*N) → first pool entry
const alwaysMiss = () => 0.99; // > 0.2 (alchemist's 2x of 0.1) → miss

describe("herbalismTerrain", () => {
  it("returns the catalog's terrain list when present", () => {
    expect(herbalismTerrain(makeAbilities())).toEqual(["grass", "forest"]);
  });

  it("falls back to the shipped defaults when the catalog lacks a list", () => {
    const out = herbalismTerrain([{ id: "herbalism", params: { dc: 13 } as never }]);
    expect(out).toContain("grass");
    expect(out).toContain("forest");
  });

  it("falls back when herbalism isn't in the catalog at all", () => {
    expect(herbalismTerrain([])).toContain("grass");
  });
});

describe("herbalismReagentPool", () => {
  it("filters to reagent + herb items only", () => {
    const pool = herbalismReagentPool(makeItems());
    expect(pool.map((p) => p.id)).toEqual([
      "healing_herb",
      "moonpetal",
      "glowcap_mushroom",
    ]);
  });

  it("returns an empty pool when no reagents exist (defensive)", () => {
    expect(
      herbalismReagentPool([{ id: "rock", stackable: false, item_type: "stone" }]),
    ).toEqual([]);
  });
});

describe("herbalismOnStep — gate", () => {
  it("never fires when no herbalist class is alive in the party", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = herbalismOnStep(
      save,
      [FIGHTER],
      makeItems(),
      makeAbilities(),
      "grass",
      alwaysHit, // even with a guaranteed-hit rng the gate keeps it closed
    );
    expect(r.found).toBeNull();
    expect(r.nextSave).toBeUndefined();
  });

  it("never fires when the herbalist is down (hp <= 0)", () => {
    const save = makeSave({}, [savedMember({ id: "p1", hp: 0 })]);
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "grass",
      alwaysHit,
    );
    expect(r.found).toBeNull();
  });

  it("skips non-foraging tiles even with a herbalist + guaranteed-hit rng", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "mountain", // not on the terrain list
      alwaysHit,
    );
    expect(r.found).toBeNull();
  });

  it("skips when tileId is missing / empty", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    expect(
      herbalismOnStep(save, [DRUID], makeItems(), makeAbilities(), null, alwaysHit).found,
    ).toBeNull();
    expect(
      herbalismOnStep(save, [DRUID], makeItems(), makeAbilities(), "", alwaysHit).found,
    ).toBeNull();
  });

  it("skips when the reagent pool is empty (defensive)", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const noReagents: HerbalismItemRef[] = [
      { id: "torch", name: "Torch", stackable: true, item_type: "torch" },
    ];
    const r = herbalismOnStep(
      save,
      [DRUID],
      noReagents,
      makeAbilities(),
      "grass",
      alwaysHit,
    );
    expect(r.found).toBeNull();
  });
});

describe("herbalismOnStep — find path", () => {
  it("on a hit, adds the picked reagent to the party stash + returns metadata", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "grass",
      alwaysHit, // first pool entry
    );
    expect(r.found).not.toBeNull();
    expect(r.found?.itemId).toBe("healing_herb");
    expect(r.found?.itemName).toBe("Healing Herb");
    expect(r.found?.finderName).toBe("Mistral");
    expect(r.found?.finderId).toBe("p1");
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "healing_herb", charges: 1 },
    ]);
  });

  it("stack-merges onto an existing reagent row", () => {
    const save = makeSave(
      { inventory: [{ item: "healing_herb", charges: 3 }] },
      [savedMember({ id: "p1" })],
    );
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "grass",
      alwaysHit,
    );
    expect(r.found?.itemId).toBe("healing_herb");
    expect(r.nextSave!.party.inventory).toEqual([
      { item: "healing_herb", charges: 4 },
    ]);
  });

  it("misses cleanly when the rng draw exceeds the find chance", () => {
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "grass",
      alwaysMiss,
    );
    expect(r.found).toBeNull();
    expect(r.nextSave).toBeUndefined();
  });
});

describe("herbalismOnStep — Alchemist doubled rate", () => {
  it("an Alchemist hits at a rate the Druid would miss", () => {
    // Druid at 10% misses at rng = 0.15; Alchemist at 20% hits.
    const rngAt0_15 = () => 0.15;
    const druidSave = makeSave({}, [savedMember({ id: "p1" })]);
    const alchemistSave = makeSave({}, [savedMember({ id: "p2" })]);
    const druidResult = herbalismOnStep(
      druidSave,
      [DRUID],
      makeItems(),
      makeAbilities(),
      "grass",
      rngAt0_15,
    );
    const alchemistResult = herbalismOnStep(
      alchemistSave,
      [ALCHEMIST],
      makeItems(),
      makeAbilities(),
      "grass",
      rngAt0_15,
    );
    expect(druidResult.found).toBeNull();
    expect(alchemistResult.found).not.toBeNull();
  });

  it("with both alive, the Alchemist's higher rate wins (finder name is the Alchemist)", () => {
    const save = makeSave(
      {},
      [savedMember({ id: "p1" }), savedMember({ id: "p2" })],
    );
    const r = herbalismOnStep(
      save,
      [DRUID, ALCHEMIST],
      makeItems(),
      makeAbilities(),
      "grass",
      () => 0.15, // druid-misses / alchemist-hits territory
    );
    expect(r.found?.finderId).toBe("p2");
    expect(r.found?.finderName).toBe("Briar");
  });
});

describe("herbalismOnStep — catalog defaults", () => {
  it("falls back to the shipped 2% chance + grass/forest list when params are missing", () => {
    // Catalog with an empty params object — helper should fall
    // back to the constants so a thin module still produces
    // *some* gameplay.
    const save = makeSave({}, [savedMember({ id: "p1" })]);
    const r = herbalismOnStep(
      save,
      [DRUID],
      makeItems(),
      [{ id: "herbalism", params: null }],
      "grass", // grass is in the default terrain list
      alwaysHit,
    );
    expect(r.found).not.toBeNull();
  });
});
