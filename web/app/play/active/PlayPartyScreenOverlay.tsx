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
import {
  addToInventory,
  consumeOneFromInventory,
} from "@/play/inventoryStacking";

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
      /** Static (catalog) HP/MP indexed by character id. Used by the
       *  Heal handler to cap the live HP at the character's max HP —
       *  the save shape only carries current HP, not the peak. */
      maxHpById: Map<string, number>;
      maxMpById: Map<string, number>;
    }
  | { kind: "error"; message: string };

/** A pending "Cast Heal" that's waiting for a target pick. While
 *  non-null the overlay renders a target picker over the screen. */
interface PendingHeal {
  casterId: string;
  spellId: string;
}

export function PlayPartyScreenOverlay({
  moduleId,
  save,
  onClose,
  onMutateSave,
  onSpellCast,
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
  /** Fires AFTER a spell successfully lands (MP deducted, save
   *  committed). The host uses this to play the spell's animation +
   *  sound on the party cell — the overlay has no access to the
   *  Phaser scene from here, but the host owns the renderer. */
  onSpellCast?: (spellId: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** The list of currently-active party-wide effect ids. Seeded from
   *  the save's `party_effects` (so reopening the screen shows the
   *  effects the player turned on previously) and pushed back into
   *  the save by `handleActiveEffectsChange` below. */
  const [activeEffectIds, setActiveEffectIds] = useState<
    ReadonlyArray<string>
  >(() => [...(save.party.party_effects ?? [])]);
  /** Set when the player clicks Cast on a heal spell — the overlay
   *  then renders a target-picker modal listing the roster. Cleared
   *  on pick or cancel. */
  const [pendingHeal, setPendingHeal] = useState<PendingHeal | null>(null);
  /** Transient banner shown after a successful cast / failed cast so
   *  the player gets feedback ("Aldric heals Brenna for 4 HP",
   *  "Not enough MP", etc.). Auto-clears after a short timeout. */
  const [castMessage, setCastMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!castMessage) return;
    const t = setTimeout(() => setCastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [castMessage]);
  /** Working copy of the save — seeded from the prop on mount and on
   *  every prop change. All stash mutations update this AND get
   *  pushed up via onMutateSave. Keeping a local copy means we can
   *  re-render the screen instantly without waiting for PlayHost to
   *  round-trip the change through its own state. */
  const [liveSave, setLiveSave] = useState<WorldSave>(save);
  useEffect(() => {
    setLiveSave(save);
    // Re-sync the effects list whenever the upstream save changes —
    // the world sim ticks Galadriel's Light down per step and may
    // have auto-expired the effect since the overlay last opened.
    setActiveEffectIds([...(save.party.party_effects ?? [])]);
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
        // Capture static (catalog) HP/MP before the overlay step so
        // heal handlers can cap at the peak. The save shape only
        // tracks current HP, so without these maps we'd have nothing
        // to compare against.
        const maxHpById = new Map<string, number>();
        const maxMpById = new Map<string, number>();
        for (const c of staticCharacters) {
          if (typeof c.hp === "number") maxHpById.set(c.id, c.hp);
          if (typeof c.mp === "number") maxMpById.set(c.id, c.mp);
        }
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
          maxHpById,
          maxMpById,
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

  /** Apply a save mutation: update the local working copy, then push
   *  the new value upstream so PlayHost can persist + sync its ref. */
  const commit = useCallback(
    (next: WorldSave) => {
      setLiveSave(next);
      onMutateSave?.(next);
    },
    [onMutateSave],
  );

  /** Per-effect activation side-effects. Mirrors what
   *  PartyActions.assignEffectToParty does for the in-memory Party
   *  class instance — but written against the JSON-safe save shape
   *  since the active overlay doesn't hold a Party class. Only the
   *  effects that have a concrete sim consumer are wired here; the
   *  rest just sit in `party_effects` so the Effects list shows them
   *  as on (and downstream consumers can opt in later without a
   *  schema change). */
  const handleActiveEffectsChange = useCallback(
    (nextIds: ReadonlyArray<string>) => {
      if (state.kind !== "ok") return;
      const prev = new Set(liveSave.party.party_effects ?? []);
      const next = new Set(nextIds);
      const added: string[] = [];
      const removed: string[] = [];
      for (const id of next) if (!prev.has(id)) added.push(id);
      for (const id of prev) if (!next.has(id)) removed.push(id);

      // Snapshot counters we'll potentially mutate. The save's
      // boolean / number fields are immutable in the ReadonlyArray-
      // typed shape; we mirror them into mutable locals and write
      // back at the bottom.
      let galadriels = liveSave.party.galadriels_light_steps;
      let infravision = liveSave.party.infravision_active;

      const abilityById = new Map(
        state.abilities.map((a) => [a.id, a] as const),
      );

      for (const id of added) {
        const ability = abilityById.get(id);
        if (id === "galadriels_light") {
          // Seed the step counter from the ability's duration. Falls
          // back to 500 — same default as the Python game — when the
          // catalog leaves duration off.
          const dur =
            typeof ability?.duration === "number" ? ability.duration : 500;
          galadriels = dur;
        } else if (id === "infravision") {
          infravision = true;
        }
      }
      let magicLight = liveSave.party.magic_light_steps ?? 0;
      for (const id of removed) {
        if (id === "galadriels_light") {
          galadriels = 0;
        } else if (id === "magic_light") {
          // Allow dismissing a cast Light spell by un-checking it in
          // the Effects list. Mirrors the galadriels_light branch so
          // both light effects can be toggled off the same way.
          magicLight = 0;
        } else if (id === "infravision") {
          infravision = false;
        }
      }

      setActiveEffectIds(nextIds);
      commit({
        ...liveSave,
        party: {
          ...liveSave.party,
          party_effects: [...nextIds],
          galadriels_light_steps: galadriels,
          magic_light_steps: magicLight,
          infravision_active: infravision,
        },
      });
    },
    [state, liveSave, commit],
  );

  /** "Use" a stash entry — decrements the stack by ONE physical item
   *  via the shared inventory-stacking helper and applies the per-use
   *  effect from the catalog (Torch: bump torch_steps by the item's
   *  burn duration; Camping Supplies: trigger the rest mechanic when
   *  it lands). For unknown/not-yet-wired usables we bail out without
   *  consuming the stack so the player doesn't lose a Torch to a
   *  no-op click. */
  const handleUseStashItem = useCallback(
    (stashIndex: number) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const inv = cur.party.inventory;
      if (stashIndex < 0 || stashIndex >= inv.length) return;
      const entry = inv[stashIndex];
      const catItem = state.items.find((it) => it.id === entry.item);

      let torchSteps = cur.party.torch_steps;
      const nextMembers: ReadonlyArray<SavedCharacterState> = cur.party.members;

      if (entry.item === "Torch" || entry.item === "torch") {
        // Catalog charges is the burn duration; falls back to the
        // local default if a module ships a Torch without the field.
        torchSteps =
          Math.max(torchSteps, 0) +
          (typeof catItem?.charges === "number"
            ? catItem.charges
            : TORCH_DEFAULT_STEPS_LOCAL);
      } else if (
        entry.item === "Camping Supplies" ||
        entry.item === "camping_supplies"
      ) {
        // Camping Supplies' full HP/MP restore needs the per-member
        // max_hp / max_mp peak — which the WorldSave doesn't track
        // yet (see seedBattleCaches.ts: "a proper peak field comes
        // later"). For now we just consume one unit so the stack
        // shows depletion; the actual restore is a TODO that wires
        // up alongside the missing peak fields. This still surfaces
        // the action to the player without quietly faking a heal
        // that could leave save state in a weird state.
      } else {
        // Unknown / not-yet-wired usable. Bail without mutating —
        // the catalog item.usable already gated this in the
        // PartyScreen, so we know SOMETHING was supposed to happen
        // but we don't want to silently eat a charge from a stack.
        return;
      }

      const nextInv = consumeOneFromInventory(inv, stashIndex, state.items);

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
    [state, liveSave, commit],
  );

  /** "Send" — move ONE physical item from the shared stash into the
   *  personal inventory of the roster member at `memberIndex`. For
   *  stackable items the source stack decrements by 1 and the target
   *  receives a +1 merge (stacks combine on the destination side
   *  too). For non-stackable items the source row is spliced and the
   *  target gets a fresh row appended — same shape as before. */
  const handleSendStashItem = useCallback(
    (stashIndex: number, memberIndex: number) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const inv = cur.party.inventory;
      const roster = cur.party.roster;
      if (stashIndex < 0 || stashIndex >= inv.length) return;
      if (memberIndex < 0 || memberIndex >= roster.length) return;
      const targetId = roster[memberIndex];
      const targetSaved = cur.party.members.find((m) => m.id === targetId);
      if (!targetSaved) return;

      const entry = inv[stashIndex];
      const nextInv = consumeOneFromInventory(inv, stashIndex, state.items);
      const nextTargetInv = addToInventory(
        targetSaved.inventory,
        entry.item,
        state.items,
        1,
      );
      const nextTarget: SavedCharacterState = {
        ...targetSaved,
        inventory: nextTargetInv,
      };
      const nextMembers = cur.party.members.map((m) =>
        m.id === targetId ? nextTarget : m,
      );
      commit({
        ...cur,
        party: { ...cur.party, inventory: nextInv, members: nextMembers },
      });
    },
    [state, liveSave, commit],
  );

  /** D&D-style ability modifier — floor((stat - 10) / 2). Mirrors the
   *  helper in CharacterSheetSim. */
  const abilityMod = (stat: number): number => Math.floor((stat - 10) / 2);

  /** Apply a heal to one target. Splits out of handleCastSpell so the
   *  target-picker click handler can reuse it (the picker hands us a
   *  member id; here we look up the saved record, deduct caster MP,
   *  roll the heal, cap at max HP, and commit). */
  const applyHeal = useCallback(
    (casterId: string, targetId: string, spell: PartySpellRef) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const cost = spell.mp_cost ?? 0;

      const casterSaved = cur.party.members.find((m) => m.id === casterId);
      const targetSaved = cur.party.members.find((m) => m.id === targetId);
      if (!casterSaved || !targetSaved) {
        setCastMessage("Cast failed — caster or target missing.");
        return;
      }
      const casterMp = casterSaved.mp ?? 0;
      if (casterMp < cost) {
        setCastMessage(
          `${state.characters.find((c) => c.id === casterId)?.name ?? casterId} doesn't have enough MP (${casterMp}/${cost}).`,
        );
        return;
      }

      // Roll heal: dice + stat modifier, floored at `min_heal`.
      const params = (spell.action_params ?? {}) as {
        dice_count?: number;
        dice_sides?: number;
        stat_bonus?: string;
        min_heal?: number;
      };
      const diceCount = params.dice_count ?? 1;
      const diceSides = params.dice_sides ?? 6;
      const minHeal = params.min_heal ?? 1;
      let rolled = 0;
      for (let i = 0; i < diceCount; i++) {
        rolled += Math.floor(Math.random() * diceSides) + 1;
      }
      // Pull the bonus stat from the catalog caster record so we read
      // the same value sheet UI shows — saved state doesn't carry
      // ability scores.
      const casterStatic = state.characters.find((c) => c.id === casterId);
      const statKey = params.stat_bonus;
      const statValue =
        statKey === "wisdom"
          ? casterStatic?.wisdom ?? 10
          : statKey === "intelligence"
            ? casterStatic?.intelligence ?? 10
            : statKey === "strength"
              ? casterStatic?.strength ?? 10
              : statKey === "dexterity"
                ? casterStatic?.dexterity ?? 10
                : statKey === "constitution"
                  ? casterStatic?.constitution ?? 10
                  : 10;
      const bonus = abilityMod(statValue);
      const healAmount = Math.max(minHeal, rolled + bonus);

      // Cap at the target's max HP (from the static catalog snapshot
      // taken at load time — saved state only carries current HP).
      const maxHp = state.maxHpById.get(targetId) ?? targetSaved.hp;
      const newHp = Math.min(maxHp, targetSaved.hp + healAmount);
      const actuallyHealed = newHp - targetSaved.hp;

      // Build the new members array — caster loses MP, target gains
      // HP. Same identity walk handleSendStashItem uses so both
      // mutations land in one commit.
      const nextMembers = cur.party.members.map((m) => {
        if (m.id === casterId) return { ...m, mp: casterMp - cost };
        if (m.id === targetId) return { ...m, hp: newHp };
        return m;
      });

      const targetName =
        state.characters.find((c) => c.id === targetId)?.name ?? targetId;
      const casterName = casterStatic?.name ?? casterId;
      setCastMessage(
        actuallyHealed > 0
          ? `${casterName} heals ${targetName} for ${actuallyHealed} HP.`
          : `${targetName} is already at full HP.`,
      );
      commit({
        ...cur,
        party: { ...cur.party, members: nextMembers },
      });
      // Spell landed — let the host paint the heal-sparkles VFX +
      // play the heal SFX on the world canvas behind the overlay.
      // We don't gate on `actuallyHealed > 0`: even a wasted cast
      // should feel like something happened.
      onSpellCast?.(spell.id);
    },
    [state, liveSave, commit, onSpellCast],
  );

  /** Cast a Light spell (self-targeted). Deducts caster MP and seeds
   *  `magic_light_steps` from the spell's duration; adds the
   *  `magic_light` id to `party_effects` so the Effects panel
   *  reflects it. */
  const applyLight = useCallback(
    (casterId: string, spell: PartySpellRef) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const cost = spell.mp_cost ?? 0;

      const casterSaved = cur.party.members.find((m) => m.id === casterId);
      if (!casterSaved) {
        setCastMessage("Cast failed — caster missing.");
        return;
      }
      const casterMp = casterSaved.mp ?? 0;
      if (casterMp < cost) {
        setCastMessage(
          `${state.characters.find((c) => c.id === casterId)?.name ?? casterId} doesn't have enough MP (${casterMp}/${cost}).`,
        );
        return;
      }

      const duration =
        typeof spell.duration === "number" && spell.duration > 0
          ? spell.duration
          : 100;
      const nextMembers = cur.party.members.map((m) =>
        m.id === casterId ? { ...m, mp: casterMp - cost } : m,
      );
      const nextPartyEffects = new Set(cur.party.party_effects ?? []);
      nextPartyEffects.add("magic_light");
      const casterName =
        state.characters.find((c) => c.id === casterId)?.name ?? casterId;
      setCastMessage(`${casterName} casts Light (${duration} steps).`);
      setActiveEffectIds([...nextPartyEffects]);
      commit({
        ...cur,
        party: {
          ...cur.party,
          members: nextMembers,
          magic_light_steps: duration,
          party_effects: [...nextPartyEffects],
        },
      });
      // Spell landed — host paints the glow-aura VFX + plays the
      // magic-burst SFX on the party cell. Done outside the commit
      // so the audio/visual cue fires even if the host's onMutateSave
      // path early-bails (e.g. before the sim is mounted).
      onSpellCast?.(spell.id);
    },
    [state, liveSave, commit, onSpellCast],
  );

  /** Route an incoming Cast intent. Self-targeted spells fire
   *  immediately; ally-target spells stash the intent and open the
   *  target picker (rendered alongside the screen). Unsupported
   *  targetings show a message rather than failing silently — Knock
   *  and Push aren't wired up yet. */
  const handleCastSpell = useCallback(
    (casterId: string, spellId: string) => {
      if (state.kind !== "ok") return;
      const spell = state.spells.find((s) => s.id === spellId);
      if (!spell) {
        setCastMessage(`Unknown spell: ${spellId}.`);
        return;
      }
      if (spell.action === "apply_effect" && spell.targeting === "self") {
        // Today the only self-targeted apply_effect spell that's
        // usable in the party menu is Light. If/when more land
        // (Detect Magic, etc.) the handler dispatches on
        // action_params.effect_id.
        const effectId =
          (spell.action_params as { effect_id?: string } | undefined)
            ?.effect_id ?? spell.id;
        if (effectId === "magic_light") {
          applyLight(casterId, spell);
          return;
        }
      }
      if (
        spell.action === "heal" &&
        (spell.targeting === "select_ally_or_self" ||
          spell.targeting === "select_ally")
      ) {
        setPendingHeal({ casterId, spellId: spell.id });
        return;
      }
      setCastMessage(
        `${spell.name ?? spell.id} isn't wired up out of combat yet.`,
      );
    },
    [state, applyLight],
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
          {castMessage ? (
            <div className="mb-2 rounded border border-ember/40 bg-ember/15 px-2 py-1 text-xs text-parchment/90">
              {castMessage}
            </div>
          ) : null}
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
              onActiveEffectsChange={handleActiveEffectsChange}
              onUseStashItem={handleUseStashItem}
              onSendStashItem={handleSendStashItem}
              onCastSpell={handleCastSpell}
              effectDurations={
                new Map<string, number>([
                  ["magic_light", liveSave.party.magic_light_steps ?? 0],
                  [
                    "galadriels_light",
                    liveSave.party.galadriels_light_steps ?? 0,
                  ],
                ])
              }
            />
          )}
        </div>
      </div>
      {/* Target picker for heal-type spells. Lists every roster
       *  member with their current HP so the player can see who
       *  needs healing. Clicking a member applies the heal; the X
       *  / ESC cancels back to the Party screen. */}
      {pendingHeal && state.kind === "ok" ? (
        <HealTargetPicker
          casterId={pendingHeal.casterId}
          spell={
            state.spells.find((s) => s.id === pendingHeal.spellId) ?? null
          }
          characters={state.characters}
          maxHpById={state.maxHpById}
          roster={liveSave.party.roster}
          members={liveSave.party.members}
          onCancel={() => setPendingHeal(null)}
          onPick={(targetId) => {
            const spell = state.spells.find((s) => s.id === pendingHeal.spellId);
            if (spell) applyHeal(pendingHeal.casterId, targetId, spell);
            setPendingHeal(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Modal picker rendered over the Party screen when the player casts
 *  a heal that needs a target. One row per roster member with their
 *  current/max HP and a click handler. Same dark-modal styling as the
 *  parent overlay. */
function HealTargetPicker({
  casterId,
  spell,
  characters,
  maxHpById,
  roster,
  members,
  onPick,
  onCancel,
}: {
  casterId: string;
  spell: PartySpellRef | null;
  characters: ReadonlyArray<PartyCharacterRef>;
  maxHpById: ReadonlyMap<string, number>;
  roster: ReadonlyArray<string>;
  members: ReadonlyArray<SavedCharacterState>;
  onPick: (targetId: string) => void;
  onCancel: () => void;
}) {
  const memberById = new Map(members.map((m) => [m.id, m] as const));
  const characterById = new Map(characters.map((c) => [c.id, c] as const));
  // ESC closes the picker. Capture phase so the parent overlay's
  // close-on-ESC doesn't fire instead and drop the whole Party
  // screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel]);

  const casterName = characterById.get(casterId)?.name ?? casterId;
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-parchment/25 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h3 className="font-display text-sm text-parchment">
            {casterName} casts {spell?.name ?? "Heal"} — pick target
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          >
            Cancel
          </button>
        </div>
        <ul className="flex flex-col gap-1 p-2">
          {roster.map((id) => {
            const c = characterById.get(id);
            const m = memberById.get(id);
            if (!c || !m) return null;
            const max = maxHpById.get(id) ?? m.hp;
            const atFull = m.hp >= max;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onPick(id)}
                  className="flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={atFull && id !== casterId}
                  title={
                    atFull
                      ? `${c.name} is at full HP.`
                      : `Heal ${c.name}.`
                  }
                >
                  <span className="font-display">{c.name}</span>
                  <span className="font-mono text-xs text-parchment/70">
                    HP {m.hp}/{max}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
