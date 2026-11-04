"use client";

/**
 * PartyScreen — reusable React port of v1's Party Inventory screen
 * (the one opened with the `P` key in the game). Two-pane layout:
 *
 *   ┌──────────────── PARTY ────────────────┐
 *   │ EFFECTS              │ PARTY [1-N]    │
 *   │ ▸ Detect Traps       │ ┌──┐ 1 Aldric  │
 *   │   Infravision REQ…   │ │  │ Fighter…  │
 *   │   Magic Light        │ └──┘ HP ▓▓▓▓   │
 *   │ ──────               │ … per member   │
 *   │ CAST SPELL           │ ──────         │
 *   │ PICKPOCKET (race)    │ AVAILABLE      │
 *   │ ──────               │ EFFECT detail  │
 *   │ SHARED STASH (n)     │                │
 *   │   Torch (1)          │ GOLD: 50       │
 *   │   Rock (20)          │ STASH: 3       │
 *   ├──────────────────────┴────────────────┤
 *   │ [↑↓] select [Enter] action [1-N] char │
 *   └───────────────────────────────────────┘
 *
 * Scope intent — this is a PREVIEW component:
 *
 *   - Roster, stash, and gold are READ-ONLY. The component never
 *     mutates the Party record passed in.
 *   - The EFFECTS list IS interactive in the sense that the user can
 *     pick which available abilities are "active" for the preview
 *     (so encounter behavior or lighting checks could read off the
 *     set). Assignment state is held by the host as
 *     `activeEffectIds`; it's up to the host whether to persist it
 *     (today nobody does — the screen is showcase-only).
 *   - Effect availability is derived from the live roster: an ability
 *     is "available" iff some current member's class (with min_level
 *     met) or race grants it. Anything else shows REQ NOT MET.
 *
 * Reusable surface — same component will mount inside the Party editor
 * AND inside the Map editor's simulation mode (P key opens it as a
 * modal). Future game-side party screen can also mount it as the
 * non-keyboard fallback while the Phaser equivalent is built.
 */

import { isPartyEffectActive } from "@/play/partyEffects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { xpProgressInLevel as levelingXpProgress } from "@/battle/world/Leveling";
import type { EquipSource } from "@/play/equipFromInventory";
import {
  initialPartyNavState,
  reducePartyNav,
  ACTION_USE,
  type PartyNavContext,
} from "./partyScreenNav";
import {
  CharacterSheetSim,
  type SheetItemRef,
} from "./CharacterSheetSim";
import { DurabilityBar } from "./DurabilityBar";
import { ItemSprite } from "./ItemSprite";
import { resolveSpritePath } from "./spriteFields";

// ── Data shapes (loose by design — the host loads JSON, we render) ──

export interface PartyInventoryEntry {
  item: string;
  charges?: number;
  durability?: number;
}

export interface PartyRecord {
  gold?: number;
  roster?: string[];
  /** Currently-active party-wide Ability ids — the dynamic
   *  replacement for v1's fixed `{effect_1..4}` slot object. Each
   *  entry is the id of an Ability with `party_effect: true`. */
  party_effects?: string[];
  inventory?: PartyInventoryEntry[];
  torch_steps?: number;
  [k: string]: unknown;
}

export interface PartyCharacterRef {
  id: string;
  name: string;
  class: string;
  race: string;
  gender?: string;
  level: number;
  exp?: number;
  hp: number;
  mp?: number;
  /** Peak HP / MP at the current level — sourced from the static
   *  catalog character at load time and stitched on by the play
   *  overlay (PlayPartyScreenOverlay). Absent in pure-catalog
   *  contexts (editor preview), where consumers fall back to
   *  treating current as max. */
  maxHp?: number;
  maxMp?: number;
  /** Per-character active effects (poison, buffs, curses, etc.)
   *  copied off SavedCharacterState by the play overlay so the
   *  roster card and sheet can surface "Poisoned (4 steps)" etc.
   *  Absent in editor preview. */
  effects?: ReadonlyArray<{
    id: string;
    duration: number | "permanent" | "instant" | "until_save";
  }>;
  /** Ability scores. Default to 10 (the canonical "no modifier"
   *  value) when the source record omits them — keeps the sheet's
   *  stat math sane for partial drafts. */
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  /** Equipped slots — keyed by slot id ("hands", "body"). v2 uses
   *  Item ids; the sim resolves them against the items catalog. */
  equipped?: Record<string, string>;
  /** Personal-inventory bag carried by this character (separate from
   *  the party's shared stash). */
  inventory?: Array<Record<string, unknown>>;
  sprite?: string;
  [k: string]: unknown;
}

export interface PartyRaceRef {
  id: string;
  name?: string;
  abilities?: string[];
  exp_per_level?: number | null;
}

/** Class-abilities link in character_classes.json — the v2 schema
 *  uses `ability_id` (a foreign key into abilities.json) rather than
 *  a bare `id`. Keeping `id` as an optional fallback so legacy
 *  callers (e.g. a hand-built test fixture) don't have to migrate. */
export interface PartyClassAbilityRef {
  ability_id?: string;
  id?: string;
  min_level?: number;
}

export interface PartyClassRef {
  id: string;
  name?: string;
  abilities?: PartyClassAbilityRef[];
  /** Spell catalogs this class can draw from — values are
   *  `"sorcerer"`, `"priest"`, or `"none"`. Used by the character
   *  sheet to filter the Spells list by which catalog the class
   *  reads. */
  casting_type?: string[];
}

export interface PartyAbilityRef {
  id: string;
  name?: string;
  /** Icon stem under sprites/abilities/ — shown beside the name on
   *  the character sheet. */
  icon?: string;
  type?: "race" | "class" | "other" | string;
  description?: string;
  duration?: number | string | null;
  /** When true, this Ability is a togglable party-wide effect — its
   *  id can appear in `Party.party_effects[]` and the in-game Effects
   *  list renders it as a toggle. Combat-only actions and
   *  character-only passives leave this absent/false. */
  party_effect?: boolean;
  /** Where the player can actively trigger this Ability. Mirrors
   *  `Spell.usable_in` — `"battle"` for combat actions, `"party"` for
   *  out-of-combat actions surfaced as a Use button on the character
   *  sheet. Absent / empty = passive. */
  usable_in?: string[];
  /** Per-ability knob bag (mirrors the data model's `params`). Carried
   *  through so play-side helpers can read ability-specific config —
   *  e.g. Tinker's `tinker_items` list that drives its item picker. */
  params?: Record<string, unknown> | null;
}

export interface PartyItemRef {
  id: string;
  name?: string;
  /** Flavor / mechanical description shown in the Examine pane. */
  description?: string;
  /** True for consumables / scrolls / etc. — anything the player can
   *  "Use" from the stash. When absent or false the Use button is
   *  greyed out. Hosts populate this from items.json's `usable` field. */
  usable?: boolean;
  /** True when multiple copies of this id collapse into a single
   *  inventory row (Torch, Arrows, Lockpicks, Potions, …). Read by
   *  the inventory-stacking helpers in `@/play/inventoryStacking` to
   *  decide whether to merge or push on add. Weapons / armor stay
   *  one-row-per-copy. */
  stackable?: boolean;
  /** Equipment slots from items.json (`["hands"]` for weapons,
   *  `["body"]` for armor). Non-empty = equipable; the Inventory
   *  list sorts those first. */
  slots?: string[];
  /** Catalog charges field — semantic is "per-USE effect" (e.g. a
   *  Torch burns 150 steps when lit; a Lockpick has 5 attempts).
   *  This is NOT inventory quantity; that lives on the inventory
   *  entry's own `charges` field. Read by hosts at use-time to seed
   *  whatever counter the use applies. */
  charges?: number;
  /** Max durability the catalog assigns to this item. 0 / absent
   *  means indestructible — surfaced as "no bar" in the inventory
   *  list. The per-instance current value lives on the inventory
   *  entry's own `durability` field (and on `equipped_durability`
   *  for currently-worn gear). */
  durability?: number;
  /** Optional render hint copied from items.json — purely for the
   *  Examine readout right now. */
  icon?: string;
  /** When false, the stash's "Send to…" button hides for this item.
   *  Camping Supplies is the canonical example: it's used for the
   *  whole party from the stash and never carried by one member.
   *  Default (absent) is true. */
  sendable_to_character?: boolean;
  /** Catalog stats surfaced by the Examine panel (all optional —
   *  hosts pass the raw items.json records straight through). */
  category?: string;
  item_type?: string;
  power?: number;
  ranged?: boolean;
  throwable?: boolean;
  finesse?: boolean;
  range?: number;
  ammo?: string;
  evasion?: number;
  damage_type?: string;
  bonus_damage?: string | number;
  light_range?: number;
  ignite?: boolean;
  effect?: string;
  quest_item?: boolean;
  wielder_passives?: string[];
  buy?: number;
  sell?: number;
}

export interface PartySpellRef {
  id: string;
  name?: string;
  /** Icon stem under sprites/spells/ (e.g. "fireball" →
   *  spells/fireball.png) — shown beside the name on the sheet. */
  icon?: string;
  description?: string;
  casting_type?: string;
  min_level?: number;
  mp_cost?: number;
  range?: number;
  targeting?: string;
  usable_in?: string[];
  duration?: number | string | null;
  action?: string;
  /** Spell-specific parameters. Shape varies by `action` — heals
   *  carry `{ dice_count, dice_sides, stat_bonus, min_heal }`, the
   *  Light spell carries `{ effect_id }`, etc. Left as `unknown` here
   *  to keep the type loose; the cast handlers (PlayPartyScreenOverlay)
   *  narrow as needed. */
  action_params?: Record<string, unknown>;
  /** Per-class min_level overrides — keyed by class id. When the
   *  character's class id appears here, that level gates eligibility
   *  instead of the global `min_level`. */
  class_min_levels?: Record<string, number>;
}

const SPRITE_CONFIG = { category: "person", format: "path" } as const;

// ── Helpers ─────────────────────────────────────────────────────────

/** XP progress *within the current level* — the numbers driving the
 *  roster card's XP bar. Thin adapter over Leveling.ts's
 *  `xpProgressInLevel` (the single source of truth for the XP curve,
 *  including the rising-increment math) that handles this screen's
 *  optional fields and race override defaulting (1500 when the
 *  race's `exp_per_level` is absent). */
