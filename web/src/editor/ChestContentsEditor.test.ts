import { describe, expect, it } from "vitest";

import { isChestContents } from "./ChestContentsEditor";

describe("isChestContents", () => {
  it("accepts empty, gold-only, items-only and mixed contents", () => {
    expect(isChestContents({})).toBe(true);
    expect(isChestContents({ gold: 50 })).toBe(true);
    expect(isChestContents({ items: [{ id: "sword" }, { id: "arrows", qty: 20 }] })).toBe(true);
    expect(isChestContents({ gold: 5, items: [] })).toBe(true);
  });

  it("rejects other shapes so the form falls back to raw JSON", () => {
    expect(isChestContents(null)).toBe(false);
    expect(isChestContents([])).toBe(false);
    expect(isChestContents({ gold: "lots" })).toBe(false);
    expect(isChestContents({ items: [{ item: "sword" }] })).toBe(false);
    expect(isChestContents({ items: "sword" })).toBe(false);
  });
});
