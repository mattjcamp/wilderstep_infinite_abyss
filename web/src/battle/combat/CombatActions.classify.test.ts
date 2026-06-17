/**
 * classifyCombatCast routing for the new high-level spells. This is the
 * function CombatScene.dispatchSpell switches on to decide how a spell
 * targets — so these assertions are the contract that Meteor Shower
 * hits every enemy (not a single directional dart), Daylight is a
 * self-cast (not a tile-placed light), and Void Orb / Divine Smite are
 * single-enemy picks.
 */

import { describe, it, expect } from "vitest";
import { classifyCombatCast } from "./CombatActions";
import { spellFromRaw } from "../world/Spells";

const mk = (raw: Parameters<typeof spellFromRaw>[0]) => spellFromRaw(raw);

describe("classifyCombatCast — new spells", () => {
  it("Meteor Shower → mass-enemy (all foes), NOT a directional dart", () => {
    const meteor = mk({
      id: "meteor_shower",
      action: "damage",
      targeting: "auto_monster",
      usable_in: ["battle"],
      action_params: { dice_count: 8, dice_sides: 8 },
    });
    expect(classifyCombatCast(meteor)).toBe("mass-enemy");
  });

  it("Void Orb → pick-enemy (single target)", () => {
    const voidOrb = mk({
      id: "void_orb",
      action: "damage",
      targeting: "select_enemy",
      usable_in: ["battle"],
    });
    expect(classifyCombatCast(voidOrb)).toBe("pick-enemy");
  });

  it("Divine Smite → pick-enemy (single target)", () => {
    const smite = mk({
      id: "divine_smite",
      action: "damage",
      targeting: "select_enemy",
      usable_in: ["battle"],
    });
    expect(classifyCombatCast(smite)).toBe("pick-enemy");
  });

  it("Daylight → self (NOT pick-tile like Light)", () => {
    const daylight = mk({
      id: "daylight",
      action: "daylight",
      targeting: "self",
      usable_in: ["battle"],
    });
    expect(classifyCombatCast(daylight)).toBe("self");
    // And its effect_type must be the discriminator the scene's
    // self-branch switches on for the arena-flood behaviour.
    expect(daylight.effect_type).toBe("daylight");
  });

  it("contrast: Light stays pick-tile, Magic Dart stays directional", () => {
    const light = mk({
      id: "light",
      action: "apply_effect",
      targeting: "select_tile",
      usable_in: ["battle"],
      action_params: { effect_id: "magic_light" },
    });
    const dart = mk({
      id: "magic_dart",
      action: "damage",
      targeting: "directional_projectile",
      usable_in: ["battle"],
    });
    expect(classifyCombatCast(light)).toBe("pick-tile");
    expect(classifyCombatCast(dart)).toBe("pick-direction");
  });
});
