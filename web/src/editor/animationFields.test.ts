import { describe, it, expect } from "vitest";
import { getAnimationFieldConfig } from "./animationFields";

describe("getAnimationFieldConfig", () => {
  it("recognizes animation_id on all four record models", () => {
    expect(getAnimationFieldConfig("animation_id", "spells")).not.toBeNull();
    expect(getAnimationFieldConfig("animation_id", "abilities")).not.toBeNull();
    expect(getAnimationFieldConfig("animation_id", "items")).not.toBeNull();
    expect(getAnimationFieldConfig("animation_id", "effects")).not.toBeNull();
  });

  it("recognizes animation_id without a modelKey (the global default)", () => {
    expect(getAnimationFieldConfig("animation_id")).not.toBeNull();
  });

  it("returns null for unrelated field names", () => {
    expect(getAnimationFieldConfig("description")).toBeNull();
    expect(getAnimationFieldConfig("sprite")).toBeNull();
    expect(getAnimationFieldConfig("hit_sfx")).toBeNull();
  });

  it("returns null for unknown field names with no global match", () => {
    expect(getAnimationFieldConfig("nope_not_a_field", "spells")).toBeNull();
  });
});
