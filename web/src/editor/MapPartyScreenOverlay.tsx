"use client";

/**
 * Modal overlay that pops up the PartyScreen on top of the map editor
 * during simulation mode. Bound to the `P` key by MapEditor.
 *
 * Self-contained: loads the module's party, characters, races,
 * classes, abilities, and items once on mount; renders the
 * preview component inside a centered card with a dim backdrop.
 * Pressing the same key again — or ESC, or clicking the backdrop —
 * dismisses it.
 */

import { useCallback, useEffect, useState } from "react";
import { loadDraft, saveDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
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

export function MapPartyScreenOverlay({
  moduleId,
  onClose,
}: {
  moduleId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeEffectIds, setActiveEffectIds] = useState<
    ReadonlyArray<string>
  >([]);

  /** Reorder handler — drag-and-drop on the roster writes the new
   *  order into the party draft (localStorage) so the Party editor +
   *  any later sim session see the change. Local state updates in
   *  place to keep the overlay responsive.
   *
   *  `saveDraft` is async (gzip); fire-and-forget per the same
   *  rationale documented in PartyBrowse.onReorderRoster. */
  const onReorderRoster = useCallback(
    (newOrder: string[]) => {
      setState((prev) => {
        if (prev.kind !== "ok") return prev;
        const nextParty: PartyRecord = { ...prev.party, roster: newOrder };
        void saveDraft(
          moduleId,
          "party",
          nextParty as unknown as Record<string, unknown>,
        );
        return { ...prev, party: nextParty };
      });
    },
    [moduleId],
  );

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

        // Honor any pending party draft so reorders done in the Party
        // editor (or earlier in this sim session) are reflected here.
        const partyDraft = await loadDraft<Record<string, unknown>>(
          moduleId,
          "party",
        );
        const partyOwn = partyDraft ?? partyLayers.ownFile;
        const party =
          (mergeModel("party", partyLayers.inherited, partyOwn) as
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

  // P closes the screen. Esc is owned by PartyScreen end-to-end now
  // (so Esc-inside-a-drilled-in-character-sheet can pop back to the
  // two-pane view instead of dismissing the whole modal); see the
  // `onClose` prop comment on PartyScreen for the full rationale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "w" ||
        e.key === "a" ||
        e.key === "s" ||
        e.key === "d" ||
        e.key === "W" ||
        e.key === "A" ||
        e.key === "S" ||
        e.key === "D"
      ) {
        // Keep sim movement keys from "leaking through" the modal.
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      // Backdrop — click to close.
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        // Inner card — click events stay inside.
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Party Screen{" "}
            <span className="text-[13px] text-parchment/65">
              (sim preview)
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Close (P or ESC)"
          >
            Close
          </button>
        </div>
        <div className="p-3">
          {state.kind === "loading" ? (
            <p className="text-sm text-parchment/75">Loading party…</p>
          ) : state.kind === "error" ? (
            <p className="text-sm text-ember">{state.message}</p>
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
              onReorderRoster={onReorderRoster}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
