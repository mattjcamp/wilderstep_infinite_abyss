/**
 * publishClient — the sign-out URL builder and the deleteModule helper
 * that the My Modules surface relies on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteModule, publishSignOutUrl } from "./publishClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("publishSignOutUrl", () => {
  it("points at the worker /logout route (logout + redirect to landing)", () => {
    // /logout runs the per-app Access logout (clears this app's cookie)
    // then bounces to the public landing page via /signed-out.
    expect(publishSignOutUrl()).toMatch(/\/logout$/);
  });
});

describe("deleteModule", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a delete-module item and resolves when the server reports ok", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ ok: true, item: {}, path: "modules/@matt/x/" }] }),
    );
    vi.stubGlobal("fetch", fetchStub);

    await expect(deleteModule("@matt/x")).resolves.toBeUndefined();

    const [, init] = fetchStub.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body).items[0]).toEqual({
      kind: "delete-module",
      moduleId: "@matt/x",
    });
  });

  it("throws the per-item error when the server rejects (e.g. not owned)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ results: [{ ok: false, item: {}, error: "not owned" }] }),
      ),
    );
    await expect(deleteModule("@dana/x")).rejects.toThrow("not owned");
  });
});
