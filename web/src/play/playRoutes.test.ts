/**
 * playRoutes — the query-param play URLs must round-trip qualified
 * (hosted) module ids. A `@handle/slug` id has to be encoded into the
 * `?m=` value and decode back unchanged, or hosted modules can't be
 * launched from the picker.
 */
import { describe, expect, it } from "vitest";

import { authorHref, playBeginHref, playPartyHref } from "./playRoutes";
import { decodeModuleIdParam } from "@/editor/moduleRoutes";

/** Pull the decoded `m` value back out of a generated href. */
function readM(href: string): string {
  const q = href.split("?")[1] ?? "";
  const raw = new URLSearchParams(q).get("m") ?? "";
  return decodeModuleIdParam(raw);
}

describe("playRoutes", () => {
  it("points at the static query-param routes (not a [moduleId] segment)", () => {
    expect(playPartyHref("test-evn")).toBe("/play/new/party?m=test-evn");
    expect(playBeginHref("test-evn")).toBe("/play/new/begin?m=test-evn");
  });

  it("encodes qualified ids so @ and / survive the query string", () => {
    const href = playPartyHref("@matt/remote_test");
    // The @ and / must be percent-encoded, not left raw.
    expect(href).toBe("/play/new/party?m=%40matt%2Fremote_test");
    expect(href).not.toContain("/play/new/party?m=@matt/remote_test");
  });

  it("builds the query-param author page URL", () => {
    expect(authorHref("matt")).toBe("/play/author?h=matt");
  });

  it("round-trips bare and qualified ids through decodeModuleIdParam", () => {
    for (const id of ["test-evn", "@matt/remote_test", "@core/default"]) {
      expect(readM(playPartyHref(id))).toBe(id);
      expect(readM(playBeginHref(id))).toBe(id);
    }
  });
});
