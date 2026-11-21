/**
 * Text for the generated-dungeon stairs placard — which way the stairs
 * go and where they lead. Pure so the play host and the editor's
 * dungeon simulator word it identically.
 */

import { EXIT_TO_OVERWORLD_MAP_ID } from "@/sim/dungeon/dungeonLevelToMap";

export interface StairsPlacardText {
  placeKind: "stairs-up" | "stairs-down";
  name: string;
  description: string;
  /** True for the bottom floor's way out: the placard asks to leave
   *  the area rather than just climb. */
  leavesArea?: boolean;
}

export function stairsPlacardText(args: {
  stairs: "up" | "down";
  /** The stairs cell's link target — a `floorMapId(...)` or the
   *  dungeon-exit id. */
  linkMapId: string;
  dungeonName: string;
  totalFloors: number;
  /** Display name of a floor by 0-based index, when known. */
  floorName?: (floorIdx: number) => string | undefined;
  /** 0-based floor the party is standing on. An exit link on a floor
   *  below the first is the bottom floor's way out (`bottom_exit`),
   *  worded so the player knows it leaves the whole area. */
  fromFloorIdx?: number;
  /** How that way out looks (`DungeonLevel.exitAppearance`). */
  exitAppearance?: "stairs" | "ladder";
}): StairsPlacardText {
  const { stairs, linkMapId, dungeonName, totalFloors } = args;
  const dir = stairs === "up" ? "up" : "down";
  const base = {
    placeKind: stairs === "up" ? ("stairs-up" as const) : ("stairs-down" as const),
    name: stairs === "up" ? "Stairs Up" : "Stairs Down",
  };
  const where = dungeonName.trim() || "the dungeon";
  if (linkMapId === EXIT_TO_OVERWORLD_MAP_ID) {
    if ((args.fromFloorIdx ?? 0) > 0 && stairs === "up") {
      // The bottom floor's way out — a shortcut past every floor above.
      const ladder = args.exitAppearance === "ladder";
      return {
        ...base,
        name: ladder ? "Way Out — Ladder" : "Way Out — Stairs",
        leavesArea: true,
        description: ladder
          ? `This ladder climbs straight out of ${where}. Taking it leaves the area and returns you to the surface.`
          : `These stairs climb straight out of ${where}. Taking them leaves the area and returns you to the surface.`,
      };
    }
    return { ...base, description: `These stairs lead ${dir} and out of ${where}.` };
  }
  const m = linkMapId.match(/_f(\d+)__$/);
  const idx = m ? Number.parseInt(m[1], 10) : Number.NaN;
  if (!Number.isFinite(idx)) {
    return { ...base, description: `These stairs lead ${dir}.` };
  }
  const label = `Floor ${idx + 1}`;
  const named = args.floorName?.(idx)?.trim();
  const of = totalFloors > 0 ? ` of ${totalFloors}` : "";
  const dest = named && named !== label ? `${named} (${label}${of})` : `${label}${of}`;
  return { ...base, description: `These stairs lead ${dir} to ${dest}.` };
}
