import { describe, expect, it } from "vitest";
import { normalizeTags } from "./recordTags";

describe("normalizeTags", () => {
  it("passes arrays through, dropping non-strings and blanks", () => {
    expect(normalizeTags(["a", "", 3, "b"])).toEqual(["a", "b"]);
  });
  it("decodes a JSON-encoded string array (legacy bad save)", () => {
    expect(normalizeTags('["Mutated Animal"]')).toEqual(["Mutated Animal"]);
  });
  it("splits a plain comma list", () => {
    expect(normalizeTags("undead, cave")).toEqual(["undead", "cave"]);
  });
  it("treats null/undefined/empty as no tags", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags("")).toEqual([]);
  });
});
