"use client";

/**
 * Encounter picker — used by the Quest editor's "kill" step row so
 * authors choose the target encounter via a graphical list instead
 * of hand-editing `params.encounter_id` in JSON. Each row shows the
 * encounter's lead-monster sprite (`monster_party_tile`) alongside
 * name / area / level / weight so you can scan the list visually.
 *
 * Layout mirrors CounterPicker / MapPicker / AnimationPicker:
 *
 *   [ ▸ Encounter name (area · Lv N) ] [ ✕ clear ]
 *   (expands when open) ┌─ scrollable list of encounters ─┐
 *
 * Click a row → field value becomes that encounter's id. Empty
 * value renders as "(none)".
 *
 * Catalog is cached at module scope so multiple pickers (e.g. a
 * quest with several kill steps) share a single fetch.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface EncounterRecord {
  id: string;
  name?: string;
  area?: string;
  level?: number;
  weight?: number;
  /** Sprite path for the lead monster (`monster/goblin.png` etc.).
   *  Empty / missing renders as a placeholder square. */
  monster_party_tile?: string;
  monsters?: string[];
}

interface EncountersFile {
  _comment?: string;
  encounters: EncounterRecord[];
}

type CatalogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; encounters: EncounterRecord[] }
  | { kind: "error"; message: string };

let _cached: EncounterRecord[] | null = null;
let _inflight: Promise<EncounterRecord[]> | null = null;

async function loadCatalog(): Promise<EncounterRecord[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = withBasePath("/modules/default/encounters.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as EncountersFile;
    const list = Array.isArray(file.encounters) ? file.encounters : [];
    _cached = list;
    return list;
  })();
  try {
    return await _inflight;
  } finally {
    _inflight = null;
  }
}

/** Test-only escape hatch — drop the cache between unit-test runs. */
export function __resetEncounterCatalogCacheForTests(): void {
  _cached = null;
  _inflight = null;
}

/** Short trailing description for a row ("dungeon · Lv 1 · w 30"). */
function describeEncounter(e: EncounterRecord): string {
  const bits: string[] = [];
  if (e.area) bits.push(e.area);
  if (typeof e.level === "number") bits.push(`Lv ${e.level}`);
  if (typeof e.weight === "number") bits.push(`w ${e.weight}`);
  return bits.join(" · ");
}

export function EncounterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CatalogState>({ kind: "idle" });

  useEffect(() => {
    if (state.kind !== "idle") return;
    setState({ kind: "loading" });
    loadCatalog()
      .then((encounters) => setState({ kind: "ok", encounters }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [state.kind]);

  const current =
    state.kind === "ok"
      ? state.encounters.find((e) => e.id === value) ?? null
      : null;

  const summary = (() => {
    if (!value) return "(none)";
    if (state.kind === "loading" || state.kind === "error") return value;
    if (!current) {
      // Value points at an encounter the catalog doesn't recognize —
      // surface with a warning marker so the designer notices.
      return `${value} ⚠`;
    }
    const tail = describeEncounter(current);
    return tail
      ? `${current.name ?? current.id} (${tail})`
      : (current.name ?? current.id);
  })();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-sm text-parchment hover:bg-ink/60"
          aria-expanded={open}
        >
          <span className="text-parchment/40">{open ? "▾" : "▸"}</span>
          {current?.monster_party_tile ? (
            <SpriteThumb
              path={current.monster_party_tile}
              alt={current.name ?? current.id}
            />
          ) : null}
          <span className="truncate">{summary}</span>
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
            title="Clear the encounter selection."
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {state.kind === "loading" ? (
            <p className="text-xs text-parchment/50">Loading encounters…</p>
          ) : null}
          {state.kind === "error" ? (
            <p className="text-xs text-ember">
              Couldn&apos;t load encounters.json: {state.message}
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
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition ${
                    value === ""
                      ? "bg-ember/30 text-parchment"
                      : "text-parchment/75 hover:bg-ink/40"
                  }`}
                >
                  <span className="inline-block h-6 w-6 shrink-0" />
                  <span className="font-mono text-parchment/50">(none)</span>
                </button>
              </li>
              {state.encounters.map((e) => {
                const isActive = e.id === value;
                const tail = describeEncounter(e);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(e.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left text-sm transition ${
                        isActive
                          ? "bg-ember/30 text-parchment"
                          : "text-parchment/85 hover:bg-ink/40"
                      }`}
                    >
                      {e.monster_party_tile ? (
                        <SpriteThumb
                          path={e.monster_party_tile}
                          alt={e.name ?? e.id}
                        />
                      ) : (
                        <span className="inline-block h-6 w-6 shrink-0 rounded border border-parchment/15 bg-ink/40" />
                      )}
                      <span className="flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">
                            {e.name ?? e.id}
                          </span>
                          <span className="font-mono text-[10px] text-parchment/45">
                            {e.id}
                          </span>
                        </span>
                        {tail ? (
                          <span className="block text-[11px] text-parchment/55">
                            {tail}
                          </span>
                        ) : null}
                        {e.monsters && e.monsters.length > 0 ? (
                          <span className="block font-mono text-[10px] text-parchment/45">
                            {e.monsters.join(", ")}
                          </span>
                        ) : null}
                      </span>
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

/** Small 24×24 sprite thumbnail rendered with pixelated nearest-
 *  neighbour scaling so the source art's hard edges survive. Used
 *  on both the closed picker (one sprite) and each list row. */
function SpriteThumb({ path, alt }: { path: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={withBasePath(`/sprites/${path}`)}
      alt={alt}
      width={24}
      height={24}
      style={{ imageRendering: "pixelated" }}
      className="h-6 w-6 shrink-0 rounded border border-parchment/15 bg-ink/40 object-contain"
    />
  );
}
