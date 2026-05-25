import { describe, it, expect } from "vitest";
import {
  combatStatsFor,
  combatantFromMember,
  raceMovementBonuses,
  refreshCombatantGear,
} from "./CombatBridge";
import type { PartyMember } from "../world/Party";
import type { Item } from "../world/Items";
import type { Ability } from "../world/Abilities";

/** Build a minimal PartyMember fixture. Stats default to 10 (mod 0)
 *  so damage rolls expose the weapon's contribution cleanly. */
function makeMember(over: Partial<PartyMember> = {}): PartyMember {
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

/** Catalog fixture with the two weapons under test plus a couple of
 *  noise items so the lookup path isn't trivially short. */
function makeItems(): Map<string, Item> {
  const items: Item[] = [
    {
      id: "sword",
      category: "weapons",
      name: "Sword",
      slots: ["hands"],
      character_can_equip: true,
      power: 5,
      durability: 20,
    },
    {
      id: "sun_sword",
      category: "weapons",
      name: "Sun Sword",
      slots: ["hands"],
      character_can_equip: true,
      power: 20,
      bonus_damage: "1d6",
      damage_type: "fire",
      durability: 0,
      grants_effect: "sun_sword_aura",
      wielder_passives: ["fire_resistance"],
      combat_aura: { color: 0xffd750 },
    },
    {
      id: "dagger",
      category: "weapons",
      name: "Dagger",
      slots: ["hands"],
      character_can_equip: true,
      power: 3,
    },
  ];
  return new Map(items.map((it) => [it.id, it]));
}

describe("Sun Sword vs. baseline sword — base damage math", () => {
  it("upgrades the wielder's damage die from 1d6 to 2d8", () => {
    // damageForWeapon's extended power-tier table:
    //   power 4-5  → 1d6  (Sword sits here)
    //   power 20+  → 2d8  (Sun Sword sits here)
    // The mid-tier ladder (1d10 for 9-11, 1d12 for 12-14, 2d6 for
    // 15-19) means Sun Sword now visibly outdamages every other
    // weapon in the catalog instead of capping at the same 1d10
    // a power-9 Halberd would roll.
    // STR 10 → mod 0 so the dice are bare.
    const items = makeItems();
    const swordHero = makeMember({ equipped: { hands: "sword", body: null } });
    const sunHero = makeMember({ equipped: { hands: "sun_sword", body: null } });
    const swordStats = combatStatsFor(swordHero, items);
    const sunStats = combatStatsFor(sunHero, items);
    expect(swordStats.damage).toEqual({ dice: 1, sides: 6, bonus: 0 });
    expect(sunStats.damage).toEqual({ dice: 2, sides: 8, bonus: 0 });
    // Average roll: sword 3.5 vs Sun Sword 9 — a 157% bump on the
    // BASE dice alone, before the 1d6 fire bonus rolled per swing.
    // Strictly more dice + bigger die so the comparison is
    // unambiguous; the audit's "rare weapons feel rare" goal.
    const swordAvg = swordStats.damage.dice * (swordStats.damage.sides + 1) / 2;
    const sunAvg = sunStats.damage.dice * (sunStats.damage.sides + 1) / 2;
    expect(sunAvg).toBeGreaterThan(swordAvg);
  });

  it("threads the Sun Sword's bonus_damage + damage_type onto the Combatant", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sun_sword", body: null } }),
      items,
    );
    expect(c.weaponBonusDamage).toBe("1d6");
    expect(c.weaponDamageType).toBe("fire");
    expect(c.weaponName).toBe("Sun Sword");
  });

  it("leaves bonus_damage / damage_type undefined for a plain sword", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sword", body: null } }),
      items,
    );
    expect(c.weaponBonusDamage).toBeUndefined();
    expect(c.weaponDamageType).toBeUndefined();
  });
});

