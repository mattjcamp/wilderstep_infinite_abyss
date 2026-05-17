"use client";

/**
 * DungeonSimLauncher — picker + harness for procedurally walking
 * dungeons from `dungeons.json`. Mirrors `BattleSimLauncher`:
 *
 *   - Loads the module's dungeon catalog (draft-aware) so authors
 *     iterate on a record and immediately re-test.
 *   - Lets the user pick a dungeon, an optional explicit seed (so
 *     they can reproduce a layout they liked / didn't like), and
 *     the floor to start on.
 *   - "Generate & Walk" runs the v1 generator with the dungeon's
 *     parameters, hands the resulting `DungeonLevel` to the
 *     `DungeonSimMount` for rendering + simulation.
 *
 * The launcher itself contains no Phaser code; that's all inside
 * DungeonSimMount, which lazily imports Phaser the same way the
 * battle simulator does.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { dungeonSeed } from "@/v1battle/world/Dungeon";
import {
  generateDungeonFromRecord,
  resolveLevelOptions,
} from "@/sim/dungeon/generateFromRecord";
import type { DungeonRecord } from "@/sim/dungeon/types";
import { DungeonSimMount } from "./DungeonSimMount";

export function DungeonSimLauncher({ moduleId }: { moduleId: string }) {
  const searchParams = useSearchParams();
  // URL-driven entry: when the MapEditor pushes us here on a dungeon
  // cell step, the request carries the dungeon id, optional seed,
  // and return-overworld coords. Read them once at mount; subsequent
  // navigation inside the launcher uses the React state below.
  const initialDungeonId = searchParams.get("id") ?? "";
  const initialSeed = searchParams.get("seed") ?? "";
  const returnMapId = searchParams.get("return") ?? "";
  const returnCol = Number.parseInt(searchParams.get("col") ?? "", 10);
  const returnRow = Number.parseInt(searchParams.get("row") ?? "", 10);
  const returnTo =
    returnMapId && Number.isFinite(returnCol) && Number.isFinite(returnRow)
      ? { mapId: returnMapId, col: returnCol, row: returnRow }
      : null;

  const [dungeons, setDungeons] = useState<DungeonRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialDungeonId);
  const [seedOverride, setSeedOverride] = useState<string>(initialSeed);
  const [floorIdx, setFloorIdx] = useState<number>(0);
  // Auto-start when we were routed in from an overworld entrance —
  // the player just stepped onto a dungeon cell, they don't want to
  // press another button.
  const [started, setStarted] = useState(!!initialDungeonId);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Darkness toggle — when on, the dungeon mount renders with the
  // "night" ambient lighting model (low ambient + Bresenham-LOS
  // falloff from torches). When off, full bright "day" so the
  // author can see every cell while iterating on layout. Default
  // on because dungeons are meant to be played dark; this lets you
  // confirm torch placement looks right.
  const [darkness, setDarkness] = useState<boolean>(true);
  // Infravision toggle — opt-in player switch that activates the
  // infravision render mode (red shades for in-LOS cells not lit
  // by another source). Off by default; engaging it without an
  // eligible roster member is a no-op on the sim side.
  const [infravisionActive, setInfravisionActive] = useState<boolean>(false);

  // Load the dungeons catalog (no draft awareness — we read the
  // published file). Authors who want to iterate on a draft hit
  // Publish first; this matches the rest of the simulator pages.
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
        if (list.length > 0) {
          setSelectedId((prev) => prev || list[0].id);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const selected = useMemo(
    () => dungeons.find((d) => d.id === selectedId) ?? null,
    [dungeons, selectedId],
  );

  // Generate every floor of the selected dungeon by reading the v2
  // record directly. The wrapper passes raw `size.width` /
  // `size.height` through to the generator and merges per-Level
  // overrides on top of the parent's defaults — see
  // `generateDungeonFromRecord`. The seed prefers the user's
  // override; otherwise we derive a stable one from the dungeon id
  // so re-mounts reproduce the layout.
  const generated = useMemo(() => {
    if (!selected || !started) return null;
    const seed =
      seedOverride.trim().length > 0
        ? Number.parseInt(seedOverride, 10) >>> 0
        : dungeonSeed(selected.id, 0, 0);
    if (!Number.isFinite(seed)) return null;
    const levels = generateDungeonFromRecord(selected, { seed });
    return { dungeon: selected, levels };
  }, [selected, started, seedOverride]);

  const totalFloors = generated?.levels.length ?? 0;
  const clampedFloor = totalFloors > 0
    ? Math.min(Math.max(0, floorIdx), totalFloors - 1)
    : 0;

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="font-display text-3xl text-parchment">
          Dungeon Simulator
        </h1>
        <p className="mt-1 text-sm text-parchment/55">
          Procedural dungeon walker. Pick a dungeon from{" "}
          <span className="font-mono">modules/{moduleId}/dungeons.json</span>
          ; the v1 generator runs against its parameters and the
          simulator drops the party in.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-parchment/45">
            Dungeon
          </label>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setStarted(false);
              setFloorIdx(0);
            }}
            disabled={dungeons.length === 0}
            className="min-w-[260px] rounded border border-parchment/30 bg-ink/60 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
          >
            {dungeons.length === 0 ? (
              <option value="">
                {loadError ? "(failed to load)" : "(no dungeons)"}
              </option>
            ) : (
              dungeons.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.levels?.length ?? 1} floor
                  {(d.levels?.length ?? 1) === 1 ? "" : "s"}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-parchment/45">
            Seed (optional)
          </label>
          <input
            type="text"
            value={seedOverride}
            onChange={(e) => {
              setSeedOverride(e.target.value);
              if (started) setStarted(false);
            }}
            placeholder="(deterministic from id)"
            className="w-[180px] rounded border border-parchment/30 bg-ink/60 px-2 py-1 font-mono text-sm text-parchment focus:border-parchment/60 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-parchment/45">
            Floor
          </label>
          <select
            value={clampedFloor}
            onChange={(e) => setFloorIdx(Number.parseInt(e.target.value, 10))}
            disabled={!selected}
            className="rounded border border-parchment/30 bg-ink/60 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
          >
            {Array.from(
              { length: Math.max(1, selected?.levels?.length ?? 1) },
              (_, i) => (
                <option key={i} value={i}>
                  Floor {i + 1}
                </option>
              ),
            )}
          </select>
        </div>

        <label
          className="flex cursor-pointer items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          title="Render with night-ambient lighting: low base brightness, Bresenham-LOS falloff from torches. Toggle off to see the dungeon fully lit while iterating on layout."
        >
          <input
            type="checkbox"
            checked={darkness}
            onChange={(e) => setDarkness(e.target.checked)}
            className="accent-ember"
          />
          Darkness
        </label>

        <label
          className="flex cursor-pointer items-center gap-2 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/80 hover:bg-ink/60"
          title="Engage the party's infravision ability (e.g. Dwarf). Every cell in LOS becomes visible — torchlit cells render normally, otherwise-dark cells render in shades of red. Has no effect when no roster member has the ability."
        >
          <input
            type="checkbox"
            checked={infravisionActive}
            onChange={(e) => setInfravisionActive(e.target.checked)}
            className="accent-ember"
          />
          Infravision
        </label>

        <button
          type="button"
          onClick={() => {
            setStarted((v) => !v);
          }}
          disabled={!selected}
          className="rounded border border-ember/60 bg-ember/30 px-4 py-1 text-sm text-parchment hover:bg-ember/50 disabled:opacity-50"
        >
          {started ? "Regenerate" : "Generate & Walk"}
        </button>
      </section>

      {loadError ? (
        <p className="mb-3 text-xs text-rust">
          Couldn&apos;t load dungeons.json: {loadError}
        </p>
      ) : null}

      {selected ? <FloorsPreview record={selected} /> : null}

      {generated && started ? (
        <DungeonSimMount
          // Remount on every regenerate / floor change / dungeon
          // switch so the scene starts from a clean state. The
          // darkness toggle does NOT participate in the key —
          // toggling it shouldn't tear down the game; the mount's
          // internal effect picks up the prop change and just
          // re-runs the lighting pass.
          key={`${generated.dungeon.id}:${seedOverride}:${clampedFloor}`}
          moduleId={moduleId}
          dungeonId={generated.dungeon.id}
          levels={generated.levels}
          floorIdx={clampedFloor}
          returnTo={returnTo}
          darkness={darkness}
          infravisionActive={infravisionActive}
        />
      ) : (
        <p className="text-sm text-parchment/45">
          Press <em>Generate &amp; Walk</em> to roll a floor and drop the
          party in.
        </p>
      )}
    </div>
  );
}

/**
 * Per-floor "what will actually be generated" preview. Reads each
 * Level's resolved (parent ⊕ override) options through
 * `resolveLevelOptions` and shows them in a compact table. Authors
 * use this to confirm:
 *   - The dungeon's required parent fields are populated.
 *   - Per-Level overrides are landing.
 *   - The size the generator will use matches the record.
 *
 * Highlights overridden fields in ember so the source of each value
 * is visible at a glance.
 */