function xpProgressInLevel(
  member: PartyCharacterRef,
  race?: PartyRaceRef,
): { into: number; needed: number } {
  const base = race?.exp_per_level ?? 1500;
  return levelingXpProgress(member.level ?? 1, member.exp ?? 0, base);
}

/** Resolve the set of ability ids unlocked by `members`. An ability is
 *  unlocked when any active member has the granting class (with the
 *  ability's min_level met) or the granting race. */
function computeUnlockedAbilities(
  members: ReadonlyArray<PartyCharacterRef>,
  races: ReadonlyArray<PartyRaceRef>,
  classes: ReadonlyArray<PartyClassRef>,
): Set<string> {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const m of members) {
    const r = raceById.get(m.race);
    if (r?.abilities) for (const id of r.abilities) out.add(id);
    const k = classById.get(m.class);
    if (k?.abilities) {
      for (const a of k.abilities) {
        const abilityId = a.ability_id ?? a.id;
        if (!abilityId) continue;
        if ((a.min_level ?? 1) <= m.level) out.add(abilityId);
      }
    }
  }
  return out;
}

/** Pretty-print a duration value (number = turns, "permanent", etc.). */
function fmtDuration(d: number | string | null | undefined): string {
  if (d == null) return "—";
  if (typeof d === "number") {
    return `${d} ${d === 1 ? "turn" : "turns"}`;
  }
  return String(d);
}

/** Build a short "Requires: …" string for an ability — the union of
 *  races and class+minLevel combos that grant it. Powers the right-
 *  panel detail row + the REQ NOT MET hint. */
function requirementsFor(
  abilityId: string,
  races: ReadonlyArray<PartyRaceRef>,
  classes: ReadonlyArray<PartyClassRef>,
): string {
  const parts: string[] = [];
  for (const r of races) {
    if (r.abilities?.includes(abilityId)) {
      parts.push(r.name ?? r.id);
    }
  }
  for (const c of classes) {
    const a = c.abilities?.find(
      (x) => (x.ability_id ?? x.id) === abilityId,
    );
    if (a) {
      const lvl = a.min_level ?? 1;
      parts.push(`${c.name ?? c.id}${lvl > 1 ? ` (Lv ${lvl}+)` : ""}`);
    }
  }
  return parts.length === 0 ? "—" : parts.join(" or ");
}

// ── Row types for the left list ─────────────────────────────────────

type EffectRow = {
  kind: "effect";
  ability: PartyAbilityRef;
  /** True when at least one party member unlocks this ability. */
  available: boolean;
  /** True when the host has flagged it active in the preview set. */
  active: boolean;
  /** Optional remaining-duration counter (in step ticks). Surfaced on
   *  the row as "(N steps)" so the player can see how long the
   *  Magic Light spell has left before it burns out. Undefined for
   *  effects without a duration counter (toggle-only effects like
   *  Infravision or Detect Traps). */
  durationSteps?: number;
  /** Set on one-shot action rows — activating the row fires this
   *  instead of toggling an effect:
   *   - "item": Use the `party.inventory` row ("Light Torch", "Camp")
   *   - "spell": a party-castable spell a roster member knows
   *   - "ability": a race / class ability usable from the party
   *     screen (`usable_in` includes "party") */
  action?:
    | { kind: "item"; inventoryIndex: number }
    | { kind: "spell"; casterId: string; spellId: string }
    | { kind: "ability"; memberId: string; ability: PartyAbilityRef };
  /** Muted right-hand label — who casts / uses it, or a cooldown. */
  note?: string;
};

/** True when the spell can be cast outside battle (`usable_in`
 *  absent / empty, or listing "party"). Mirrors the character
 *  sheet's rule for showing a Cast button. */
function spellCastableFromParty(spell: PartySpellRef): boolean {
  const u = spell.usable_in;
  return !Array.isArray(u) || u.length === 0 || u.includes("party");
}

/** Inventory items that unlock an action in the Effects list while
 *  the party holds at least one. The items themselves stay in the
 *  Inventory (they can still be sold / sent / replaced). Matching is
 *  on the item id (plus the legacy display-name ids older saves still
 *  carry). */
const EFFECT_ITEM_ACTIONS: ReadonlyArray<{
  ids: readonly string[];
  label: string;
}> = [
  { ids: ["torch", "Torch"], label: "Light Torch" },
  { ids: ["camping_supplies", "Camping Supplies"], label: "Camp" },
];

/** Display-name fallback for synthesized effect rows (effects whose
 *  id appears in `party_effects` but isn't backed by an Ability
 *  record — e.g., the Cleric's Light spell). When the id is missing
 *  from this table we fall back to a Title-Cased version of the id. */
const SYNTHETIC_EFFECT_NAMES: Record<string, string> = {
  magic_light: "Light",
  torch: "Torch",
  infravision: "Infravision",
  detect_traps: "Detect Traps",
  repel_monsters: "Repel Monsters",
};

