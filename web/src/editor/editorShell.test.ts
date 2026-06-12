/**
 * Editor-shell copy conventions (audit P4). These strings are
 * user-facing across every browse — pinning them keeps a future
 * one-off edit from re-fragmenting the shell.
 */
import { describe, expect, it } from "vitest";

import {
  deleteRecordConfirmMessage,
  discardDraftConfirmMessage,
} from "./editorShell";
import {
  ALL_MODEL_KEYS,
  singularModelLabel,
} from "@/data_model/models";

describe("deleteRecordConfirmMessage", () => {
  it("names the thing and states the draft consequence", () => {
    const msg = deleteRecordConfirmMessage({
      kind: "character",
      name: "selina",
      fileName: "characters.json",
    });
    expect(msg).toContain('Delete character "selina"?');
    expect(msg).toContain("characters.json");
    expect(msg).toContain("until you Publish");
  });

  it("threads the optional detail sentence before the consequence", () => {
    const msg = deleteRecordConfirmMessage({
      kind: "quest",
      name: "rat_hunt",
      fileName: "quests.json",
      detail: "This deletes the whole quest, including its steps.",
    });
    expect(msg.indexOf("including its steps")).toBeLessThan(
      msg.indexOf("Removes it from"),
    );
  });
});

describe("discardDraftConfirmMessage", () => {
  it("names the file and warns about irreversibility", () => {
    const msg = discardDraftConfirmMessage("maps.json");
    expect(msg).toContain("maps.json");
    expect(msg).toContain("cannot be undone");
  });
});

describe("singularModelLabel", () => {
  it("covers every registered model with a non-plural label", () => {
    for (const key of ALL_MODEL_KEYS) {
      const label = singularModelLabel(key);
      expect(label.length, key).toBeGreaterThan(0);
      // The naive-depluralisation traps: these would read wrong if
      // someone swaps the explicit map for label.slice(0, -1).
      expect(label).not.toMatch(/ie$/); // "Abilitie"
    }
    expect(singularModelLabel("abilities")).toBe("Ability");
    expect(singularModelLabel("character_classes")).toBe("Character Class");
    expect(singularModelLabel("npcs")).toBe("NPC");
  });

  it("falls back gracefully for unknown keys", () => {
    expect(singularModelLabel("not_a_model")).toBe("not_a_model");
  });
});
