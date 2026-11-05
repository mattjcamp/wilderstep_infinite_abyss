import { describe, it, expect } from "vitest";
import {
  clampPartyNav,
  initialPartyNav,
  partyNavTargets,
  stepPartyNav,
} from "./partyFormationNav";

describe("partyFormationNav", () => {
  const c = { party: 2, avail: 3 };

  it("orders targets Begin, Create, party, available", () => {
    expect(partyNavTargets(c).map((t) => `${t.section}${t.index}`)).toEqual([
      "begin0", "create0", "party0", "party1", "avail0", "avail1", "avail2",
    ]);
  });

  it("steps through sections and clamps at the ends", () => {
    let cur = { section: "begin" as const, index: 0 };
    expect(stepPartyNav(cur, -1, c)).toEqual({ section: "begin", index: 0 });
    const down = stepPartyNav(stepPartyNav(cur, 1, c), 1, c);
    expect(down).toEqual({ section: "party", index: 0 });
    expect(stepPartyNav({ section: "party", index: 1 }, 1, c)).toEqual({ section: "avail", index: 0 });
    expect(stepPartyNav({ section: "avail", index: 2 }, 1, c)).toEqual({ section: "avail", index: 2 });
    cur = { section: "avail", index: 0 };
    expect(stepPartyNav(cur, -1, c)).toEqual({ section: "party", index: 1 });
  });

  it("keeps position when rows move between lists", () => {
    // Added avail[2] (the last one): cursor drops to the new last.
    expect(clampPartyNav({ section: "avail", index: 2 }, { party: 3, avail: 2 })).toEqual({ section: "avail", index: 1 });
    // Available emptied: fall back to the last party row.
    expect(clampPartyNav({ section: "avail", index: 0 }, { party: 4, avail: 0 })).toEqual({ section: "party", index: 3 });
    // Party emptied: first available, else Create.
    expect(clampPartyNav({ section: "party", index: 0 }, { party: 0, avail: 2 })).toEqual({ section: "avail", index: 0 });
    expect(clampPartyNav({ section: "party", index: 0 }, { party: 0, avail: 0 })).toEqual({ section: "create", index: 0 });
  });

  it("starts on the first available character, else Create", () => {
    expect(initialPartyNav(c)).toEqual({ section: "avail", index: 0 });
    expect(initialPartyNav({ party: 4, avail: 0 })).toEqual({ section: "create", index: 0 });
  });
});
