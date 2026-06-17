import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearEncountersCache,
  _setEncountersCache,
  encounterTemplateFromRaw,
  groupEncountersByArea,
  loadAllEncounters,
  loadEncounters,
  type EncounterTemplate,
} from "./Encounters";

function mk(id: string, area: string): EncounterTemplate {
  const e = encounterTemplateFromRaw({
    id,
    area,
    name: id,
    level: 1,
    monsters: ["goblin"],
  });
  if (!e) throw new Error("fixture failed to hydrate");
  return e;
}

describe("_setEncountersCache (inheritance-seed seam)", () => {
  beforeEach(() => _clearEncountersCache());

  it("makes loadAllEncounters a cache hit with no fetch", async () => {
    // No fetch stub installed — if the loader hit the network this would
    // throw. The seed must fully satisfy the read.
    const seed = [mk("rats", "dungeon"), mk("wolves", "overworld")];
    _setEncountersCache(seed);
    const list = await loadAllEncounters();
    expect(list.map((e) => e.id)).toEqual(["rats", "wolves"]);
  });

  it("also populates the by-area bucket loadEncounters returns", async () => {
    _setEncountersCache([
      mk("rats", "dungeon"),
      mk("bats", "dungeon"),
      mk("wolves", "overworld"),
    ]);
    const byArea = await loadEncounters();
    expect(byArea.dungeon.map((e) => e.id)).toEqual(["rats", "bats"]);
    expect(byArea.overworld.map((e) => e.id)).toEqual(["wolves"]);
  });

  it("matches what groupEncountersByArea would produce", async () => {
    const seed = [mk("rats", "dungeon"), mk("wolves", "overworld")];
    _setEncountersCache(seed);
    expect(await loadEncounters()).toEqual(groupEncountersByArea(seed));
  });
});
