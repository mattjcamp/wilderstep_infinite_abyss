"use client";

/**
 * Id-list picker — structured editor for "array of ids" fields
 * (encounter rosters, spawn lists, race abilities, item slots, …),
 * replacing the raw JSON textarea those fields used to render.
 *
 * Layout:
 *
 *   [chip] [chip] [chip]            ← current value, in order
 *   [ + Add… / Done ]
 *   (expands when open) ┌─ filter bar + option list ─┐
 *
 * Each chip shows the option's display name (+ sprite thumbnail for
 * catalogs that have art) and a ✕ to remove. Ids that don't resolve
 * against the option source render in warning colour but are
 * PRESERVED — same forward-reference policy as the trap / dungeon
 * dropdowns. The option panel stays open after a pick so rosters
 * ("goblin ×3") build in one pass; duplicate picks are allowed only
 * where the config says they're meaningful.
 *
 * Option sources (see idListFields.ts): another catalog's records,
 * a static enum, or the distinct values of a field across a model.
 * Catalog loads go through StaticModuleSource so module inheritance
 * applies, and are cached per (moduleId, source) with in-flight
 * dedup — several pickers on one form share a single fetch.
 */

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/util/basePath";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { MODELS, type ModelKey } from "@/data_model/models";
import type { IdListSource } from "./idListFields";

export interface IdListOption {
  id: string;
  /** Display name when the record has one; falls back to the id. */
  label: string;
  /** Resolved /sprites/… path for a thumbnail, or null. */
  thumb: string | null;
}

/** Per-model record → thumbnail path. Models without art return
 *  null and the picker renders text-only rows. */
function thumbFor(
  model: ModelKey,
  rec: Record<string, unknown>,
): string | null {
  const sprite = typeof rec.sprite === "string" ? rec.sprite : null;
  if (model === "items") {
    const icon = typeof rec.icon === "string" ? rec.icon : null;
    return icon ? withBasePath(`/sprites/item/${icon}.png`) : null;
  }
  if (sprite) return withBasePath(`/sprites/${sprite}`);
  return null;
}

export function optionsFromRecords(
  model: ModelKey,
  records: ReadonlyArray<Record<string, unknown>>,
): IdListOption[] {
  const out: IdListOption[] = [];
  for (const rec of records) {
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) continue;
    const name = typeof rec.name === "string" ? rec.name : "";
    out.push({ id, label: name || id, thumb: thumbFor(model, rec) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function distinctFromRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  field: string,
): IdListOption[] {
  const seen = new Set<string>();
  for (const rec of records) {
    const v = rec[field];
    if (typeof v === "string" && v) seen.add(v);
    if (Array.isArray(v)) {
      for (const entry of v) {
        if (typeof entry === "string" && entry) seen.add(entry);
      }
    }
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id, thumb: null }));
}

async function loadModelRecords(
  moduleId: string,
  model: ModelKey,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const src = getEditorModuleSource();
  const doc = (await src.loadModel(moduleId, model)) as
    | Record<string, unknown>
    | null;
  const key = MODELS[model].collectionKey;
  if (!doc || !key) return [];
  const records = doc[key];
  return Array.isArray(records)
    ? (records as Array<Record<string, unknown>>)
    : [];
}

// Module-scope option cache with in-flight dedup, keyed by
// moduleId + source identity.
const _optionCache = new Map<string, Promise<IdListOption[]>>();

function sourceCacheKey(moduleId: string, source: IdListSource): string {
  if (source.kind === "static") return `static:${source.options.join("|")}`;
  if (source.kind === "catalog") {
    const where = source.where
      ? `:${source.where.field}=${source.where.in.join("|")}`
      : "";
    return `${moduleId}:catalog:${source.model}${where}`;
  }
  return `${moduleId}:distinct:${source.model}:${source.field}`;
}

/** Apply a catalog source's `where` filter. Records missing the
 *  filtered field are excluded. */
function applyWhere(
  records: ReadonlyArray<Record<string, unknown>>,
  where: { field: string; in: ReadonlyArray<string> } | undefined,
): ReadonlyArray<Record<string, unknown>> {
  if (!where) return records;
  const allowed = new Set(where.in);
  return records.filter((r) => {
    const v = r[where.field];
    return typeof v === "string" && allowed.has(v);
  });
}

/** Resolve a source to its options, cached per (moduleId, source).
 *  Exported for sibling widgets (KeyMapEditor) so every id-picking
 *  surface shares one loader + cache. */
export function loadOptions(
  moduleId: string,
  source: IdListSource,
): Promise<IdListOption[]> {
  const key = sourceCacheKey(moduleId, source);
  const cached = _optionCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    if (source.kind === "static") {
      return source.options.map((id) => ({ id, label: id, thumb: null }));
    }
    const records = await loadModelRecords(moduleId, source.model);
    return source.kind === "catalog"
      ? optionsFromRecords(
          source.model,
          applyWhere(records, source.where),
        )
      : distinctFromRecords(records, source.field);
  })().catch((e) => {
    // Don't poison the cache with a rejection — drop it so a retry
    // (remount, next form) can succeed.
    _optionCache.delete(key);
    throw e;
  });
  _optionCache.set(key, promise);
  return promise;
}

/** Test-only escape hatch: clear the option cache between runs. */
export function __resetIdListOptionCacheForTests(): void {
  _optionCache.clear();
}

export type OptionsState =
  | { kind: "loading" }
  | { kind: "ok"; options: IdListOption[] }
  | { kind: "error"; message: string };

/** Load a source's options as React state. Shared by IdListPicker
 *  and KeyMapEditor so every id-picking widget resolves options the
 *  same way (module-inheritance-aware, cached, race-guarded). */
