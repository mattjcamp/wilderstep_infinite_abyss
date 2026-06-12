/**
 * Unit tests for the trap resolution layer (src/play/traps.ts).
 *
 * rng is injected as a scripted sequence so target picks, damage
 * rolls, and save rolls are all deterministic. Sequence consumption
 * order inside resolveTrapOutcome:
 *
 *   1. target pick (only when params.targets !== "all")
 *   2. per victim: save roll d20 (only when save authored), then
 *      damage roll (damage traps only)
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRAP_ID,
  resolveTrapOutcome,
  resolveTrapRecord,
  type TrapRecord,
  type TrapVictim,
} from "./traps";

/** rng that replays `values` then falls back to 0.5. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.5);
}

/** Map a desired d20 result (1-20) to the rng value producing it. */
function d20(roll: number): number {
  return (roll - 1) / 20;
}

const PARTY: TrapVictim[] = [
  { index: 0, id: "selina", name: "Selina", hp: 10, stats: { dexterity: 16 } },
  { index: 1, id: "aldric", name: "Aldric", hp: 12, stats: { dexterity: 8 } },
  { index: 2, id: "mira", name: "Mira", hp: 6, stats: {} },
];

const DART: TrapRecord = {
  id: "dart_trap",
  name: "Dart Trap",
  trap_type: "damage",
  damage_type: "piercing",
  damage_range: { min: 4, max: 9 },
};

describe("resolveTrapRecord", () => {
  const CATALOG: TrapRecord[] = [DART, { id: "fire_rune_trap" }];

  it("maps an explicit id to its record", () => {
    expect(resolveTrapRecord(CATALOG, "fire_rune_trap")?.id).toBe(
      "fire_rune_trap",
    );
  });

  it("maps null (legacy boolean trap) to the default record", () => {
    expect(resolveTrapRecord(CATALOG, null)?.id).toBe(DEFAULT_TRAP_ID);
    expect(resolveTrapRecord(CATALOG, undefined)?.id).toBe(DEFAULT_TRAP_ID);
  });

  it("returns null for unknown ids and empty catalogs", () => {
    expect(resolveTrapRecord(CATALOG, "no_such_trap")).toBeNull();
    expect(resolveTrapRecord([], null)).toBeNull();
  });
});

describe("damage traps", () => {
  it("hits one random alive member within damage_range", () => {
    // rng: target pick 0.5 → index 1 of 3 (aldric); damage 0 → min.
    const out = resolveTrapOutcome(DART, PARTY, seq(0.5, 0));
    expect(out.kind).toBe("damage");
    expect(out.hits).toEqual([
      { index: 1, damage: 4, saved: false, effect: null },
    ]);
    expect(out.lines[0]).toContain("Aldric");
    expect(out.lines[0]).toContain("4 piercing damage");
  });

  it("rolls damage at the top of the range", () => {
    const out = resolveTrapOutcome(DART, PARTY, seq(0, 0.999));
    expect(out.hits[0].damage).toBe(9);
  });

  it("targets the whole party with params.targets: all", () => {
    const trap: TrapRecord = {
      ...DART,
      id: "fire_rune_trap",
      name: "Fire Rune",
      damage_type: "fire",
      damage_range: { min: 6, max: 12 },
      params: { targets: "all" },
    };
    // No target pick; per victim one damage roll (no save authored).
    const out = resolveTrapOutcome(trap, PARTY, seq(0, 0.5, 0.999));
    expect(out.hits.map((h) => h.index)).toEqual([0, 1, 2]);
    expect(out.hits.map((h) => h.damage)).toEqual([6, 9, 12]);
  });

  it("halves damage and drops the effect on a successful save", () => {
    const trap: TrapRecord = {
      ...DART,
      effect: "poisoned",
      params: { targets: "all", save_stat: "dexterity", save_dc: 12 },
    };
    // Victim order: selina (dex 16, +3), aldric (dex 8, -1), mira (no
    // stats, +0). Per victim: save d20, then damage.
    const rng = seq(
      d20(9), // selina: 9 + 3 = 12 ≥ 12 → saved
      0.999, // damage 9 → halved to 4
      d20(12), // aldric: 12 - 1 = 11 < 12 → failed
      0.999, // damage 9, full
      d20(12), // mira: 12 + 0 = 12 ≥ 12 → saved
      0, // damage 4 → halved to 2
    );
    const out = resolveTrapOutcome(trap, PARTY, rng);
    expect(out.hits).toEqual([
      { index: 0, damage: 4, saved: true, effect: null },
      { index: 1, damage: 9, saved: false, effect: "poisoned" },
      { index: 2, damage: 2, saved: true, effect: null },
    ]);
    // Failed save carries the affliction line.
    expect(out.lines.some((l) => l.includes("Aldric is afflicted"))).toBe(
      true,
    );
    expect(out.lines.some((l) => l.includes("Selina is afflicted"))).toBe(
      false,
    );
  });

  it("fizzles without a valid damage_range", () => {
    const out = resolveTrapOutcome(
      { ...DART, damage_range: null },
      PARTY,
      seq(),
    );
    expect(out.kind).toBe("fizzle");
    expect(out.hits).toEqual([]);
    expect(out.lines[0]).toContain("sputters");
  });

  it("fizzles with no alive victims", () => {
    expect(resolveTrapOutcome(DART, [], seq()).kind).toBe("fizzle");
  });
});

