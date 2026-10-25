import { describe, expect, it } from "vitest";
import { isWaterTag } from "./tileTags";

describe("isWaterTag", () => {
  it("matches plain and grouped water tags", () => {
    expect(isWaterTag("water")).toBe(true);
    expect(isWaterTag("overview: water")).toBe(true);
    expect(isWaterTag("Overview: Water")).toBe(true);
  });
  it("rejects other tags and empty values", () => {
    expect(isWaterTag("overview")).toBe(false);
    expect(isWaterTag("water: deep")).toBe(false);
    expect(isWaterTag("")).toBe(false);
    expect(isWaterTag(undefined)).toBe(false);
  });
});
