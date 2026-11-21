import { describe, it, expect } from "vitest";
import { applyPitFall, pitFallReport } from "./pitFall";

const party = [
  { id: "a", hp: 12, max_hp: 12 },
  { id: "b", hp: 1, max_hp: 9 },
  { id: "c", hp: 0, max_hp: 8 },
];

describe("pit fall", () => {
  it("hurts conscious members 1–4, never below 1 HP, and leaves the fallen alone", () => {
    const { members, lines } = applyPitFall(party, () => 0.99);
    expect(members.map((m) => m.hp)).toEqual([8, 1, 0]);
    expect(lines[0]).toMatch(/plunges into the pit/);
    expect(lines).toContain("a takes 4 damage from the fall.");
  });

  it("reports per-member damage for the fall card", () => {
    const { members } = applyPitFall(party, () => 0);
    const report = pitFallReport(party, members, (id) => ({ name: id.toUpperCase(), sprite: `person/${id}.png` }));
    expect(report).toEqual([
      { id: "a", name: "A", sprite: "person/a.png", taken: 1, hp: 11, maxHp: 12, fallen: false },
      { id: "b", name: "B", sprite: "person/b.png", taken: 0, hp: 1, maxHp: 9, fallen: false },
      { id: "c", name: "C", sprite: "person/c.png", taken: 0, hp: 0, maxHp: 8, fallen: true },
    ]);
  });
});
