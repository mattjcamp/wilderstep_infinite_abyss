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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { xpProgressInLevel as levelingXpProgress } from "@/battle/world/Leveling";
import {
  initialPartyNavState,
  reducePartyNav,
  ACTION_USE,
  ACTION_SEND,
  ACTION_EXAMINE,
  type PartyNavContext,
} from "./partyScreenNav";
import {
  CharacterSheetSim,
  type SheetItemRef,
} from "./CharacterSheetSim";
import { DurabilityBar } from "./DurabilityBar";
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
}

export interface PartySpellRef {
  id: string;
  name?: string;
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
};

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
    const rows: EffectRow[] = abilities
      .filter((a) => a.party_effect === true && unlocked.has(a.id))
      .map((a) => ({
        kind: "effect" as const,
        ability: a,
        available: true,
        active: activeEffectIds.includes(a.id),
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
    for (const id of activeEffectIds) if (!existingIds.has(id)) extraIds.add(id);
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
        active: activeEffectIds.includes(id) || (dur ?? 0) > 0,
        durationSteps: dur && dur > 0 ? dur : undefined,
      });
    }
    return rows;
  }, [abilities, unlocked, activeEffectIds, effectDurations]);

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
  const stashEntries = party.inventory ?? [];
  const [stashSelectedIndex, setStashSelectedIndex] = useState<number | null>(
    stashEntries.length > 0 ? 0 : null,
  );
  /** When the stash shrinks (item used / sent away), the cursor may
   *  fall off the end. Clamp it on every render so the detail panel
   *  always points at a real row, and disappear it when the stash
   *  empties. */
  useEffect(() => {
    if (stashEntries.length === 0) {
      setStashSelectedIndex(null);
      return;
    }
    setStashSelectedIndex((cur) => {
      if (cur == null) return 0;
      if (cur >= stashEntries.length) return stashEntries.length - 1;
      return cur;
    });
  }, [stashEntries.length]);

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
  type FocusZone = "effects" | "stash" | "actions" | "send" | "roster";
  type LeftZone = "effects" | "stash" | "actions";
  const [focusZone, setFocusZone] = useState<FocusZone>("effects");
  const [actionIndex, setActionIndex] = useState<number>(ACTION_USE);
  const [sendIndex, setSendIndex] = useState<number>(0);
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

  const selectedStashEntry =
    stashSelectedIndex != null ? stashEntries[stashSelectedIndex] : null;
  const selectedStashCatalog = selectedStashEntry
    ? itemById.get(selectedStashEntry.item)
    : null;
  const selectedStashName = selectedStashEntry
    ? itemNameById.get(selectedStashEntry.item) ?? selectedStashEntry.item
    : null;
  const canUseSelected =
    !!onUseStashItem && !!selectedStashCatalog?.usable;
  // Send is blocked when the catalog flags the item party-only (e.g.
  // Camping Supplies — it has no meaning in one character's inventory
  // since the rest applies to the whole party). Absent flag defaults
  // to sendable so existing items keep their behavior.
  const itemIsSendable =
    selectedStashCatalog?.sendable_to_character !== false;
  const canSendSelected =
    !!onSendStashItem && members.length > 0 && itemIsSendable;

  // Helpers wrapping the callbacks so the keyboard + click paths share
  // the same plumbing (and tests can assert on a single seam).
  const triggerUse = useCallback(() => {
    if (stashSelectedIndex == null) return;
    if (!canUseSelected || !onUseStashItem) return;
    onUseStashItem(stashSelectedIndex);
    setStashMode("none");
  }, [canUseSelected, onUseStashItem, stashSelectedIndex]);

  const beginSend = useCallback(() => {
    if (stashSelectedIndex == null) return;
    if (!canSendSelected) return;
    setStashMode("send");
  }, [canSendSelected, stashSelectedIndex]);

  const sendToMember = useCallback(
    (memberIndex: number) => {
      if (stashSelectedIndex == null) return;
      if (!onSendStashItem) return;
      if (memberIndex < 0 || memberIndex >= members.length) return;
      onSendStashItem(stashSelectedIndex, memberIndex);
      setStashMode("none");
    },
    [onSendStashItem, stashSelectedIndex, members.length],
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

  // Resync selection when the underlying list changes (e.g., roster
  // edit added a Halfling and unlocked Pickpocket).
  const selectedRow = effectRows.find((r) => r.ability.id === selectedId);

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
      const navCtx: PartyNavContext = {
        effectCount: effectRows.length,
        stashCount: stashEntries.length,
        memberCount: members.length,
        canUse: canUseSelected,
        canSend: canSendSelected,
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
          if (row) toggleActive(row.ability.id, row.available);
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
    stashEntries.length,
    stashSelectedIndex,
    members,
    members.length,
    canUseSelected,
    canSendSelected,
    triggerUse,
    sendToMember,
    toggleExamine,
    toggleActive,
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
  const sectionHeaderClass = (zone: FocusZone): string => {
    const focused = focusZone === zone;
    // Focused header gets a colored left bar + brighter amber so the
    // player can see at a glance which list Enter will act on. The
    // ▶ marker alone was too easy to miss against the rest of the
    // chrome (the player report that started this fix said pressing
    // Enter "didn't toggle the effect" — the actual cause was that
    // focus had drifted to the stash without a clear visual cue).
    return [
      "text-[13px] uppercase tracking-wide pl-2 -ml-2",
      focused
        ? "border-l-2 border-amber-200 text-amber-200"
        : "border-l-2 border-transparent text-amber-300/70",
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
        onBack={() => setFocusedMemberId(null)}
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
      {/* Title */}
      <div className="border-b border-parchment/15 pb-1 text-center font-display text-lg uppercase tracking-[0.3em] text-amber-300">
        Party
      </div>

      {/* Two-pane body */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Left: effects + actions + stash */}
        <div className="space-y-2">
          {/* EFFECTS list */}
          <section>
            <h3 className={sectionHeaderClass("effects")}>
              {focusZone === "effects" ? "▸ " : ""}Effects
            </h3>
            <ul className="mt-1 space-y-0.5">
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
                        if (row.available) {
                          toggleActive(row.ability.id, true);
                        }
                      }}
                      className={[
                        "flex w-full items-center gap-2 rounded border px-2 py-0.5 text-left text-sm text-parchment/90",
                        rowSelClass("effects", isSel),
                      ].join(" ")}
                    >
                      {row.active ? (
                        <span className="text-amber-300">●</span>
                      ) : (
                        <span className="text-parchment/60">○</span>
                      )}
                      <span>{row.ability.name ?? row.ability.id}</span>
                      {row.durationSteps !== undefined ? (
                        <span className="ml-auto font-mono text-xs text-parchment/75">
                          {row.durationSteps}{" "}
                          {row.durationSteps === 1 ? "step" : "steps"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* SHARED STASH — scrollable list. Up/Down navigates (and
              spills back into Effects past the first row); Enter
              opens the Use / Send / Examine submenu. U / S / X still
              work as direct accelerators. Max-height keeps a long
              stash from blowing past the modal; the auto-scroll
              effect keeps the highlighted row in view as the cursor
              walks past the visible window. */}
          <section>
            <h3 className={sectionHeaderClass("stash")}>
              {focusZone === "stash" ? "▸ " : ""}Shared Stash{" "}
              <span className="text-parchment/65">
                ({stashEntries.length} items)
              </span>
            </h3>
            <ul
              ref={stashListRef}
              className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1 text-sm"
              role="listbox"
              aria-label="Shared stash"
            >
              {stashEntries.length === 0 ? (
                <li className="text-[13px] text-parchment/65">(empty)</li>
              ) : null}
              {stashEntries.map((entry, i) => {
                const label =
                  itemNameById.get(entry.item) ?? entry.item;
                const isSel = i === stashSelectedIndex;
                const cat = itemById.get(entry.item);
                // Quantity badge — for stackable items, `entry.charges`
                // is the number of physical items in this stack. We
                // only render the badge when > 1 so a single Torch
                // still reads as "Torch" (no noisy "(1)"). Non-
                // stackable items don't carry a quantity at all — the
                // catalog flag gates them out here.
                const qty =
                  cat?.stackable && typeof entry.charges === "number"
                    ? entry.charges
                    : 1;
                // Durability bar — only show for non-stackable gear
                // whose catalog defines a positive max. Current value
                // falls back to max when the entry hasn't been worn
                // yet (a fresh item reads as full bar).
                const durMax = cat?.durability ?? 0;
                const showDur = !cat?.stackable && durMax > 0;
                const durCur = showDur
                  ? (typeof entry.durability === "number" ? entry.durability : durMax)
                  : 0;
                return (
                  <li key={`${entry.item}-${i}`}>
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
                        // Double-click is a power-user shortcut: Use if
                        // we can, otherwise just Examine. Sending always
                        // needs an explicit recipient so we never auto-send.
                        if (
                          onUseStashItem &&
                          cat?.usable
                        ) {
                          onUseStashItem(i);
                        } else {
                          setStashMode("examine");
                        }
                      }}
                      className={[
                        "flex w-full items-center justify-between gap-2 rounded border px-2 py-0.5 text-left",
                        isSel
                          ? `${rowSelClass("stash", true)} text-parchment`
                          : "border-transparent text-parchment/85 hover:bg-ink/50",
                      ].join(" ")}
                      title={
                        cat?.description ?? "Click to select · Enter for actions"
                      }
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-[13px] text-parchment/75">
                        {showDur ? (
                          <DurabilityBar current={durCur} max={durMax} />
                        ) : null}
                        {qty > 1 ? <span>({qty})</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* STASH ITEM DETAIL — Use / Send / Examine actions for the
              row currently highlighted in the stash. Hidden when the
              stash is empty so we don't render an empty action panel. */}
          {selectedStashEntry && selectedStashName ? (
            <section className="rounded border border-parchment/15 bg-ink/30 p-2">
              <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
                Stash Item
              </h3>
              <div className="mt-1 space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-parchment">
                    {selectedStashName}
                  </span>
                  {selectedStashEntry.charges != null ? (
                    <span className="text-xs text-parchment/75">
                      ×{selectedStashEntry.charges}
                    </span>
                  ) : null}
                </div>
                {stashMode === "examine" ? (
                  <p className="text-[13px] text-parchment/75">
                    {selectedStashCatalog?.description ??
                      "(no description in items.json)"}
                  </p>
                ) : null}
                {stashMode === "send" ? (
                  <p className="text-[13px] text-amber-300">
                    Send to which character? ↑↓ to pick + Enter, or
                    press 1–{members.length}, or click a roster card.
                    Esc cancels.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1 pt-1">
                  <ActionButton
                    label="Use (U)"
                    onClick={() => {
                      setFocusZone("actions");
                      setActionIndex(ACTION_USE);
                      triggerUse();
                    }}
                    enabled={canUseSelected}
                    focused={focusZone === "actions" && actionIndex === ACTION_USE}
                    hint={
                      !onUseStashItem
                        ? "Host hasn't wired Use yet."
                        : !selectedStashCatalog?.usable
                          ? "This item isn't usable from the stash."
                          : "Use this item for the party."
                    }
                  />
                  <ActionButton
                    label="Send to… (S)"
                    onClick={() => {
                      setFocusZone("actions");
                      setActionIndex(ACTION_SEND);
                      beginSend();
                    }}
                    enabled={canSendSelected && stashMode !== "send"}
                    focused={
                      (focusZone === "actions" && actionIndex === ACTION_SEND) ||
                      stashMode === "send"
                    }
                    hint={
                      !onSendStashItem
                        ? "Host hasn't wired Send yet."
                        : members.length === 0
                          ? "No party members to receive it."
                          : !itemIsSendable
                            ? "This item is used for the whole party — it stays in the stash."
                            : "Pick a character to receive this item."
                    }
                  />
                  <ActionButton
                    label={stashMode === "examine" ? "Hide (X)" : "Examine (X)"}
                    onClick={() => {
                      setFocusZone("actions");
                      setActionIndex(ACTION_EXAMINE);
                      toggleExamine();
                    }}
                    enabled={true}
                    focused={
                      focusZone === "actions" && actionIndex === ACTION_EXAMINE
                    }
                    hint="Show the catalog description."
                  />
                  {stashMode === "send" ? (
                    <button
                      type="button"
                      onClick={() => setStashMode("none")}
                      className="rounded border border-parchment/30 bg-ink/40 px-2 py-0.5 text-[13px] text-parchment/75 hover:bg-ink/60"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        {/* Right: roster + detail + gold */}
        <div className="space-y-2">
          {/* Roster */}
          <section>
            <h3 className={sectionHeaderClass("roster")}>
              {focusZone === "roster" ? "▸ " : ""}Party [1-{members.length}]
            </h3>
            <ul className="mt-1 space-y-1">
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
                    slotNumber={i + 1}
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

          {/* AVAILABLE EFFECT — detail of the selected row */}
          <section className="rounded border border-parchment/15 bg-ink/30 p-2">
            <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
              Available Effect
            </h3>
            {selectedRow ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="font-display text-parchment">
                  {selectedRow.ability.name ?? selectedRow.ability.id}
                </div>
                <p className="text-[13px] text-parchment/75">
                  {selectedRow.ability.description ?? "(no description)"}
                </p>
                <div className="text-xs text-parchment/75">
                  Duration: {fmtDuration(selectedRow.ability.duration)}
                </div>
                <div className="text-xs text-parchment/75">
                  Requires:{" "}
                  {requirementsFor(
                    selectedRow.ability.id,
                    races,
                    classes,
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(selectedRow.ability.id, true)}
                  className="mt-1 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[13px] text-parchment hover:bg-ember/50"
                >
                  {selectedRow.active
                    ? "Remove from active"
                    : "Add to active"}
                </button>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-parchment/65">
                Select an effect on the left to see its details.
              </p>
            )}
          </section>

          {/* Gold + stash totals */}
          <section className="flex items-center justify-between rounded border border-parchment/15 bg-ink/30 px-2 py-1 text-sm">
            <span className="text-amber-300">GOLD: {party.gold ?? 0}</span>
            <span className="text-parchment/75">
              STASH: {party.inventory?.length ?? 0}
            </span>
          </section>
        </div>
      </div>

      {/* Bottom hint bar. Reflects whichever mode is active so the
          player isn't hunting for which keys do what. */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-xs uppercase tracking-wider text-parchment/65">
        {stashMode === "send"
          ? `Press 1-${members.length} or click a roster card · ESC to cancel`
          : stashMode === "examine"
            ? "X / ESC to close · Up/Down to scroll stash"
            : (
              <>
                Up/Down scroll stash · U use · S send · X examine
                {reorderEnabled ? " · Drag to reorder" : ""} · ESC to close
              </>
            )}
      </div>
    </div>
  );
}

/**
 * Tiny pill-style action button used in the Stash Item detail panel.
 * Greys out when `enabled` is false and forwards a tooltip describing
 * why — keeps the affordance visible even when the action isn't
 * applicable so the player can learn what unlocks it.
 */
function ActionButton({
  label,
  onClick,
  enabled,
  hint,
  focused = false,
}: {
  label: string;
  onClick: () => void;
  enabled: boolean;
  hint: string;
  /** When true the button is the keyboard-selected target — Enter
   *  inside the actions zone will fire its `onClick`. Adds a brighter
   *  outline so the cursor is visible without showing a browser-
   *  default focus ring (which we can't always reach because the
   *  reducer drives the cursor at the window level rather than
   *  through the DOM focus tree). */
  focused?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={hint}
      className={[
        "rounded border px-2 py-0.5 text-[13px]",
        enabled
          ? "border-ember/60 bg-ember/30 text-parchment hover:bg-ember/50"
          : "cursor-not-allowed border-parchment/15 bg-ink/40 text-parchment/55",
        focused
          ? "ring-1 ring-amber-200 ring-offset-1 ring-offset-ink/60"
          : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ── Roster card ────────────────────────────────────────────────────

function RosterCard({
  member,
  slotNumber,
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
  slotNumber: number;
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
          <span className="text-amber-300">{slotNumber}</span>
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
        <div className="mt-0.5 font-mono text-xs text-parchment/70">
          LVL {member.level} · HP {hp}/{maxHp} · MP {mp}/{maxMp} · XP {xpInto}/
          {xpNeeded}
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
