"use client";

/**
 * Dungeons-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "dungeons". Mirrors
 * the MapsBrowse shape (tag-tree, draft → publish flow) but with
 * inline child-level editing instead of a navigation hop:
 *
 *   - Dungeons grouped by tag, like Maps. A dungeon with no tag falls
 *     into "(untagged)".
 *   - Each dungeon row can be expanded to edit its metadata (name,
 *     description, tags) and manage its `levels[]` array.
 *   - Dungeon Levels are inline objects under their parent's
 *     `levels[]` — there is no top-level Dungeon Level catalog. Add /
 *     edit / delete a level happens entirely inside the expanded
 *     parent row.
 *   - Per-level fields: id, name, depth, map_id (drop-down of Maps
 *     in the module), tags.
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
import { ID_PATTERN, TagsPicker } from "./TagsPicker";
import { usePublishServer } from "./usePublishServer";

const MODEL_KEY = "dungeons";
const FILE_NAME = "dungeons.json";
const UNTAGGED = "(untagged)";

interface DungeonLevel {
  id: string;
  name: string;
  tags?: string[];
  depth: number;
  map_id: string;
}

interface DungeonRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  levels: DungeonLevel[];
}

interface MapSummary {
  id: string;
  name?: string;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      dungeons: DungeonRecord[];
      maps: MapSummary[];
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function DungeonsBrowse({ moduleId }: { moduleId: string }) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // ── Load dungeons (draft-aware) + maps (for the map_id picker) ──
  const refresh = async () => {
    try {
      const src = new StaticModuleSource();
      const [dungeonsLayers, mapsLayers] = await Promise.all([
        src.loadModelLayers(moduleId, "dungeons"),
        src.loadModelLayers(moduleId, "maps"),
      ]);

      const draft = loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
      const ownEffective =
        draft ?? (dungeonsLayers.ownFile as Record<string, unknown> | null);
      const merged = mergeModel(
        "dungeons",
        dungeonsLayers.inherited,
        ownEffective,
      ) as { dungeons?: DungeonRecord[] } | null;
      const dungeons = merged?.dungeons ?? [];

      const mapsMerged = mergeModel(
        "maps",
        mapsLayers.inherited,
        mapsLayers.ownFile,
      ) as { maps?: MapSummary[] } | null;
      const maps = (mapsMerged?.maps ?? []).map((m) => ({
        id: m.id,
        name: m.name,
      }));

      setState({
        kind: "ok",
        dungeons,
        maps,
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
      map_id: "",
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
    const newLevels = (parent.levels ?? []).map((l, i) =>
      i === levelIdx ? { ...l, ...patch } : l,
    );
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
      {/* Header */}
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
                      maps={state.maps}
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

// ── Inline editor for a single dungeon (metadata + levels list) ─────

function DungeonEditor({
  dungeon,
  maps,
  existingTags,
  onUpdate,
  onAddLevel,
  onUpdateLevel,
  onDeleteLevel,
}: {
  dungeon: DungeonRecord;
  maps: MapSummary[];
  existingTags: string[];
  onUpdate: (patch: Partial<DungeonRecord>) => void;
  onAddLevel: () => void;
  onUpdateLevel: (idx: number, patch: Partial<DungeonLevel>) => void;
  onDeleteLevel: (idx: number) => void;
}) {
  return (
    <div className="border-t border-parchment/10 bg-ink/10 px-3 py-3">
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
            <li
              key={`${lvl.id}-${i}`}
              className="rounded border border-parchment/10 bg-ink/30 p-2"
            >
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                    ID
                  </span>
                  <input
                    type="text"
                    value={lvl.id}
                    onChange={(e) =>
                      onUpdateLevel(i, { id: e.target.value })
                    }
                    className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                    Name
                  </span>
                  <input
                    type="text"
                    value={lvl.name}
                    onChange={(e) =>
                      onUpdateLevel(i, { name: e.target.value })
                    }
                    className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                    Depth
                  </span>
                  <input
                    type="number"
                    value={lvl.depth}
                    onChange={(e) =>
                      onUpdateLevel(i, {
                        depth: Number(e.target.value) || 0,
                      })
                    }
                    className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                    Map
                  </span>
                  <select
                    value={lvl.map_id}
                    onChange={(e) =>
                      onUpdateLevel(i, { map_id: e.target.value })
                    }
                    className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90"
                  >
                    <option value="">— choose a map —</option>
                    {lvl.map_id &&
                    !maps.some((m) => m.id === lvl.map_id) ? (
                      <option value={lvl.map_id}>
                        (missing) {lvl.map_id}
                      </option>
                    ) : null}
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.id} ({m.id})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="block sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                    Tags
                  </span>
                  <TagsPicker
                    tags={lvl.tags ?? []}
                    existing={existingTags}
                    onChange={(tags) => onUpdateLevel(i, { tags })}
                  />
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDeleteLevel(i)}
                  className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                >
                  Delete level
                </button>
              </div>
            </li>
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
        Create the dungeon record first. Add levels inline after it opens.
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