function FloorsPreview({ record }: { record: DungeonRecord }) {
  if (!record.levels || record.levels.length === 0) {
    return (
      <p className="mb-3 text-xs text-rust/80">
        This dungeon has no Levels — add at least one in the Dungeons
        editor to generate floors.
      </p>
    );
  }
  return (
    <div className="mb-3 max-w-3xl rounded border border-parchment/15 bg-ink/40 p-3 text-xs text-parchment/65">
      {record.description ? (
        <p className="mb-2 italic text-parchment/75">{record.description}</p>
      ) : null}
      <table className="w-full">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-parchment/40">
            <th className="text-left font-normal">Floor</th>
            <th className="text-left font-normal">Style</th>
            <th className="text-left font-normal">Difficulty</th>
            <th className="text-left font-normal">Size</th>
            <th className="text-left font-normal">Torch</th>
            <th className="text-left font-normal">Locked</th>
          </tr>
        </thead>
        <tbody>
          {record.levels.map((lvl, i) => {
            const r = resolveLevelOptions(record, lvl, i);
            // Was each value overridden on the Level (vs inherited)?
            // Used to tint the cell so overrides read at a glance.
            const o = {
              style: lvl.style !== undefined,
              difficulty: lvl.difficulty !== undefined,
              size: lvl.size !== undefined,
              torch: lvl.torch_density !== undefined,
              locked: lvl.locked_doors !== undefined,
            };
            const tint = (on: boolean) =>
              on ? "text-ember" : "text-parchment/85";
            return (
              <tr key={lvl.id} className="border-t border-parchment/10">
                <td className="py-1 pr-3 text-parchment/85">
                  {lvl.name}{" "}
                  <span className="text-parchment/40">
                    (d{lvl.depth})
                  </span>
                </td>
                <td className={`py-1 pr-3 ${tint(o.style)}`}>{r.style}</td>
                <td className={`py-1 pr-3 ${tint(o.difficulty)}`}>
                  {r.difficulty}
                </td>
                <td className={`py-1 pr-3 font-mono ${tint(o.size)}`}>
                  {r.size.width}×{r.size.height}
                </td>
                <td className={`py-1 pr-3 ${tint(o.torch)}`}>
                  {r.torch_density}
                </td>
                <td className={`py-1 pr-3 ${tint(o.locked)}`}>
                  {r.locked_doors}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-parchment/40">
        Ember cells are per-Level overrides; parchment cells inherit
        from the parent Dungeon.
      </p>
    </div>
  );
}
