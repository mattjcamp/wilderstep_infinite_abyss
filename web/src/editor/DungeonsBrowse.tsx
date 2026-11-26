"use client";

/**
 * Dungeons-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "dungeons". Mirrors
 * the MapsBrowse shape (tag-tree, draft → publish flow) but with
 * inline child-level editing instead of a navigation hop:
 *
 *   - Laid out like the Dungeon Simulator: a picker toolbar (dungeons
 *     grouped by tag in the dropdown; untagged land in "(untagged)")
 *     over the selected dungeon's editor.
 *   - The editor's core is a spreadsheet-style Floors grid: the top
 *     row holds the dungeon's generator defaults, each row below is a
 *     `levels[]` entry, one column per generator parameter. List-valued
 *     cells (trap mix, battle maps, tags) open an editor under the grid.
 *   - Dungeon Levels are inline objects under their parent's
 *     `levels[]` — there is no top-level Dungeon Level catalog. Add /
 *     edit / delete happens in the Floors grid.
 *   - Each Level can override any of the parent's generator
 *     parameters. The UI surfaces inherited values as placeholders so
 *     the author can see what they'd get without leaving an override
 *     set.
 *
 * Same draft / publish / export flow as the rest of the editor.
 */

import { inheritedRecords, ownRecordsAfterEdit } from "@/data_model/ownRecords";
import {
  DraftBanner,
  deleteRecordConfirmMessage,
  discardDraftConfirmMessage,
} from "./editorShell";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { editorDungeonSimHref } from "./moduleRoutes";
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
import { SoundtrackPicker } from "./SoundtrackPicker";
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";
import {
  DUNGEON_DEFAULTS,
  DUNGEON_SIZE_MAX,
  DUNGEON_SIZE_MIN,
  STYLE_DEFAULTS,
} from "@/sim/dungeon/types";
import { normalizeDungeonStyle } from "@/battle/world/Dungeon";
import { groupItemsByCategory } from "./itemTags";
import { LorePicker } from "./LorePicker";

const MODEL_KEY = "dungeons";
const FILE_NAME = "dungeons.json";
const UNTAGGED = "(untagged)";

/** Chest-eligible item as surfaced to the chest pickers — id + name
 *  plus the organizational tags that drive "Category › Type"
 *  optgroups. */
/** A traps.json record offered by the trap-mix picker. */
type TrapChoice = { id: string; name: string };
/** Trap records visible to this module — read by the trap-mix field so
 *  the picker doesn't need threading through every row component. */
const TrapChoicesContext = createContext<TrapChoice[]>([]);
/** Module id + key-type items, for the room-role fields (vault key,
 *  readable Lore) without threading props through every row. */
const RoomRoleContext = createContext<{
  moduleId: string;
  keyItems: Array<{ id: string; name: string }>;
  /** NPCs (with their shop, if any) — trader / prisoner pickers. */
  npcs: Array<{ id: string; name: string; counter?: string }>;
  /** Every item — the prisoner's reward picker. */
  allItems: Array<ChestItem>;
}>({ moduleId: "", keyItems: [], npcs: [], allItems: [] });

/** The record generated traps use when no trap mix is set. */
const DEFAULT_TRAP_ID = "dart_trap";

/** One weighted entry in a dungeon's trap mix. */
interface TrapPick {
  trap_id: string;
  weight?: number;
}

type ChestItem = {
  id: string;
  name: string;
  category?: string;
  item_type?: string;
};

/** Closed style enum — the procedural generator's supported themes.
 *  Add new values here when the generator grows. */
const STYLES = ["dungeon", "cavern", "deep_ones_hall", "manor", "volcanic"] as const;
/** Dropdown labels where the raw value needs a hint. */
const STYLE_LABELS: Partial<Record<(typeof STYLES)[number], string>> = {
  dungeon: "dungeon (dungeon tileset)",
  cavern: "cavern (cave tileset)",
  deep_ones_hall: "deep ones hall (deep ones hall tileset)",
  manor: "manor (manor tileset)",
  volcanic: "volcanic (volcanic tubes tileset)",
};
type Style = (typeof STYLES)[number];

/** The Monster model's difficulty enum, plus "any" (dungeons only —
 *  ignore monster difficulty when populating the floor). */
