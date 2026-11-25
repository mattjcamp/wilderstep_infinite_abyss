import { describe, expect, it } from "vitest";
import {
  partyHasDetectTraps,
  rollTrapDetection,
  TRAP_DETECT_DC,
  trapDetectDc,
  trapDetectors,
  trapsEnteringView,
} from "./trapDetection";

const classes = [
  { id: "thief", name: "Thief", abilities: [{ ability_id: "detect_traps", min_level: 1 }] },
  { id: "ranger", name: "Ranger", abilities: [{ ability_id: "detect_traps", min_level: 3 }] },
  { id: "fighter", name: "Fighter", abilities: [] },
];
const characters = [
  { id: "sly", name: "Sly", class: "Thief", intelligence: 14 },
  { id: "rog", name: "Rog", class: "Ranger", intelligence: 12 },
  { id: "bob", name: "Bob", class: "Fighter", intelligence: 16 },
];
const seq = (...vals: number[]) => {
  let i = 0;
  // d20 = 1 + floor(v * 20): v = (face - 1) / 20 gives that face.
  return () => (vals[i++] - 1) / 20;
};

describe("trapDetectors", () => {
  it("picks living members whose class grants Detect Traps at their level", () => {
    const d = trapDetectors(
      [{ id: "sly", hp: 5 }, { id: "rog", hp: 5, level: 2 }, { id: "bob", hp: 5 }],
      characters,
      classes,
    );
    expect(d.map((x) => x.id)).toEqual(["sly"]);
  });
  it("counts a Ranger once they reach the ability's min level", () => {
    const d = trapDetectors([{ id: "rog", hp: 5, level: 3 }, { id: "bob", hp: 5 }], characters, classes);
    expect(d.map((x) => x.id)).toEqual(["rog"]);
  });
  it("nobody rolls when nobody living has the ability (no stand-in)", () => {
    const d = trapDetectors(
      [{ id: "sly", hp: 0 }, { id: "rog", hp: 5, level: 1 }, { id: "bob", hp: 5 }],
      characters,
      classes,
    );
    expect(d).toEqual([]);
  });
});

describe("partyHasDetectTraps", () => {
  it("is true only when a roster member has the ability at their level", () => {
    expect(partyHasDetectTraps([{ id: "bob", hp: 5 }], characters, classes)).toBe(false);
    expect(partyHasDetectTraps([{ id: "rog", hp: 5, level: 2 }], characters, classes)).toBe(false);
    expect(partyHasDetectTraps([{ id: "rog", hp: 5, level: 3 }], characters, classes)).toBe(true);
    // A fallen Thief still has it (they can be raised); they just can't roll.
    expect(partyHasDetectTraps([{ id: "sly", hp: 0 }], characters, classes)).toBe(true);
  });
});

describe("rollTrapDetection", () => {
  const sly = { id: "sly", name: "Sly", intelligence: 14 }; // +2
  it("succeeds on d20 + INT mod ≥ DC", () => {
    const r = rollTrapDetection([sly], 12, seq(10));
    expect(r.detected).toBe(true);
    expect(r.best).toMatchObject({ roll: 10, mod: 2, total: 12, dc: 12 });
  });
  it("fails below the DC and reports the best attempt", () => {
    const r = rollTrapDetection([sly, { id: "b", name: "B", intelligence: 8 }], 12, seq(9, 5));
    expect(r.detected).toBe(false);
    expect(r.best?.detector.id).toBe("sly");
    expect(r.best?.total).toBe(11);
  });
  it("any detector's success spots it", () => {
    const r = rollTrapDetection([{ id: "b", name: "B", intelligence: 8 }, sly], 12, seq(2, 15));
    expect(r.detected).toBe(true);
    expect(r.best?.detector.id).toBe("sly");
  });
  it("no detectors, no roll", () => {
    expect(rollTrapDetection([], 12)).toEqual({ detected: false, best: null });
  });
});

describe("trapDetectDc", () => {
  it("reads params.detect_dc, else the default", () => {
    expect(trapDetectDc({ params: { detect_dc: 16 } })).toBe(16);
    expect(trapDetectDc({ params: null })).toBe(TRAP_DETECT_DC);
    expect(trapDetectDc(null)).toBe(TRAP_DETECT_DC);
  });
});

describe("trapsEnteringView", () => {
  it("only traps newly in view and not already known", () => {
    const live = new Set(["1,1", "2,2", "3,3", "4,4"]);
    const visible = new Set(["1,1", "2,2", "3,3"]);
    const wasInView = new Set(["2,2"]);
    const known = new Set(["3,3"]);
    expect(trapsEnteringView(live, visible, wasInView, known)).toEqual(["1,1"]);
  });
});
