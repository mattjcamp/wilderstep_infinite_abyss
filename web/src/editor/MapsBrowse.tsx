"use client";

/**
 * Maps-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "maps". Replaces
 * the generic ModelView for this one model because maps need:
 *
 *   - A tag-tree grouping in the list (not a flat table) — maps with
 *     multiple tags appear under each tag they carry; maps with no
 *     tags fall into an "(untagged)" bucket.
 *   - A custom New Map form that auto-generates the grid from
 *     width × height (no raw-JSON grid input), with a chip-style
 *     multi-select for tags that suggests existing tags and lets you
 *     type new ones.
 *   - Click-to-open-editor on each row + a Delete button.
 *
 * Carries the same draft → publish flow every other model uses.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
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

const MODEL_KEY = "maps";
const FILE_NAME = "maps.json";
const UNTAGGED = "(untagged)";

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
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function MapsBrowse({ moduleId }: { moduleId: string }) {
  const router = useRouter();
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ── Load palette + maps (draft-aware) ──────────────────────────
  const refresh = async () => {
    try {
      const src = new StaticModuleSource();
      const [paletteLayers, mapsLayers] = await Promise.all([
        src.loadModelLayers(moduleId, "map_tiles"),
        src.loadModelLayers(moduleId, "maps"),
      ]);
      const paletteMerged = mergeModel(
        "map_tiles",
        paletteLayers.inherited,
        paletteLayers.ownFile,
      ) as { map_tiles?: TileType[] } | null;
      const palette = paletteMerged?.map_tiles ?? [];

      const draft = loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
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
      for (const t of m.tags ?? []) s.add(t);
    }
    return [...s].sort();
  }, [state]);

  // ── Group maps by tag for the tree view ────────────────────────
  const groupedByTag = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, MapRecord[]>();
    const groups = new Map<string, MapRecord[]>();
    for (const m of state.maps) {
      const tags =
        Array.isArray(m.tags) && m.tags.length > 0 ? m.tags : [UNTAGGED];
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag)!.push(m);
      }
    }
    // Stable sort: untagged last, otherwise alphabetical.
    const sorted = new Map<string, MapRecord[]>();
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    });
    for (const k of keys) sorted.set(k, groups.get(k)!);
    return sorted;
  }, [state]);

  // ── Mutators (persist via the draft system) ────────────────────
  const persistMaps = (updatedMaps: MapRecord[]) => {
    if (state.kind !== "ok") return;
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { maps: [] };
    baseFile.maps = updatedMaps;
    saveDraft(moduleId, MODEL_KEY, baseFile);
    setState({
      ...state,
      maps: updatedMaps,
      ownFile: baseFile,
      isDraft: true,
    });
  };

  const onCreate = (rec: MapRecord) => {
    if (state.kind !== "ok") return;
    persistMaps([...state.maps, rec]);
    setCreating(false);
    // Drop straight into the visual editor for the new map.
    router.push(`/editor/${moduleId}/maps/${rec.id}`);
  };

  const onDelete = (id: string) => {
    if (state.kind !== "ok") return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete map "${id}"?\n\nRemoves it from this module's maps file. Saves to the draft until you Publish.`,
      )
    )
      return;
    persistMaps(state.maps.filter((m) => m.id !== id));
  };

  const onDiscardDraft = () => {
    if (typeof window === "undefined") return;
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (
      !window.confirm(
        "Discard all pending changes to this module's maps file?",
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
    return <p className="p-4 text-parchment/60">Loading maps…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load maps.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const existingIds = new Set(state.maps.map((m) => m.id));
  const canExport = state.ownFile !== null;

  return (
    <div className="p-4">
      {/* Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-parchment">Maps</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-parchment/60">
            <span>
              {state.maps.length} map{state.maps.length === 1 ? "" : "s"}
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
              + New Map
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

      {/* Tree-by-tag */}
      <div className="mt-6 space-y-5">
        {[...groupedByTag.entries()].map(([tag, maps]) => (
          <section key={tag}>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-parchment/45">
              {tag}
              <span className="ml-2 text-parchment/35 normal-case tracking-normal">
                ({maps.length})
              </span>
            </h2>
            <ul className="divide-y divide-parchment/5 rounded border border-parchment/10 bg-ink/20">
              {maps.map((m) => (
                <li key={`${tag}::${m.id}`}>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link
                      href={`/editor/${moduleId}/maps/${m.id}`}
                      className="min-w-0 flex-1 truncate text-sm text-parchment hover:text-parchment/100"
                    >
                      <span className="font-display">{m.name}</span>
                      <span className="ml-2 font-mono text-xs text-parchment/45">
                        {m.id}
                      </span>
                      <span className="ml-2 text-xs text-parchment/40">
                        {m.width}×{m.height}
                      </span>
                      {Array.isArray(m.tags) && m.tags.length > 1 ? (
                        <span className="ml-2 text-xs text-parchment/40">
                          also: {m.tags.filter((t) => t !== tag).join(", ")}
                        </span>
                      ) : null}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(m.id);
                      }}
                      className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/60 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
                      title="Delete this map from the module's maps file."
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {state.maps.length === 0 ? (
          <p className="text-sm text-parchment/55">
            No maps yet. Click <strong>+ New Map</strong> to create one.
          </p>
        ) : null}
      </div>
    </div>
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
      <p className="mt-1 text-sm text-parchment/55">
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
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
            <p className="mt-1 text-xs text-ember/80">{idError}</p>
          ) : (
            <p className="mt-1 text-xs text-parchment/45">
              Key in <code>maps.json</code>.
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
            placeholder="Town Square"
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
            placeholder="A cobbled square at the heart of Town One…"
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

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
          <span className="text-xs uppercase tracking-wide text-parchment/45">
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
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/70 hover:bg-ink/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// TagsPicker + ID_PATTERN moved to ./TagsPicker.tsx so the same
// component drives MapsBrowse, DungeonsBrowse, and QuestsBrowse.
