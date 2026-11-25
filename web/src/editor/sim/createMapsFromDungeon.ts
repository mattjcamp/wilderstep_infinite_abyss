/**
 * "Create maps from this layout" — turns the floors the dungeon
 * simulator just generated into regular, editable maps (one per
 * floor), appended to this module's maps.json draft. Uses the same
 * bake transform as Maps → Generate Dungeon (`bakeDungeon`), so the
 * maps get the usual `<dungeonId>_<n>_l<depth>` ids, a
 * `dungeon:<dungeonId>_<n>` group tag, and floor-to-floor stairs
 * wired between them. The top / bottom exits are left unlinked for
 * the author to connect in the Map Editor.
 */

import type { DungeonLevel } from "@/battle/world/Dungeon";
import { discardDraft, loadDraft, saveDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { publishItems } from "@/data_model/publishClient";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import type { DungeonRecord } from "@/sim/dungeon/types";
import { bakeDungeon } from "../dungeonBake";

export interface CreateMapsResult {
  mapIds: string[];
  groupTag: string;
  /** True when the browser draft was full and the maps were written
   *  straight to disk through the local publish server instead. */
  publishedDirectly: boolean;
}

export async function createMapsFromDungeon(args: {
  moduleId: string;
  record: DungeonRecord;
  /** Pristine floors for the layout (not the ones being walked, so
   *  nothing the party did in the sim leaks into the maps). */
  levels: DungeonLevel[];
  seed: number;
}): Promise<CreateMapsResult> {
  const { moduleId, record, levels, seed } = args;
  const src = getEditorModuleSource();
  const [mapsLayers, tileLayers, draft] = await Promise.all([
    src.loadModelLayers(moduleId, "maps"),
    src.loadModelLayers(moduleId, "map_tiles").catch(() => null),
    loadDraft<Record<string, unknown>>(moduleId, "maps"),
  ]);

  // The module's own maps file — its pending draft when there is one.
  const ownFile: Record<string, unknown> = {
    ...((draft ?? (mapsLayers.ownFile as Record<string, unknown> | null)) ?? {
      maps: [],
    }),
  };
  const ownMaps = Array.isArray(ownFile.maps)
    ? (ownFile.maps as Array<Record<string, unknown>>)
    : [];
  // Every visible map (inherited too) decides the next free suffix.
  const allMaps =
    (
      mergeModel("maps", mapsLayers.inherited, ownFile) as {
        maps?: Array<{ tags?: string[] }>;
      } | null
    )?.maps ?? [];

  const paletteSprites = new Map<string, string>();
  if (tileLayers) {
    const merged = mergeModel(
      "map_tiles",
      tileLayers.inherited,
      tileLayers.ownFile,
    ) as { map_tiles?: Array<{ id?: string; sprite?: string }> } | null;
    for (const t of merged?.map_tiles ?? []) {
      if (t.id && t.sprite) paletteSprites.set(t.id, t.sprite);
    }
  }

  const result = bakeDungeon(record, {
    seed,
    levels,
    existingMaps: allMaps,
    paletteSprites,
  });
  if (result.maps.length === 0) {
    throw new Error(`Dungeon "${record.name ?? record.id}" has no floors to create.`);
  }

  ownFile.maps = [
    ...ownMaps,
    ...(result.maps as unknown as Array<Record<string, unknown>>),
  ];
  let publishedDirectly = false;
  try {
    await saveDraft(moduleId, "maps", ownFile);
  } catch (storageErr) {
    // Draft too big for browser storage — fall back to writing the
    // file directly (local publish server), as Maps → Generate does.
    const res = await publishItems([
      {
        kind: "model",
        moduleId,
        modelKey: "maps",
        fileName: "maps.json",
        content: ownFile,
      },
    ]).catch(() => null);
    if (!res?.results[0]?.ok) {
      throw new Error(
        `Couldn't save the maps to the browser draft (${
          storageErr instanceof Error ? storageErr.message : String(storageErr)
        }). Start the publish server to save directly to disk.`,
      );
    }
    // A stale draft would shadow the file just written.
    discardDraft(moduleId, "maps");
    publishedDirectly = true;
  }
  return { mapIds: result.mapIds, groupTag: result.groupTag, publishedDirectly };
}
