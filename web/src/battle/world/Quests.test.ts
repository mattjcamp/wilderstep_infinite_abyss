import { describe, expect, it } from "vitest";

import {
  activeKillStepsAt,
  creditQuestKill,
  ensureQuestStates,
  matchesLocation,
  parseQuestsFile,
  type CombatLocation,
  type QuestState,
} from "./Quests";

describe("parseQuestsFile (v2 envelope)", () => {
  it("parses the v2 `{ quests: [...] }` envelope", () => {
    const raw = {
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          description: "Get rid of those giant rats in their giant rat hiole",
          tags: ["rats"],
          steps: [
            {
              id: "rats_step_1",
              name: "Step 1 Kill the Giant Rats",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 1 },
              description: "Kill the Giant Rats in the cave under the shop",
              tags: ["rats"],
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
          quest_giver: {
            npc_name: "Jerald",
            npc_sprite: "person/hobbit2.png",
            start_dialog: "Help me!",
            end_dialog: "Thanks!",
          },
          rewards: { xp: 100, gold: 100, items: ["camping_supplies"] },
        },
      ],
    };
    const defs = parseQuestsFile(raw);
    expect(defs).toHaveLength(1);
    const q = defs[0];
    expect(q.id).toBe("rats");
    expect(q.name).toBe("The Giant Rats");
    expect(q.tags).toEqual(["rats"]);
    expect(q.questGiver.npcName).toBe("Jerald");
    expect(q.questGiver.npcSprite).toBe("person/hobbit2.png");
    expect(q.questGiver.startDialog).toBe("Help me!");
    expect(q.questGiver.endDialog).toBe("Thanks!");
    expect(q.rewards).toEqual({
      xp: 100,
      gold: 100,
      items: ["camping_supplies"],
    });
    expect(q.steps).toHaveLength(1);
    const s = q.steps[0];
    expect(s.id).toBe("rats_step_1");
    expect(s.name).toBe("Step 1 Kill the Giant Rats");
    expect(s.kind).toBe("kill");
    expect(s.encounterId).toBe("cellar_rats");
    expect(s.count).toBe(1);
    expect(s.locationKind).toBe("map");
    expect(s.mapId).toBe("demo_map");
    expect(s.dungeonId).toBe("");
    expect(s.dungeonLevel).toBeUndefined();
  });

  it("parses a v2 dungeon-kind step", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "rats",
          steps: [
            {
              id: "s1",
              name: "Slay them",
              kind: "kill",
              params: { encounter_id: "rat_nest", count: 3 },
              location_kind: "dungeon",
              dungeon_id: "the_hole",
              dungeon_level: 2,
            },
          ],
        },
      ],
    });
    expect(defs).toHaveLength(1);
    const s = defs[0].steps[0];
    expect(s.locationKind).toBe("dungeon");
    expect(s.dungeonId).toBe("the_hole");
    expect(s.dungeonLevel).toBe(2);
    expect(s.encounterId).toBe("rat_nest");
    expect(s.count).toBe(3);
  });

  it("populates v1-shape compat fields from v2 data", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "s1",
              name: "go",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: 2 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
          quest_giver: { npc_name: "Jerald", npc_sprite: "person/hobbit2.png" },
          rewards: { xp: 50, gold: 25, items: [] },
        },
      ],
    });
    const q = defs[0];
    expect(q.giverNpc).toBe("Jerald");
    expect(q.giverSprite).toBe("person/hobbit2.png");
    expect(q.rewardXp).toBe(50);
    expect(q.rewardGold).toBe(25);
    const s = q.steps[0];
    // Legacy aliases — same values as the v2-native fields.
    expect(s.stepType).toBe("kill");
    expect(s.encounter).toBe("cellar_rats");
    expect(s.targetCount).toBe(2);
    // Synthesized location string so the legacy string matcher
    // returns sensible results.
    expect(s.spawnLocation).toBe("map:demo_map");
  });

  it("still parses a v1 flat-shape step as a fallback", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          name: "Old Quest",
          steps: [
            {
              step_type: "kill",
              encounter: "cellar_rats",
              target_count: 1,
              spawn_location: "dungeon:Crypt - Floor 2",
            },
          ],
        },
      ],
    });
    const s = defs[0].steps[0];
    expect(s.kind).toBe("kill");
    expect(s.encounterId).toBe("cellar_rats");
    expect(s.count).toBe(1);
    expect(s.spawnLocation).toBe("dungeon:Crypt - Floor 2");
    // No structured fields when reading v1 input.
    expect(s.locationKind).toBe("");
    expect(s.mapId).toBe("");
    expect(s.dungeonId).toBe("");
  });

  it("accepts a bare-array shape too (no envelope)", () => {
    const defs = parseQuestsFile([
      { id: "bare", name: "Bare", steps: [] },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe("bare");
  });

  it("skips quests with no id and no name", () => {
    const defs = parseQuestsFile({
      quests: [{ description: "no id, no name" }, { id: "ok", name: "Ok" }],
    });
    expect(defs.map((q) => q.id)).toEqual(["ok"]);
  });
});

