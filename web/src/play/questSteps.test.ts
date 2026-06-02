import { describe, it, expect } from "vitest";
import {
  completedStepIds,
  completedStepCount,
  isStepDone,
  isQuestBodyComplete,
  leadingRunCount,
  markStepDone,
} from "./questSteps";

/** The rat quest shape: four kill steps by stable id. */
const ratQuest = {
  id: "rats",
  steps: [
    { id: "rats_step_1" },
    { id: "rats_step_2" },
    { id: "rats_step_3" },
    { id: "rats_step_4" },
  ],
};

describe("questSteps — completedStepIds", () => {
  it("reads the authoritative questStepsDone set when present", () => {
    const done = completedStepIds(
      { questStepsDone: { rats: ["rats_step_3"] } },
      ratQuest,
    );
    expect(done.has("rats_step_3")).toBe(true);
    expect(done.has("rats_step_1")).toBe(false);
    expect(done.size).toBe(1);
  });

  it("falls back to deriving from the legacy linear integer (first N)", () => {
    // Old save with no per-step record: questStepProgress = 2 means
    // the first two steps are done.
    const done = completedStepIds(
      { questStepProgress: { rats: 2 } },
      ratQuest,
    );
    expect(done.has("rats_step_1")).toBe(true);
    expect(done.has("rats_step_2")).toBe(true);
    expect(done.has("rats_step_3")).toBe(false);
  });

  it("prefers questStepsDone over the legacy integer when both exist", () => {
    const done = completedStepIds(
      {
        questStepProgress: { rats: 2 },
        questStepsDone: { rats: ["rats_step_4"] },
      },
      ratQuest,
    );
    expect(done.has("rats_step_4")).toBe(true);
    expect(done.has("rats_step_1")).toBe(false);
  });
});

describe("questSteps — out-of-order completion (the reported bug)", () => {
  it("marks step 3 done before 1 & 2 and keeps it stuck", () => {
    let fields: {
      questStepProgress?: Record<string, number>;
      questStepsDone?: Record<string, ReadonlyArray<string>>;
    } = {};

    // Complete step 3 first.
    const r1 = markStepDone(fields, ratQuest, "rats_step_3");
    fields = {
      questStepProgress: r1.questStepProgress,
      questStepsDone: r1.questStepsDone,
    };
    expect(r1.changed).toBe(true);
    expect(r1.questNowComplete).toBe(false);
    expect(isStepDone(fields, ratQuest, 2)).toBe(true); // step 3, idx 2
    expect(isStepDone(fields, ratQuest, 0)).toBe(false);
    // The whole-quest count reflects 1 done regardless of position.
    expect(completedStepCount(fields, ratQuest)).toBe(1);
    // Legacy integer is the LEADING run, still 0 (step 1 not done).
    expect(fields.questStepProgress?.rats).toBe(0);

    // Now complete step 1.
    const r2 = markStepDone(fields, ratQuest, "rats_step_1");
    fields = {
      questStepProgress: r2.questStepProgress,
      questStepsDone: r2.questStepsDone,
    };
    expect(completedStepCount(fields, ratQuest)).toBe(2);
    // Leading run is now 1 (step 1 done, step 2 still open).
    expect(fields.questStepProgress?.rats).toBe(1);

    // Finish 2 and 4 → quest body complete.
    const r3 = markStepDone(fields, ratQuest, "rats_step_2");
    fields = {
      questStepProgress: r3.questStepProgress,
      questStepsDone: r3.questStepsDone,
    };
    const r4 = markStepDone(fields, ratQuest, "rats_step_4");
    fields = {
      questStepProgress: r4.questStepProgress,
      questStepsDone: r4.questStepsDone,
    };
    expect(r4.questNowComplete).toBe(true);
    expect(isQuestBodyComplete(fields, ratQuest)).toBe(true);
    // All four done → leading run is the full length.
    expect(fields.questStepProgress?.rats).toBe(4);
  });

  it("markStepDone is idempotent — re-marking a done step is a no-op", () => {
    const r1 = markStepDone({}, ratQuest, "rats_step_2");
    const fields = {
      questStepProgress: r1.questStepProgress,
      questStepsDone: r1.questStepsDone,
    };
    const r2 = markStepDone(fields, ratQuest, "rats_step_2");
    expect(r2.changed).toBe(false);
    expect(completedStepCount(fields, ratQuest)).toBe(1);
  });

  it("does not mutate the input fields", () => {
    const fields = { questStepsDone: { rats: ["rats_step_1"] } };
    const before = JSON.stringify(fields);
    markStepDone(fields, ratQuest, "rats_step_3");
    expect(JSON.stringify(fields)).toBe(before);
  });
});

describe("questSteps — leadingRunCount", () => {
  it("counts only the consecutive completed steps from the front", () => {
    expect(
      leadingRunCount(new Set(["rats_step_1", "rats_step_2"]), ratQuest),
    ).toBe(2);
    // A gap stops the run: step 1 + step 3 done → leading run is 1.
    expect(
      leadingRunCount(new Set(["rats_step_1", "rats_step_3"]), ratQuest),
    ).toBe(1);
    // Only a later step done → leading run is 0.
    expect(leadingRunCount(new Set(["rats_step_3"]), ratQuest)).toBe(0);
  });
});

describe("questSteps — isQuestBodyComplete", () => {
  it("is false until every step id is present, true once all are", () => {
    expect(
      isQuestBodyComplete(
        { questStepsDone: { rats: ["rats_step_1", "rats_step_2", "rats_step_3"] } },
        ratQuest,
      ),
    ).toBe(false);
    expect(
      isQuestBodyComplete(
        {
          questStepsDone: {
            rats: [
              "rats_step_1",
              "rats_step_2",
              "rats_step_3",
              "rats_step_4",
            ],
          },
        },
        ratQuest,
      ),
    ).toBe(true);
  });

  it("treats a zero-step quest as not complete", () => {
    expect(isQuestBodyComplete({}, { id: "empty", steps: [] })).toBe(false);
  });
});
