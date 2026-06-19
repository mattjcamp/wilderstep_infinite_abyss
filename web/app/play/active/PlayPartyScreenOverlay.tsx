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

import { getModuleSource } from "@/data_model/sourceConfig";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { classAllowsItemType } from "@/battle/world/Classes";
import { applyCampRest } from "@/play/campRest";
import {
  addToInventory,
  consumeOneFromInventory,
} from "@/play/inventoryStacking";
import {
  attemptTinker,
  canTinker,
  tinkerStockFor,
  type RaceAbilityCharacterRef,
} from "@/play/raceAbilities";
import {
  attemptCraft,
  canCraft,
  craftStockFor,
} from "@/play/craftAbilities";
import {
  attemptBrew,
  canBrew,
  recipeShortages,
  type RecipeRef,
} from "@/play/potionCrafting";
import { dayIndex, nextMorningMinutes } from "@/battle/world/GameTime";

/** Minimal counter shape — `id` to find the general store entry,
 *  `items` for the stock list the Tinker picker presents. Loaded
 *  from counters.json alongside the other catalogs so the Tinker
 *  flow doesn't need to re-fetch. */
interface OverlayCounterRef {
  id: string;
  name?: string;
  items?: ReadonlyArray<string>;
}

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
      /** Counters catalog — needed so the Tinker picker can list
       *  the general-store stock the Gnome is allowed to craft
       *  from. */
      counters: OverlayCounterRef[];
      /** Recipes catalog — needed so the brew_potion picker can
       *  list every recipe the Alchemist could attempt + grey out
       *  the ones the party can't currently supply reagents for. */
      recipes: RecipeRef[];
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

/** Pending Resurrection target pick — same shape as {@link PendingHeal}
 *  but the picker lists only DOWNED members (hp ≤ 0). */
interface PendingRevive {
  casterId: string;
  spellId: string;
}

/** Payload for a race-ability "flash" — the host listens for these
 *  to fire SFX + Phaser visuals at the party tile (and to surface a
 *  placard in the world view) so the player sees something happened
 *  beyond the overlay's local cast-message banner. Kept as a
 *  discriminated union keyed by `kind` so a future Pickpocket /
 *  Tinker placard can carry ability-specific fields without a
 *  type-cast on the host side. */
export type RaceAbilityFlash =
  | {
      kind: "tinker";
      /** Display name of the Gnome whose hands did the work. */
      memberName: string;
      /** Item id that was crafted (snake_case). */
      itemId: string;
      /** Display name from items.json — for the placard subtitle. */
      itemName: string;
    }
  | {
      kind: "craft";
      /** Display name of the Ranger whose hands did the work. */
      memberName: string;
      /** Item id that was crafted (snake_case). */
      itemId: string;
      /** Display name from items.json — for the placard subtitle. */
      itemName: string;
      /** How many items the craft paid out (full bundle from the
       *  catalog — Arrows/Bolts/Fire Arrows = 20, single for any
       *  future non-bundled stock item). The host shows this in the
       *  placard subtitle ("Arrows ×20") so the player gets the same
       *  bundle-count read the shop gives. */
      count: number;
      /** Which craft ability fired (craft_arrows / craft_fire_arrows).
       *  Lets the host pick a more specific placard label if it
       *  wants to differentiate the two crafts visually. */
      abilityId: string;
      /** Display name of the ability — for the placard title. */
      abilityName: string;
    }
  | {
      kind: "brew";
      /** Display name of the Alchemist who brewed the potion. */
      memberName: string;
      /** Recipe id the player picked (snake_case). Lets the host
       *  differentiate which brew fired if it ever wants to fork
       *  the placard art per recipe family. */
      recipeId: string;
      /** Display name of the recipe — for the placard title. */
      recipeName: string;
      /** Produced item id (snake_case). */
      itemId: string;
      /** Display name of the produced potion — for the placard
       *  subtitle. */
      itemName: string;
    };

