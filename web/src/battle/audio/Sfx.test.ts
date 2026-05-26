import { describe, it, expect } from "vitest";
import { Sfx, SFX_NAMES } from "./Sfx";

describe("Sfx catalog — registered generators", () => {
  it("knows the temple-counter heal cue", () => {
    // The counter overlay calls `Sfx.play("heal")` on every applied
    // service; a missing entry would silently no-op (the player
    // would think the SFX system is broken, not that the name was
    // wrong) so we lock in the contract here.
    expect(Sfx.has("heal")).toBe(true);
    expect(SFX_NAMES).toContain("heal");
  });

  it("knows the buy + sell counter transaction cues", () => {
    // New cues added for the counter shop overlay so the player
    // can hear which direction a transaction went. Same silent-
    // no-op risk as above if a registration is dropped, so this
    // test stands guard.
    expect(Sfx.has("buy")).toBe(true);
    expect(Sfx.has("sell")).toBe(true);
    expect(SFX_NAMES).toContain("buy");
    expect(SFX_NAMES).toContain("sell");
  });

  it("returns false for unknown names rather than throwing", () => {
    // Defensive: a typoed name should be a quiet no-op, not a
    // crash. The overlay's call sites bank on this so they don't
    // have to guard every `Sfx.play(...)`.
    expect(Sfx.has("not_a_real_sfx")).toBe(false);
    expect(() => Sfx.play("not_a_real_sfx")).not.toThrow();
  });
});
