"use client";

/**
 * Start position (map + cell) for a module — where a new game begins.
 * Shown in the Module Properties dialog.
 *
 * Storage is unchanged: the value still lives in the module's
 * party.json as `start_position { map_id, col, row }`, so the play
 * host, map resize and the simulator keep reading it from the party.
 * This field only moves the *editing* of it out of the Party editor.
 *
 * The field loads the module's party layers (inherited + own file or
 * pending draft) and its merged maps list itself. Edits are reported
 * up through `onChange` and only persisted when the dialog is saved:
 *   - `undefined` — untouched; the host leaves party.json alone.
 *   - a value     — set this module's own `start_position`.
 *   - `null`      — drop this module's override and inherit again.
 */

import { useEffect, useState } from "react";
import { loadDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { MapPickerField, type PickableMap } from "./MapPickerDialog";
import { effectiveTagOrder } from "./mapTags";
import { NumberInput } from "./PartyAttributesEditor";

export interface StartPosition {
  map_id: string;
  col: number;
  row: number;
}

/** `undefined` = unchanged, `null` = inherit, value = set here. */
export type StartPositionPatch = StartPosition | null | undefined;

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      own: Partial<StartPosition> | undefined;
      inherited: Partial<StartPosition> | undefined;
      hasParent: boolean;
      maps: PickableMap[];
      tagOrder: string[];
    };

function asStart(v: unknown): Partial<StartPosition> | undefined {
  return v && typeof v === "object" ? (v as Partial<StartPosition>) : undefined;
}

export function ModuleStartPositionField({
  moduleId,
  value,
  onChange,
}: {
  moduleId: string;
  value: StartPositionPatch;
  onChange: (next: StartPositionPatch) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = getEditorModuleSource();
        const [partyLayers, mapsLayers, partyDraft] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "maps"),
          loadDraft<Record<string, unknown>>(moduleId, "party"),
        ]);
        if (cancelled) return;
        // A pending party draft is the module's own file until exported.
        const ownParty = (partyDraft ?? partyLayers.ownFile) as
          | Record<string, unknown>
          | null
          | undefined;
        const inheritedParty = partyLayers.inherited as
          | Record<string, unknown>
          | null
          | undefined;
        const mapsMerged = mergeModel(
          "maps",
          mapsLayers.inherited,
          mapsLayers.ownFile,
        ) as Record<string, unknown> | null;
        const maps = (
          (mapsMerged?.maps as PickableMap[] | undefined) ?? []
        ).map((m) => ({
          id: m.id,
          name: m.name,
          tags: m.tags,
          width: m.width,
          height: m.height,
          description: m.description,
        }));
        setLoaded({
          kind: "ok",
          own: asStart(ownParty?.start_position),
          inherited: asStart(inheritedParty?.start_position),
          hasParent: inheritedParty != null,
          maps,
          tagOrder: effectiveTagOrder(mapsMerged),
        });
      } catch (e) {
        if (cancelled) return;
        setLoaded({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  if (loaded.kind === "loading") {
    return <p className="text-xs text-parchment/60">Loading start position…</p>;
  }
  if (loaded.kind === "error") {
    return (
      <p className="text-xs text-ember">
        Couldn&apos;t load the start position: {loaded.message}
      </p>
    );
  }

  // What this module currently sets itself, after any unsaved edit.
  const ownNow: Partial<StartPosition> | undefined =
    value === undefined ? loaded.own : value ?? undefined;
  const inherited = loaded.hasParent && !ownNow;
  const start: Partial<StartPosition> = ownNow ?? loaded.inherited ?? {};
  const startMap = loaded.maps.find((m) => m.id === start.map_id);
  const col = start.col ?? 0;
  const row = start.row ?? 0;
  const outOfBounds =
    !!startMap &&
    typeof startMap.width === "number" &&
    typeof startMap.height === "number" &&
    (col < 0 || row < 0 || col >= startMap.width || row >= startMap.height);

  const set = (patch: Partial<StartPosition>) =>
    onChange({ map_id: "", col: 0, row: 0, ...start, ...patch });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-parchment/85 font-mono">
          start position
        </span>
        {inherited ? (
          <span
            className="rounded border border-parchment/20 px-1.5 text-[10px] uppercase tracking-wide text-parchment/50"
            title="Not set in this module — inherited from the module it extends. Editing it sets it here."
          >
            inherited
          </span>
        ) : null}
        {loaded.hasParent && ownNow ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-parchment/55 underline decoration-dotted hover:text-parchment"
            title="Drop this module's value and inherit it again."
          >
            Use inherited
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <MapPickerField
          className="min-w-0 flex-1"
          title="Party start map"
          value={start.map_id ?? ""}
          maps={loaded.maps}
          tagOrder={loaded.tagOrder}
          onChange={(id) => set({ map_id: id })}
        />
        <NumberInput
          label="Start column"
          placeholder="col"
          value={col}
          min={0}
          onCommit={(n) => set({ col: n })}
        />
        <NumberInput
          label="Start row"
          placeholder="row"
          value={row}
          min={0}
          onCommit={(n) => set({ row: n })}
        />
      </div>
      <span className="text-xs text-parchment/65">
        {start.map_id && !startMap ? (
          <span className="text-amber-200/90">
            Unknown map id — not present in maps.json.
          </span>
        ) : outOfBounds ? (
          <span className="text-amber-200/90">
            ({col}, {row}) is outside {startMap?.name ?? start.map_id} (
            {startMap?.width}×{startMap?.height}).
          </span>
        ) : startMap?.width ? (
          <>
            Map is {startMap.width}×{startMap.height}. Where the party
            stands when a new game begins.
          </>
        ) : (
          <>Where the party stands when a new game begins.</>
        )}
      </span>
    </div>
  );
}
