import { describe, it, expect } from "vitest";

import { rollUpCharacterToLevel } from "./rollUpCharacter";
import type { CharacterRecord } from "./CharacterSheet";
import type { RawClass } from "@/battle/world/Classes";

function character(over: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "c",
    name: "Test",
    class: "wizard",
    race: "human",
    gender: "Other",
    level: 1,
    exp: 0,
    hp: 5,
    mp: 12,
    strength: 10,
    dexterity: 10,
    constitution: 12, // +1 mod
    intelligence: 18, // +4 mod
    wisdom: 10,
    ...over,
  };
}

// Minimal raw class records — classFromRaw fills mp_source + exp/level
// (1500) defaults by id, exactly as the game does.
const WIZARD: RawClass = {
  id: "wizard",
  name: "Wizard",
  hp_per_level: 4,
  mp_per_level: 8,
  casting_type: ["sorcerer"],
} as RawClass;
const FIGHTER: RawClass = {
  id: "fighter",
  name: "Fighter",
  hp_per_level: 8,
  mp_per_level: 0,
  casting_type: ["none"],
} as RawClass;
const DRUID: RawClass = {
  id: "druid",
  name: "Druid",
  hp_per_level: 6,
  mp_per_level: 6,
  casting_type: ["sorcerer", "priest"],
} as RawClass;

describe("rollUpCharacterToLevel", () => {
  it("levels a wizard 1 → 10 with game-matching HP/MP/XP", () => {
    const r = rollUpCharacterToLevel(character(), WIZARD, 10);
    // hpGain/level = max(1, 4 + CON+1) = 5; 9 levels → +45.
    // mpGain/level = max(0, 8 + INT+4) = 12; 9 levels → +108.
    expect(r.levelsGained).toBe(9);
    expect(r.hpGained).toBe(45);
    expect(r.mpGained).toBe(108);
    expect(r.character.level).toBe(10);
    expect(r.character.hp).toBe(5 + 45);
    expect(r.character.mp).toBe(12 + 108);
    // Cumulative XP at level 10 with 1500/level: 1500 * 10*9/2 = 67500.
    expect(r.character.exp).toBe(67500);
  });

  it("credits no MP for a non-caster", () => {
    const fighter = character({ class: "fighter", mp: 0, intelligence: 10 });
    const r = rollUpCharacterToLevel(fighter, FIGHTER, 5);
    // hpGain/level = max(1, 8 + 1) = 9; 4 levels → +36.
    expect(r.hpGained).toBe(36);
    expect(r.mpGained).toBe(0);
    expect(r.character.mp).toBe(0);
    expect(r.character.exp).toBe(1500 * (5 * 4) / 2); // 15000
  });

  it("uses the dual-stat (average) casting mod for a druid", () => {
    // INT 16 (+3), WIS 12 (+1) → average stat 14 → +2 mod.
    const druid = character({ class: "druid", intelligence: 16, wisdom: 12, mp: 8 });
    const r = rollUpCharacterToLevel(druid, DRUID, 2);
    // mpGain = max(0, 6 + 2) = 8 for the one level crossed.
    expect(r.mpGained).toBe(8);
  });

  it("is a no-op when the target is at or below the current level", () => {
    const c = character({ level: 5, hp: 30, mp: 60, exp: 999 });
    const same = rollUpCharacterToLevel(c, WIZARD, 5);
    expect(same.character).toBe(c);
    expect(same.levelsGained).toBe(0);
    const lower = rollUpCharacterToLevel(c, WIZARD, 3);
    expect(lower.character).toBe(c);
  });

  it("is a no-op when the class is unknown/missing", () => {
    const c = character();
    const r = rollUpCharacterToLevel(c, null, 10);
    expect(r.character).toBe(c);
    expect(r.levelsGained).toBe(0);
  });

  it("rolls up additively from a mid-level character", () => {
    const c = character({ level: 5, hp: 25, mp: 60, exp: 15000 });
    const r = rollUpCharacterToLevel(c, WIZARD, 8);
    // 3 levels × (+5 hp, +12 mp).
    expect(r.character.hp).toBe(25 + 15);
    expect(r.character.mp).toBe(60 + 36);
    expect(r.character.level).toBe(8);
    expect(r.character.exp).toBe(1500 * (8 * 7) / 2); // 42000
  });
});
