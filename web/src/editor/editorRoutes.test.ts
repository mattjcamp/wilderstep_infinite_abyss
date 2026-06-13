/**
 * editor*Href — query-param editor routes. Must round-trip qualified
 * (hosted) ids so the static export can edit `@handle/slug` modules
 * (the `[moduleId]` path routes 404'd for them).
 */
import { describe, expect, it } from "vitest";

import {
  decodeModuleIdParam,
  editorBattleSimHref,
  editorDungeonSimHref,
  editorMapHref,
  editorModelHref,
  editorModuleHref,
  editorSoundtrackHref,
  editorSpritesHref,
} from "./moduleRoutes";

/** Pull a decoded query value out of a generated href. */
function param(href: string, key: string): string | null {
  const q = href.split("?")[1] ?? "";
  return new URLSearchParams(q).get(key);
}

describe("editor route helpers", () => {
  it("build the expected flat query-param URLs for bare ids", () => {
    expect(editorModuleHref("test-evn")).toBe("/editor/module?m=test-evn");
    expect(editorModelHref("test-evn", "maps")).toBe(
      "/editor/model?m=test-evn&k=maps",
    );
    expect(editorMapHref("test-evn", "overworld")).toBe(
      "/editor/map?m=test-evn&map=overworld",
    );
    expect(editorSpritesHref("test-evn")).toBe("/editor/sprites?m=test-evn");
    expect(editorSoundtrackHref("test-evn")).toBe(
      "/editor/soundtrack?m=test-evn",
    );
    expect(editorBattleSimHref("test-evn")).toBe(
      "/editor/sim/battle?m=test-evn",
    );
    expect(editorDungeonSimHref("test-evn")).toBe(
      "/editor/sim/dungeon?m=test-evn",
    );
  });

  it("percent-encodes qualified ids (@ and /) in the m param", () => {
    expect(editorModuleHref("@matt/test2")).toBe(
      "/editor/module?m=%40matt%2Ftest2",
    );
  });

  it("round-trips bare and qualified ids (and model/map keys)", () => {
    for (const id of ["test-evn", "@matt/remote_test", "@core/default"]) {
      expect(decodeModuleIdParam(param(editorModuleHref(id), "m")!)).toBe(id);
      const model = editorModelHref(id, "spells");
      expect(decodeModuleIdParam(param(model, "m")!)).toBe(id);
      expect(param(model, "k")).toBe("spells");
      const map = editorMapHref(id, "dungeon_1");
      expect(decodeModuleIdParam(param(map, "m")!)).toBe(id);
      expect(param(map, "map")).toBe("dungeon_1");
    }
  });

  it("merges extra params (sim traversal, tags) alongside m/map", () => {
    const href = editorMapHref("@matt/x", "overworld", {
      sim: "1",
      entryCol: 4,
      entryRow: 7,
    });
    expect(param(href, "m") && decodeModuleIdParam(param(href, "m")!)).toBe(
      "@matt/x",
    );
    expect(param(href, "map")).toBe("overworld");
    expect(param(href, "sim")).toBe("1");
    expect(param(href, "entryCol")).toBe("4");
    expect(param(href, "entryRow")).toBe("7");
  });

  it("drops empty/undefined extra params", () => {
    const href = editorModelHref("test-evn", "maps", { tag: "", foo: undefined });
    expect(href).toBe("/editor/model?m=test-evn&k=maps");
  });
});
