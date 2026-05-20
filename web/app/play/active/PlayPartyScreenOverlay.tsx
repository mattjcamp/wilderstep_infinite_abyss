"use client";

/**
 * Modal overlay that pops up the PartyScreen on top of the playable
 * game host when the player presses `P`. Mirrors the editor's
 * MapPartyScreenOverlay (same PartyScreen component, same close-on-P
 * ergonomics) but reads the LIVE save instead of the static module
 * catalog, so quest rewards / combat loot / gold-spent-at-shops are
 * actually visible.
 *
 * Merge model:
 *
 *   - PartyRecord — start from the merged party.json (so editor-side
 *     baselines like `roster` order survive), then overlay the live
 *     `save.party` fields (gold, inventory, torch_steps, etc.).
 *   - Characters — start from characters.json (canonical name / class
 *     / race / level / sprite), then for each member that has a
 *     SavedCharacterState, overlay its mutable in-play deltas (hp,
 *     mp, inventory). Custom characters in `save.party.members[]`
 *     whose `custom` blob carries a full character record (not yet
 *     wired here) would need a future merge branch — for now they
 *     fall through and don't appear.
 *
 * The screen itself is read-only — same caveat the editor preview
 * carries. Pressing P / ESC / clicking the backdrop dismisses.
 */

import { useCallback, useEffect, useState } from "react";
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
} from "@/editor/PartyScreen";
import type { WorldSave, SavedCharacterState } from "@/play/saveTypes";

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

