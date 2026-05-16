"use client";

/**
 * Counter picker — embedded into RecordForm fields whose key matches
 * a known counter-field (today: npc.counter). Lists every entry from
 * the module's counters.json catalog and writes the selected `id`
 * back through onChange.
 *
 * Layout mirrors the AnimationPicker exactly so the editor reads
 * consistently from one reference-typed field to the next:
 *
 *   [ ▸ Counter name (kind · N items) ] [ ✕ clear ]
 *   (expands when open) ┌─ scrollable list of counters ─┐
 *
 * Click a row → field value becomes that counter's id. Empty value
 * means "(none)" — the NPC has nothing to sell.
 *
 * Catalog is fetched once and cached at module scope so multiple
 * pickers on a form (or rapid edits) share a single request.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface CounterRecord {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  items?: string[];
  services?: unknown[];
}

interface CountersFile {
  _comment?: string;
  counters: CounterRecord[];
}

type CatalogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; counters: CounterRecord[] }
  | { kind: "error"; message: string };

let _cached: CounterRecord[] | null = null;
let _inflight: Promise<CounterRecord[]> | null = null;

async function loadCatalog(): Promise<CounterRecord[]> {
  if (_cached) return _cached;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = withBasePath("/modules/default/counters.json");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as CountersFile;
    const list = Array.isArray(file.counters) ? file.counters : [];
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
export function __resetCounterCatalogCacheForTests(): void {
  _cached = null;
  _inflight = null;
}

/** Build the per-counter tail string ("shop · 11 items", "service",
 *  etc.) used in both the closed-state summary and the list rows. */
function describeCounter(c: CounterRecord): string {
  const parts: string[] = [];
  const kind = c.kind ?? "shop";
  parts.push(kind);
  if (Array.isArray(c.items) && c.items.length > 0) {
    parts.push(`${c.items.length} item${c.items.length === 1 ? "" : "s"}`);
  }
  if (Array.isArray(c.services) && c.services.length > 0) {
    parts.push(
      `${c.services.length} service${c.services.length === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ");
}

export function CounterPicker({
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
      .then((counters) => setState({ kind: "ok", counters }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [state.kind]);

  const current =
    state.kind === "ok"
      ? state.counters.find((c) => c.id === value) ?? null
      : null;

  const summary = (() => {
    if (!value) return "(none)";
    if (state.kind === "loading" || state.kind === "error") return value;
    if (!current) {
      // Value points at a counter the catalog doesn't recognize —
      // surface it with a warning marker so the designer notices.
      return `${value} ⚠`;
    }
    const tail = describeCounter(current);
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
          className="flex-1 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-left text-sm text-parchment hover:bg-ink/60"
          aria-expanded={open}
        >
          <span className="text-parchment/40 mr-1">{open ? "▾" : "▸"}</span>
          {summary}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
            title="Clear the counter reference."
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1 max-h-64 overflow-auto rounded border border-parchment/15 bg-ink/60 p-2">
          {state.kind === "loading" ? (
            <p className="text-xs text-parchment/50">Loading counters…</p>
          ) : null}
          {state.kind === "error" ? (
            <p className="text-xs text-ember">
              Couldn&apos;t load counters.json: {state.message}
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
                  <span className="font-mono text-parchment/50">(none)</span>{" "}
                  <span className="text-parchment/45">
                    — NPC has nothing to sell
                  </span>
                </button>
              </li>
              {state.counters.map((c) => {
                const isActive = c.id === value;
                const tail = describeCounter(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.id);
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
                          {c.name ?? c.id}
                        </span>
                        <span className="font-mono text-[10px] text-parchment/45">
                          {c.id}
                        </span>
                      </div>
                      {tail ? (
                        <div className="text-[11px] text-parchment/50">
                          {tail}
                        </div>
                      ) : null}
                      {c.description ? (
                        <div className="text-[11px] text-parchment/45">
                          {c.description}
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
