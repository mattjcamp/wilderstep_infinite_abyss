"use client";

/**
 * BattleSimLauncher — encounter + map picker for the battle sim. Once
 * the user picks both and clicks "Start Battle", we mount the Phaser
 * scene inside a `<div>` ref. The scene owns everything from there:
 * map tile rendering, combatant sprites, the v1-style HUD, the
 * battle log, keyboard input.
 *
 * The launcher itself is React — that's the only part where React
 * touches combat. Inside the Phaser canvas there is *no* React.
 */

import { useEffect, useMemo, useState } from "react";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import type {
  PartyAbilityRef,
  PartyCharacterRef,
  PartyClassRef,
  PartyItemRef,
  PartyRaceRef,
  PartyRecord,
  PartySpellRef,
} from "@/editor/PartyScreen";
import type {
  BattleEncounterRef,
  BattleMonsterRef,
} from "@/sim/battle/types";
import { BattleSimMount, type BattleSimMapRecord } from "./BattleSimMount";

interface LoadedCatalogs {
  party: PartyRecord;
  characters: PartyCharacterRef[];
  races: PartyRaceRef[];
  classes: PartyClassRef[];
  abilities: PartyAbilityRef[];
  items: PartyItemRef[];
  spells: PartySpellRef[];
  encounters: BattleEncounterRef[];
  monsters: BattleMonsterRef[];
  maps: BattleSimMapRecord[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; catalogs: LoadedCatalogs }
  | { kind: "error"; message: string };

export function BattleSimLauncher({ moduleId }: { moduleId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [encounterId, setEncounterId] = useState<string>("");
  const [mapId, setMapId] = useState<string>("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = new StaticModuleSource();
        const [
          partyLayers,
          charactersLayers,
          racesLayers,
          classesLayers,
          abilitiesLayers,
          itemsLayers,
          spellsLayers,
          encountersLayers,
          monstersLayers,
          mapsLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
          src.loadModelLayers(moduleId, "items"),
          src.loadModelLayers(moduleId, "spells"),
          src.loadModelLayers(moduleId, "encounters"),
          src.loadModelLayers(moduleId, "monsters"),
          src.loadModelLayers(moduleId, "maps"),
        ]);
        if (cancelled) return;

        const party =
          (mergeModel("party", partyLayers.inherited, partyLayers.ownFile) as
            | PartyRecord
            | null) ?? {};
        const characters =
          (mergeModel(
            "characters",
            charactersLayers.inherited,
            charactersLayers.ownFile,
          ) as { characters?: PartyCharacterRef[] } | null)?.characters ?? [];
        const races =
          (mergeModel(
            "races",
            racesLayers.inherited,
            racesLayers.ownFile,
          ) as { races?: PartyRaceRef[] } | null)?.races ?? [];
        const classes =
          (mergeModel(
            "character_classes",
            classesLayers.inherited,
            classesLayers.ownFile,
          ) as { character_classes?: PartyClassRef[] } | null)
            ?.character_classes ?? [];
        const abilities =
          (mergeModel(
            "abilities",
            abilitiesLayers.inherited,
            abilitiesLayers.ownFile,
          ) as { abilities?: PartyAbilityRef[] } | null)?.abilities ?? [];
        const items =
          (mergeModel(
            "items",
            itemsLayers.inherited,
            itemsLayers.ownFile,
          ) as { items?: PartyItemRef[] } | null)?.items ?? [];
        const spells =
          (mergeModel(
            "spells",
            spellsLayers.inherited,
            spellsLayers.ownFile,
          ) as { spells?: PartySpellRef[] } | null)?.spells ?? [];
        const encounters =
          (mergeModel(
            "encounters",
            encountersLayers.inherited,
            encountersLayers.ownFile,
          ) as { encounters?: BattleEncounterRef[] } | null)?.encounters ??
          [];
        const monsters =
          (mergeModel(
            "monsters",
            monstersLayers.inherited,
            monstersLayers.ownFile,
          ) as { monsters?: BattleMonsterRef[] } | null)?.monsters ?? [];
        const maps =
          (mergeModel(
            "maps",
            mapsLayers.inherited,
            mapsLayers.ownFile,
          ) as { maps?: BattleSimMapRecord[] } | null)?.maps ?? [];

        setState({
          kind: "ok",
          catalogs: {
            party,
            characters,
            races,
            classes,
            abilities,
            items,
            spells,
            encounters,
            monsters,
            maps,
          },
        });
        // Default selections: party's seed start_position map if it
        // resolves to a known map id; first encounter otherwise.
        const startPos = (party as { start_position?: { map_id?: string } })
          .start_position;
        const defaultMap = startPos?.map_id;
        if (defaultMap && maps.some((m) => m.id === defaultMap)) {
          setMapId(defaultMap);
        } else if (maps[0]) {
          setMapId(maps[0].id);
        }
        if (encounters[0]) setEncounterId(encounters[0].id);
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  const chosenEncounter = useMemo<BattleEncounterRef | null>(() => {
    if (state.kind !== "ok") return null;
    return state.catalogs.encounters.find((e) => e.id === encounterId) ?? null;
  }, [state, encounterId]);
  const chosenMap = useMemo<BattleSimMapRecord | null>(() => {
    if (state.kind !== "ok") return null;
    return state.catalogs.maps.find((m) => m.id === mapId) ?? null;
  }, [state, mapId]);

  if (state.kind === "loading") {
    return (
      <p className="p-4 text-sm text-parchment/55">
        Loading battle catalogs…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load battle catalogs.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  // ── Render: header + pickers + (optional) mounted scene ─────────
  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="font-display text-3xl text-parchment">
          Battle Simulator
        </h1>
        <p className="mt-1 text-sm text-parchment/55">
          Pick an Encounter and a Map. The simulator mounts a
          self-contained Phaser scene that drives combat against your
          current Party using the v1-style HUD inside the canvas.
        </p>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-parchment/55">
            Encounter
          </span>
          <select
            value={encounterId}
            onChange={(e) => {
              setEncounterId(e.target.value);
              if (started) setStarted(false);
            }}
            className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/90"
          >
            <option value="" disabled>
              — pick an encounter —
            </option>
            {state.catalogs.encounters.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name ?? e.id} · L{e.level ?? "?"} ·{" "}
                {(e.monsters?.length ?? 0)} mon
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-parchment/55">
            Map (arena)
          </span>
          <select
            value={mapId}
            onChange={(e) => {
              setMapId(e.target.value);
              if (started) setStarted(false);
            }}
            className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment/90"
          >
            <option value="" disabled>
              — pick a map —
            </option>
            {state.catalogs.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.id} · {m.width}×{m.height}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setStarted(true)}
          disabled={!chosenEncounter || !chosenMap}
          className="self-end rounded border border-ember/60 bg-ember/30 px-4 py-1 text-sm text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {started ? "Restart Battle" : "Start Battle"}
        </button>
      </section>

      {started && chosenEncounter && chosenMap ? (
        <BattleSimMount
          // Remount the scene whenever the user clicks Start again or
          // picks a new encounter/map. Phaser games are mounted only
          // once per instance.
          key={`${chosenEncounter.id}:${chosenMap.id}:${started ? 1 : 0}`}
          encounter={chosenEncounter}
          map={chosenMap}
          party={state.catalogs.party}
          characters={state.catalogs.characters}
          races={state.catalogs.races}
          classes={state.catalogs.classes}
          abilities={state.catalogs.abilities}
          items={state.catalogs.items}
          spells={state.catalogs.spells}
          monsters={state.catalogs.monsters}
        />
      ) : (
        <p className="text-sm text-parchment/45">
          Pick an encounter and a map, then press <em>Start Battle</em>{" "}
          to mount the simulator.
        </p>
      )}
    </div>
  );
}
