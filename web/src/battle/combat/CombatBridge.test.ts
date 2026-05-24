import { describe, it, expect } from "vitest";
import {
  combatStatsFor,
  combatantFromMember,
  refreshCombatantGear,
} from "./CombatBridge";
import type { PartyMember } from "../world/Party";
import type { Item } from "../world/Items";

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
  it("upgrades the wielder's damage die from 1d6 to 1d10", () => {
    // damageForWeapon's power tier table:
    //   power 4-5 → 1d6 (Sword sits here)
    //   power 9+  → 1d10 (Sun Sword)
    // STR 10 → mod 0 so the dice are bare.
    const items = makeItems();
    const swordHero = makeMember({ equipped: { hands: "sword", body: null } });
    const sunHero = makeMember({ equipped: { hands: "sun_sword", body: null } });
    const swordStats = combatStatsFor(swordHero, items);
    const sunStats = combatStatsFor(sunHero, items);
    expect(swordStats.damage).toEqual({ dice: 1, sides: 6, bonus: 0 });
    expect(sunStats.damage).toEqual({ dice: 1, sides: 10, bonus: 0 });
    // Average roll: sword 3.5 vs Sun Sword 5.5 — a 57% bump on the
    // BASE die alone, before the 1d6 fire bonus rolled per swing.
    expect(sunStats.damage.sides).toBeGreaterThan(swordStats.damage.sides);
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