describe("effect traps", () => {
  const SLEEP: TrapRecord = {
    id: "sleep_rune_trap",
    name: "Sleep Rune",
    trap_type: "effect",
    effect: "sleep",
    params: { targets: "all", save_stat: "wisdom", save_dc: 12 },
  };

  it("applies the effect to save-failers, zero damage", () => {
    const out = resolveTrapOutcome(
      SLEEP,
      PARTY,
      seq(d20(20), d20(1), d20(1)),
    );
    expect(out.kind).toBe("effect");
    expect(out.hits).toEqual([
      { index: 0, damage: 0, saved: true, effect: null },
      { index: 1, damage: 0, saved: false, effect: "sleep" },
      { index: 2, damage: 0, saved: false, effect: "sleep" },
    ]);
  });

  it("fizzles when no effect is authored", () => {
    const out = resolveTrapOutcome(
      { ...SLEEP, effect: null },
      PARTY,
      seq(),
    );
    expect(out.kind).toBe("fizzle");
  });
});

describe("teleport traps", () => {
  it("returns the destination without rolling against anyone", () => {
    const trap: TrapRecord = {
      id: "teleport_rune_trap",
      name: "Teleport Rune",
      trap_type: "teleport",
      params: { teleport: { map_id: "crypt", col: 3, row: 7 } },
    };
    const out = resolveTrapOutcome(trap, PARTY, seq());
    expect(out.kind).toBe("teleport");
    expect(out.teleport).toEqual({ map_id: "crypt", col: 3, row: 7 });
    expect(out.hits).toEqual([]);
  });

  it("fizzles on a malformed destination", () => {
    const bad: TrapRecord = {
      id: "t",
      trap_type: "teleport",
      params: { teleport: { map_id: "", col: 1, row: 1 } },
    };
    expect(resolveTrapOutcome(bad, PARTY, seq()).kind).toBe("fizzle");
    const none: TrapRecord = { id: "t", trap_type: "teleport" };
    expect(resolveTrapOutcome(none, PARTY, seq()).kind).toBe("fizzle");
  });
});

describe("misauthored records", () => {
  it("fizzles on an unknown trap_type", () => {
    const out = resolveTrapOutcome(
      { id: "weird", trap_type: "alarm" },
      PARTY,
      seq(),
    );
    expect(out.kind).toBe("fizzle");
    expect(out.lines[0]).toContain("alarm");
  });

  it("defaults a missing trap_type to damage semantics", () => {
    const out = resolveTrapOutcome(
      { id: "bare", name: "Bare", damage_range: { min: 2, max: 2 } },
      PARTY,
      seq(0, 0),
    );
    expect(out.kind).toBe("damage");
    expect(out.hits[0].damage).toBe(2);
  });
});
