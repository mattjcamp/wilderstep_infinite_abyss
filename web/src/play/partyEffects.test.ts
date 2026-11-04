import { describe, it, expect } from "vitest";
import { isPartyEffectActive, reconcilePartyEffects } from "./partyEffects";

describe("isPartyEffectActive", () => {
  const durations = new Map([["magic_light", 0], ["torch", 12]]);
  it("a burnt-out timed effect reads as off even if still listed", () => {
    expect(isPartyEffectActive("magic_light", ["magic_light"], durations)).toBe(false);
  });
  it("a running timed effect reads as on", () => {
    expect(isPartyEffectActive("torch", [], durations)).toBe(true);
  });
  it("untimed effects follow the active list", () => {
    expect(isPartyEffectActive("infravision", ["infravision"], durations)).toBe(true);
    expect(isPartyEffectActive("infravision", [], durations)).toBe(false);
  });
});

describe("reconcilePartyEffects", () => {
  it("drops expired timed effects and disengaged infravision, keeps the rest", () => {
    expect(
      reconcilePartyEffects(
        ["magic_light", "torch", "repel_monsters", "infravision", "other"],
        { magic_light_steps: 0, torch_steps: 5, repel_monsters_steps: 0, infravision_active: false },
      ),
    ).toEqual(["torch", "other"]);
  });
});
