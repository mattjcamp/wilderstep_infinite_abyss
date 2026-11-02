import { describe, expect, it } from "vitest";
import {
  canTalk,
  rollRun,
  rollTalk,
  runDc,
  summarizeRoster,
  talkChance,
} from "./encounterChoices";

const catalog = [
  { id: "goblin", name: "Goblin", humanoid: true, dexterity: 14, description: "Sneaky." },
  { id: "wolf", name: "Wolf", humanoid: false, dexterity: 15 },
  { id: "orc", name: "Orc", humanoid: true, dexterity: 12 },
];
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

describe("summarizeRoster", () => {
  it("groups duplicates and carries descriptions", () => {
    const r = summarizeRoster(["goblin", "goblin", "wolf"], catalog);
    expect(r.map((e) => [e.id, e.count])).toEqual([["goblin", 2], ["wolf", 1]]);
    expect(r[0].description).toBe("Sneaky.");
  });
});

describe("canTalk", () => {
  it("needs every foe humanoid", () => {
    expect(canTalk(summarizeRoster(["goblin", "orc"], catalog))).toBe(true);
    expect(canTalk(summarizeRoster(["goblin", "wolf"], catalog))).toBe(false);
  });
});

describe("rollRun", () => {
  const roster = summarizeRoster(["goblin", "wolf"], catalog);
  it("DC is 10 + fastest enemy DEX mod", () => {
    expect(runDc(roster)).toBe(12);
  });
  it("escapes when at least half pass", () => {
    // d20 rolls: 15, 2 → one of two pass (needed 1)
    const res = rollRun(
      [{ name: "A", dexterity: 10 }, { name: "B", dexterity: 10 }],
      roster,
      "roamer",
      seq(0.7, 0.05),
    );
    expect(res.rolls.map((r) => r.roll)).toEqual([15, 2]);
    expect(res.success).toBe(true);
  });
  it("fails when fewer than half pass", () => {
    const res = rollRun(
      [{ name: "A" }, { name: "B" }, { name: "C" }],
      roster,
      "placed",
      seq(0.05, 0.05, 0.9),
    );
    expect(res.passed).toBe(1);
    expect(res.success).toBe(false);
  });
  it("withdrawing from a lair needs no roll", () => {
    const res = rollRun([{ name: "A" }], roster, "boss", seq(0));
    expect(res.success).toBe(true);
    expect(res.rolls).toEqual([]);
  });
});

describe("rollTalk", () => {
  const humanoids = summarizeRoster(["goblin", "orc"], catalog);
  it("chance is small and clamped", () => {
    expect(talkChance([{ name: "Sage", intelligence: 20 }], "placed").chance).toBe(0.25);
    expect(talkChance([{ name: "Brute", intelligence: 3, wisdom: 3 }], "placed").chance).toBe(0.05);
    expect(talkChance([{ name: "Avg" }], "placed").chance).toBeCloseTo(0.1);
  });
  it("never works on non-humanoids", () => {
    const r = rollTalk([{ name: "A" }], summarizeRoster(["wolf"], catalog), "roamer", seq(0));
    expect(r.success).toBe(false);
  });
  it("succeeds under the chance", () => {
    expect(rollTalk([{ name: "A" }], humanoids, "placed", seq(0.01)).success).toBe(true);
    expect(rollTalk([{ name: "A" }], humanoids, "placed", seq(0.5)).success).toBe(false);
  });
});
