"use client";

/**
 * Map picker for RecordForm fields whose key matches a known map field
 * (today: spawn.custom_map, encounter.custom_map — see mapFields.ts).
 *
 * Thin wrapper over the shared <MapPickerField> (MapPickerDialog.tsx):
 * a trigger button that opens the large, tag-tree map dialog used by
 * every map picker in the editor. This file only supplies the data:
 * the module's resolved maps (inherited + own + local draft) and its
 * tag order, optionally narrowed to maps carrying `requiredTag`.
 *
 * Empty value means "(none)" — the engine falls back to the default
 * arena. Catalogs are cached per module at module scope so several
 * pickers on a form share one load.
 */

import { useEffect, useState } from "react";
import { loadDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { effectiveTagOrder, normalizeTag } from "./mapTags";
import { MapPickerField, type PickableMap } from "./MapPickerDialog";

interface Catalog {
  maps: PickableMap[];
  tagOrder: string[];
}

type CatalogState =
  | { kind: "loading" }
  | ({ kind: "ok" } & Catalog)
  | { kind: "error"; message: string };

const _cache = new Map<string, Promise<Catalog>>();

function loadCatalog(moduleId: string): Promise<Catalog> {
  let p = _cache.get(moduleId);
  if (!p) {
    p = (async () => {
      const layers = await getEditorModuleSource().loadModelLayers(
        moduleId,
        "maps",
      );
      const draft = await loadDraft<Record<string, unknown>>(moduleId, "maps");
      const merged = mergeModel(
        "maps",
        layers.inherited,
        draft ?? layers.ownFile,
      ) as { maps?: Array<PickableMap & Record<string, unknown>> } | null;
      const maps = (merged?.maps ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        tags: m.tags,
        width: m.width,
        height: m.height,
        description: m.description,
      }));
      return { maps, tagOrder: effectiveTagOrder(merged) };
    })();
    _cache.set(moduleId, p);
    // Don't cache failures — let the next mount retry.
    p.catch(() => _cache.delete(moduleId));
  }
  return p;
}

/** Test-only escape hatch: clear the catalog cache between runs. */
export function __resetMapCatalogCacheForTests(): void {
  _cache.clear();
}

export function MapPicker({
  value,
  onChange,
  moduleId = "default",
  requiredTag,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Module whose maps to list (resolved: inherited + own + draft). */
  moduleId?: string;
  /** When provided, only maps carrying this tag (or a tag nested
   *  beneath it) are offered. The currently-selected map is always
   *  kept so a stale selection shows instead of vanishing. */
  requiredTag?: string;
}) {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    loadCatalog(moduleId)
      .then((c) => {
        if (!cancelled) setState({ kind: "ok", ...c });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  if (state.kind === "loading") {
    return <p className="py-1 text-[13px] text-parchment/65">Loading maps…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="py-1 text-[13px] text-ember">
        Couldn&apos;t load maps: {state.message}
      </p>
    );
  }

  const want = requiredTag ? normalizeTag(requiredTag).toLowerCase() : null;
  const hasTag = (m: PickableMap) =>
    !want ||
    (m.tags ?? []).some((t) => {
      const n = normalizeTag(t).toLowerCase();
      return n === want || n.startsWith(`${want}: `);
    });
  const maps = state.maps.filter((m) => hasTag(m) || m.id === value);
  const current = state.maps.find((m) => m.id === value);

  return (
    <div className="flex flex-col gap-1">
      <MapPickerField
        title={requiredTag ? `Choose a map tagged “${requiredTag}”` : "Choose a map"}
        value={value}
        maps={maps}
        tagOrder={state.tagOrder}
        allowNone
        noneLabel="(none)"
        noneHint="— use the default arena"
        onChange={onChange}
      />
      {requiredTag && current && !hasTag(current) ? (
        <p className="text-xs text-amber-200/90">
          ⚠ This map no longer carries the{" "}
          <span className="font-mono">{requiredTag}</span> tag.
        </p>
      ) : null}
      {requiredTag && !state.maps.some(hasTag) ? (
        <p className="text-xs text-parchment/70">
          No maps tagged <span className="font-mono">{requiredTag}</span>{" "}
          exist in this module. Tag a map in the editor to use it here.
        </p>
      ) : null}
    </div>
  );
}
