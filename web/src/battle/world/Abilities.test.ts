import { describe, it, expect } from "vitest";
import {
  abilityFromRaw,
  abilityIsCombatActive,
  combatAbilitiesForMember,
  type Ability,
  type AbilityClassTemplateView,
  type AbilityMemberView,
  type AbilityRaceView,
} from "./Abilities";

/** Cleric template fixture — Turn Undead unlocks at level 2. */
const clericTpl: AbilityClassTemplateView = {
  abilities: [{ ability_id: "turn_undead", min_level: 2 }],
};

/** Paladin template fixture — Turn Undead unlocks later (level 5). */
const paladinTpl: AbilityClassTemplateView = {
  abilities: [{ ability_id: "turn_undead", min_level: 5 }],
};

/** Druid template fixture — has dual_casting + herbalism but NOT
 *  Turn Undead. Druids are priest casters so a careless filter
 *  (e.g. one keyed off `casting_type: "priest"`) would surface
 *  Turn Undead for them; the per-class abilities list is the
 *  correct gate. */
const druidTpl: AbilityClassTemplateView = {
  abilities: [
    { ability_id: "dual_casting", min_level: 1 },
    { ability_id: "herbalism", min_level: 1 },
  ],
};

/** Wizard template fixture — declares no abilities at all. */
const wizardTpl: AbilityClassTemplateView = { abilities: [] };

/** Human race — no innate abilities. */
const human: AbilityRaceView = { abilities: [] };

/** Dwarf race — granted Infravision (passive, not combat-active). */
const dwarf: AbilityRaceView = { abilities: ["infravision"] };

/** Fixture catalog matching the shape abilities.json hydrates to.
 *  Mirrors enough of the shipped data that the eligibility filter
 *  exercises every relevant branch. */
function makeCatalog(): Ability[] {
  return [
    {
      id: "turn_undead",
      name: "Turn Undead",
      animation_id: "turn_undead",
      type: "class",
      description: "Channel holy energy.",
      duration: "instant",
      usable_in: ["battle"],
      params: {
        action: "turn_undead",
        save_dc_base: 10,
        hp_percent: 0.5,
        save_dc_stat: "wisdom",
      },
    },
    {
      id: "backstab",
      name: "Backstab",
      animation_id: null,
      type: "class",
      description: "Dagger crit gate.",
      duration: "permanent",
      usable_in: [],
      params: { save_stat: "dexterity", weapon_type: "dagger" },
    },
    {
      id: "dual_casting",
      name: "Dual Casting",
      animation_id: null,
      type: "class",
      description: "Two catalogs.",
      duration: "permanent",
      usable_in: [],
      params: null,
    },
    {
      id: "herbalism",
      name: "Herbalism",
      animation_id: null,
      type: "class",
      description: "Spot reagents.",
      duration: "permanent",
      usable_in: [],
      params: { dc: 13, save_stat: "intelligence" },
    },
    {
      id: "infravision",
      name: "Infravision",
      animation_id: null,
      type: "race",
      description: "See in the dark.",
      duration: "permanent",
      usable_in: [],
      params: null,
    },
    {
      id: "tinker",
      name: "Tinker",
      animation_id: null,
      type: "race",
      description: "Craft once per day.",
      duration: "permanent",
      // usable_in: ["party"] — out-of-combat only, NOT a combat
      // ability. The filter should exclude it.
      usable_in: ["party"],
      params: { action: "tinker", uses_per_day: 1 },
    },
  ];
}

const cleric = (level: number): AbilityMemberView => ({
  class: "cleric",
  race: "human",
  level,
});

const paladin = (level: number): AbilityMemberView => ({
  class: "paladin",
  race: "human",
  level,
});

describe("abilityFromRaw", () => {
  it("hydrates a v2 raw record verbatim while normalising usable_in", () => {
    const a = abilityFromRaw({
      id: "turn_undead",
      name: "Turn Undead",
      type: "class",
      description: "x",
      duration: "instant",
      usable_in: ["battle"],
      params: { action: "turn_undead" },
    });
    expect(a).not.toBeNull();
    expect(a!.id).toBe("turn_undead");
    expect(a!.type).toBe("class");
    expect(a!.usable_in).toEqual(["battle"]);
  });

  it("accepts a singleton string for usable_in and wraps it in an array", () => {
    const a = abilityFromRaw({
      id: "x",
      name: "X",
      usable_in: "battle" as unknown as string[],
    });
    expect(a!.usable_in).toEqual(["battle"]);
  });

  it("defaults usable_in to [] when the raw record omits it (passive abilities)", () => {
    const a = abilityFromRaw({
      id: "backstab",
      name: "Backstab",
    });
    expect(a!.usable_in).toEqual([]);
  });

  it("returns null when id or name is missing (loader should drop the entry)", () => {
    expect(abilityFromRaw({ name: "Nameless" })).toBeNull();
    expect(abilityFromRaw({ id: "idless" })).toBeNull();
  });

  it("normalises unknown type values to 'class' (defensive)", () => {
    const a = abilityFromRaw({
      id: "x",
      name: "X",
      type: "wildcard" as Ability["type"],
    });
    expect(a!.type).toBe("class");
  });
});

