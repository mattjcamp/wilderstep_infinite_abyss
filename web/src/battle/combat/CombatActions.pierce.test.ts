import { describe, it, expect } from "vitest";
import { traceDirectionalPierce } from "./CombatActions";
import type { Combatant } from "../types";

/** Minimal stand-in — the pierce trace only reads `.id`. */
function stub(id: string): Combatant {
  return { id } as unknown as Combatant;
}

describe("traceDirectionalPierce", () => {
  const noWall = (): boolean => false;

  it("collects every creature in the line, in caster→outward order", () => {
    const occ: Record<string, Combatant> = {
      "3,0": stub("a"),
      "5,0": stub("b"),
      "7,0": stub("c"),
    };
    const at = (c: number, r: number) => occ[`${c},${r}`] ?? null;
    const t = traceDirectionalPierce(
      { col: 0, row: 0 }, { dCol: 1, dRow: 0 }, 10, noWall, at,
    );
    expect(t.hitIds).toEqual(["a", "b", "c"]);
    expect(t.endCol).toBe(10); // last tile reached at the range cap
    expect(t.endRow).toBe(0);
  });

  it("stops at a wall, keeping only the creatures before it", () => {
    const occ: Record<string, Combatant> = {
      "2,0": stub("a"),
      "6,0": stub("b"), // past the wall — never reached
    };
    const at = (c: number, r: number) => occ[`${c},${r}`] ?? null;
    const isWall = (c: number): boolean => c === 4;
    const t = traceDirectionalPierce(
      { col: 0, row: 0 }, { dCol: 1, dRow: 0 }, 10, isWall, at,
    );
    expect(t.hitIds).toEqual(["a"]);
    expect(t.endCol).toBe(3); // last open tile before the wall
  });

  it("returns no hits when nothing is in the line", () => {
    const t = traceDirectionalPierce(
      { col: 0, row: 0 }, { dCol: 0, dRow: 1 }, 5, noWall, () => null,
    );
    expect(t.hitIds).toEqual([]);
  });
});
