import { describe, expect, it } from "vitest";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import {
  DEFAULT_ADVENTURE_ID,
  resolveCurrentAdventure,
} from "./currentAdventure";

const mod = (id: string): ModuleSummary => ({
  id,
  title: id,
  description: "",
  author: "",
  version: "0.1.0",
});

describe("resolveCurrentAdventure", () => {
  const catalog = [mod("test"), mod(DEFAULT_ADVENTURE_ID), mod("other")];

  it("returns the remembered adventure when it's installed", () => {
    expect(resolveCurrentAdventure(catalog, "other")?.id).toBe("other");
  });

  it("falls back to the default when the remembered one is gone", () => {
    expect(resolveCurrentAdventure(catalog, "deleted")?.id).toBe(
      DEFAULT_ADVENTURE_ID,
    );
  });

  it("falls back to the first playable module without the default", () => {
    expect(resolveCurrentAdventure([mod("a"), mod("b")], "zzz")?.id).toBe("a");
  });

  it("returns null when nothing is playable", () => {
    expect(resolveCurrentAdventure([], DEFAULT_ADVENTURE_ID)).toBeNull();
  });
});