export function PlayPartyScreenOverlay({
  moduleId,
  save,
  onClose,
  onMutateSave,
  onSpellCast,
  onItemUse,
  onRaceAbilityFlash,
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
   *  Phaser scene from here, but the host owns the renderer.
   *  `actionParams` carries the spell's `action_params` so the host
   *  can apply param-driven world effects (Push's shove radius /
   *  distance) without re-resolving the catalog. */
  onSpellCast?: (
    spellId: string,
    actionParams?: Record<string, unknown> | null,
  ) => void;
  /** Fires AFTER a usable item successfully resolves (stack
   *  decremented, save committed). Same purpose as `onSpellCast` but
   *  keyed by catalog item id so the host can play item-specific VFX
   *  + SFX (e.g. camping_supplies → campfireRest + rest_complete).
   *  Items that have nothing visual to play (Torch, etc.) can just
   *  not be dispatched in the host. */
  onItemUse?: (itemId: string) => void;
  /** Fires AFTER a race-active ability resolves successfully (today:
   *  Tinker). The host uses this to play SFX + a Phaser-side visual
   *  on the party tile AND to render a celebration placard so the
   *  player has confirmation beyond the overlay's local banner. */
  onRaceAbilityFlash?: (flash: RaceAbilityFlash) => void;
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
  const [pendingRevive, setPendingRevive] = useState<PendingRevive | null>(
    null,
  );
  /** True while the Tinker item-picker overlay is open. Cleared on
   *  pick / cancel. Modeled on `pendingHeal`'s shape but doesn't
   *  need any payload — the picker reads its options from the
   *  loaded counters + items. */
  const [pendingTinker, setPendingTinker] = useState<boolean>(false);
  /** Pending Craft ability — non-null while the craft picker is
   *  open. Carries the ability id so the picker knows which item
   *  stock to show (Craft Arrows lists arrows + bolts; Craft Fire
   *  Arrows lists fire arrows) AND so the pick handler routes the
   *  result through the right `last_ability_day[id]` counter. */
  const [pendingCraft, setPendingCraft] = useState<{
    abilityId: string;
    abilityName: string;
  } | null>(null);
  /** Pending brew — non-null while the recipe picker is open.
   *  No payload needed (the picker reads the recipes + items
   *  catalogs from `state`). Cleared on pick / cancel. */
  const [pendingBrew, setPendingBrew] = useState<boolean>(false);
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
    // duration-backed effects (Magic Light) may have auto-expired
    // since the overlay last opened.
    setActiveEffectIds([...(save.party.party_effects ?? [])]);
  }, [save]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = getModuleSource();
        const [
          partyLayers,
          charactersLayers,
          racesLayers,
          classesLayers,
          abilitiesLayers,
          itemsLayers,
          spellsLayers,
          countersLayers,
          recipesLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
          src.loadModelLayers(moduleId, "items"),
          src.loadModelLayers(moduleId, "spells"),
          src.loadModelLayers(moduleId, "counters"),
          src.loadModelLayers(moduleId, "recipes"),
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
        const counters =
          (mergeModel(
            "counters",
            countersLayers.inherited,
            countersLayers.ownFile,
          ) as { counters?: OverlayCounterRef[] } | null)?.counters ?? [];
        const recipes =
          (mergeModel(
            "recipes",
            recipesLayers.inherited,
            recipesLayers.ownFile,
          ) as { recipes?: RecipeRef[] } | null)?.recipes ?? [];

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
        };

        // Custom (player-rolled) characters live in
        // `liveSave.party.members[].custom` rather than in the module's
        // characters.json. Combine them with the static catalog so the
        // roster join below finds them — without this, every PartyScreen
        // lookup (`byId.get(rosterId)`) misses the custom id and the
        // member silently disappears from the Party screen, the
        // race-ability handlers, the heal / casting handlers, and any
        // other consumer that reads `state.characters`. The save's
        // `custom` blob is a full CharacterRecord (id / name / class /
        // race / stats / sprite); its shape is a structural superset of
        // PartyCharacterRef, so a spread is enough.
        const customCharacters: PartyCharacterRef[] = [];
        for (const m of liveSave.party.members) {
          if (!m.custom) continue;
          const c = m.custom as PartyCharacterRef;
          // Dedupe defensively against the static catalog — a save
          // that ended up with both a custom blob AND a same-id
          // module entry would otherwise render two cards. The
          // custom blob wins (it's the player's choice).
          if (staticCharacters.some((sc) => sc.id === c.id)) continue;
          customCharacters.push(c);
        }
        const allCharacters: PartyCharacterRef[] = [
          ...staticCharacters,
          ...customCharacters,
        ];

        // Per-member overlay: merge HP / MP / personal inventory from
        // SavedCharacterState onto the catalog entry (static or
        // custom) for the same id.
        const savedById = new Map(
          liveSave.party.members.map((m) => [m.id, m] as const),
        );
        // Peak HP/MP, used by heal handlers + bar denominators. The
        // save now carries these directly (backfilled at PlayHost
        // load when absent); we prefer them when present and fall
        // back to the catalog character's hp/mp for any member that
        // somehow lacks them. This makes the lookup work for custom
        // characters (which never had a catalog entry) AND for any
        // future per-member max changes (level-up bonuses, etc.).
        const maxHpById = new Map<string, number>();
        const maxMpById = new Map<string, number>();
        for (const c of allCharacters) {
          if (typeof c.hp === "number") maxHpById.set(c.id, c.hp);
          if (typeof c.mp === "number") maxMpById.set(c.id, c.mp);
        }
        for (const m of liveSave.party.members) {
          if (typeof m.max_hp === "number") maxHpById.set(m.id, m.max_hp);
          if (typeof m.max_mp === "number") maxMpById.set(m.id, m.max_mp);
        }
        const characters: PartyCharacterRef[] = allCharacters.map((c) => {
          const saved = savedById.get(c.id);
          // maxHp / maxMp ride on EVERY merged character (not just
          // the saved ones) so unsaved members — or contexts where
          // saved is null but the catalog character is in the roster
          // — still get a real denominator for the bars.
          const maxHp = maxHpById.get(c.id) ?? c.hp;
          const maxMp = typeof c.mp === "number" ? maxMpById.get(c.id) ?? c.mp : undefined;
          if (!saved) {
            return {
              ...c,
              maxHp,
              ...(maxMp !== undefined ? { maxMp } : {}),
            };
          }
          return {
            ...c,
            hp: saved.hp,
            mp: typeof saved.mp === "number" ? saved.mp : c.mp,
            maxHp,
            ...(maxMp !== undefined ? { maxMp } : {}),
            // Level + XP overlay. Without this the roster card and
            // the character sheet inherit the catalog character's
            // level (typically 1) and `exp` (typically 0 / absent),
            // even after the player has won fights or turned in
            // quests. Both fields are optional on SavedCharacterState
            // (legacy saves predate the persistence layer);
            // PlayHost's load-time backfill ensures every live save
            // carries them, but we still narrow the type-check here
            // so a hand-rolled save without them falls through to
            // the catalog values rather than rendering `undefined`.
            level: typeof saved.level === "number" ? saved.level : c.level,
            exp: typeof saved.exp === "number" ? saved.exp : c.exp,
            inventory: saved.inventory
              ? saved.inventory.map((e) => ({ ...e }))
              : c.inventory,
            // Equipped overlay: saved-side wins (the player swapped
            // gear at some point), otherwise the character's starting
            // loadout from characters.json keeps showing.
            equipped: saved.equipped
              ? { ...saved.equipped }
              : c.equipped,
            // Per-slot durability tracker — flows through to the
            // character sheet's equipped panel so each slot can
            // paint a worn-down bar. Stored as an extra field on
            // the PartyCharacterRef shape so the existing prop
            // surface doesn't need a breaking change.
            equipped_durability: saved.equipped_durability
              ? { ...saved.equipped_durability }
              : undefined,
            // Per-character active effects (poison, curses, buffs).
            // Without this the roster card + sheet can't show
            // "Poisoned (N steps)" — the save tracks it but the UI
            // would render an unconditioned-looking member.
            effects: saved.effects
              ? saved.effects.map((e) => ({ ...e }))
              : undefined,
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
          counters,
          recipes,
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

  /** Resolve the player's pick from the Tinker picker. Runs the
   *  pure `attemptTinker` helper, commits the new save on success,
   *  and surfaces the result (loot or refusal) in the cast-message
   *  banner. Refusals from a half-stale picker (item rotated out of
   *  general stock, day rolled while the picker was open) leave
   *  the save untouched and explain themselves to the player. */
  const handleTinkerPick = useCallback(
    (itemId: string) => {
      if (state.kind !== "ok") return;
      // dayIndex reads from the in-game clock — same source the
      // overworld lighting + HUD clock use. Derived here so the
      // overlay doesn't need a new prop just to know "what day is
      // it right now."
      const currentDay = dayIndex({ totalMinutes: liveSave.clockMinutes ?? 0 });
      const result = attemptTinker(
        liveSave,
        state.characters as ReadonlyArray<RaceAbilityCharacterRef>,
        // The Tinker choices come from the ability's own `tinker_items`
        // list now (curated in the editor), not the General Store.
        state.abilities.find((a) => a.id === "tinker"),
        // Pass the catalog straight through. PartyItemRef already
        // carries `stackable` + `charges`, so the bundle helper reads
        // the right values and there's no hand-picked subset that can
        // silently drop a field (the original bug that degraded every
        // tinker to a single item).
        state.items,
        itemId,
        currentDay,
      );
      setCastMessage(result.message);
      if (result.ok && result.nextSave) {
        commit(result.nextSave);
        // Notify the host of the celebration so it can fire SFX +
        // a Phaser visual on the party tile. Doing it here (rather
        // than from the picker itself) keeps the visual in lockstep
        // with the save commit + result.
        onRaceAbilityFlash?.({
          kind: "tinker",
          memberName:
            (state.characters.find((c) => c.race?.toLowerCase() === "gnome")
              ?.name as string | undefined) ?? "Gnome",
          itemId,
          itemName:
            state.items.find((i) => i.id === itemId)?.name ?? itemId,
        });
      }
      setPendingTinker(false);
    },
    [commit, liveSave, state, onRaceAbilityFlash],
  );

  /** Resolve a Craft ability pick — same shape as `handleTinkerPick`
   *  but routes through `attemptCraft` with the right ability id +
   *  class. Both Ranger craft abilities share this handler; the
   *  picker carries the ability id forward in `pendingCraft`. */
  const handleCraftPick = useCallback(
    (itemId: string) => {
      if (state.kind !== "ok" || !pendingCraft) return;
      const currentDay = dayIndex({
        totalMinutes: liveSave.clockMinutes ?? 0,
      });
      const result = attemptCraft(
        liveSave,
        state.characters as ReadonlyArray<
          RaceAbilityCharacterRef & { class?: string }
        >,
        // Pass the catalog straight through (PartyItemRef carries
        // `stackable` + `charges`) so `attemptCraft` sizes each pull
        // correctly — Arrows/Bolts/Fire Arrows pay out a bundle of 20,
        // matching the shop. No hand-picked subset to drop a field.
        state.items,
        "ranger",
        pendingCraft.abilityId,
        itemId,
        currentDay,
      );
      setCastMessage(result.message);
      if (result.ok && result.nextSave) {
        commit(result.nextSave);
        // Find the Ranger's name for the placard subtitle. The
        // craft helper already returned a prose message but the
        // placard wants the actor + item separately so the
        // "{Name} crafts" / "Arrows" framing reads cleanly.
        const ranger = (state.characters as ReadonlyArray<
          RaceAbilityCharacterRef & { class?: string }
        >).find(
          (c) =>
            (c.class ?? "").toLowerCase() === "ranger" &&
            // We don't have hp on the catalog row, so trust
            // canCraft's earlier check that an alive Ranger exists
            // — first matching catalog Ranger is fine for the
            // display name.
            true,
        );
        const rangerName = ranger?.name ?? "Ranger";
        const itemDef = state.items.find((i) => i.id === itemId);
        const itemName = itemDef?.name ?? itemId;
        // Recompute the bundle size locally so the placard can show
        // the count. attemptCraft already used the same rule on the
        // save commit; mirroring it here keeps the placard truthful
        // even though the helper doesn't return the count directly.
        const count =
          itemDef?.stackable && typeof itemDef.charges === "number" &&
          itemDef.charges > 0
            ? itemDef.charges
            : 1;
        onRaceAbilityFlash?.({
          kind: "craft",
          memberName: rangerName,
          itemId,
          itemName,
          count,
          abilityId: pendingCraft.abilityId,
          abilityName: pendingCraft.abilityName,
        });
      }
      setPendingCraft(null);
    },
    [commit, liveSave, state, pendingCraft, onRaceAbilityFlash],
  );

  /** Resolve a brew_potion recipe pick — validate the recipe
   *  through the pure `attemptBrew` helper, commit the new save
   *  on success, surface a placard so the world view shows the
   *  Alchemist did something. Reagent shortages bubble up as the
   *  helper's refusal message and surface in the cast banner. */
  const handleBrewPick = useCallback(
    (recipeId: string) => {
      if (state.kind !== "ok") return;
      const result = attemptBrew(
        liveSave,
        state.characters as ReadonlyArray<
          RaceAbilityCharacterRef & { class?: string }
        >,
        // Pass the catalog straight through (PartyItemRef carries
        // `stackable` + `charges`) so the consume / merge math reads it
        // correctly — no hand-picked subset that can drop a field if a
        // future bundle-output recipe is added.
        state.items,
        state.recipes,
        recipeId,
      );
      setCastMessage(result.message);
      if (result.ok && result.nextSave) {
        commit(result.nextSave);
        const recipe = state.recipes.find((r) => r.id === recipeId);
        const alchemist = (state.characters as ReadonlyArray<
          RaceAbilityCharacterRef & { class?: string }
        >).find((c) => (c.class ?? "").toLowerCase() === "alchemist");
        const itemDef = recipe
          ? state.items.find((i) => i.id === recipe.result_item)
          : undefined;
        onRaceAbilityFlash?.({
          kind: "brew",
          memberName: alchemist?.name ?? "Alchemist",
          recipeId,
          recipeName: recipe?.name ?? recipeId,
          itemId: recipe?.result_item ?? recipeId,
          itemName: itemDef?.name ?? recipe?.result_item ?? recipeId,
        });
      }
      setPendingBrew(false);
    },
    [commit, liveSave, state, onRaceAbilityFlash],
  );

  /** Route the sheet's "Use" button to the right surface per ability
   *  id. Tinker opens the existing item picker. Pickpocket points
   *  the player at the NPC dialog (it needs an NPC target, which
   *  this screen can't provide). Craft abilities open the shared
   *  craft picker with their ability-specific stock list. brew_potion
   *  opens the recipe picker. Everything else falls through to a
   *  generic "this ability isn't usable from here" line so a future
   *  party-active ability that's not yet wired doesn't silently
   *  no-op. */
  const handleUseAbility = useCallback(
    (memberId: string, ability: PartyAbilityRef) => {
      // `memberId` is ignored today — Tinker / Craft are party-wide
      // ("the Gnome / Ranger crafts an item for the stash"), so the
      // dispatcher doesn't need a per-member target. Kept in the
      // signature so a future per-character ability can route by
      // who clicked.
      void memberId;
      if (ability.id === "tinker") {
        // canTinker re-evaluated at click time so a same-second
        // double-click from the sheet doesn't try to tinker twice.
        const currentDay = dayIndex({
          totalMinutes: liveSave.clockMinutes ?? 0,
        });
        if (state.kind === "ok" &&
          canTinker(
            liveSave,
            state.characters as ReadonlyArray<RaceAbilityCharacterRef>,
            currentDay,
          )) {
          setPendingTinker(true);
        } else {
          setCastMessage("Tinker isn't available right now.");
        }
        return;
      }
      if (
        ability.id === "craft_arrows" ||
        ability.id === "craft_fire_arrows"
      ) {
        // Same per-click re-eval as Tinker so a double-click can't
        // bypass the once-per-day gate. canCraft also checks that
        // an alive Ranger is in the party (the sheet would only
        // surface the button for an eligible character, but a stale
        // sheet render shouldn't crash through).
        const currentDay = dayIndex({
          totalMinutes: liveSave.clockMinutes ?? 0,
        });
        if (
          state.kind === "ok" &&
          canCraft(
            liveSave,
            state.characters as ReadonlyArray<
              RaceAbilityCharacterRef & { class?: string }
            >,
            "ranger",
            ability.id,
            currentDay,
          )
        ) {
          setPendingCraft({
            abilityId: ability.id,
            abilityName: ability.name ?? ability.id,
          });
        } else {
          setCastMessage(
            `${ability.name ?? ability.id} isn't available right now.`,
          );
        }
        return;
      }
      if (ability.id === "pickpocket") {
        // Pickpocket needs an NPC target — there isn't one here.
        // Point the player at the right surface so they don't think
        // the ability is broken.
        setCastMessage(
          "Pickpocket: walk up to an NPC and choose Steal.",
        );
        return;
      }
      if (ability.id === "brew_potion") {
        // Open the recipe picker. canBrew gates on an alive
        // Alchemist; the picker itself surfaces per-recipe
        // reagent shortages so the player can see WHY a row is
        // greyed out without leaving the screen.
        if (
          state.kind === "ok" &&
          canBrew(
            liveSave,
            state.characters as ReadonlyArray<
              RaceAbilityCharacterRef & { class?: string }
            >,
          )
        ) {
          setPendingBrew(true);
        } else {
          setCastMessage("Brew Potion: no Alchemist available.");
        }
        return;
      }
      setCastMessage(
        `${ability.name ?? ability.id} isn't usable from this screen.`,
      );
    },
    [liveSave, state],
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
      let infravision = liveSave.party.infravision_active;

      for (const id of added) {
        if (id === "infravision") {
          infravision = true;
        }
      }
      let magicLight = liveSave.party.magic_light_steps ?? 0;
      let torchSteps = liveSave.party.torch_steps;
      let repelSteps = liveSave.party.repel_monsters_steps ?? 0;
      for (const id of removed) {
        if (id === "magic_light") {
          // Allow dismissing a cast Light spell by un-checking it in
          // the Effects list. Same toggle shape as Torch / Infravision
          // so all three light-style effects can be turned off the
          // same way.
          magicLight = 0;
        } else if (id === "torch") {
          // Un-checking Torch extinguishes the held torch — same
          // shape as toggling the Light spell off. The remaining
          // burn duration is lost (matches v1's "you stomp it out"
          // semantics; the catalog's per-torch charges field is
          // already off this stack because Use consumed one item).
          torchSteps = 0;
        } else if (id === "repel_monsters") {
          // Un-checking the Push spell's repel aura releases the
          // monsters early — same dismiss-by-toggle shape as Light.
          repelSteps = 0;
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
          magic_light_steps: magicLight,
          torch_steps: torchSteps,
          repel_monsters_steps: repelSteps,
          infravision_active: infravision,
        },
      });
    },
    // `state` MUST be in the dep array — the `if (state.kind !== "ok")`
    // guard at the top of this body reads `state.kind`, and if the
    // useCallback isn't recomputed when state changes, the closure
    // freezes at whatever kind `state` had when the overlay first
    // rendered. The overlay mounts in `state.kind === "loading"`
    // (catalog is async-loaded by the effect below), so without
    // `state` in the deps every Effects toggle silently no-ops:
    // the click handler runs, the early-return fires, and nothing
    // ever reaches setActiveEffectIds / commit.
    //
    // Every other handler in this file (handleUseStashItem,
    // handleSendStashItem, etc.) already lists `state` for this
    // exact reason; this one was the outlier and the symptom was
    // "press Enter on Infravision and even the Add to active button
    // does nothing."
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

      let torchSteps = cur.party.torch_steps;
      let nextMembers: ReadonlyArray<SavedCharacterState> = cur.party.members;
      // Camping through the night skips the clock to first light
      // (6 AM); every other use leaves time untouched.
      let nextClockMinutes = cur.clockMinutes;
      // Local copy of party_effects we may extend. Lighting a Torch
      // adds "torch" so the Effects panel reflects the active light
      // source (same shape the Magic Light spell uses).
      const nextPartyEffects = new Set(cur.party.party_effects ?? []);
      // Item id fired through onItemUse on a successful use, so the
      // host can paint the right VFX + play the right SFX. Stays
      // null when the branch has nothing to play (e.g. Torch).
      let usedItemId: string | null = null;

      if (entry.item === "Torch" || entry.item === "torch") {
        // Torch burn duration. The items.json catalog DOES carry a
        // `charges` field on torches, but in practice that field is
        // overloaded across the catalog (it means "stack size per
        // purchase" for Arrows/Lockpick/etc., not "per-use effect"),
        // and the Torch entry today reads `charges: 1` — which would
        // give us a single-step torch if we trusted it as burn time.
        // Until a dedicated catalog field lands (e.g. `light_steps`),
        // hardcode v1's canonical 150-step burn here. Stacking the
        // remaining duration ("light a fresh torch off the old one")
        // is intentional — matches v1's behavior.
        torchSteps = Math.max(torchSteps, 0) + TORCH_DEFAULT_STEPS_LOCAL;
        nextPartyEffects.add("torch");
      } else if (
        entry.item === "Camping Supplies" ||
        entry.item === "camping_supplies"
      ) {
        // Camp rest, via the shared helper so the personal-inventory
        // Use path stays in lockstep. Helper returns `applied: false`
        // when nobody needs healing — we surface "already rested" and
        // bail without consuming the supply (matches temple behavior).
        const rest = applyCampRest(
          cur.party.members,
          (id) => state.maxHpById.get(id),
          (id) => state.maxMpById.get(id),
        );
        if (!rest.applied) {
          setCastMessage("The party is already fully rested.");
          return;
        }
        nextMembers = rest.nextMembers;
        // Camping inside the night (or pre-dawn) window also sleeps
        // the party through to 6 AM — the dark is opt-out-able. The
        // host's onMutateSave sees the clockMinutes jump and
        // re-derives the lighting band.
        const morning = nextMorningMinutes({
          totalMinutes: cur.clockMinutes ?? 0,
        });
        if (morning !== null) {
          nextClockMinutes = morning;
          setCastMessage(
            "The party camps until first light. Wounds close and magic returns.",
          );
        } else {
          setCastMessage(
            "The party makes camp. Wounds close and magic returns.",
          );
        }
        usedItemId = "camping_supplies";
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
        clockMinutes: nextClockMinutes,
        party: {
          ...cur.party,
          inventory: nextInv,
          torch_steps: torchSteps,
          party_effects: [...nextPartyEffects],
          members: nextMembers,
        },
      };
      // Mirror into the overlay's React state so the Effects panel
      // shows the new "torch" row immediately, without waiting for
      // the next save round-trip. Matches what applyLight does.
      setActiveEffectIds([...nextPartyEffects]);
      commit(next);
      // Fire the item-use VFX/SFX hook AFTER commit so the host's
      // animation always lines up with a successfully-committed
      // state (no flash of effect on a use we then rolled back).
      if (usedItemId) onItemUse?.(usedItemId);
    },
    [state, liveSave, commit, onItemUse],
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
      // Carry per-instance durability through so a worn weapon sent
      // from the stash to a character keeps its wear. No-op for
      // stackables — addToInventory ignores the durability arg there.
      const nextTargetInv = addToInventory(
        targetSaved.inventory,
        entry.item,
        state.items,
        1,
        typeof entry.durability === "number" ? entry.durability : undefined,
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

  /** "Use" applied to a character's PERSONAL inventory row. Mirrors
   *  handleUseStashItem but operates on member.inventory instead of
   *  party.inventory. The per-use effect is identical — Torch bumps
   *  the party's torch_steps + adds "torch" to party_effects;
   *  Camping Supplies consumes one unit; other usables bail without
   *  touching the stack. */
  const handleUsePersonalItem = useCallback(
    (memberId: string, itemIndex: number) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const member = cur.party.members.find((m) => m.id === memberId);
      if (!member) return;
      const inv = member.inventory;
      if (itemIndex < 0 || itemIndex >= inv.length) return;
      const entry = inv[itemIndex];

      let torchSteps = cur.party.torch_steps;
      const nextPartyEffects = new Set(cur.party.party_effects ?? []);
      // Members after any rest-style heal. Defaults to the existing
      // roster (with the using member's inventory decremented below);
      // the Camping Supplies branch swaps in healed members.
      let restedMembers: ReadonlyArray<SavedCharacterState> | null = null;
      // Camping through the night skips the clock to first light
      // (6 AM); every other use leaves time untouched.
      let nextClockMinutes = cur.clockMinutes;
      let usedItemId: string | null = null;

      if (entry.item === "Torch" || entry.item === "torch") {
        torchSteps = Math.max(torchSteps, 0) + TORCH_DEFAULT_STEPS_LOCAL;
        nextPartyEffects.add("torch");
      } else if (
        entry.item === "Camping Supplies" ||
        entry.item === "camping_supplies"
      ) {
        // Camp rest — identical flow to the shared-stash Use path
        // (handleUseStashItem) via the same helper so personal-
        // inventory Camping Supplies actually heal instead of just
        // depleting the stack. Refuse + return early (no charge
        // consumed) when nobody needs rest.
        const rest = applyCampRest(
          cur.party.members,
          (id) => state.maxHpById.get(id),
          (id) => state.maxMpById.get(id),
        );
        if (!rest.applied) {
          setCastMessage("The party is already fully rested.");
          return;
        }
        restedMembers = rest.nextMembers;
        // Camping inside the night (or pre-dawn) window also sleeps
        // the party through to 6 AM — same flow as the stash path.
        const morning = nextMorningMinutes({
          totalMinutes: cur.clockMinutes ?? 0,
        });
        if (morning !== null) {
          nextClockMinutes = morning;
          setCastMessage(
            "The party camps until first light. Wounds close and magic returns.",
          );
        } else {
          setCastMessage(
            "The party makes camp. Wounds close and magic returns.",
          );
        }
        usedItemId = "camping_supplies";
      } else {
        // Unknown / not-yet-wired usable. Bail without mutating —
        // don't silently eat a charge for a no-op.
        return;
      }

      const nextInv = consumeOneFromInventory(
        inv as ReadonlyArray<{ item: string; charges?: number }>,
        itemIndex,
        state.items,
      );
      // Build the post-use roster. Start from the rest-healed members
      // when Camping Supplies fired, else from the live roster.
      // Decrement the using member's personal inventory in either
      // case so the consumed stack reflects the use.
      const baseMembers = restedMembers ?? cur.party.members;
      const nextMembers = baseMembers.map((m) =>
        m.id === memberId ? { ...m, inventory: nextInv } : m,
      );
      setActiveEffectIds([...nextPartyEffects]);
      commit({
        ...cur,
        clockMinutes: nextClockMinutes,
        party: {
          ...cur.party,
          torch_steps: torchSteps,
          party_effects: [...nextPartyEffects],
          members: nextMembers,
        },
      });
      if (usedItemId) onItemUse?.(usedItemId);
    },
    [state, liveSave, commit, onItemUse],
  );

  /** Move ONE physical item from a character's personal inventory
   *  back into the shared stash. Decrement the source stack, merge
   *  into an existing stash row when stackable, push a fresh row
   *  otherwise. Mirrors handleSendStashItem but in reverse. */
  const handleReturnPersonalItem = useCallback(
    (memberId: string, itemIndex: number) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const member = cur.party.members.find((m) => m.id === memberId);
      if (!member) return;
      const inv = member.inventory;
      if (itemIndex < 0 || itemIndex >= inv.length) return;
      const entry = inv[itemIndex];

      const nextMemberInv = consumeOneFromInventory(
        inv as ReadonlyArray<{ item: string; charges?: number; durability?: number }>,
        itemIndex,
        state.items,
      );
      // Preserve per-instance durability across the personal →
      // stash move so a worn item doesn't reset by being parked.
      const nextStash = addToInventory(
        cur.party.inventory,
        entry.item,
        state.items,
        1,
        typeof entry.durability === "number" ? entry.durability : undefined,
      );
      const nextMember: SavedCharacterState = {
        ...member,
        inventory: nextMemberInv,
      };
      const nextMembers = cur.party.members.map((m) =>
        m.id === memberId ? nextMember : m,
      );
      commit({
        ...cur,
        party: {
          ...cur.party,
          inventory: nextStash,
          members: nextMembers,
        },
      });
    },
    [state, liveSave, commit],
  );

  /** Equip a personal-inventory item into one of the character's
   *  equipment slots. The slot id comes from the item catalog's
   *  `slots` array (first known slot wins — currently "hands" for
   *  weapons, "body" for armor). If another item is already in
   *  that slot, it gets bounced into the personal inventory (merging
   *  into an existing stack on stackable items, which armor/weapons
   *  typically aren't). The newly-equipped item is decremented out
   *  of the personal inventory by 1. */
  const handleEquipPersonalItem = useCallback(
    (memberId: string, itemIndex: number) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const member = cur.party.members.find((m) => m.id === memberId);
      if (!member) return;
      const inv = member.inventory;
      if (itemIndex < 0 || itemIndex >= inv.length) return;
      const entry = inv[itemIndex];
      const def = state.items.find((it) => it.id === entry.item);
      const slots = (def as { slots?: string[] } | undefined)?.slots;
      if (!Array.isArray(slots) || slots.length === 0) return;
      const slot = slots.find((s) => s === "hands" || s === "body");
      if (!slot) return;

      // Pull the static character record so we can look up what's
      // already in the slot. equipped lives both on the merged
      // PartyCharacterRef in state.characters AND on the save's
      // members[].equipped when the player has previously swapped;
      // the merge in the load effect favours saved over static, so
      // reading from state.characters gives us the live value.
      const charDef = state.characters.find((c) => c.id === memberId);
      const currentlyEquipped =
        (charDef?.equipped ?? {}) as Record<string, string>;
      const displaced = currentlyEquipped[slot];

      // Class equipment restriction — a cleric can't equip a crossbow,
      // etc. The class's `allowable_item_types` is the gate; an empty /
      // missing list means no restriction.
      const charClassId = (charDef as { class?: string } | undefined)?.class;
      const classRef = charClassId
        ? state.classes.find((c) => c.id === charClassId)
        : undefined;
      const allowable = (
        classRef as { allowable_item_types?: string[] } | undefined
      )?.allowable_item_types;
      const itemType = (def as { item_type?: string } | undefined)?.item_type;
      if (!classAllowsItemType(allowable, itemType)) {
        const who = (charDef as { name?: string } | undefined)?.name ?? "This character";
        const what = (def as { name?: string } | undefined)?.name ?? entry.item;
        setCastMessage(
          `${who} can't equip ${what} — their class isn't trained for it.`,
        );
        return;
      }

      // Per-slot durability for whatever was previously equipped —
      // when we bounce the displaced item back into inventory we want
      // it to carry the wear it had on, not reset to fresh. The saved
      // map is the source of truth (the runtime tracker syncs from it
      // on combat seed / out of combat reads).
      const savedEd = member.equipped_durability ?? {};
      const displacedDur =
        slot === "hands" ? savedEd.hands : slot === "body" ? savedEd.body : undefined;

      // Drop the new item out of inventory (one unit).
      let nextInv = consumeOneFromInventory(
        inv as ReadonlyArray<{ item: string; charges?: number; durability?: number }>,
        itemIndex,
        state.items,
      );
      // Bounce the displaced item back into inventory, carrying its
      // current durability so wear travels with the object. Weapons /
      // armor are typically non-stackable; for stackable rows the
      // helper ignores the durability arg.
      if (displaced) {
        nextInv = addToInventory(
          nextInv,
          displaced,
          state.items,
          1,
          typeof displacedDur === "number" ? displacedDur : undefined,
        );
      }

      // Build the new equipped map: pre-existing slots persist
      // (saved-side equipped is the source of truth from now on
      // because we're about to write it), plus the new slot value.
      const nextEquipped: Record<string, string> = {
        ...currentlyEquipped,
        [slot]: entry.item,
      };
      // Update the per-slot wear tracker: seed from the entry's
      // stored durability (carries wear into combat) or leave null so
      // the combat-time helper lazy-initialises to catalog max.
      const nextEd: NonNullable<SavedCharacterState["equipped_durability"]> = {
        hands: savedEd.hands ?? null,
        body: savedEd.body ?? null,
      };
      if (slot === "hands" || slot === "body") {
        nextEd[slot] =
          typeof entry.durability === "number" ? entry.durability : null;
      }
      const nextMember: SavedCharacterState = {
        ...member,
        inventory: nextInv,
        equipped: nextEquipped,
        equipped_durability: nextEd,
      };
      const nextMembers = cur.party.members.map((m) =>
        m.id === memberId ? nextMember : m,
      );
      commit({
        ...cur,
        party: { ...cur.party, members: nextMembers },
      });
    },
    [state, liveSave, commit],
  );

  /** Unequip whatever is in `slot` and push it into the character's
   *  personal inventory. The slot key is cleared on the saved
   *  equipped map. Inverse of handleEquipPersonalItem. */
  const handleUnequipSlot = useCallback(
    (memberId: string, slot: string) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const member = cur.party.members.find((m) => m.id === memberId);
      if (!member) return;
      const charDef = state.characters.find((c) => c.id === memberId);
      const currentlyEquipped =
        (charDef?.equipped ?? {}) as Record<string, string>;
      const itemId = currentlyEquipped[slot];
      if (!itemId) return;

      // Carry the slot's current wear back onto the inventory entry
      // so unequipping doesn't reset durability to fresh.
      const savedEd = member.equipped_durability ?? {};
      const slotDur =
        slot === "hands" ? savedEd.hands : slot === "body" ? savedEd.body : undefined;
      const nextInv = addToInventory(
        member.inventory,
        itemId,
        state.items,
        1,
        typeof slotDur === "number" ? slotDur : undefined,
      );
      // Build the new equipped map without the cleared slot. Saved
      // equipped persists every other slot unchanged.
      const nextEquipped: Record<string, string> = { ...currentlyEquipped };
      delete nextEquipped[slot];
      // Clear the slot's durability tracker too — the wear has moved
      // back onto the inventory entry above.
      const nextEd: NonNullable<SavedCharacterState["equipped_durability"]> = {
        hands: savedEd.hands ?? null,
        body: savedEd.body ?? null,
      };
      if (slot === "hands" || slot === "body") {
        nextEd[slot] = null;
      }
      const nextMember: SavedCharacterState = {
        ...member,
        inventory: nextInv,
        equipped: nextEquipped,
        equipped_durability: nextEd,
      };
      const nextMembers = cur.party.members.map((m) =>
        m.id === memberId ? nextMember : m,
      );
      commit({
        ...cur,
        party: { ...cur.party, members: nextMembers },
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
      // mutations land in one commit. NOTE: the two updates must NOT
      // be exclusive branches — when the caster heals THEMSELVES
      // (casterId === targetId) both deltas land on the same member,
      // and an early-return on the MP branch would silently drop the
      // HP restore (the original self-heal bug).
      const nextMembers = cur.party.members.map((m) => {
        if (m.id !== casterId && m.id !== targetId) return m;
        let out = m;
        if (m.id === casterId) out = { ...out, mp: casterMp - cost };
        if (m.id === targetId) out = { ...out, hp: newHp };
        return out;
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

  /** Cast the priest's Push spell (self-targeted divine shockwave).
   *  Deducts caster MP, seeds `repel_monsters_steps` from the
   *  spell's duration, and adds `repel_monsters` to `party_effects`
   *  so the Effects panel reflects it. The world-side consequences
   *  ride the host hooks: the commit's onMutateSave delta seeds the
   *  kernel's repel aura, and onSpellCast (with the spell's
   *  action_params) performs the cast-time shove + VFX. */
  const applyRepel = useCallback(
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
          : 10;
      const nextMembers = cur.party.members.map((m) =>
        m.id === casterId ? { ...m, mp: casterMp - cost } : m,
      );
      const nextPartyEffects = new Set(cur.party.party_effects ?? []);
      nextPartyEffects.add("repel_monsters");
      const casterName =
        state.characters.find((c) => c.id === casterId)?.name ?? casterId;
      setCastMessage(
        `${casterName} casts ${spell.name ?? "Push"} — monsters are driven back (${duration} steps).`,
      );
      setActiveEffectIds([...nextPartyEffects]);
      commit({
        ...cur,
        party: {
          ...cur.party,
          members: nextMembers,
          repel_monsters_steps: duration,
          party_effects: [...nextPartyEffects],
        },
      });
      // Spell landed — the host shoves nearby monsters (using the
      // spell's radius / push_distance) and paints the shockwave.
      onSpellCast?.(spell.id, spell.action_params ?? null);
    },
    [state, liveSave, commit, onSpellCast],
  );

  /** Cast Recall (sorcerer). Deducts caster MP and asks the host to
   *  teleport the whole party to their rune stone — or, if none was
   *  placed, the journey's start. The actual world teleport lives on
   *  the host (it owns the sim / map remount); here we just spend MP,
   *  commit, and signal via onSpellCast so the host reads the freshly
   *  committed anchor. */
  const applyRecall = useCallback(
    (casterId: string, spell: PartySpellRef) => {
      if (state.kind !== "ok") return;
      const cur = liveSave;
      const anchor = cur.party.runeStone ?? cur.party.startLocation ?? null;
      if (!anchor) {
        setCastMessage(
          "Recall fails — no rune stone has been placed and the journey's start is unknown.",
        );
        return;
      }
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
      const nextMembers = cur.party.members.map((m) =>
        m.id === casterId ? { ...m, mp: casterMp - cost } : m,
      );
      const casterName =
        state.characters.find((c) => c.id === casterId)?.name ?? casterId;
      const dest = cur.party.runeStone ? "rune stone" : "the journey's start";
      setCastMessage(`${casterName} casts Recall — the party folds space to ${dest}.`);
      commit({
        ...cur,
        party: { ...cur.party, members: nextMembers },
      });
      // Host performs the teleport (reads the committed anchor) and
      // closes the Party screen.
      onSpellCast?.(spell.id);
    },
    [state, liveSave, commit, onSpellCast],
  );

  /** Drop (or move) the party's Recall rune stone at their current
   *  location. A single overwritable anchor — dropping again relocates
   *  it. Persisted on the save so Recall can return here later. */
  const handleDropRuneStone = useCallback(() => {
    if (state.kind !== "ok") return;
    const cur = liveSave;
    const anchor = {
      mapId: cur.party.currentMapId,
      col: cur.party.col,
      row: cur.party.row,
    };
    setCastMessage("Rune stone placed — Recall will return the party here.");
    commit({
      ...cur,
      party: { ...cur.party, runeStone: anchor },
    });
  }, [state, liveSave, commit]);

  /** Apply Resurrection to one downed target. Mirrors applyHeal's
   *  MP/commit flow but only works on a member at 0 HP, restoring them
   *  to `heal_percent` of their max HP (default 50%). */
  const applyRevive = useCallback(
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
      const targetName =
        state.characters.find((c) => c.id === targetId)?.name ?? targetId;
      if (targetSaved.hp > 0) {
        setCastMessage(`${targetName} is not dead — Resurrection needs a fallen ally.`);
        return;
      }
      const params = (spell.action_params ?? {}) as { heal_percent?: number };
      const pct =
        typeof params.heal_percent === "number" && params.heal_percent > 0
          ? params.heal_percent
          : 0.5;
      const maxHp = state.maxHpById.get(targetId) ?? targetSaved.hp;
      const revivedHp = Math.max(1, Math.round(maxHp * pct));
      const nextMembers = cur.party.members.map((m) => {
        if (m.id !== casterId && m.id !== targetId) return m;
        let out = m;
        if (m.id === casterId) out = { ...out, mp: casterMp - cost };
        if (m.id === targetId) out = { ...out, hp: revivedHp };
        return out;
      });
      const casterName =
        state.characters.find((c) => c.id === casterId)?.name ?? casterId;
      setCastMessage(
        `${casterName} casts Resurrection — ${targetName} rises with ${revivedHp}/${maxHp} HP!`,
      );
      commit({
        ...cur,
        party: { ...cur.party, members: nextMembers },
      });
      onSpellCast?.(spell.id);
    },
    [state, liveSave, commit, onSpellCast],
  );

  /** Route an incoming Cast intent. Self-targeted spells fire
   *  immediately; ally-target spells stash the intent and open the
   *  target picker (rendered alongside the screen). Unsupported
   *  targetings show a message rather than failing silently. */
  const handleCastSpell = useCallback(
    (casterId: string, spellId: string) => {
      if (state.kind !== "ok") return;
      const spell = state.spells.find((s) => s.id === spellId);
      if (!spell) {
        setCastMessage(`Unknown spell: ${spellId}.`);
        return;
      }
      if (spell.action === "apply_effect") {
        // Out-of-combat, `targeting` is a battle-only concern — a
        // spell like Light is `select_tile` in battle (place the orb
        // on a battlefield cell) but on the party screen it has no
        // cell to land on and just attaches to the party as a
        // party_effects entry. So we dispatch purely on
        // action_params.effect_id and ignore targeting here. The
        // sheet already filters spells by `usable_in.includes("party")`
        // before showing the Cast button, so any apply_effect spell
        // that reaches us is supposed to be castable here.
        const effectId =
          (spell.action_params as { effect_id?: string } | undefined)
            ?.effect_id ?? spell.id;
        if (effectId === "magic_light") {
          applyLight(casterId, spell);
          return;
        }
        if (effectId === "repel_monsters") {
          applyRepel(casterId, spell);
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
      // Recall — sorcerer party teleport. No target picker; resolves
      // against the saved rune stone / start location on the host.
      if (spell.action === "teleport") {
        applyRecall(casterId, spell);
        return;
      }
      // Resurrection — open a picker listing only downed members.
      if (spell.action === "revive") {
        setPendingRevive({ casterId, spellId: spell.id });
        return;
      }
      setCastMessage(
        `${spell.name ?? spell.id} isn't wired up out of combat yet.`,
      );
    },
    [state, applyLight, applyRepel, applyRecall],
  );

  // P closes the screen — same as the inspector-key shortcut that
  // opened it. We deliberately do NOT trap Escape here anymore:
  // PartyScreen owns Escape end-to-end (its reducer calls our
  // `onClose` for the regular two-pane view; a dedicated handler
  // pops back to the two-pane view when the player is drilled into
  // a CharacterSheetSim). Having two window listeners both racing
  // on Escape was the bug that let Esc-in-sheet dismiss the whole
  // modal — see PartyScreen's `onClose` prop comment for context.
  //
  // The arrow/WASD swallow stays — it's defense in depth against
  // the world sim picking up movement keys while a modal is up
  // (overlaysOpenRef in PlayHost is the primary gate; this is
  // belt-and-braces).
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDropRuneStone}
              disabled={state.kind !== "ok"}
              className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 text-xs text-amber-100/90 hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              title="Place a Recall rune stone at the party's current location. The sorcerer's Recall spell teleports the party back here."
            >
              Drop Rune Stone
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
              title="Close (P or ESC)"
            >
              Close
            </button>
          </div>
        </div>
        <div className="p-3">
          {castMessage ? (
            <div className="mb-2 rounded border border-ember/40 bg-ember/15 px-2 py-1 text-xs text-parchment/90">
              {castMessage}
            </div>
          ) : null}
          {/* Race-active abilities surface on the per-character sheet
            * now (Use button on the matching ability row) rather than
            * in a separate party-screen strip. Tinker opens the
            * item picker below via `handleUseAbility`; Pickpocket
            * gets a "go talk to an NPC and click Steal" hint. */}
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
              onClose={onClose}
              onUseStashItem={handleUseStashItem}
              onSendStashItem={handleSendStashItem}
              onUsePersonalItem={handleUsePersonalItem}
              onReturnPersonalItem={handleReturnPersonalItem}
              onEquipPersonalItem={handleEquipPersonalItem}
              onUnequipSlot={handleUnequipSlot}
              onCastSpell={handleCastSpell}
              onUseAbility={handleUseAbility}
              abilityCooldowns={(() => {
                // Per-day class abilities — when the save's
                // `last_ability_day[id]` equals today's day index,
                // the ability is on cooldown until tomorrow. We
                // build one entry per gated id so the sheet shows
                // "Used today" on the button instead of leaving it
                // hot + letting the player click into a refusal.
                //
                // Hardcoding the id list keeps the surface narrow —
                // adding a future once-per-day class ability is a
                // one-line edit here. Tinker uses its own dedicated
                // `last_tinker_day` field (legacy compat) so we
                // check it separately.
                const today = dayIndex({
                  totalMinutes: liveSave.clockMinutes ?? 0,
                });
                const out = new Map<string, string>();
                const dayMap = liveSave.party.last_ability_day ?? {};
                for (const abilityId of ["craft_arrows", "craft_fire_arrows"]) {
                  const last = dayMap[abilityId];
                  if (typeof last === "number" && last >= today) {
                    out.set(abilityId, "Used today");
                  }
                }
                const lastTinker = liveSave.party.last_tinker_day;
                if (typeof lastTinker === "number" && lastTinker >= today) {
                  out.set("tinker", "Used today");
                }
                return out;
              })()}
              effectDurations={
                new Map<string, number>([
                  ["magic_light", liveSave.party.magic_light_steps ?? 0],
                  ["torch", liveSave.party.torch_steps ?? 0],
                  [
                    "repel_monsters",
                    liveSave.party.repel_monsters_steps ?? 0,
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
      {/* Target picker for Resurrection — lists only DOWNED members
       *  (hp ≤ 0). Living members are shown disabled so the player
       *  understands why they can't be picked. */}
      {pendingRevive && state.kind === "ok" ? (
        <ReviveTargetPicker
          casterId={pendingRevive.casterId}
          spell={
            state.spells.find((s) => s.id === pendingRevive.spellId) ?? null
          }
          characters={state.characters}
          maxHpById={state.maxHpById}
          roster={liveSave.party.roster}
          members={liveSave.party.members}
          onCancel={() => setPendingRevive(null)}
          onPick={(targetId) => {
            const spell = state.spells.find(
              (s) => s.id === pendingRevive.spellId,
            );
            if (spell) applyRevive(pendingRevive.casterId, targetId, spell);
            setPendingRevive(null);
          }}
        />
      ) : null}
      {/* Tinker item picker — opens when the player clicks the
       *  Tinker button on the actions strip above the Party
       *  screen. Lists the Tinker ability's own `tinker_items`
       *  (curated in the editor); clicking an item runs the helper,
       *  surfaces the result in the cast-message banner, and closes
       *  the picker. */}
      {pendingTinker && state.kind === "ok" ? (
        <TinkerPicker
          stockIds={tinkerStockFor(
            state.abilities.find((a) => a.id === "tinker"),
          )}
          items={state.items}
          onPick={handleTinkerPick}
          onCancel={() => setPendingTinker(false)}
        />
      ) : null}
      {/* Craft item picker — same shape as Tinker but the stock
       *  list comes from `craftStockFor(abilityId)` so Craft Arrows
       *  shows Arrows / Bolts and Craft Fire Arrows shows Fire
       *  Arrows. The picker reuses TinkerPicker with a different
       *  header label since the layout is identical. */}
      {pendingCraft && state.kind === "ok" ? (
        <TinkerPicker
          title={`${pendingCraft.abilityName} — pick an item`}
          stockIds={craftStockFor(pendingCraft.abilityId)}
          items={state.items}
          onPick={handleCraftPick}
          onCancel={() => setPendingCraft(null)}
        />
      ) : null}
      {/* Brew Potion recipe picker — opens when the Alchemist
       *  clicks brew_potion on their character sheet. Lists every
       *  recipe in the catalog; recipes whose reagents the party
       *  can't fully supply right now render greyed out with a
       *  "missing 2x serpent_root" hover hint so the player can
       *  see what to forage for. */}
      {pendingBrew && state.kind === "ok" ? (
        <BrewPicker
          recipes={state.recipes}
          items={state.items}
          save={liveSave}
          onPick={handleBrewPick}
          onCancel={() => setPendingBrew(false)}
        />
      ) : null}
    </div>
  );
}

/** Modal picker rendered over the Party screen when the player
 *  clicks the Tinker action. Lists the deduped General Store
 *  stock; each row is clickable and routes to `onPick(itemId)`.
 *  Same dark-modal treatment HealTargetPicker uses for visual
 *  consistency. ESC cancels (handled via the parent's keydown
 *  capture, same as the heal picker). */
function TinkerPicker({
  stockIds,
  items,
  onPick,
  onCancel,
  title = "Tinker — pick an item",
}: {
  stockIds: ReadonlyArray<string>;
  items: ReadonlyArray<PartyItemRef>;
  onPick: (itemId: string) => void;
  onCancel: () => void;
  /** Modal header label. Defaults to the Tinker prompt; the Craft
   *  ability flow overrides with the ability's display name so the
   *  same picker doubles for both ability families without
   *  spawning a near-duplicate component. */
  title?: string;
}) {
  const itemById = new Map(items.map((i) => [i.id, i] as const));
  // Keyboard navigation: Up/Down move the highlight, Enter picks the
  // highlighted row, ESC cancels. Capture phase so the parent
  // overlay's close-on-ESC + the underlying sim's movement keys don't
  // fire under the modal.
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Clamp the cursor if the stock list shrinks between renders.
  useEffect(() => {
    setFocusIndex((i) => Math.min(i, Math.max(0, stockIds.length - 1)));
  }, [stockIds.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (stockIds.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setFocusIndex((i) => Math.min(i + 1, stockIds.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const id = stockIds[focusIndex];
        if (id) onPick(id);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, onPick, stockIds, focusIndex]);
  // Keep the highlighted row in view as the cursor moves.
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      '[data-nav-focused="true"]',
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={rootRef}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg border border-parchment/25 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h3 className="font-display text-sm text-parchment">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          >
            Cancel
          </button>
        </div>
        {stockIds.length === 0 ? (
          <p className="px-3 py-4 text-sm text-parchment/55">
            No general-store stock in this module.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-auto p-2">
            {stockIds.map((id, i) => {
              const def = itemById.get(id);
              const focused = i === focusIndex;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    onMouseEnter={() => setFocusIndex(i)}
                    data-nav-focused={focused ? "true" : undefined}
                    className={[
                      "flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm text-parchment hover:bg-ink/60",
                      focused
                        ? "outline outline-2 outline-amber-200 outline-offset-1"
                        : "",
                    ].join(" ")}
                    title={def?.description ?? id}
                  >
                    <span className="font-display">{def?.name ?? id}</span>
                    <span className="font-mono text-[11px] text-parchment/55">
                      {id}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Modal picker rendered over the Party screen when the Alchemist
 *  clicks the brew_potion ability. Lists every recipe in the
 *  catalog; per-row "ready / missing X" status comes from
 *  `recipeShortages`. Ready rows are clickable; short rows render
 *  greyed out with a hint about what's missing so the player can
 *  see what to forage for. Same dark-modal frame TinkerPicker /
 *  HealTargetPicker use; ESC + backdrop click cancel.
 *
 *  Sorted ready-first so the player sees their options at the
 *  top of the list — keeps the "what can I brew right now"
 *  read instant. */
function BrewPicker({
  recipes,
  items,
  save,
  onPick,
  onCancel,
}: {
  recipes: ReadonlyArray<RecipeRef>;
  items: ReadonlyArray<PartyItemRef>;
  save: WorldSave;
  onPick: (recipeId: string) => void;
  onCancel: () => void;
}) {
  const itemById = new Map(items.map((i) => [i.id, i] as const));
  // Precompute the shortage map per recipe — cheaper than two
  // passes (filter for ready, then render) and lets the row render
  // the missing-reagent hint without re-deriving.
  const stockableItems = items.map((i) => ({
    id: i.id,
    stackable: (i as { stackable?: boolean }).stackable,
    charges: (i as { charges?: number }).charges,
  }));
  const annotated = recipes.map((r) => ({
    recipe: r,
    shortages: recipeShortages(save, r, stockableItems),
  }));
  const ready = annotated.filter((a) => Object.keys(a.shortages).length === 0);
  const short = annotated.filter((a) => Object.keys(a.shortages).length > 0);
  // Keyboard navigation moves only through the BREWABLE (ready)
  // recipes — the greyed-out short rows aren't actionable, so the
  // highlight skips them. Up/Down move, Enter brews the highlighted
  // recipe, ESC cancels. Ready rows render first, so their position
  // in the list equals their index in `ready`.
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setFocusIndex((i) => Math.min(i, Math.max(0, ready.length - 1)));
  }, [ready.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (ready.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setFocusIndex((i) => Math.min(i + 1, ready.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const pick = ready[focusIndex];
        if (pick) onPick(pick.recipe.id);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, onPick, ready, focusIndex]);
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      '[data-nav-focused="true"]',
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  /** Format a shortage map into a hint line like
   *  "missing 1× Moonpetal, 2× Spring Water". Names come from
   *  items.json when known; falls back to the raw id otherwise. */
  function shortageHint(s: Record<string, number>): string {
    const parts: string[] = [];
    for (const [id, count] of Object.entries(s)) {
      const name = itemById.get(id)?.name ?? id;
      parts.push(`${count}× ${name}`);
    }
    return `missing ${parts.join(", ")}`;
  }

  /** Format a recipe's reagent list into a one-line summary —
   *  "Moonpetal, Spring Water" — shown under the recipe name so
   *  the player can read the cost without expanding a tooltip. */
  function reagentSummary(reagents: Record<string, number>): string {
    return Object.entries(reagents)
      .map(([id, count]) => {
        const name = itemById.get(id)?.name ?? id;
        return count > 1 ? `${count}× ${name}` : name;
      })
      .join(", ");
  }

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={rootRef}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-parchment/25 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h3 className="font-display text-sm text-parchment">
            Brew Potion — pick a recipe
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          >
            Cancel
          </button>
        </div>
        {recipes.length === 0 ? (
          <p className="px-3 py-4 text-sm text-parchment/55">
            No recipes in this module.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-auto p-2">
            {[...ready, ...short].map(({ recipe, shortages }, i) => {
              const out = itemById.get(recipe.result_item);
              const isReady = Object.keys(shortages).length === 0;
              // Ready rows render first, so their list index doubles
              // as their index into `ready` — that's what the cursor
              // tracks.
              const focused = isReady && i === focusIndex;
              return (
                <li key={recipe.id}>
                  <button
                    type="button"
                    onClick={() => (isReady ? onPick(recipe.id) : undefined)}
                    onMouseEnter={() => (isReady ? setFocusIndex(i) : undefined)}
                    disabled={!isReady}
                    data-nav-focused={focused ? "true" : undefined}
                    className={[
                      isReady
                        ? "flex w-full flex-col rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm text-parchment hover:bg-ink/60"
                        : "flex w-full flex-col rounded border border-parchment/10 bg-ink/20 px-3 py-2 text-left text-sm text-parchment/40 cursor-not-allowed",
                      focused
                        ? "outline outline-2 outline-amber-200 outline-offset-1"
                        : "",
                    ].join(" ")}
                    title={out?.description ?? recipe.result_item}
                  >
                    <span className="flex items-center justify-between">
                      <span className="font-display">
                        {recipe.name ?? recipe.id}
                      </span>
                      <span className="font-mono text-[11px] text-parchment/55">
                        {recipe.result_item}
                      </span>
                    </span>
                    <span className="mt-0.5 text-[11px] text-parchment/55">
                      {reagentSummary(recipe.reagents)}
                    </span>
                    {!isReady ? (
                      <span className="mt-0.5 text-[11px] italic text-amber-300/70">
                        {shortageHint(shortages)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
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

/** Target picker for Resurrection. Mirrors {@link HealTargetPicker}
 *  but only enables DOWNED members (hp ≤ 0) — living allies are shown
 *  greyed-out so the player sees the full roster and understands why
 *  they can't be targeted. */
function ReviveTargetPicker({
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
  const anyDead = roster.some((id) => (memberById.get(id)?.hp ?? 1) <= 0);
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
            {casterName} casts {spell?.name ?? "Resurrection"} — pick the fallen
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          >
            Cancel
          </button>
        </div>
        {!anyDead ? (
          <p className="px-3 py-3 text-sm text-parchment/65">
            No fallen companions to raise.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {roster.map((id) => {
              const c = characterById.get(id);
              const m = memberById.get(id);
              if (!c || !m) return null;
              const max = maxHpById.get(id) ?? m.hp;
              const dead = m.hp <= 0;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    className="flex w-full items-center justify-between rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm text-parchment hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!dead}
                    title={dead ? `Resurrect ${c.name}.` : `${c.name} is alive.`}
                  >
                    <span className="font-display">{c.name}</span>
                    <span className="font-mono text-xs text-parchment/70">
                      {dead ? "DOWNED" : `HP ${m.hp}/${max}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
