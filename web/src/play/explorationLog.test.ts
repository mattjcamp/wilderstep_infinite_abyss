import { describe, expect, it } from "vitest";
import { stampLog, trimmedShift } from "./explorationLog";

describe("exploration log stamps", () => {
  it("stamps appended lines with the current clock", () => {
    expect(stampLog(["a"], [10], ["a", "b", "c"], 15)).toEqual([10, 15, 15]);
  });

  it("keeps stamps aligned when the buffer trims from the front", () => {
    expect(trimmedShift(["a", "b", "c"], ["b", "c", "d"])).toBe(1);
    expect(stampLog(["a", "b", "c"], [1, 2, 3], ["b", "c", "d"], 9)).toEqual([2, 3, 9]);
  });

  it("restamps everything when the log is replaced", () => {
    expect(stampLog(["a", "b"], [1, 2], [], 5)).toEqual([]);
    expect(stampLog(["a", "b"], [1, 2], ["x"], 5)).toEqual([5]);
  });
});

import { notableCategory } from "./explorationLog";

describe("notableCategory", () => {
  it("keeps interesting data points", () => {
    expect(notableCategory("Met Old Tom — +25 XP.")).toBe("xp");
    expect(notableCategory("Discovered Ashford — +50 XP.")).toBe("xp");
    expect(notableCategory("Brom reached Level 3! HP+6 MP+2")).toBe("xp");
    expect(notableCategory("Ilsa spots a Silverleaf in the brush.")).toBe("find");
    expect(notableCategory("Quest complete — Rats. Rewards: 50 gold.")).toBe("quest");
    expect(notableCategory("Step reward: 2× Potion.")).toBe("quest");
    expect(notableCategory("Wolf (2/5).")).toBe("quest");
    expect(notableCategory("Defeated a Goblin.")).toBe("combat");
    expect(notableCategory("Trap! Brom takes 4 damage.")).toBe("trap");
    expect(
      notableCategory("Pip picks the lock! (d20:14+2=16 vs DC 12)"),
    ).toBe("lock");
  });

  it("drops routine feedback", () => {
    for (const line of [
      "A Wolf prowls out of Wolf Den.",
      "Link → town_1@4,7",
      "Edge of the map.",
      "Something blocks the way.",
      "The door is locked.",
      "The party waits.",
      "You descend into the dungeon.",
      "Torch lit (100 steps).",
      "You board the boat.",
    ]) {
      expect(notableCategory(line)).toBeNull();
    }
  });
});

describe("pickups and story lines", () => {
  it("keeps pickups, chests and authored lines", () => {
    expect(notableCategory("Picked up Healing Potion.")).toBe("loot");
    expect(notableCategory("Opened Old Chest: 20 gold, Dagger.")).toBe("loot");
    expect(notableCategory("Opened Old Chest — it's empty.")).toBe("loot");
    const story = new Set(["Smoke still curls from the wagons."]);
    expect(notableCategory("Smoke still curls from the wagons.", story)).toBe("story");
    expect(notableCategory("Smoke still curls from the wagons.")).toBeNull();
  });
});

describe("stampLog — rewound buffer (area transition)", () => {
  it("keeps stamps when the log is restored without its newest line", () => {
    expect(stampLog(["a", "b", "c", "d"], [1, 2, 3, 4], ["a", "b", "c"], 9)).toEqual([1, 2, 3]);
  });
  it("keeps old stamps and stamps only the truly new line after a rewind", () => {
    expect(
      stampLog(["a", "b", "c", "d"], [1, 2, 3, 4], ["a", "b", "c", "XP"], 9),
    ).toEqual([1, 2, 3, 9]);
  });
});

describe("notableCategory — every trap line reaches the Log", () => {
  it("files each line the trap resolver writes as a trap", async () => {
    const { resolveTrapOutcome } = await import("./traps");
    const party = [
      { index: 0, id: "a", name: "Aldric", hp: 3, stats: { dexterity: 8 } },
      { index: 1, id: "s", name: "Selina", hp: 20, stats: { dexterity: 18 } },
    ];
    const traps = [
      { id: "dart", name: "Dart Trap", trap_type: "damage", damage_type: "piercing", damage_range: { min: 4, max: 9 } },
      { id: "fire", name: "Fire Trap", trap_type: "damage", damage_type: "fire", damage_range: { min: 6, max: 12 }, effect: "burning", params: { targets: "all", save_stat: "dexterity", save_dc: 13 } },
      { id: "sleep", name: "Sleep Glyph", trap_type: "effect", effect: "sleep", params: { targets: "all", save_stat: "wisdom", save_dc: 12 } },
      { id: "tp", name: "Teleport Trap", trap_type: "teleport" },
      { id: "bad", name: "Broken Trap", trap_type: "damage" },
    ];
    const lines: string[] = [];
    for (const t of traps) {
      for (const seed of [0.01, 0.5, 0.99]) {
        lines.push(...resolveTrapOutcome(t, party, () => seed).lines);
      }
    }
    lines.push("Teleport Trap flickers, but there is nowhere to send the party.");
    lines.push("Trap! Aldric takes 5 damage (HP 9 → 4).");
    for (const l of lines) expect(notableCategory(l), l).toBe("trap");
  });

  it("doesn't pull in routine feedback", () => {
    expect(notableCategory("Edge of the map.")).toBeNull();
    expect(notableCategory("The door is locked.")).toBeNull();
  });
});
