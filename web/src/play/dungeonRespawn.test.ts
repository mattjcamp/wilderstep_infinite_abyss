import { describe, expect, it } from "vitest";

import {
  dungeonRespawnStatus,
  reclaimDungeon,
  respawnDays,
  stampDungeonCleared,
} from "./dungeonRespawn";
import type { WorldSave } from "./saveTypes";

const DAY = 24 * 60;

function save(party: Partial<WorldSave["party"]> = {}, dungeons: Record<string, unknown> = {}): WorldSave {
  return { party: { ...party }, dungeons } as unknown as WorldSave;
}

describe("respawnDays", () => {
  it("accepts whole days ≥ 1 and treats anything else as off", () => {
    expect(respawnDays(3)).toBe(3);
    expect(respawnDays(2.9)).toBe(2);
    expect(respawnDays(0)).toBeUndefined();
    expect(respawnDays(-1)).toBeUndefined();
    expect(respawnDays("3")).toBeUndefined();
    expect(respawnDays(undefined)).toBeUndefined();
  });
});

describe("dungeonRespawnStatus", () => {
  const id = "crypt@overworld:4,5";

  it("is not-cleared for a dungeon the party hasn't cleared", () => {
    expect(
      dungeonRespawnStatus({ save: save(), instanceId: id, mapRespawnDays: 3, nowMinutes: 99 * DAY }),
    ).toEqual({ kind: "not-cleared" });
  });

  it("stays cleared forever when the map doesn't respawn", () => {
    const s = save({ clearedDungeons: [id], clearedDungeonsAt: { [id]: 0 } });
    expect(
      dungeonRespawnStatus({ save: s, instanceId: id, mapRespawnDays: undefined, nowMinutes: 999 * DAY }),
    ).toEqual({ kind: "cleared" });
  });

  it("asks for a stamp on old saves with no clear time", () => {
    const s = save({ clearedDungeons: [id] });
    expect(
      dungeonRespawnStatus({ save: s, instanceId: id, mapRespawnDays: 3, nowMinutes: 10 * DAY }),
    ).toEqual({ kind: "needs-stamp" });
  });

  it("is reclaimed once the delay has passed", () => {
    const s = save({ clearedDungeons: [id], clearedDungeonsAt: { [id]: 1 * DAY } });
    expect(
      dungeonRespawnStatus({ save: s, instanceId: id, mapRespawnDays: 3, nowMinutes: 4 * DAY - 1 }),
    ).toEqual({ kind: "cleared", readyAtMinutes: 4 * DAY });
    expect(
      dungeonRespawnStatus({ save: s, instanceId: id, mapRespawnDays: 3, nowMinutes: 4 * DAY }),
    ).toEqual({ kind: "reclaimed" });
  });
});

describe("stamp + reclaim", () => {
  const id = "crypt@overworld:4,5";
  const other = "mine@overworld:9,9";

  it("stamps the clear time without touching other instances", () => {
    const s = stampDungeonCleared(save({ clearedDungeonsAt: { [other]: 5 } }), id, 42);
    expect(s.party.clearedDungeonsAt).toEqual({ [other]: 5, [id]: 42 });
  });

  it("forgets only the reclaimed run", () => {
    const s = reclaimDungeon(
      save(
        { clearedDungeons: [id, other], clearedDungeonsAt: { [id]: 1, [other]: 2 } },
        { [id]: { seed: 1 }, [other]: { seed: 2 } },
      ),
      id,
    );
    expect(s.party.clearedDungeons).toEqual([other]);
    expect(s.party.clearedDungeonsAt).toEqual({ [other]: 2 });
    expect(Object.keys(s.dungeons)).toEqual([other]);
  });
});
