"use client";

/**
 * Maps-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "maps". Replaces
 * the generic ModelView for this one model because maps need:
 *
 *   - A tag-tree grouping in the list (not a flat table) — maps with
 *     multiple tags appear under each tag they carry; maps with no
 *     tags fall into an "(untagged)" bucket. Tags nest on ":" like the
 *     Tile Palette ("Hallowmere: House" → Hallowmere › House).
 *   - A per-module tag order (`tag_order` in maps.json): pin a tag
 *     group to float it to the top of its level, ▲/▼ to reorder pins.
 *   - A custom New Map form that auto-generates the grid from
 *     width × height (no raw-JSON grid input), with a chip-style
 *     multi-select for tags that suggests existing tags and lets you
 *     type new ones.
 *   - Click-to-open-editor on each row + a Delete button.
 *   - A "Delete all" button on each tag group that removes every map
 *     under that tag in one write (e.g. retire a whole town).
 *
 * Carries the same draft → publish flow every other model uses.
 */

import { editorMapHref } from "./moduleRoutes";
import {
  DraftBanner,
  deleteRecordConfirmMessage,
  discardDraftConfirmMessage,
} from "./editorShell";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import type { LibraryCatalogEntry } from "@/data_model/ModuleSource";
import { publishItems } from "@/data_model/publishClient";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import {
  encounterTemplateFromRaw,
  groupEncountersByArea,
  type EncounterTemplate,
  type RawEncounter,
} from "@/battle/world/Encounters";
import type { DungeonRecord } from "@/sim/dungeon/types";
import { bakeDungeon } from "./dungeonBake";
import { GenerateDungeonDialog } from "./GenerateDungeonDialog";
import {
  buildTagTree,
  collectTagPaths,
  effectiveTagOrder,
  groupByTags,
  isTagPinned,
  moveTagPin,
  nextCopyId,
  normalizeTag,
  planTagDelete,
  setTagPinned,
  tagAncestors,
  tagLabel,
  tagNodeRecords,
  tagSegments,
  UNTAGGED,
  type TagNode,
} from "./mapTags";
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";

const MODEL_KEY = "maps";
const FILE_NAME = "maps.json";
// Tag ordering + the "(untagged)" bucket live in mapTags.ts so the
// browse tree and the Map Editor's link picker stay consistent.

interface TileType {
  id: string;
  name: string;
  walkable: boolean;
  obstructs: boolean;
  locked: boolean;
  light_source: boolean;
  light_range: number;
  animation: "none" | "torch" | "fire" | "fairy" | "smoke";
  counter: string;
  encounter: string;
  spawn: string;
  sprite: string;
  link?: { map_id: string; x: number; y: number } | null;
}

