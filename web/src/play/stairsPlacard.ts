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
}): StairsPlacardText {
  const { stairs, linkMapId, dungeonName, totalFloors } = args;
  const dir = stairs === "up" ? "up" : "down";
  const base = {
    placeKind: stairs === "up" ? ("stairs-up" as const) : ("stairs-down" as const),
    name: stairs === "up" ? "Stairs Up" : "Stairs Down",
  };
  const where = dungeonName.trim() || "the dungeon";
  if (linkMapId === EXIT_TO_OVERWORLD_MAP_ID) {
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
