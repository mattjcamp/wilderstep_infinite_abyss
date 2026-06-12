"use client";

/**
 * Dungeons-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "dungeons". Mirrors
 * the MapsBrowse shape (tag-tree, draft → publish flow) but with
 * inline child-level editing instead of a navigation hop:
 *
 *   - Dungeons grouped by tag. Untagged dungeons land in "(untagged)".
 *   - Each dungeon row can be expanded to edit its metadata (name,
 *     description, tags) and the generator's defaults (style,
 *     difficulty, size, torch_density, locked_doors), plus manage its
 *     `levels[]` array.
 *   - Dungeon Levels are inline objects under their parent's
 *     `levels[]` — there is no top-level Dungeon Level catalog. Add /
 *     edit / delete happens inside the expanded parent row.
 *   - Each Level can override any of the parent's generator
 *     parameters. The UI surfaces inherited values as placeholders so
 *     the author can see what they'd get without leaving an override
 *     set.
 *
 * Same draft / publish / export flow as the rest of the editor.
 */

import {
  DraftBanner,
  deleteRecordConfirmMessage,
  discardDraftConfirmMessage,
} from "./editorShell";
import { useEffect, useMemo, useState } from "react";
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
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { withBasePath } from "@/util/basePath";
import { SoundtrackPicker } from "./SoundtrackPicker";
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";
import { groupItemsByCategory } from "./itemTags";

const MODEL_KEY = "dungeons";
const FILE_NAME = "dungeons.json";
const UNTAGGED = "(untagged)";

/** Chest-eligible item as surfaced to the chest pickers — id + name
 *  plus the organizational tags that drive "Category › Type"
 *  optgroups. */
type ChestItem = {
  id: string;
  name: string;
  category?: string;
  item_type?: string;
};

/** Closed style enum — the procedural generator's supported themes.
 *  Add new values here when the generator grows. */
const STYLES = ["caves", "ruins", "forest", "custom"] as const;
type Style = (typeof STYLES)[number];

