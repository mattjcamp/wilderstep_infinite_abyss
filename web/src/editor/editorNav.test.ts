import { describe, expect, it } from "vitest";
import { ALL_MODEL_KEYS } from "@/data_model/models";
import { EDITOR_NAV_GROUPS } from "./editorNav";

describe("EDITOR_NAV_GROUPS", () => {
  it("lists every model exactly once", () => {
    const keys = EDITOR_NAV_GROUPS.flatMap((g) =>
      g.entries.flatMap((e) => (e.kind === "model" ? [e.key] : [])),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...ALL_MODEL_KEYS].sort());
  });
});
