/**
 * The Orc King boss + his war-priest: lock in that both catalog
 * records hydrate with every spell intact (an unknown spell `type`
 * is silently dropped by `specFromRaw`, which would quietly leave
 * the King unable to cast).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { setMonsterAbilities, specFromRaw } from "./monsters";

setMonsterAbilities(
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../../public/modules/default/monster_abilities.json"),
      "utf8",
    ),
  ),
);

const raw = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../../public/modules/default/monsters.json"),
    "utf8",
  ),
).monsters as Array<{ id: string }>;
const spec = (id: string) => specFromRaw(raw.find((m) => m.id === id) as never);

describe("Orc King encounter monsters", () => {
  it("the Orc King casts sorcerer spells up to level 5", () => {
    const king = spec("orc_king");
    expect(king).not.toBeNull();
    expect(king!.spells?.map((s) => s.name)).toEqual([
      "Lightning Bolt",
      "Magic Arrow",
      "Magic Dart",
    ]);
    expect(king!.spells?.every((s) => s.type === "damage")).toBe(true);
    const orc = spec("orc")!;
    expect(king!.hp).toBeGreaterThan(orc.hp * 4);
  });

  it("the war-priest heals allies and itself", () => {
    const cleric = spec("orc_cleric");
    expect(cleric!.spells?.map((s) => s.type)).toEqual([
      "heal_ally",
      "heal_ally",
      "heal_self",
    ]);
  });
});