function prettifyEffectId(id: string): string {
  if (SYNTHETIC_EFFECT_NAMES[id]) return SYNTHETIC_EFFECT_NAMES[id];
  return id
    .split("_")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Where an item being equipped / unequipped currently lives. */
export type { EquipSource } from "@/play/equipFromInventory";

/** One row of the Inventory list — either a shared-inventory entry or
 *  a piece of gear a party member is wearing (shown with their
 *  avatar). */
type InvRow =
  | {
      kind: "stash";
      invIdx: number;
      item: string;
      charges?: number;
      durability?: number;
    }
  | {
      kind: "equipped";
      memberId: string;
      slot: string;
      item: string;
      durability?: number;
    };

// ── Component ───────────────────────────────────────────────────────

export function PartyScreen({
  party,
  characters,
  races,
  classes,
  abilities,
  items,
  spells = [],
  activeEffectIds,
  onActiveEffectsChange,
  onReorderRoster,
  onUseStashItem,
  onSendStashItem,
  onCastSpell,
  onUsePersonalItem,
  onReturnPersonalItem,
  onEquipPersonalItem,
  onUseAbility,
  abilityCooldowns,
  onUnequipSlot,
  effectDurations,
  onClose,
  onSheetBackChange,
  onEquipItem,
}: {
  party: PartyRecord;
  /** Full character records for the party's roster ids. Missing ids
   *  are skipped — they render as gaps in the roster pane. */
  characters: ReadonlyArray<PartyCharacterRef>;
  races: ReadonlyArray<PartyRaceRef>;
  classes: ReadonlyArray<PartyClassRef>;
  abilities: ReadonlyArray<PartyAbilityRef>;
  items: ReadonlyArray<PartyItemRef>;
  /** Full Spell catalog — forwarded to CharacterSheetSim on drill-in
   *  so the per-character "Spells" section can filter by class. The
   *  Party screen itself doesn't render the spell list. */
  spells?: ReadonlyArray<PartySpellRef>;
  /** Which optional abilities are currently flagged as "active" for
   *  preview. The host owns this; the screen toggles via the
   *  onActiveEffectsChange callback. Passing an empty array shows
   *  nothing selected. */
  activeEffectIds: ReadonlyArray<string>;
  onActiveEffectsChange: (ids: ReadonlyArray<string>) => void;
  /** When provided, roster cards become draggable: the callback fires
   *  with the reordered character-id list whenever the user drops a
   *  card on a new position. Omit to keep the roster read-only (the
   *  default for hosts that don't persist edits). Click-to-drill-in
   *  still works — mouse-down without a drag is a click, mouse-down +
   *  movement is a drag start. */
  onReorderRoster?: (newOrder: string[]) => void;
  /** Optional handler — when provided, the Use button appears on
   *  stash items the items catalog flags `usable`. The host wires it
   *  to the matching PartyActions helper (consumeTorch /
   *  consumeCampingSupplies / etc.) and persists. Receives the
   *  stash-row index so duplicate items resolve unambiguously. */
  onUseStashItem?: (stashIndex: number) => void;
  /** Optional handler — when provided, the Send to… button appears on
   *  every stash item. After the player picks a recipient (1-N or
   *  click), the screen invokes this callback with the stash row +
   *  the destination roster index. Host wires to
   *  PartyActions.giveStashItemTo. */
  onSendStashItem?: (stashIndex: number, memberIndex: number) => void;
  /** Optional handler — when provided, Cast buttons on per-character
   *  spell rows fire this callback (caster id + spell id). The host
   *  resolves the spell's targeting (self / pick-an-ally / etc),
   *  applies MP / HP / counter mutations, and persists to the save.
   *  Omitted in editor previews where casting is a no-op. */
  onCastSpell?: (casterId: string, spellId: string) => void;
  /** Use one item from a character's personal inventory. The host
   *  applies the effect (Torch → bumps party light, etc.) and
   *  persists. Forwarded to CharacterSheetSim on drill-in; in the
   *  resting Party screen the personal inventories aren't shown so
   *  this is a no-op here. */
  onUsePersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Move one item from a character's personal inventory back into
   *  the shared stash. */
  onReturnPersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Equip a personal inventory item into the slot named by its
   *  `slots` array (weapons → hands, armor → body). The host
   *  handles bouncing whatever was already in that slot back into
   *  the inventory. */
  onEquipPersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Move an equipped item back into the character's personal
   *  inventory. */
  onUnequipSlot?: (memberId: string, slot: string) => void;
  /** Fires when the player clicks "Use" on a race / class ability
   *  in the drilled-in character sheet. Forwarded straight to
   *  `CharacterSheetSim.onUseAbility`. Hosts route by `ability.id`
   *  (Tinker → opens the item picker, Pickpocket → tells the
   *  player to use Steal from the NPC dialog, …). When omitted,
   *  the sheet falls back to its built-in "preview only" flash. */
  onUseAbility?: (memberId: string, ability: PartyAbilityRef) => void;
  /** Per-ability cooldown labels keyed by ability id — passed
   *  through to `CharacterSheetSim.abilityCooldowns` so a
   *  once-per-day class ability (Craft Arrows, Craft Fire Arrows,
   *  Tinker) shows the cooldown ON the button instead of just
   *  refusing on click. Hosts compute the map from the live save's
   *  `last_ability_day` against the current day. Absent / empty
   *  map = no abilities on cooldown. */
  abilityCooldowns?: ReadonlyMap<string, string>;
  /** Remaining-step counter per active effect id. Used to render a
   *  "(N steps)" suffix on the matching effect row. Effects that
   *  have a counter but aren't yet in `activeEffectIds` (e.g. a
   *  spell-cast Light whose id isn't in the ability catalog) get a
   *  synthesized row so the player can see the timer. Counters at
   *  zero are treated as "no duration shown." */
  effectDurations?: ReadonlyMap<string, number>;
  /** Dismiss callback — when provided, PartyScreen owns Escape
   *  handling end-to-end: pressing Escape in the regular two-pane
   *  view calls this; pressing Escape inside a drilled-in
   *  CharacterSheetSim pops back to the two-pane view instead.
   *
   *  Previously the host overlays (PlayPartyScreenOverlay,
   *  MapPartyScreenOverlay) installed their own window-level Esc
   *  handlers that called their `onClose` directly, and PartyScreen
   *  tried to win the listener race to intercept Esc-while-drilled.
   *  That race turned out to be too brittle (registration order,
   *  StrictMode double-mounts, …), so closing is centralized here
   *  now. Hosts still own the modal's open/close state; this is
   *  just the keystroke routing. */
  onClose?: () => void;
  /** Called whenever a character sheet opens (with a function that
   *  returns to the two-pane Party view) or closes (with null). The
   *  host renders its own Back button in the modal's top bar from
   *  this — the sheet itself no longer has a title bar. */
  onSheetBackChange?: (back: (() => void) | null) => void;
  /** Equip / unequip straight from the Inventory list. `source` is
   *  either a shared-inventory row or a member's equipped slot;
   *  `targetMemberId` is who should wear it, or null to unequip back
   *  into the inventory. Omit to make the Inventory read-only for
   *  gear (editor preview). */
  onEquipItem?: (
    source: EquipSource,
    targetMemberId: string | null,
  ) => void;
}) {
  // ── Resolve roster ──────────────────────────────────────────────
  const members = useMemo(() => {
    const byId = new Map(characters.map((c) => [c.id, c]));
    return (party.roster ?? [])
      .map((id) => byId.get(id))
      .filter((m): m is PartyCharacterRef => Boolean(m));
  }, [party.roster, characters]);

  const raceById = useMemo(
    () => new Map(races.map((r) => [r.id, r])),
    [races],
  );
  const classById = useMemo(
    () => new Map(classes.map((c) => [c.id, c])),
    [classes],
  );
  const itemNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) m.set(it.id, it.name ?? it.id);
    return m;
  }, [items]);
  /** Catalog lookup by id — the stash detail panel reads description /
   *  usable / icon off the full record. Built once per items change so
   *  per-row lookups in the render don't iterate the catalog. */
  const itemById = useMemo(() => {
    const m = new Map<string, PartyItemRef>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const unlocked = useMemo(
    () => computeUnlockedAbilities(members, races, classes),
    [members, races, classes],
  );

  // ── Build the EFFECTS list ──────────────────────────────────────
  // Only abilities flagged `party_effect: true` AND unlocked by some
  // current roster member belong here. Unavailable effects are
  // omitted entirely — the player shouldn't see options they can't
  // use. The list is dynamic; there's no fixed slot count.
  const effectRows: EffectRow[] = useMemo(() => {
    // A timed effect (one with a step counter — Light, Torch, Push's
    // repel) is on only while its counter runs. The id can linger in
    // `party_effects` after it burns out (the save reconciles on the
    // next checkpoint), so the counter wins: at 0 the row reads as off.
    const isActive = (id: string): boolean =>
      isPartyEffectActive(id, activeEffectIds, effectDurations);
    const rows: EffectRow[] = abilities
      .filter((a) => a.party_effect === true && unlocked.has(a.id))
      .map((a) => ({
        kind: "effect" as const,
        ability: a,
        available: true,
        active: isActive(a.id),
        durationSteps:
          effectDurations && effectDurations.get(a.id)
            ? effectDurations.get(a.id)
            : undefined,
      }));

    // Synthesize rows for effects in the active list (or with a live
    // duration counter) that DON'T have a backing ability — e.g., the
    // Cleric's Light spell adds `magic_light` to `party_effects` but
    // there's no Ability record for it. Without this pass, casting
    // Light would silently activate without ever appearing in the
    // Effects list.
    const existingIds = new Set(rows.map((r) => r.ability.id));
    const extraIds = new Set<string>();
    for (const id of activeEffectIds) {
      if (!existingIds.has(id) && isActive(id)) extraIds.add(id);
    }
    if (effectDurations) {
      for (const [id, steps] of effectDurations) {
        if (steps > 0 && !existingIds.has(id)) extraIds.add(id);
      }
    }
    for (const id of extraIds) {
      const dur = effectDurations?.get(id);
      rows.push({
        kind: "effect",
        ability: {
          id,
          name: prettifyEffectId(id),
          party_effect: true,
        },
        available: true,
        active: isActive(id),
        durationSteps: dur && dur > 0 ? dur : undefined,
      });
    }

    // Castable spells — one row per spell any roster member knows
    // (class casting_type + level gate, same rule as the character
    // sheet) that can be cast outside battle. When several members
    // know it, the caster is whoever can afford it with the most MP
    // left; the caster's name shows on the right.
    const spellCasters = new Map<string, PartyCharacterRef[]>();
    for (const m of members) {
      const klass = classById.get(m.class);
      const types = klass?.casting_type;
      if (!types || types.length === 0) continue;
      for (const sp of spells) {
        if (!sp.casting_type || !types.includes(sp.casting_type)) continue;
        const gate = sp.class_min_levels?.[m.class] ?? sp.min_level ?? 1;
        if ((m.level ?? 1) < gate) continue;
        if (!spellCastableFromParty(sp)) continue;
        const list = spellCasters.get(sp.id) ?? [];
        list.push(m);
        spellCasters.set(sp.id, list);
      }
    }
    for (const sp of spells) {
      const casters = spellCasters.get(sp.id);
      if (!casters) continue;
      const cost = sp.mp_cost ?? 0;
      const caster = [...casters].sort((a, b) => {
        const aOk = (a.mp ?? 0) >= cost ? 1 : 0;
        const bOk = (b.mp ?? 0) >= cost ? 1 : 0;
        return bOk - aOk || (b.mp ?? 0) - (a.mp ?? 0);
      })[0];
      rows.push({
        kind: "effect",
        ability: {
          id: `cast:${sp.id}`,
          name: sp.name ?? sp.id,
          description: sp.description,
        },
        available: true,
        active: false,
        action: { kind: "spell", casterId: caster.id, spellId: sp.id },
        note: `${caster.name} · ${cost} MP`,
      });
    }

    // Race / class abilities usable from the party screen. Toggle
    // effects (`party_effect`) are already rows above, so skip them.
    const seenAbilities = new Set(rows.map((r) => r.ability.id));
    const abilityById = new Map(abilities.map((a) => [a.id, a]));
    for (const m of members) {
      const granted = [
        ...(raceById.get(m.race)?.abilities ?? []),
        ...(classById.get(m.class)?.abilities ?? [])
          .filter((l) => (l.min_level ?? 1) <= (m.level ?? 1))
          .map((l) => l.ability_id ?? l.id ?? ""),
      ];
      for (const id of granted) {
        const a = abilityById.get(id);
        if (!a || a.party_effect) continue;
        if (!(a.usable_in ?? []).includes("party")) continue;
        if (seenAbilities.has(a.id)) continue;
        seenAbilities.add(a.id);
        const cooldown = abilityCooldowns?.get(a.id);
        rows.push({
          kind: "effect",
          ability: a,
          available: true,
          active: false,
          action: { kind: "ability", memberId: m.id, ability: a },
          note: cooldown ? `${m.name} · ${cooldown}` : m.name,
        });
      }
    }

    // Item actions — Torch / Camping Supplies in the inventory show
    // up here as "Light Torch" / "Camp" rows. Activating one Uses the
    // first matching inventory stack (same host path as the old
    // stash Use button).
    const inv = party.inventory ?? [];
    for (const action of EFFECT_ITEM_ACTIONS) {
      const firstIdx = inv.findIndex((e) => action.ids.includes(e.item));
      if (firstIdx < 0) continue;
      const cat = itemById.get(inv[firstIdx].item);
      rows.push({
        kind: "effect",
        ability: {
          id: `use:${action.ids[0]}`,
          name: action.label,
          description: cat?.description,
        },
        available: true,
        active: false,
        action: { kind: "item", inventoryIndex: firstIdx },
      });
    }
    return rows;
  }, [
    abilities,
    unlocked,
    activeEffectIds,
    effectDurations,
    party.inventory,
    itemById,
    members,
    spells,
    raceById,
    classById,
    abilityCooldowns,
  ]);

  // ── Selection state — which left-list row is highlighted ─────────
  // Default to the first available effect so the right pane shows
  // something useful on first render.
  const initialSelectedId = useMemo(() => {
    const firstAvail = effectRows.find((r) => r.available);
    return firstAvail?.ability.id ?? effectRows[0]?.ability.id ?? null;
  }, [effectRows]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  /** Drill-in: when set, the screen swaps its body for a
   *  CharacterSheetSim of this member. Clicking a roster card sets it;
   *  the sheet's Back button clears it. */
  const [focusedMemberId, setFocusedMemberId] = useState<string | null>(null);
  const focusedMember = focusedMemberId
    ? members.find((m) => m.id === focusedMemberId) ?? null
    : null;

  // ── Shared stash interaction state ──────────────────────────────
  // The stash list scrolls independently of the effects list. Players
  // can navigate with ArrowUp/Down (when the stash pane has the
  // keyboard mode) and act on the selected row with U/S/X — or click
  // straight on the row + action buttons in the detail panel.
  /** Inventory list rows, in display order: equipable gear (weapons /
   *  armor), then usable items (potions, torches…), then everything
   *  else. Within a group rows follow the items catalog order, so a
   *  row's position depends only on WHAT the item is — not on where it
   *  currently lives. Equipping / unequipping / swapping therefore
   *  never moves rows around (the worn sword stays where the spare
   *  sword was, a displaced club lands where the worn club was).
   *  Copies of the same item: worn ones first (roster order), then
   *  spares (inventory order). `stashSelectedIndex` is a position in
   *  this list; stash rows carry their `party.inventory` index for
   *  the host's Use / Send / Equip callbacks. */
  const itemOrder = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, i) => m.set(it.id, i));
    return m;
  }, [items]);
  const invRows = useMemo<InvRow[]>(() => {
    const inv = party.inventory ?? [];
    const rank = (item: string): number => {
      const cat = itemById.get(item);
      if (cat?.slots && cat.slots.length > 0) return 0;
      if (cat?.usable) return 1;
      return 2;
    };
    const rows: Array<{ row: InvRow; tie: number }> = [];
    members.forEach((m, mi) => {
      const eq = (m.equipped ?? {}) as Record<string, string>;
      const ed = (m as { equipped_durability?: Record<string, number | null> })
        .equipped_durability;
      ["hands", "body"].forEach((slot, si) => {
        const item = eq[slot];
        if (!item) return;
        const d = ed?.[slot];
        rows.push({
          row: {
            kind: "equipped",
            memberId: m.id,
            slot,
            item,
            durability: typeof d === "number" ? d : undefined,
          },
          tie: mi * 2 + si,
        });
      });
    });
    inv.forEach((e, i) => {
      rows.push({
        row: {
          kind: "stash",
          invIdx: i,
          item: e.item,
          charges: typeof e.charges === "number" ? e.charges : undefined,
          durability:
            typeof e.durability === "number" ? e.durability : undefined,
        },
        tie: 1000 + i,
      });
    });
    const catPos = (id: string) => itemOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
    return rows
      .sort(
        (a, b) =>
          rank(a.row.item) - rank(b.row.item) ||
          catPos(a.row.item) - catPos(b.row.item) ||
          a.row.item.localeCompare(b.row.item) ||
          a.tie - b.tie,
      )
      .map((x) => x.row);
  }, [party.inventory, itemById, itemOrder, members]);
  const [stashSelectedIndex, setStashSelectedIndex] = useState<number | null>(
    invRows.length > 0 ? 0 : null,
  );
  /** When the stash shrinks (item used / sent away), the cursor may
   *  fall off the end. Clamp it on every render so the detail panel
   *  always points at a real row, and disappear it when the stash
   *  empties. */
  useEffect(() => {
    if (invRows.length === 0) {
      setStashSelectedIndex(null);
      return;
    }
    setStashSelectedIndex((cur) => {
      if (cur == null) return 0;
      if (cur >= invRows.length) return invRows.length - 1;
      return cur;
    });
  }, [invRows.length]);

  /** "send" — the player picked Send and is now waiting for a roster
   *  pick (1-N or click). "examine" — full description visible in the
   *  detail panel. "none" — the resting state. */
  type StashMode = "none" | "send" | "examine";
  const [stashMode, setStashMode] = useState<StashMode>("none");

  // ── Keyboard navigation focus tracking ──────────────────────────
  // `focusZone` is the cursor's *column*. Up/Down inside Effects or
  // Stash navigates within the list; the cursor spills between them
  // at the boundaries (Down at the last effect → first stash item,
  // Up at the first stash item → last effect). Enter on a stash row
  // opens the action submenu — `actionIndex` tracks which of
  // Use/Send/Examine is highlighted. Send mode owns its own cursor
  // (`sendIndex`) for the roster picker.
  //
  // None of these subsume `selectedId` / `stashSelectedIndex` /
  // `stashMode` — they're independent fields that the keydown
  // handler synthesises a `PartyNavState` from on every dispatch,
  // applies the reducer's output to, and pushes back. Doing it this
  // way means the existing mouse-driven flows + existing renderers
  // keep working unchanged.
  type FocusZone =
    | "effects"
    | "stash"
    | "actions"
    | "send"
    | "equip"
    | "roster";
  type LeftZone = "effects" | "stash" | "actions";
  const [focusZone, setFocusZone] = useState<FocusZone>("effects");
  const [actionIndex, setActionIndex] = useState<number>(ACTION_USE);
  const [sendIndex, setSendIndex] = useState<number>(0);
  /** Cursor in the equip picker (roster index) while focusZone is
   *  "equip". */
  const [equipIndex, setEquipIndex] = useState<number>(0);
  /** Cursor in the roster (right pane) when the player has arrowed
   *  across the column boundary. Independent of `sendIndex` —
   *  pressing Enter on the focused card drills into the character
   *  sheet, not delivers a stash item. */
  const [rosterIndex, setRosterIndex] = useState<number>(0);
  /** Which left-column zone the cursor was in immediately before
   *  hopping into the roster. ArrowLeft out of the roster lands on
   *  this zone so the round-trip feels seamless. */
  const [lastLeftZone, setLastLeftZone] = useState<LeftZone>("effects");
  /** Ref on the stash <ul> so the auto-scroll effect below can
   *  query the focused row and `scrollIntoView` it. */
  const stashListRef = useRef<HTMLUListElement | null>(null);
  /** Ref onto the currently-selected effect row's <button> so the
   *  focus effect can drive DOM focus onto it when the cursor lands
   *  there via arrow keys. This is what lets Enter toggle: the
   *  browser's default Enter-activates-focused-button behavior runs
   *  in parallel with the reducer's effect-toggle action, so even if
   *  the window-level reducer dispatch ever misses, the button's own
   *  click handler still fires and toggles the effect. Belt-and-
   *  braces; the reducer is the primary path. */
  const selectedEffectButtonRef = useRef<HTMLButtonElement | null>(null);
  // Whenever the selection moves, drop out of send / examine so the
  // detail panel always matches the cursor.
  useEffect(() => {
    setStashMode("none");
  }, [stashSelectedIndex]);

  const selectedInvRow =
    stashSelectedIndex != null ? invRows[stashSelectedIndex] ?? null : null;
  const selectedStashIdx =
    selectedInvRow?.kind === "stash" ? selectedInvRow.invIdx : null;
  const selectedStashCatalog = selectedInvRow
    ? itemById.get(selectedInvRow.item)
    : null;
  const canUseSelected =
    selectedStashIdx != null &&
    !!onUseStashItem &&
    !!selectedStashCatalog?.usable;
  /** Gear (has an equipment slot) can be equipped / unequipped from
   *  the list when the host wired it. */
  const canEquipSelected =
    !!onEquipItem &&
    members.length > 0 &&
    !!selectedStashCatalog?.slots &&
    selectedStashCatalog.slots.length > 0;
  /** Picker opens on the current wearer for worn gear. */
  const equipStartIndex =
    selectedInvRow?.kind === "equipped"
      ? Math.max(
          0,
          members.findIndex((m) => m.id === selectedInvRow.memberId),
        )
      : 0;
  // Send is blocked when the catalog flags the item party-only (e.g.
  // Camping Supplies — it has no meaning in one character's inventory
  // since the rest applies to the whole party). Absent flag defaults
  // to sendable so existing items keep their behavior.
  const itemIsSendable =
    selectedStashCatalog?.sendable_to_character !== false;
  const canSendSelected =
    selectedStashIdx != null &&
    !!onSendStashItem &&
    members.length > 0 &&
    itemIsSendable;

  // Helpers wrapping the callbacks so the keyboard + click paths share
  // the same plumbing (and tests can assert on a single seam).
  const triggerUse = useCallback(() => {
    if (selectedStashIdx == null) return;
    if (!canUseSelected || !onUseStashItem) return;
    onUseStashItem(selectedStashIdx);
    setStashMode("none");
  }, [canUseSelected, onUseStashItem, selectedStashIdx]);

  const sendToMember = useCallback(
    (memberIndex: number) => {
      if (selectedStashIdx == null) return;
      if (!onSendStashItem) return;
      if (memberIndex < 0 || memberIndex >= members.length) return;
      onSendStashItem(selectedStashIdx, memberIndex);
      setStashMode("none");
    },
    [onSendStashItem, selectedStashIdx, members.length],
  );

  /** Equip-picker choice for the selected Inventory row. Picking the
   *  member already wearing it unequips it back into the inventory. */
  const equipToMember = useCallback(
    (memberIndex: number) => {
      const row = selectedInvRow;
      const target = members[memberIndex];
      setFocusZone("stash");
      if (!row || !target || !onEquipItem) return;
      if (row.kind === "stash") {
        onEquipItem({ kind: "stash", stashIndex: row.invIdx }, target.id);
      } else {
        onEquipItem(
          { kind: "equipped", memberId: row.memberId, slot: row.slot },
          target.id === row.memberId ? null : target.id,
        );
      }
    },
    [selectedInvRow, members, onEquipItem],
  );

  const toggleExamine = useCallback(() => {
    if (stashSelectedIndex == null) return;
    setStashMode((cur) => (cur === "examine" ? "none" : "examine"));
  }, [stashSelectedIndex]);

  // ── Drag-and-drop roster reorder ────────────────────────────────
  // `dragFromId` = the card the user is currently dragging.
  // `dropTargetId` = the card the cursor is hovering over (drives the
  // visual insertion indicator). Both clear on drop or drag-end.
  // Reordering is OFF entirely unless the host wired onReorderRoster.
  const [dragFromId, setDragFromId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const reorderEnabled = Boolean(onReorderRoster);
  const handleDrop = (toId: string) => {
    if (!onReorderRoster || !dragFromId || dragFromId === toId) {
      setDragFromId(null);
      setDropTargetId(null);
      return;
    }
    const ids = members.map((m) => m.id);
    const fromIdx = ids.indexOf(dragFromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragFromId(null);
      setDropTargetId(null);
      return;
    }
    const reordered = [...ids];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    onReorderRoster(reordered);
    setDragFromId(null);
    setDropTargetId(null);
  };

  // ── Toggle helper for the "active" preview set ───────────────────
  // Memoised — the keydown effect (below) lists it as a dependency,
  // and an inline arrow on every render would force the effect to
  // re-mount its window-level listener every render. The effect also
  // captures `toggleActive` in its closure; without useCallback that
  // capture would be a fresh reference on each render and the effect
  // would have to either accept stale state OR be re-registered every
  // tick. Stable identity here lets the dep array stay honest while
  // keeping the listener long-lived.
  const toggleActive = useCallback(
    (abilityId: string, available: boolean) => {
      if (!available) return;
      const present = activeEffectIds.includes(abilityId);
      if (present) {
        onActiveEffectsChange(
          activeEffectIds.filter((x) => x !== abilityId),
        );
      } else {
        onActiveEffectsChange([...activeEffectIds, abilityId]);
      }
    },
    [activeEffectIds, onActiveEffectsChange],
  );

  /** Activate an Effects row: one-shot actions (item / spell /
   *  ability) fire their host callback; toggle effects flip. */
  const activateEffectRow = useCallback(
    (row: EffectRow) => {
      const a = row.action;
      if (!a) {
        if (row.available) toggleActive(row.ability.id, true);
        return;
      }
      if (a.kind === "item") onUseStashItem?.(a.inventoryIndex);
      else if (a.kind === "spell") onCastSpell?.(a.casterId, a.spellId);
      else onUseAbility?.(a.memberId, a.ability);
    },
    [toggleActive, onUseStashItem, onCastSpell, onUseAbility],
  );

  // ── Keyboard navigation — reducer-driven ────────────────────────
  // The old handler hand-rolled stash up/down + U/S/X accelerators
  // and bolted send / examine modes on top. Adding effect-column
  // navigation, cross-column wraps, and an arrow-driven action
  // submenu made the inline logic untenable, so the state machine
  // lives in `./partyScreenNav` and this effect is just a thin
  // adapter: synthesise a PartyNavState from the live state, run
  // the reducer, push the result back. `consumed` controls whether
  // we stop the event (Esc still bubbles when the reducer says so,
  // so the overlay's close-on-Esc keeps working).
  //
  // Suspended while a member sheet is drilled into so the sheet's
  // own keybinds win — same as the original behavior.
  //
  // Map the current zone back from existing component state so a
  // mouse interaction that changed `stashMode` (e.g. clicked Send)
  // shows up in the reducer's view of the world on the next press.
  const effectIndex = useMemo(
    () => {
      const i = effectRows.findIndex((r) => r.ability.id === selectedId);
      return i < 0 ? 0 : i;
    },
    [effectRows, selectedId],
  );
  const liveZone: FocusZone = stashMode === "send" ? "send" : focusZone;
  useEffect(() => {
    if (focusedMember) return; // Sheet handles its own input.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // While the Examine panel is open, Esc hides it (rather than
      // closing the whole screen). X toggles it via the reducer.
      if (e.key === "Escape" && stashMode === "examine") {
        e.preventDefault();
        e.stopPropagation();
        setStashMode("none");
        return;
      }
      const navCtx: PartyNavContext = {
        effectCount: effectRows.length,
        stashCount: invRows.length,
        memberCount: members.length,
        canUse: canUseSelected,
        canSend: canSendSelected,
        canEquip: canEquipSelected,
        equipStartIndex,
        effectAvailable:
          effectRows[effectIndex]?.available === true,
      };
      const result = reducePartyNav(
        {
          zone: liveZone,
          effectIndex,
          stashIndex: stashSelectedIndex ?? -1,
          actionIndex,
          sendIndex,
          rosterIndex,
          lastLeftZone,
          equipIndex,
        },
        { kind: "key", key: e.key },
        navCtx,
      );
      if (result.consumed) {
        e.preventDefault();
        e.stopPropagation();
      }
      // Push the new cursor state back into the existing fields so
      // the renderer + click handlers (which still read these) see
      // the same view of the world the reducer just decided on.
      const next = result.state;
      const nextEffectId =
        effectRows[next.effectIndex]?.ability.id ?? null;
      if (nextEffectId !== selectedId) setSelectedId(nextEffectId);
      const nextStashIdx = next.stashIndex < 0 ? null : next.stashIndex;
      if (nextStashIdx !== stashSelectedIndex) {
        setStashSelectedIndex(nextStashIdx);
      }
      if (next.actionIndex !== actionIndex) setActionIndex(next.actionIndex);
      if (next.sendIndex !== sendIndex) setSendIndex(next.sendIndex);
      if ((next.equipIndex ?? 0) !== equipIndex) {
        setEquipIndex(next.equipIndex ?? 0);
      }
      if (next.rosterIndex !== rosterIndex) setRosterIndex(next.rosterIndex);
      if (next.lastLeftZone !== lastLeftZone) {
        setLastLeftZone(next.lastLeftZone);
      }
      // Zone sync: `send` zone maps to stashMode="send"; leaving
      // send while stashMode was "send" pops it back to "none".
      // The action handler below toggles examine separately.
      if (next.zone === "send" && stashMode !== "send") {
        setStashMode("send");
      } else if (next.zone !== "send" && stashMode === "send") {
        setStashMode("none");
      }
      if (next.zone !== focusZone) setFocusZone(next.zone);

      switch (result.action.kind) {
        case "use":
          triggerUse();
          break;
        case "send":
          sendToMember(result.action.memberIndex);
          break;
        case "equip":
          equipToMember(result.action.memberIndex);
          break;
        case "examine-toggle":
          toggleExamine();
          break;
        case "effect-toggle": {
          // Reducer no longer emits this — Enter on an effect row
          // is handled via the focused-button native click path
          // instead. Kept here as a no-op (with a deliberate
          // unreachable comment) so the switch is still exhaustive
          // against the union of action kinds.
          const row = effectRows[next.effectIndex];
          if (row) activateEffectRow(row);
          break;
        }
        case "roster-drill-in": {
          // Enter on a focused roster card opens that character's
          // sheet — same path as clicking the card via
          // RosterCard.onOpen → setFocusedMemberId. The reducer
          // gives us the index; we map it to the member's id since
          // the focus state is keyed by id (members may reorder).
          const member = members[result.action.memberIndex];
          if (member) setFocusedMemberId(member.id);
          break;
        }
        case "close":
          // Esc in the regular two-pane view → close the modal.
          // Hosts pass an `onClose` callback (PlayPartyScreenOverlay
          // / MapPartyScreenOverlay both wire it to their own close
          // state); we no longer rely on the overlay's window-level
          // Esc handler to do the job, because that handler was
          // also firing while the player was drilled into a
          // character sheet (where we want Esc to pop the sheet
          // instead of closing the whole screen).
          if (onClose) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          break;
        case "none":
          break;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    focusedMember,
    effectRows,
    effectIndex,
    invRows.length,
    stashSelectedIndex,
    members,
    members.length,
    canUseSelected,
    canSendSelected,
    canEquipSelected,
    equipStartIndex,
    equipIndex,
    equipToMember,
    triggerUse,
    sendToMember,
    toggleExamine,
    toggleActive,
    activateEffectRow,
    selectedId,
    actionIndex,
    sendIndex,
    rosterIndex,
    lastLeftZone,
    focusZone,
    liveZone,
    stashMode,
    onClose,
  ]);

  // ── Character-sheet Escape capture ──────────────────────────────
  // While drilled into a member's sheet, the main reducer listener
  // is suspended (see the `if (focusedMember) return;` near the top
  // of that effect — the sheet owns its own input). The wrapping
  // host overlay (PlayPartyScreenOverlay / MapPartyScreenOverlay)
  // ALSO registers a window-capture keydown handler that closes the
  // whole Party screen on Esc. Without an intercept, pressing Esc
  // in the sheet would drop the player all the way back to the map
  // — surprising, because they got into the sheet via the Party
  // screen and expect Esc to pop one level at a time.
  //
  // Subtleties that bit a previous attempt:
  //
  //   1. The overlay's window-capture listener AND ours are both on
  //      `window`. `stopPropagation` only halts propagation through
  //      the DOM tree — it does NOT stop other listeners on the SAME
  //      target. We need `stopImmediatePropagation` to actually
  //      prevent the overlay's listener from running.
  //
  //   2. Capture-phase listeners on the same node fire in
  //      *registration order*. React fires child effects before
  //      parent effects on mount, so a PartyScreen-level effect that
  //      registers at mount time wins over the parent overlay. But
  //      an effect gated on `focusedMember` only registers AFTER the
  //      overlay (the overlay's effect already ran), and so loses
  //      the race.
  //
  // The fix: register this listener ONCE at mount with an empty dep
  // array so it claims first-registered slot, then read the live
  // `focusedMember` via a ref so the listener doesn't need to be
  // re-registered when the drill-in state flips. Two mount-time
  // effects (this one + the ref mirror) sit at slots 1 and 2 in the
  // window queue ahead of the overlay's slot 3, so Esc routes
  // through this handler first every time.
  // Tell the host when a sheet is open so it can show Back in its
  // top bar. Ref'd callback so a host passing an inline arrow doesn't
  // re-fire this on every render.
  const onSheetBackChangeRef = useRef(onSheetBackChange);
  onSheetBackChangeRef.current = onSheetBackChange;
  useEffect(() => {
    onSheetBackChangeRef.current?.(
      focusedMemberId != null ? () => setFocusedMemberId(null) : null,
    );
  }, [focusedMemberId]);
  useEffect(
    () => () => onSheetBackChangeRef.current?.(null),
    [],
  );
  const focusedMemberIdRef = useRef<string | null>(focusedMemberId);
  useEffect(() => {
    focusedMemberIdRef.current = focusedMemberId;
  }, [focusedMemberId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (focusedMemberIdRef.current == null) return; // sheet not open
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setFocusedMemberId(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
    // Empty deps on purpose — see comment block above. The listener
    // reads `focusedMemberIdRef` for current state instead of having
    // `focusedMemberId` in the dep list (which would re-register the
    // listener and push it to the back of the queue).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the stash list so the currently-selected row is in
  // view. The list itself uses `max-h-48 overflow-y-auto`, which
  // means arrow-navigating past the bottom of the visible window
  // would otherwise leave the highlight hidden. `block: "nearest"`
  // keeps the scroll quiet — it only moves the row into view if the
  // row is currently off-screen, so navigating among already-visible
  // rows doesn't jitter the container.
  useEffect(() => {
    if (stashSelectedIndex == null) return;
    const ul = stashListRef.current;
    if (!ul) return;
    const sel = ul.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }, [stashSelectedIndex]);
  // When the equip picker opens (or its cursor moves), keep it in
  // view inside the scrolling Inventory list.
  useEffect(() => {
    if (focusZone !== "equip") return;
    const picker = stashListRef.current?.querySelector<HTMLElement>(
      '[aria-label="Choose a party member"]',
    );
    picker?.scrollIntoView({ block: "nearest" });
  }, [focusZone, equipIndex]);

  // Drive DOM focus onto the selected effect button whenever the
  // effects zone owns the keyboard cursor. Two effects fall out of
  // this:
  //
  //   1. The browser draws its native focus ring around the row, so
  //      the player has an unambiguous "this is where Enter will
  //      act" cue even if the colored-bar section indicator slips
  //      past their eye.
  //   2. Pressing Enter on a focused <button> dispatches a click as
  //      the browser's default keydown action. That click flows
  //      through the button's `onClick`, which we wire to also call
  //      `toggleActive` — so even on the off chance the reducer
  //      dispatch path misses (a stale closure, an unfortunate event
  //      ordering, an extension stopping our window listener), the
  //      native click path still toggles. Defense in depth.
  //
  // We `focus({ preventScroll: true })` so the focus call doesn't
  // jank the modal's scroll position in cases where the highlighted
  // row sits inside a scroll container.
  useEffect(() => {
    if (focusZone !== "effects") return;
    const btn = selectedEffectButtonRef.current;
    if (!btn) return;
    btn.focus({ preventScroll: true });
  }, [focusZone, selectedId]);

  // Reset send / action cursors when the stash row changes — same
  // ergonomic the original component already had for `stashMode`:
  // moving the cursor to a new item should drop us back to a clean
  // "no submenu open, no send target picked" state so the player
  // can re-engage explicitly. Otherwise arrowing through the stash
  // would leave a stale send-target ring on the last roster card.
  useEffect(() => {
    setSendIndex(0);
    setActionIndex(ACTION_USE);
  }, [stashSelectedIndex]);

  // Clamp sendIndex when the roster shrinks (e.g., a member died
  // mid-overlay — unlikely, but the reducer assumes a valid index
  // and we don't want to crash if React state lags behind).
  useEffect(() => {
    setSendIndex((cur) => {
      if (members.length === 0) return 0;
      return Math.min(cur, members.length - 1);
    });
  }, [members.length]);

  // Visual helpers — selected rows are bright when their zone owns
  // the cursor, dim when another zone does. Keeps the reader's eye
  // on the active list while still showing the player which row
  // they'll come back to when they tab columns.
  const rowSelClass = (zone: FocusZone, isSelected: boolean): string => {
    if (!isSelected) return "border-transparent hover:bg-ink/50";
    if (focusZone === zone) return "border-ember/60 bg-ember/15";
    return "border-ember/30 bg-ember/5";
  };
  // ── Collapsible sections ───────────────────────────────────────
  // Each list (Effects / Inventory / Party) can be folded away from
  // its header. Remembered per browser so the layout sticks between
  // visits; storage failures just fall back to all-expanded.
  type SectionKey = "effects" | "stash" | "roster";
  const COLLAPSE_KEY = "wilderstep.partyScreen.collapsed";
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    effects: false,
    stash: false,
    roster: false,
  });
  // Load the remembered layout after mount (not in the initializer)
  // so server and first client render agree.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed((cur) => ({ ...cur, ...JSON.parse(raw) }));
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);
  const setSectionCollapsed = useCallback(
    (key: SectionKey, value: boolean) => {
      setCollapsed((cur) => {
        if (cur[key] === value) return cur;
        const next = { ...cur, [key]: value };
        try {
          window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );
  // Keyboard focus landing in a collapsed list re-opens it, so the
  // cursor is never on a hidden row (send mode picks from the roster).
  useEffect(() => {
    if (focusZone === "effects") setSectionCollapsed("effects", false);
    else if (focusZone === "stash" || focusZone === "equip")
      setSectionCollapsed("stash", false);
    else if (focusZone === "roster" || focusZone === "send")
      setSectionCollapsed("roster", false);
  }, [focusZone, setSectionCollapsed]);
  useEffect(() => {
    if (stashMode === "send") setSectionCollapsed("roster", false);
  }, [stashMode, setSectionCollapsed]);

  const sectionHeader = (key: SectionKey, label: string) => (
    <h3 className="shrink-0">
      <button
        type="button"
        onClick={() => setSectionCollapsed(key, !collapsed[key])}
        aria-expanded={!collapsed[key]}
        className={sectionHeaderClass(key)}
        title={collapsed[key] ? `Expand ${label}` : `Collapse ${label}`}
      >
        <span className="w-3 text-[10px] text-amber-300/80">
          {collapsed[key] ? "▸" : "▾"}
        </span>
        {label}
      </button>
    </h3>
  );

  const sectionHeaderClass = (zone: FocusZone): string => {
    const focused = focusZone === zone;
    // Focused header gets a colored left bar + brighter amber so the
    // player can see at a glance which list Enter will act on. The
    // ▶ marker alone was too easy to miss against the rest of the
    // chrome (the player report that started this fix said pressing
    // Enter "didn't toggle the effect" — the actual cause was that
    // focus had drifted to the stash without a clear visual cue).
    // All three section headers share one font + color; keyboard
    // focus is shown only by the left bar so the titles never look
    // mismatched.
    return [
      "flex w-full items-center gap-1.5 pl-2 -ml-2 text-left text-[13px] uppercase tracking-wide text-amber-300 hover:text-amber-200",
      focused ? "border-l-2 border-amber-200" : "border-l-2 border-transparent",
    ].join(" ");
  };

  // ── Render ───────────────────────────────────────────────────────

  // Drill-in: focused member → CharacterSheetSim. The Back button on
  // the sheet clears the focus. The Party screen's own outer
  // container is preserved so the modal / inline host doesn't
  // re-layout when the body swaps.
  if (focusedMember) {
    return (
      <CharacterSheetSim
        character={focusedMember}
        classes={classes}
        races={races}
        // PartyItemRef ⊂ SheetItemRef; PartyScreen's items prop is the
        // narrow ref, but real callers pass the full item records which
        // carry power/evasion/etc. Cast through to surface those fields
        // to the sheet without forcing every host to import SheetItemRef.
        items={items as ReadonlyArray<SheetItemRef>}
        abilities={abilities}
        spells={spells}
        onCastSpell={onCastSpell}
        onUsePersonalItem={onUsePersonalItem}
        onReturnPersonalItem={onReturnPersonalItem}
        onEquipPersonalItem={onEquipPersonalItem}
        onUnequipSlot={onUnequipSlot}
        onUseAbility={onUseAbility}
        abilityCooldowns={abilityCooldowns}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-parchment/15 bg-ink/40 p-3 text-parchment/90">
      {/* Two-pane body */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Left: Effects + Inventory share a fixed-height column (on
            md+). Effects takes what it needs (scrolling if it would
            crowd the Inventory out); Inventory fills the rest. When
            one is collapsed the other gets the whole column. */}
        <div className="flex flex-col gap-2 md:h-[60vh] md:min-h-[22rem]">
          {/* EFFECTS list */}
          <section
            className={[
              "flex min-h-0 flex-col",
              collapsed.effects
                ? "shrink-0"
                : collapsed.stash
                  ? "flex-1"
                  : "max-h-[50%] shrink",
            ].join(" ")}
          >
            {sectionHeader("effects", "Effects")}
            <ul
              className="mt-1 min-h-0 space-y-0.5 overflow-y-auto pr-1"
              hidden={collapsed.effects}
            >
              {effectRows.length === 0 ? (
                <li className="text-[13px] text-parchment/70">
                  (no party effects available — roster doesn&apos;t
                  unlock any)
                </li>
              ) : null}
              {effectRows.map((row) => {
                const isSel = row.ability.id === selectedId;
                return (
                  <li key={row.ability.id}>
                    <button
                      type="button"
                      ref={
                        isSel
                          ? selectedEffectButtonRef
                          : undefined
                      }
                      onClick={() => {
                        // Clicking — or pressing Enter on a focused
                        // effect row, which the browser dispatches
                        // as a synthetic click — toggles the effect
                        // AND parks the cursor on the effects zone.
                        // See the reducer's Enter-on-effects branch
                        // for why both paths converge here.
                        setSelectedId(row.ability.id);
                        setFocusZone("effects");
                        activateEffectRow(row);
                      }}
                      title={
                        row.action
                          ? row.ability.description
                          : [
                              row.ability.description,
                              `Duration: ${fmtDuration(row.ability.duration)}`,
                              `Requires: ${requirementsFor(row.ability.id, races, classes)}`,
                            ].filter(Boolean).join("\n")
                      }
                      className={[
                        "flex w-full items-center gap-2 rounded border px-2 py-0.5 text-left text-sm text-parchment/90",
                        rowSelClass("effects", isSel),
                      ].join(" ")}
                    >
                      {row.active ? (
                        <span className="text-amber-300">●</span>
                      ) : (
                        <span className="text-parchment/60">+</span>
                      )}
                      <span>{row.ability.name ?? row.ability.id}</span>
                      {row.durationSteps !== undefined ? (
                        <span className="ml-auto font-mono text-xs text-parchment/75">
                          {row.durationSteps}{" "}
                          {row.durationSteps === 1 ? "step" : "steps"}
                        </span>
                      ) : null}
                      {row.note ? (
                        <span className="ml-auto truncate text-xs text-parchment/60">
                          {row.note}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* INVENTORY — scrollable list. Up/Down navigates (and
              spills back into Effects past the first row); Enter
              opens the Use / Send / Examine submenu. U / S / X still
              work as direct accelerators. Max-height keeps a long
              stash from blowing past the modal; the auto-scroll
              effect keeps the highlighted row in view as the cursor
              walks past the visible window. */}
          <section
            className={[
              "flex min-h-0 flex-col",
              collapsed.stash ? "shrink-0" : "flex-1",
            ].join(" ")}
          >
            {sectionHeader("stash", "Inventory")}
            <ul
              hidden={collapsed.stash}
              ref={stashListRef}
              className="mt-1 max-h-48 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 text-sm md:max-h-none"
              role="listbox"
              aria-label="Inventory"
            >
              {invRows.length === 0 ? (
                <li className="text-[13px] text-parchment/65">(empty)</li>
              ) : null}
              {invRows.map((row, i) => {
                const label = itemNameById.get(row.item) ?? row.item;
                const isSel = i === stashSelectedIndex;
                const cat = itemById.get(row.item);
                // Quantity badge — stackable stash rows only, and only
                // when more than one (a single Torch reads "Torch").
                const qty =
                  row.kind === "stash" &&
                  cat?.stackable &&
                  typeof row.charges === "number"
                    ? row.charges
                    : 1;
                // Durability bar — non-stackable gear whose catalog
                // defines a positive max. A fresh item (no stored
                // value) reads as a full bar.
                const durMax = cat?.durability ?? 0;
                const showDur = !cat?.stackable && durMax > 0;
                const durCur = showDur ? row.durability ?? durMax : 0;
                const wearer =
                  row.kind === "equipped"
                    ? members.find((m) => m.id === row.memberId) ?? null
                    : null;
                const isGear = !!cat?.slots && cat.slots.length > 0;
                const pickerOpen = isSel && focusZone === "equip";
                const openPicker = () => {
                  setStashSelectedIndex(i);
                  setEquipIndex(
                    wearer
                      ? Math.max(0, members.findIndex((m) => m.id === wearer.id))
                      : 0,
                  );
                  setFocusZone("equip");
                };
                return (
                  <li
                    key={
                      row.kind === "stash"
                        ? `s-${row.item}-${row.invIdx}`
                        : `e-${row.memberId}-${row.slot}`
                    }
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      onClick={() => {
                        setStashSelectedIndex(i);
                        setFocusZone("stash");
                      }}
                      onDoubleClick={() => {
                        setStashSelectedIndex(i);
                        setFocusZone("stash");
                        // Double-click mirrors Enter: gear opens the
                        // equip picker; usables are Used; anything else
                        // is Examined. Sending always needs an explicit
                        // recipient so we never auto-send.
                        if (isGear && onEquipItem && members.length > 0) {
                          openPicker();
                        } else if (
                          row.kind === "stash" &&
                          onUseStashItem &&
                          cat?.usable
                        ) {
                          onUseStashItem(row.invIdx);
                        } else {
                          setStashMode("examine");
                        }
                      }}
                      className={[
                        // Grid: sprite · name · wearer avatar · durability
                        "grid w-full grid-cols-[18px_minmax(0,1fr)_20px_3rem] items-center gap-2 rounded border px-2 py-0.5 text-left",
                        isSel
                          ? `${rowSelClass(pickerOpen ? "equip" : "stash", true)} text-parchment`
                          : "border-transparent text-parchment/85 hover:bg-ink/50",
                      ].join(" ")}
                      title={[
                        cat?.description,
                        wearer ? `Equipped by ${wearer.name}` : null,
                        isGear && onEquipItem
                          ? "Enter to equip / unequip"
                          : null,
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    >
                      <ItemSprite icon={cat?.icon} size={18} />
                      <span className="truncate">
                        {label}
                        {qty > 1 ? (
                          <span className="ml-1 text-[13px] text-parchment/65">
                            ({qty})
                          </span>
                        ) : null}
                      </span>
                      <MemberAvatar member={wearer} size={20} />
                      <span className="flex justify-end">
                        {showDur ? (
                          <DurabilityBar current={durCur} max={durMax} />
                        ) : null}
                      </span>
                    </button>
                    {isSel && stashMode === "examine" ? (
                      <ItemDetails
                        item={cat ?? { id: row.item, name: label }}
                        quantity={qty}
                        durability={showDur ? { cur: durCur, max: durMax } : null}
                        wearer={wearer}
                        itemNameById={itemNameById}
                      />
                    ) : null}
                    {pickerOpen ? (
                      <EquipPicker
                        members={members}
                        cursor={equipIndex}
                        wearerId={wearer?.id ?? null}
                        slot={cat?.slots?.[0] ?? ""}
                        itemNameById={itemNameById}
                        onHover={setEquipIndex}
                        onPick={equipToMember}
                        onCancel={() => setFocusZone("stash")}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

        </div>

        {/* Right: roster + detail + gold */}
        <div className="space-y-2">
          {/* Roster */}
          <section>
            {sectionHeader("roster", "Party")}
            <ul className="mt-1 space-y-1" hidden={collapsed.roster}>
              {members.length === 0 ? (
                <li className="text-[13px] text-parchment/70">
                  (no roster — check party.json)
                </li>
              ) : null}
              {members.map((m, i) => {
                // During send mode the roster acts as a destination
                // picker — click a card to send the highlighted stash
                // item there. Disable drag and the drill-in click for
                // the duration so the gesture is unambiguous.
                const sendingNow = stashMode === "send";
                return (
                  <RosterCard
                    key={m.id}
                    member={m}
                    className_={classById.get(m.class)?.name ?? m.class}
                    raceName={raceById.get(m.race)?.name ?? m.race}
                    xpProgress={xpProgressInLevel(m, raceById.get(m.race))}
                    onOpen={
                      sendingNow
                        ? () => sendToMember(i)
                        : () => {
                            // Click on a roster card: park keyboard
                            // focus on the roster zone with the
                            // cursor on this row, then drill in.
                            // Matching what arrow-then-Enter does.
                            setFocusZone("roster");
                            setRosterIndex(i);
                            setFocusedMemberId(m.id);
                          }
                    }
                    /** Surface a "drop target" ring while sending so the
                     *  player can visually confirm where the item is
                     *  about to land. Re-uses the existing drag/drop
                     *  highlight styling — same affordance, different
                     *  trigger. */
                    isSendTarget={sendingNow}
                    /** Brighter cursor outline on whichever card the
                     *  keyboard `sendIndex` is currently pointing at.
                     *  Only meaningful in send mode (sendingNow). */
                    isSendFocused={sendingNow && i === sendIndex}
                    /** Roster-zone cursor outline — set when the
                     *  player has arrowed into the right pane and
                     *  this is the card the keyboard cursor points
                     *  at. Distinct from `isSendFocused` so the two
                     *  modes can stack rings if a future flow ever
                     *  has the cursor land on the same card in both
                     *  states. */
                    isRosterFocused={
                      !sendingNow &&
                      focusZone === "roster" &&
                      i === rosterIndex
                    }
                    overrideTitle={
                      sendingNow
                        ? `Send to ${m.name} (press ${i + 1})`
                        : undefined
                    }
                    draggable={reorderEnabled && !sendingNow}
                    isDragging={dragFromId === m.id}
                    isDropTarget={
                      dropTargetId === m.id && dragFromId !== m.id
                    }
                    onDragStart={() => setDragFromId(m.id)}
                    onDragEnterCard={() => setDropTargetId(m.id)}
                    onDropOnCard={() => handleDrop(m.id)}
                    onDragEnd={() => {
                      setDragFromId(null);
                      setDropTargetId(null);
                    }}
                  />
                );
              })}
            </ul>
          </section>

        </div>
      </div>

      {/* Bottom hint bar. Reflects whichever mode is active so the
          player isn't hunting for which keys do what. */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-xs uppercase tracking-wider text-parchment/65">
        {focusZone === "equip"
          ? `↑↓ pick · Enter equip (wearer = unequip) · 1-${members.length} pick · ESC cancel`
          : stashMode === "examine"
            ? "X / ESC hide details · ↑↓ select"
            : focusZone === "stash"
              ? `↑↓ select · Enter ${
                  canEquipSelected ? "equip" : canUseSelected ? "use" : "examine"
                }${canUseSelected ? " · U use" : ""} · X examine · → party · ESC close`
              : focusZone === "roster"
                ? `↑↓ select · Enter open sheet${
                    reorderEnabled ? " · drag to reorder" : ""
                  } · ← back · ESC close`
                : "↑↓ select · Enter activate · ↓ inventory · → party · ESC close"}
      </div>
    </div>
  );
}

// ── Inventory: Examine panel ────────────────────────────────────────

function titleCase(id: string): string {
  return id
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** One-line "what is this for" summary, derived from the catalog. */
function describeItemUse(
  it: PartyItemRef,
  itemNameById: ReadonlyMap<string, string>,
): string {
  const slots = it.slots ?? [];
  if (slots.includes("hands")) {
    const kind = it.ranged ? "Ranged weapon" : "Melee weapon";
    const ammo = it.ammo
      ? `, fires ${itemNameById.get(it.ammo) ?? titleCase(it.ammo)}`
      : "";
    const thrown = it.throwable ? ", can be thrown" : "";
    return `${kind}${ammo}${thrown} — equip in hands.`;
  }
  if (slots.includes("body")) return "Armor — worn on the body.";
  switch (it.effect) {
    case "heal_hp":
      return "Restores HP.";
    case "heal_mp":
      return "Restores MP.";
    case "cure_poison":
      return "Cures poison.";
    case "buff_strength":
      return "Temporarily boosts Strength.";
    case "buff_ac":
      return "Temporarily boosts armor.";
    case "rest":
      return "Lets the party rest — use Camp in Effects.";
    case "combat_only":
      return "Combat only — thrown at an enemy.";
  }
  if (it.item_type === "torch") {
    return "Lights the way — use Light Torch in Effects.";
  }
  if (it.item_type === "ammo") return "Ammunition for ranged weapons.";
  if (it.item_type === "reagent") return "Ingredient for crafting and brewing.";
  if (it.item_type === "key") return "Opens a matching lock.";
  if (it.item_type === "lockpick") return "Used when picking locks.";
  if (it.quest_item || it.item_type === "quest_item") return "Quest item.";
  if (it.throwable) return "Can be thrown in combat.";
  return "";
}

/** Expanded Examine view for the selected Inventory row: large
 *  sprite, what the item is for, its stats, and the description. */
function ItemDetails({
  item,
  quantity,
  durability,
  wearer,
  itemNameById,
}: {
  item: PartyItemRef;
  quantity: number;
  durability: { cur: number; max: number } | null;
  wearer: PartyCharacterRef | null;
  itemNameById: ReadonlyMap<string, string>;
}) {
  const stats: Array<[string, string]> = [];
  if (typeof item.power === "number" && item.power > 0)
    stats.push(["Power", String(item.power)]);
  if (item.bonus_damage)
    stats.push([
      "Bonus damage",
      `${item.bonus_damage}${item.damage_type ? ` ${item.damage_type}` : ""}`,
    ]);
  else if (item.damage_type)
    stats.push(["Element", titleCase(item.damage_type)]);
  if (typeof item.evasion === "number") stats.push(["Evasion", String(item.evasion)]);
  if (typeof item.range === "number" && item.range > 0)
    stats.push(["Range", `${item.range} tiles`]);
  if (typeof item.light_range === "number" && item.light_range > 0)
    stats.push(["Light radius", `${item.light_range} tiles`]);
  if (durability) stats.push(["Durability", `${durability.cur} / ${durability.max}`]);
  if (quantity > 1) stats.push(["Quantity", String(quantity)]);
  if (typeof item.buy === "number" || typeof item.sell === "number")
    stats.push([
      "Value",
      [
        typeof item.buy === "number" ? `buy ${item.buy}g` : null,
        typeof item.sell === "number" ? `sell ${item.sell}g` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);
  const traits = [
    item.finesse ? "Finesse" : null,
    item.ignite ? "Ignites" : null,
    ...(item.wielder_passives ?? []).map((p) => `Grants ${titleCase(p)}`),
  ].filter((t): t is string => Boolean(t));
  const use = describeItemUse(item, itemNameById);
  const subtitle = [
    item.category ? titleCase(item.category) : null,
    item.item_type && item.item_type !== item.category
      ? titleCase(item.item_type)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="mx-2 mb-1 mt-0.5 rounded border border-parchment/20 bg-ink/70 p-2 text-[13px] text-parchment/85">
      <div className="flex items-start gap-3">
        <span className="shrink-0 rounded border border-parchment/20 bg-ink/80 p-1">
          <ItemSprite icon={item.icon} size={48} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base text-parchment">
            {item.name ?? item.id}
          </div>
          {subtitle ? (
            <div className="text-xs text-parchment/60">{subtitle}</div>
          ) : null}
          {use ? <div className="mt-0.5 text-amber-200/90">{use}</div> : null}
          {wearer ? (
            <div className="mt-0.5 text-xs text-parchment/70">
              Equipped by {wearer.name}
            </div>
          ) : null}
        </div>
      </div>
      {stats.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          {stats.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-parchment/60">{k}</dt>
              <dd className="text-parchment/90">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {traits.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {traits.map((t) => (
            <span
              key={t}
              className="rounded border border-amber-300/40 bg-amber-300/10 px-1.5 py-px text-[11px] text-amber-100/90"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-1.5 text-parchment/75">
        {item.description ?? "(no description in items.json)"}
      </p>
    </div>
  );
}

// ── Inventory: wearer avatar + equip picker ─────────────────────────

/** Small party-member avatar (or an empty, same-size slot so the
 *  Inventory grid stays aligned when nobody wears the item). */
function MemberAvatar({
  member,
  size,
}: {
  member: PartyCharacterRef | null;
  size: number;
}) {
  const src = member?.sprite
    ? resolveSpritePath(member.sprite, SPRITE_CONFIG)
    : null;
  if (!member) return <span style={{ width: size, height: size }} />;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={member.name}
      title={`Equipped by ${member.name}`}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated", width: size, height: size }}
      className="rounded-sm object-contain"
    />
  ) : (
    <span
      title={`Equipped by ${member.name}`}
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-sm border border-parchment/25 text-[10px] text-parchment/80"
    >
      {member.name.slice(0, 1)}
    </span>
  );
}

/** Pop-down under an Inventory row: every party member's avatar +
 *  name. Picking someone equips the item on them (their current item
 *  in that slot goes back to the Inventory); picking the current
 *  wearer unequips it. Keyboard is driven by the Party screen's nav
 *  reducer ("equip" zone); this only renders + handles the mouse. */
function EquipPicker({
  members,
  cursor,
  wearerId,
  slot,
  itemNameById,
  onHover,
  onPick,
  onCancel,
}: {
  members: ReadonlyArray<PartyCharacterRef>;
  cursor: number;
  wearerId: string | null;
  slot: string;
  itemNameById: ReadonlyMap<string, string>;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-2 mb-1 mt-0.5 rounded border border-amber-300/40 bg-ink/80 p-1">
      <div className="flex items-center justify-between px-1 text-[11px] uppercase tracking-wide text-amber-300/80">
        <span>{wearerId ? "Move to / unequip" : "Equip on"}</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-parchment/60 hover:text-parchment"
          title="Cancel (ESC)"
        >
          ✕
        </button>
      </div>
      <ul role="listbox" aria-label="Choose a party member">
        {members.map((m, i) => {
          const isWearer = m.id === wearerId;
          const current = (m.equipped as Record<string, string> | undefined)?.[
            slot
          ];
          const note = isWearer
            ? "unequip"
            : current
              ? `replaces ${itemNameById.get(current) ?? current}`
              : "";
          return (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(i)}
                className={[
                  "flex w-full items-center gap-2 rounded border px-1.5 py-0.5 text-left text-sm",
                  i === cursor
                    ? "border-ember/60 bg-ember/15 text-parchment"
                    : "border-transparent text-parchment/85 hover:bg-ink/50",
                ].join(" ")}
              >
                <MemberAvatar member={m} size={20} />
                <span className="truncate">{m.name}</span>
                {isWearer ? (
                  <span className="text-amber-300" title="Currently equipped">
                    ✓
                  </span>
                ) : null}
                <span className="ml-auto truncate text-xs text-parchment/60">
                  {note}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Roster card ────────────────────────────────────────────────────

function RosterCard({
  member,
  className_,
  raceName,
  xpProgress,
  onOpen,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  isSendTarget = false,
  isSendFocused = false,
  isRosterFocused = false,
  overrideTitle,
  onDragStart,
  onDragEnterCard,
  onDropOnCard,
  onDragEnd,
}: {
  member: PartyCharacterRef;
  className_: string;
  raceName: string;
  /** XP progress within the current level — drives the amber bar's
   *  fill AND the inline numeric readout. Resets to `{ into: 0,
   *  needed: <xpPer> }` at the moment a level-up commits, so the bar
   *  visually empties and starts filling again toward the next
   *  threshold (rather than carrying over the cumulative XP curve). */
  xpProgress: { into: number; needed: number };
  /** When provided, the whole card becomes a button that drills into
   *  the CharacterSheetSim for this member. The Party screen passes
   *  this; standalone uses can omit it. */
  onOpen?: () => void;
  /** When true the card is HTML5-draggable (the host owns the reorder
   *  flow). Clicks still drill in — the browser only fires drag
   *  events on actual movement. */
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  /** True while the parent is in "send to character" mode. Highlights
   *  the card with the same drop-target ring + bumps the slot number
   *  so the player has a clear visual hint of which key to press. */
  isSendTarget?: boolean;
  /** Set on exactly one card while in send mode — the one the
   *  keyboard cursor is currently pointing at. Stacks on top of the
   *  send-target ring with a brighter ember outline so the player
   *  can see "Enter sends to *this* card" without losing the "any of
   *  these cards is a valid destination" affordance. */
  isSendFocused?: boolean;
  /** Set when the keyboard cursor is in the roster zone (the right
   *  pane) and this is the card it's pointing at. Pressing Enter
   *  from this state drills into the character sheet. Same visual
   *  affordance as `isSendFocused`. */
  isRosterFocused?: boolean;
  /** Tooltip override — wins over the default drag / drill-in titles. */
  overrideTitle?: string;
  onDragStart?: () => void;
  onDragEnterCard?: () => void;
  onDropOnCard?: () => void;
  onDragEnd?: () => void;
}) {
  const thumb = member.sprite
    ? resolveSpritePath(member.sprite, SPRITE_CONFIG)
    : null;
  const hp = member.hp ?? 0;
  const mp = member.mp ?? 0;
  // Per-level XP progress — see xpProgressInLevel for why the bar
  // can't just read `member.exp` directly (the field is cumulative,
  // not per-level).
  const xpInto = xpProgress.into;
  const xpNeeded = xpProgress.needed;
  // Real max values when the play overlay stitched them on; for
  // pure-catalog contexts (editor preview) fall back to treating
  // current as max so the bar still renders something sane.
  const maxHp = member.maxHp ?? hp;
  const maxMp = member.maxMp ?? mp;
  // Status flags driven by the live save. `fallen` greys the card
  // and stamps a label so the player can spot downed members at a
  // glance instead of squinting at "HP 0/9". `effects` lights up
  // per-character condition pills (poison, curse, buff).
  const fallen = hp <= 0;
  const effects = member.effects ?? [];
  return (
    <li
      className={[
        "flex items-start gap-2 rounded border border-parchment/10 bg-ink/30 p-2 transition-colors",
        onOpen
          ? "cursor-pointer hover:border-amber-300/40 hover:bg-ink/50"
          : "",
        isDragging ? "opacity-40" : "",
        isDropTarget || isSendTarget
          ? "border-amber-300/70 ring-1 ring-amber-300/50"
          : "",
        isSendFocused || isRosterFocused
          ? "ring-2 ring-ember/80 ring-offset-1 ring-offset-ink/60"
          : "",
        fallen ? "opacity-60 saturate-50" : "",
      ].join(" ")}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        // dataTransfer needs *something* on Firefox; we don't actually
        // read from it — the parent tracks the drag-from id in state.
        e.dataTransfer.setData("text/plain", member.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        // Without preventDefault the drop event never fires.
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={() => {
        if (!draggable) return;
        onDragEnterCard?.();
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDropOnCard?.();
      }}
      onDragEnd={() => {
        if (!draggable) return;
        onDragEnd?.();
      }}
      onClick={onOpen}
      title={
        overrideTitle ??
        (draggable
          ? `Drag to reorder · click to open ${member.name}'s sheet`
          : onOpen
            ? `Open ${member.name}'s sheet`
            : undefined)
      }
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          width={32}
          height={32}
          style={{ imageRendering: "pixelated" }}
          className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
        />
      ) : (
        <span className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-display text-parchment">{member.name}</span>
        </div>
        <div className="text-xs text-parchment/85">
          {className_} · {raceName}
          {member.gender ? ` · ${member.gender}` : ""}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-xs text-parchment/80">
          <Bar
            label="HP"
            value={hp}
            max={Math.max(maxHp, 1)}
            color="bg-emerald-600/70"
          />
          <Bar
            label="MP"
            value={mp}
            max={Math.max(maxMp, 1)}
            color="bg-sky-600/70"
            empty={maxMp === 0}
          />
          <Bar
            label="XP"
            value={xpInto}
            max={xpNeeded}
            color="bg-amber-400/60"
          />
        </div>
        {fallen || effects.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {fallen ? (
              <span
                className="rounded border border-ember/60 bg-ember/25 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-ember"
                title="Down — needs a Raise Dead at a temple."
              >
                Fallen
              </span>
            ) : null}
            {effects.map((e) => (
              <span
                key={e.id}
                className="rounded border border-parchment/25 bg-ink/50 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-parchment/75"
                title={`${prettifyEffectId(e.id)}${
                  typeof e.duration === "number"
                    ? ` — ${e.duration} steps left`
                    : e.duration === "permanent"
                      ? " — permanent"
                      : ""
                }`}
              >
                {prettifyEffectId(e.id)}
                {typeof e.duration === "number" ? ` ${e.duration}` : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Bar({
  label,
  value,
  max,
  color,
  empty,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  empty?: boolean;
}) {
  const pct = empty ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex flex-col">
      <span className="text-parchment/65">{label}</span>
      <span className="h-1.5 w-full overflow-hidden rounded bg-ink/70">
        <span
          className={`block h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
