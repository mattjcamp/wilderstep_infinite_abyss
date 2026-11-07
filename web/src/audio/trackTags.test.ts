import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACK_TAG,
  allTrackTags,
  compareTrackTags,
  groupTracksByTag,
  trackTagsOf,
} from "./trackTags";

describe("trackTagsOf", () => {
  it("defaults missing or empty tags to Ambient", () => {
    expect(DEFAULT_TRACK_TAG).toBe("Ambient");
    expect(trackTagsOf(undefined)).toEqual(["Ambient"]);
    expect(trackTagsOf([])).toEqual(["Ambient"]);
    expect(trackTagsOf(["  ", 3])).toEqual(["Ambient"]);
  });

  it("trims, drops junk and de-duplicates, keeping order", () => {
    expect(trackTagsOf([" Battle", "Town", "Battle", null])).toEqual([
      "Battle",
      "Town",
    ]);
  });
});

describe("compareTrackTags / allTrackTags", () => {
  it("puts Ambient first, then alphabetical", () => {
    expect(["town", "Ambient", "Battle"].sort(compareTrackTags)).toEqual([
      "Ambient",
      "Battle",
      "town",
    ]);
    expect(
      allTrackTags([{ tags: ["Town"] }, {}, { tags: ["Battle", "Town"] }]),
    ).toEqual(["Ambient", "Battle", "Town"]);
  });
});

describe("groupTracksByTag", () => {
  it("lists a multi-tag track under each tag and untagged under Ambient", () => {
    const a = { path: "a", tags: ["Battle", "Dungeon"] };
    const b = { path: "b" };
    const c = { path: "c", tags: ["Dungeon"] };
    expect(groupTracksByTag([a, b, c])).toEqual([
      ["Ambient", [b]],
      ["Battle", [a]],
      ["Dungeon", [a, c]],
    ]);
  });
});
