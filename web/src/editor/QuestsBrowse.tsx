"use client";

/**
 * Quests-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "quests". Same
 * shape as DungeonsBrowse — tag-tree of parents, expand-to-edit,
 * inline child management — but the children are Quest Steps with a
 * `kind` discriminator and a free-form `params` blob.
 *
 *   - Quests grouped by tag. Untagged quests fall into "(untagged)".
 *   - Each quest expands to edit metadata (name, description, tags)
 *     and manage its `steps[]` array.
 *   - Quest Steps are inline objects with id, name, kind, optional
 *     tags, optional description, and a JSON `params` blob (textarea
 *     today — kind-specific UIs land when the runtime is wired up).
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
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { EncounterPicker, type EncounterPickerEntry } from "./EncounterPicker";
import { SpritePicker } from "./SpritePicker";
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";
import { groupItemsByCategory } from "./itemTags";
import { groupByTags } from "./mapTags";

const NPC_SPRITE_CONFIG = { category: "person", format: "path" } as const;

const MODEL_KEY = "quests";
const FILE_NAME = "quests.json";
const UNTAGGED = "(untagged)";
// Quest step kinds the editor knows how to author. `kill` finishes
// when the party clears the named encounter the listed number of
// times; `retrieve` finishes when the party walks onto a specific
// (map, col, row) cell that the runtime stamps with the named item
// at quest-accept time. Both have dedicated fieldsets below.
//
// Legacy data with `kind` set to anything outside this list (e.g.
// `visit`/`fetch`/`talk` from before the cleanup) renders as a
// disabled option in the dropdown plus an inline notice telling
// the author to re-pick a supported kind. We don't silently coerce
// — the change is the author's call.
// `reach` is the "spelunking" kind: the author picks a dungeon and
// leaves the level blank; at load time the runtime fans the single
// step out into one reach step per floor of that dungeon, each
// credited simply by arriving on the matching floor.
// `discover` is the "find a place" kind: the party stands on a cell
// (col, row) on the step's Map and the quest completes in place —
// rewards granted immediately, no return to the giver.
const KNOWN_KINDS = ["kill", "retrieve", "reach", "discover"] as const;
type StepKind = (typeof KNOWN_KINDS)[number] | string;

interface QuestStep {
  id: string;
  name: string;
  tags?: string[];
  kind: StepKind;
  description?: string;
  /** For `kind === "kill"` — the encounter id (from encounters.json)
   *  this step wants cleared. First-class on the step record; we no
   *  longer route through a generic `params` blob. JSON key:
   *  `encounter_id`. */
  encounter_id?: string;
  /** For `kind === "kill"` (or any countable step) — how many
   *  encounter clearings credit the step. Defaults to 1 at the
   *  runtime when omitted. JSON key: `count`. */
  count?: number;
  /** For `kind === "kill"` — authored anchor cells the runtime spawn
   *  pass uses to place this step's encounter copies, in order. The
   *  first copy lands at `positions[0]`, the second at `positions[1]`,
   *  and so on. Copies beyond `positions.length` (or when an authored
   *  cell isn't walkable at spawn time) fall back to random walkable
   *  selection. Optional; omitting it or leaving it empty preserves
   *  the historical pure-random placement. JSON key: `positions`. */
  positions?: Array<{ col: number; row: number }>;
  /** For `kind === "retrieve"` — the item the runtime stamps onto
   *  the target cell once the quest is accepted. JSON key:
   *  `item_id`. */
  item_id?: string;
  /** For `kind === "retrieve"` — the cell on `map_id` where the
   *  named item (`item_id`) appears once the quest is accepted.
   *  The host stamps it onto `cell.item`; stepping onto it credits
   *  the step and the item lands in the party's inventory. 0-based.
   *  JSON keys: `col`, `row`. */
  col?: number;
  row?: number;
  /** Where this step physically takes place. The runtime uses this to
   *  decide where to spawn monsters / place fetch items / anchor a
   *  talk encounter; the editor uses it to surface a map id picker so
   *  authors don't hand-type ids.
   *
   *  - "map" pairs with `map_id` (a static, hand-painted map).
   *  - Unset (or omitted) means the step has no fixed location —
   *    talk steps with the quest giver, abstract objectives, etc.
   *
   *  The legacy "dungeon" location kind was removed from the editor —
   *  baked dungeons are just maps, so authors point at the specific
   *  baked map instead of a dungeon+level pair. The runtime
   *  `QuestLocationKind` still accepts "dungeon" for save-data
   *  back-compat with quests authored before the bake feature.
   *
   *  JSON key: `location_kind`. */
  location_kind?: "map";
  /** Map catalog id. Only consulted when `location_kind === "map"`. */
  map_id?: string;
  /** For `kind === "reach"` (spelunking) — the dungeon record whose
   *  floors this quest tracks. The author picks the dungeon and leaves
   *  the level unset; the runtime's `expandSpelunkingQuests` fans this
   *  single step into one reach step per floor. JSON key:
   *  `dungeon_id`. */
  dungeon_id?: string;
  /** Per-step rewards block. Mirrors the quest-level {@link Rewards}
   *  envelope but narrowed to two keys — `items` and `tile_add`. XP
   *  and gold are intentionally absent: those stay quest-level so the
   *  bigger numerical payoff still lands at turn-in. Authored via the
   *  Step Rewards section in the step row; the runtime applies these
   *  IMMEDIATELY when the step's progress flips from false to true,
   *  which is the lever authors use to gate the next step on a map
   *  change or an item drop. JSON key: `rewards`. */
  rewards?: StepRewards;
}

/** Editor-side shape for a single step's `rewards` block. Strict
 *  subset of the quest-level {@link Rewards} — no XP / gold. */
interface StepRewards {
  items?: string[];
  tile_add?: TileAddOp[];
}

interface QuestGiver {
  npc_name: string;
  npc_sprite: string;
  start_dialog: string;
  end_dialog: string;
  /** Optional chatter shown after the quest is turned in — the giver
   *  becomes a normal NPC and this is their line. The runtime falls
   *  back to a generic thank-you when empty. */
  post_dialog?: string;
}

interface TileOp {
  map: string;
  col: number;
  row: number;
}

