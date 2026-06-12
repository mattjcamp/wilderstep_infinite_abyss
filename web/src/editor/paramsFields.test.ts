/**
 * Params vocabularies (audit P2). The data-driven test is the
 * important one: it walks the default module's actual records and
 * asserts every params key in use is covered by the vocabulary — so
 * when a new knob ships in data, this fails until the ParamsEditor
 * knows how to render it (instead of silently demoting it to a
 * "custom" JSON row).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  defaultValueForSpec,
  getParamsFieldConfig,
} from "./paramsFields";

const MODULE_DIR = join(__dirname, "../../public/modules/default");

function paramsKeysInData(
  file: string,
  collection: string,
  field: string,
): Set<string> {
  const doc = JSON.parse(
    readFileSync(join(MODULE_DIR, file), "utf8"),
  ) as Record<string, Array<Record<string, unknown>>>;
  const keys = new Set<string>();
  for (const rec of doc[collection] ?? []) {
    const params = rec[field];
    if (params && typeof params === "object" && !Array.isArray(params)) {
      for (const k of Object.keys(params)) keys.add(k);
    }
  }
  return keys;
}

describe("params vocabularies cover the data", () => {
  const surfaces: Array<[string, string, string, string]> = [
    ["effects.json", "effects", "params", "effects"],
    ["abilities.json", "abilities", "params", "abilities"],
    ["traps.json", "traps", "params", "traps"],
    ["spells.json", "spells", "action_params", "spells"],
  ];
  for (const [file, collection, field, modelKey] of surfaces) {
    it(`${modelKey}.${field}`, () => {
      const cfg = getParamsFieldConfig(field, modelKey);
      expect(cfg).not.toBeNull();
      const known = new Set(Object.keys(cfg!.specs));
      const inData = paramsKeysInData(file, collection, field);
      const missing = [...inData].filter((k) => !known.has(k));
      expect(
        missing,
        `keys used in ${file} but missing from the ${modelKey} vocabulary — add specs so authors get typed rows`,
      ).toEqual([]);
    });
  }
});

describe("getParamsFieldConfig", () => {
  it("only matches the configured (model, field) pairs", () => {
    expect(getParamsFieldConfig("params", "traps")).not.toBeNull();
    expect(getParamsFieldConfig("action_params", "spells")).not.toBeNull();
    expect(getParamsFieldConfig("params", "spells")).toBeNull();
    expect(getParamsFieldConfig("action_params", "traps")).toBeNull();
    expect(getParamsFieldConfig("params", undefined)).toBeNull();
  });
});

describe("defaultValueForSpec", () => {
  it("produces a sensible starting value per kind", () => {
    expect(defaultValueForSpec({ kind: "number" })).toBe(0);
    expect(defaultValueForSpec({ kind: "number", min: 1 })).toBe(1);
    expect(defaultValueForSpec({ kind: "string" })).toBe("");
    expect(
      defaultValueForSpec({ kind: "enum", options: ["one", "all"] }),
    ).toBe("one");
    expect(
      defaultValueForSpec({
        kind: "id",
        source: { kind: "static", options: [] },
      }),
    ).toBe("");
    expect(
      defaultValueForSpec({
        kind: "id_list",
        source: { kind: "static", options: [] },
      }),
    ).toEqual([]);
    expect(defaultValueForSpec({ kind: "map_cell" })).toEqual({
      map_id: "",
      col: 0,
      row: 0,
    });
    expect(defaultValueForSpec({ kind: "json" })).toBeNull();
  });
});
