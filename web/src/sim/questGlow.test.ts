import { describe, it, expect } from "vitest";
import {
  computeQuestGlowCells,
  type QuestGlowCell,
  type QuestGlowQuest,
} from "./questGlow";

/** Build a grid from a string of single chars where:
 *    '.' is an empty cell
 *    'q' has quest='Q' (the giver)
 *    'e' has encounter='wolves'
 *    'i' has item='lost_locket'
 *    'x' has encounter='unrelated'
 *  Newlines separate rows.
 */
function grid(s: string): QuestGlowCell[][] {
  return s
    .trim()
    .split("\n")
    .map((line) =>
      [...line.trim()].map((ch): QuestGlowCell => {
        if (ch === "q") return { quest: "Q" };
        if (ch === "e") return { encounter: "wolves" };
        if (ch === "i") return { item: "lost_locket" };
        if (ch === "x") return { encounter: "unrelated" };
        return {};
      }),
    );
}

const QUESTS: QuestGlowQuest[] = [
  {
    id: "Q",
    steps: [
      // Current shape: first-class top-level fields. The legacy
      // `params: { encounter_id, item_id }` shape is still supported
      // as a read fallback — exercised in a dedicated test below.
      { kind: "kill", encounter_id: "wolves" },
      { kind: "fetch", item_id: "lost_locket" },
    ],
  },
  {
    id: "Q2",
    steps: [{ kind: "kill", encounter_id: "boars" }],
  },
];