describe("abilityIsCombatActive", () => {
  const catalog = makeCatalog();

  it("accepts an ability with usable_in including 'battle' AND params.action set", () => {
    const turn = catalog.find((a) => a.id === "turn_undead")!;
    expect(abilityIsCombatActive(turn)).toBe(true);
  });

  it("rejects an ability with no usable_in (passive — e.g. Backstab)", () => {
    const backstab = catalog.find((a) => a.id === "backstab")!;
    expect(abilityIsCombatActive(backstab)).toBe(false);
  });

  it("rejects an ability flagged usable_in: ['party'] only (out-of-combat — e.g. Tinker)", () => {
    const tinker = catalog.find((a) => a.id === "tinker")!;
    expect(abilityIsCombatActive(tinker)).toBe(false);
  });

  it("rejects a battle ability whose params bag forgot to declare an action", () => {
    // Mistaken authoring: usable_in: ["battle"] but no params.action
    // → there's nothing for the dispatcher to route on. Silent-skip
    // is friendlier than a runtime crash.
    const broken: Ability = {
      id: "half_wired",
      name: "Half Wired",
      animation_id: null,
      type: "class",
      description: "",
      duration: "instant",
      usable_in: ["battle"],
      params: { description: "no action key" },
    };
    expect(abilityIsCombatActive(broken)).toBe(false);
  });

  it("rejects a battle ability with a null params bag", () => {
    const noParams: Ability = {
      id: "no_params",
      name: "No Params",
      animation_id: null,
      type: "class",
      description: "",
      duration: "instant",
      usable_in: ["battle"],
      params: null,
    };
    expect(abilityIsCombatActive(noParams)).toBe(false);
  });
});

describe("combatAbilitiesForMember", () => {
  const catalog = makeCatalog();

  it("surfaces Turn Undead for a level-2 Cleric", () => {
    const out = combatAbilitiesForMember(cleric(2), clericTpl, human, catalog);
    expect(out.map((a) => a.id)).toEqual(["turn_undead"]);
  });

  it("hides Turn Undead from a level-1 Cleric (below the per-class gate)", () => {
    const out = combatAbilitiesForMember(cleric(1), clericTpl, human, catalog);
    expect(out).toEqual([]);
  });

  it("surfaces Turn Undead for a level-5 Paladin but not a level-4 Paladin", () => {
    expect(
      combatAbilitiesForMember(paladin(5), paladinTpl, human, catalog).map((a) => a.id),
    ).toEqual(["turn_undead"]);
    expect(
      combatAbilitiesForMember(paladin(4), paladinTpl, human, catalog),
    ).toEqual([]);
  });

  it("does NOT surface Turn Undead for a high-level Druid (priest caster, but not granted)", () => {
    // Druid is a priest caster (casting_type includes "priest") so a
    // careless implementation that filtered Turn Undead by casting
    // catalog would let Druids cast it. The per-class abilities
    // list is the canonical gate, and Druids aren't on it.
    const out = combatAbilitiesForMember(
      { class: "druid", race: "human", level: 9 },
      druidTpl,
      human,
      catalog,
    );
    expect(out).toEqual([]);
  });

  it("does NOT surface passive abilities (Backstab, Dual Casting, Herbalism, Infravision)", () => {
    // A high-level Druid has dual_casting + herbalism in their class
    // template AND infravision in their race fixture — none combat-
    // active. The picker should be empty.
    const out = combatAbilitiesForMember(
      { class: "druid", race: "dwarf", level: 9 },
      druidTpl,
      dwarf,
      catalog,
    );
    expect(out).toEqual([]);
  });

  it("returns an empty list when the member has no class abilities and no race abilities", () => {
    const out = combatAbilitiesForMember(
      { class: "wizard", race: "human", level: 9 },
      wizardTpl,
      human,
      catalog,
    );
    expect(out).toEqual([]);
  });

  it("survives a null class template (uncatalogued class)", () => {
    const out = combatAbilitiesForMember(cleric(5), null, human, catalog);
    expect(out).toEqual([]);
  });

  it("survives a null race (legacy race ids missing from the catalog)", () => {
    const out = combatAbilitiesForMember(cleric(5), clericTpl, null, catalog);
    expect(out.map((a) => a.id)).toEqual(["turn_undead"]);
  });

  it("dedupes when a class and a race grant the same id", () => {
    // Race-granted Turn Undead would be unusual but the helper
    // dedupes regardless — a single entry comes out even if both
    // granters list it.
    const turnFromRace: AbilityRaceView = { abilities: ["turn_undead"] };
    const out = combatAbilitiesForMember(cleric(5), clericTpl, turnFromRace, catalog);
    expect(out.map((a) => a.id)).toEqual(["turn_undead"]);
  });

  it("ignores granter references to ids missing from the catalog", () => {
    // A class template that points at a ghost ability shouldn't
    // crash the picker — the missing entry just drops out.
    const tplWithGhost: AbilityClassTemplateView = {
      abilities: [
        { ability_id: "turn_undead", min_level: 2 },
        { ability_id: "ghost_ability_404", min_level: 1 },
      ],
    };
    const out = combatAbilitiesForMember(cleric(5), tplWithGhost, human, catalog);
    expect(out.map((a) => a.id)).toEqual(["turn_undead"]);
  });
});
