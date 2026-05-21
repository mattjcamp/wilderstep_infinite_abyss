"use client";

/**
 * Reusable list-builder for a soundtrack playlist. Used by the Module
 * Properties, Map Properties, and Dungeon editors.
 *
 * Surface:
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ ▸ Aurelian Overture            [▶][↑][↓][✕]   │   ← selected #1
 *   │ ▸ Lost in the Labyrinth        [▶][↑][↓][✕]   │   ← selected #2
 *   │ ─────                                          │
 *   │ + Add a track                                  │   (toggles list)
 *   │   ┌─ available tracks (filterable) ─────────┐  │
 *   │   │ ▸ Bard's Ballad             [▶][+]      │  │
 *   │   │ ▸ Winds of Destiny          [▶][+]      │  │
 *   │   └─────────────────────────────────────────┘  │
 *   └───────────────────────────────────────────────┘
 *
 * The catalog of available tracks is fetched once from
 * `/audio/index.json` (module-scope cache so multiple pickers on the
 * same form share a single request). The picker tolerates a missing
 * index — the available list just renders empty + an explanation.
 *
 * The picker does NOT persist anything itself — it calls `onChange`
 * with the new ordered list of paths and the host commits.
 */

import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/util/basePath";

/** Shape of /audio/index.json. */
interface AudioIndex {
  _comment?: string;
  tracks: AudioTrack[];
}

interface AudioTrack {
  /** Path used in module / map / dungeon `soundtrack` fields — also
   *  what feeds the `<audio src>` at runtime. */
  path: string;
  /** Human-readable display name for the picker. Falls back to the
   *  basename when omitted. */
  name?: string;
}

type CatalogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; tracks: AudioTrack[] }
  | { kind: "error"; message: string };

// Module-scope cache so the Module Properties + Map Properties +
// Dungeon dialogs share one fetch.
let _cached: AudioTrack[] | null = null;
let _inflight: Promise<AudioTrack[]> | null = null;