describe("wielder_passives → Combatant.passives", () => {
  it("stamps fire_resistance onto the wielder when the equipped weapon declares it", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sun_sword", body: null } }),
      items,
    );
    expect(c.passives).toEqual([{ type: "fire_resistance" }]);
  });

  it("leaves passives undefined for ordinary weapons", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sword", body: null } }),
      items,
    );
    expect(c.passives).toBeUndefined();
  });

  it("dedupes passives when multiple equipped slots declare the same id", () => {
    // Custom item fixture: both hands AND body grant fire_resistance.
    // The bridge should fold them into a single passive entry so the
    // engine doesn't double-halve the dragon's breath.
    const items = makeItems();
    items.set("ember_cloak", {
      id: "ember_cloak",
      category: "armors",
      name: "Ember Cloak",
      slots: ["body"],
      character_can_equip: true,
      wielder_passives: ["fire_resistance"],
    });
    const c = combatantFromMember(
      makeMember({
        equipped: { hands: "sun_sword", body: "ember_cloak" },
      }),
      items,
    );
    expect(c.passives).toEqual([{ type: "fire_resistance" }]);
  });

  it("collects multiple distinct passives across slots", () => {
    const items = makeItems();
    items.set("antitoxin_amulet", {
      id: "antitoxin_amulet",
      category: "armors",
      name: "Antitoxin Amulet",
      slots: ["body"],
      character_can_equip: true,
      wielder_passives: ["poison_immunity"],
    });
    const c = combatantFromMember(
      makeMember({
        equipped: { hands: "sun_sword", body: "antitoxin_amulet" },
      }),
      items,
    );
    // Order follows slot iteration (hands → body), so fire first.
    expect(c.passives).toEqual([
      { type: "fire_resistance" },
      { type: "poison_immunity" },
    ]);
  });

  it("silently drops unknown wielder_passives ids", () => {
    // Forward-compat — an item declaring a passive the engine doesn't
    // yet honour shouldn't fail the build. The unknown id is just
    // omitted from the Combatant's passives array.
    const items = makeItems();
    items.set("mystery_blade", {
      id: "mystery_blade",
      category: "weapons",
      name: "Mystery Blade",
      slots: ["hands"],
      character_can_equip: true,
      power: 8,
      wielder_passives: ["fire_resistance", "lightning_immunity"],
    });
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "mystery_blade", body: null } }),
      items,
    );
    expect(c.passives).toEqual([{ type: "fire_resistance" }]);
  });
});

describe("combat_aura → Combatant.wieldAuraColor", () => {
  it("stamps the gold halo color onto the Sun Sword wielder", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sun_sword", body: null } }),
      items,
    );
    expect(c.wieldAuraColor).toBe(0xffd750);
  });

  it("leaves wieldAuraColor undefined for ordinary weapons", () => {
    const items = makeItems();
    const c = combatantFromMember(
      makeMember({ equipped: { hands: "sword", body: null } }),
      items,
    );
    expect(c.wieldAuraColor).toBeUndefined();
  });
});

describe("refreshCombatantGear — mid-fight swap", () => {
  it("adds passives + aura when the player draws the Sun Sword mid-fight", () => {
    const items = makeItems();
    const member = makeMember({ equipped: { hands: "sword", body: null } });
    const c = combatantFromMember(member, items);
    expect(c.passives).toBeUndefined();
    expect(c.wieldAuraColor).toBeUndefined();
    // Player swaps to the Sun Sword.
    member.equipped.hands = "sun_sword";
    refreshCombatantGear(c, member, items);
    expect(c.passives).toEqual([{ type: "fire_resistance" }]);
    expect(c.wieldAuraColor).toBe(0xffd750);
    expect(c.weaponBonusDamage).toBe("1d6");
    expect(c.weaponDamageType).toBe("fire");
  });

  it("drops passives + aura when the player sheathes the Sun Sword", () => {
    const items = makeItems();
    const member = makeMember({
      equipped: { hands: "sun_sword", body: null },
    });
    const c = combatantFromMember(member, items);
    member.equipped.hands = "sword";
    refreshCombatantGear(c, member, items);
    expect(c.passives).toBeUndefined();
    expect(c.wieldAuraColor).toBeUndefined();
    expect(c.weaponBonusDamage).toBeUndefined();
    expect(c.weaponDamageType).toBeUndefined();
  });
});

// ── Race-passive movement bonuses (Elf Nimble) ──────────────────

/** Compact Ability fixture mirroring the shape abilities.json
 *  hydrates to — only the fields the bridge consumes (id + params)
 *  carry real values. */
function ability(id: string, params: Record<string, unknown> | null): Ability {
  return {
    id,
    name: id,
    animation_id: null,
    type: "race",
    description: "",
    duration: "permanent",
    usable_in: [],
    params,
  };
}

/** Catalog with the shipped race-movement passive plus a few
 *  shapes the aggregator needs to ignore cleanly (passive with no
 *  movement keys, ability whose params are null). */
const nimble = ability("nimble", { extra_range: 3, post_attack_range: 2 });
const infravision = ability("infravision", null);
const fastLearner = ability("fast_learner", { note: "XP curve" });

