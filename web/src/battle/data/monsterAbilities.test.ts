/**
 * Monster abilities catalog (monster_abilities.json): every monster's
 * `abilities` links resolve, every ability has a known behavior and a
 * real FX, and per-monster overrides beat the catalog defaults. Then
 * one cast per behavior through the combat engine, so a change to any
 * of the ten behaviors shows up here.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  abilityLinkToSpell,
  setMonsterAbilities,
  specFromRaw,
  type MonsterSpell,
} from "./monsters";
import { Combat } from "../combat/Combat";
import { findEffect } from "../combat/effects/EffectRuntime";
import type { Combatant } from "../types";

const dir = path.join(__dirname, "../../../public/modules/default");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const abilities = read("monster_abilities.json").monster_abilities as Array<Record<string, unknown>>;
const monsters = read("monsters.json").monsters as Array<Record<string, unknown>>;
const fxIds = new Set((read("fx.json").fx as Array<{ id: string }>).map((r) => r.id));

const BEHAVIORS = ["damage", "sleep", "curse", "poison", "heal_self", "heal_ally"];

beforeAll(() => setMonsterAbilities({ monster_abilities: abilities }));

describe("monster_abilities.json", () => {
  it("has unique ids, known behaviors and real FX", () => {
    const ids = abilities.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of abilities) {
      expect(BEHAVIORS, `${a.id}.effect_type`).toContain(a.effect_type);
      if (a.effect_type === "damage") expect(a.damage_type, `${a.id}.damage_type`).toBeTruthy();
      if (a.fx_id) expect(fxIds.has(a.fx_id as string), `${a.id}.fx_id`).toBe(true);
    }
  });

  it("every monster link resolves to a spell", () => {
    for (const m of monsters) {
      const links = (m.abilities as Array<{ ability_id: string }>) ?? [];
      const spec = specFromRaw(m as never)!;
      expect(spec.spells?.length ?? 0, `${m.id}`).toBe(links.length);
    }
  });

  it("per-monster overrides win over the catalog", () => {
    const base = abilityLinkToSpell({ ability_id: "lightning_bolt", cast_chance: 20 })!;
    const king = abilityLinkToSpell({ ability_id: "lightning_bolt", cast_chance: 15, damage_bonus: 2, name: "Storm Call" })!;
    expect(base.type).toBe("damage");
    expect(base.damage_type).toBe("lightning");
    expect(base.damage_bonus).toBe(0);
    expect(king.damage_bonus).toBe(2);
    expect(king.cast_chance).toBe(15);
    expect(king.name).toBe("Storm Call");
    expect(king.fx_id).toBe("lightning_strike");
    expect(abilityLinkToSpell({ ability_id: "nope", cast_chance: 50 })).toBeNull();
  });

  it("legacy inline spells still load, old damage types map to damage", () => {
    const spec = specFromRaw({
      id: "old", name: "Old",
      spells: [
        { type: "sleep", name: "Nap", cast_chance: 10, save_dc: 10 },
        { type: "breath_fire", name: "Breath", cast_chance: 10, damage_dice: 2, damage_sides: 6 },
      ],
    } as never)!;
    expect(spec.spells?.[0].name).toBe("Nap");
    expect(spec.spells?.[1]).toMatchObject({ type: "damage", damage_type: "fire", fx_id: "dragon_breath" });
  });
});

// ── One cast per behavior ────────────────────────────────────────────

function mk(over: Partial<Combatant>): Combatant {
  return {
    id: "x", name: "X", side: "party", maxHp: 60, hp: 60, ac: 12, attackBonus: 2,
    damage: { dice: 1, sides: 6, bonus: 0 }, dexMod: 0, color: [1, 1, 1],
    baseMoveRange: 4, position: { col: 1, row: 1 }, wisdom: 10, constitution: 10,
    ...over,
  };
}

/** Cast `spell` from a monster at the hero (or an ally / itself),
 *  with every die roll pinned to `roll` (1–20 scale). */
function cast(spell: MonsterSpell, roll: number, targetId = "hero") {
  const hero = mk({ id: "hero", name: "Hero" });
  const caster = mk({ id: "mon", name: "Mon", side: "enemies", hp: 20, monsterSpells: [spell] });
  const ally = mk({ id: "ally", name: "Ally", side: "enemies", hp: 10, position: { col: 2, row: 1 } });
  const combat = new Combat([hero], [caster, ally]);
  const c = combat as unknown as { rng: () => number; cursor: number; initiativeOrder: Array<{ combatantId: string }> };
  c.cursor = c.initiativeOrder.findIndex((r) => r.combatantId === "mon");
  c.rng = () => (roll - 1) / 20;
  const r = combat.castMonsterSpell(0, targetId);
  return { hero, caster, ally, r };
}

const spellOf = (id: string) => abilityLinkToSpell({ ability_id: id, cast_chance: 100 })!;
const byBehavior = (t: string) => abilities.find((a) => a.effect_type === t)!.id as string;

