/**
 * filterModules — search + author-handle filtering for the browse
 * surfaces. Author grouping keys off the HANDLE parsed from the id, not
 * the free-text `author` field.
 */
import { describe, expect, it } from "vitest";

import { filterModules } from "./moduleFilter";
import type { ModuleSummary } from "@/data_model/ModuleSource";

function mod(p: Partial<ModuleSummary> & { id: string }): ModuleSummary {
  return {
    title: p.title ?? p.id,
    description: p.description ?? "",
    author: p.author ?? "",
    version: p.version ?? "0.0.0",
    role: p.role ?? "playable",
    ...p,
  } as ModuleSummary;
}

const catalog: ModuleSummary[] = [
  mod({ id: "@matt/sunken-keep", title: "Sunken Keep", author: "hyperbolic", description: "A flooded dungeon" }),
  mod({ id: "@matt/remote_test", title: "Remote Test", description: "Testing publishing" }),
  mod({ id: "@dana/skywatch", title: "Skywatch", description: "Cloud fortress" }),
  mod({ id: "test-evn", title: "Local Eve", description: "A local module" }),
  mod({ id: "@core/default", title: "Default", description: "Core content" }),
];

const ids = (ms: ModuleSummary[]) => ms.map((m) => m.id);

describe("filterModules", () => {
  it("returns everything for an empty filter", () => {
    expect(filterModules(catalog, {})).toHaveLength(catalog.length);
  });

  it("searches title, description, author, and id (case-insensitive)", () => {
    expect(ids(filterModules(catalog, { search: "sunken" }))).toEqual([
      "@matt/sunken-keep",
    ]);
    // author free-text field
    expect(ids(filterModules(catalog, { search: "HYPERbolic" }))).toEqual([
      "@matt/sunken-keep",
    ]);
    // description
    expect(ids(filterModules(catalog, { search: "cloud" }))).toEqual([
      "@dana/skywatch",
    ]);
    // id substring
    expect(ids(filterModules(catalog, { search: "remote_test" }))).toEqual([
      "@matt/remote_test",
    ]);
  });

  it("returns nothing when the search matches nothing", () => {
    expect(filterModules(catalog, { search: "zzz-nope" })).toEqual([]);
  });

  it("filters by owner handle (parsed from the id), excluding bare and @core", () => {
    expect(ids(filterModules(catalog, { handle: "matt" }))).toEqual([
      "@matt/sunken-keep",
      "@matt/remote_test",
    ]);
    expect(ids(filterModules(catalog, { handle: "dana" }))).toEqual([
      "@dana/skywatch",
    ]);
    // "core" is system → no owner handle, never matches
    expect(filterModules(catalog, { handle: "core" })).toEqual([]);
  });

  it("combines handle + search", () => {
    expect(ids(filterModules(catalog, { handle: "matt", search: "test" }))).toEqual([
      "@matt/remote_test",
    ]);
  });

  it("ignores blank/whitespace search", () => {
    expect(filterModules(catalog, { search: "   " })).toHaveLength(catalog.length);
  });
});
