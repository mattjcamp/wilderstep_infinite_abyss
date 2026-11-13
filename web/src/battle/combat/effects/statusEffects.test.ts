/**
 * Status effects on the runtime: poisoned (round-tick damage + expiry),
 * sleep (skipped turns, wake on damage), charm (side flip + revert),
 * slowed (halved movement), plus the logging / floating-label events.
 */

import { describe, it, expect } from "vitest";
import "./passiveEffects";
import { cureStatus, slowedMovePoints } from "./statusEffects";
import {
  applyEffect,
  findEffect,
  runControlledTurn,
  setEffectCatalogDefaults,
  tickRoundEffects,
  turnControllingEffect,
  type ConsumeEvent,
  type EffectHost,
} from "./EffectRuntime";
import type { Combatant } from "../../types";

function mk(over: Partial<Combatant> = {}): Combatant {
  return {
    id: "c1",
    name: "Pip",
    side: "party",
    maxHp: 20,
    hp: 20,
    ac: 12,
    attackBonus: 2,
    damage: { dice: 1, sides: 6, bonus: 0 },
    dexMod: 0,
    color: [1, 1, 1],
    baseMoveRange: 4,
    position: { col: 1, row: 1 },
    ...over,
  };
}

function host(roster: Combatant[] = []): { host: EffectHost; logs: string[]; events: ConsumeEvent[] } {
  const logs: string[] = [];
  const events: ConsumeEvent[] = [];
  return {
    logs,
    events,
    host: {
      rng: () => 0.5,
      log: (l) => logs.push(l),
      combatantById: (id) => roster.find((c) => c.id === id) ?? null,
      findFreeTileNear: (p) => p,
      emitEvent: (e) => events.push(e),
      removeEffect: (b, e) => {
        b.effects = (b.effects ?? []).filter((x) => x !== e);
      },
    },
  };
}

describe("poisoned", () => {
  it("deals damage each round, logs every tick, then wears off", () => {
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "poisoned", { params: { duration: 2, damage_per_turn: 3 } });
    expect(h.logs).toContain("Pip is poisoned!");
    tickRoundEffects(h.host, c);
    expect(c.hp).toBe(17);
    tickRoundEffects(h.host, c);
    expect(c.hp).toBe(14);
    expect(findEffect(c, "poisoned")).toBeUndefined();
    expect(h.logs).toEqual([
      "Pip is poisoned!",
      "Pip takes 3 poison damage.",
      "Pip takes 3 poison damage.",
      "Pip is no longer poisoned.",
    ]);
    expect(h.events.some((e) => e.kind === "status" && e.text === "-3 poison")).toBe(true);
  });

  it("uses effects.json defaults when the applier gives none", () => {
    setEffectCatalogDefaults([{ id: "poisoned", duration: 1, params: { damage_per_turn: 5 } }]);
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "poisoned");
    tickRoundEffects(h.host, c);
    expect(c.hp).toBe(15);
    expect(findEffect(c, "poisoned")).toBeUndefined();
    setEffectCatalogDefaults([]);
  });

  it("re-poisoning refreshes instead of stacking; immunity blocks it", () => {
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "poisoned", { params: { duration: 2 } });
    applyEffect(h.host, c, "poisoned", { params: { duration: 4 } });
    expect(c.effects?.filter((e) => e.effectId === "poisoned")).toHaveLength(1);
    expect(findEffect(c, "poisoned")?.state.turnsLeft).toBe(4);
    const imm = mk({ passives: [{ type: "poison_immunity" } as never] });
    expect(applyEffect(h.host, imm, "poisoned")).toBeNull();
    expect(h.logs).toContain("Pip is immune to poison.");
  });

  it("cureStatus removes it with a log line", () => {
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "poisoned");
    expect(cureStatus(h.host.log, c, "poisoned")).toBe(true);
    expect(findEffect(c, "poisoned")).toBeUndefined();
    expect(h.logs).toContain("Pip is cured of poison.");
  });
});

describe("sleep", () => {
  it("skips the bearer's turns, then wakes", () => {
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "sleep", { params: { duration: 2 } });
    expect(turnControllingEffect(h.host, c)).not.toBeNull();
    runControlledTurn(h.host, c);
    expect(h.logs.at(-1)).toBe("Pip is fast asleep and loses the turn.");
    runControlledTurn(h.host, c);
    expect(findEffect(c, "sleep")).toBeUndefined();
    expect(turnControllingEffect(h.host, c)).toBeNull();
  });

  it("taking damage wakes the sleeper at their next turn", () => {
    const c = mk();
    const h = host();
    applyEffect(h.host, c, "sleep", { params: { duration: 3 } });
    c.hp -= 4;
    expect(turnControllingEffect(h.host, c)).toBeNull();
    expect(h.logs).toContain("Pip is jolted awake by the pain!");
    expect(findEffect(c, "sleep")).toBeUndefined();
  });
});

describe("charm", () => {
  it("turns the bearer to the caster's side, then reverts", () => {
    const caster = mk({ id: "p1", name: "Mira", side: "party" });
    const orc = mk({ id: "e1", name: "Orc", side: "enemies" });
    const h = host([caster, orc]);
    applyEffect(h.host, orc, "charm", { sourceId: "p1", params: { duration: 1 } });
    expect(orc.side).toBe("party");
    expect(orc.aiControlled).toBe(true);
    tickRoundEffects(h.host, orc);
    expect(orc.side).toBe("enemies");
    expect(orc.aiControlled).toBeUndefined();
    expect(h.logs).toContain("Orc shakes off the charm and returns to its own side.");
  });
});

describe("slowed", () => {
  it("halves movement while active", () => {
    const c = mk();
    const h = host();
    expect(slowedMovePoints(c, 6)).toBe(6);
    applyEffect(h.host, c, "slowed", { params: { duration: 1 } });
    expect(slowedMovePoints(c, 6)).toBe(3);
    expect(slowedMovePoints(c, 1)).toBe(1);
    tickRoundEffects(h.host, c);
    expect(slowedMovePoints(c, 6)).toBe(6);
  });
});
