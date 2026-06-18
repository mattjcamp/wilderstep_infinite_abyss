/**
 * Validates the new high-level spells in the default module's
 * spells.json hydrate into the shape the runtime expects. Reads the
 * shipped catalog from disk (vitest runs with cwd = web/) and runs it
 * through the same `spellFromRaw` the loader uses.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { spellFromRaw, type Spell } from "./Spells";

function loadCatalog(): Map<string, Spell> {
  const raw = JSON.parse(
    readFileSync("public/modules/default/spells.json", "utf8"),
  ) as { spells?: Array<Parameters<typeof spellFromRaw>[0]> };
  const out = new Map<string, Spell>();
  for (const s of raw.spells ?? []) {
    const hydrated = spellFromRaw(s);
    out.set(hydrated.id, hydrated);
  }
  return out;
}

describe("new high-level spells (spells.json)", () => {
  const byId = loadCatalog();

  it("ships all six new spells", () => {
    for (const id of [
      "recall",
      "meteor_shower",
      "void_orb",
      "daylight",
      "divine_smite",
      "resurrection",
    ]) {
      expect(byId.has(id), `missing spell: ${id}`).toBe(true);
    }
  });

  it("Recall is a sorcerer L8 out-of-combat party teleport", () => {
    const s = byId.get("recall")!;
    expect(s.casting_type).toBe("sorcerer");
    expect(s.min_level).toBe(8);
    expect(s.action).toBe("teleport");
    expect(s.usable_in).toEqual(["party"]);
    expect(s.usable_in.includes("battle")).toBe(false);
  });

  it("Meteor Shower auto-targets all enemies (mass-enemy)", () => {
    const s = byId.get("meteor_shower")!;
    expect(s.casting_type).toBe("sorcerer");
    expect(s.min_level).toBe(9);
    expect(s.action).toBe("damage");
    expect(s.targeting).toBe("auto_monster");
    expect(s.effect_value?.dice_count).toBe(8);
    expect(s.effect_value?.dice_sides).toBe(8);
  });

  it("Void Orb is a single-target sorcerer nuke", () => {
    const s = byId.get("void_orb")!;
    expect(s.min_level).toBe(10);
    expect(s.action).toBe("damage");
    expect(s.targeting).toBe("select_enemy");
    // Tuned down from 12d12 so it no longer one-shots 80-HP elites.
    expect(s.effect_value?.dice_count).toBe(10);
    expect(s.effect_value?.dice_sides).toBe(12);
  });

  it("high-tier nukes cost enough to limit one cast per fight", () => {
    // Tuned so a single cast empties enough of a level-10 caster's
    // pool that a second cast is impossible (cost > half max MP).
    expect(byId.get("meteor_shower")!.mp_cost).toBe(70);
    expect(byId.get("void_orb")!.mp_cost).toBe(80);
    expect(byId.get("divine_smite")!.mp_cost).toBe(60);
  });

  it("Daylight is a self-cast combat lighting spell", () => {
    const s = byId.get("daylight")!;
    expect(s.casting_type).toBe("priest");
    expect(s.min_level).toBe(8);
    expect(s.action).toBe("daylight");
    expect(s.effect_type).toBe("daylight");
    expect(s.targeting).toBe("self");
    expect(s.usable_in).toEqual(["battle"]);
  });

  it("Divine Smite carries the anti-undead multiplier", () => {
    const s = byId.get("divine_smite")!;
    expect(s.min_level).toBe(9);
    expect(s.action).toBe("damage");
    expect(s.targeting).toBe("select_enemy");
    expect(s.effect_value?.stat_bonus).toBe("wisdom");
    expect(s.effect_value?.vs_undead_multiplier).toBe(1.5);
  });

  it("Resurrection is a priest L10 out-of-combat revive", () => {
    const s = byId.get("resurrection")!;
    expect(s.casting_type).toBe("priest");
    expect(s.min_level).toBe(10);
    expect(s.action).toBe("revive");
    expect(s.usable_in).toEqual(["party"]);
    expect(s.effect_value?.heal_percent).toBe(0.5);
  });
});
