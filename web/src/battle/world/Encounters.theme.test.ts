import { describe, expect, it } from "vitest";
import { sampleEncounter, type EncounterTemplate } from "./Encounters";

function enc(
  id: string,
  theme: string | undefined,
  partial: Partial<EncounterTemplate> = {},
): EncounterTemplate {
  return {
    id,
    area: "dungeon",
    name: id,
    level: 3,
    weight: 10,
    monsterPartyTile: "monster/x.png",
    monsters: [id],
    tags: [],
    theme,
    ...partial,
  };
}

const table = {
  dungeon: [
    enc("imps", "devil"),
    enc("skellies", "undead"),
    enc("ghouls", "undead"),
    enc("wolves", "cryptid"),
  ],
};

// rng() === 0 makes the weighted pick deterministic: it always lands on
// the FIRST eligible entry (roll starts at 0, first subtraction goes
// non-positive).
const firstPick = () => 0;

describe("sampleEncounter theme filter", () => {
  it("draws only from the requested theme", () => {
    const picked = sampleEncounter(table, "dungeon", {
      rng: firstPick,
      theme: "undead",
    });
    expect(picked?.id).toBe("skellies"); // first undead in the list
    expect(picked?.theme).toBe("undead");
  });

  it("never returns an off-theme encounter when the theme has matches", () => {
    // Roll many times with a varying rng — every pick must be undead.
    let seed = 0;
    const rng = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };
    for (let i = 0; i < 50; i++) {
      const picked = sampleEncounter(table, "dungeon", { rng, theme: "undead" });
      expect(picked?.theme).toBe("undead");
    }
  });

  it("falls back to the full pool when the theme has no matches in band", () => {
    // No "elemental" encounters exist → don't return null, use the pool.
    const picked = sampleEncounter(table, "dungeon", {
      rng: firstPick,
      theme: "elemental",
    });
    expect(picked).not.toBeNull();
    expect(picked?.id).toBe("imps"); // first overall
  });

  it("applies no theme restriction when theme is empty / unset", () => {
    const a = sampleEncounter(table, "dungeon", { rng: firstPick });
    const b = sampleEncounter(table, "dungeon", { rng: firstPick, theme: "  " });
    expect(a?.id).toBe("imps");
    expect(b?.id).toBe("imps");
  });

  it("respects the level band alongside the theme filter", () => {
    const banded = {
      dungeon: [
        enc("low_undead", "undead", { level: 1 }),
        enc("hi_undead", "undead", { level: 8 }),
      ],
    };
    const picked = sampleEncounter(banded, "dungeon", {
      rng: firstPick,
      theme: "undead",
      minLevel: 7,
      maxLevel: 8,
    });
    expect(picked?.id).toBe("hi_undead");
  });

  it("keeps the theme at an easier level when the band's themed match is too hard", () => {
    // A "normal" humanoid dungeon's deeper floor: the only humanoid
    // encounter in band is a Troll (hard) — it used to win the theme
    // check, get pruned, and leave the room empty.
    const t = {
      dungeon: [
        enc("orcs", "humanoid", { level: 2, monsters: ["orc"] }),
        enc("troll", "humanoid", { level: 5, monsters: ["troll"] }),
        enc("skeletons", "undead", { level: 3, monsters: ["skeleton"] }),
      ],
    };
    const tier: Record<string, string> = { orc: "normal", troll: "hard", skeleton: "normal" };
    const picked = sampleEncounter(t, "dungeon", {
      rng: firstPick,
      theme: "humanoid",
      minLevel: 3,
      maxLevel: 5,
      allowedDifficulties: new Set(["normal"]),
      monsterDifficulty: (id) => tier[id],
    });
    expect(picked?.id).toBe("orcs");
  });

  it("falls back to any theme in band only when the theme has nothing usable at all", () => {
    const t = {
      dungeon: [
        enc("troll", "humanoid", { level: 5, monsters: ["troll"] }),
        enc("skeletons", "undead", { level: 4, monsters: ["skeleton"] }),
      ],
    };
    const tier: Record<string, string> = { troll: "hard", skeleton: "normal" };
    const picked = sampleEncounter(t, "dungeon", {
      rng: firstPick,
      theme: "humanoid",
      minLevel: 3,
      maxLevel: 5,
      allowedDifficulties: new Set(["normal"]),
      monsterDifficulty: (id) => tier[id],
    });
    expect(picked?.id).toBe("skeletons");
  });
});
