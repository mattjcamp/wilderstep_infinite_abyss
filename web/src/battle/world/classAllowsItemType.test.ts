import { describe, expect, it } from "vitest";
import { classAllowsItemType } from "./Classes";

// Cleric's real allowlist from the default module.
const cleric = ["fists", "club", "mace", "sling", "cloth", "leather", "chain", "wand"];

describe("classAllowsItemType", () => {
  it("blocks an item type the class doesn't allow", () => {
    expect(classAllowsItemType(cleric, "crossbow")).toBe(false);
    expect(classAllowsItemType(cleric, "sword")).toBe(false);
    expect(classAllowsItemType(cleric, "plate")).toBe(false);
  });

  it("allows an item type on the class list", () => {
    expect(classAllowsItemType(cleric, "mace")).toBe(true);
    expect(classAllowsItemType(cleric, "leather")).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(classAllowsItemType(cleric, "  MACE ")).toBe(true);
    expect(classAllowsItemType(["Crossbow"], "crossbow")).toBe(true);
  });

  it("treats an empty / missing allowlist as unrestricted", () => {
    expect(classAllowsItemType([], "crossbow")).toBe(true);
    expect(classAllowsItemType(undefined, "crossbow")).toBe(true);
    expect(classAllowsItemType(null, "crossbow")).toBe(true);
  });

  it("allows items that carry no item_type (can't be gated)", () => {
    expect(classAllowsItemType(cleric, undefined)).toBe(true);
    expect(classAllowsItemType(cleric, "")).toBe(true);
  });
});
