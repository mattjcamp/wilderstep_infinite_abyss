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
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import {
  _clearEncountersCache,
  loadEncounters,
  type EncounterTemplate,
} from "@/battle/world/Encounters";
import {
  _clearMonstersCache,
  loadMonsters,
  type MonsterSpec,
} from "@/battle/data/monsters";
import { setActiveModule } from "@/battle/world/Module";
import {
  generateDungeonFromRecord,
  resolveLevelOptions,
} from "@/sim/dungeon/generateFromRecord";
import {
  clearDungeonSession,
  getOrCreateDungeonSession,
} from "@/sim/dungeon/dungeonSession";
import type { DungeonRecord } from "@/sim/dungeon/types";
import { DungeonSimMount } from "./DungeonSimMount";
import { createMapsFromDungeon } from "./createMapsFromDungeon";
import { editorMapHref } from "../moduleRoutes";
import Link from "next/link";

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
  // Seed used when the Seed field is blank — a fresh random roll for
  // every Generate / Regenerate, like a new run in game. (It used to
  // be derived from the dungeon id, so every regenerate produced the
  // same layout.) Shown under the controls so a layout can be
  // replayed by typing it into the Seed field.
  const [rolledSeed, setRolledSeed] = useState<number>(() => randomSeed());
  // "Create maps from this layout" status for the current run.
  const [createState, setCreateState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; mapIds: string[]; groupTag: string; publishedDirectly: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
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
  // Fog of war toggle — off reveals the whole floor (lighting still
  // applies), so authors can check a layout without exploring it.
  const [fogOfWar, setFogOfWar] = useState<boolean>(true);
  // Encounters table + monsters catalog — loaded once per module
  // mount. The generator samples encounters per non-entrance room
  // (`sampleEncounter` inside v1's `placeRandomEncounters`), and
  // the monsters catalog provides both the per-monster difficulty
  // tier (so a "normal" dungeon doesn't pull in "hard" monsters
  // through a mixed roster) and the sprite paths the placed-
  // encounter renderer hands to Phaser.
  const [encountersTable, setEncountersTable] = useState<
    Record<string, EncounterTemplate[]>
  >({});
  const [monstersCatalog, setMonstersCatalog] = useState<
    Map<string, MonsterSpec>
  >(() => new Map());

  // Load the dungeons catalog (no draft awareness — we read the
  // published file). Authors who want to iterate on a draft hit
  // Publish first; this matches the rest of the simulator pages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = getEditorModuleSource();
        // Pin the battle loaders at this module + flush their
        // module-scoped caches so a swap to a different module
        // doesn't see stale encounters / monsters.
        setActiveModule(moduleId);
        _clearEncountersCache();
        _clearMonstersCache();
        // Three catalogs in parallel:
        //   - dungeons.json (v2 records) — the picker reads these
        //   - encounters.json (battle loader, area-bucketed) —
        //     the generator samples from `encounters.dungeon`
        //   - monsters.json (battle loader) — supplies
        //     per-monster difficulty tier + sprite paths
        const [layers, encs, mons] = await Promise.all([
          src.loadModelLayers(moduleId, "dungeons"),
          loadEncounters().catch(() => ({}) as Record<string, EncounterTemplate[]>),
          loadMonsters().catch(() => new Map<string, MonsterSpec>()),
        ]);
        const merged = mergeModel(
          "dungeons",
          layers.inherited,
          layers.ownFile,
        ) as { dungeons?: DungeonRecord[] } | null;
        if (cancelled) return;
        const list = merged?.dungeons ?? [];
        setDungeons(list);
        setEncountersTable(encs);
        setMonstersCatalog(mons);
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

  // Pull levels out of the dungeon-session store. The session is
  // created on first entry and reused for every subsequent mount
  // — re-entering the same dungeon (overworld → entrance → back
  // → entrance) shows the SAME generated layout with whatever
  // mutations (defeated encounters, picked locks, etc.) the party
  // accumulated. The session is keyed by dungeon id; a new seed
  // (manual override) is treated as a fresh roll.
  const generated = useMemo(() => {
    if (!selected || !started) return null;
    const seed =
      seedOverride.trim().length > 0
        ? Number.parseInt(seedOverride, 10) >>> 0
        : rolledSeed;
    if (!Number.isFinite(seed)) return null;
    const session = getOrCreateDungeonSession(selected.id, seed, () => {
      // monsterDifficulty closure — looks up the per-monster
      // difficulty tag so `sampleEncounter` can prune rosters
      // that mix tiers. Captured into the closure to avoid
      // passing the catalog through the API surface.
      const monsterDifficulty = (id: string): string | undefined =>
        monstersCatalog.get(id)?.difficulty;
      return generateDungeonFromRecord(selected, {
        seed,
        encounters: encountersTable,
        monsterDifficulty,
      });
    });
    return { dungeon: selected, levels: session.levels };
  }, [selected, started, seedOverride, rolledSeed, encountersTable, monstersCatalog]);

  // A new layout starts with nothing created from it yet.
  useEffect(() => {
    setCreateState({ kind: "idle" });
  }, [generated]);

  const effectiveSeed =
    seedOverride.trim().length > 0
      ? Number.parseInt(seedOverride, 10) >>> 0
      : rolledSeed;

  /** Save the current layout as regular maps (one per floor). The
   *  floors are regenerated from the same seed + catalogs, so they
   *  match what's on screen but carry nothing the party did here. */
  const onCreateMaps = async () => {
    if (!selected || !Number.isFinite(effectiveSeed)) return;
    setCreateState({ kind: "working" });
    try {
      const monsterDifficulty = (id: string): string | undefined =>
        monstersCatalog.get(id)?.difficulty;
      const levels = generateDungeonFromRecord(selected, {
        seed: effectiveSeed,
        encounters: encountersTable,
        monsterDifficulty,
      });
      const res = await createMapsFromDungeon({
        moduleId,
        record: selected,
        levels,
        seed: effectiveSeed,
      });
      setCreateState({ kind: "done", ...res });
    } catch (e) {
      setCreateState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

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
        <p className="mt-1 text-sm text-parchment/75">
          Procedural dungeon walker. Pick a dungeon from{" "}
          <span className="font-mono">modules/{moduleId}/dungeons.json</span>
          ; the v1 generator runs against its parameters and the
          simulator drops the party in.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-parchment/65">
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
          <label className="text-xs uppercase tracking-wide text-parchment/65">
            Seed (optional)
          </label>
          <input
            type="text"
            value={seedOverride}
            onChange={(e) => {
              setSeedOverride(e.target.value);
              if (started) setStarted(false);
            }}
            placeholder="(random each time)"
            className="w-[180px] rounded border border-parchment/30 bg-ink/60 px-2 py-1 font-mono text-sm text-parchment focus:border-parchment/60 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-parchment/65">
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
          title="Hide cells the party hasn't seen yet. Toggle off to reveal the whole floor (lighting still applies — turn Darkness off too to see everything)."
        >
          <input
            type="checkbox"
            checked={fogOfWar}
            onChange={(e) => setFogOfWar(e.target.checked)}
            className="accent-ember"
          />
          Fog of war
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
            // Every press rolls a new layout: clear the session (the
            // store otherwise hands back the same generated levels —
            // dungeons are rolled once per game) and, unless a seed
            // was typed, draw a fresh random seed. Regenerate goes
            // straight to the new floor rather than stopping first.
            if (selected) clearDungeonSession(selected.id);
            setRolledSeed(randomSeed());
            setStarted(true);
          }}
          disabled={!selected}
          className="rounded border border-ember/60 bg-ember/30 px-4 py-1 text-sm text-parchment hover:bg-ember/50 disabled:opacity-50"
        >
          {started ? "Regenerate" : "Generate & Walk"}
        </button>
      </section>

      {loadError ? (
        <p className="mb-3 text-[13px] text-rust">
          Couldn&apos;t load dungeons.json: {loadError}
        </p>
      ) : null}

      {selected ? <FloorsPreview record={selected} /> : null}

      {generated && started ? (
        <p className="mb-2 text-[13px] text-parchment/70">
          Seed{" "}
          <span className="font-mono text-parchment/90">
            {seedOverride.trim() ? seedOverride.trim() : rolledSeed}
          </span>
          {seedOverride.trim() ? <> (typed — Regenerate replays this layout)</> : null}
          {" · "}
          {createState.kind === "done" ? (
            <span className="text-parchment/85">
              Created {createState.mapIds.length} map
              {createState.mapIds.length === 1 ? "" : "s"} tagged{" "}
              <span className="font-mono">{createState.groupTag}</span>
              {createState.publishedDirectly
                ? " (written to disk)"
                : " (saved to the maps draft)"}
              .{" "}
              <Link
                href={editorMapHref(moduleId, createState.mapIds[0])}
                className="text-amber-200 underline decoration-dotted hover:text-parchment"
              >
                Open floor 1 in the Map Editor →
              </Link>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void onCreateMaps()}
              disabled={createState.kind === "working"}
              className="rounded border border-parchment/30 px-2 py-0.5 text-parchment/90 hover:bg-ink/50 disabled:opacity-50"
              title="Save this layout as regular maps (one per floor, stairs linked) that you can fine-tune in the Map Editor"
            >
              {createState.kind === "working"
                ? "Creating maps…"
                : "＋ Create maps from this layout"}
            </button>
          )}
          {createState.kind === "error" ? (
            <span className="ml-2 text-ember">{createState.message}</span>
          ) : null}
        </p>
      ) : null}

      {generated && started ? (
        <DungeonSimMount
          // Remount on every regenerate / floor change / dungeon
          // switch so the scene starts from a clean state. The
          // darkness toggle does NOT participate in the key —
          // toggling it shouldn't tear down the game; the mount's
          // internal effect picks up the prop change and just
          // re-runs the lighting pass.
          key={`${generated.dungeon.id}:${seedOverride}:${rolledSeed}:${clampedFloor}`}
          moduleId={moduleId}
          dungeonId={generated.dungeon.id}
          levels={generated.levels}
          floorIdx={clampedFloor}
          returnTo={returnTo}
          darkness={darkness}
          infravisionActive={infravisionActive}
          fogOfWar={fogOfWar}
        />
      ) : (
        <p className="text-sm text-parchment/65">
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
      <p className="mb-3 text-[13px] text-rust/80">
        This dungeon has no Levels — add at least one in the Dungeons
        editor to generate floors.
      </p>
    );
  }
  return (
    <div className="mb-3 max-w-3xl rounded border border-parchment/15 bg-ink/40 p-3 text-[13px] text-parchment/80">
      {record.description ? (
        <p className="mb-2 italic text-parchment/75">{record.description}</p>
      ) : null}
      <table className="w-full">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-parchment/60">
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
                  <span className="text-parchment/60">
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
      <p className="mt-2 text-xs text-parchment/60">
        Ember cells are per-Level overrides; parchment cells inherit
        from the parent Dungeon.
      </p>
    </div>
  );
}

/** A random 31-bit seed (same range the game rolls for a new run). */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
