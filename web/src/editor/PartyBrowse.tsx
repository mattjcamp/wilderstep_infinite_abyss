"use client";

/**
 * Party-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "party".
 *
 * The in-game <PartyScreen> preview is the *primary* view — same
 * component the map simulator pops up with `P`. The raw JSON
 * <ModelView> editor is collapsed behind an "Edit" toggle so the
 * designer-facing visual is the default, and the
 * fields-and-inheritance surface is one click away when needed.
 *
 * The preview reads the *effective* party (own-file overlay over any
 * inherited Party record) so changes show up as you edit. Effect
 * assignment is held in local React state — purely a preview today
 * (no persistence target yet).
 */

import { useEffect, useState } from "react";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { ModelView } from "./ModelView";
import {
  PartyScreen,
  type PartyAbilityRef,
  type PartyCharacterRef,
  type PartyClassRef,
  type PartyItemRef,
  type PartyRaceRef,
  type PartyRecord,
  type PartySpellRef,
} from "./PartyScreen";

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      party: PartyRecord;
      characters: PartyCharacterRef[];
      races: PartyRaceRef[];
      classes: PartyClassRef[];
      abilities: PartyAbilityRef[];
      items: PartyItemRef[];
      spells: PartySpellRef[];
    }
  | { kind: "error"; message: string };

export function PartyBrowse({ moduleId }: { moduleId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** Which abilities the user has flagged active in the preview. */
  const [activeEffectIds, setActiveEffectIds] = useState<
    ReadonlyArray<string>
  >([]);
  /** True when the raw JSON / inheritance editor is expanded. The
   *  preview is the primary surface; raw field tweaks live one click
   *  away. */
  const [editing, setEditing] = useState(false);

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
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
          src.loadModelLayers(moduleId, "items"),
          src.loadModelLayers(moduleId, "spells"),
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

        setState({
          kind: "ok",
          party,
          characters,
          races,
          classes,
          abilities,
          items,
          spells,
        });
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

  return (
    <div className="space-y-4 p-4">
      {/* PRIMARY — in-game P screen preview. */}
      <section>
        <header className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 className="font-display text-lg text-parchment">
            In-Game Party Screen{" "}
            <span className="text-xs text-parchment/50">
              (same component the map simulator pops up with{" "}
              <kbd className="rounded border border-parchment/30 px-1">
                P
              </kbd>
              )
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className={[
              "rounded border px-3 py-1 text-sm",
              editing
                ? "border-ember/60 bg-ember/30 text-parchment hover:bg-ember/50"
                : "border-parchment/30 text-parchment/85 hover:bg-ink/40",
            ].join(" ")}
            title="Open the raw JSON / inheritance editor"
          >
            {editing ? "Close Edit" : "Edit JSON"}
          </button>
        </header>
        {state.kind === "loading" ? (
          <p className="px-1 text-sm text-parchment/55">Loading party…</p>
        ) : state.kind === "error" ? (
          <p className="px-1 text-sm text-ember">
            Failed to load party preview: {state.message}
          </p>
        ) : (
          <PartyScreen
            party={state.party}
            characters={state.characters}
            races={state.races}
            classes={state.classes}
            abilities={state.abilities}
            items={state.items}
            spells={state.spells}
            activeEffectIds={activeEffectIds}
            onActiveEffectsChange={setActiveEffectIds}
          />
        )}
      </section>

      {/* SECONDARY — raw JSON / inheritance editor. Hidden until
          the user clicks Edit. Mounted only while open so its data
          loads on demand. */}
      {editing ? (
        <section className="rounded border border-parchment/15 bg-ink/30">
          <ModelView moduleId={moduleId} modelKey="party" />
        </section>
      ) : null}
    </div>
  );
}