describe("monster ability behaviors", () => {
  it("damage hits the target", () => {
    const { hero, r } = cast(spellOf("lightning_bolt"), 10);
    expect(r.damage).toBeGreaterThan(0);
    expect(hero.hp).toBe(60 - r.damage);
  });

  it("damage with a save_dc: failed DEX save takes it all", () => {
    // 6d6 at roll 2 → each die floor(0.05*6)+1 = 1 → 6 damage; save 2 < 15.
    const { hero, r } = cast(spellOf("fire_breath"), 2);
    expect(r.damage).toBe(6);
    expect(hero.hp).toBe(54);
  });

  it("damage with a save_dc: made DEX save halves it", () => {
    // 6d6 at roll 20 → each die 6 → 36; save 20 ≥ 15 → 18.
    const hero = mk({ id: "hero", name: "Hero" });
    const caster = mk({ id: "mon", name: "Mon", side: "enemies", monsterSpells: [spellOf("fire_breath")] });
    const combat = new Combat([hero], [caster]);
    const c = combat as unknown as { rng: () => number; cursor: number; initiativeOrder: Array<{ combatantId: string }> };
    c.cursor = c.initiativeOrder.findIndex((x) => x.combatantId === "mon");
    c.rng = () => 0.999;
    const before = combat.log.length;
    const r = combat.castMonsterSpell(0, "hero");
    expect(r.damage).toBe(18);
    expect(combat.log.slice(before)).toEqual([
      "Mon casts Fire Breath at Hero!",
      "Hero dodges half the Fire Breath! (DEX save 20+0=20 vs DC 15)",
      "Hero takes 18 damage.",
    ]);
  });

  it("damage without a save_dc never rolls a save", () => {
    const hero = mk({ id: "hero", name: "Hero" });
    const caster = mk({ id: "mon", name: "Mon", side: "enemies", monsterSpells: [spellOf("thunder_gust")] });
    const combat = new Combat([hero], [caster]);
    const c = combat as unknown as { rng: () => number; cursor: number; initiativeOrder: Array<{ combatantId: string }> };
    c.cursor = c.initiativeOrder.findIndex((x) => x.combatantId === "mon");
    c.rng = () => 0.999;
    const before = combat.log.length;
    combat.castMonsterSpell(0, "hero");
    expect(combat.log.slice(before)).toEqual(["Mon casts Thunder Gust at Hero! Hero takes 12 damage."]);
  });

  it("fire damage is reduced by fire resistance (damage_type matters)", () => {
    const hit = (passives: unknown[]) => {
      const hero = mk({ id: "hero", name: "Hero", passives: passives as never });
      const caster = mk({ id: "mon", name: "Mon", side: "enemies", monsterSpells: [spellOf("hellfire")] });
      const combat = new Combat([hero], [caster]);
      const c = combat as unknown as { rng: () => number; cursor: number; initiativeOrder: Array<{ combatantId: string }> };
      c.cursor = c.initiativeOrder.findIndex((x) => x.combatantId === "mon");
      c.rng = () => 0.45; // dice roll 3s, save 10 < DC 13
      return combat.castMonsterSpell(0, "hero").damage;
    };
    const plain = hit([]);
    expect(plain).toBe(9);
    expect(hit([{ type: "fire_resistance" }])).toBeLessThan(plain);
  });

  it("sleep lands on a failed save", () => {
    const { hero } = cast(spellOf(byBehavior("sleep")), 2);
    expect(findEffect(hero, "sleep")).toBeDefined();
  });

  it("sleep is resisted on a high save", () => {
    const { hero } = cast(spellOf(byBehavior("sleep")), 20);
    expect(findEffect(hero, "sleep")).toBeUndefined();
  });

  it("poison lands on a failed save", () => {
    const { hero } = cast(spellOf(byBehavior("poison")), 2);
    expect(findEffect(hero, "poisoned")).toBeDefined();
  });

  it("curse logs the curse", () => {
    const spell = spellOf(byBehavior("curse"));
    const hero = mk({ id: "hero", name: "Hero" });
    const caster = mk({ id: "mon", name: "Mon", side: "enemies", monsterSpells: [spell] });
    const combat = new Combat([hero], [caster]);
    const c = combat as unknown as { rng: () => number; cursor: number; initiativeOrder: Array<{ combatantId: string }> };
    c.cursor = c.initiativeOrder.findIndex((r) => r.combatantId === "mon");
    c.rng = () => 0.1;
    combat.castMonsterSpell(0, "hero");
    expect(combat.log.some((l) => l.includes("is cursed"))).toBe(true);
  });

  it("heal_ally heals the wounded ally", () => {
    const { ally, r } = cast(spellOf(byBehavior("heal_ally")), 10, "ally");
    expect(r.heal).toBeGreaterThan(0);
    expect(ally.hp).toBe(10 + r.heal);
  });

  it("heal_self heals the caster", () => {
    const { caster, r } = cast(spellOf(byBehavior("heal_self")), 10, "mon");
    expect(r.heal).toBeGreaterThan(0);
    expect(caster.hp).toBe(20 + r.heal);
  });
});
