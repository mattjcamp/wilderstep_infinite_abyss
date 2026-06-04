"use client";

/**
 * Modal dialog for the "Generate Dungeon Maps" feature.
 *
 * Picks a dungeon from the module's dungeons.json catalog, previews
 * the map ids that will be minted (using the next free suffix scanned
 * from `existingMaps`), and confirms.
 *
 * No side effects — `onConfirm` is invoked with the picked record
 * plus a seed, and the caller (MapsBrowse) runs `bakeDungeon` and
 * persists the result. Keeping the dialog purely presentational
 * means it stays easy to reason about.
 *
 * The encounters table + monsters catalog are loaded lazily by the
 * caller (because they require module-scope state on the battle
 * loaders); we just take them as props and pass-through.
 */

import { useEffect, useMemo, useState } from "react";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { dungeonSeed } from "@/battle/world/Dungeon";
import type { DungeonRecord } from "@/sim/dungeon/types";
import { bakedMapId, nextFreeSuffix } from "./dungeonBake";

export interface GenerateDungeonDialogProps {
  moduleId: string;
  /** Existing maps (draft-merged) — only `tags` is read, used to
   *  pick the next free suffix. */
  existingMaps: ReadonlyArray<{ tags?: string[] }>;
  /** Caller invokes `bakeDungeon` + persistMaps when this fires. */
  onConfirm: (args: { record: DungeonRecord; seed: number }) => void;
  onCancel: () => void;
}

export function GenerateDungeonDialog({
  moduleId,
  existingMaps,
  onConfirm,
  onCancel,
}: GenerateDungeonDialogProps) {
  const [dungeons, setDungeons] = useState<DungeonRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [seedOverride, setSeedOverride] = useState<string>("");

  // Load the module's dungeon catalog (draft-aware so authors can
  // bake a record they're still iterating on without publishing
  // first — matches MapsBrowse's own draft-merge approach for the
  // tag suggestions).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = new StaticModuleSource();
        const layers = await src.loadModelLayers(moduleId, "dungeons");
        const merged = mergeModel(
          "dungeons",
          layers.inherited,
          layers.ownFile,
        ) as { dungeons?: DungeonRecord[] } | null;
        if (cancelled) return;
        const list = merged?.dungeons ?? [];
        setDungeons(list);
        if (list.length > 0) setSelectedId(list[0].id);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const selected = useMemo(
    () => dungeons?.find((d) => d.id === selectedId) ?? null,
    [dungeons, selectedId],
  );

  // Preview block: which ids will the bake mint? Recomputed live as
  // the dropdown changes so the author sees exactly what's about to
  // hit maps.json.
  const preview = useMemo(() => {
    if (!selected) return null;
    const suffix = nextFreeSuffix(selected.id, existingMaps);
    const groupTag = `dungeon:${selected.id}_${suffix}`;
    const levels = selected.levels ?? [];
    const ids = levels.map((lvl, idx) =>
      bakedMapId(
        selected.id,
        suffix,
        typeof lvl.depth === "number" ? lvl.depth : idx + 1,
      ),
    );
    return { suffix, groupTag, ids, floorCount: levels.length };
  }, [selected, existingMaps]);

  const canConfirm = !!selected && (selected.levels?.length ?? 0) > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !canConfirm) return;
    const seed =
      seedOverride.trim().length > 0
        ? Number.parseInt(seedOverride, 10) >>> 0
        : dungeonSeed(selected.id, 0, 0);
    if (!Number.isFinite(seed)) return;
    onConfirm({ record: selected, seed });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // Click on backdrop cancels.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-md border border-parchment/20 bg-ink p-5 shadow-xl"
      >
        <h2 className="font-display text-xl text-parchment">
          Generate Dungeon Maps
        </h2>
        <p className="mt-1 text-sm text-parchment/75">
          Runs the dungeon's generator and saves the result as plain
          editable maps in this module. Each bake adds a fresh set
          under a new suffix — the procedural runtime entry on the
          overworld is left alone.
        </p>

        <div className="mt-4 space-y-3">
          {/* Dungeon picker */}
          <label className="block">
            <span className="text-[13px] uppercase tracking-wide text-parchment/65">
              Dungeon
            </span>
            {loadError ? (
              <p className="mt-1 text-sm text-ember/80">
                Failed to load dungeons: {loadError}
              </p>
            ) : dungeons === null ? (
              <p className="mt-1 text-sm text-parchment/75">
                Loading dungeons…
              </p>
            ) : dungeons.length === 0 ? (
              <p className="mt-1 text-sm text-parchment/75">
                No dungeons defined in this module. Add one under the
                Dungeons editor first.
              </p>
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
              >
                {dungeons.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.id}) · {d.levels?.length ?? 0}{" "}
                    floor{(d.levels?.length ?? 0) === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* Seed override */}
          <label className="block">
            <span className="text-[13px] uppercase tracking-wide text-parchment/65">
              Seed (optional)
            </span>
            <input
              type="text"
              value={seedOverride}
              onChange={(e) => setSeedOverride(e.target.value)}
              placeholder="leave blank for default"
              className="mt-1 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-sm text-parchment/90"
            />
            <p className="mt-1 text-[13px] text-parchment/65">
              Numeric seed pinned across floors. Leave blank to use
              the dungeon's stable default; supply a value to
              reproduce or reroll a specific layout.
            </p>
          </label>

          {/* Preview */}
          {preview ? (
            <div className="rounded border border-parchment/15 bg-ink/30 p-3">
              <p className="text-[13px] uppercase tracking-wide text-parchment/65">
                Will create
              </p>
              <p className="mt-1 text-sm text-parchment">
                <span className="font-mono">{preview.floorCount}</span>{" "}
                map{preview.floorCount === 1 ? "" : "s"}, tagged{" "}
                <span className="rounded bg-parchment/10 px-1 font-mono text-[13px]">
                  {preview.groupTag}
                </span>
              </p>
              {preview.ids.length > 0 ? (
                <ul className="mt-2 space-y-0.5 font-mono text-[13px] text-parchment/85">
                  {preview.ids.map((id) => (
                    <li key={id}>· {id}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-parchment/75">
                  This dungeon has no levels defined yet — add levels
                  to the dungeon record first.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate
          </button>
        </div>
      </form>
    </div>
  );
}
