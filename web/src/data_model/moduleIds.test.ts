/**
 * Module-id namespacing (UGC groundwork). These rules are the
 * "biggest sleeper risk" in the publishing plan — get aliasing wrong
 * and old saves / inheritance chains break — so the contract is
 * pinned hard here.
 */
import { describe, expect, it } from "vitest";

import {
  canExtendModule,
  isValidModuleId,
  moduleIdsEqual,
  moduleStorageSegment,
  ownerHandleOf,
  parseModuleId,
  resolveModuleIdAlias,
} from "./moduleIds";

describe("parseModuleId", () => {
  it("accepts every existing bare id shape", () => {
    for (const id of ["default", "tavern", "dragon-lair", "test3"]) {
      expect(parseModuleId(id)).toEqual({
        qualified: false,
        handle: null,
        slug: id,
      });
    }
  });

  it("accepts qualified @handle/slug ids", () => {
    expect(parseModuleId("@matt/sunken-keep")).toEqual({
      qualified: true,
      handle: "matt",
      slug: "sunken-keep",
    });
  });

  it("rejects malformed ids", () => {
    for (const bad of [
      "",
      "@", // no handle/slug
      "@matt", // no slug
      "@matt/", // empty slug
      "@/keep", // empty handle
      "@m/keep", // handle too short
      "@Matt/keep", // uppercase
      "@matt/Sunken", // uppercase slug
      "@matt/a/b", // nested slash lands in the slug and fails its grammar
      "Tavern", // bare ids are lowercase
      "-tavern", // bare ids start with a letter
      "@matt/../etc", // traversal shapes never parse
    ]) {
      expect(parseModuleId(bad), bad).toBeNull();
      expect(isValidModuleId(bad), bad).toBe(false);
    }
  });
});

describe("@core aliasing", () => {
  it("resolves @core/<x> to the bare shipped id", () => {
    expect(resolveModuleIdAlias("@core/default")).toBe("default");
    expect(resolveModuleIdAlias("@core/tavern")).toBe("tavern");
  });

  it("passes bare and player-qualified ids through", () => {
    expect(resolveModuleIdAlias("default")).toBe("default");
    expect(resolveModuleIdAlias("@matt/sunken-keep")).toBe(
      "@matt/sunken-keep",
    );
  });

  it("treats both spellings as the same module", () => {
    expect(moduleIdsEqual("@core/default", "default")).toBe(true);
    expect(moduleIdsEqual("@matt/keep", "@matt/keep")).toBe(true);
    expect(moduleIdsEqual("@matt/keep", "@core/keep")).toBe(false);
  });
});

describe("moduleStorageSegment", () => {
  it("maps ids to their storage path segment", () => {
    expect(moduleStorageSegment("default")).toBe("default");
    expect(moduleStorageSegment("@core/tavern")).toBe("tavern");
    expect(moduleStorageSegment("@matt/sunken-keep")).toBe(
      "@matt/sunken-keep",
    );
  });

  it("throws on invalid ids so they can never become paths", () => {
    expect(() => moduleStorageSegment("../etc")).toThrow();
    expect(() => moduleStorageSegment("@matt/../x")).toThrow();
  });
});

describe("ownership + v1 extends policy", () => {
  it("system modules have no owner", () => {
    expect(ownerHandleOf("default")).toBeNull();
    expect(ownerHandleOf("@core/tavern")).toBeNull();
    expect(ownerHandleOf("@matt/sunken-keep")).toBe("matt");
  });

  it("allows extending system modules and your own", () => {
    expect(canExtendModule("default", "matt")).toBe(true);
    expect(canExtendModule("@core/default", "matt")).toBe(true);
    expect(canExtendModule("@matt/base", "matt")).toBe(true);
  });

  it("rejects extending another author's module (and junk)", () => {
    expect(canExtendModule("@sara/base", "matt")).toBe(false);
    expect(canExtendModule("not a module", "matt")).toBe(false);
  });
});