export function useIdOptions(
  moduleId: string,
  source: IdListSource,
): OptionsState {
  const [state, setState] = useState<OptionsState>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadOptions(moduleId, source)
      .then((options) => {
        if (!cancelled) setState({ kind: "ok", options });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // The cache key is a faithful identity for statically-declared
    // sources, so object identity churn doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, sourceCacheKey(moduleId, source)]);
  return state;
}

/** Filterable option list — the expandable panel shared by
 *  IdListPicker (add-to-list) and KeyMapEditor (pick key / pick id
 *  value). Owns its own filter text; callers decide what a pick
 *  means and whether rows are disabled / badged. */
export function IdOptionPanel({
  state,
  onPick,
  rowDisabled,
  rowBadge,
  rowTitle,
}: {
  state: OptionsState;
  onPick: (id: string) => void;
  rowDisabled?: (o: IdListOption) => boolean;
  rowBadge?: (o: IdListOption) => string | null;
  rowTitle?: (o: IdListOption) => string;
}) {
  const [filter, setFilter] = useState("");
  if (state.kind === "loading") {
    return (
      <div className="mt-1.5 rounded border border-parchment/15 bg-ink/40 p-1.5">
        <p className="px-1 py-2 text-xs text-parchment/55">Loading…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mt-1.5 rounded border border-parchment/15 bg-ink/40 p-1.5">
        <p className="px-1 py-2 text-xs text-ember/85">
          Couldn&apos;t load options: {state.message}
        </p>
      </div>
    );
  }
  const q = filter.trim().toLowerCase();
  const visible = q
    ? state.options.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q),
      )
    : state.options;
  return (
    <div className="mt-1.5 rounded border border-parchment/15 bg-ink/40 p-1.5">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or id…"
        className="w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-[13px] text-parchment/90 placeholder:text-parchment/50 focus:border-parchment/60 focus:outline-none"
      />
      <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-auto pr-1">
        {visible.map((o) => {
          const disabled = rowDisabled?.(o) ?? false;
          const badge = rowBadge?.(o) ?? null;
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(o.id)}
                title={rowTitle?.(o)}
                className="flex w-full items-center gap-2 rounded border border-parchment/10 bg-ink/40 px-2 py-1 text-left text-[13px] text-parchment/85 transition enabled:hover:border-parchment/40 enabled:hover:bg-ink/60 disabled:opacity-40"
              >
                {o.thumb ? (
                  <img
                    src={o.thumb}
                    alt=""
                    width={22}
                    height={22}
                    style={{ imageRendering: "pixelated" }}
                    className="h-[22px] w-[22px] shrink-0 object-contain"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">
                  {o.label}
                  {o.label !== o.id ? (
                    <span className="ml-1 font-mono text-parchment/55">
                      ({o.id})
                    </span>
                  ) : null}
                </span>
                {badge ? (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-parchment/55">
                    {badge}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="px-1 py-2 text-center text-xs text-parchment/55">
            No options match &ldquo;{filter}&rdquo;.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function IdListPicker({
  value,
  onChange,
  source,
  moduleId = "default",
  allowDuplicates = false,
  help,
}: {
  /** Current ids, in authored order. */
  value: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  source: IdListSource;
  /** Module whose resolved catalog feeds the options. Defaults to
   *  the base module for callers that don't know better. */
  moduleId?: string;
  allowDuplicates?: boolean;
  help?: string;
}) {
  const [open, setOpen] = useState(false);
  const state = useIdOptions(moduleId, source);

  const optionById = useMemo(() => {
    const m = new Map<string, IdListOption>();
    if (state.kind === "ok") {
      for (const o of state.options) m.set(o.id, o);
    }
    return m;
  }, [state]);

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const add = (id: string) => {
    if (!allowDuplicates && value.includes(id)) return;
    onChange([...value, id]);
  };

  return (
    <div className="flex-1">
      {/* Chips — the current list, in order. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-sm text-parchment/55">(empty)</span>
        ) : null}
        {value.map((id, i) => {
          const opt = optionById.get(id);
          const unknown = state.kind === "ok" && !opt;
          return (
            <span
              key={`${id}-${i}`}
              className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[13px] ${
                unknown
                  ? "border-ember/50 bg-ember/10 text-ember/90"
                  : "border-parchment/25 bg-ink/40 text-parchment/90"
              }`}
              title={unknown ? `"${id}" isn't in the catalog — kept as-is.` : id}
            >
              {opt?.thumb ? (
                <img
                  src={opt.thumb}
                  alt=""
                  width={18}
                  height={18}
                  style={{ imageRendering: "pixelated" }}
                  className="h-[18px] w-[18px] shrink-0 object-contain"
                />
              ) : null}
              {opt?.label ?? id}
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove"
                className="ml-0.5 text-parchment/55 hover:text-parchment"
              >
                ✕
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/30 px-2 py-0.5 text-xs text-parchment/85 hover:bg-ink/40"
        >
          {open ? "Done" : "+ Add…"}
        </button>
      </div>

      {/* Option panel. */}
      {open ? (
        <IdOptionPanel
          state={state}
          onPick={add}
          rowDisabled={(o) => value.includes(o.id) && !allowDuplicates}
          rowBadge={(o) =>
            value.includes(o.id)
              ? allowDuplicates
                ? `×${value.filter((v) => v === o.id).length}`
                : "added"
              : null
          }
          rowTitle={(o) =>
            value.includes(o.id) && !allowDuplicates
              ? "Already in the list."
              : allowDuplicates && value.includes(o.id)
                ? "Add another copy."
                : "Add to the list."
          }
        />
      ) : null}
      {help ? (
        <p className="mt-1 text-xs text-parchment/60">{help}</p>
      ) : null}
    </div>
  );
}
