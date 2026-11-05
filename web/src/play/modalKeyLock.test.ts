import { describe, it, expect } from "vitest";
import { acquireModalKeyLock, isModalKeyLocked } from "./modalKeyLock";

describe("modalKeyLock", () => {
  it("locks while held and nests", () => {
    expect(isModalKeyLocked()).toBe(false);
    const a = acquireModalKeyLock();
    const b = acquireModalKeyLock();
    expect(isModalKeyLocked()).toBe(true);
    a();
    a(); // idempotent
    expect(isModalKeyLocked()).toBe(true);
    b();
    expect(isModalKeyLocked()).toBe(false);
  });
});