const DIFFICULTIES = ["easy", "normal", "hard", "deadly", "boss", "any"] as const;
/** Dropdown labels where the raw value needs a hint. */
const DIFFICULTY_LABELS: Partial<Record<(typeof DIFFICULTIES)[number], string>> = {
  any: "any (ignore monster difficulty)",
};
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
  /** Battle-map override for this floor (arena map ids); inherits the
   *  parent's when undefined. */
  battle_maps?: string[];
  size?: DungeonSize;
  torch_density?: number;
  locked_doors?: number;
  /** 0–1 chance each room opening gets a door (inherits → default 1). */
  doors?: number;
  /** 0–1 chance each room gets a pit (inherits → default 0). */
  pits?: number;
  /** Dungeon-dressing dials — see `Dials`. All inherit. */
  pit_falls?: boolean;
  traps?: number;
  trap_types?: TrapPick[];
  objects?: number;
  floor_variety?: number;
  wall_decor?: number;
  loops?: number;
  room_roles?: number;
  /** Entrance/exit placement: edge of map (true) vs interior rooms. */
  edge_transitions?: boolean;
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
  /** Arena maps (tagged `battle_screen_arena`) fights in this dungeon
   *  run on — one is picked per monster group. Empty → each
   *  encounter's own `custom_map`, else the default arena. */
  battle_maps?: string[];
  size: DungeonSize;
  torch_density: number;
  locked_doors: number;
  /** 0–1 chance each room opening gets a door. Default 1 (doors
   *  always); lower for open layouts. Levels override per-floor. */
  doors?: number;
  /** 0–1 chance each room past the entrance gets a pit. Default 0 (no
   *  pits). Levels override per-floor. */
  pits?: number;
  /** Pits drop to the floor below (default true). */
  pit_falls?: boolean;
  /** 0–1 chance each room past the entrance gets a hidden trap.
   *  Default 0.35. Levels override per-floor. */
  traps?: number;
  /** Weighted traps.json records generated traps use. Absent / empty →
   *  every trap is the default (Dart Trap). */
  trap_types?: TrapPick[];
  /** 0–1 room clutter, floor variety, wall decorations. Absent → the
   *  style's default (`STYLE_DEFAULTS`). */
  objects?: number;
  floor_variety?: number;
  wall_decor?: number;
  /** 0–1 loops between rooms; 0–1 furnished room roles. Absent → the
   *  style's default (`STYLE_DEFAULTS`). */
  loops?: number;
  room_roles?: number;
  /** Entrance/exit placement: edge of map (true) vs interior rooms
   *  (false). Absent → interior rooms. All styles. */
  edge_transitions?: boolean;
  /** Key-type item dropped on a floor as its sealed vault's key. */
  vault_key?: string;
  /** Shopkeeper NPC camping on the middle floor. */
  trader_npc?: string;
  /** NPC held prisoner on the bottom floor, and what freeing them gives. */
  prisoner_npc?: string;
  prisoner_reward?: string;
  /** Lore ids made readable in libraries (a book) and shrines (the
   *  statue), in floor order. */
  lore?: string[];
  /** A way straight out on the bottom floor: "opening" (a broken wall
   *  with daylight beyond); absent / "none" = leave by the entrance
   *  stairs. "stairs" / "ladder" are older names for the same thing. */
  bottom_exit?: "none" | "opening" | "stairs" | "ladder";
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
      /** traps.json records — the choices for the trap-mix picker. */
      trapChoices: TrapChoice[];
      /** Items with item_type "key" — the vault-key picker. */
      keyItems: Array<{ id: string; name: string }>;
      npcs: Array<{ id: string; name: string; counter?: string }>;
      allItems: Array<ChestItem>;
      /** Maps tagged `battle_screen_arena` — the battle-map choices. */
      arenaMaps: ArenaMapChoice[];
      /** Dungeons inherited from `extends` parents + `uses` libraries —
       *  saves keep only records that differ from these. */
      inherited: DungeonRecord[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

/** Values a freshly-created Dungeon starts with (the author's chosen
 *  house defaults). Authors tweak post-create. Entrance / exit
 *  placement is left unset (the generator's default: in rooms). */
const DEFAULTS = {
  style: "dungeon" as Style,
  difficulty: "normal" as Difficulty,
  /** Empty = any theme (no encounter-theme restriction). */
  theme: "",
  size: { width: 16, height: 16 },
  torch_density: 0.1,
  locked_doors: 0.1,
  doors: 0.1,
  pits: 0.1,
  pit_falls: true,
  traps: 0.35,
  objects: 0.25,
  floor_variety: 0,
  wall_decor: 0.25,
  loot: { chest_item: "treasure_chest", chest_frequency: 0.25 },
  bottom_exit: "opening" as const,
  vault_key: "iron_key",
} as const;

export function DungeonsBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");

  // ── Load dungeons (draft-aware) ────────────────────────────────
  const refresh = async () => {
    try {
      const src = getEditorModuleSource();
      const [layers, catalog, itemLayers, trapLayers, npcLayers, mapLayers] = await Promise.all([
        src.loadModelLayers(moduleId, "dungeons"),
        // Dungeons offered by `uses` libraries. Not part of the
        // resolved view — the import section below copies them in.
        src.listLibraryRecords(moduleId, "dungeons"),
        // Items model — resolved so the loot picker can offer every
        // chest item visible to this module (inherited + own).
        src.loadModelLayers(moduleId, "items"),
        // Traps model — the choices for the trap-mix picker.
        src.loadModelLayers(moduleId, "traps"),
        // NPCs — the trader / prisoner pickers.
        src.loadModelLayers(moduleId, "npcs"),
        // Maps — the arena choices for the battle-map picker.
        src.loadModelLayers(moduleId, "maps").catch(() => null),
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
      const trapsMerged = mergeModel(
        "traps",
        trapLayers.inherited,
        trapLayers.ownFile as Record<string, unknown> | null,
      ) as { traps?: Array<Record<string, unknown>> } | null;
      const trapChoices = (trapsMerged?.traps ?? [])
        .map((t) => ({
          id: String(t.id ?? ""),
          name: String(t.name ?? t.id ?? ""),
        }))
        .filter((t) => t.id !== "");
      const keyItems = (itemsMerged?.items ?? [])
        .filter((it) => it.item_type === "key")
        .map((it) => ({ id: String(it.id ?? ""), name: String(it.name ?? it.id ?? "") }))
        .filter((it) => it.id !== "");
      const npcsMerged = mergeModel(
        "npcs",
        npcLayers.inherited,
        npcLayers.ownFile as Record<string, unknown> | null,
      ) as { npcs?: Array<Record<string, unknown>> } | null;
      const npcs = (npcsMerged?.npcs ?? [])
        .map((n) => ({
          id: String(n.id ?? ""),
          name: String(n.name ?? n.id ?? ""),
          counter: typeof n.counter === "string" && n.counter ? n.counter : undefined,
        }))
        .filter((n) => n.id !== "")
        .sort((a, b) => a.name.localeCompare(b.name));
      const allItems = (itemsMerged?.items ?? [])
        .map((it) => ({
          id: String(it.id ?? ""),
          name: String(it.name ?? it.id ?? ""),
          category: it.category != null ? String(it.category) : undefined,
          item_type: it.item_type != null ? String(it.item_type) : undefined,
        }))
        .filter((it) => it.id !== "");
      const mapsMerged = mapLayers
        ? (mergeModel(
            "maps",
            mapLayers.inherited,
            mapLayers.ownFile as Record<string, unknown> | null,
          ) as { maps?: Array<Record<string, unknown>> } | null)
        : null;
      const arenaMaps: ArenaMapChoice[] = (mapsMerged?.maps ?? [])
        .filter((m) => Array.isArray(m.tags) && m.tags.includes(ARENA_TAG))
        .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? m.id ?? "") }))
        .filter((m) => m.id !== "")
        .sort((a, b) => a.name.localeCompare(b.name));
      setState({
        kind: "ok",
        dungeons,
        catalog,
        chestItems,
        arenaMaps,
        inherited: inheritedRecords<DungeonRecord>(layers.inherited, "dungeons"),
        trapChoices,
        keyItems,
        npcs,
        allItems,
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
    // Own file = own dungeons + inherited ones actually changed here.
    // (Writing the whole merged list froze copies of every inherited
    // dungeon, so later edits in Default / libraries never arrived.)
    baseFile.dungeons = ownRecordsAfterEdit(updated, state.inherited);
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
    setSelectedId(rec.id);
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

  const current =
    state.dungeons.find((d) => d.id === selectedId) ?? state.dungeons[0] ?? null;

  return (
    <div className="p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">Dungeon Editor</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/80">
            <span>
              {state.dungeons.length} dungeon
              {state.dungeons.length === 1 ? "" : "s"}
            </span>
            <span className="text-parchment/60">·</span>
            <span className="font-mono">modules/{moduleId}/{FILE_NAME}</span>
            {state.isDraft ? (
              <span className="rounded bg-ember/30 px-2 py-0.5 text-[13px] text-parchment/90">
                draft active
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Picker toolbar — same shape as the Dungeon Simulator's. */}
      <section className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-parchment/65">
            Dungeon
          </label>
          <select
            value={current?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={state.dungeons.length === 0}
            className="min-w-[260px] rounded border border-parchment/30 bg-ink/60 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
          >
            {state.dungeons.length === 0 ? (
              <option value="">(no dungeons)</option>
            ) : (
              [...groupedByTag.entries()].map(([tag, ds]) => (
                <optgroup key={tag} label={tag}>
                  {ds.map((d) => (
                    <option key={`${tag}::${d.id}`} value={d.id}>
                      {d.name} — {d.levels?.length ?? 0} floor
                      {(d.levels?.length ?? 0) === 1 ? "" : "s"}
                    </option>
                  ))}
                </optgroup>
              ))
            )}
          </select>
        </div>
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
          >
            + New Dungeon
          </button>
        ) : null}
        {current ? (
          <>
            <Link
              href={editorDungeonSimHref(moduleId, { id: current.id })}
              className="rounded border border-parchment/30 px-3 py-1 text-sm text-parchment/90 hover:bg-ink/40"
              title="Open this dungeon in the Dungeon Simulator. The simulator reads the published file — publish a draft first to test your edits."
            >
              ▶ Walk it in the Simulator
            </Link>
            <button
              type="button"
              onClick={() => onDeleteDungeon(current.id)}
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
              title="Delete this dungeon and all its floors."
            >
              Delete dungeon
            </button>
          </>
        ) : null}
      </section>

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

      <RoomRoleContext.Provider
        value={{ moduleId, keyItems: state.keyItems, npcs: state.npcs, allItems: state.allItems }}
      >
      <TrapChoicesContext.Provider value={state.trapChoices}>
        {current ? (
          <DungeonEditor
            key={current.id}
            dungeon={current}
            existingTags={allTags}
            chestItems={state.chestItems}
            arenaMaps={state.arenaMaps}
            onUpdate={(patch) => onUpdateDungeon(current.id, patch)}
            onAddLevel={() => onAddLevel(current.id)}
            onUpdateLevel={(idx, patch) => onUpdateLevel(current.id, idx, patch)}
            onDeleteLevel={(idx) => onDeleteLevel(current.id, idx)}
          />
        ) : (
          <p className="mt-6 text-sm text-parchment/75">
            No dungeons yet. Click <strong>+ New Dungeon</strong> to create one.
          </p>
        )}
      </TrapChoicesContext.Provider>
      </RoomRoleContext.Provider>

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

// ── Editor for the selected dungeon: details, floors grid, dungeon-wide ─

/** Boxed section — same frame as the Simulator's floors preview. */
function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-parchment/15 bg-ink/40 p-3">
      <h2 className="text-[13px] uppercase tracking-wide text-parchment/75">
        {title}
      </h2>
      {hint ? <p className="mb-2 text-xs text-parchment/60">{hint}</p> : null}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

function DungeonEditor({
  dungeon,
  existingTags,
  chestItems,
  arenaMaps,
  onUpdate,
  onAddLevel,
  onUpdateLevel,
  onDeleteLevel,
}: {
  dungeon: DungeonRecord;
  existingTags: string[];
  chestItems: Array<ChestItem>;
  arenaMaps: ArenaMapChoice[];
  onUpdate: (patch: Partial<DungeonRecord>) => void;
  onAddLevel: () => void;
  onUpdateLevel: (idx: number, patch: Partial<DungeonLevel>) => void;
  onDeleteLevel: (idx: number) => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <Panel title="Details">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Name
                </span>
                <input
                  type="text"
                  value={dungeon.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
                />
              </label>
              <div>
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  ID
                </span>
                <div className="mt-0.5 px-1 py-1 font-mono text-[13px] text-parchment/60">
                  {dungeon.id}
                </div>
              </div>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                Description
              </span>
              <textarea
                rows={2}
                value={dungeon.description ?? ""}
                onChange={(e) => onUpdate({ description: e.target.value })}
                className="mt-0.5 w-full resize-y rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
              />
            </label>
            <div>
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                Tags
              </span>
              <TagsPicker
                tags={dungeon.tags ?? []}
                existing={existingTags}
                onChange={(tags) => onUpdate({ tags })}
              />
            </div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              Soundtrack
            </span>
            <div className="mt-1">
              <SoundtrackPicker
                value={dungeon.soundtrack ?? []}
                onChange={(list) =>
                  onUpdate({ soundtrack: list.length > 0 ? list : undefined })
                }
                emptyHint="Inherits the module-level playlist."
              />
            </div>
          </div>
        </div>
      </Panel>

      <FloorsGrid
        dungeon={dungeon}
        existingTags={existingTags}
        chestItems={chestItems}
        arenaMaps={arenaMaps}
        onUpdate={onUpdate}
        onAddLevel={onAddLevel}
        onUpdateLevel={onUpdateLevel}
        onDeleteLevel={onDeleteLevel}
      />

      <Panel
        title="Whole dungeon"
        hint="Settings that apply once per dungeon rather than per floor."
      >
        <label className="block max-w-xl">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Exit on bottom floor
          </span>
          <select
            value={
              !dungeon.bottom_exit || dungeon.bottom_exit === "none"
                ? "none"
                : "opening"
            }
            onChange={(e) => {
              const v = e.target.value as "none" | "opening";
              onUpdate({ bottom_exit: v === "none" ? undefined : v });
            }}
            className="mt-0.5 block w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            <option value="none">None — leave by climbing back up</option>
            <option value="opening">Opening to daylight</option>
          </select>
          <span className="mt-1 block text-xs text-parchment/65">
            Cuts a broken opening with daylight beyond into the top wall of
            the bottom floor&apos;s last room. Stepping into it asks the
            player before leaving.
          </span>
        </label>
        <RoomRoleFields dungeon={dungeon} onUpdate={onUpdate} />
      </Panel>
    </div>
  );
}

// ── Floors grid: one row of defaults + one row per floor ──────────────

type GridRow =
  | { kind: "dungeon"; rec: DungeonRecord }
  | { kind: "level"; rec: DungeonLevel; idx: number };

/** Numeric knobs edited as plain number cells. */
type NumKey =
  | "torch_density"
  | "locked_doors"
  | "doors"
  | "pits"
  | "traps"
  | "objects"
  | "floor_variety"
  | "wall_decor"
  | "loops"
  | "room_roles"
  | "chest_frequency";

const DIAL_KEYS = [
  "objects",
  "floor_variety",
  "wall_decor",
  "loops",
  "room_roles",
] as const;
type DialKey = (typeof DIAL_KEYS)[number];
const isDialKey = (k: NumKey): k is DialKey =>
  (DIAL_KEYS as readonly string[]).includes(k);

function ownNum(
  rec: DungeonRecord | DungeonLevel,
  key: NumKey,
): number | undefined {
  if (key === "chest_frequency") return rec.loot?.chest_frequency;
  return (rec as DungeonLevel)[key];
}

/** What the generator uses when neither the floor nor the dungeon sets it. */
function baseNum(key: NumKey, style: string | undefined): number {
  if (isDialKey(key)) return STYLE_DEFAULTS[normalizeDungeonStyle(style)][key];
  if (key === "chest_frequency") return DUNGEON_DEFAULTS.loot.chest_frequency;
  return DUNGEON_DEFAULTS[key];
}

function numPatch(
  rec: DungeonRecord | DungeonLevel,
  key: NumKey,
  v: number | undefined,
): Record<string, unknown> {
  if (key === "chest_frequency") {
    return { loot: mergeLoot(rec.loot, { chest_frequency: v }) };
  }
  return { [key]: v };
}

/** Keys on a Level that are identity, not generator overrides. */
const LEVEL_IDENTITY_KEYS = new Set(["id", "name", "depth", "tags"]);
function overrideCount(level: DungeonLevel): number {
  return Object.entries(level).filter(
    ([k, v]) => !LEVEL_IDENTITY_KEYS.has(k) && v !== undefined,
  ).length;
}

const CELL =
  "w-full min-w-0 bg-transparent px-1.5 py-1 outline-none focus:bg-ink focus:ring-1 focus:ring-inset focus:ring-ember/70";
const NO_SPIN =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** Text colour for a cell: ember = this floor overrides, parchment =
 *  set on the dungeon row, dim = inherited / default. */
function cellTone(isLevel: boolean, set: boolean): string {
  if (!set) return "text-parchment/45";
  return isLevel ? "text-ember" : "text-parchment";
}

function ClearOverride({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      title="Clear this override (inherit the dungeon's value)."
      className="absolute left-0.5 top-1/2 hidden -translate-y-1/2 rounded bg-ink px-0.5 text-[11px] text-parchment/60 hover:text-parchment group-hover:block"
    >
      ↩
    </button>
  );
}

function NumCell({
  value,
  fallback,
  isLevel,
  step = 0.05,
  min = 0,
  max = 1,
  integer = false,
  onChange,
}: {
  value: number | undefined;
  fallback: number;
  isLevel: boolean;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const bad =
    value !== undefined &&
    (value < min || value > max || (integer && !Number.isInteger(value)));
  return (
    <div className="group relative">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ""}
        placeholder={String(fallback)}
        title={bad ? `Expected ${min}–${max}${integer ? " (whole number)" : ""}.` : undefined}
        onChange={(e) => {
          const v = e.target.value === "" ? NaN : Number(e.target.value);
          onChange(Number.isFinite(v) ? v : undefined);
        }}
        className={`${CELL} ${NO_SPIN} text-right placeholder:text-parchment/35 ${cellTone(isLevel, value !== undefined)} ${bad ? "bg-amber-500/15 ring-1 ring-inset ring-amber-300/70" : ""}`}
      />
      {isLevel && value !== undefined ? (
        <ClearOverride onClick={() => onChange(undefined)} />
      ) : null}
    </div>
  );
}

function SelectCell({
  value,
  emptyLabel,
  isLevel,
  title,
  onChange,
  children,
}: {
  value: string | undefined;
  /** Label of the blank option (inherit / default); null = no blank. */
  emptyLabel: string | null;
  isLevel: boolean;
  title?: string;
  onChange: (v: string | undefined) => void;
  children: ReactNode;
}) {
  const set = value !== undefined && value !== "";
  return (
    <select
      value={value ?? ""}
      title={title}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className={`${CELL} cursor-pointer [&>*]:bg-ink [&>*]:text-parchment ${cellTone(isLevel, set || emptyLabel === null)}`}
    >
      {emptyLabel !== null ? <option value="">{emptyLabel}</option> : null}
      {children}
    </select>
  );
}

type DrawerField = "trap_types" | "battle_maps" | "tags";
const DRAWER_LABELS: Record<DrawerField, string> = {
  trap_types: "Trap types",
  battle_maps: "Battle maps",
  tags: "Tags",
};

interface GridCol {
  key: string;
  group: string;
  label: string;
  hint: string;
  /** Min width in px. */
  w: number;
  cell: (row: GridRow) => ReactNode;
}

const DASH = <span className="block px-1.5 py-1 text-parchment/25">—</span>;

function FloorsGrid({
  dungeon,
  existingTags,
  chestItems,
  arenaMaps,
  onUpdate,
  onAddLevel,
  onUpdateLevel,
  onDeleteLevel,
}: {
  dungeon: DungeonRecord;
  existingTags: string[];
  chestItems: Array<ChestItem>;
  arenaMaps: ArenaMapChoice[];
  onUpdate: (patch: Partial<DungeonRecord>) => void;
  onAddLevel: () => void;
  onUpdateLevel: (idx: number, patch: Partial<DungeonLevel>) => void;
  onDeleteLevel: (idx: number) => void;
}) {
  const trapChoices = useContext(TrapChoicesContext);
  /** Open list editor: row -1 = the dungeon (defaults) row. */
  const [drawer, setDrawer] = useState<{ row: number; field: DrawerField } | null>(null);
  const levels = dungeon.levels ?? [];
  const rows: GridRow[] = [
    { kind: "dungeon", rec: dungeon },
    ...levels.map((rec, idx) => ({ kind: "level" as const, rec, idx })),
  ];
  const rowNum = (r: GridRow) => (r.kind === "dungeon" ? -1 : r.idx);
  const rowLabel = (r: GridRow) =>
    r.kind === "dungeon" ? "All floors (defaults)" : `Floor ${r.idx + 1} — ${r.rec.name}`;
  const isLevel = (r: GridRow) => r.kind === "level";
  const update = (r: GridRow, patch: Record<string, unknown>) =>
    r.kind === "dungeon"
      ? onUpdate(patch as Partial<DungeonRecord>)
      : onUpdateLevel(r.idx, patch as Partial<DungeonLevel>);
  const styleOf = (r: GridRow) =>
    r.kind === "dungeon" ? r.rec.style : (r.rec.style ?? dungeon.style);
  /** Blank-option label: "↳ value" on floors (inherit), "value" on the
   *  dungeon row (generator default). */
  const blank = (r: GridRow, inherited: string, dungeonDefault: string) =>
    r.kind === "level" ? `↳ ${inherited}` : dungeonDefault;

  const trapName = (id: string) => trapChoices.find((c) => c.id === id)?.name ?? id;
  const describeTraps = (list: TrapPick[] | undefined) =>
    list && list.length > 0
      ? list.map((p) => `${trapName(p.trap_id)}${(p.weight ?? 1) !== 1 ? ` ×${p.weight}` : ""}`).join(", ")
      : trapName(DEFAULT_TRAP_ID);
  const mapName = (id: string) => arenaMaps.find((m) => m.id === id)?.name ?? id;
  const describeMaps = (list: string[] | undefined) =>
    list && list.length > 0 ? list.map(mapName).join(", ") : "encounter's own";
  const chestName = (id: string | undefined) => (id ? chestLabel(chestItems, id) : "none");

  const drawerCell = (
    r: GridRow,
    field: DrawerField,
    text: string,
    set: boolean,
  ) => {
    const active = drawer?.row === rowNum(r) && drawer.field === field;
    return (
      <button
        type="button"
        onClick={() => setDrawer(active ? null : { row: rowNum(r), field })}
        title={`${text} — click to edit`}
        className={`flex w-full items-center gap-1 px-1.5 py-1 text-left hover:bg-parchment/5 ${active ? "bg-ember/20 ring-1 ring-inset ring-ember/70" : ""} ${cellTone(isLevel(r), set)}`}
      >
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <span className="text-[10px] text-parchment/40">{active ? "▴" : "▾"}</span>
      </button>
    );
  };

  const num = (
    key: NumKey,
    group: string,
    label: string,
    hint: string,
  ): GridCol => ({
    key,
    group,
    label,
    hint,
    w: 64,
    cell: (r) => (
      <NumCell
        value={ownNum(r.rec, key)}
        fallback={
          r.kind === "dungeon"
            ? baseNum(key, styleOf(r))
            : (ownNum(dungeon, key) ?? baseNum(key, styleOf(r)))
        }
        isLevel={isLevel(r)}
        onChange={(v) => update(r, numPatch(r.rec, key, v))}
      />
    ),
  });

  const sizeCol = (dim: "width" | "height", label: string): GridCol => ({
    key: `size_${dim}`,
    group: "Layout",
    label,
    hint: `Floor ${dim} in tiles (${DUNGEON_SIZE_MIN}–${DUNGEON_SIZE_MAX}).`,
    w: 56,
    cell: (r) => {
      const own = r.rec.size;
      const other = dim === "width" ? "height" : "width";
      const parentDim = dungeon.size?.[dim] ?? DUNGEON_DEFAULTS.size[dim];
      return (
        <NumCell
          value={own?.[dim]}
          fallback={r.kind === "dungeon" ? DUNGEON_DEFAULTS.size[dim] : parentDim}
          isLevel={isLevel(r)}
          step={1}
          min={DUNGEON_SIZE_MIN}
          max={DUNGEON_SIZE_MAX}
          integer
          onChange={(v) => {
            if (v === undefined) {
              update(r, { size: undefined });
              return;
            }
            const otherV =
              own?.[other] ??
              (r.kind === "level" ? dungeon.size?.[other] : undefined) ??
              DUNGEON_DEFAULTS.size[other];
            update(r, { size: { [dim]: v, [other]: otherV } as unknown as DungeonSize });
          }}
        />
      );
    },
  });

  const cols: GridCol[] = [
    // ── Floor identity (floors only) ──
    {
      key: "id",
      group: "Floor",
      label: "ID",
      hint: "Level id — referenced by quests and saves.",
      w: 170,
      cell: (r) =>
        r.kind === "dungeon" ? (
          DASH
        ) : (
          <input
            type="text"
            value={r.rec.id}
            onChange={(e) => update(r, { id: e.target.value })}
            className={`${CELL} font-mono text-parchment/85`}
          />
        ),
    },
    {
      key: "name",
      group: "Floor",
      label: "Name",
      hint: "Floor name shown to the player.",
      w: 140,
      cell: (r) =>
        r.kind === "dungeon" ? (
          DASH
        ) : (
          <input
            type="text"
            value={r.rec.name}
            onChange={(e) => update(r, { name: e.target.value })}
            className={`${CELL} text-parchment/90`}
          />
        ),
    },
    {
      key: "depth",
      group: "Floor",
      label: "Depth",
      hint: "How deep this floor is.",
      w: 52,
      cell: (r) =>
        r.kind === "dungeon" ? (
          DASH
        ) : (
          <input
            type="number"
            value={r.rec.depth}
            onChange={(e) => update(r, { depth: Number(e.target.value) || 0 })}
            className={`${CELL} ${NO_SPIN} text-right text-parchment/90`}
          />
        ),
    },
    {
      key: "tags",
      group: "Floor",
      label: "Tags",
      hint: "Tags on this floor.",
      w: 90,
      cell: (r) =>
        r.kind === "dungeon"
          ? DASH
          : drawerCell(
              r,
              "tags",
              r.rec.tags?.length ? r.rec.tags.join(", ") : "—",
              false,
            ),
    },
    // ── Layout ──
    {
      key: "style",
      group: "Layout",
      label: "Style",
      hint: "Tileset / generator theme.",
      w: 130,
      cell: (r) => (
        <SelectCell
          value={r.rec.style}
          emptyLabel={r.kind === "level" ? `↳ ${dungeon.style.replace(/_/g, " ")}` : null}
          isLevel={isLevel(r)}
          title={STYLE_LABELS[(r.rec.style ?? dungeon.style) as Style]}
          onChange={(v) => update(r, { style: v ?? (r.kind === "dungeon" ? dungeon.style : undefined) })}
        >
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
          {r.rec.style && !STYLES.includes(r.rec.style as Style) ? (
            <option value={r.rec.style}>{r.rec.style} (unsupported)</option>
          ) : null}
        </SelectCell>
      ),
    },
    sizeCol("width", "W"),
    sizeCol("height", "H"),
    num("loops", "Layout", "Loops", "Extra corridors joining nearby rooms, so floors have circuits instead of dead ends."),
    {
      key: "edge_transitions",
      group: "Layout",
      label: "Stairs at",
      hint: "Entrance / exit placement: edge of the map or inside rooms.",
      w: 92,
      cell: (r) => {
        const own = r.rec.edge_transitions;
        const parent = (dungeon.edge_transitions ?? false) ? "edge" : "rooms";
        return (
          <SelectCell
            value={own === undefined ? undefined : own ? "edge" : "rooms"}
            emptyLabel={blank(r, parent, "rooms")}
            isLevel={isLevel(r)}
            onChange={(v) => update(r, { edge_transitions: v === undefined ? undefined : v === "edge" })}
          >
            <option value="edge">edge</option>
            <option value="rooms">rooms</option>
          </SelectCell>
        );
      },
    },
    // ── Encounters ──
    {
      key: "difficulty",
      group: "Encounters",
      label: "Difficulty",
      hint: "Monster difficulty pulled onto the floor (any = ignore).",
      w: 96,
      cell: (r) => (
        <SelectCell
          value={r.rec.difficulty}
          emptyLabel={r.kind === "level" ? `↳ ${dungeon.difficulty}` : null}
          isLevel={isLevel(r)}
          onChange={(v) => update(r, { difficulty: v ?? (r.kind === "dungeon" ? dungeon.difficulty : undefined) })}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          {r.rec.difficulty && !DIFFICULTIES.includes(r.rec.difficulty as Difficulty) ? (
            <option value={r.rec.difficulty}>{r.rec.difficulty} (custom)</option>
          ) : null}
        </SelectCell>
      ),
    },
    {
      key: "theme",
      group: "Encounters",
      label: "Theme",
      hint: "Only spawn encounters of this theme. Blank = any.",
      w: 96,
      cell: (r) => (
        <SelectCell
          value={r.rec.theme}
          emptyLabel={blank(r, dungeon.theme || "any", "any")}
          isLevel={isLevel(r)}
          onChange={(v) => update(r, { theme: v })}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {r.rec.theme && !THEMES.includes(r.rec.theme as (typeof THEMES)[number]) ? (
            <option value={r.rec.theme}>{r.rec.theme} (custom)</option>
          ) : null}
        </SelectCell>
      ),
    },
    {
      key: "battle_maps",
      group: "Encounters",
      label: "Battle maps",
      hint: "Arena maps fights on this floor run on. Click to edit.",
      w: 120,
      cell: (r) => {
        const own = r.rec.battle_maps;
        if (r.kind === "level" && own === undefined) {
          return drawerCell(r, "battle_maps", `↳ ${describeMaps(dungeon.battle_maps)}`, false);
        }
        return drawerCell(r, "battle_maps", describeMaps(own), !!own && (own.length > 0 || r.kind === "level"));
      },
    },
    // ── Doors & light ──
    num("torch_density", "Doors & light", "Torches", "Torch density (0–1)."),
    num("doors", "Doors & light", "Doors", "Chance each room opening gets a door (0–1)."),
    num("locked_doors", "Doors & light", "Locked", "Chance a door is locked (0–1)."),
    // ── Hazards ──
    num("traps", "Hazards", "Traps", "Chance each room past the entrance gets one hidden trap (0–1)."),
    {
      key: "trap_types",
      group: "Hazards",
      label: "Trap types",
      hint: "Weighted mix of traps.json records. Click to edit.",
      w: 120,
      cell: (r) => {
        const own = r.rec.trap_types;
        if (r.kind === "level" && own === undefined) {
          return drawerCell(r, "trap_types", `↳ ${describeTraps(dungeon.trap_types)}`, false);
        }
        return drawerCell(r, "trap_types", describeTraps(own), !!own && own.length > 0);
      },
    },
    num("pits", "Hazards", "Pits", "Chance each room past the entrance gets a pit (0–1)."),
    {
      key: "pit_falls",
      group: "Hazards",
      label: "Pits drop",
      hint: "Pits drop the party to the floor below (light damage) vs solid chasms.",
      w: 76,
      cell: (r) => {
        const own = r.rec.pit_falls;
        return (
          <SelectCell
            value={own === undefined ? undefined : own ? "yes" : "no"}
            emptyLabel={blank(r, (dungeon.pit_falls ?? true) ? "yes" : "no", "yes")}
            isLevel={isLevel(r)}
            onChange={(v) => update(r, { pit_falls: v === undefined ? undefined : v === "yes" })}
          >
            <option value="yes">yes</option>
            <option value="no">no</option>
          </SelectCell>
        );
      },
    },
    // ── Dressing ──
    num("objects", "Dressing", "Objects", "Pillars / stalagmites / rubble in rooms (0–1). Never blocks a route."),
    num("floor_variety", "Dressing", "Floor var.", "Alternate floors: per room (dungeon) or patches (cavern) (0–1)."),
    num("wall_decor", "Dressing", "Wall decor", "Banners, windows, cracks, crystals, webs on wall faces (0–1)."),
    num("room_roles", "Dressing", "Room roles", "Chance each room is furnished (storeroom, library, shrine, vault…) (0–1)."),
    // ── Loot ──
    {
      key: "chest_item",
      group: "Loot",
      label: "Chest",
      hint: "Chest item placed in rooms. None = no chests.",
      w: 140,
      cell: (r) => {
        const own = r.rec.loot?.chest_item;
        return (
          <SelectCell
            value={own}
            emptyLabel={blank(r, chestName(dungeon.loot?.chest_item), "none")}
            isLevel={isLevel(r)}
            onChange={(v) => update(r, { loot: mergeLoot(r.rec.loot, { chest_item: v }) })}
          >
            {groupItemsByCategory(chestItems).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {own && !chestItems.some((it) => it.id === own) ? (
              <option value={own}>{own} (missing)</option>
            ) : null}
          </SelectCell>
        );
      },
    },
    num("chest_frequency", "Loot", "Chest %", "Chance per room of a chest (0–1)."),
  ];

  // Group header spans (consecutive columns sharing a group).
  const groups: Array<{ label: string; span: number }> = [];
  for (const c of cols) {
    const last = groups[groups.length - 1];
    if (last && last.label === c.group) last.span += 1;
    else groups.push({ label: c.group, span: 1 });
  }

  const HEAD_BG = "bg-[#232339]";
  const TH = `border-b border-r border-parchment/10 ${HEAD_BG} px-1.5 py-1 text-left font-normal`;
  const openRow =
    drawer && drawer.row < levels.length ? rows[drawer.row + 1] : null;

  return (
    <Panel
      title={`Floors (${levels.length})`}
      hint={
        <>
          The top row holds the dungeon&apos;s defaults; each floor below
          inherits them (dim <span className="text-parchment/45">↳</span>{" "}
          values) unless it sets its own —{" "}
          <span className="text-ember">ember</span> cells are per-floor
          overrides. Clear a cell (or hover and click ↩) to inherit again.
        </>
      }
    >
      <div className="overflow-x-auto rounded border border-parchment/15">
        <table className="border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className={`${TH} sticky left-0 z-20 min-w-[124px] align-bottom text-xs uppercase tracking-wide text-parchment/60`}
              >
                Floor
              </th>
              {groups.map((g) => (
                <th
                  key={g.label}
                  colSpan={g.span}
                  className={`${TH} text-[11px] uppercase tracking-wide text-parchment/50`}
                >
                  {g.label}
                </th>
              ))}
              <th rowSpan={2} className={`${TH} border-r-0`} />
            </tr>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  title={c.hint}
                  style={{ minWidth: c.w }}
                  className={`${TH} cursor-help whitespace-nowrap text-xs text-parchment/75`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isDefaults = r.kind === "dungeon";
              const bg = isDefaults
                ? "bg-[#29293f]"
                : r.idx % 2 === 0
                  ? "bg-[#1a1a2e]"
                  : "bg-[#1e1e33]";
              const border = isDefaults
                ? "border-b-2 border-b-parchment/25"
                : "border-b border-b-parchment/10";
              const n = r.kind === "level" ? overrideCount(r.rec) : 0;
              return (
                <tr key={isDefaults ? "__defaults" : `${r.idx}`} className={bg}>
                  <td className={`sticky left-0 z-10 ${bg} ${border} border-r border-r-parchment/15 px-2 py-1`}>
                    {isDefaults ? (
                      <>
                        <div className="font-display text-parchment">All floors</div>
                        <div className="text-[11px] text-parchment/50">defaults</div>
                      </>
                    ) : (
                      <>
                        <div className="whitespace-nowrap text-parchment/90">
                          Floor {r.idx + 1}
                        </div>
                        <div className={`text-[11px] ${n > 0 ? "text-ember/90" : "text-parchment/40"}`}>
                          {n > 0 ? `${n} override${n === 1 ? "" : "s"}` : "inherits all"}
                        </div>
                      </>
                    )}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className={`${border} border-r border-r-parchment/10 p-0 align-middle`}
                      style={{ minWidth: c.w, maxWidth: c.w * 1.6 }}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                  <td className={`${border} px-1 text-center`}>
                    {r.kind === "level" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDrawer(null);
                          onDeleteLevel(r.idx);
                        }}
                        title={`Delete floor ${r.idx + 1}`}
                        className="rounded px-1.5 text-parchment/45 hover:bg-ember/30 hover:text-parchment"
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {levels.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length + 2}
                  className="px-3 py-3 text-[13px] text-parchment/60"
                >
                  No floors yet — the dungeon needs at least one to generate.
                  Click <strong>+ Add floor</strong> below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {drawer && openRow ? (
        <div className="mt-2 rounded border border-ember/40 bg-ink/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">
              {rowLabel(openRow)} · {DRAWER_LABELS[drawer.field]}
            </h3>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/75 hover:text-parchment"
            >
              Done
            </button>
          </div>
          {drawer.field === "trap_types" ? (
            <div className="grid">
              <TrapMixField
                own={openRow.rec.trap_types}
                parent={openRow.kind === "level" ? dungeon.trap_types : undefined}
                allowInherit={openRow.kind === "level"}
                onChange={(v) => update(openRow, { trap_types: v })}
              />
            </div>
          ) : drawer.field === "battle_maps" ? (
            <BattleMapsField
              value={openRow.rec.battle_maps}
              arenaMaps={arenaMaps}
              isLevel={openRow.kind === "level"}
              parentValue={dungeon.battle_maps}
              onChange={(v) => update(openRow, { battle_maps: v })}
            />
          ) : openRow.kind === "level" ? (
            <div className="mt-1">
              <TagsPicker
                tags={openRow.rec.tags ?? []}
                existing={existingTags}
                onChange={(tags) => update(openRow, { tags })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2">
        <button
          type="button"
          onClick={onAddLevel}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-1 text-[13px] text-parchment hover:bg-ember/40"
        >
          + Add floor
        </button>
      </div>
    </Panel>
  );
}

// ── Battle maps (arena maps fights in this dungeon run on) ─────────

/** Arena map ids must carry this tag (same rule as `custom_map`). */
const ARENA_TAG = "battle_screen_arena";

interface ArenaMapChoice {
  id: string;
  name: string;
}

/**
 * Chips + add-dropdown for `battle_maps`. On the Dungeon, empty = no
 * override (encounters' own `custom_map`, else the default arena). On
 * a Level (`isLevel`), undefined = inherit the Dungeon's list (shown
 * dimmed); "↩ Inherit" clears the override.
 */
function BattleMapsField({
  value,
  arenaMaps,
  isLevel = false,
  parentValue,
  onChange,
}: {
  value: string[] | undefined;
  arenaMaps: ArenaMapChoice[];
  /** True on Level rows (inherit / override semantics). */
  isLevel?: boolean;
  /** Level rows: the Dungeon's list, shown while inheriting. */
  parentValue?: string[];
  onChange: (v: string[] | undefined) => void;
}) {
  const inheriting = isLevel && value === undefined;
  const shown = inheriting ? parentValue ?? [] : value ?? [];
  const nameOf = (id: string) => arenaMaps.find((m) => m.id === id)?.name;
  const addable = arenaMaps.filter((m) => !shown.includes(m.id));
  const set = (next: string[]) =>
    onChange(next.length === 0 && !isLevel ? undefined : next);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Battle maps
        </span>
        {isLevel && !inheriting ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-[11px] text-parchment/55 underline decoration-dotted hover:text-parchment"
            title="Drop this floor's override and use the Dungeon's battle maps."
          >
            ↩ Inherit
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {shown.length === 0 ? (
          <span className="text-[13px] text-parchment/55">
            {inheriting
              ? "(inherit — none: each encounter's own map, else the default arena)"
              : isLevel
                ? "None on this floor — each encounter's own map, else the default arena."
                : "None — each encounter's own map, else the default arena."}
          </span>
        ) : (
          shown.map((id) => (
            <span
              key={id}
              className={[
                "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[13px]",
                inheriting
                  ? "border-parchment/15 text-parchment/55"
                  : nameOf(id)
                    ? "border-parchment/30 text-parchment/90"
                    : "border-amber-300/50 text-amber-200/90",
              ].join(" ")}
              title={nameOf(id) ? id : `${id} — not a battle_screen_arena map in this module`}
            >
              {nameOf(id) ?? `${id} (missing)`}
              {!inheriting ? (
                <button
                  type="button"
                  onClick={() => set(shown.filter((x) => x !== id))}
                  className="text-parchment/55 hover:text-parchment"
                  aria-label={`Remove ${nameOf(id) ?? id}`}
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))
        )}
        {addable.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              set([...(inheriting ? [] : shown), e.target.value]);
            }}
            className="rounded border border-parchment/20 bg-ink/50 px-1 py-0.5 text-[13px] text-parchment/90"
            title="Add an arena map. With several, each fight picks one."
          >
            <option value="">{inheriting ? "+ Override…" : "+ Add…"}</option>
            {addable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <span className="mt-1 block text-xs text-parchment/65">
        {arenaMaps.length === 0
          ? 'No maps tagged "battle_screen_arena" in this module yet — tag an 18×16 arena map to offer it here.'
          : "Fights in this dungeon run on one of these arena maps, chosen per monster group. They replace the encounters' own battle maps."}
      </span>
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

/** Dungeon-wide settings for furnished rooms' gameplay: the key to a
 *  sealed treasure vault, and the Lore that libraries and shrines make
 *  readable. */
function RoomRoleFields({
  dungeon,
  onUpdate,
}: {
  dungeon: DungeonRecord;
  onUpdate: (patch: Partial<DungeonRecord>) => void;
}) {
  const { moduleId, keyItems, npcs, allItems } = useContext(RoomRoleContext);
  const traders = npcs.filter((n) => n.counter);
  const npcOption = (id: string | undefined, list: typeof npcs) =>
    id && !list.some((n) => n.id === id) ? <option value={id}>{id} (missing)</option> : null;
  const key = dungeon.vault_key ?? "";
  const lore = dungeon.lore ?? [];
  const setLore = (next: string[]) => onUpdate({ lore: next.length > 0 ? next : undefined });
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Vault key
        </span>
        <select
          value={key}
          onChange={(e) => onUpdate({ vault_key: e.target.value || undefined })}
          className="mt-0.5 block w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
        >
          <option value="">(no key — pick the lock or cast Knock)</option>
          {keyItems.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
          {key && !keyItems.some((k) => k.id === key) ? (
            <option value={key}>{key} (missing)</option>
          ) : null}
        </select>
        <span className="mt-1 block text-xs text-parchment/65">
          A treasure vault (a furnished room) is a dead-end room behind a
          locked door with a chest inside. Its key lies elsewhere on the
          floor — in a guard post when there is one.
        </span>
      </label>
      <div>
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Readable lore
        </span>
        <div className="mt-0.5 space-y-1">
          {lore.map((id, i) => (
            <div key={i} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <LorePicker
                  value={id}
                  moduleId={moduleId}
                  noneLabel="(choose lore)"
                  help=""
                  onChange={(v) => setLore(lore.map((x, j) => (j === i ? v : x)).filter(Boolean))}
                />
              </div>
              <button
                type="button"
                onClick={() => setLore(lore.filter((_, j) => j !== i))}
                title="Remove"
                className="rounded border border-parchment/20 px-1.5 py-0.5 text-[13px] text-parchment/75 hover:border-ember/60 hover:text-parchment"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLore([...lore, ""])}
            className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-parchment/40 hover:text-parchment"
          >
            + Add lore
          </button>
        </div>
        <span className="mt-1 block text-xs text-parchment/65">
          Each library&apos;s book and each shrine&apos;s statue becomes
          readable, taking the next entry in floor order (each used once).
        </span>
      </div>

      {/* Reasons to go deeper: a trader mid-dungeon, a prisoner at the
          bottom. */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-parchment/65">
          Trader (middle floor)
        </span>
        <select
          value={dungeon.trader_npc ?? ""}
          onChange={(e) => onUpdate({ trader_npc: e.target.value || undefined })}
          className="mt-0.5 block w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
        >
          <option value="">(none)</option>
          {traders.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} — {n.counter}
            </option>
          ))}
          {npcOption(dungeon.trader_npc, traders)}
        </select>
        <span className="mt-1 block text-xs text-parchment/65">
          A shopkeeper NPC (one with a shop) camps in a quiet room on the
          middle floor, so the party can buy and sell mid-run.
        </span>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Prisoner (bottom floor)
          </span>
          <select
            value={dungeon.prisoner_npc ?? ""}
            onChange={(e) => onUpdate({ prisoner_npc: e.target.value || undefined })}
            className="mt-0.5 block w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          >
            <option value="">(none)</option>
            {npcs.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
            {npcOption(dungeon.prisoner_npc, npcs)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Reward for freeing them
          </span>
          <select
            value={dungeon.prisoner_reward ?? ""}
            onChange={(e) => onUpdate({ prisoner_reward: e.target.value || undefined })}
            disabled={!dungeon.prisoner_npc}
            className="mt-0.5 block w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90 disabled:opacity-50"
          >
            <option value="">(no item — just their XP)</option>
            {groupItemsByCategory(allItems).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="block text-xs text-parchment/65 sm:col-span-2">
          Held in a locked cell on the bottom floor (its key lies elsewhere
          on the floor, like a vault&apos;s). The first talk frees them: their
          meeting XP plus this item, then they leave for good.
        </span>
      </div>
    </div>
  );
}

/** Weighted trap-mix editor: one row per traps.json record with a
 *  relative weight. Empty on a Level inherits the parent's mix; empty
 *  on the Dungeon means every trap is the default (Dart Trap). */
function TrapMixField({
  own,
  parent,
  allowInherit,
  onChange,
}: {
  own: TrapPick[] | undefined;
  parent: TrapPick[] | undefined;
  allowInherit: boolean;
  onChange: (v: TrapPick[] | undefined) => void;
}) {
  const choices = useContext(TrapChoicesContext);
  const label = (id: string) => choices.find((c) => c.id === id)?.name ?? id;
  const describe = (list: TrapPick[] | undefined) =>
    list && list.length > 0
      ? list.map((p) => `${label(p.trap_id)} ×${p.weight ?? 1}`).join(", ")
      : label(DEFAULT_TRAP_ID);
  const rows = own ?? [];
  const set = (next: TrapPick[]) => onChange(next.length > 0 ? next : undefined);
  const firstUnused =
    choices.find((c) => !rows.some((p) => p.trap_id === c.id))?.id ??
    choices[0]?.id ??
    DEFAULT_TRAP_ID;
  return (
    <div className="block sm:col-span-2">
      <span className="text-xs uppercase tracking-wide text-parchment/65">
        Trap types (weighted)
      </span>
      <div className="mt-0.5 space-y-1">
        {rows.length === 0 ? (
          <p className="text-[13px] text-parchment/60">
            ({allowInherit ? "inherit" : "default"} — {describe(allowInherit ? parent : undefined)})
          </p>
        ) : null}
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-1">
            <select
              value={p.trap_id}
              onChange={(e) =>
                set(rows.map((q, j) => (j === i ? { ...q, trap_id: e.target.value } : q)))
              }
              className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {!choices.some((c) => c.id === p.trap_id) ? (
                <option value={p.trap_id}>{p.trap_id} (missing)</option>
              ) : null}
            </select>
            <input
              type="number"
              step={1}
              min={0}
              value={p.weight ?? 1}
              title="Relative weight — a trap with weight 3 turns up three times as often as one with weight 1."
              onChange={(e) => {
                const v = Number(e.target.value);
                set(
                  rows.map((q, j) =>
                    j === i ? { ...q, weight: Number.isFinite(v) ? v : 1 } : q,
                  ),
                );
              }}
              className="w-16 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            />
            <button
              type="button"
              onClick={() => set(rows.filter((_, j) => j !== i))}
              title="Remove this trap type."
              className="rounded border border-parchment/20 px-1.5 text-[13px] text-parchment/75 hover:border-ember/60 hover:text-parchment"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => set([...rows, { trap_id: firstUnused, weight: 1 }])}
            className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-parchment/40 hover:text-parchment"
          >
            + Add trap type
          </button>
          {allowInherit && own !== undefined ? (
            <InheritButton onClick={() => onChange(undefined)} />
          ) : null}
        </div>
      </div>
    </div>
  );
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
      doors: DEFAULTS.doors,
      pits: DEFAULTS.pits,
      pit_falls: DEFAULTS.pit_falls,
      traps: DEFAULTS.traps,
      objects: DEFAULTS.objects,
      floor_variety: DEFAULTS.floor_variety,
      wall_decor: DEFAULTS.wall_decor,
      loot: { ...DEFAULTS.loot },
      bottom_exit: DEFAULTS.bottom_exit,
      vault_key: DEFAULTS.vault_key,
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
        Procedural dungeon. It starts with the standard settings (style{" "}
        <code>{DEFAULTS.style}</code>, difficulty{" "}
        <code>{DEFAULTS.difficulty}</code>, size{" "}
        <code>
          {DEFAULTS.size.width}×{DEFAULTS.size.height}
        </code>
        , torches / locked doors / doors / pits{" "}
        <code>{DEFAULTS.torch_density}</code>, traps{" "}
        <code>{DEFAULTS.traps}</code> per room, objects and wall decor{" "}
        <code>{DEFAULTS.objects}</code>, Treasure Chests at{" "}
        <code>{DEFAULTS.loot.chest_frequency}</code> per room, and a daylit
        opening out of the bottom floor) — tweak after creation. Add levels inline
        once it opens.
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
