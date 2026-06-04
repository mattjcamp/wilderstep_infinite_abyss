import { describe, expect, it } from "vitest";
import {
  creditKillSteps,
  isKernelQuestKill,
  type KillCreditFields,
} from "./creditKillStep";

/** The rats quest, as authored (counts and all). */
const ratsQuest = {
  id: "rats",
  name: "The Giant Rats",
  steps: [
    {
      id: "rats_step_1",
      name: "Kill the Cave Rats",
      kind: "kill",
      encounter_id: "rat_swarm",
      count: 4,
      location_kind: "map",
      map_id: "shop_cavern",
    },
    {
      id: "rats_step_4",
      name: "Clear the goblins",
      kind: "kill",
      encounter_id: "goblin_squatters",
      location_kind: "map",
      map_id: "hollowmere_town_house_3",
    },
  ],
};

function freshFields(): KillCreditFields {
  return {
    acceptedQuests: ["rats"],
    turnedInQuests: [],
    questStepProgress: {},
    questStepsDone: {},
    questStepKills: {},
  };
}

describe("creditKillSteps", () => {
  it("does NOT complete a count-4 step on the first kill (the placard bug)", () => {
    const res = creditKillSteps(
      freshFields(),
      { encounterId: "rat_swarm", monsters: ["giant_rat"] },
      null,
      [ratsQuest],
      "shop_cavern",
    );
    expect(res.changed).toBe(true);
    expect(res.credited).toHaveLength(1);
    expect(res.credited[0].killsSoFar).toBe(1);
    expect(res.credited[0].count).toBe(4);
    expect(res.credited[0].stepCompleted).toBe(false);
    // Step must NOT be marked done in the save.
    expect(res.questStepsDone["rats"] ?? []).not.toContain("rats_step_1");
    // But the kill counter persists.
    expect(res.questStepKills["rats"]["rats_step_1"]).toBe(1);
  });

  it("completes the step exactly on the Nth kill", () => {
    let fields: KillCreditFields = freshFields();
    let last;
    for (let n = 1; n <= 4; n++) {
      last = creditKillSteps(
        fields,
        { encounterId: "rat_swarm", monsters: ["giant_rat"] },
        null,
        [ratsQuest],
        "shop_cavern",
      );
      fields = { ...fields, ...last };
    }
    expect(last!.credited[0].killsSoFar).toBe(4);
    expect(last!.credited[0].stepCompleted).toBe(true);
    expect(last!.questStepsDone["rats"]).toContain("rats_step_1");
  });

  it("credits a single-count step on the first matching kill, with questCompleted on the last step", () => {
    const fields = freshFields();
    fields.questStepsDone = { rats: ["rats_step_1"] };
    const res = creditKillSteps(
      fields,
      { encounterId: "goblin_squatters", monsters: ["goblin", "giant_rat"] },
      null,
      [ratsQuest],
      "hollowmere_town_house_3",
    );
    expect(res.credited).toHaveLength(1);
    expect(res.credited[0].stepCompleted).toBe(true);
    expect(res.credited[0].questCompleted).toBe(true);
  });

  it("does not credit a map-pinned step from the wrong map (grotto goblins ≠ house goblins)", () => {
    const res = creditKillSteps(
      freshFields(),
      { encounterId: "goblin_squatters", monsters: ["goblin", "giant_rat"] },
      null,
      [ratsQuest],
      "grotto_1_l1",
    );
    expect(res.changed).toBe(false);
    expect(res.credited).toHaveLength(0);
  });

  it("does not credit a map-pinned step while inside a dungeon", () => {
    const res = creditKillSteps(
      freshFields(),
      { encounterId: "goblin_squatters", monsters: ["goblin"] },
      { dungeonId: "grotto", floorIdx: 0 },
      [ratsQuest],
      "hollowmere_town_house_3",
    );
    expect(res.credited).toHaveLength(0);
  });

  it("skips already-completed steps", () => {
    const fields = freshFields();
    fields.questStepsDone = { rats: ["rats_step_1", "rats_step_4"] };
    const res = creditKillSteps(
      fields,
      { encounterId: "goblin_squatters", monsters: ["goblin"] },
      null,
      [ratsQuest],
      "hollowmere_town_house_3",
    );
    expect(res.changed).toBe(false);
  });

  it("skips quests that are not accepted or already turned in", () => {
    const notAccepted = creditKillSteps(
      { ...freshFields(), acceptedQuests: [] },
      { encounterId: "rat_swarm", monsters: ["giant_rat"] },
      null,
      [ratsQuest],
      "shop_cavern",
    );
    expect(notAccepted.changed).toBe(false);
    const turnedIn = creditKillSteps(
      { ...freshFields(), turnedInQuests: ["rats"] },
      { encounterId: "rat_swarm", monsters: ["giant_rat"] },
      null,
      [ratsQuest],
      "shop_cavern",
    );
    expect(turnedIn.changed).toBe(false);
  });
});

describe("isKernelQuestKill", () => {
  it("recognises kernel-minted quest spawn ids", () => {
    expect(isKernelQuestKill("q-rats-3-0")).toBe(true);
    expect(isKernelQuestKill("q-chase_out_the_goblins-0-2")).toBe(true);
  });
  it("rejects painted-encounter and missing ids", () => {
    expect(isKernelQuestKill("placed-5-8")).toBe(false);
    expect(isKernelQuestKill(null)).toBe(false);
    expect(isKernelQuestKill(undefined)).toBe(false);
    expect(isKernelQuestKill("")).toBe(false);
  });
});
