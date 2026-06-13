/**
 * sourceConfig — the static/remote selection seam plus the draft-
 * semantics split between the GAME source (preferDrafts false) and
 * the EDITOR source (preferDrafts true). The editor split is what
 * lets remote-mode authoring browse the hosted catalog and reopen
 * published @handle modules (ugc_publishing_plan.md "Next session
 * plan" item 1).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createModuleSource,
  getEditorModuleSource,
  getModuleSource,
  __resetModuleSourceForTests,
} from "./sourceConfig";
import { StaticModuleSource } from "./StaticModuleSource";
import { RemoteModuleSource } from "./RemoteModuleSource";

const HOST = "https://read.example.com";

/** preferDrafts is protected; read it through a narrow cast so the
 *  test asserts the actual instance state rather than re-deriving it. */
function preferDrafts(src: StaticModuleSource): boolean {
  return (src as unknown as { preferDrafts: boolean }).preferDrafts;
}

afterEach(() => {
  __resetModuleSourceForTests();
  delete process.env.NEXT_PUBLIC_MODULE_SOURCE;
  delete process.env.NEXT_PUBLIC_READ_HOST;
});

describe("createModuleSource", () => {
  it("defaults to a static source with game (no-draft) semantics", () => {
    const src = createModuleSource(undefined, undefined);
    expect(src).toBeInstanceOf(StaticModuleSource);
    expect(src).not.toBeInstanceOf(RemoteModuleSource);
    expect(preferDrafts(src)).toBe(false);
  });

  it("returns a remote source when mode=remote and a host is set", () => {
    const src = createModuleSource("remote", HOST);
    expect(src).toBeInstanceOf(RemoteModuleSource);
  });

  it("honors preferDrafts for both static and remote", () => {
    expect(
      preferDrafts(createModuleSource(undefined, undefined, { preferDrafts: true })),
    ).toBe(true);
    expect(
      preferDrafts(createModuleSource("remote", HOST, { preferDrafts: true })),
    ).toBe(true);
  });

  it("falls back to static when mode=remote but the host is blank", () => {
    expect(createModuleSource("remote", "   ")).not.toBeInstanceOf(
      RemoteModuleSource,
    );
    expect(createModuleSource("remote", undefined)).not.toBeInstanceOf(
      RemoteModuleSource,
    );
  });
});

describe("getModuleSource vs getEditorModuleSource", () => {
  it("game source never prefers drafts; editor source always does", () => {
    const game = getModuleSource();
    const editor = getEditorModuleSource();
    expect(preferDrafts(game)).toBe(false);
    expect(preferDrafts(editor)).toBe(true);
    // Independent caches — the two must not collapse into one instance.
    expect(game).not.toBe(editor);
  });

  it("both follow the env selection, but keep their own draft semantics", () => {
    process.env.NEXT_PUBLIC_MODULE_SOURCE = "remote";
    process.env.NEXT_PUBLIC_READ_HOST = HOST;
    const game = getModuleSource();
    const editor = getEditorModuleSource();
    expect(game).toBeInstanceOf(RemoteModuleSource);
    expect(editor).toBeInstanceOf(RemoteModuleSource);
    expect(preferDrafts(game)).toBe(false);
    expect(preferDrafts(editor)).toBe(true);
  });

  it("caches each getter independently", () => {
    expect(getModuleSource()).toBe(getModuleSource());
    expect(getEditorModuleSource()).toBe(getEditorModuleSource());
  });
});
