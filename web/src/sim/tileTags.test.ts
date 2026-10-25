import { describe, expect, it } from "vitest";
import { isWaterCell, isWaterTag } from "./tileTags";

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

describe("isWaterCell", () => {
  it("reads the water flag, independent of the tag", () => {
    expect(isWaterCell({ water: true, tag: "overview" })).toBe(true);
    expect(isWaterCell({ water: false, tag: "overview" })).toBe(false);
  });
  it("still honours legacy water tags", () => {
    expect(isWaterCell({ tag: "water" })).toBe(true);
  });
  it("is false for missing cells", () => {
    expect(isWaterCell(undefined)).toBe(false);
  });
});
