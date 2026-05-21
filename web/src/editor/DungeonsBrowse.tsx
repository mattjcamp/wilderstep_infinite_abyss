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

import { useEffect, useMemo, useState } from "react";
import {
  discardDraft,
  downloadJson,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { publishItems } from "@/data_model/publishClient";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { SoundtrackPicker } from "./SoundtrackPicker";
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";

const MODEL_KEY = "dungeons";
const FILE_NAME = "dungeons.json";
const UNTAGGED = "(untagged)";

/** Closed style enum — the procedural generator's supported themes.
 *  Add new values here when the generator grows. */
const STYLES = ["caves", "ruins", "forest"] as const;
type Style = (typeof STYLES)[number];

/** Same difficulty enum the Monster model uses. */
const DIFFICULTIES = ["easy", "normal", "hard", "deadly", "boss"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface DungeonSize {
  width: number;
  height: number;
}

interface DungeonLevel {
  id: string;
  name: string;
  tags?: string[];
  depth: number;
  // Overrides — undefined means "inherit from parent Dungeon".
  style?: Style | string;
  difficulty?: Difficulty | string;
  size?: DungeonSize;
  torch_density?: number;
  locked_doors?: number;
}

interface DungeonRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  // Generator defaults — required on Dungeon.
  style: Style | string;
  difficulty: Difficulty | string;
  size: DungeonSize;
  torch_density: number;
  locked_doors: number;
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
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

/** Default values used for a freshly-created Dungeon. Authors can
 *  tweak post-create; these are deliberately middle-of-the-road. */
const DEFAULTS = {
  style: "caves" as Style,
  difficulty: "normal" as Difficulty,
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
      const layers = await src.loadModelLayers(moduleId, "dungeons");
      const draft = loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ?? (layers.ownFile as Record<string, unknown> | null);
      const merged = mergeModel(
        "dungeons",
        layers.inherited,
        ownEffective,
      ) as { dungeons?: DungeonRecord[] } | null;
      const dungeons = merged?.dungeons ?? [];
      setState({
        kind: "ok",
        dungeons,
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
    saveDraft(moduleId, MODEL_KEY, baseFile);
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

  const onDeleteDungeon = (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete dungeon "${id}"?\n\nRemoves the whole record (including its levels). Saves to the draft until you Publish.`,
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
        `Delete level "${target.name}" (${target.id}) from dungeon "${dungeonId}"?`,
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
        "Discard all pending changes to this module's dungeons file?",
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
    return <p className="p-4 text-parchment/60">Loading dungeons…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load dungeons.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.dungeons.map((d) => d.id));
  const canExport = state.ownFile !== null;

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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/60">
            <span>
              {state.dungeons.length} dungeon
              {state.dungeons.length === 1 ? "" : "s"}
            </span>
            <span className="text-parchment/40">·</span>
            <span>{FILE_NAME}</span>
            {state.isDraft ? (
              <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
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
              className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/70 hover:bg-ink/40"
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
            <h2 className="mb-2 text-xs uppercase tracking-wide text-parchment/45">
              {tag}
              <span className="ml-2 text-parchment/35 normal-case tracking-normal">
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
                      <span className="text-parchment/55">
                        {expanded.has(d.id) ? "▾" : "▸"}
                      </span>
                      <span className="font-display">{d.name}</span>
                      <span className="font-mono text-xs text-parchment/45">
                        {d.id}
                      </span>
                      <span className="text-xs text-parchment/45">
                        · {d.levels?.length ?? 0} level
                        {(d.levels?.length ?? 0) === 1 ? "" : "s"}
                      </span>
                      <span className="text-xs text-parchment/45">
                        · {d.style} · {d.difficulty}
                      </span>
                      {Array.isArray(d.tags) && d.tags.length > 1 ? (
                        <span className="text-xs text-parchment/40">
                          · also: {d.tags.filter((t) => t !== tag).join(", ")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDungeon(d.id)}
                      className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                      title="Delete this dungeon."
                    >
                      Delete
                    </button>
                  </div>
                  {expanded.has(d.id) ? (
                    <DungeonEditor
                      dungeon={d}
                      existingTags={allTags}
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
          <p className="text-sm text-parchment/55">
            No dungeons yet. Click <strong>+ New Dungeon</strong> to create one.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Inline editor for a single dungeon (metadata + generator params + levels) ─

function DungeonEditor({
  dungeon,
  existingTags,
  onUpdate,
  onAddLevel,
  onUpdateLevel,
  onDeleteLevel,
}: {
  dungeon: DungeonRecord;
  existingTags: string[];
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
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
        <span className="mt-1 block text-[11px] text-parchment/45">
          Per-dungeon playlist override. Empty inherits the module
          default.
        </span>
      </div>

      {/* Generator defaults — required on Dungeon, inherited by Levels */}
      <h3 className="mt-4 text-xs uppercase tracking-wide text-parchment/55">
        Generator defaults
      </h3>
      <p className="text-[11px] text-parchment/45">
        These values drive procedural floor generation. Each Dungeon Level
        below can override any of them; an empty override on a Level means
        "inherit from this Dungeon."
      </p>
      <GeneratorFields
        style={dungeon.style}
        difficulty={dungeon.difficulty}
        size={dungeon.size}
        torchDensity={dungeon.torch_density}
        lockedDoors={dungeon.locked_doors}
        onStyle={(v) => onUpdate({ style: v })}
        onDifficulty={(v) => onUpdate({ difficulty: v })}
        onSize={(v) => onUpdate({ size: v })}
        onTorchDensity={(v) => onUpdate({ torch_density: v })}
        onLockedDoors={(v) => onUpdate({ locked_doors: v })}
        // Dungeon side is required — no clear/inherit affordance.
        allowInherit={false}
      />

      {/* Levels list */}
      <h3 className="mt-4 text-xs uppercase tracking-wide text-parchment/55">
        Levels ({dungeon.levels?.length ?? 0})
      </h3>
      {(dungeon.levels ?? []).length === 0 ? (
        <p className="mt-1 text-xs text-parchment/45">
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
          className="rounded border border-ember/50 bg-ember/20 px-2 py-1 text-xs text-parchment hover:bg-ember/40"
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
  onUpdate,
  onDelete,
}: {
  level: DungeonLevel;
  parent: DungeonRecord;
  existingTags: string[];
  onUpdate: (patch: Partial<DungeonLevel>) => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded border border-parchment/10 bg-ink/30 p-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
            ID
          </span>
          <input
            type="text"
            value={level.id}
            onChange={(e) => onUpdate({ id: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
            Name
          </span>
          <input
            type="text"
            value={level.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-parchment/45">
            Depth
          </span>
          <input
            type="number"
            value={level.depth}
            onChange={(e) =>
              onUpdate({ depth: Number(e.target.value) || 0 })
            }
            className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
        </label>
      </div>

      <div className="mt-2">
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
          Tags
        </span>
        <TagsPicker
          tags={level.tags ?? []}
          existing={existingTags}
          onChange={(tags) => onUpdate({ tags })}
        />
      </div>

      <div className="mt-3">
        <p className="text-[11px] text-parchment/45">
          Generator overrides — leave any field empty (or click ↩ Inherit)
          to fall back to the parent Dungeon's value (shown in light text).
        </p>
        <GeneratorFields
          style={level.style}
          difficulty={level.difficulty}
          size={level.size}
          torchDensity={level.torch_density}
          lockedDoors={level.locked_doors}
          parentStyle={parent.style}
          parentDifficulty={parent.difficulty}
          parentSize={parent.size}
          parentTorchDensity={parent.torch_density}
          parentLockedDoors={parent.locked_doors}
          onStyle={(v) => onUpdate({ style: v })}
          onDifficulty={(v) => onUpdate({ difficulty: v })}
          onSize={(v) => onUpdate({ size: v })}
          onTorchDensity={(v) => onUpdate({ torch_density: v })}
          onLockedDoors={(v) => onUpdate({ locked_doors: v })}
          allowInherit={true}
        />
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
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
  size,
  torchDensity,
  lockedDoors,
  parentStyle,
  parentDifficulty,
  parentSize,
  parentTorchDensity,
  parentLockedDoors,
  onStyle,
  onDifficulty,
  onSize,
  onTorchDensity,
  onLockedDoors,
  allowInherit,
}: {
  // Effective (own) value; may be undefined on Level rows.
  style: string | undefined;
  difficulty: string | undefined;
  size: DungeonSize | undefined;
  torchDensity: number | undefined;
  lockedDoors: number | undefined;
  // Parent values for placeholder fallback (only on Level rows).
  parentStyle?: string;
  parentDifficulty?: string;
  parentSize?: DungeonSize;
  parentTorchDensity?: number;
  parentLockedDoors?: number;
  // Callbacks — receiving `undefined` clears the override (Level only).
  onStyle: (v: string | undefined) => void;
  onDifficulty: (v: string | undefined) => void;
  onSize: (v: DungeonSize | undefined) => void;
  onTorchDensity: (v: number | undefined) => void;
  onLockedDoors: (v: number | undefined) => void;
  /** Whether the editor exposes an "inherit / clear override" affordance
   *  per field. True on Levels, false on the parent Dungeon. */
  allowInherit: boolean;
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-4">
      {/* Style */}
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
          Style
        </span>
        <div className="mt-0.5 flex items-center gap-1">
          <select
            value={style ?? ""}
            onChange={(e) =>
              onStyle(e.target.value === "" ? undefined : e.target.value)
            }
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
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
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
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

      {/* Size — width × height */}
      <div className="block sm:col-span-2">
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
            className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
          <span className="text-parchment/40">×</span>
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
            className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
          {allowInherit && size !== undefined ? (
            <InheritButton onClick={() => onSize(undefined)} />
          ) : null}
        </div>
      </div>

      {/* Torch density */}
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
          {allowInherit && torchDensity !== undefined ? (
            <InheritButton onClick={() => onTorchDensity(undefined)} />
          ) : null}
        </div>
      </label>

      {/* Locked doors */}
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-parchment/45">
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
            className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
          />
          {allowInherit && lockedDoors !== undefined ? (
            <InheritButton onClick={() => onLockedDoors(undefined)} />
          ) : null}
        </div>
      </label>
    </div>
  );
}

function InheritButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Clear this override and inherit the parent Dungeon's value."
      className="rounded border border-parchment/20 px-1.5 text-xs text-parchment/55 hover:border-parchment/40 hover:text-parchment/90"
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
      <p className="mt-1 text-sm text-parchment/55">
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
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
            <p className="mt-1 text-xs text-ember/80">{idError}</p>
          ) : (
            <p className="mt-1 text-xs text-parchment/45">
              Key in <code>dungeons.json</code>.
            </p>
          )}
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/70 hover:bg-ink/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
