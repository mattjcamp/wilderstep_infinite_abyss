"use client";

/**
 * Map picker — embedded into RecordForm fields whose key matches a
 * known map-field (today: spawn.custom_map, encounter.custom_map).
 * Lists every entry from the module's maps.json catalog and writes
 * the selected `id` back through onChange.
 *
 * Layout mirrors the CounterPicker / AnimationPicker exactly so the
 * editor reads consistently from one reference-typed field to the
 * next:
 *
 *   [ ▸ Map name (W×H · tags) ] [ ✕ clear ]
 *   (expands when open) ┌─ scrollable list of maps ─┐
 *
 * Click a row → field value becomes that map's id. Empty value means
 * "(none)" — the engine falls back to the default arena.
 *
 * Catalog is fetched once and cached at module scope so multiple
 * pickers on a form (or rapid edits) share a single request.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface MapRecord {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  width?: number;
  height?: number;
}

interface MapsFile {
  _comment?: string;
  maps: MapRecord[];
}

type CatalogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; maps: MapRecord[] }
  | { kind: "error"; message: string };

let _cached: MapRecord[] | null = null;
let _inflight: Promise<MapRecord[]> | null = null;

async function loadCatalog(): Promise<MapRecord[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = withBasePath("/modules/default/maps.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as MapsFile;
    const list = Array.isArray(file.maps) ? file.maps : [];
    _cached = list;
    return list;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Test-only escape hatch: clear the catalog cache between runs. */
export function __resetMapCatalogCacheForTests(): void {
  _cached = null;
  _inflight = null;
}

/** Build the per-map tail string ("16×14 · battle_screen_arena") used
 *  in both the closed-state summary and the list rows. */
function describeMap(m: MapRecord): string {
  const parts: string[] = [];
  if (typeof m.width === "number" && typeof m.height === "number") {
    parts.push(`${m.width}×${m.height}`);
  }
  if (Array.isArray(m.tags) && m.tags.length > 0) {
    parts.push(m.tags.join(", "));
  }
  return parts.join(" · ");
}

export function MapPicker({
  value,
  onChange,
  requiredTag,
}: {
  value: string;
  onChange: (value: string) => void;
  /** When provided, only maps whose `tags` array includes this string
   *  are shown in the dropdown. The catalog itself is still loaded
   *  in full (cached at module scope), so filtering is a cheap
   *  per-instance pass. Maps whose currently-selected id no longer
   *  matches the filter still display as a warning row so the
   *  designer notices a stale link rather than the picker silently
   *  hiding their selection. */
  requiredTag?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CatalogState>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "idle") return;
    setState({ kind: "loading" });
    loadCatalog()
      .then((maps) => setState({ kind: "ok", maps }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [state.kind]);

  const current =
    state.kind === "ok"
      ? state.maps.find((m) => m.id === value) ?? null
      : null;

  /** Maps that pass the tag filter (or every map when no filter is
   *  set). The currently-selected map is always retained in the list
   *  even when it doesn't match — so the picker can show the warning
   *  state and the author has a path to clear it. */
  const filteredMaps =
    state.kind === "ok"
      ? !requiredTag
        ? state.maps
        : state.maps.filter(
            (m) =>
              (Array.isArray(m.tags) && m.tags.includes(requiredTag)) ||
              m.id === value,
          )
      : [];

  const currentMatchesFilter =
    !requiredTag ||
    (current?.tags && current.tags.includes(requiredTag));

  const summary = (() => {
    if (!value) return "(none)";
    if (state.kind === "loading" || state.kind === "error") return value;
    if (!current) {
      // Value points at a map the catalog doesn't recognize —
      // surface it with a warning marker so the designer notices.
      return `${value} ⚠`;
    }
    const tail = describeMap(current);
    const label = tail
      ? `${current.name ?? current.id} (${tail})`
      : (current.name ?? current.id);
    // Selected map doesn't carry the required tag — flag it so the
    // designer knows the selection is stale (e.g. the tag was
    // removed from a map after it got linked here).
    return currentMatchesFilter ? label : `${label} ⚠`;
  })();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-sm text-parchment hover:bg-ink/60"
          aria-expanded={open}
        >
          <span className="text-parchment/60 mr-1">{open ? "▾" : "▸"}</span>
          {summary}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Clear the custom map — fall back to the default arena."
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {state.kind === "loading" ? (
            <p className="text-[13px] text-parchment/70">Loading maps…</p>
          ) : null}
          {state.kind === "error" ? (
            <p className="text-[13px] text-ember">
              Couldn&apos;t load maps.json: {state.message}
            </p>
          ) : null}
          {state.kind === "ok" ? (
            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className={`w-full rounded px-2 py-1 text-left text-sm transition ${
                    value === ""
                      ? "bg-ember/30 text-parchment"
                      : "text-parchment/75 hover:bg-ink/40"
                  }`}
                >
                  <span className="font-mono text-parchment/70">(none)</span>{" "}
                  <span className="text-parchment/65">
                    — use the default arena
                  </span>
                </button>
              </li>
              {requiredTag && filteredMaps.length === 0 ? (
                <li className="px-2 py-1 text-xs text-parchment/75">
                  No maps tagged{" "}
                  <span className="font-mono text-parchment/80">
                    {requiredTag}
                  </span>{" "}
                  exist in this module. Tag a map in the editor to use
                  it as a custom battle arena.
                </li>
              ) : null}
              {filteredMaps.map((m) => {
                const isActive = m.id === value;
                const tail = describeMap(m);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      className={`w-full rounded px-2 py-1 text-left text-sm transition ${
                        isActive
                          ? "bg-ember/30 text-parchment"
                          : "text-parchment/85 hover:bg-ink/40"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {m.name ?? m.id}
                        </span>
                        <span className="font-mono text-xs text-parchment/65">
                          {m.id}
                        </span>
                      </div>
                      {tail ? (
                        <div className="text-xs text-parchment/70">
                          {tail}
                        </div>
                      ) : null}
                      {m.description ? (
                        <div className="text-xs text-parchment/65">
                          {m.description}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
