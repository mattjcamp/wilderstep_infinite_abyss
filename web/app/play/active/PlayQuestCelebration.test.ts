import { describe, it, expect } from "vitest";
import { returnToGiverSubtitle } from "./PlayQuestCelebration";

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