export function PlayPartyScreenOverlay({
  moduleId,
  save,
  onClose,
  onMutateSave,
}: {
  moduleId: string;
  save: WorldSave;
  onClose: () => void;
  /** Mutator hook — called whenever a stash action (Use, Send) mutates
   *  the live save. The host writes the new value to localStorage and
   *  keeps its in-memory `saveRef.current` in sync so the rest of
   *  PlayHost sees the change immediately on close. Optional so legacy
   *  callers without persistence (tests, storybook) still mount. */
  onMutateSave?: (next: WorldSave) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeEffectIds, setActiveEffectIds] = useState<
    ReadonlyArray<string>
  >([]);
  /** Working copy of the save — seeded from the prop on mount and on
   *  every prop change. All stash mutations update this AND get
   *  pushed up via onMutateSave. Keeping a local copy means we can
   *  re-render the screen instantly without waiting for PlayHost to
   *  round-trip the change through its own state. */
  const [liveSave, setLiveSave] = useState<WorldSave>(save);
  useEffect(() => {
    setLiveSave(save);
  }, [save]);

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

        const staticParty =
          (mergeModel(
            "party",
            partyLayers.inherited,
            partyLayers.ownFile,
          ) as PartyRecord | null) ?? {};
        const staticCharacters =
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

        // Overlay live save state on top of the static party record.
        // Spread first so any extra v2 fields (custom palette colours,
        // etc.) survive; then explicitly override the play-mutable
        // ones with the save's current values.
        const party: PartyRecord = {
          ...staticParty,
          gold: liveSave.party.gold,
          roster: [...liveSave.party.roster],
          inventory: liveSave.party.inventory.map((e) => ({ ...e })),
          torch_steps: liveSave.party.torch_steps,
          galadriels_light_steps: liveSave.party.galadriels_light_steps,
        };

        // Per-member overlay: merge HP / MP / personal inventory from
        // SavedCharacterState onto the static characters.json entry
        // for the same id. Members not in the static catalog (custom
        // characters with a `custom` blob, theoretically) fall
        // through silently — populating their full record from the
        // blob is a follow-up.
        const savedById = new Map(
          liveSave.party.members.map((m) => [m.id, m] as const),
        );
        const characters: PartyCharacterRef[] = staticCharacters.map((c) => {
          const saved = savedById.get(c.id);
          if (!saved) return c;
          return {
            ...c,
            hp: saved.hp,
            mp: typeof saved.mp === "number" ? saved.mp : c.mp,
            inventory: saved.inventory
              ? saved.inventory.map((e) => ({ ...e }))
              : c.inventory,
          };
        });

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
    // Re-run when the save reference changes (e.g. after a quest
    // turn-in landed new items in the stash), or when a local
    // mutation updates `liveSave` (Use / Send) so the rendered
    // PartyRecord stays in lockstep with the latest write.
  }, [moduleId, liveSave]);

  // ── Stash mutation handlers ────────────────────────────────────
  // These translate UI intents (Use this stack, Send to character N)
  // into precise edits on the live save. We deliberately don't reach
  // for the PartyActions helpers (consumeTorch / giveStashItemTo) here
  // because those operate on the in-memory Party class instance — the
  // save is a plain serialisable record with a slightly different
  // shape (read-only arrays, no equipped_durability cache). Mirroring
  // the helpers' behaviour against the save shape directly keeps the
  // edit lossless across a JSON round-trip.

  /** Steps a fresh Torch lights for. Mirrors `TORCH_DEFAULT_STEPS` in
   *  PartyActions; duplicated here to keep this overlay decoupled from
   *  the battle module's class-instance Party. */
  const TORCH_DEFAULT_STEPS_LOCAL = 150;
  /** Default camping-supplies charges on a bare entry. Matches the
   *  catalog and the same constant in PartyActions. */
  const CAMPING_DEFAULT_CHARGES_LOCAL = 3;

  /** Apply a save mutation: update the local working copy, then push
   *  the new value upstream so PlayHost can persist + sync its ref. */
  const commit = useCallback(
    (next: WorldSave) => {
      setLiveSave(next);
      onMutateSave?.(next);
    },
    [onMutateSave],
  );

  /** "Use" a stash entry — decrements the right counter and pops the
   *  charge off the entry. Only Torch and Camping Supplies are wired
   *  to real behaviour today; any other `usable: true` item still
   *  consumes a charge but emits no side-effect (treated as a "you
   *  fiddle with it" no-op until its handler ships). */
  const handleUseStashItem = useCallback(
    (stashIndex: number) => {
      const cur = liveSave;
      const inv = cur.party.inventory;
      if (stashIndex < 0 || stashIndex >= inv.length) return;
      const entry = inv[stashIndex];
      let nextInv = inv.map((e) => ({ ...e }));
      let torchSteps = cur.party.torch_steps;
      const nextMembers: ReadonlyArray<SavedCharacterState> = cur.party.members;

      if (entry.item === "Torch" || entry.item === "torch") {
        // Pop one off the stack; splice the entry when the stack
        // empties so the stash doesn't accumulate zero-count rows.
        const charges = (entry.charges ?? 1) - 1;
        if (charges <= 0) {
          nextInv = nextInv.filter((_, i) => i !== stashIndex);
        } else {
          nextInv[stashIndex] = { ...entry, charges };
        }
        torchSteps = Math.max(torchSteps, 0) + TORCH_DEFAULT_STEPS_LOCAL;
      } else if (
        entry.item === "Camping Supplies" ||
        entry.item === "camping_supplies"
      ) {
        // Camping Supplies' full HP/MP restore needs the per-member
        // max_hp / max_mp peak — which the WorldSave doesn't track
        // yet (see seedBattleCaches.ts: "a proper peak field comes
        // later"). For now we just decrement the charges so the stack
        // shows depletion; the actual restore is a TODO that wires up
        // alongside the missing peak fields. This still surfaces the
        // action to the player without quietly faking a heal that
        // could leave save state in a weird state.
        const charges = (entry.charges ?? CAMPING_DEFAULT_CHARGES_LOCAL) - 1;
        if (charges <= 0) {
          nextInv = nextInv.filter((_, i) => i !== stashIndex);
        } else {
          nextInv[stashIndex] = { ...entry, charges };
        }
      } else {
        // Unknown / not-yet-wired usable. Treat as a no-op so the
        // player gets feedback (the row stays selected, but nothing
        // changes) — the catalog item.usable still gated this in the
        // PartyScreen, so we know SOMETHING was supposed to happen.
        return;
      }

      const next: WorldSave = {
        ...cur,
        party: {
          ...cur.party,
          inventory: nextInv,
          torch_steps: torchSteps,
          members: nextMembers,
        },
      };
      commit(next);
    },
    [liveSave, commit],
  );

  /** "Send" — move one entry from the shared stash into the personal
   *  inventory of the roster member at `memberIndex`. */
  const handleSendStashItem = useCallback(
    (stashIndex: number, memberIndex: number) => {
      const cur = liveSave;
      const inv = cur.party.inventory;
      const roster = cur.party.roster;
      if (stashIndex < 0 || stashIndex >= inv.length) return;
      if (memberIndex < 0 || memberIndex >= roster.length) return;
      const targetId = roster[memberIndex];
      const targetSaved = cur.party.members.find((m) => m.id === targetId);
      if (!targetSaved) return;

      const entry = inv[stashIndex];
      const nextInv = inv.filter((_, i) => i !== stashIndex);
      const nextTarget: SavedCharacterState = {
        ...targetSaved,
        inventory: [...targetSaved.inventory, { ...entry }],
      };
      const nextMembers = cur.party.members.map((m) =>
        m.id === targetId ? nextTarget : m,
      );
      commit({
        ...cur,
        party: { ...cur.party, inventory: nextInv, members: nextMembers },
      });
    },
    [liveSave, commit],
  );

  // ESC and P both close. Stop propagation so the underlying sim's
  // movement keys (or the host's own P listener that opened us) don't
  // fire while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
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
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Party Screen
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Close (P or ESC)"
          >
            Close
          </button>
        </div>
        <div className="p-3">
          {state.kind === "loading" ? (
            <p className="text-sm text-parchment/55">Loading party…</p>
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
              onUseStashItem={handleUseStashItem}
              onSendStashItem={handleSendStashItem}
            />
          )}
        </div>
      </div>
    </div>
  );
}