const races = new Map<string, { abilities?: ReadonlyArray<string> }>([
  ["elf", { abilities: ["nimble"] }],
  ["human", { abilities: [] }],
  ["dwarf", { abilities: ["infravision"] }],
]);

describe("raceMovementBonuses (pure helper)", () => {
  it("aggregates Nimble's extra_range and post_attack_range from the params bag", () => {
    expect(raceMovementBonuses(["nimble"], [nimble])).toEqual({
      extraMove: 3,
      postAttackMove: 2,
    });
  });

  it("returns zeroes when the race grants no abilities", () => {
    expect(raceMovementBonuses([], [nimble])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
    expect(raceMovementBonuses(undefined, [nimble])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
  });

  it("returns zeroes when the abilities catalog is missing or empty", () => {
    expect(raceMovementBonuses(["nimble"], undefined)).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
    expect(raceMovementBonuses(["nimble"], [])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
  });

  it("ignores granted abilities whose params declare no movement keys", () => {
    // Dwarf Infravision (params: null) and Halfling Fast Learner
    // (params: { note: ... }) shouldn't contribute movement, even
    // though they're race-granted. The aggregator silently skips
    // them.
    expect(raceMovementBonuses(["infravision"], [infravision])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
    expect(raceMovementBonuses(["fast_learner"], [fastLearner])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
  });

  it("ignores granted ability ids that don't resolve in the catalog", () => {
    // Forward-compat: a race that mentions an ability the module's
    // abilities.json doesn't carry shouldn't blow up the build.
    expect(raceMovementBonuses(["ghost_movement"], [nimble])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
  });

  it("sums contributions across multiple granted abilities", () => {
    // Hypothetical race that grants both Nimble AND a custom
    // "Spring Heeled" passive — the bridge should add the two
    // contributions together, not pick the first.
    const springHeeled = ability("spring_heeled", {
      extra_range: 1,
      post_attack_range: 1,
    });
    expect(
      raceMovementBonuses(["nimble", "spring_heeled"], [nimble, springHeeled]),
    ).toEqual({ extraMove: 4, postAttackMove: 3 });
  });

  it("rejects non-numeric / non-finite params (defensive against bad JSON)", () => {
    const broken = ability("broken_movement", {
      extra_range: "lots",
      post_attack_range: Infinity,
    });
    expect(raceMovementBonuses(["broken_movement"], [broken])).toEqual({
      extraMove: 0,
      postAttackMove: 0,
    });
  });
});

describe("combatantFromMember — race-passive stamping", () => {
  it("stamps extraMoveRange + postAttackMove on an Elf with Nimble", () => {
    const items = new Map<string, Item>();
    const c = combatantFromMember(
      makeMember({ race: "elf" }),
      items,
      undefined,
      { races, abilities: [nimble] },
    );
    expect(c.extraMoveRange).toBe(3);
    expect(c.postAttackMove).toBe(2);
  });

  it("leaves both fields undefined for a Human (no race passive)", () => {
    const items = new Map<string, Item>();
    const c = combatantFromMember(
      makeMember({ race: "human" }),
      items,
      undefined,
      { races, abilities: [nimble] },
    );
    expect(c.extraMoveRange).toBeUndefined();
    expect(c.postAttackMove).toBeUndefined();
  });

  it("leaves both fields undefined for a Dwarf (Infravision has no movement keys)", () => {
    const items = new Map<string, Item>();
    const c = combatantFromMember(
      makeMember({ race: "dwarf" }),
      items,
      undefined,
      { races, abilities: [nimble, infravision] },
    );
    expect(c.extraMoveRange).toBeUndefined();
    expect(c.postAttackMove).toBeUndefined();
  });

  it("survives a missing ctx (legacy callers / fixtures)", () => {
    const items = new Map<string, Item>();
    const c = combatantFromMember(makeMember({ race: "elf" }), items);
    expect(c.extraMoveRange).toBeUndefined();
    expect(c.postAttackMove).toBeUndefined();
  });

  it("survives a ctx with abilities but no races", () => {
    // A defensive shape — missing races map shouldn't crash.
    const items = new Map<string, Item>();
    const c = combatantFromMember(
      makeMember({ race: "elf" }),
      items,
      undefined,
      { abilities: [nimble] },
    );
    expect(c.extraMoveRange).toBeUndefined();
    expect(c.postAttackMove).toBeUndefined();
  });
});