async function loadAudioCatalog(): Promise<AudioTrack[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = withBasePath("/audio/index.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as AudioIndex;
    const list = Array.isArray(file.tracks) ? file.tracks : [];
    // Defensive normalisation — drop entries with non-string path,
    // and fall back to a basename-derived name when absent.
    const cleaned: AudioTrack[] = [];
    for (const t of list) {
      if (!t || typeof t.path !== "string" || t.path.length === 0) continue;
      cleaned.push({
        path: t.path,
        name:
          typeof t.name === "string" && t.name.length > 0
            ? t.name
            : basenameOf(t.path),
      });
    }
    _cached = cleaned;
    return cleaned;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Test-only escape hatch — clears the module-scope cache between
 *  unit tests so each spec sees a fresh fetch. */
export function __resetSoundtrackCatalogCacheForTests(): void {
  _cached = null;
  _inflight = null;
}

/** Derive a display name from a path when the index omits one. */
function basenameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  // Strip common audio extensions, replace separators with spaces.
  return base
    .replace(/\.(mp3|ogg|wav|m4a|aac)$/i, "")
    .replace(/[_-]+/g, " ");
}

export function SoundtrackPicker({
  value,
  onChange,
  /** Optional hint shown when no tracks are selected — e.g.,
   *  "Inherits from the module default." for the map / dungeon
   *  variants. */
  emptyHint,
}: {
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  const [state, setState] = useState<CatalogState>({ kind: "idle" });
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [filter, setFilter] = useState<string>("");
  /** Single shared <audio> element used by all preview buttons.
   *  Starting playback on one row pauses any other that was playing.
   *  Lives in a ref so it survives re-renders + cleans up on
   *  unmount (the pause-on-cleanup keeps a half-played track from
   *  blasting into the room after the dialog closes). */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    if (state.kind !== "idle") return;
    setState({ kind: "loading" });
    loadAudioCatalog()
      .then((tracks) => setState({ kind: "ok", tracks }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [state.kind]);

  // Pause any preview when the picker unmounts (dialog closed). The
  // ref keeps a handle to the live element across re-renders so the
  // cleanup actually finds it.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) el.pause();
    };
  }, []);

  /** Look up the display name for a path. Falls back to the
   *  basename when the catalog hasn't loaded yet or doesn't list
   *  the path (the value array can carry paths that disappeared
   *  from the catalog — surface them so the author can remove
   *  them). */
  const nameFor = (path: string): string => {
    if (state.kind === "ok") {
      const t = state.tracks.find((x) => x.path === path);
      if (t?.name) return t.name;
    }
    return basenameOf(path);
  };

  /** Preview a track. Stops whatever was playing before. Clicking
   *  the same playing track again pauses it (toggle). */
  const togglePreview = (path: string) => {
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.addEventListener("ended", () => setPreviewSrc(null));
      audioRef.current = el;
    }
    const absolute = withBasePath(path);
    if (previewSrc === path && !el.paused) {
      el.pause();
      setPreviewSrc(null);
      return;
    }
    el.src = absolute;
    el.currentTime = 0;
    el.play().catch(() => undefined);
    setPreviewSrc(path);
  };

  const addTrack = (path: string) => {
    if (value.includes(path)) return;
    onChange([...value, path]);
  };

  const removeAt = (idx: number) => {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = value.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= value.length - 1) return;
    const next = value.slice();
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  };

  const needle = filter.trim().toLowerCase();
  const selectedSet = new Set(value);
  const available =
    state.kind === "ok"
      ? state.tracks.filter((t) => {
          if (selectedSet.has(t.path)) return false;
          if (!needle) return true;
          return (
            (t.name ?? "").toLowerCase().includes(needle) ||
            t.path.toLowerCase().includes(needle)
          );
        })
      : [];

  return (
    <div className="flex flex-col gap-2">
      {/* Selected playlist */}
      {value.length === 0 ? (
        <p className="rounded border border-dashed border-parchment/20 bg-ink/30 px-2 py-1.5 text-[11px] text-parchment/55">
          No tracks selected.
          {emptyHint ? <span className="ml-1">{emptyHint}</span> : null}
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {value.map((path, i) => {
            const isPlaying = previewSrc === path;
            return (
              <li
                key={`${path}-${i}`}
                className="flex items-center gap-2 rounded border border-parchment/15 bg-ink/40 px-2 py-1"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-parchment/45">
                  {i + 1}
                </span>
                <span className="flex-1 truncate" title={path}>
                  {nameFor(path)}
                </span>
                <button
                  type="button"
                  onClick={() => togglePreview(path)}
                  className="rounded border border-parchment/20 bg-ink/40 px-1.5 py-0.5 text-[11px] text-parchment/80 hover:bg-ink/60"
                  title={isPlaying ? "Stop preview" : "Preview"}
                  aria-label={isPlaying ? "Stop preview" : "Preview"}
                >
                  {isPlaying ? "■" : "▶"}
                </button>
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="rounded border border-parchment/20 bg-ink/40 px-1.5 py-0.5 text-[11px] text-parchment/80 hover:bg-ink/60 disabled:opacity-30"
                  title="Move up"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === value.length - 1}
                  className="rounded border border-parchment/20 bg-ink/40 px-1.5 py-0.5 text-[11px] text-parchment/80 hover:bg-ink/60 disabled:opacity-30"
                  title="Move down"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (previewSrc === path) {
                      // Stop the preview if we're about to remove
                      // the track that's previewing — otherwise the
                      // audio keeps playing under a row that no
                      // longer exists.
                      audioRef.current?.pause();
                      setPreviewSrc(null);
                    }
                    removeAt(i);
                  }}
                  className="rounded border border-parchment/20 bg-ink/40 px-1.5 py-0.5 text-[11px] text-parchment/80 hover:bg-ink/60"
                  title="Remove"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add-track panel */}
      <button
        type="button"
        onClick={() => setAddOpen((o) => !o)}
        className="self-start rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/60"
        aria-expanded={addOpen}
      >
        {addOpen ? "▾ Hide tracks" : "▸ + Add a track"}
      </button>
      {addOpen ? (
        <div className="rounded border border-parchment/15 bg-ink/30 p-2">
          {state.kind === "loading" ? (
            <p className="text-xs text-parchment/50">Loading tracks…</p>
          ) : null}
          {state.kind === "error" ? (
            <p className="text-xs text-ember">
              Couldn&apos;t load /audio/index.json: {state.message}
            </p>
          ) : null}
          {state.kind === "ok" ? (
            <>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…"
                className="mb-1 w-full rounded border border-parchment/20 bg-ink/40 px-2 py-0.5 text-xs text-parchment placeholder:text-parchment/40 focus:border-parchment/45 focus:outline-none"
              />
              {available.length === 0 ? (
                <p className="text-[11px] text-parchment/50">
                  {state.tracks.length === 0
                    ? "No tracks in /audio/index.json yet — drop files in /public/audio/ and list them there."
                    : needle
                      ? "No tracks match the filter."
                      : "Every available track is already in the playlist."}
                </p>
              ) : (
                <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-sm">
                  {available.map((t) => {
                    const isPlaying = previewSrc === t.path;
                    return (
                      <li
                        key={t.path}
                        className="flex items-center gap-2 rounded border border-transparent px-1.5 py-0.5 text-parchment/85 hover:border-parchment/10 hover:bg-ink/40"
                      >
                        <span className="flex-1 truncate" title={t.path}>
                          {t.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => togglePreview(t.path)}
                          className="rounded border border-parchment/20 bg-ink/40 px-1.5 py-0.5 text-[11px] text-parchment/80 hover:bg-ink/60"
                          title={isPlaying ? "Stop preview" : "Preview"}
                          aria-label={isPlaying ? "Stop preview" : "Preview"}
                        >
                          {isPlaying ? "■" : "▶"}
                        </button>
                        <button
                          type="button"
                          onClick={() => addTrack(t.path)}
                          className="rounded border border-ember/50 bg-ember/20 px-1.5 py-0.5 text-[11px] text-parchment hover:bg-ember/40"
                          title="Add to playlist"
                          aria-label="Add to playlist"
                        >
                          +
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
