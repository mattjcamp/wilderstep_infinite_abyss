/**
 * Reproduction test for the bug report: "In the Hallowmere Rats quest,
 * I killed the goblins but the step never registered."
 *
 * Drives the REAL quests.json data through the real quest pipeline:
 * parse -> activate -> activeKillStepsAt(house_3) -> mint placed id
 * (same format as findQuestPlacedEncounters) -> regex parse (same as
 * MapSimulation.resolveSpawnEncounter) -> creditQuestKill.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeKillStepsAt,
  creditQuestKill,
  ensureQuestStates,
  parseQuestsFile,
  type QuestState,
} from "./Quests";

const questsPath = join(
  __dirname,
  "../../../public/modules/underworld-invaders/quests.json",
);

function loadDefs() {
  const raw = JSON.parse(readFileSync(questsPath, "utf-8"));
  return parseQuestsFile(raw);
}

describe("rats quest step 4 (goblins in hollowmere_town_house_3)", () => {
  it("spawns and credits the kill step after steps 1-3 are done (in-order play)", () => {
    const defs = loadDefs();
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    const rats = states.get("rats")!;
    rats.status = "active";
    rats.stepProgress[0] = true;
    rats.stepProgress[1] = true;
    rats.stepProgress[2] = true;

    const rows = activeKillStepsAt(defs, states, {
      kind: "map",
      mapId: "hollowmere_town_house_3",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].encounterId).toBe("goblin_squatters");
    expect(rows[0].remaining).toBe(1);

    // Mint the placed-encounter id the way the spawn pass does, then
    // parse it the way resolveSpawnEncounter does.
    const minted = `q-${rows[0].questId}-${rows[0].stepIdx}-0`;
    const m = /^q-(.+)-(\d+)-\d+$/.exec(minted)!;
    expect(m).not.toBeNull();
    const credit = creditQuestKill(defs, states, m[1], Number(m[2]));
    expect(credit).not.toBeNull();
    expect(credit!.stepCompleted).toBe(true);
    expect(credit!.questCompleted).toBe(true);
  });

  it("spawns and credits step 4 even when played FIRST (out of order)", () => {
    const defs = loadDefs();
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    const rats = states.get("rats")!;
    rats.status = "active";

    const rows = activeKillStepsAt(defs, states, {
      kind: "map",
      mapId: "hollowmere_town_house_3",
    });
    expect(rows).toHaveLength(1);
    const minted = `q-${rows[0].questId}-${rows[0].stepIdx}-0`;
    const m = /^q-(.+)-(\d+)-\d+$/.exec(minted)!;
    const credit = creditQuestKill(defs, states, m[1], Number(m[2]));
    expect(credit).not.toBeNull();
    expect(credit!.stepCompleted).toBe(true);
    expect(credit!.questCompleted).toBe(false);
  });
});