describe("matchesLocation (v2 structured)", () => {
  const mkStep = (over: Partial<{
    locationKind: "" | "map" | "dungeon";
    mapId: string;
    dungeonId: string;
    dungeonLevel?: number;
  }>) => ({
    id: "",
    name: "",
    description: "",
    tags: [],
    kind: "kill" as const,
    params: {},
    encounterId: "",
    count: 1,
    itemId: "",
    locationKind: over.locationKind ?? "",
    mapId: over.mapId ?? "",
    dungeonId: over.dungeonId ?? "",
    dungeonLevel: over.dungeonLevel,
    // v1 compat
    stepType: "kill" as const,
    encounter: "",
    collectItem: "",
    hasGuardian: false,
    guardianEncounter: "",
    spawnLocation: "",
    targetCount: 1,
  });

  it("empty location_kind matches anywhere", () => {
    const step = mkStep({});
    const onMap: CombatLocation = { kind: "map", mapId: "demo_map" };
    const inDungeon: CombatLocation = {
      kind: "dungeon",
      dungeonId: "the_hole",
      dungeonLevel: 2,
    };
    expect(matchesLocation(step, onMap)).toBe(true);
    expect(matchesLocation(step, inDungeon)).toBe(true);
  });

  it("location_kind: map matches the named map only", () => {
    const step = mkStep({ locationKind: "map", mapId: "demo_map" });
    expect(matchesLocation(step, { kind: "map", mapId: "demo_map" })).toBe(
      true,
    );
    expect(matchesLocation(step, { kind: "map", mapId: "other" })).toBe(false);
    expect(
      matchesLocation(step, { kind: "dungeon", dungeonId: "demo_map" }),
    ).toBe(false);
  });

  it("location_kind: dungeon without dungeon_level matches any floor", () => {
    const step = mkStep({ locationKind: "dungeon", dungeonId: "the_hole" });
    expect(
      matchesLocation(step, {
        kind: "dungeon",
        dungeonId: "the_hole",
        dungeonLevel: 1,
      }),
    ).toBe(true);
    expect(
      matchesLocation(step, {
        kind: "dungeon",
        dungeonId: "the_hole",
        dungeonLevel: 4,
      }),
    ).toBe(true);
    expect(
      matchesLocation(step, { kind: "dungeon", dungeonId: "other" }),
    ).toBe(false);
  });

  it("location_kind: dungeon with dungeon_level pins to that floor", () => {
    const step = mkStep({
      locationKind: "dungeon",
      dungeonId: "the_hole",
      dungeonLevel: 2,
    });
    expect(
      matchesLocation(step, {
        kind: "dungeon",
        dungeonId: "the_hole",
        dungeonLevel: 2,
      }),
    ).toBe(true);
    expect(
      matchesLocation(step, {
        kind: "dungeon",
        dungeonId: "the_hole",
        dungeonLevel: 1,
      }),
    ).toBe(false);
  });
});

