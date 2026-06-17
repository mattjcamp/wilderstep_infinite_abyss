import { describe, it, expect } from "vitest";
import {
  returnToGiverSubtitle,
  stepFinalSubtitle,
} from "./PlayQuestCelebration";

describe("returnToGiverSubtitle", () => {
  it("returns 'Return to {name}' when a giver name is supplied", () => {
    expect(returnToGiverSubtitle("Jerald")).toBe("Return to Jerald");
  });

  it("preserves multi-word names verbatim", () => {
    expect(returnToGiverSubtitle("Mayor Edna")).toBe("Return to Mayor Edna");
  });

  it("falls back to a name-free prompt when the name is empty", () => {
    expect(returnToGiverSubtitle("")).toBe("Return to the quest giver");
  });

  it("falls back when the name is just whitespace", () => {
    // A quest authored with a stray " " in the giver name field
    // shouldn't surface "Return to " as the prompt.
    expect(returnToGiverSubtitle("   ")).toBe("Return to the quest giver");
  });

  it("falls back when the name is null or undefined", () => {
    // Defensive — QuestDef.questGiver.npcName is always defined per
    // the loader, but a hand-rolled fixture / future shape change
    // shouldn't make the helper return "Return to undefined".
    expect(returnToGiverSubtitle(undefined)).toBe("Return to the quest giver");
    expect(returnToGiverSubtitle(null)).toBe("Return to the quest giver");
  });

  it("trims leading/trailing whitespace before composing the prompt", () => {
    // Authored names sometimes have trailing whitespace from copy-
    // paste; we don't want the prompt to render as "Return to Jerald "
    // with a dangling space.
    expect(returnToGiverSubtitle("  Jerald  ")).toBe("Return to Jerald");
  });
});

describe("stepFinalSubtitle", () => {
  it("appends an item summary after the return-to-giver prompt", () => {
    // The "Return Item" feature: a final step that reclaims an item
    // should still surface it on the objectives-complete placard.
    expect(stepFinalSubtitle("Jerald", "−Skeleton Key")).toBe(
      "Return to Jerald · −Skeleton Key",
    );
  });

  it("appends a combined grant + return summary", () => {
    expect(stepFinalSubtitle("Jerald", "+Gold Ring · −Skeleton Key")).toBe(
      "Return to Jerald · +Gold Ring · −Skeleton Key",
    );
  });

  it("returns the bare prompt when the step had no item changes", () => {
    expect(stepFinalSubtitle("Jerald", "")).toBe("Return to Jerald");
  });

  it("still falls back to the name-free prompt with a summary", () => {
    expect(stepFinalSubtitle("", "−Skeleton Key")).toBe(
      "Return to the quest giver · −Skeleton Key",
    );
  });
});