interface TileAddOp extends TileOp {
  tile_id: string;
}

interface Rewards {
  xp?: number;
  gold?: number;
  items?: string[];
  tile_add?: TileAddOp[];
}

interface QuestRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  quest_giver?: QuestGiver;
  rewards?: Rewards;
  steps: QuestStep[];
}

interface ItemSummary {
  id: string;
  name?: string;
  /** Organizational tags from items.json — drive the picker's
   *  "Category › Type" optgroups. */
  category?: string;
  item_type?: string;
}

interface MapSummary {
  id: string;
  name?: string;
  /** Organizational tags from maps.json — drive the picker's
   *  tag-grouped optgroups (same ordering as the maps browse tree). */
  tags?: string[];
}

interface DungeonSummary {
  id: string;
  name?: string;
  /** Floor count surfaced in the picker so the author sees how many
   *  reach steps a spelunking quest will expand into. */
  floors?: number;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      quests: QuestRecord[];
      /** Quests available to import from `uses` libraries (e.g.
       *  "Side Quests"). Not auto-merged — surfaced for explicit
       *  import, mirroring MapsBrowse / DungeonsBrowse. */
      catalog: LibraryCatalogEntry[];
      items: ItemSummary[];
      maps: MapSummary[];
      dungeons: DungeonSummary[];
      encounters: EncounterPickerEntry[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function QuestsBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const refresh = async () => {
    try {
      const src = getEditorModuleSource();
      const [
        questsLayers,
        catalog,
        itemsLayers,
        mapsLayers,
        dungeonsLayers,
        encountersLayers,
      ] = await Promise.all([
          src.loadModelLayers(moduleId, "quests"),
          // Quests offered by `uses` libraries. Not part of the
          // resolved view — the import section below copies them in.
          src.listLibraryRecords(moduleId, "quests"),
          src.loadModelLayers(moduleId, "items"),
          src.loadModelLayers(moduleId, "maps"),
          src.loadModelLayers(moduleId, "dungeons"),
          src.loadModelLayers(moduleId, "encounters"),
        ]);
      const draft = await loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ?? (questsLayers.ownFile as Record<string, unknown> | null);
      const merged = mergeModel(
        "quests",
        questsLayers.inherited,
        ownEffective,
      ) as { quests?: QuestRecord[] } | null;
      const quests = merged?.quests ?? [];

      const itemsMerged = mergeModel(
        "items",
        itemsLayers.inherited,
        itemsLayers.ownFile,
      ) as { items?: ItemSummary[] } | null;
      const items = (itemsMerged?.items ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        item_type: i.item_type,
      }));

      const mapsMerged = mergeModel(
        "maps",
        mapsLayers.inherited,
        mapsLayers.ownFile,
      ) as { maps?: MapSummary[] } | null;
      const maps = (mapsMerged?.maps ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        tags: m.tags,
      }));

      const dungeonsMerged = mergeModel(
        "dungeons",
        dungeonsLayers.inherited,
        dungeonsLayers.ownFile,
      ) as {
        dungeons?: Array<{ id: string; name?: string; levels?: unknown[] }>;
      } | null;
      const dungeons = (dungeonsMerged?.dungeons ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        floors: Array.isArray(d.levels) ? d.levels.length : undefined,
      }));

      const encountersMerged = mergeModel(
        "encounters",
        encountersLayers.inherited,
        encountersLayers.ownFile,
      ) as { encounters?: EncounterPickerEntry[] } | null;
      const encounters = (encountersMerged?.encounters ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        area: e.area,
        level: e.level,
        weight: e.weight,
        theme: e.theme,
        monster_party_tile: e.monster_party_tile,
        monsters: e.monsters,
      }));

      setState({
        kind: "ok",
        quests,
        catalog,
        items,
        maps,
        dungeons,
        encounters,
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

  const allTags = useMemo(() => {
    if (state.kind !== "ok") return [];
    const s = new Set<string>();
    for (const q of state.quests) for (const t of q.tags ?? []) s.add(t);
    return [...s].sort();
  }, [state]);

  const groupedByTag = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, QuestRecord[]>();
    const groups = new Map<string, QuestRecord[]>();
    for (const q of state.quests) {
      const tags =
        Array.isArray(q.tags) && q.tags.length > 0 ? q.tags : [UNTAGGED];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(q);
      }
    }
    const sorted = new Map<string, QuestRecord[]>();
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    });
    for (const k of keys) sorted.set(k, groups.get(k)!);
    return sorted;
  }, [state]);

  const persist = (updated: QuestRecord[]) => {
    if (state.kind !== "ok") return;
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { quests: [] };
    baseFile.quests = updated;
    // saveDraft is async — fire-and-forget; see CharactersBrowse.persist.
    void saveDraft(moduleId, MODEL_KEY, baseFile);
    setState({
      ...state,
      quests: updated,
      ownFile: baseFile,
      isDraft: true,
    });
  };

  const onCreate = (rec: QuestRecord) => {
    if (state.kind !== "ok") return;
    persist([...state.quests, rec]);
    setCreating(false);
    setExpanded((prev) => new Set(prev).add(rec.id));
  };

  /**
   * Import one or more quests from a `uses` library into THIS
   * module's own quests file. Deep-clones each record so the copy
   * decouples from the library — afterwards the author edits it like
   * any quest they wrote themselves.
   *
   * IDs are preserved, NOT renamed, mirroring DungeonsBrowse: a quest
   * id is a referenceable key (trigger tiles can carry
   * `quest: "<quest_id>"`, and saves track progress by quest id), so
   * renaming on import would break references. The import catalog
   * already filters out ids present in the resolved view; collisions
   * across two libraries exposing the same id are skipped, not
   * renamed.
   *
   * Library quests may reference encounters / items / maps / dungeons
   * the importing module doesn't have — that's deliberate (location
   * fields are often left blank in libraries for the host author to
   * fill in). The quest editor's pickers surface unresolved ids so
   * they're easy to spot after import.
   */
  const onImportQuests = (records: QuestRecord[]) => {
    if (state.kind !== "ok") return;
    const existing = new Set(state.quests.map((q) => q.id));
    const toAdd: QuestRecord[] = [];
    for (const rec of records) {
      if (!rec.id || existing.has(rec.id)) continue;
      const clone: QuestRecord = JSON.parse(JSON.stringify(rec));
      toAdd.push(clone);
      existing.add(clone.id);
    }
    if (toAdd.length === 0) return;
    persist([...state.quests, ...toAdd]);
  };

  const onDeleteQuest = (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        deleteRecordConfirmMessage({
          kind: "quest",
          name: id,
          fileName: FILE_NAME,
          detail: "This deletes the whole quest, including its steps.",
        }),
      )
    )
      return;
    persist(state.quests.filter((q) => q.id !== id));
  };

  const onUpdateQuest = (id: string, patch: Partial<QuestRecord>) => {
    if (state.kind !== "ok") return;
    persist(
      state.quests.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  };

  const onAddStep = (questId: string) => {
    if (state.kind !== "ok") return;
    const parent = state.quests.find((q) => q.id === questId);
    if (!parent) return;
    const nextIdx = (parent.steps?.length ?? 0) + 1;
    const newStep: QuestStep = {
      id: `${questId}_step_${nextIdx}`,
      name: `Step ${nextIdx}`,
      kind: "kill",
    };
    onUpdateQuest(questId, { steps: [...(parent.steps ?? []), newStep] });
  };

  const onUpdateStep = (
    questId: string,
    stepIdx: number,
    patch: Partial<QuestStep>,
  ) => {
    if (state.kind !== "ok") return;
    const parent = state.quests.find((q) => q.id === questId);
    if (!parent) return;
    const newSteps = (parent.steps ?? []).map((s, i) =>
      i === stepIdx ? { ...s, ...patch } : s,
    );
    onUpdateQuest(questId, { steps: newSteps });
  };

  const onDeleteStep = (questId: string, stepIdx: number) => {
    if (state.kind !== "ok") return;
    const parent = state.quests.find((q) => q.id === questId);
    if (!parent) return;
    const target = parent.steps?.[stepIdx];
    if (
      target &&
      typeof window !== "undefined" &&
      !window.confirm(
        deleteRecordConfirmMessage({
          kind: "step",
          name: `${target.name} (${target.id})`,
          fileName: FILE_NAME,
          detail: `This removes the step from quest "${questId}".`,
        }),
      )
    )
      return;
    const newSteps = (parent.steps ?? []).filter((_, i) => i !== stepIdx);
    onUpdateQuest(questId, { steps: newSteps });
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

  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/80">Loading quests…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load quests.</p>
        <p className="mt-2 font-mono text-sm text-parchment/80">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.quests.map((q) => q.id));
  const canExport = state.ownFile !== null;

  // Library quests available to import, with ids already present in
  // the resolved view filtered out (an imported quest no longer needs
  // an import button). Empty libraries drop out.
  const availableCatalog = state.catalog
    .map((entry) => ({
      libraryId: entry.libraryId,
      records: (entry.records as unknown as QuestRecord[]).filter(
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
          <h1 className="font-display text-3xl text-parchment">Quests</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/80">
            <span>
              {state.quests.length} quest
              {state.quests.length === 1 ? "" : "s"}
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
              + New Quest
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
          <NewQuestForm
            existingIds={existingIds}
            existingTags={allTags}
            onCreate={onCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        {[...groupedByTag.entries()].map(([tag, quests]) => (
          <section key={tag}>
            <h2 className="mb-2 text-[13px] uppercase tracking-wide text-parchment/65">
              {tag}
              <span className="ml-2 text-parchment/55 normal-case tracking-normal">
                ({quests.length})
              </span>
            </h2>
            <ul className="space-y-2">
              {quests.map((q) => (
                <li
                  key={`${tag}::${q.id}`}
                  className="overflow-hidden rounded border border-parchment/10 bg-ink/20"
                >
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(q.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-parchment hover:text-parchment/100"
                    >
                      <span className="text-parchment/75">
                        {expanded.has(q.id) ? "▾" : "▸"}
                      </span>
                      <span className="font-display">{q.name}</span>
                      <span className="font-mono text-[13px] text-parchment/65">
                        {q.id}
                      </span>
                      <span className="text-[13px] text-parchment/65">
                        · {q.steps?.length ?? 0} step
                        {(q.steps?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                      {Array.isArray(q.tags) && q.tags.length > 1 ? (
                        <span className="text-[13px] text-parchment/60">
                          · also: {q.tags.filter((t) => t !== tag).join(", ")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteQuest(q.id)}
                      className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                      title="Delete this quest."
                    >
                      Delete
                    </button>
                  </div>
                  {expanded.has(q.id) ? (
                    <QuestEditor
                      quest={q}
                      items={state.items}
                      maps={state.maps}
                      dungeons={state.dungeons}
                      encounters={state.encounters}
                      existingTags={allTags}
                      onUpdate={(patch) => onUpdateQuest(q.id, patch)}
                      onAddStep={() => onAddStep(q.id)}
                      onUpdateStep={(idx, patch) =>
                        onUpdateStep(q.id, idx, patch)
                      }
                      onDeleteStep={(idx) => onDeleteStep(q.id, idx)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {state.quests.length === 0 ? (
          <p className="text-sm text-parchment/75">
            No quests yet. Click <strong>+ New Quest</strong> to create one.
          </p>
        ) : null}
      </div>

      {/* Available from libraries (uses) — explicit import, not
          auto-merged. Each quest is a self-contained record (steps are
          inline), so the granularity is per-quest, with a per-library
          "Import all" for convenience. Ids are preserved so trigger
          tiles / saves that reference a quest by id keep resolving. */}
      {availableCatalog.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 text-[13px] uppercase tracking-wide text-parchment/65">
            Available from libraries
            <span className="ml-2 normal-case tracking-normal text-parchment/55">
              ({availableCatalog.reduce((n, e) => n + e.records.length, 0)}{" "}
              quest
              {availableCatalog.reduce((n, e) => n + e.records.length, 0) === 1
                ? ""
                : "s"}{" "}
              ready to import)
            </span>
          </h2>
          <p className="mb-3 text-[13px] text-parchment/65">
            Quests from libraries this module uses. Importing copies a
            quest into this module&apos;s own file (id preserved) — edit
            it freely afterward without affecting the library. Library
            quests often leave location fields (map, dungeon, positions)
            blank for you to fill in after import.
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
                      onClick={() => onImportQuests(entry.records)}
                      className="shrink-0 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/50"
                      title={`Import all ${entry.records.length} quests from ${entry.libraryId}.`}
                    >
                      + Import all ({entry.records.length})
                    </button>
                  ) : null}
                </div>
                <ul className="divide-y divide-parchment/5">
                  {entry.records.map((q) => (
                    <li
                      key={`${entry.libraryId}::${q.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 text-sm text-parchment/85">
                        <div className="truncate">
                          <span className="font-display">{q.name}</span>
                          <span className="ml-2 font-mono text-[13px] text-parchment/65">
                            {q.id}
                          </span>
                          <span className="ml-2 text-[13px] text-parchment/60">
                            {q.steps?.length ?? 0} step
                            {(q.steps?.length ?? 0) === 1 ? "" : "s"}
                          </span>
                          {q.quest_giver?.npc_name ? (
                            <span className="ml-2 text-[13px] text-parchment/60">
                              · giver: {q.quest_giver.npc_name}
                            </span>
                          ) : null}
                          {Array.isArray(q.tags) && q.tags.length > 0 ? (
                            <span className="ml-2 text-[13px] text-parchment/60">
                              · {q.tags.join(", ")}
                            </span>
                          ) : null}
                        </div>
                        {q.description ? (
                          <p className="mt-0.5 truncate text-[13px] text-parchment/70">
                            {q.description}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onImportQuests([q])}
                        className="shrink-0 rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/40"
                        title={`Import just this quest from ${entry.libraryId}.`}
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

// ── Inline editor for a single quest (metadata + steps list) ────────

function QuestEditor({
  quest,
  items,
  maps,
  dungeons,
  encounters,
  existingTags,
  onUpdate,
  onAddStep,
  onUpdateStep,
  onDeleteStep,
}: {
  quest: QuestRecord;
  items: ItemSummary[];
  maps: MapSummary[];
  dungeons: DungeonSummary[];
  encounters: EncounterPickerEntry[];
  existingTags: string[];
  onUpdate: (patch: Partial<QuestRecord>) => void;
  onAddStep: () => void;
  onUpdateStep: (idx: number, patch: Partial<QuestStep>) => void;
  onDeleteStep: (idx: number) => void;
}) {
  return (
    <div className="border-t border-parchment/10 bg-ink/10 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Name
          </span>
          <input
            type="text"
            value={quest.name}
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
            value={quest.description ?? ""}
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
          tags={quest.tags ?? []}
          existing={existingTags}
          onChange={(tags) => onUpdate({ tags })}
        />
      </div>

      <QuestGiverEditor
        giver={quest.quest_giver}
        onUpdate={(giver) => onUpdate({ quest_giver: giver })}
      />

      <RewardsEditor
        rewards={quest.rewards}
        items={items}
        maps={maps}
        onUpdate={(rewards) => onUpdate({ rewards })}
      />

      <h3 className="mt-4 text-[13px] uppercase tracking-wide text-parchment/75">
        Steps ({quest.steps?.length ?? 0})
      </h3>
      {(quest.steps ?? []).length === 0 ? (
        <p className="mt-1 text-[13px] text-parchment/65">
          No steps yet. Click <strong>+ Add Step</strong> below.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(quest.steps ?? []).map((s, i) => (
            <StepRow
              key={`${s.id}-${i}`}
              step={s}
              existingTags={existingTags}
              indexLabel={i + 1}
              maps={maps}
              items={items}
              dungeons={dungeons}
              encounters={encounters}
              onUpdate={(patch) => onUpdateStep(i, patch)}
              onDelete={() => onDeleteStep(i)}
            />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={onAddStep}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-1 text-[13px] text-parchment hover:bg-ember/40"
        >
          + Add Step
        </button>
      </div>
    </div>
  );
}

// ── Quest Giver editor ──────────────────────────────────────────────

const EMPTY_GIVER: QuestGiver = {
  npc_name: "",
  npc_sprite: "",
  start_dialog: "",
  end_dialog: "",
};

function QuestGiverEditor({
  giver,
  onUpdate,
}: {
  giver: QuestGiver | undefined;
  onUpdate: (giver: QuestGiver | undefined) => void;
}) {
  const has = giver !== undefined;
  const g = giver ?? EMPTY_GIVER;
  return (
    <section className="mt-4 rounded border border-parchment/10 bg-ink/30 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">
          Quest Giver
        </h3>
        {has ? (
          <button
            type="button"
            onClick={() => onUpdate(undefined)}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
            title="Remove the quest_giver block from this quest."
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUpdate({ ...EMPTY_GIVER })}
            className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
          >
            + Add
          </button>
        )}
      </div>
      {has ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              NPC name
            </span>
            <input
              type="text"
              value={g.npc_name}
              onChange={(e) =>
                onUpdate({ ...g, npc_name: e.target.value })
              }
              placeholder="Old Hermit"
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            />
          </label>
          <div className="block">
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              NPC sprite
            </span>
            <div className="mt-0.5">
              <SpritePicker
                value={g.npc_sprite}
                config={NPC_SPRITE_CONFIG}
                onChange={(v) => onUpdate({ ...g, npc_sprite: v })}
              />
            </div>
          </div>
          <label className="block sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              Start dialog
            </span>
            <textarea
              value={g.start_dialog}
              onChange={(e) =>
                onUpdate({ ...g, start_dialog: e.target.value })
              }
              rows={2}
              placeholder="Greetings, traveler…"
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              End dialog
            </span>
            <textarea
              value={g.end_dialog}
              onChange={(e) =>
                onUpdate({ ...g, end_dialog: e.target.value })
              }
              rows={2}
              placeholder="You did it! Take this for your trouble."
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              Post-quest dialog (optional)
            </span>
            <textarea
              value={g.post_dialog ?? ""}
              onChange={(e) =>
                onUpdate({ ...g, post_dialog: e.target.value })
              }
              rows={2}
              placeholder="Good to see you again, friend. (Shown after turn-in — the giver becomes a normal NPC.)"
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
            />
          </label>
        </div>
      ) : (
        <p className="mt-1 text-xs text-parchment/65">
          No quest giver. Click <strong>+ Add</strong> to specify the NPC
          who offers and accepts this quest.
        </p>
      )}
    </section>
  );
}

// ── Rewards editor ──────────────────────────────────────────────────

const EMPTY_REWARDS: Rewards = {};

function RewardsEditor({
  rewards,
  items,
  maps,
  onUpdate,
}: {
  rewards: Rewards | undefined;
  items: ItemSummary[];
  maps: MapSummary[];
  onUpdate: (rewards: Rewards | undefined) => void;
}) {
  const has = rewards !== undefined;
  const r = rewards ?? EMPTY_REWARDS;

  const patch = (p: Partial<Rewards>) => {
    const next: Rewards = { ...r, ...p };
    // Drop empty / undefined keys so the persisted JSON stays clean.
    for (const k of Object.keys(next) as Array<keyof Rewards>) {
      const v = next[k];
      if (v === undefined) delete next[k];
      if (Array.isArray(v) && v.length === 0) delete next[k];
      if ((k === "xp" || k === "gold") && typeof v === "number" && v === 0) {
        // Zero is a legit value; leave it alone. (Earlier rule was
        // too aggressive — keep zeros.)
      }
    }
    onUpdate(next);
  };

  return (
    <section className="mt-3 rounded border border-parchment/10 bg-ink/30 p-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] uppercase tracking-wide text-parchment/75">
          Rewards
        </h3>
        {has ? (
          <button
            type="button"
            onClick={() => onUpdate(undefined)}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
            title="Remove the rewards block from this quest."
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUpdate({})}
            className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
          >
            + Add
          </button>
        )}
      </div>
      {has ? (
        <div className="mt-2 space-y-3">
          {/* XP + Gold */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                XP
              </span>
              <input
                type="number"
                value={r.xp ?? ""}
                placeholder="0"
                onChange={(e) =>
                  patch({
                    xp:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value) || 0,
                  })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                Gold
              </span>
              <input
                type="number"
                value={r.gold ?? ""}
                placeholder="0"
                onChange={(e) =>
                  patch({
                    gold:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value) || 0,
                  })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
              />
            </label>
          </div>

          {/* Items */}
          <ItemsList
            items={r.items ?? []}
            catalog={items}
            onChange={(arr) => patch({ items: arr })}
          />

          {/* tile_add — the only tile-mutation reward. Always
              specifies a target tile_id; "removing" a tile is just
              painting the replacement tile here. */}
          <TileOpsList
            label="Tile changes"
            ops={r.tile_add ?? []}
            maps={maps}
            withTileId={true}
            onChange={(arr) => patch({ tile_add: arr as TileAddOp[] })}
          />
        </div>
      ) : (
        <p className="mt-1 text-xs text-parchment/65">
          No rewards. Click <strong>+ Add</strong> to specify XP, gold,
          items, or tile changes applied on completion.
        </p>
      )}
    </section>
  );
}

// ── Step-level rewards editor ───────────────────────────────────────
//
// Mirrors {@link RewardsEditor} but for a single QuestStep. The
// step-level envelope is a strict subset — only items + tile_add —
// because XP and gold stay on the quest-level rewards so the bigger
// numerical payoff still lands at turn-in. Authors use this to gate
// the next step on a map change (a bridge appears, a passage opens)
// or seed inventory the next step needs (here's the key for the door
// you're about to find).

const EMPTY_STEP_REWARDS: StepRewards = {};

function StepRewardsEditor({
  rewards,
  items,
  maps,
  onUpdate,
}: {
  rewards: StepRewards | undefined;
  items: ItemSummary[];
  maps: MapSummary[];
  onUpdate: (rewards: StepRewards | undefined) => void;
}) {
  const has = rewards !== undefined;
  const r = rewards ?? EMPTY_STEP_REWARDS;

  // Drop empty / undefined keys so the persisted JSON stays clean —
  // a step that authors no rewards round-trips as an absent `rewards`
  // field rather than `{ items: [], tile_add: [] }`.
  const patch = (p: Partial<StepRewards>) => {
    const next: StepRewards = { ...r, ...p };
    for (const k of Object.keys(next) as Array<keyof StepRewards>) {
      const v = next[k];
      if (v === undefined) delete next[k];
      if (Array.isArray(v) && v.length === 0) delete next[k];
    }
    onUpdate(next);
  };

  return (
    <fieldset className="sm:col-span-4 rounded border border-parchment/15 bg-ink/20 p-2">
      <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
        Step Rewards
      </legend>
      <div className="flex items-center justify-between">
        <p className="text-xs text-parchment/75">
          Items and tile changes applied <strong>immediately</strong>{" "}
          when this step completes — use to gate the next step on a
          map change (build a bridge, open a passage) or seed inventory
          the next step needs.
        </p>
        {has ? (
          <button
            type="button"
            onClick={() => onUpdate(undefined)}
            className="ml-2 shrink-0 rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
            title="Remove the rewards block from this step."
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onUpdate({})}
            className="ml-2 shrink-0 rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
          >
            + Add
          </button>
        )}
      </div>
      {has ? (
        <div className="mt-2 space-y-3">
          {/* Items dropped into the party's inventory on step
              completion. Reuses the quest-level ItemsList component
              so add / remove / pick-from-catalog behavior stays
              consistent across the two scopes. */}
          <ItemsList
            items={r.items ?? []}
            catalog={items}
            onChange={(arr) => patch({ items: arr })}
          />
          {/* tile_add — paint a palette tile at (map, col, row) on
              completion. Same component the quest-level rewards use;
              `withTileId` is always true because the only step
              tile-mutation reward is a full paint. */}
          <TileOpsList
            label="Tile changes"
            ops={r.tile_add ?? []}
            maps={maps}
            withTileId={true}
            onChange={(arr) => patch({ tile_add: arr as TileAddOp[] })}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

// ── Encounter positions list (kill steps) ───────────────────────────
//
// Authored anchor cells for a kill step's spawn pass. Each row is a
// (col, row) pair on the step's map; the runtime consumes them in
// order — `positions[0]` for the first copy, `positions[1]` for the
// second, etc. Copies beyond `positions.length` (or whose authored
// cell isn't walkable at spawn time) fall back to random placement,
// so a partial list is a valid mix of authored + random copies.
//
// The component shows a hint when `positions.length` doesn't match
// `count` so the author notices a half-authored placement before
// shipping the quest.

function PositionsList({
  positions,
  count,
  onChange,
}: {
  positions: Array<{ col: number; row: number }>;
  count: number;
  onChange: (next: Array<{ col: number; row: number }>) => void;
}) {
  const updateAt = (
    idx: number,
    patch: Partial<{ col: number; row: number }>,
  ) => {
    const next = positions.map((p) => ({ ...p }));
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeAt = (idx: number) => {
    const next = positions.map((p) => ({ ...p }));
    next.splice(idx, 1);
    onChange(next);
  };
  const add = () => {
    onChange([...positions, { col: 0, row: 0 }]);
  };
  // Help the author notice when authored count drifts from `count`.
  // Over-authored (more positions than copies) silently truncates at
  // spawn; under-authored copies fall back to random placement.
  const drift =
    positions.length === 0
      ? null
      : positions.length < count
        ? `${count - positions.length} of ${count} copies will fall back to random placement.`
        : positions.length > count
          ? `${positions.length - count} extra position${positions.length - count === 1 ? "" : "s"} will be ignored (count is ${count}).`
          : null;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-parchment/75">
          Encounter positions ({positions.length})
        </span>
        <button
          type="button"
          onClick={add}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
        >
          + Add position
        </button>
      </div>
      {positions.length === 0 ? (
        <p className="mt-1 text-xs text-parchment/65">
          No positions authored. Encounter copies spawn on random
          walkable cells (historical behaviour).
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {positions.map((p, i) => (
            <li
              key={i}
              className="grid items-center gap-1 sm:grid-cols-[auto_5rem_5rem_1fr_auto]"
            >
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                #{i + 1}
              </span>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Col
                </span>
                <input
                  type="number"
                  min={0}
                  value={p.col}
                  onChange={(e) =>
                    updateAt(i, {
                      col: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Row
                </span>
                <input
                  type="number"
                  min={0}
                  value={p.row}
                  onChange={(e) =>
                    updateAt(i, {
                      row: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
              <span aria-hidden />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="self-end rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {drift ? (
        <p className="mt-1 text-xs text-amber-200/85">{drift}</p>
      ) : null}
    </div>
  );
}

// ── Items reward list ───────────────────────────────────────────────

function ItemsList({
  items,
  catalog,
  onChange,
}: {
  items: string[];
  catalog: ItemSummary[];
  onChange: (next: string[]) => void;
}) {
  const updateAt = (idx: number, id: string) => {
    const next = items.slice();
    next[idx] = id;
    onChange(next);
  };
  const removeAt = (idx: number) => {
    const next = items.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const add = () => {
    onChange([...items, catalog[0]?.id ?? ""]);
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-parchment/75">
          Items ({items.length})
        </span>
        <button
          type="button"
          onClick={add}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
        >
          + Add item
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-parchment/65">
          (no item rewards)
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((id, i) => {
            const known = catalog.some((c) => c.id === id);
            return (
              <li key={i} className="flex items-center gap-2">
                <select
                  value={id}
                  onChange={(e) => updateAt(i, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                >
                  {!known && id ? (
                    <option value={id}>(missing) {id}</option>
                  ) : null}
                  {!id ? (
                    <option value="">— choose an item —</option>
                  ) : null}
                  {groupItemsByCategory(catalog).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name ?? c.id} ({c.id})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Tile-ops list (used by the tile_add rewards section) ────────────
// The component carries a `withTileId` flag for future tile-op kinds
// that might omit the replacement id, but today the only caller passes
// `withTileId={true}` — tile_add is the sole tile-mutation reward.

function TileOpsList({
  label,
  ops,
  maps,
  withTileId,
  onChange,
}: {
  label: string;
  ops: Array<TileOp | TileAddOp>;
  maps: MapSummary[];
  withTileId: boolean;
  onChange: (next: Array<TileOp | TileAddOp>) => void;
}) {
  const updateAt = (
    idx: number,
    patch: Partial<TileAddOp>,
  ) => {
    const next = ops.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeAt = (idx: number) => {
    const next = ops.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const add = () => {
    const base: TileOp = { map: maps[0]?.id ?? "", col: 0, row: 0 };
    if (withTileId) onChange([...ops, { ...base, tile_id: "" }]);
    else onChange([...ops, base]);
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-parchment/75">
          {label} ({ops.length})
        </span>
        <button
          type="button"
          onClick={add}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-0.5 text-xs text-parchment hover:bg-ember/40"
        >
          + Add
        </button>
      </div>
      {ops.length === 0 ? (
        <p className="mt-1 text-xs text-parchment/65">(none)</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {ops.map((op, i) => {
            const mapKnown = maps.some((m) => m.id === op.map);
            const asAdd = op as TileAddOp;
            return (
              <li
                key={i}
                className={`grid items-center gap-1 ${
                  withTileId
                    ? "sm:grid-cols-[1fr_auto_auto_1fr_auto]"
                    : "sm:grid-cols-[1fr_auto_auto_auto]"
                }`}
              >
                <select
                  value={op.map}
                  onChange={(e) => updateAt(i, { map: e.target.value })}
                  className="rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                >
                  {!mapKnown && op.map ? (
                    <option value={op.map}>(missing) {op.map}</option>
                  ) : null}
                  {!op.map ? (
                    <option value="">— choose a map —</option>
                  ) : null}
                  {/* Grouped by tag (pinned order: overview, town,
                      buildings, outside, then alphabetical, untagged
                      last) — same shape as the maps browse tree and the
                      Map Editor's Link picker. */}
                  {groupByTags(maps).map(([tag, ms]) => (
                    <optgroup key={tag} label={tag}>
                      {ms.map((m) => (
                        <option key={`${tag}::${m.id}`} value={m.id}>
                          {m.name ?? m.id} ({m.id})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  type="number"
                  value={op.col}
                  onChange={(e) =>
                    updateAt(i, { col: Number(e.target.value) || 0 })
                  }
                  placeholder="col"
                  className="w-16 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
                  title="col"
                />
                <input
                  type="number"
                  value={op.row}
                  onChange={(e) =>
                    updateAt(i, { row: Number(e.target.value) || 0 })
                  }
                  placeholder="row"
                  className="w-16 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
                  title="row"
                />
                {withTileId ? (
                  <input
                    type="text"
                    value={asAdd.tile_id ?? ""}
                    onChange={(e) =>
                      updateAt(i, { tile_id: e.target.value })
                    }
                    placeholder="tile_id"
                    className="min-w-0 rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                    title="The Map Tile id placed at this cell."
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Single step row ─────────────────────────────────────────────────

function StepRow({
  step,
  existingTags,
  indexLabel,
  maps,
  items,
  dungeons,
  encounters,
  onUpdate,
  onDelete,
}: {
  step: QuestStep;
  existingTags: string[];
  indexLabel: number;
  maps: MapSummary[];
  items: ItemSummary[];
  dungeons: DungeonSummary[];
  encounters: EncounterPickerEntry[];
  onUpdate: (patch: Partial<QuestStep>) => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded border border-parchment/10 bg-ink/30 p-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            #{indexLabel} · ID
          </span>
          <input
            type="text"
            value={step.id}
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
            value={step.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Kind
          </span>
          <select
            value={step.kind}
            onChange={(e) => onUpdate({ kind: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
          >
            {KNOWN_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            {/* Legacy data with `kind` set to a no-longer-supported
                value (visit / fetch / talk) renders its current value
                as a disabled option so the author SEES the deprecated
                kind on the row, but the only re-selectable choice is
                `kill`. Once they pick `kill` the legacy value drops
                from the dropdown entirely. */}
            {!KNOWN_KINDS.includes(step.kind as (typeof KNOWN_KINDS)[number]) &&
            step.kind ? (
              <option value={step.kind} disabled>
                {step.kind} (deprecated)
              </option>
            ) : null}
          </select>
        </label>
        <label className="block sm:col-span-4">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Description
          </span>
          <input
            type="text"
            value={step.description ?? ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
          />
        </label>
        <div className="block sm:col-span-2">
          <span className="text-xs uppercase tracking-wide text-parchment/65">
            Tags
          </span>
          <TagsPicker
            tags={step.tags ?? []}
            existing={existingTags}
            onChange={(tags) => onUpdate({ tags })}
          />
        </div>
        {step.kind === "kill" ? (
          // Kill steps: encounter picker + count input. Both write to
          // top-level step fields (`encounter_id`, `count`) — the
          // legacy `params: { encounter_id, count }` blob was removed
          // in favour of first-class per-step attributes. Future step
          // kinds will get their own dedicated fields the same way.
          <fieldset className="sm:col-span-2 rounded border border-parchment/15 bg-ink/20 p-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
              Kill target
            </legend>
            <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
              <div>
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Encounter
                </span>
                <EncounterPicker
                  value={step.encounter_id ?? ""}
                  encounters={encounters}
                  onChange={(id) =>
                    onUpdate({ encounter_id: id || undefined })
                  }
                />
              </div>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Count
                </span>
                <input
                  type="number"
                  min={1}
                  value={
                    typeof step.count === "number" ? step.count : 1
                  }
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value) || 1);
                    onUpdate({ count: n });
                  }}
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-parchment/65">
              The party clears the kill step by defeating this encounter
              the listed number of times. Pick a roster from the
              encounter catalog — each row shows the lead monster's
              sprite and the encounter's tier.
            </p>
            {/* Authored anchor cells on the step's map. The runtime
                spawn pass consumes positions[0..count-1] in order
                when each position is walkable; copies beyond
                positions.length (or whose authored cell isn't
                walkable at spawn time) fall back to random. Leave
                empty for pure random placement (historical
                behavior). */}
            <PositionsList
              positions={step.positions ?? []}
              count={
                typeof step.count === "number" ? step.count : 1
              }
              onChange={(arr) =>
                onUpdate({ positions: arr.length === 0 ? undefined : arr })
              }
            />
          </fieldset>
        ) : step.kind === "retrieve" ? (
          // Retrieve steps: item picker + (col, row) on the step's
          // map. The runtime stamps `item_id` onto `grid[row][col].item`
          // at quest-accept time so the item appears on the map with
          // a quest glow; walking onto the cell credits the step and
          // adds the item to the party's inventory. Use the Location
          // block above to pick the map; this fieldset handles only
          // the item + cell coords.
          <fieldset className="sm:col-span-2 rounded border border-parchment/15 bg-ink/20 p-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
              Retrieve target
            </legend>
            <div className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem]">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Item
                </span>
                <select
                  value={step.item_id ?? ""}
                  onChange={(e) =>
                    onUpdate({ item_id: e.target.value || undefined })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                >
                  <option value="">(pick one…)</option>
                  {!items.some((it) => it.id === step.item_id) &&
                  step.item_id ? (
                    <option value={step.item_id}>
                      (missing) {step.item_id}
                    </option>
                  ) : null}
                  {groupItemsByCategory(items).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name ?? it.id} ({it.id})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Col
                </span>
                <input
                  type="number"
                  min={0}
                  value={typeof step.col === "number" ? step.col : 0}
                  onChange={(e) =>
                    onUpdate({ col: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Row
                </span>
                <input
                  type="number"
                  min={0}
                  value={typeof step.row === "number" ? step.row : 0}
                  onChange={(e) =>
                    onUpdate({ row: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-parchment/65">
              When the quest is accepted, this item is placed at
              (col, row) on the step's <strong>Map</strong> (set in
              the Location block below) and glows with the
              quest-relevance halo. The step credits when the party
              walks onto the cell — the item moves to inventory and
              the cell clears.
            </p>
          </fieldset>
        ) : step.kind === "reach" ? (
          // Reach (spelunking): pick the dungeon and leave the level
          // implicit. At load time the runtime fans this single step
          // out into one reach step per floor of the chosen dungeon,
          // each credited just by arriving on that floor. No
          // encounter, no item, no cell — the descent is the
          // objective.
          <fieldset className="sm:col-span-2 rounded border border-parchment/15 bg-ink/20 p-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
              Spelunking dungeon
            </legend>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                Dungeon
              </span>
              <select
                value={step.dungeon_id ?? ""}
                onChange={(e) =>
                  onUpdate({ dungeon_id: e.target.value || undefined })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
              >
                <option value="">(pick one…)</option>
                {!dungeons.some((d) => d.id === step.dungeon_id) &&
                step.dungeon_id ? (
                  <option value={step.dungeon_id}>
                    (missing) {step.dungeon_id}
                  </option>
                ) : null}
                {dungeons.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name ?? d.id}
                    {typeof d.floors === "number"
                      ? ` — ${d.floors} floor${d.floors === 1 ? "" : "s"}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-xs text-parchment/65">
              This one step expands at play time into a step for each
              floor of the chosen dungeon — the party credits each by
              reaching it. Leave the rest of the step (and the Location
              block) untouched; the dungeon picker is all this kind
              needs.
            </p>
          </fieldset>
        ) : step.kind === "discover" ? (
          // Discover: the party stands on (col, row) of the step's Map
          // and the quest completes in place — rewards granted on the
          // spot, no return to the giver. No item, no encounter; the
          // destination itself is the objective.
          <fieldset className="sm:col-span-2 rounded border border-parchment/15 bg-ink/20 p-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
              Discover target
            </legend>
            <div className="grid gap-2 sm:grid-cols-[5rem_5rem]">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Col
                </span>
                <input
                  type="number"
                  min={0}
                  value={typeof step.col === "number" ? step.col : 0}
                  onChange={(e) =>
                    onUpdate({ col: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Row
                </span>
                <input
                  type="number"
                  min={0}
                  value={typeof step.row === "number" ? step.row : 0}
                  onChange={(e) =>
                    onUpdate({ row: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-parchment/65">
              The step credits when the party walks onto this cell on
              the step's <strong>Map</strong> (set in the Location block
              below). When this completes the quest, rewards are granted
              on the spot — no need to return to the quest giver. The
              tile shows no marker, so the party discovers it by
              exploring.
            </p>
          </fieldset>
        ) : (
          // A step whose `kind` is something other than the supported
          // set (legacy `visit` / `fetch` / `talk` data carried over
          // from before the cleanup). The dropdown shows the value
          // as disabled and there's no editor surface for these — the
          // author needs to switch the kind to a supported value to
          // make the step actionable.
          <p className="sm:col-span-2 rounded border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-200/85">
            This step's <code>kind</code> is no longer supported by the
            editor. Set <strong>Kind</strong> to <code>kill</code> or{" "}
            <code>retrieve</code> (above) to author this step against
            the current data model.
          </p>
        )}

        {/* Location picker — kind dropdown + a map picker that renders
            when the kind is "map". Setting kind back to "(none)"
            clears `map_id` so the JSON doesn't carry a dead reference
            the runtime would have to ignore. */}
        <fieldset className="sm:col-span-4 rounded border border-parchment/15 bg-ink/20 p-2">
          <legend className="px-1 text-xs uppercase tracking-wide text-parchment/75">
            Location
          </legend>
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-parchment/65">
                Kind
              </span>
              <select
                value={step.location_kind ?? ""}
                onChange={(e) => {
                  const next = e.target.value as "" | "map";
                  if (next === "") {
                    onUpdate({
                      location_kind: undefined,
                      map_id: undefined,
                    });
                  } else {
                    onUpdate({ location_kind: "map" });
                  }
                }}
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90"
              >
                <option value="">(none)</option>
                <option value="map">Map</option>
              </select>
            </label>

            {step.location_kind === "map" ? (
              <label className="block sm:col-span-3">
                <span className="text-xs uppercase tracking-wide text-parchment/65">
                  Map
                </span>
                <select
                  value={step.map_id ?? ""}
                  onChange={(e) =>
                    onUpdate({ map_id: e.target.value || undefined })
                  }
                  className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-[13px] text-parchment/90"
                >
                  <option value="">(pick one…)</option>
                  {/* Grouped by tag — same ordering as the maps browse
                      tree and the Map Editor's Link picker. */}
                  {groupByTags(maps).map(([tag, ms]) => (
                    <optgroup key={tag} label={tag}>
                      {ms.map((m) => (
                        <option key={`${tag}::${m.id}`} value={m.id}>
                          {m.name ?? m.id}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {step.map_id &&
                !maps.some((m) => m.id === step.map_id) ? (
                  <p className="mt-1 text-[13px] text-ember/80">
                    Unknown map id — not present in maps.json.
                  </p>
                ) : null}
              </label>
            ) : null}
          </div>
        </fieldset>

        {/* Per-step rewards — items granted + tile mutations applied
            immediately on completion. Distinct from the quest-level
            Rewards block above the steps list: those land at turn-in,
            these land the moment THIS step completes so the next
            step can depend on a map change or an item drop. */}
        <StepRewardsEditor
          rewards={step.rewards}
          items={items}
          maps={maps}
          onUpdate={(rewards) => onUpdate({ rewards })}
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/80 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
        >
          Delete step
        </button>
      </div>
    </li>
  );
}

// ── New Quest form ──────────────────────────────────────────────────

function NewQuestForm({
  existingIds,
  existingTags,
  onCreate,
  onCancel,
}: {
  existingIds: Set<string>;
  existingTags: string[];
  onCreate: (rec: QuestRecord) => void;
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
          ? `A quest with id "${trimmedId}" already exists.`
          : null;
  const canSubmit =
    trimmedId.length > 0 && !idError && name.trim().length > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const rec: QuestRecord = {
      id: trimmedId,
      name: name.trim(),
      description: description.trim(),
      tags,
      steps: [],
    };
    onCreate(rec);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-parchment/15 bg-ink/30 p-4"
    >
      <h2 className="font-display text-lg text-parchment">New Quest</h2>
      <p className="mt-1 text-sm text-parchment/75">
        Create the quest record first. Add steps inline after it opens.
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
            placeholder="the_lost_amulet"
            className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-sm text-parchment/90"
          />
          {idError ? (
            <p className="mt-1 text-[13px] text-ember/80">{idError}</p>
          ) : (
            <p className="mt-1 text-[13px] text-parchment/65">
              Key in <code>quests.json</code>.
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
            placeholder="The Lost Amulet"
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
            placeholder="An old hermit asks the party to retrieve a family heirloom…"
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
