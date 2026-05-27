import { describe, expect, it } from "vitest";

import {
  activeKillStepsAt,
  claimQuestRewards,
  creditQuestKill,
  creditQuestRetrieve,
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
      // tileAdds is the sole tile-mutation reward; defaults to empty
      // when the fixture doesn't author any.
      tileAdds: [],
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
    col: 0,
    row: 0,
    positions: [],
    rewards: { items: [], tileAdds: [] },
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

describe("claimQuestRewards", () => {
  /** Single-step kill quest with full rewards. */
  function bootstrap(opts?: {
    xp?: number;
    gold?: number;
    items?: string[];
  }) {
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
              params: { encounter_id: "cellar_rats", count: 1 },
              location_kind: "map",
              map_id: "demo_map",
            },
          ],
          rewards: {
            xp: opts?.xp ?? 100,
            gold: opts?.gold ?? 50,
            items: opts?.items ?? ["camping_supplies"],
          },
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    return { defs, states };
  }

  it("returns null when the quest hasn't been completed yet", () => {
    const { defs, states } = bootstrap();
    // Status is "available".
    expect(claimQuestRewards(defs, states, "rats")).toBeNull();
    // Status is "active".
    states.get("rats")!.status = "active";
    expect(claimQuestRewards(defs, states, "rats")).toBeNull();
  });

  it("grants rewards once when status is completed and flips to turned_in", () => {
    const { defs, states } = bootstrap({ xp: 250, gold: 75, items: ["potion", "scroll"] });
    states.get("rats")!.status = "completed";
    const claim = claimQuestRewards(defs, states, "rats");
    expect(claim).not.toBeNull();
    expect(claim!.questId).toBe("rats");
    expect(claim!.questName).toBe("The Giant Rats");
    expect(claim!.xp).toBe(250);
    expect(claim!.gold).toBe(75);
    expect(claim!.items).toEqual(["potion", "scroll"]);
    expect(states.get("rats")!.status).toBe("turned_in");
  });

  it("is idempotent — second call returns null and doesn't re-grant", () => {
    const { defs, states } = bootstrap();
    states.get("rats")!.status = "completed";
    const first = claimQuestRewards(defs, states, "rats");
    expect(first).not.toBeNull();
    const second = claimQuestRewards(defs, states, "rats");
    expect(second).toBeNull();
    expect(states.get("rats")!.status).toBe("turned_in");
  });

  it("returns null for an unknown quest id", () => {
    const { defs, states } = bootstrap();
    states.get("rats")!.status = "completed";
    expect(claimQuestRewards(defs, states, "no_such")).toBeNull();
  });

  it("handles quests with no rewards declared (defaults to 0/0/[])", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "favor",
          name: "Small Favor",
          steps: [{ id: "s1", name: "step", kind: "kill", params: { encounter_id: "rat", count: 1 } }],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("favor")!.status = "completed";
    const claim = claimQuestRewards(defs, states, "favor");
    expect(claim).not.toBeNull();
    expect(claim!.xp).toBe(0);
    expect(claim!.gold).toBe(0);
    expect(claim!.items).toEqual([]);
  });
});