describe("computeQuestGlowCells", () => {
  it("glows quest givers regardless of accepted-quest filter", () => {
    const g = grid("..q.\n....");
    const noFilter = computeQuestGlowCells(g, QUESTS);
    const empty = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(),
    });
    expect(noFilter).toEqual(new Set(["2,0"]));
    // Even with an empty accepted set, givers still glow — the
    // breadcrumb that draws the player TO the quest in the first
    // place.
    expect(empty).toEqual(new Set(["2,0"]));
  });

  it("keeps a giver glowing while the quest is mid-flight (accepted but not yet turned in)", () => {
    // Steps-complete-but-not-handed-in is exactly when the player
    // needs the breadcrumb back to the giver, so the halo stays on.
    const g = grid("..q.\n....");
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q"]),
      turnedInQuests: new Set(),
    });
    expect(cells).toEqual(new Set(["2,0"]));
  });

  it("stops glowing a giver once their quest is in turnedInQuests", () => {
    // Quest is fully done — giver has nothing left to offer the
    // player, so the breadcrumb goes dark.
    const g = grid("..q.\n....");
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q"]),
      turnedInQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set());
  });

  it("only suppresses the giver of the turned-in quest, not other givers", () => {
    // Two givers on the map, Q1 and Q2. Turning in Q1 must not
    // dim Q2's breadcrumb.
    const g: QuestGlowCell[][] = [
      [{ quest: "Q" }, {}, { quest: "Q2" }],
    ];
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q", "Q2"]),
      turnedInQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set(["2,0"]));
  });

  it("falls through to encounter/item checks when a giver cell's quest is turned in", () => {
    // A cell that's BOTH the giver for Q AND an encounter for Q2's
    // kill step. Once Q is turned in the giver halo goes away, but
    // the cell should still glow on the Q2 encounter axis (if Q2
    // is accepted).
    const quests: QuestGlowQuest[] = [
      { id: "Q", steps: [] },
      { id: "Q2", steps: [{ kind: "kill", encounter_id: "wolves" }] },
    ];
    const cell: QuestGlowCell = { quest: "Q", encounter: "wolves" };
    const g = [[cell]];
    const cells = computeQuestGlowCells(g, quests, {
      acceptedQuests: new Set(["Q2"]),
      turnedInQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set(["0,0"]));
  });

  it("glows kill-step encounters when no filter is supplied (editor view)", () => {
    const g = grid("...e\n....");
    const cells = computeQuestGlowCells(g, QUESTS);
    expect(cells).toEqual(new Set(["3,0"]));
  });

  it("glows fetch-step items when no filter is supplied (editor view)", () => {
    const g = grid("....\n..i.");
    const cells = computeQuestGlowCells(g, QUESTS);
    expect(cells).toEqual(new Set(["2,1"]));
  });

  it("hides kill-step encounters when their quest is not accepted (play view)", () => {
    const g = grid("...e\n....");
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(),
    });
    expect(cells).toEqual(new Set());
  });

  it("reveals kill-step encounters once the quest is accepted", () => {
    const g = grid("...e\n....");
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set(["3,0"]));
  });

  it("reveals fetch-step items once the quest is accepted", () => {
    const g = grid("....\n..i.");
    const cells = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set(["2,1"]));
  });

  it("reveals retrieve-step items once the quest is accepted", () => {
    // Same shape as fetch — `retrieve` is the v2 step kind for
    // "item appears on a cell when quest is accepted; pick it up to
    // credit the step". The glow path treats them identically.
    const retrieveQuests: QuestGlowQuest[] = [
      {
        id: "R",
        steps: [{ kind: "retrieve", item_id: "lost_locket" }],
      },
    ];
    const g = grid("....\n..i.");
    const cells = computeQuestGlowCells(g, retrieveQuests, {
      acceptedQuests: new Set(["R"]),
    });
    expect(cells).toEqual(new Set(["2,1"]));
  });

  it("ignores encounters / items not named by any quest step", () => {
    const g = grid("x..\n.x.");
    const noFilter = computeQuestGlowCells(g, QUESTS);
    expect(noFilter).toEqual(new Set());
    const accepted = computeQuestGlowCells(g, QUESTS, {
      acceptedQuests: new Set(["Q", "Q2"]),
    });
    expect(accepted).toEqual(new Set());
  });

  it("handles a kill-step encounter referenced by multiple quests — glows if ANY quest is accepted", () => {
    const quests: QuestGlowQuest[] = [
      { id: "A", steps: [{ kind: "kill", params: { encounter_id: "wolves" } }] },
      { id: "B", steps: [{ kind: "kill", params: { encounter_id: "wolves" } }] },
    ];
    const g = grid("...e");
    const onlyA = computeQuestGlowCells(g, quests, {
      acceptedQuests: new Set(["A"]),
    });
    const onlyB = computeQuestGlowCells(g, quests, {
      acceptedQuests: new Set(["B"]),
    });
    const neither = computeQuestGlowCells(g, quests, {
      acceptedQuests: new Set(),
    });
    expect(onlyA).toEqual(new Set(["3,0"]));
    expect(onlyB).toEqual(new Set(["3,0"]));
    expect(neither).toEqual(new Set());
  });

  it("doesn't double-add when a cell qualifies via multiple criteria", () => {
    // A cell with BOTH a quest giver AND a quest-target encounter
    // should appear once.
    const cell: QuestGlowCell = { quest: "Q", encounter: "wolves" };
    const g = [[cell]];
    const cells = computeQuestGlowCells(g, QUESTS);
    expect(cells).toEqual(new Set(["0,0"]));
    expect(cells.size).toBe(1);
  });

  it("falls back to legacy params.encounter_id / params.item_id for pre-cleanup data", () => {
    // Older quests.json that hasn't been re-saved through the new
    // editor still nests target fields inside `params`. The helper
    // honours both shapes so a half-migrated module still glows.
    const legacy: QuestGlowQuest[] = [
      {
        id: "Q",
        steps: [
          { kind: "kill", params: { encounter_id: "wolves" } },
          { kind: "fetch", params: { item_id: "lost_locket" } },
        ],
      },
    ];
    const g = grid("...e\n..i.");
    const cells = computeQuestGlowCells(g, legacy, {
      acceptedQuests: new Set(["Q"]),
    });
    expect(cells).toEqual(new Set(["3,0", "2,1"]));
  });

  it("handles empty / missing rows defensively", () => {
    const g: (QuestGlowCell | null)[][] = [
      [{ quest: "Q" }, null, { encounter: "wolves" }],
      // @ts-expect-error — runtime defensiveness; null rows shouldn't crash
      null,
      [],
    ];
    const cells = computeQuestGlowCells(g, QUESTS);
    expect(cells).toEqual(new Set(["0,0", "2,0"]));
  });
});