interface MapRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  width: number;
  height: number;
  grid: TileType[][];
  [k: string]: unknown;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      palette: TileType[];
      maps: MapRecord[];
      /** Maps available to import from `uses` libraries (e.g. "Maps
       *  and Buildings"). Not auto-merged — surfaced for explicit
       *  import, mirroring the generic ModelView. */
      catalog: LibraryCatalogEntry[];
      /** Pinned tag paths, in display order (maps.json `tag_order`,
       *  or the PINNED_TAGS default when the file doesn't set one). */
      tagOrder: string[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

/** Group maps by (full, possibly nested) tag for the library-import
 *  view. A map carrying several tags appears under each; untagged maps
 *  fall into the "(untagged)" bucket. Same ordering as the main tree. */
function groupRecordsByTag(
  records: MapRecord[],
  order: ReadonlyArray<string>,
): [string, MapRecord[]][] {
  return groupByTags(records, order);
}

export function MapsBrowse({ moduleId }: { moduleId: string }) {
  const router = useRouter();
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generatingDungeon, setGeneratingDungeon] = useState(false);
  // A `?tag=` deep-link (from a map editor's tag chip) names a tag
  // group to reveal on arrival.
  const searchParams = useSearchParams();
  const focusTag = searchParams.get("tag");
  // Tag groups the author has expanded. Starts empty — every group
  // renders collapsed so the screen opens as a compact tag index —
  // EXCEPT a deep-linked tag, which starts open so the related maps
  // are visible the moment the page loads.
  // Keys are lower-cased normalized tag paths; a nested deep-link
  // opens every ancestor so the target group is actually visible.
  const [openTags, setOpenTags] = useState<Set<string>>(() =>
    focusTag
      ? new Set(tagAncestors(focusTag).map((p) => p.toLowerCase()))
      : new Set(),
  );
  // Scroll the deep-linked group into view once the maps have loaded
  // (the group's <section> only exists after the list renders). One-
  // shot via the ref so later expands/collapses don't yank the page.
  const didScrollToTagRef = useRef(false);

  const tagKey = (path: string) => path.toLowerCase();
  const isOpen = (path: string) => openTags.has(tagKey(path));
  const toggleTag = (path: string) =>
    setOpenTags((prev) => {
      const next = new Set(prev);
      const k = tagKey(path);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // ── Load palette + maps (draft-aware) ──────────────────────────
  const refresh = async () => {
    try {
      const src = getEditorModuleSource();
      const [paletteLayers, mapsLayers, catalog] = await Promise.all([
        src.loadModelLayers(moduleId, "map_tiles"),
        src.loadModelLayers(moduleId, "maps"),
        // Maps offered by `uses` libraries. Not part of the resolved
        // view — the import section below copies them in on demand.
        src.listLibraryRecords(moduleId, "maps"),
      ]);
      const paletteMerged = mergeModel(
        "map_tiles",
        paletteLayers.inherited,
        paletteLayers.ownFile,
      ) as { map_tiles?: TileType[] } | null;
      const palette = paletteMerged?.map_tiles ?? [];

      const draft = await loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ?? (mapsLayers.ownFile as Record<string, unknown> | null);
      const mapsMerged = mergeModel(
        "maps",
        mapsLayers.inherited,
        ownEffective,
      ) as { maps?: MapRecord[] } | null;
      const maps = mapsMerged?.maps ?? [];
      setState({
        kind: "ok",
        palette,
        maps,
        catalog,
        tagOrder: effectiveTagOrder(mapsMerged),
        ownFile: ownEffective ?? null,
        isDraft: hasDraft(moduleId, MODEL_KEY),
      });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    setState({ kind: "loading" });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  // ── Tag suggestions for the new-map form ───────────────────────
  const allTags = useMemo(() => {
    if (state.kind !== "ok") return [];
    const s = new Set<string>();
    for (const m of state.maps) {
      for (const t of m.tags ?? []) {
        const n = normalizeTag(t);
        if (n) s.add(n);
      }
    }
    return [...s].sort();
  }, [state]);

  // ── Nested tag tree for the list ───────────────────────────────
  // Tags split on ":" into a tree (Hallowmere › House). Siblings sort
  // pinned-first per the module's tag order, then A–Z, untagged last.
  const tagTree = useMemo<TagNode<MapRecord>[]>(() => {
    if (state.kind !== "ok") return [];
    return buildTagTree(state.maps, state.tagOrder);
  }, [state]);

  // Deep-link scroll: when arriving via `?tag=`, bring that group's
  // section into view once the maps have loaded and rendered.
  useEffect(() => {
    if (!focusTag || didScrollToTagRef.current) return;
    if (state.kind !== "ok") return;
    const el = document.getElementById(
      `maptag-${encodeURIComponent(normalizeTag(focusTag).toLowerCase())}`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      didScrollToTagRef.current = true;
    }
  }, [focusTag, state]);

  // ── Mutators (persist via the draft system) ────────────────────
  /**
   * Write the maps array to the local draft. If the browser refuses
   * (typically a QuotaExceededError — even a heavily-gzipped baked
   * dungeon can in extreme cases push past the ~5MB localStorage cap)
   * AND the publish server is running, fall back to writing the
   * merged file straight to disk and clear any pre-existing draft.
   * Without this fallback, once a module's maps.json outgrows the
   * storage budget every subsequent edit — including a simple
   * Delete — would error. With it, the bake / new / delete paths
   * all degrade gracefully to direct-publish.
   *
   * `saveDraft` is async (gzip runs on every write); the await also
   * surfaces the QuotaExceededError the catch block needs to see.
   *
   * Returns `{ publishedDirectly }` so callers (e.g. the bake flow)
   * can tailor their success message; throws if neither save path
   * succeeds.
   */
  const persistMaps = (updatedMaps: MapRecord[]) =>
    persistFile({ maps: updatedMaps });

  /** Save the module's tag order (pins) to maps.json `tag_order`. */
  const persistTagOrder = async (order: string[]) => {
    try {
      await persistFile({ tag_order: order });
    } catch (e) {
      window.alert(
        `Couldn't save tag order: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  /** Patch top-level fields of this module's maps file (`maps`,
   *  `tag_order`) and persist via the draft → direct-publish path
   *  described on persistMaps. */
  const persistFile = async (patch: {
    maps?: MapRecord[];
    tag_order?: string[];
  }): Promise<{ publishedDirectly: boolean }> => {
    if (state.kind !== "ok") return { publishedDirectly: false };
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { maps: [] };
    if (patch.maps) baseFile.maps = patch.maps;
    if (patch.tag_order) baseFile.tag_order = patch.tag_order;
    try {
      await saveDraft(moduleId, MODEL_KEY, baseFile);
      setState({
        ...state,
        maps: patch.maps ?? state.maps,
        tagOrder: patch.tag_order ?? state.tagOrder,
        ownFile: baseFile,
        isDraft: true,
      });
      return { publishedDirectly: false };
    } catch (storageErr) {
      if (publishAvailable !== true) {
        throw new Error(
          `Couldn't save to browser draft: ${
            storageErr instanceof Error
              ? storageErr.message
              : String(storageErr)
          }. Start the publish server to save directly to disk.`,
        );
      }
      const res = await publishItems([
        {
          kind: "model",
          moduleId,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          content: baseFile,
        },
      ]);
      const r0 = res.results[0];
      if (!r0 || !r0.ok) {
        throw new Error(
          `Couldn't save to browser draft (${
            storageErr instanceof Error
              ? storageErr.message
              : String(storageErr)
          }) and direct publish also failed: ${r0?.error ?? "unknown error"}.`,
        );
      }
      // Clear any pre-existing draft so the next load picks up the
      // freshly-published file and the editor stops showing "draft
      // active". Then refresh from disk so React state mirrors the
      // new on-disk content.
      discardDraft(moduleId, MODEL_KEY);
      await refresh();
      return { publishedDirectly: true };
    }
  };

  const onCreate = async (rec: MapRecord) => {
    if (state.kind !== "ok") return;
    try {
      await persistMaps([...state.maps, rec]);
    } catch (e) {
      window.alert(
        `Couldn't save the new map: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }
    setCreating(false);
    // Drop straight into the visual editor for the new map.
    router.push(editorMapHref(moduleId, rec.id));
  };

  /**
   * Bake a DungeonRecord into a fresh set of map records appended to
   * this module's maps.json (via the standard draft path). Each bake
   * picks an auto-incrementing suffix so successive bakes stay
   * independent — no overwrite, no destruction of prior edits.
   *
   * Loads encounters + monsters catalogs on demand (same pattern the
   * DungeonSimLauncher uses) so the procedural generator inside the
   * bake transform has real encounter pools to sample from. With no
   * encounters loaded the bake still works — floors just generate
   * empty of monsters.
   */
  const onBakeDungeon = async ({
    record,
    seed,
  }: {
    record: DungeonRecord;
    seed: number;
  }) => {
    if (state.kind !== "ok") return;
    try {
      // Load encounters + monsters through the data-model layer
      // (StaticModuleSource + mergeModel) — NOT the battle-side
      // loadEncounters/loadMonsters fetchers, which only read the
      // active module's own file and ignore the `extends` chain.
      // Child modules like dragon-lair inherit from default; without
      // honoring that chain we'd silently bake every floor empty of
      // monsters when the child has no encounters.json of its own.
      let encountersError: string | null = null;
      const src = getEditorModuleSource();
      const [encountersLayers, monstersLayers, tileLayers] = await Promise.all([
        src.loadModelLayers(moduleId, "encounters").catch((e) => {
          encountersError = e instanceof Error ? e.message : String(e);
          return null;
        }),
        src.loadModelLayers(moduleId, "monsters").catch(() => null),
        // Tile palette — lets a baked dungeon resolve its tileset
        // sprites. Non-fatal.
        src.loadModelLayers(moduleId, "map_tiles").catch(() => null),
      ]);
      // Hydrate encounters: merge inherited+own, drop null entries,
      // group by area for sampleEncounter's expected shape.
      let encounters: Record<string, EncounterTemplate[]> = {};
      if (encountersLayers) {
        const merged = mergeModel(
          "encounters",
          encountersLayers.inherited,
          encountersLayers.ownFile,
        ) as { encounters?: RawEncounter[] } | null;
        const rawList = merged?.encounters ?? [];
        const templates = rawList
          .map(encounterTemplateFromRaw)
          .filter((t): t is EncounterTemplate => t !== null);
        encounters = groupEncountersByArea(templates);
      }
      // Build a lean monster-difficulty lookup. The bake only needs
      // `(id) => difficulty`; the full MonsterSpec hydration is
      // overkill for that single field, and reading the merged raw
      // records keeps us off the battle loader.
      const monsterDifficulty: (id: string) => string | undefined = (() => {
        if (!monstersLayers) return () => undefined;
        const merged = mergeModel(
          "monsters",
          monstersLayers.inherited,
          monstersLayers.ownFile,
        ) as {
          monsters?: Array<{ id?: string; difficulty?: string }>;
        } | null;
        const byId = new Map<string, string>();
        for (const m of merged?.monsters ?? []) {
          if (m.id && typeof m.difficulty === "string") {
            byId.set(m.id, m.difficulty);
          }
        }
        return (id: string) => byId.get(id);
      })();
      const dungeonEncounterCount = encounters.dungeon?.length ?? 0;
      // Build the palette id → sprite map the dungeon converter needs.
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
        existingMaps: state.maps,
        encounters,
        monsterDifficulty,
        paletteSprites,
      });
      if (result.maps.length === 0) {
        window.alert(
          `Dungeon "${record.name}" has no levels to bake. Add at least one level to its record first.`,
        );
        return;
      }
      // Count encounter cells stamped per floor so the alert surfaces
      // "the bake ran but no monsters were placed" loud and clear.
      // Otherwise an empty-encounter bake looks identical to a normal
      // one until the author opens a map and squints for sprites.
      const stampedPerFloor = result.maps.map((m) => {
        let n = 0;
        for (const row of m.grid) {
          for (const cell of row) {
            if (cell.encounter && cell.encounter.length > 0) n++;
          }
        }
        return { id: m.id, n };
      });
      const totalStamped = stampedPerFloor.reduce((s, x) => s + x.n, 0);
      // Append the new maps. persistMaps writes to the local draft
      // by default and silently falls back to direct-publish if the
      // browser storage quota is exceeded — see its docstring.
      const merged = [
        ...state.maps,
        ...(result.maps as unknown as MapRecord[]),
      ];
      const { publishedDirectly } = await persistMaps(merged);
      setGeneratingDungeon(false);
      // Build a single multi-line alert that surfaces (a) the maps
      // created, (b) the encounter catalog size that was sampled,
      // (c) per-floor placement counts, and (d) the most common
      // failure mode (encounters.json fetch error) when relevant.
      const lines: string[] = [];
      lines.push(
        `Baked ${result.maps.length} map${
          result.maps.length === 1 ? "" : "s"
        } under tag "${result.groupTag}":`,
      );
      for (const s of stampedPerFloor) {
        lines.push(`  · ${s.id} — ${s.n} encounter cell${s.n === 1 ? "" : "s"}`);
      }
      lines.push("");
      if (encountersError) {
        lines.push(
          `⚠ Encounters catalog failed to load (${encountersError}). No monsters were placed. Check that this module has an encounters.json.`,
        );
      } else if (dungeonEncounterCount === 0) {
        lines.push(
          `⚠ No "dungeon"-area encounters found in this module's encounters.json. No monsters were placed.`,
        );
      } else if (totalStamped === 0) {
        lines.push(
          `⚠ ${dungeonEncounterCount} dungeon-area encounter${
            dungeonEncounterCount === 1 ? "" : "s"
          } loaded, but none qualified for this dungeon's difficulty band (${record.difficulty ?? "normal"}). Check that some encounters fall inside the band.`,
        );
      } else {
        lines.push(
          `Sampled from ${dungeonEncounterCount} dungeon-area encounters.`,
        );
      }
      lines.push(
        publishedDirectly
          ? "Published directly to disk (browser draft was too large)."
          : "Saved to the draft — Publish when ready.",
      );
      window.alert(lines.join("\n"));
    } catch (e) {
      window.alert(
        `Bake failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const onDelete = async (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        deleteRecordConfirmMessage({ kind: "map", name: id, fileName: FILE_NAME }),
      )
    )
      return;
    try {
      await persistMaps(state.maps.filter((m) => m.id !== id));
    } catch (e) {
      window.alert(
        `Couldn't delete map: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  /**
   * Delete every map under a tag in one write — e.g. retire a whole
   * town and its interiors at once. Only maps in this module's OWN
   * file are removed; inherited maps (from `extends`) can't be deleted
   * here because the merge would restore them, so they're listed in
   * the confirm and left alone. Maps carrying other tags too are
   * removed in full. The confirm also flags surviving maps whose link
   * cells point into the deleted set, since those doors will dangle.
   *
   * Writes the own list (not the merged view) so the delete doesn't
   * copy inherited maps into this module's file as a side effect, then
   * refreshes to rebuild the merged view. Lands in the draft like any
   * other edit — Discard reverts it until you Publish.
   */
  const onDeleteTag = async (tag: string) => {
    if (state.kind !== "ok") return;
    const own = Array.isArray(state.ownFile?.maps)
      ? (state.ownFile!.maps as MapRecord[])
      : [];
    const plan = planTagDelete(tag, state.maps, own);
    const label =
      tag === UNTAGGED
        ? "untagged"
        : `tagged "${tagLabel(tag)}"${
            tagSegments(tag).length > 0 ? " (or nested beneath it)" : ""
          }`;
    if (plan.toDelete.length === 0) {
      window.alert(
        plan.inherited.length > 0
          ? `All ${plan.inherited.length} map(s) ${label} are inherited from a parent module and can't be deleted here. Delete them in the module that defines them.`
          : `No maps ${label} to delete.`,
      );
      return;
    }
    const n = plan.toDelete.length;
    const MAX_LISTED = 12;
    const lines: string[] = [];
    lines.push(`Delete all ${n} map${n === 1 ? "" : "s"} ${label}?`);
    lines.push("");
    for (const m of plan.toDelete.slice(0, MAX_LISTED)) {
      const others = (m.tags ?? []).filter(
        (t) => normalizeTag(t).toLowerCase() !== tag.toLowerCase(),
      );
      lines.push(
        `  · ${m.name} (${m.id})${others.length ? ` — also tagged ${others.join(", ")}` : ""}`,
      );
    }
    if (n > MAX_LISTED) lines.push(`  · …and ${n - MAX_LISTED} more`);
    if (
      plan.toDelete.some((m) =>
        (m.tags ?? []).some(
          (t) => normalizeTag(t).toLowerCase() !== tag.toLowerCase(),
        ),
      )
    ) {
      lines.push("");
      lines.push("Maps that also carry other tags are deleted completely, not just untagged.");
    }
    if (plan.inherited.length > 0) {
      lines.push("");
      lines.push(
        `${plan.inherited.length} inherited map(s) under this tag come from a parent module and will be kept.`,
      );
    }
    if (plan.brokenLinks.length > 0) {
      lines.push("");
      lines.push("⚠ These remaining maps have doors/links into the deleted maps:");
      for (const b of plan.brokenLinks.slice(0, MAX_LISTED)) {
        lines.push(`  · ${b.name} (${b.count} link${b.count === 1 ? "" : "s"})`);
      }
      if (plan.brokenLinks.length > MAX_LISTED) {
        lines.push(`  · …and ${plan.brokenLinks.length - MAX_LISTED} more`);
      }
    }
    lines.push("");
    lines.push(
      `Removes them from this module's ${FILE_NAME}. The change saves to your draft — Discard reverts it until you Publish.`,
    );
    if (!window.confirm(lines.join("\n"))) return;
    try {
      const { publishedDirectly } = await persistMaps(plan.remainingOwn);
      // persistMaps stores the list it was given as `maps`; rebuild the
      // merged (inherited + own) view so the tree stays complete.
      if (!publishedDirectly) await refresh();
    } catch (e) {
      window.alert(
        `Couldn't delete maps: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    setOpenTags((prev) => {
      const next = new Set(prev);
      next.delete(tagKey(tag));
      return next;
    });
  };

  /**
   * Duplicate a map — deep-clone every cell + its metadata into a new
   * record with a fresh id, append it to this module's own maps file,
   * and drop straight into the editor for the copy. Lets authors build
   * a variant (a re-themed town, a mirrored arena) without repainting
   * from a blank grid. Non-destructive: the source map is untouched,
   * and duplicating an INHERITED map lands the copy in this module's
   * own file (the original stays in its parent module).
   */
  const onDuplicate = async (src: MapRecord) => {
    if (state.kind !== "ok") return;
    const existing = new Set(state.maps.map((m) => m.id));
    // Unique numbered id ("stone_house_1" → "stone_house_2", …). Any
    // trailing number / legacy "_copy" is replaced rather than appended
    // to, so copies of copies keep short ids. See nextCopyId.
    const newId = nextCopyId(src.id, existing);
    // Deep clone via JSON round-trip — the grid is plain data (nested
    // TileType rows + link objects), so this fully detaches the copy
    // from the source.
    const clone: MapRecord = JSON.parse(JSON.stringify(src));
    clone.id = newId;
    clone.name = `${src.name} (copy)`;
    try {
      await persistMaps([...state.maps, clone]);
    } catch (e) {
      window.alert(
        `Couldn't copy map: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    router.push(editorMapHref(moduleId, newId));
  };

  /**
   * Import one or more maps from a `uses` library into THIS module's
   * own maps file, in a single write. Deep-clones each record so the
   * copies fully decouple from the library (later edits on either
   * side don't cross over).
   *
   * IDs are preserved, NOT renamed. Buildings are multi-map and wire
   * themselves together by `link.map_id` (a town square links to its
   * shop interior, the shop links back, etc.) — renaming on import
   * would sever those links. The import catalog already filters out
   * ids present in the resolved view, so collisions are limited to
   * the rare case of two libraries exposing the same id (or the same
   * map reachable under two tags in one "Import all"); those are
   * skipped rather than renamed, keeping every surviving link intact.
   *
   * Batching matters: importing a whole building in one persistMaps
   * call means all its maps land together, so the moment the import
   * finishes every inter-map link already resolves.
   */
  const onImportMaps = async (records: MapRecord[]) => {
    if (state.kind !== "ok") return;
    const existing = new Set(state.maps.map((m) => m.id));
    const toAdd: MapRecord[] = [];
    for (const rec of records) {
      if (!rec.id || existing.has(rec.id)) continue; // already present — skip, keep links intact
      const clone: MapRecord = JSON.parse(JSON.stringify(rec));
      toAdd.push(clone);
      existing.add(clone.id); // guard against the same map appearing twice in one batch
    }
    if (toAdd.length === 0) return;
    try {
      await persistMaps([...state.maps, ...toAdd]);
    } catch (e) {
      window.alert(
        `Couldn't import maps: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const onDiscardDraft = () => {
    if (typeof window === "undefined") return;
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (
      !window.confirm(
        discardDraftConfirmMessage(FILE_NAME),
      )
    )
      return;
    discardDraft(moduleId, MODEL_KEY);
    refresh();
  };

  const onExport = () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    downloadJson(FILE_NAME, state.ownFile);
  };

  const onPublish = async () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    setPublishing(true);
    try {
      const res = await publishItems([
        {
          kind: "model",
          moduleId,
          modelKey: MODEL_KEY,
          fileName: FILE_NAME,
          content: state.ownFile,
        },
      ]);
      const r = res.results[0];
      if (!r.ok) {
        window.alert(`Publish failed: ${r.error}`);
        return;
      }
      discardDraft(moduleId, MODEL_KEY);
      await refresh();
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/80">Loading maps…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load maps.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.maps.map((m) => m.id));
  const canExport = state.ownFile !== null;

  // Library maps available to import, with ids already present in the
  // resolved view filtered out (a map you've imported / inherited no
  // longer needs an import button). Empty libraries drop out.
  const availableCatalog = state.catalog
    .map((entry) => ({
      libraryId: entry.libraryId,
      records: (entry.records as unknown as MapRecord[]).filter(
        (r) => r.id && !existingIds.has(r.id),
      ),
    }))
    .filter((entry) => entry.records.length > 0);

  return (
    <div className="p-4">
      {/* Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">Maps</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/80">
            <span>
              {state.maps.length} map{state.maps.length === 1 ? "" : "s"}
            </span>
            <span className="text-parchment/60">·</span>
            <span>{FILE_NAME}</span>
            {state.isDraft ? (
              <span className="rounded bg-ember/30 px-2 py-0.5 text-[13px] text-parchment/90">
                draft active
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
            >
              + New Map
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setGeneratingDungeon(true)}
            className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40"
            title="Generate a set of editable maps from a Dungeon record."
          >
            ⚙ Generate Dungeon Maps
          </button>
          {state.isDraft ? (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⬇ Export
          </button>
          {state.isDraft && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
        </div>
      </header>
      {state.isDraft ? <DraftBanner /> : null}

      {/* New-map form */}
      {creating ? (
        <div className="mt-4">
          <NewMapForm
            existingIds={existingIds}
            existingTags={allTags}
            palette={state.palette}
            onCreate={onCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      {/* Nested tag tree. Groups are collapsible and start collapsed,
          so the screen opens as a compact index of tags; expand the
          ones you're working in. 📌 pins a group to the top of its
          level; ▲/▼ reorder pinned siblings. */}
      {tagTree.length > 0 ? (
        <div className="mt-6 flex items-center gap-2 text-[13px] text-parchment/70">
          <button
            type="button"
            onClick={() =>
              setOpenTags(new Set(collectTagPaths(tagTree).map(tagKey)))
            }
            className="rounded border border-parchment/20 px-2 py-0.5 hover:bg-ink/40"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setOpenTags(new Set())}
            className="rounded border border-parchment/20 px-2 py-0.5 hover:bg-ink/40"
          >
            Collapse all
          </button>
          <span className="text-parchment/55">
            Nest tags with “:” (e.g. <span className="font-mono">Hallowmere: House</span>).
          </span>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {tagTree.map((node) => (
          <TagGroup
            key={node.path}
            node={node}
            depth={0}
            siblings={tagTree}
            moduleId={moduleId}
            tagOrder={state.tagOrder}
            isOpen={isOpen}
            onToggle={toggleTag}
            onDeleteTag={onDeleteTag}
            onSetTagOrder={persistTagOrder}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        ))}
        {state.maps.length === 0 ? (
          <p className="text-sm text-parchment/75">
            No maps yet. Click <strong>+ New Map</strong> to create one.
          </p>
        ) : null}
      </div>

      {/* Available from libraries (uses) — explicit import, not
          auto-merged. Grouped by tag because a "building" (a town and
          its interiors, a dungeon and its floors) is authored as a set
          of maps sharing a tag and linked to each other by id. The
          "Import all" button on a tag pulls the whole set in one go so
          the links resolve immediately. */}
      {availableCatalog.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-[13px] uppercase tracking-wide text-parchment/65">
            Available from libraries
            <span className="ml-2 normal-case tracking-normal text-parchment/55">
              (
              {availableCatalog.reduce((n, e) => n + e.records.length, 0)} map
              {availableCatalog.reduce((n, e) => n + e.records.length, 0) === 1
                ? ""
                : "s"}{" "}
              ready to import)
            </span>
          </h2>
          <p className="mb-3 text-[13px] text-parchment/65">
            Maps from libraries this module uses, grouped by tag. A tagged
            group is usually one building or area whose maps link to each
            other — use <strong>Import all</strong> to pull the whole set
            in (ids are preserved so the links keep working). Importing
            copies the maps into this module&apos;s own file; edit them
            freely afterward without affecting the library.
          </p>
          <div className="space-y-4">
            {availableCatalog.map((entry) => (
              <div
                key={entry.libraryId}
                className="rounded border border-parchment/10 bg-ink/20"
              >
                <div className="border-b border-parchment/10 bg-ink/40 px-3 py-1 text-[13px] text-parchment/85">
                  <span className="text-parchment/85">{entry.libraryId}</span>
                  <span className="ml-2 text-parchment/60">
                    ({entry.records.length} available)
                  </span>
                </div>
                <div className="divide-y divide-parchment/10">
                  {groupRecordsByTag(entry.records, state.tagOrder).map(([tag, maps]) => (
                    <div key={`${entry.libraryId}::tag::${tag}`}>
                      <div className="flex items-center justify-between gap-3 bg-ink/30 px-3 py-1.5">
                        <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">
                          {tagLabel(tag)}
                          <span className="ml-2 normal-case tracking-normal text-parchment/55">
                            ({maps.length})
                          </span>
                        </h3>
                        {tag !== UNTAGGED ? (
                          <button
                            type="button"
                            onClick={() => onImportMaps(maps)}
                            className="shrink-0 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/50"
                            title={`Import all ${maps.length} maps tagged "${tagLabel(tag)}" — the whole building/area, links preserved.`}
                          >
                            + Import all ({maps.length})
                          </button>
                        ) : null}
                      </div>
                      <ul className="divide-y divide-parchment/5">
                        {maps.map((m) => (
                          <li
                            key={`${entry.libraryId}::${tag}::${m.id}`}
                            className="flex items-center justify-between gap-3 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1 truncate text-sm text-parchment/85">
                              <span className="font-display">{m.name}</span>
                              <span className="ml-2 font-mono text-[13px] text-parchment/65">
                                {m.id}
                              </span>
                              {typeof m.width === "number" &&
                              typeof m.height === "number" ? (
                                <span className="ml-2 text-[13px] text-parchment/60">
                                  {m.width}×{m.height}
                                </span>
                              ) : null}
                              {Array.isArray(m.tags) && m.tags.length > 1 ? (
                                <span className="ml-2 text-[13px] text-parchment/60">
                                  also:{" "}
                                  {m.tags
                                    .filter((t) => normalizeTag(t) !== tag)
                                    .map(tagLabel)
                                    .join(", ")}
                                </span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => onImportMaps([m])}
                              className="shrink-0 rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/40"
                              title={`Import just this map from ${entry.libraryId}.`}
                            >
                              + Import
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Generate Dungeon Maps dialog */}
      {generatingDungeon ? (
        <GenerateDungeonDialog
          moduleId={moduleId}
          existingMaps={state.maps}
          onConfirm={onBakeDungeon}
          onCancel={() => setGeneratingDungeon(false)}
        />
      ) : null}
    </div>
  );
}

// ── Tag tree group ──────────────────────────────────────────────────

/** Small square icon button used for the pin / ▲ / ▼ controls. */
function IconButton({
  onClick,
  title,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[12px] normal-case tracking-normal disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "border-ember/60 bg-ember/25 text-parchment"
          : "border-parchment/20 text-parchment/70 hover:border-parchment/50 hover:bg-ink/50 hover:text-parchment"
      }`}
    >
      {children}
    </button>
  );
}

/** One collapsible node of the nested map tag tree: header (toggle,
 *  pin, reorder, delete-all), then child tag groups, then the maps
 *  filed directly at this level. */
function TagGroup({
  node,
  depth,
  siblings,
  moduleId,
  tagOrder,
  isOpen,
  onToggle,
  onDeleteTag,
  onSetTagOrder,
  onDuplicate,
  onDelete,
}: {
  node: TagNode<MapRecord>;
  depth: number;
  siblings: TagNode<MapRecord>[];
  moduleId: string;
  tagOrder: string[];
  isOpen: (path: string) => boolean;
  onToggle: (path: string) => void;
  onDeleteTag: (path: string) => void;
  onSetTagOrder: (order: string[]) => void;
  onDuplicate: (m: MapRecord) => void;
  onDelete: (id: string) => void;
}) {
  const open = isOpen(node.path);
  const isUntagged = node.path === UNTAGGED;
  const pinned = !isUntagged && isTagPinned(tagOrder, node.path);
  // Pinned siblings in display order — drives ▲/▼ enablement.
  const pinnedSiblings = siblings.filter(
    (s) => s.path !== UNTAGGED && isTagPinned(tagOrder, s.path),
  );
  const pinPos = pinnedSiblings.findIndex((s) => s.path === node.path);
  const total = tagNodeRecords(node).length;
  const label = isUntagged ? "untagged" : `"${tagLabel(node.path)}"`;
  return (
    <section
      id={`maptag-${encodeURIComponent(node.path.toLowerCase())}`}
      className="scroll-mt-4"
    >
      <h2
        className="flex items-center gap-1.5 text-[13px] uppercase tracking-wide text-parchment/65"
        style={{ paddingLeft: depth * 16 }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left uppercase tracking-wide hover:bg-ink/30 hover:text-parchment/85"
          title={open ? "Collapse this tag group." : "Expand this tag group."}
        >
          <span className="text-parchment/75">{open ? "▾" : "▸"}</span>
          {pinned ? (
            <span className="text-ember/90" aria-label="pinned">
              📌
            </span>
          ) : null}
          <span className="truncate">{node.label}</span>
          <span className="text-parchment/55 normal-case tracking-normal">
            ({total})
          </span>
        </button>
        {!isUntagged ? (
          <>
            {pinned ? (
              <>
                <IconButton
                  onClick={() => onSetTagOrder(moveTagPin(tagOrder, node.path, -1))}
                  disabled={pinPos <= 0}
                  title="Move this pinned group up."
                >
                  ▲
                </IconButton>
                <IconButton
                  onClick={() => onSetTagOrder(moveTagPin(tagOrder, node.path, 1))}
                  disabled={pinPos === -1 || pinPos >= pinnedSiblings.length - 1}
                  title="Move this pinned group down."
                >
                  ▼
                </IconButton>
              </>
            ) : null}
            <IconButton
              onClick={() =>
                onSetTagOrder(setTagPinned(tagOrder, node.path, !pinned))
              }
              active={pinned}
              title={
                pinned
                  ? "Unpin — this group goes back to A–Z order."
                  : "Pin this group to the top of its level (saved to maps.json tag_order)."
              }
            >
              {pinned ? "Unpin" : "Pin"}
            </IconButton>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => onDeleteTag(node.path)}
          className="shrink-0 rounded border border-parchment/20 px-2 py-0.5 text-[13px] normal-case tracking-normal text-parchment/70 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
          title={`Delete every map ${isUntagged ? "with no tags" : `tagged ${label} or nested beneath it`} from this module's maps file. Asks first.`}
        >
          Delete all ({total})
        </button>
      </h2>
      {open ? (
        <div className="mt-1 space-y-2" style={{ paddingLeft: depth * 16 }}>
          {node.children.map((child) => (
            <TagGroup
              key={child.path}
              node={child}
              depth={1}
              siblings={node.children}
              moduleId={moduleId}
              tagOrder={tagOrder}
              isOpen={isOpen}
              onToggle={onToggle}
              onDeleteTag={onDeleteTag}
              onSetTagOrder={onSetTagOrder}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ))}
          {node.records.length > 0 ? (
            <ul className="divide-y divide-parchment/5 rounded border border-parchment/10 bg-ink/20">
              {node.records.map((m) => (
                <MapRow
                  key={`${node.path}::${m.id}`}
                  map={m}
                  groupPath={node.path}
                  moduleId={moduleId}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MapRow({
  map: m,
  groupPath,
  moduleId,
  onDuplicate,
  onDelete,
}: {
  map: MapRecord;
  groupPath: string;
  moduleId: string;
  onDuplicate: (m: MapRecord) => void;
  onDelete: (id: string) => void;
}) {
  const others = (m.tags ?? [])
    .map(normalizeTag)
    .filter((t) => t && t.toLowerCase() !== groupPath.toLowerCase());
  return (
    <li>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <Link
          href={editorMapHref(moduleId, m.id)}
          className="min-w-0 flex-1 truncate text-sm text-parchment hover:text-parchment/100"
        >
          <span className="font-display">{m.name}</span>
          <span className="ml-2 font-mono text-[13px] text-parchment/65">
            {m.id}
          </span>
          <span className="ml-2 text-[13px] text-parchment/60">
            {m.width}×{m.height}
          </span>
          {others.length > 0 ? (
            <span className="ml-2 text-[13px] text-parchment/60">
              also: {others.map(tagLabel).join(", ")}
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDuplicate(m);
          }}
          className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-parchment/50 hover:bg-ink/50 hover:text-parchment"
          title="Duplicate this map into a new copy and open it in the editor."
        >
          Copy
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(m.id);
          }}
          className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
          title="Delete this map from the module's maps file."
        >
          Delete
        </button>
      </div>
    </li>
  );
}

// ── New Map form ────────────────────────────────────────────────────

function NewMapForm({
  existingIds,
  existingTags,
  palette,
  onCreate,
  onCancel,
}: {
  existingIds: Set<string>;
  existingTags: string[];
  palette: TileType[];
  onCreate: (rec: MapRecord) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [width, setWidth] = useState(16);
  const [height, setHeight] = useState(12);

  const trimmedId = id.trim();
  const idValid = ID_PATTERN.test(trimmedId);
  const idCollision = existingIds.has(trimmedId);
  const idError =
    trimmedId.length === 0
      ? null
      : !idValid
        ? "ID must be lowercase letters/digits/hyphens/underscores, starting with a letter (e.g. 'town_one_square')."
        : idCollision
          ? `A map with id "${trimmedId}" already exists.`
          : null;
  const sizeValid = width > 0 && width <= 256 && height > 0 && height <= 256;
  const canSubmit =
    trimmedId.length > 0 && !idError && name.trim().length > 0 && sizeValid;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const baseTile: TileType = palette[0]
      ? { ...palette[0] }
      : {
          id: "unknown",
          name: "Unknown",
          walkable: true,
          obstructs: false,
          locked: false,
          light_source: false,
          light_range: 0,
          animation: "none",
          counter: "",
          encounter: "",
          spawn: "",
          sprite: "",
        };
    const grid: TileType[][] = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ...baseTile })),
    );
    const rec: MapRecord = {
      id: trimmedId,
      name: name.trim(),
      description: description.trim(),
      tags,
      width,
      height,
      grid,
    };
    onCreate(rec);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-parchment/15 bg-ink/30 p-4"
    >
      <h2 className="font-display text-lg text-parchment">New Map</h2>
      <p className="mt-1 text-sm text-parchment/75">
        The grid auto-generates from width × height filled with the first
        Tile Palette tile
        {palette[0] ? (
          <>
            {" "}
            (<span className="font-mono">{palette[0].id}</span>)
          </>
        ) : null}
        . Paint over it after creation.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            ID
          </span>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="town_one_square"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-sm text-parchment/90"
          />
          {idError ? (
            <p className="mt-1 text-[13px] text-ember/80">{idError}</p>
          ) : (
            <p className="mt-1 text-[13px] text-parchment/65">
              Key in <code>maps.json</code>.
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Town Square"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Description
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A cobbled square at the heart of Town One…"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <div className="block sm:col-span-2">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Tags
          </span>
          <TagsPicker
            tags={tags}
            existing={existingTags}
            onChange={setTags}
            placeholder="new tag… (nest with “:”, e.g. Hallowmere: House)"
          />
        </div>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Width (cols)
          </span>
          <input
            type="number"
            min={1}
            max={256}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-wide text-parchment/65">
            Height (rows)
          </span>
          <input
            type="number"
            min={1}
            max={256}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Create & open
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// TagsPicker + ID_PATTERN moved to ./TagsPicker.tsx so the same
// component drives MapsBrowse, DungeonsBrowse, and QuestsBrowse.