describe("step-level rewards", () => {
  it("parses a step's `rewards` block with items + tile_add", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "amulet",
          name: "Lost Amulet",
          steps: [
            {
              id: "s1",
              name: "Find the stone",
              kind: "retrieve",
              item_id: "river_stone",
              location_kind: "map",
              map_id: "forest_map",
              col: 4,
              row: 5,
              rewards: {
                items: ["lockpick", "torch"],
                tile_add: [
                  { map: "forest_map", col: 14, row: 7, tile_id: "bridge" },
                ],
              },
            },
          ],
        },
      ],
    });
    const step = defs[0].steps[0];
    expect(step.rewards.items).toEqual(["lockpick", "torch"]);
    expect(step.rewards.tileAdds).toEqual([
      { map: "forest_map", col: 14, row: 7, tile_id: "bridge" },
    ]);
  });

  it("defaults to empty rewards when the step omits the block", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "rats",
          steps: [
            {
              id: "s1",
              name: "step",
              kind: "kill",
              params: { encounter_id: "rat", count: 1 },
            },
          ],
        },
      ],
    });
    const step = defs[0].steps[0];
    expect(step.rewards).toEqual({ items: [], tileAdds: [] });
  });

  it("drops malformed tile_add entries on load (bad map id / coords)", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "amulet",
          name: "Lost Amulet",
          steps: [
            {
              id: "s1",
              name: "step",
              kind: "kill",
              params: { encounter_id: "rat", count: 1 },
              rewards: {
                items: [42, "ok_item"], // 42 should drop
                tile_add: [
                  { map: "", col: 1, row: 1, tile_id: "bridge" }, // empty map
                  { map: "ok_map", tile_id: "bridge" }, // missing coords
                  { map: "ok_map", col: 1, row: 1, tile_id: "" }, // empty tile_id
                  { map: "ok_map", col: 3, row: 4, tile_id: "bridge" }, // good
                ],
              },
            },
          ],
        },
      ],
    });
    const step = defs[0].steps[0];
    expect(step.rewards.items).toEqual(["ok_item"]);
    expect(step.rewards.tileAdds).toEqual([
      { map: "ok_map", col: 3, row: 4, tile_id: "bridge" },
    ]);
  });

  it("creditQuestKill returns step rewards only on the credit that completes the step", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "Rats",
          steps: [
            {
              id: "s1",
              name: "Kill 2 rats",
              kind: "kill",
              params: { encounter_id: "rat", count: 2 },
              location_kind: "map",
              map_id: "demo",
              rewards: {
                items: ["lockpick"],
                tile_add: [
                  { map: "demo", col: 1, row: 2, tile_id: "bridge" },
                ],
              },
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";
    // First credit: progress 1/2 — step NOT completed → stepRewards null.
    const c1 = creditQuestKill(defs, states, "rats", 0);
    expect(c1!.stepCompleted).toBe(false);
    expect(c1!.stepRewards).toBeNull();
    // Second credit: 2/2 → step completes → stepRewards populated.
    const c2 = creditQuestKill(defs, states, "rats", 0);
    expect(c2!.stepCompleted).toBe(true);
    expect(c2!.stepRewards).not.toBeNull();
    expect(c2!.stepRewards!.items).toEqual(["lockpick"]);
    expect(c2!.stepRewards!.tileAdds).toEqual([
      { map: "demo", col: 1, row: 2, tile_id: "bridge" },
    ]);
  });

  it("snapshot returned by creditQuestKill is detached from the underlying def", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "q",
          name: "q",
          steps: [
            {
              id: "s1",
              name: "step",
              kind: "kill",
              params: { encounter_id: "rat", count: 1 },
              rewards: {
                items: ["torch"],
                tile_add: [{ map: "m", col: 0, row: 0, tile_id: "t" }],
              },
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("q")!.status = "active";
    const c = creditQuestKill(defs, states, "q", 0);
    expect(c!.stepRewards).not.toBeNull();
    // Mutate the returned snapshot — the def's rewards must stay intact.
    c!.stepRewards!.items.push("dagger");
    c!.stepRewards!.tileAdds.push({
      map: "x", col: 9, row: 9, tile_id: "y",
    });
    expect(defs[0].steps[0].rewards.items).toEqual(["torch"]);
    expect(defs[0].steps[0].rewards.tileAdds).toEqual([
      { map: "m", col: 0, row: 0, tile_id: "t" },
    ]);
  });

  it("creditQuestRetrieve always returns step rewards on a successful credit", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "amulet",
          name: "Lost Amulet",
          steps: [
            {
              id: "s1",
              name: "Find the stone",
              kind: "retrieve",
              item_id: "river_stone",
              location_kind: "map",
              map_id: "forest",
              col: 3,
              row: 3,
              rewards: {
                items: ["key"],
                tile_add: [
                  { map: "forest", col: 5, row: 5, tile_id: "bridge" },
                ],
              },
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("amulet")!.status = "active";
    const credit = creditQuestRetrieve(defs, states, "amulet", 0);
    expect(credit).not.toBeNull();
    expect(credit!.stepCompleted).toBe(true);
    expect(credit!.questCompleted).toBe(true);
    expect(credit!.stepRewards.items).toEqual(["key"]);
    expect(credit!.stepRewards.tileAdds).toEqual([
      { map: "forest", col: 5, row: 5, tile_id: "bridge" },
    ]);
  });

  it("parses authored positions on a kill step", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "Rats",
          steps: [
            {
              id: "s1",
              name: "Clear the patrols",
              kind: "kill",
              encounter_id: "rat",
              count: 3,
              location_kind: "map",
              map_id: "sewer",
              positions: [
                { col: 5, row: 12 },
                { col: 8, row: 12 },
                { col: 11, row: 12 },
              ],
            },
          ],
        },
      ],
    });
    const step = defs[0].steps[0];
    expect(step.positions).toEqual([
      { col: 5, row: 12 },
      { col: 8, row: 12 },
      { col: 11, row: 12 },
    ]);
  });

  it("defaults positions to [] and drops malformed entries", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "Rats",
          steps: [
            {
              id: "s1",
              name: "step a",
              kind: "kill",
              encounter_id: "rat",
              count: 1,
            },
            {
              id: "s2",
              name: "step b",
              kind: "kill",
              encounter_id: "rat",
              count: 1,
              positions: [
                { col: 1 }, // missing row → drop
                { row: 2 }, // missing col → drop
                "not an object", // not an object → drop
                { col: 3, row: 4 }, // good
              ],
            },
          ],
        },
      ],
    });
    expect(defs[0].steps[0].positions).toEqual([]);
    expect(defs[0].steps[1].positions).toEqual([{ col: 3, row: 4 }]);
  });

  it("activeKillStepsAt drops already-credited positions from its slice", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "rats",
          name: "Rats",
          steps: [
            {
              id: "s1",
              name: "Clear",
              kind: "kill",
              encounter_id: "rat",
              count: 3,
              location_kind: "map",
              map_id: "sewer",
              positions: [
                { col: 1, row: 1 },
                { col: 2, row: 2 },
                { col: 3, row: 3 },
              ],
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("rats")!.status = "active";
    // Simulate two of the three already credited.
    states.get("rats")!.stepKills[0] = 2;
    const rows = activeKillStepsAt(defs, states, {
      kind: "map",
      mapId: "sewer",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].remaining).toBe(1);
    // First two authored positions have already been consumed; only
    // the third remains for the outstanding copy.
    expect(rows[0].positions).toEqual([{ col: 3, row: 3 }]);
  });

  it("creditQuestRetrieve returns an empty step-rewards object when the step authors none", () => {
    const defs = parseQuestsFile({
      quests: [
        {
          id: "amulet",
          name: "Lost Amulet",
          steps: [
            {
              id: "s1",
              name: "Find the stone",
              kind: "retrieve",
              item_id: "river_stone",
              location_kind: "map",
              map_id: "forest",
              col: 3,
              row: 3,
            },
          ],
        },
      ],
    });
    const states = new Map<string, QuestState>();
    ensureQuestStates(defs, states);
    states.get("amulet")!.status = "active";
    const credit = creditQuestRetrieve(defs, states, "amulet", 0);
    expect(credit).not.toBeNull();
    expect(credit!.stepRewards).toEqual({ items: [], tileAdds: [] });
  });
});