/** Same difficulty enum the Monster model uses. */
const DIFFICULTIES = ["easy", "normal", "hard", "deadly", "boss"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

/** Encounter themes (matching the `theme` field on monsters /
 *  encounters). When a dungeon picks one, the procedural generator
 *  only spawns encounters of that theme. Authors can also type a
 *  custom theme on the record; the picker preserves unknown values. */
const THEMES = [
  "devil",
  "undead",
  "elemental",
  "humanoid",
  "cryptid",
  "magical",
] as const;

interface DungeonSize {
  width: number;
  height: number;
}

/** Loot config — mirrors `@/sim/dungeon/types` `DungeonLoot`.
 *  `chest_item` is an `is_chest: true` item id; empty / absent → no
 *  chests. `chest_frequency` is the 0–1 per-room placement chance. */
interface DungeonLoot {
  chest_item?: string;
  chest_frequency?: number;
}

/** A `map_tiles` palette entry, reduced to what the custom floor/wall
 *  pickers need: the id (what we persist), a display name, the sprite
 *  path (for the thumbnail), walkability (to flag odd choices), and the
 *  tag (so the picker groups tiles the same way the map editor's
 *  palette does — e.g. the "dungeon" group of lava / portal tiles). */
interface PaletteTile {
  id: string;
  name: string;
  sprite: string;
  walkable: boolean;
  tag?: string;
}

interface DungeonLevel {
  id: string;
  name: string;
  tags?: string[];
  depth: number;
  // Overrides — undefined means "inherit from parent Dungeon".
  style?: Style | string;
  difficulty?: Difficulty | string;
  /** Encounter theme override for this floor; inherits the parent's
   *  when undefined. */
  theme?: string;
  size?: DungeonSize;
  torch_density?: number;
  locked_doors?: number;
  /** 0–1 chance each room opening gets a door (inherits → default 1). */
  doors?: number;
  /** Entrance/exit placement: edge of map (true) vs interior rooms. */
  edge_transitions?: boolean;
  /** `map_tiles` palette ids — only meaningful when style is "custom". */
  custom_floor?: string;
  custom_wall?: string;
  /** Palette ids for the up / down transition sprites (custom only). */
  custom_stairs_up?: string;
  custom_stairs_down?: string;
  loot?: DungeonLoot;
}

interface DungeonRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  // Generator defaults — required on Dungeon.
  style: Style | string;
  difficulty: Difficulty | string;
  /** Encounter theme. When set, the generator only spawns encounters
   *  of this theme (empty / absent → any). */
  theme?: string;
  size: DungeonSize;
  torch_density: number;
  locked_doors: number;
  /** 0–1 chance each room opening gets a door. Default 1 (doors
   *  always); lower for open layouts. Levels override per-floor. */
  doors?: number;
  /** Entrance/exit placement: edge of map (true) vs interior rooms
   *  (false). Absent → style default (edge for forest). All styles. */
  edge_transitions?: boolean;
  /** `map_tiles` palette ids for floor / wall sprites when style is
   *  "custom". Ignored for other styles. */
  custom_floor?: string;
  custom_wall?: string;
  /** Palette ids for the up / down transition sprites (custom only). */
  custom_stairs_up?: string;
  custom_stairs_down?: string;
  loot?: DungeonLoot;
  levels: DungeonLevel[];
  /** Per-dungeon background-music playlist override. Each entry is
   *  an audio file URL. When the party enters this dungeon, the
   *  play host re-points the SoundtrackPlayer at this list; on
   *  exit, the host falls back to the overworld map's playlist
   *  (which itself defers to the module default). Absent / empty
   *  inherits the module default. */
  soundtrack?: string[];
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      dungeons: DungeonRecord[];
      /** Dungeons available to import from `uses` libraries (e.g.
       *  "Maps and Buildings"). Not auto-merged — surfaced for
       *  explicit import, mirroring MapsBrowse + the generic
       *  ModelView. */
      catalog: LibraryCatalogEntry[];
      /** Items flagged `is_chest: true` in the resolved items model —
       *  the choices for the loot chest picker. */
      chestItems: Array<ChestItem>;
      /** Every `map_tiles` palette entry — choices for the custom-style
       *  floor / wall tile pickers. */
      paletteTiles: PaletteTile[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

/** Default values used for a freshly-created Dungeon. Authors can
 *  tweak post-create; these are deliberately middle-of-the-road. */
const DEFAULTS = {
  style: "caves" as Style,
  difficulty: "normal" as Difficulty,
  /** Empty = any theme (no encounter-theme restriction). */
  theme: "",
  size: { width: 32, height: 32 },
  torch_density: 0.15,
  locked_doors: 0.25,
} as const;

export function DungeonsBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // ── Load dungeons (draft-aware) ────────────────────────────────
  const refresh = async () => {
    try {
      const src = new StaticModuleSource();
      const [layers, catalog, itemLayers, tileLayers] = await Promise.all([
        src.loadModelLayers(moduleId, "dungeons"),
        // Dungeons offered by `uses` libraries. Not part of the
        // resolved view — the import section below copies them in.
        src.listLibraryRecords(moduleId, "dungeons"),
        // Items model — resolved so the loot picker can offer every
        // chest item visible to this module (inherited + own).
        src.loadModelLayers(moduleId, "items"),
        // Tile palette — backs the custom-style floor / wall pickers.
        src.loadModelLayers(moduleId, "map_tiles"),
      ]);
      const draft = await loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ?? (layers.ownFile as Record<string, unknown> | null);
      const merged = mergeModel(
        "dungeons",
        layers.inherited,
        ownEffective,
      ) as { dungeons?: DungeonRecord[] } | null;
      const dungeons = merged?.dungeons ?? [];
      // Resolve the items model and pull the chest-flagged entries.
      const itemsMerged = mergeModel(
        "items",
        itemLayers.inherited,
        itemLayers.ownFile as Record<string, unknown> | null,
      ) as { items?: Array<Record<string, unknown>> } | null;
      const chestItems = (itemsMerged?.items ?? [])
        .filter((it) => it.is_chest === true)
        .map((it) => ({
          id: String(it.id ?? ""),
          name: String(it.name ?? it.id ?? ""),
          category: it.category != null ? String(it.category) : undefined,
          item_type: it.item_type != null ? String(it.item_type) : undefined,
        }))
        .filter((it) => it.id !== "");
      // Resolve the tile palette for the custom-style pickers.
      const tilesMerged = mergeModel(
        "map_tiles",
        tileLayers.inherited,
        tileLayers.ownFile as Record<string, unknown> | null,
      ) as { map_tiles?: Array<Record<string, unknown>> } | null;
      const paletteTiles: PaletteTile[] = (tilesMerged?.map_tiles ?? [])
        .map((t) => ({
          id: String(t.id ?? ""),
          name: String(t.name ?? t.id ?? ""),
          sprite: String(t.sprite ?? ""),
          walkable: t.walkable === true,
          tag: t.tag != null && String(t.tag).trim() ? String(t.tag) : undefined,
        }))
        .filter((t) => t.id !== "");
      setState({
        kind: "ok",
        dungeons,
        catalog,
        chestItems,
        paletteTiles,
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

  // ── Tag suggestions + tag-tree grouping ────────────────────────
  const allTags = useMemo(() => {
    if (state.kind !== "ok") return [];
    const s = new Set<string>();
    for (const d of state.dungeons) {
      for (const t of d.tags ?? []) s.add(t);
    }
    return [...s].sort();
  }, [state]);

  const groupedByTag = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, DungeonRecord[]>();
    const groups = new Map<string, DungeonRecord[]>();
    for (const d of state.dungeons) {
      const tags =
        Array.isArray(d.tags) && d.tags.length > 0 ? d.tags : [UNTAGGED];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(d);
      }
    }
    const sorted = new Map<string, DungeonRecord[]>();
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    });
    for (const k of keys) sorted.set(k, groups.get(k)!);
    return sorted;
  }, [state]);

  // ── Mutators ───────────────────────────────────────────────────
  const persist = (updated: DungeonRecord[]) => {
    if (state.kind !== "ok") return;
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { dungeons: [] };
    baseFile.dungeons = updated;
    // saveDraft is async — fire-and-forget; the React state update
    // below is what UI reads. See CharactersBrowse.persist comment.
    void saveDraft(moduleId, MODEL_KEY, baseFile);
    setState({
      ...state,
      dungeons: updated,
      ownFile: baseFile,
      isDraft: true,
    });
  };

  const onCreate = (rec: DungeonRecord) => {
    if (state.kind !== "ok") return;
    persist([...state.dungeons, rec]);
    setCreating(false);
    setExpanded((prev) => new Set(prev).add(rec.id));
  };

  /**
   * Import one or more dungeons from a `uses` library into THIS
   * module's own dungeons file. Deep-clones each record so the copy
   * decouples from the library.
   *
   * IDs are preserved, NOT renamed: a dungeon id is a referenceable
   * key (a spelunking quest's `reach` step pins `dungeon_id`, a map's
   * dungeon-entrance cell carries the dungeon id), so renaming on
   * import would break those references. The import catalog already
   * filters out ids present in the resolved view, so collisions are
   * limited to the rare case of two libraries exposing the same id;
   * those are skipped rather than renamed.
   */
  const onImportDungeons = (records: DungeonRecord[]) => {
    if (state.kind !== "ok") return;
    const existing = new Set(state.dungeons.map((d) => d.id));
    const toAdd: DungeonRecord[] = [];
    for (const rec of records) {
      if (!rec.id || existing.has(rec.id)) continue;
      const clone: DungeonRecord = JSON.parse(JSON.stringify(rec));
      toAdd.push(clone);
      existing.add(clone.id);
    }
    if (toAdd.length === 0) return;
    persist([...state.dungeons, ...toAdd]);
  };

  const onDeleteDungeon = (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        deleteRecordConfirmMessage({
          kind: "dungeon",
          name: id,
          fileName: FILE_NAME,
          detail: "This deletes the whole dungeon, including its levels.",
        }),
      )
    )
      return;
    persist(state.dungeons.filter((d) => d.id !== id));
  };

  const onUpdateDungeon = (id: string, patch: Partial<DungeonRecord>) => {
    if (state.kind !== "ok") return;
    persist(
      state.dungeons.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  };

  const onAddLevel = (dungeonId: string) => {
    if (state.kind !== "ok") return;
    const parent = state.dungeons.find((d) => d.id === dungeonId);
    if (!parent) return;
    const nextDepth = (parent.levels?.length ?? 0) + 1;
    const newLevel: DungeonLevel = {
      id: `${dungeonId}_l${nextDepth}`,
      name: `Level ${nextDepth}`,
      depth: nextDepth,
    };
    onUpdateDungeon(dungeonId, {
      levels: [...(parent.levels ?? []), newLevel],
    });
  };

  const onUpdateLevel = (
    dungeonId: string,
    levelIdx: number,
    patch: Partial<DungeonLevel>,
  ) => {
    if (state.kind !== "ok") return;
    const parent = state.dungeons.find((d) => d.id === dungeonId);
    if (!parent) return;
    const newLevels = (parent.levels ?? []).map((l, i) => {
      if (i !== levelIdx) return l;
      // Drop keys whose new value is `undefined` so an "inherit"
      // toggle clears the override entirely instead of writing
      // `undefined` into the JSON.
      const merged = { ...l, ...patch };
      for (const k of Object.keys(patch) as Array<keyof DungeonLevel>) {
        if (patch[k] === undefined) {
          delete (merged as Record<string, unknown>)[k];
        }
      }
      return merged;
    });
    onUpdateDungeon(dungeonId, { levels: newLevels });
  };

  const onDeleteLevel = (dungeonId: string, levelIdx: number) => {
    if (state.kind !== "ok") return;
    const parent = state.dungeons.find((d) => d.id === dungeonId);
    if (!parent) return;
    const target = parent.levels?.[levelIdx];
    if (
      target &&
      typeof window !== "undefined" &&
      !window.confirm(
        deleteRecordConfirmMessage({
          kind: "level",
          name: `${target.name} (${target.id})`,
          fileName: FILE_NAME,
          detail: `This removes the level from dungeon "${dungeonId}".`,
        }),
      )
    )
      return;
    const newLevels = (parent.levels ?? []).filter(
      (_, i) => i !== levelIdx,
    );
    onUpdateDungeon(dungeonId, { levels: newLevels });
  };

  // ── Draft lifecycle ────────────────────────────────────────────
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
    return <p className="p-4 text-parchment/80">Loading dungeons…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load dungeons.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.dungeons.map((d) => d.id));
  const canExport = state.ownFile !== null;

  // Library dungeons available to import, with ids already present in
  // the resolved view filtered out. Empty libraries drop out.
  const availableCatalog = state.catalog
    .map((entry) => ({
      libraryId: entry.libraryId,
      records: (entry.records as unknown as DungeonRecord[]).filter(
        (r) => r.id && !existingIds.has(r.id),
      ),
    }))
    .filter((entry) => entry.records.length > 0);

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">Dungeons</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/80">
            <span>
              {state.dungeons.length} dungeon
              {state.dungeons.length === 1 ? "" : "s"}
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
              + New Dungeon
            </button>
          ) : null}
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

      {creating ? (
        <div className="mt-4">
          <NewDungeonForm
            existingIds={existingIds}
            existingTags={allTags}
            onCreate={onCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {[...groupedByTag.entries()].map(([tag, dungeons]) => (
          <section key={tag}>
            <h2 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/65">
              {tag}
              <span className="ml-2 text-parchment/55 normal-case tracking-normal">
                ({dungeons.length})
              </span>
            </h2>
            <ul className="space-y-2">
              {dungeons.map((d) => (
                <li
                  key={`${tag}::${d.id}`}
                  className="overflow-hidden rounded border border-parchment/10 bg-ink/20"
                >
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(d.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-parchment hover:text-parchment/100"
                    >
                      <span className="text-parchment/75">
                        {expanded.has(d.id) ? "▾" : "▸"}
                      </span>
                      <span className="font-display">{d.name}</span>
                      <span className="font-mono text-[13px] text-parchment/65">
                        {d.id}
                      </span>
                      <span className="text-[13px] text-parchment/65">
                        · {d.levels?.length ?? 0} level
                        {(d.levels?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                      <span className="text-[13px] text-parchment/65">
                        · {d.style} · {d.difficulty}
                      </span>
                      {Array.isArray(d.tags) && d.tags.length > 1 ? (
                        <span className="text-[13px] text-parchment/60">
                          · also: {d.tags.filter((t) => t !== tag).join(", ")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDungeon(d.id)}
                      className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                      title="Delete this dungeon."
                    >
                      Delete
                    </button>
                  </div>
                  {expanded.has(d.id) ? (
                    <DungeonEditor
                      dungeon={d}
                      existingTags={allTags}
                      chestItems={state.chestItems}
                      paletteTiles={state.paletteTiles}
                      onUpdate={(patch) => onUpdateDungeon(d.id, patch)}
                      onAddLevel={() => onAddLevel(d.id)}
                      onUpdateLevel={(idx, patch) =>
                        onUpdateLevel(d.id, idx, patch)
                      }
                      onDeleteLevel={(idx) => onDeleteLevel(d.id, idx)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {state.dungeons.length === 0 ? (
          <p className="text-sm text-parchment/75">
            No dungeons yet. Click <strong>+ New Dungeon</strong> to create one.
          </p>
        ) : null}
      </div>

      {/* Available from libraries (uses) — explicit import, not
          auto-merged. Each dungeon is a self-contained record, so the
          granularity is per-dungeon, with a per-library "Import all"
          for convenience. Ids are preserved so quests / map entrances
          that reference a dungeon by id keep resolving. */}
      {availableCatalog.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-[13px] uppercase tracking-wide text-parchment/65">
            Available from libraries
            <span className="ml-2 normal-case tracking-normal text-parchment/55">
              (
              {availableCatalog.reduce((n, e) => n + e.records.length, 0)}{" "}
              dungeon
              {availableCatalog.reduce((n, e) => n + e.records.length, 0) === 1
                ? ""
                : "s"}{" "}
              ready to import)
            </span>
          </h2>
          <p className="mb-3 text-[13px] text-parchment/65">
            Dungeons from libraries this module uses. Importing copies a
            dungeon into this module&apos;s own file (ids preserved, so a
            spelunking quest or a map&apos;s dungeon entrance that points
            at it still resolves) — edit it freely afterward without
            affecting the library.
          </p>
          <div className="space-y-4">
            {availableCatalog.map((entry) => (
              <div
                key={entry.libraryId}
                className="rounded border border-parchment/10 bg-ink/20"
              >
                <div className="flex items-center justify-between gap-3 border-b border-parchment/10 bg-ink/40 px-3 py-1.5">
                  <span className="text-[13px] text-parchment/85">
                    <span className="text-parchment/85">{entry.libraryId}</span>
                    <span className="ml-2 text-parchment/60">
                      ({entry.records.length} available)
                    </span>
                  </span>
                  {entry.records.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onImportDungeons(entry.records)}
                      className="shrink-0 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/50"
                      title={`Import all ${entry.records.length} dungeons from ${entry.libraryId}.`}
                    >
                      + Import all ({entry.records.length})
                    </button>
                  ) : null}
                </div>
                <ul className="divide-y divide-parchment/5">
                  {entry.records.map((d) => (
                    <li
                      key={`${entry.libraryId}::${d.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 truncate text-sm text-parchment/85">
                        <span className="font-display">{d.name}</span>
                        <span className="ml-2 font-mono text-[13px] text-parchment/65">
                          {d.id}
                        </span>
                        <span className="ml-2 text-[13px] text-parchment/60">
                          {d.levels?.length ?? 0} level
                          {(d.levels?.length ?? 0) === 1 ? "" : "s"}
                        </span>
                        {d.style || d.difficulty ? (
                          <span className="ml-2 text-[13px] text-parchment/60">
                            {[d.style, d.difficulty].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onImportDungeons([d])}
                        className="shrink-0 rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/40"
                        title={`Import just this dungeon from ${entry.libraryId}.`}
                      >
                        + Import
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── Inline editor for a single dungeon (metadata + generator params + levels) ─

function DungeonEditor({
  dungeon,
  existingTags,
  chestItems,
  paletteTiles,
  onUpdate,
  onAddLevel,
  onUpdateLevel,
  onDeleteLevel,
}: {
  dungeon: DungeonRecord;
  existingTags: string[];
  chestItems: Array<ChestItem>;
  paletteTiles: PaletteTile[];
  onUpdate: (patch: Partial<DungeonRecord>) => void;
  onAddLevel: () => void;
  onUpdateLevel: (idx: number, patch: Partial<DungeonLevel>) => void;
  onDeleteLevel: (idx: number) => void;
}) {
  return (
    <div className="border-t border-parchment/10 bg-ink/10 px-3 py-3">
      {/* Identity + tags */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Name
          </span>
          <input
            type="text"
            value={dungeon.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Description
          </span>
          <input
            type="text"
            value={dungeon.description ?? ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
          />
        </label>
      </div>
      <div className="mt-3">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Tags
        </span>
        <TagsPicker
          tags={dungeon.tags ?? []}
          existing={existingTags}
          onChange={(tags) => onUpdate({ tags })}
        />
      </div>

      {/* Soundtrack override — picks tracks from /audio/index.json
          with preview + reorder. Empty inherits the module-level
          default playlist. */}
      <div className="mt-3">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Soundtrack
        </span>
        <div className="mt-1">
          <SoundtrackPicker
            value={dungeon.soundtrack ?? []}
            onChange={(list) =>
              onUpdate({
                soundtrack: list.length > 0 ? list : undefined,
              })
            }
            emptyHint="Inherits the module-level playlist."
          />
        </div>
        <span className="mt-1 block text-xs text-parchment/65">
          Per-dungeon playlist override. Empty inherits the module
          default.
        </span>
      </div>

      {/* Generator defaults — required on Dungeon, inherited by Levels */}
      <h3 className="mt-4 text-[13px] uppercase tracking-wide text-parchment/75">
        Generator defaults
      </h3>
      <p className="text-xs text-parchment/65">
        These values drive procedural floor generation. Each Dungeon Level
        below can override any of them; an empty override on a Level means
        "inherit from this Dungeon."
      </p>
      <GeneratorFields
        style={dungeon.style}
        difficulty={dungeon.difficulty}
        theme={dungeon.theme}
        size={dungeon.size}
        torchDensity={dungeon.torch_density}
        lockedDoors={dungeon.locked_doors}
        doors={dungeon.doors}
        edgeTransitions={dungeon.edge_transitions}
        customFloor={dungeon.custom_floor}
        customWall={dungeon.custom_wall}
        customStairsUp={dungeon.custom_stairs_up}
        customStairsDown={dungeon.custom_stairs_down}
        paletteTiles={paletteTiles}
        chestItems={chestItems}
        chestItem={dungeon.loot?.chest_item}
        chestFrequency={dungeon.loot?.chest_frequency}
        onStyle={(v) => onUpdate({ style: v })}
        onDifficulty={(v) => onUpdate({ difficulty: v })}
        onTheme={(v) => onUpdate({ theme: v })}
        onSize={(v) => onUpdate({ size: v })}
        onTorchDensity={(v) => onUpdate({ torch_density: v })}
        onLockedDoors={(v) => onUpdate({ locked_doors: v })}
        onDoors={(v) => onUpdate({ doors: v })}
        onEdgeTransitions={(v) => onUpdate({ edge_transitions: v })}
        onCustomFloor={(v) => onUpdate({ custom_floor: v })}
        onCustomWall={(v) => onUpdate({ custom_wall: v })}
        onCustomStairsUp={(v) => onUpdate({ custom_stairs_up: v })}
        onCustomStairsDown={(v) => onUpdate({ custom_stairs_down: v })}
        onChestItem={(v) =>
          onUpdate({ loot: mergeLoot(dungeon.loot, { chest_item: v }) })
        }
        onChestFrequency={(v) =>
          onUpdate({ loot: mergeLoot(dungeon.loot, { chest_frequency: v }) })
        }
        // Dungeon side is required — no clear/inherit affordance.
        allowInherit={false}
      />

      {/* Levels list */}
      <h3 className="mt-4 text-[13px] uppercase tracking-wide text-parchment/75">
        Levels ({dungeon.levels?.length ?? 0})
      </h3>
      {(dungeon.levels ?? []).length === 0 ? (
        <p className="mt-1 text-[13px] text-parchment/65">
          No levels yet. Click <strong>+ Add Level</strong> below.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(dungeon.levels ?? []).map((lvl, i) => (
            <LevelRow
              key={`${lvl.id}-${i}`}
              level={lvl}
              parent={dungeon}
              existingTags={existingTags}
              chestItems={chestItems}
              paletteTiles={paletteTiles}
              onUpdate={(patch) => onUpdateLevel(i, patch)}
              onDelete={() => onDeleteLevel(i)}
            />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={onAddLevel}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-1 text-[13px] text-parchment hover:bg-ember/40"
        >
          + Add Level
        </button>
      </div>
    </div>
  );
}

// ── Single level row (identity + overrides) ─────────────────────────

function LevelRow({
  level,
  parent,
  existingTags,
  chestItems,
  paletteTiles,
  onUpdate,
  onDelete,
}: {
  level: DungeonLevel;
  parent: DungeonRecord;
  existingTags: string[];
  chestItems: Array<ChestItem>;
  paletteTiles: PaletteTile[];
  onUpdate: (patch: Partial<DungeonLevel>) => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded border border-parchment/10 bg-ink/30 p-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            ID
          </span>
          <input
            type="text"
            value={level.id}
            onChange={(e) => onUpdate({ id: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Name
          </span>
          <input
            type="text"
            value={level.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Depth
          </span>
          <input
            type="number"
            value={level.depth}
            onChange={(e) =>
              onUpdate({ depth: Number(e.target.value) || 0 })
            }
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
        </label>
      </div>

      <div className="mt-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Tags
        </span>
        <TagsPicker
          tags={level.tags ?? []}
          existing={existingTags}
          onChange={(tags) => onUpdate({ tags })}
        />
      </div>

      <div className="mt-3">
        <p className="text-xs text-parchment/65">
          Generator overrides — leave any field empty (or click ↩ Inherit)
          to fall back to the parent Dungeon's value (shown in light text).
        </p>
        <GeneratorFields
          style={level.style}
          difficulty={level.difficulty}
          theme={level.theme}
          size={level.size}
          torchDensity={level.torch_density}
          lockedDoors={level.locked_doors}
          doors={level.doors}
          edgeTransitions={level.edge_transitions}
          customFloor={level.custom_floor}
          customWall={level.custom_wall}
          customStairsUp={level.custom_stairs_up}
          customStairsDown={level.custom_stairs_down}
          paletteTiles={paletteTiles}
          chestItems={chestItems}
          chestItem={level.loot?.chest_item}
          chestFrequency={level.loot?.chest_frequency}
          parentStyle={parent.style}
          parentDifficulty={parent.difficulty}
          parentTheme={parent.theme}
          parentSize={parent.size}
          parentTorchDensity={parent.torch_density}
          parentLockedDoors={parent.locked_doors}
          parentDoors={parent.doors}
          parentEdgeTransitions={parent.edge_transitions}
          parentCustomFloor={parent.custom_floor}
          parentCustomWall={parent.custom_wall}
          parentCustomStairsUp={parent.custom_stairs_up}
          parentCustomStairsDown={parent.custom_stairs_down}
          parentChestItem={parent.loot?.chest_item}
          parentChestFrequency={parent.loot?.chest_frequency}
          onStyle={(v) => onUpdate({ style: v })}
          onDifficulty={(v) => onUpdate({ difficulty: v })}
          onTheme={(v) => onUpdate({ theme: v })}
          onSize={(v) => onUpdate({ size: v })}
          onTorchDensity={(v) => onUpdate({ torch_density: v })}
          onLockedDoors={(v) => onUpdate({ locked_doors: v })}
          onDoors={(v) => onUpdate({ doors: v })}
          onEdgeTransitions={(v) => onUpdate({ edge_transitions: v })}
          onCustomFloor={(v) => onUpdate({ custom_floor: v })}
          onCustomWall={(v) => onUpdate({ custom_wall: v })}
          onCustomStairsUp={(v) => onUpdate({ custom_stairs_up: v })}
          onCustomStairsDown={(v) => onUpdate({ custom_stairs_down: v })}
          onChestItem={(v) =>
            onUpdate({ loot: mergeLoot(level.loot, { chest_item: v }) })
          }
          onChestFrequency={(v) =>
            onUpdate({ loot: mergeLoot(level.loot, { chest_frequency: v }) })
          }
          allowInherit={true}
        />
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
        >
          Delete level
        </button>
      </div>
    </li>
  );
}

// ── Shared generator-parameter editor ───────────────────────────────

function GeneratorFields({
  style,
  difficulty,
  theme,
  size,
  torchDensity,
  lockedDoors,
  doors,
  edgeTransitions,
  customFloor,
  customWall,
  customStairsUp,
  customStairsDown,
  paletteTiles,
  chestItems,
  chestItem,
  chestFrequency,
  parentStyle,
  parentDifficulty,
  parentTheme,
  parentSize,
  parentTorchDensity,
  parentLockedDoors,
  parentDoors,
  parentEdgeTransitions,
  parentCustomFloor,
  parentCustomWall,
  parentCustomStairsUp,
  parentCustomStairsDown,
  parentChestItem,
  parentChestFrequency,
  onStyle,
  onDifficulty,
  onTheme,
  onSize,
  onTorchDensity,
  onLockedDoors,
  onDoors,
  onEdgeTransitions,
  onCustomFloor,
  onCustomWall,
  onCustomStairsUp,
  onCustomStairsDown,
  onChestItem,
  onChestFrequency,
  allowInherit,
}: {
  // Effective (own) value; may be undefined on Level rows.
  style: string | undefined;
  difficulty: string | undefined;
  theme: string | undefined;
  size: DungeonSize | undefined;
  torchDensity: number | undefined;
  lockedDoors: number | undefined;
  doors: number | undefined;
  /** Entrance/exit placement: true = edge, false = rooms, undefined =
   *  inherit / style default. */
  edgeTransitions: boolean | undefined;
  /** Custom-style floor / wall palette ids (effective / own value). */
  customFloor: string | undefined;
  customWall: string | undefined;
  /** Custom-style up / down transition palette ids. */
  customStairsUp: string | undefined;
  customStairsDown: string | undefined;
  /** Tile palette choices for the custom floor / wall pickers. */
  paletteTiles: PaletteTile[];
  /** Chest-item choices (items flagged is_chest) for the loot picker. */
  chestItems: Array<ChestItem>;
  chestItem: string | undefined;
  chestFrequency: number | undefined;
  // Parent values for placeholder fallback (only on Level rows).
  parentStyle?: string;
  parentDifficulty?: string;
  parentTheme?: string;
  parentSize?: DungeonSize;
  parentTorchDensity?: number;
  parentLockedDoors?: number;
  parentDoors?: number;
  parentEdgeTransitions?: boolean;
  parentCustomFloor?: string;
  parentCustomWall?: string;
  parentCustomStairsUp?: string;
  parentCustomStairsDown?: string;
  parentChestItem?: string;
  parentChestFrequency?: number;
  // Callbacks — receiving `undefined` clears the override (Level only).
  onStyle: (v: string | undefined) => void;
  onDifficulty: (v: string | undefined) => void;
  onTheme: (v: string | undefined) => void;
  onSize: (v: DungeonSize | undefined) => void;
  onTorchDensity: (v: number | undefined) => void;
  onLockedDoors: (v: number | undefined) => void;
  onDoors: (v: number | undefined) => void;
  onEdgeTransitions: (v: boolean | undefined) => void;
  onCustomFloor: (v: string | undefined) => void;
  onCustomWall: (v: string | undefined) => void;
  onCustomStairsUp: (v: string | undefined) => void;
  onCustomStairsDown: (v: string | undefined) => void;
  onChestItem: (v: string | undefined) => void;
  onChestFrequency: (v: number | undefined) => void;
  /** Whether the editor exposes an "inherit / clear override" affordance
   *  per field. True on Levels, false on the parent Dungeon. */
  allowInherit: boolean;
}) {
  // The effective style after inheritance — Levels with no style
  // override fall back to the parent's. Drives whether the custom
  // floor/wall pickers show.
  const effectiveStyle = style ?? parentStyle;
  const isCustom = effectiveStyle === "custom";
  // Effective entrance/exit placement when this field is left blank:
  // the parent's value if set, else the style default (edge for forest).
  const edgeDefault = parentEdgeTransitions ?? effectiveStyle === "forest";
  const edgeDefaultLabel = edgeDefault ? "edge of map" : "in rooms";
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-4">
      {/* Style */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Style
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={style ?? ""}
            onChange={(e) =>
              onStyle(e.target.value === "" ? undefined : e.target.value)
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            {allowInherit ? (
              <option value="">
                (inherit{parentStyle ? ` — ${parentStyle}` : ""})
              </option>
            ) : null}
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {style && !STYLES.includes(style as Style) ? (
              <option value={style}>{style} (custom)</option>
            ) : null}
          </select>
        </div>
      </label>

      {/* Difficulty */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Difficulty
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={difficulty ?? ""}
            onChange={(e) =>
              onDifficulty(
                e.target.value === "" ? undefined : e.target.value,
              )
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            {allowInherit ? (
              <option value="">
                (inherit{parentDifficulty ? ` — ${parentDifficulty}` : ""})
              </option>
            ) : null}
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {difficulty &&
            !DIFFICULTIES.includes(difficulty as Difficulty) ? (
              <option value={difficulty}>{difficulty} (custom)</option>
            ) : null}
          </select>
        </div>
      </label>

      {/* Theme — constrains which encounters the generator spawns.
          Blank = any (on the parent) / inherit (on a level). */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Theme
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={theme ?? ""}
            onChange={(e) =>
              onTheme(e.target.value === "" ? undefined : e.target.value)
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            title="Restrict procedurally-placed encounters to this theme. Blank = any theme."
          >
            <option value="">
              {allowInherit
                ? `(inherit${parentTheme ? ` — ${parentTheme}` : " — any"})`
                : "(any)"}
            </option>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {theme && !THEMES.includes(theme as (typeof THEMES)[number]) ? (
              <option value={theme}>{theme} (custom)</option>
            ) : null}
          </select>
        </div>
      </label>

      {/* Size — width × height */}
      <div className="block sm:col-span-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Size (w × h)
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            value={size?.width ?? ""}
            placeholder={parentSize ? String(parentSize.width) : "32"}
            onChange={(e) => {
              const w = e.target.value === "" ? NaN : Number(e.target.value);
              if (Number.isFinite(w)) {
                onSize({
                  width: w,
                  height: size?.height ?? parentSize?.height ?? 0,
                });
              } else if (size?.height == null) {
                onSize(undefined);
              } else {
                // Width cleared but height was set; collapse to undefined
                // to fully inherit, OR keep partial state. Choose the
                // former for simplicity — partial states confuse the
                // generator.
                onSize(undefined);
              }
            }}
            className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          <span className="text-parchment/60">×</span>
          <input
            type="number"
            value={size?.height ?? ""}
            placeholder={parentSize ? String(parentSize.height) : "32"}
            onChange={(e) => {
              const h = e.target.value === "" ? NaN : Number(e.target.value);
              if (Number.isFinite(h)) {
                onSize({
                  width: size?.width ?? parentSize?.width ?? 0,
                  height: h,
                });
              } else if (size?.width == null) {
                onSize(undefined);
              } else {
                onSize(undefined);
              }
            }}
            className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          {allowInherit && size !== undefined ? (
            <InheritButton onClick={() => onSize(undefined)} />
          ) : null}
        </div>
      </div>

      {/* Torch density */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Torch density (0–1)
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={torchDensity ?? ""}
            placeholder={
              parentTorchDensity != null ? String(parentTorchDensity) : "0.15"
            }
            onChange={(e) => {
              const v =
                e.target.value === "" ? NaN : Number(e.target.value);
              onTorchDensity(Number.isFinite(v) ? v : undefined);
            }}
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          {allowInherit && torchDensity !== undefined ? (
            <InheritButton onClick={() => onTorchDensity(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Locked doors */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Locked doors (0–1)
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={lockedDoors ?? ""}
            placeholder={
              parentLockedDoors != null ? String(parentLockedDoors) : "0.25"
            }
            onChange={(e) => {
              const v =
                e.target.value === "" ? NaN : Number(e.target.value);
              onLockedDoors(Number.isFinite(v) ? v : undefined);
            }}
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          {allowInherit && lockedDoors !== undefined ? (
            <InheritButton onClick={() => onLockedDoors(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Doors — 0–1 chance each room opening gets a door. Default 1
          (doors always); lower for open layouts (e.g. a doorless
          forest). Applies to every style. */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Doors (0–1)
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={doors ?? ""}
            placeholder={parentDoors != null ? String(parentDoors) : "1"}
            onChange={(e) => {
              const v = e.target.value === "" ? NaN : Number(e.target.value);
              onDoors(Number.isFinite(v) ? v : undefined);
            }}
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          {allowInherit && doors !== undefined ? (
            <InheritButton onClick={() => onDoors(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Entrance / exit placement — edge of map (forest-style) vs
          dropped in interior rooms (caves/ruins-style). Applies to every
          style; absent inherits the style default. */}
      <label className="block sm:col-span-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Entrance / exit placement
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={
              edgeTransitions === undefined
                ? ""
                : edgeTransitions
                  ? "edge"
                  : "rooms"
            }
            onChange={(e) =>
              onEdgeTransitions(
                e.target.value === ""
                  ? undefined
                  : e.target.value === "edge",
              )
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            {/* Blank = "use the default". On a Level it inherits the
                parent; on the parent Dungeon it follows the style
                default. Always representable so the dropdown never lies
                about the effective value. */}
            <option value="">
              ({allowInherit ? "inherit" : "default"} — {edgeDefaultLabel})
            </option>
            <option value="edge">Edge of map</option>
            <option value="rooms">In rooms (random)</option>
          </select>
          {allowInherit && edgeTransitions !== undefined ? (
            <InheritButton onClick={() => onEdgeTransitions(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Custom-style floor / wall tile pickers — shown only when the
          effective style is "custom". Each shows a sprite thumbnail so
          the author can see the tile; the generator forces floor
          walkable and wall blocking regardless of the tile's own flags. */}
      {isCustom ? (
        <>
          <TilePalettePicker
            label="Custom floor tile"
            value={customFloor}
            paletteTiles={paletteTiles}
            parentValue={parentCustomFloor}
            allowInherit={allowInherit}
            onChange={onCustomFloor}
            // Floors should normally be walkable tiles — flag the others.
            warnNonWalkable
          />
          <TilePalettePicker
            label="Custom wall tile"
            value={customWall}
            paletteTiles={paletteTiles}
            parentValue={parentCustomWall}
            allowInherit={allowInherit}
            onChange={onCustomWall}
          />
          <TilePalettePicker
            label="Up transition (stairs up)"
            value={customStairsUp}
            paletteTiles={paletteTiles}
            parentValue={parentCustomStairsUp}
            allowInherit={allowInherit}
            onChange={onCustomStairsUp}
          />
          <TilePalettePicker
            label="Down transition (stairs down)"
            value={customStairsDown}
            paletteTiles={paletteTiles}
            parentValue={parentCustomStairsDown}
            allowInherit={allowInherit}
            onChange={onCustomStairsDown}
          />
        </>
      ) : null}

      {/* Loot — chest item + frequency. Chests are opt-in: with no
          chest item chosen, the generator places none. Spans 2 cols
          so the item picker has room for full item names. */}
      <label className="block sm:col-span-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Loot chest item
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={chestItem ?? ""}
            onChange={(e) =>
              onChestItem(e.target.value === "" ? undefined : e.target.value)
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            <option value="">
              {allowInherit
                ? parentChestItem
                  ? `(inherit — ${chestLabel(chestItems, parentChestItem)})`
                  : "(inherit — none)"
                : "(none — no chests)"}
            </option>
            {groupItemsByCategory(chestItems).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {/* An authored id that no longer resolves to a chest item
                still shows so the author can see + fix it. */}
            {chestItem && !chestItems.some((it) => it.id === chestItem) ? (
              <option value={chestItem}>{chestItem} (missing)</option>
            ) : null}
          </select>
          {allowInherit && chestItem !== undefined ? (
            <InheritButton onClick={() => onChestItem(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Chest frequency — only meaningful when a chest item is set. */}
      <label className="block sm:col-span-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Chest frequency (0–1, per room)
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <input
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={chestFrequency ?? ""}
            placeholder={
              parentChestFrequency != null
                ? String(parentChestFrequency)
                : "0.5"
            }
            onChange={(e) => {
              const v =
                e.target.value === "" ? NaN : Number(e.target.value);
              onChestFrequency(Number.isFinite(v) ? v : undefined);
            }}
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
          {allowInherit && chestFrequency !== undefined ? (
            <InheritButton onClick={() => onChestFrequency(undefined)} />
          ) : null}
        </div>
      </label>
    </div>
  );
}

/** Resolve a chest item id to its display name for the inherit hint. */
function chestLabel(
  chestItems: Array<ChestItem>,
  id: string,
): string {
  return chestItems.find((it) => it.id === id)?.name ?? id;
}

/** Resolve a palette tile id to its display name for the inherit hint. */
function tileLabel(
  paletteTiles: Array<ChestItem>,
  id: string,
): string {
  return paletteTiles.find((t) => t.id === id)?.name ?? id;
}

/** Resolve a `map_tiles` sprite value (e.g. "map/grass1.png") to a
 *  servable URL. Tolerates already-prefixed or empty values. */
function tileSpriteSrc(sprite: string): string {
  if (!sprite) return "";
  return withBasePath(`/sprites/${sprite}`);
}

/** Small pixel-art thumbnail for a palette tile (or a placeholder box
 *  when the sprite is missing / fails to load). */
function TileThumb({ sprite, size = 28 }: { sprite: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = tileSpriteSrc(sprite);
  return (
    <div
      className="shrink-0 rounded border border-parchment/20 bg-ink/80"
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{ imageRendering: "pixelated" }}
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : null}
    </div>
  );
}

/**
 * Custom floor / wall tile picker with sprite thumbnails. Persists the
 * `map_tiles` id (what the generator + converter consume), but renders
 * each choice as a thumbnail + name so the author can see the tile.
 * Collapsed it shows the current selection; "Pick…" expands a grid.
 */
const UNTAGGED_TILES = "(untagged)";

/** Group palette tiles by their single `tag`, mirroring the map
 *  editor's tag palette: tags alphabetical, untagged last; tile order
 *  within a group preserved from the palette. Returns a display label
 *  per group (uppercased by the header style, so kept as-is here). */
function groupTilesByTag(
  tiles: ReadonlyArray<PaletteTile>,
): Array<{ tag: string; label: string; tiles: PaletteTile[] }> {
  const groups = new Map<string, PaletteTile[]>();
  for (const t of tiles) {
    const tag = t.tag && t.tag.trim() ? t.tag : UNTAGGED_TILES;
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(t);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    if (a === UNTAGGED_TILES) return 1;
    if (b === UNTAGGED_TILES) return -1;
    return a.localeCompare(b);
  });
  return ordered.map((tag) => ({ tag, label: tag, tiles: groups.get(tag)! }));
}

function TilePalettePicker({
  label,
  value,
  paletteTiles,
  parentValue,
  allowInherit,
  onChange,
  warnNonWalkable,
}: {
  label: string;
  value: string | undefined;
  paletteTiles: PaletteTile[];
  parentValue?: string;
  allowInherit: boolean;
  onChange: (v: string | undefined) => void;
  /** When true, palette tiles whose own `walkable` flag is false get a
   *  soft warning chip (you usually want a walkable floor tile). The
   *  generator forces walkability regardless, so it's advisory only. */
  warnNonWalkable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Per-tag collapse state for the grouped grid. Empty by default so
  // every group starts expanded (no tile is hidden until the author
  // chooses to collapse a section).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selected = value
    ? paletteTiles.find((t) => t.id === value)
    : undefined;
  // What the cell will actually look like if this field is left blank.
  const inheritedName =
    allowInherit && parentValue
      ? tileLabel(paletteTiles, parentValue)
      : null;
  const inheritedSprite =
    allowInherit && parentValue
      ? (paletteTiles.find((t) => t.id === parentValue)?.sprite ?? "")
      : "";

  return (
    <div className="block sm:col-span-2">
      <span className="text-xs uppercase tracking-wide text-parchment/65">
        {label}
      </span>
      <div className="mt-0.5 flex items-center gap-2">
        <TileThumb sprite={selected?.sprite ?? inheritedSprite} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-parchment/85">
          {selected ? (
            <>
              {selected.name}
              {warnNonWalkable && !selected.walkable ? (
                <span className="ml-1 text-ember/80">⚠ not walkable</span>
              ) : null}
            </>
          ) : value ? (
            // An authored id that no longer resolves to a palette tile.
            <span className="text-ember/80">{value} (missing)</span>
          ) : inheritedName ? (
            <span className="text-parchment/65">inherits — {inheritedName}</span>
          ) : allowInherit ? (
            <span className="text-parchment/60">inherits — none</span>
          ) : (
            <span className="text-parchment/60">none — falls back to stone</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/30 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
        >
          {open ? "Done" : "Pick…"}
        </button>
        {allowInherit && value !== undefined ? (
          <InheritButton onClick={() => onChange(undefined)} />
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 rounded border border-parchment/15 bg-ink/40 p-2">
          {paletteTiles.length === 0 ? (
            <p className="text-[13px] text-parchment/75">
              No tiles in this module's palette.
            </p>
          ) : (
            <div className="space-y-2">
              {groupTilesByTag(paletteTiles).map(({ tag, label, tiles }) => {
                const isCollapsed = collapsed.has(tag);
                return (
                  <section key={tag}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag)) next.delete(tag);
                          else next.add(tag);
                          return next;
                        })
                      }
                      className="flex w-full items-center justify-between gap-2 px-1 py-0.5 text-left text-[13px] uppercase tracking-wide text-parchment/80 hover:text-parchment"
                    >
                      <span className="flex items-center gap-1">
                        <span className="text-parchment/75">
                          {isCollapsed ? "▸" : "▾"}
                        </span>
                        {label}
                      </span>
                      <span className="normal-case tracking-normal text-parchment/55">
                        {tiles.length}
                      </span>
                    </button>
                    {!isCollapsed ? (
                      <ul className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-1.5">
                        {tiles.map((t) => {
                          const isCurrent = value === t.id;
                          return (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  onChange(t.id);
                                  setOpen(false);
                                }}
                                title={`${t.name} (${t.id})`}
                                className={`flex w-full flex-col items-center gap-0.5 rounded border p-1 transition ${
                                  isCurrent
                                    ? "border-ember/60 bg-ember/15"
                                    : "border-parchment/10 bg-ink/40 hover:border-parchment/40 hover:bg-ink/60"
                                }`}
                              >
                                <TileThumb sprite={t.sprite} size={40} />
                                <span className="w-full truncate text-center text-xs text-parchment/80">
                                  {t.name}
                                </span>
                                {warnNonWalkable && !t.walkable ? (
                                  <span className="text-[9px] text-ember/70">
                                    not walkable
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Merge a partial loot patch over the existing loot, then drop empty
 *  fields so the persisted JSON stays clean. Returns `undefined` when
 *  nothing meaningful remains (no chest item AND no frequency), so the
 *  caller clears the `loot` key entirely. `chest_item: ""` is treated
 *  as "cleared." */
function mergeLoot(
  prev: DungeonLoot | undefined,
  patch: DungeonLoot,
): DungeonLoot | undefined {
  const next: DungeonLoot = { ...(prev ?? {}), ...patch };
  if (next.chest_item === "" || next.chest_item == null) {
    delete next.chest_item;
  }
  if (next.chest_frequency == null || Number.isNaN(next.chest_frequency)) {
    delete next.chest_frequency;
  }
  return next.chest_item == null && next.chest_frequency == null
    ? undefined
    : next;
}

function InheritButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Clear this override and inherit the parent Dungeon's value."
      className="rounded border border-parchment/20 px-1.5 text-[13px] text-parchment/75 hover:border-parchment/40 hover:text-parchment/90"
    >
      ↩
    </button>
  );
}

// ── New Dungeon form ────────────────────────────────────────────────

function NewDungeonForm({
  existingIds,
  existingTags,
  onCreate,
  onCancel,
}: {
  existingIds: Set<string>;
  existingTags: string[];
  onCreate: (rec: DungeonRecord) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const trimmedId = id.trim();
  const idValid = ID_PATTERN.test(trimmedId);
  const idCollision = existingIds.has(trimmedId);
  const idError =
    trimmedId.length === 0
      ? null
      : !idValid
        ? "ID must be lowercase letters/digits/hyphens/underscores, starting with a letter."
        : idCollision
          ? `A dungeon with id "${trimmedId}" already exists.`
          : null;
  const canSubmit =
    trimmedId.length > 0 && !idError && name.trim().length > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const rec: DungeonRecord = {
      id: trimmedId,
      name: name.trim(),
      description: description.trim(),
      tags,
      style: DEFAULTS.style,
      difficulty: DEFAULTS.difficulty,
      size: { ...DEFAULTS.size },
      torch_density: DEFAULTS.torch_density,
      locked_doors: DEFAULTS.locked_doors,
      levels: [],
    };
    onCreate(rec);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-parchment/15 bg-ink/30 p-4"
    >
      <h2 className="font-display text-lg text-parchment">New Dungeon</h2>
      <p className="mt-1 text-sm text-parchment/75">
        Procedural dungeon. Style values are <code>caves</code>,{" "}
        <code>ruins</code>, or <code>forest</code> — the defaults (style:{" "}
        <code>{DEFAULTS.style}</code>,
        difficulty: <code>{DEFAULTS.difficulty}</code>, size:{" "}
        <code>
          {DEFAULTS.size.width}×{DEFAULTS.size.height}
        </code>
        , torch density: <code>{DEFAULTS.torch_density}</code>, locked doors:{" "}
        <code>{DEFAULTS.locked_doors}</code>) are filled in for you — tweak
        after creation. Add levels inline once it opens.
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
            placeholder="crypt_of_dagorn"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-sm text-parchment/90"
          />
          {idError ? (
            <p className="mt-1 text-[13px] text-ember/80">{idError}</p>
          ) : (
            <p className="mt-1 text-[13px] text-parchment/65">
              Key in <code>dungeons.json</code>.
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
            placeholder="Crypt of Dagorn"
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
            placeholder="An ancient burial vault sealed against the rising tide of undeath…"
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
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Create
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