describe("activeKillStepsAt", () => {
  /** Helper: parse one v2 quest with a single kill step targeting
   *  `demo_map`, then bootstrap its state via `ensureQuestStates`. */
  function bootstrap(opts?: { count?: number; status?: QuestState["status"] }) {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "rats_step_1",
              name: "Kill the rats",
              kind: "kill",
              params: {
                encounter_id: "cellar_rats",
                count: opts?.count ?? 1,
              },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    if (opts?.status) {
      const s = states.get("rats")!;
      s.status = opts.status;
    }
    return { defs, states };
  }

  const onDemoMap: CombatLocation = { kind: "map", mapId: "demo_map" };
  const elsewhere: CombatLocation = { kind: "map", mapId: "other_map" };

  it("returns nothing while the quest is only available (not accepted)", () => {
    const { defs, states } = bootstrap();
    expect(activeKillStepsAt(defs, states, onDemoMap)).toEqual([]);
  });

  it("returns the step once the quest is active and the location matches", () => {
    const { defs, states } = bootstrap({ status: "active" });
    const rows = activeKillStepsAt(defs, states, onDemoMap);
    expect(rows).toHaveLength(1);
    expect(rows[0].questId).toBe("rats");
    expect(rows[0].stepIdx).toBe(0);
    expect(rows[0].encounterId).toBe("cellar_rats");
    expect(rows[0].remaining).toBe(1);
  });

  it("filters out steps whose location doesn't match", () => {
    const { defs, states } = bootstrap({ status: "active" });
    expect(activeKillStepsAt(defs, states, elsewhere)).toEqual([]);
  });

  it("subtracts prior kill credits from `remaining`", () => {
    const { defs, states } = bootstrap({ count: 3, status: "active" });
    const s = states.get("rats")!;
    s.stepKills[0] = 1;
    const rows = activeKillStepsAt(defs, states, onDemoMap);
    expect(rows[0].remaining).toBe(2);
  });

  it("drops steps whose remaining hit zero (handled by stepProgress already, but defensively)", () => {
    const { defs, states } = bootstrap({ count: 2, status: "active" });
    const s = states.get("rats")!;
    s.stepKills[0] = 2; // all credits used, step about to flip complete
    expect(activeKillStepsAt(defs, states, onDemoMap)).toEqual([]);
  });

  it("drops steps already marked complete in stepProgress", () => {
    const { defs, states } = bootstrap({ status: "active" });
    const s = states.get("rats")!;
    s.stepProgress[0] = true;
    expect(activeKillStepsAt(defs, states, onDemoMap)).toEqual([]);
  });
});

describe("creditQuestKill", () => {
  /** Two-step kill quest — first step needs `firstCount` clearings,
   *  second needs 1. Used to exercise step-completion and
   *  quest-completion separately. */
  function bootstrap(opts?: { firstCount?: number }) {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "The Giant Rats",
          steps: [
            {
              id: "s1",
              name: "Kill the rats",
              kind: "kill",
              params: { encounter_id: "cellar_rats", count: opts?.firstCount ?? 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
            {
              id: "s2",
              name: "Kill the rat king",
              kind: "kill",
              params: { encounter_id: "rat_king", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";
    return { defs, states };
  }

  it("increments stepKills on the first credit", () => {
    const { defs, states } = bootstrap();
    const credit = creditQuestKill(defs, states, "rats", 0);
    expect(credit).not.toBeNull();
    expect(credit!.killsSoFar).toBe(1);
    expect(states.get("rats")!.stepKills[0]).toBe(1);
  });

  it("flips stepProgress when killsSoFar hits count", () => {
    const { defs, states } = bootstrap({ firstCount: 2 });
    const c1 = creditQuestKill(defs, states, "rats", 0);
    expect(c1!.stepCompleted).toBe(false);
    expect(states.get("rats")!.stepProgress[0]).toBe(false);
    const c2 = creditQuestKill(defs, states, "rats", 0);
    expect(c2!.stepCompleted).toBe(true);
    expect(states.get("rats")!.stepProgress[0]).toBe(true);
  });

  it("does not flip the quest until every step is done", () => {
    const { defs, states } = bootstrap();
    const c1 = creditQuestKill(defs, states, "rats", 0);
    expect(c1!.stepCompleted).toBe(true);
    expect(c1!.questCompleted).toBe(false);
    expect(states.get("rats")!.status).toBe("active");
  });

  it("flips status to completed when the LAST step's count is hit", () => {
    const { defs, states } = bootstrap();
    creditQuestKill(defs, states, "rats", 0);
    const final = creditQuestKill(defs, states, "rats", 1);
    expect(final!.questCompleted).toBe(true);
    expect(states.get("rats")!.status).toBe("completed");
  });

  it("returns null for unknown quest id", () => {
    const { defs, states } = bootstrap();
    expect(creditQuestKill(defs, states, "no_such", 0)).toBeNull();
  });

  it("returns null when the step is already complete", () => {
    const { defs, states } = bootstrap();
    states.get("rats")!.stepProgress[0] = true;
    expect(creditQuestKill(defs, states, "rats", 0)).toBeNull();
  });

  it("returns null when the quest isn't active", () => {
    const { defs, states } = bootstrap();
    states.get("rats")!.status = "available";
    expect(creditQuestKill(defs, states, "rats", 0)).toBeNull();
  });
});
