import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADVENTURERS,
  ANIMALS,
  LANES,
  MONSTERS,
  TOWNSFOLK,
  planWanderer,
} from "./titleWanderers";

const SPRITES = path.resolve(__dirname, "../../public/modules/default/sprites");

/** Small deterministic PRNG so the spawn rules are reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("title wanderers roster", () => {
  it("every sprite exists in the default module", () => {
    const all = [...ADVENTURERS, ...TOWNSFOLK, ...ANIMALS, ...MONSTERS];
    const missing = all.filter((k) => !fs.existsSync(path.join(SPRITES, k.sprite)));
    expect(missing.map((k) => k.sprite)).toEqual([]);
    expect(ADVENTURERS.length).toBe(80);
  });
});

describe("planWanderer", () => {
  it("always yields 1–4 members on a valid lane with sane motion", () => {
    const rand = seeded(42);
    for (let i = 0; i < 500; i++) {
      const p = planWanderer(rand);
      expect(p.members.length).toBeGreaterThanOrEqual(1);
      expect(p.members.length).toBeLessThanOrEqual(4);
      expect(p.lane).toBeGreaterThanOrEqual(0);
      expect(p.lane).toBeLessThan(LANES.length);
      expect([1, -1]).toContain(p.dir);
      expect(p.speed).toBeGreaterThan(0);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("farther lanes are smaller and dimmer than nearer ones", () => {
    const rand = seeded(7);
    const byLane = new Map<number, { px: number; op: number }>();
    for (let i = 0; i < 400; i++) {
      const p = planWanderer(rand);
      byLane.set(p.lane, { px: p.basePx, op: p.opacity });
    }
    const far = byLane.get(0)!;
    const near = byLane.get(LANES.length - 1)!;
    expect(far.px).toBeLessThan(near.px);
    expect(far.op).toBeLessThan(near.op);
  });

  it("mixes parties, monsters, animals and townsfolk", () => {
    const rand = seeded(3);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p = planWanderer(rand);
      const s = p.members[0].sprite;
      if (p.members.length > 1 && ADVENTURERS.includes(p.members[0])) kinds.add("party");
      if (s.startsWith("monster/")) kinds.add("monster");
      if (s.includes("animal_")) kinds.add("animal");
      if (s.includes("villager") || s.includes("musician")) kinds.add("townsfolk");
    }
    expect([...kinds].sort()).toEqual(["animal", "monster", "party", "townsfolk"]);
  });
});
