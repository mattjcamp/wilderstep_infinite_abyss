import { describe, it, expect } from "vitest";
import { getFxFieldConfig } from "./fxFields";

describe("getFxFieldConfig", () => {
  it("recognizes fx_id on all four record models", () => {
    for (const m of ["spells", "abilities", "items", "effects"]) {
      expect(getFxFieldConfig("fx_id", m)).not.toBeNull();
    }
  });

  it("recognizes fx_id without a modelKey", () => {
    expect(getFxFieldConfig("fx_id")).not.toBeNull();
  });

  it("returns null for unrelated or retired field names", () => {
    expect(getFxFieldConfig("description")).toBeNull();
    expect(getFxFieldConfig("hit_sfx")).toBeNull();
    expect(getFxFieldConfig("animation_id")).toBeNull();
  });
});
