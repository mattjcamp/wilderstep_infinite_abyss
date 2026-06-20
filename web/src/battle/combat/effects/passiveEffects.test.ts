/**
 * Passive trait handlers on the effect runtime — regen (round-tick
 * heal), fire_resistance (incoming-damage halving), and poison_immunity
 * (the immunity gate). These mechanics used to be hardcoded in the
 * combat engine (`tickPassives` / `hasPassive`); the tests lock the
 * behaviour now that it lives in the registry.
 */

import { describe, it, expect } from "vitest";
import "./passiveEffects"; // register the handlers
import {
  tickRoundEffects,
  applyIncomingDamageMods,
  isImmuneTo,
  type EffectHost,
} from "./EffectRuntime";
import { Combat } from "../Combat";
import { mulberry32 } from "../../rng";
import type { Combatant } from "../../types";

function makeCombatant(over: Partial<Combatant> = {}): Combatant {
  return {
    id: "c?",
    name: "Troll",
    side: "enemies",
    maxHp: 20,
    hp: 20,
    ac: 12,
    attackBonus: 4,
    damage: { dice: 1, sides: 6, bonus: 2 },
    dexMod: 1,
    strength: 12,
    dexterity: 12,
    constitution: 12,
    intelligence: 10,
    wisdom: 10,
    color: [100, 100, 100],
    baseMoveRange: 4,
    position: { col: 0, row: 0 },
    ...over,
  };
}

function stubHost(): { host: EffectHost; logs: string[] } {
  const logs: string[] = [];
  const host: EffectHost = {
    rng: () => 0,
    log: (l) => logs.push(l),
    combatantById: () => null,
    findFreeTileNear: (p) => p,
    emitEvent: () => {},
    removeEffect: () => {},
  };
  return { host, logs };
}

describe("regen passive", () => {
  it("heals `amount` HP on the round tick and logs it", () => {
    const c = makeCombatant({ hp: 10, maxHp: 20, passives: [{ type: "regen", amount: 3 }] });
    const { host, logs } = stubHost();
    tickRoundEffects(host, c);
    expect(c.hp).toBe(13);
    expect(logs).toContain("Troll regenerates 3 HP.");
  });

  it("caps at maxHp", () => {
    const c = makeCombatant({ hp: 19, maxHp: 20, passives: [{ type: "regen", amount: 3 }] });
    const { host } = stubHost();
    tickRoundEffects(host, c);
    expect(c.hp).toBe(20);
  });

  it("does nothing (and logs nothing) at full HP", () => {
    const c = makeCombatant({ hp: 20, maxHp: 20, passives: [{ type: "regen", amount: 3 }] });
    const { host, logs } = stubHost();
    tickRoundEffects(host, c);
    expect(c.hp).toBe(20);
    expect(logs).toEqual([]);
  });
});

describe("fire_resistance passive", () => {
  it("halves fire-kind damage (floor, min 1) and logs", () => {
    const c = makeCombatant({ name: "Drake", passives: [{ type: "fire_resistance" }] });
    const { host, logs } = stubHost();
    expect(applyIncomingDamageMods(host, c, 10, "fire")).toBe(5);
    expect(logs).toContain("Drake's fire resistance halves 10 → 5.");
    expect(applyIncomingDamageMods(host, c, 1, "fire")).toBe(1); // floor → min 1
  });

  it("leaves non-fire damage untouched", () => {
    const c = makeCombatant({ passives: [{ type: "fire_resistance" }] });
    const { host } = stubHost();
    expect(applyIncomingDamageMods(host, c, 10, "physical")).toBe(10);
  });

  it("is a no-op for a combatant without the trait", () => {
    const c = makeCombatant({});
    const { host } = stubHost();
    expect(applyIncomingDamageMods(host, c, 10, "fire")).toBe(10);
  });
});

describe("poison_immunity passive", () => {
  it("makes the bearer immune to the poisoned effect", () => {
    const immune = makeCombatant({ passives: [{ type: "poison_immunity" }] });
    expect(isImmuneTo(immune, "poisoned")).toBe(true);
    expect(isImmuneTo(immune, "consumed")).toBe(false);
    expect(isImmuneTo(makeCombatant({}), "poisoned")).toBe(false);
  });
});

describe("regen wiring through Combat round tick", () => {
  it("heals a wounded regen monster once per full round", () => {
    const troll = makeCombatant({
      id: "troll", name: "Troll", side: "enemies",
      hp: 10, maxHp: 20, dexMod: 20, // win initiative (deterministic order)
      passives: [{ type: "regen", amount: 4 }],
    });
    const hero = makeCombatant({ id: "hero", name: "Hero", side: "party" });
    const combat = new Combat([hero], [troll], mulberry32(1));
    troll.position = { col: 1, row: 1 };
    hero.position = { col: 8, row: 8 };

    // Advance a full round (2 combatants → 2 endTurns triggers the tick).
    combat.endTurn();
    combat.endTurn();
    expect(troll.hp).toBe(14);
    expect(combat.log.some((l) => l.includes("Troll regenerates 4 HP."))).toBe(true);
  });
});
