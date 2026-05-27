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

import { useCallback, useEffect, useMemo, useState } from "react";
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
 *  roster card's XP bar. `member.exp` is cumulative across every
 *  level the character has ever reached (Leveling.ts increments
 *  `level` on a threshold cross but leaves `exp` untouched), so the
 *  bar must subtract the previous level's threshold to read as
 *  "progress toward the next level" rather than "progress through
 *  the entire XP curve".
 *
 *  - `into` — XP earned since the start of this level. 0 the instant
 *    a member levels up; equals `needed` the instant they're about
 *    to level again.
 *  - `needed` — XP the character has to earn during this level to
 *    cross into the next. In practice this is just `race.exp_per_level`
 *    (or the 1500 default) since the curve is linear; expressed as
 *    `next - prev` so a future non-linear curve doesn't silently
 *    break the math.
 *
 *  Falls back to the canonical 1500-per-level curve when the race's
 *  `exp_per_level` override is absent. Mirrors v1's per-race semantics. */
function xpProgressInLevel(
  member: PartyCharacterRef,
  race?: PartyRaceRef,
): { into: number; needed: number } {
  const base = race?.exp_per_level ?? 1500;
  const level = member.level ?? 1;
  const exp = member.exp ?? 0;
  const prevThreshold = Math.max(0, level - 1) * base;
  const nextThreshold = level * base;
  return {
    into: Math.max(0, exp - prevThreshold),
    // Floor at 1 so a 0-XP-per-level race (theoretical) doesn't
    // divide-by-zero in the Bar component's fill math.
    needed: Math.max(1, nextThreshold - prevThreshold),
  };
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
  const toggleActive = (abilityId: string, available: boolean) => {
    if (!available) return;
    const present = activeEffectIds.includes(abilityId);
    if (present) {
      onActiveEffectsChange(activeEffectIds.filter((x) => x !== abilityId));
    } else {
      onActiveEffectsChange([...activeEffectIds, abilityId]);
    }
  };

  // ── Keyboard navigation for the stash ───────────────────────────
  // Registered at the window level with capture: true. React fires
  // child effects BEFORE parent effects on mount, so this listener
  // sits ahead of the surrounding overlay's keydown trap and gets a
  // shot at arrow keys / U/S/X / 1-N before the overlay can
  // `stopPropagation` them. We only `stopPropagation` on keys we
  // actually consumed — ESC / P fall through to the overlay so the
  // close-on-Esc behavior keeps working. Suspended while a member
  // sheet is drilled into so the sheet's own keybinds win.
  useEffect(() => {
    if (focusedMember) return; // Sheet handles its own input.
    const onKey = (e: KeyboardEvent) => {
      // Don't fight the user when they're typing into an input
      // (e.g., the dev console open over the modal).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // ── "Send to…" picker mode ─────────────────────────────
      // While active, the roster is the cursor: 1-9 / Enter pick a
      // destination, ESC cancels back to the resting menu.
      if (stashMode === "send") {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setStashMode("none");
          return;
        }
        const n = parseInt(e.key, 10);
        if (Number.isFinite(n) && n >= 1 && n <= members.length) {
          e.preventDefault();
          e.stopPropagation();
          sendToMember(n - 1);
          return;
        }
        return; // swallow other keys while sending? no — let ESC/P bubble
      }

      // ── Examine popover open: ESC closes; other keys pass ──
      if (stashMode === "examine") {
        if (e.key === "Escape" || e.key === "x" || e.key === "X") {
          e.preventDefault();
          e.stopPropagation();
          setStashMode("none");
          return;
        }
        // Don't trap arrows here — let the user keep scrolling
        // the stash with the examine panel re-rendering live.
      }

      // ── Stash scrolling + action hotkeys ───────────────────
      if (stashEntries.length > 0) {
        if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          e.stopPropagation();
          setStashSelectedIndex((cur) => {
            const last = stashEntries.length - 1;
            if (cur == null) return 0;
            return cur >= last ? last : cur + 1;
          });
          return;
        }
        if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          e.stopPropagation();
          setStashSelectedIndex((cur) => {
            if (cur == null) return 0;
            return cur <= 0 ? 0 : cur - 1;
          });
          return;
        }
      }

      // Action hotkeys — only meaningful when a stash row is selected.
      if (stashSelectedIndex != null) {
        if (e.key === "u" || e.key === "U") {
          if (canUseSelected) {
            e.preventDefault();
            e.stopPropagation();
            triggerUse();
          }
          return;
        }
        if (e.key === "s" || e.key === "S") {
          if (canSendSelected) {
            e.preventDefault();
            e.stopPropagation();
            beginSend();
          }
          return;
        }
        if (e.key === "x" || e.key === "X") {
          e.preventDefault();
          e.stopPropagation();
          toggleExamine();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    focusedMember,
    stashMode,
    stashEntries.length,
    stashSelectedIndex,
    members.length,
    canUseSelected,
    canSendSelected,
    triggerUse,
    beginSend,
    sendToMember,
    toggleExamine,
  ]);

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
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Effects
            </h3>
            <ul className="mt-1 space-y-0.5">
              {effectRows.length === 0 ? (
                <li className="text-xs text-parchment/50">
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
                      onClick={() => setSelectedId(row.ability.id)}
                      onDoubleClick={() =>
                        toggleActive(row.ability.id, true)
                      }
                      className={[
                        "flex w-full items-center gap-2 rounded border px-2 py-0.5 text-left text-sm text-parchment/90",
                        isSel
                          ? "border-ember/60 bg-ember/15"
                          : "border-transparent hover:bg-ink/50",
                      ].join(" ")}
                    >
                      {row.active ? (
                        <span className="text-amber-300">●</span>
                      ) : (
                        <span className="text-parchment/40">○</span>
                      )}
                      <span>{row.ability.name ?? row.ability.id}</span>
                      {row.durationSteps !== undefined ? (
                        <span className="ml-auto font-mono text-[11px] text-parchment/55">
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

          {/* SHARED STASH — scrollable list, click or Up/Down to
              select, Enter/U/S/X for actions. Max-height keeps a long
              stash from blowing past the modal. */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Shared Stash{" "}
              <span className="text-parchment/45">
                ({stashEntries.length} items)
              </span>
            </h3>
            <ul
              className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1 text-sm"
              role="listbox"
              aria-label="Shared stash"
            >
              {stashEntries.length === 0 ? (
                <li className="text-xs text-parchment/45">(empty)</li>
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
                      onClick={() => setStashSelectedIndex(i)}
                      onDoubleClick={() => {
                        setStashSelectedIndex(i);
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
                          ? "border-ember/60 bg-ember/15 text-parchment"
                          : "border-transparent text-parchment/85 hover:bg-ink/50",
                      ].join(" ")}
                      title={
                        cat?.description ?? "Click to select · X to examine"
                      }
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-parchment/55">
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
              <h3 className="text-xs uppercase tracking-wide text-amber-300">
                Stash Item
              </h3>
              <div className="mt-1 space-y-1 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-parchment">
                    {selectedStashName}
                  </span>
                  {selectedStashEntry.charges != null ? (
                    <span className="text-[11px] text-parchment/55">
                      ×{selectedStashEntry.charges}
                    </span>
                  ) : null}
                </div>
                {stashMode === "examine" ? (
                  <p className="text-xs text-parchment/75">
                    {selectedStashCatalog?.description ??
                      "(no description in items.json)"}
                  </p>
                ) : null}
                {stashMode === "send" ? (
                  <p className="text-xs text-amber-300">
                    Send to which character? Press 1–{members.length} or
                    click a roster card. ESC cancels.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1 pt-1">
                  <ActionButton
                    label="Use (U)"
                    onClick={triggerUse}
                    enabled={canUseSelected}
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
                    onClick={beginSend}
                    enabled={canSendSelected && stashMode !== "send"}
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
                    onClick={toggleExamine}
                    enabled={true}
                    hint="Show the catalog description."
                  />
                  {stashMode === "send" ? (
                    <button
                      type="button"
                      onClick={() => setStashMode("none")}
                      className="rounded border border-parchment/30 bg-ink/40 px-2 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
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
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Party [1-{members.length}]
            </h3>
            <ul className="mt-1 space-y-1">
              {members.length === 0 ? (
                <li className="text-xs text-parchment/50">
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
                        : () => setFocusedMemberId(m.id)
                    }
                    /** Surface a "drop target" ring while sending so the
                     *  player can visually confirm where the item is
                     *  about to land. Re-uses the existing drag/drop
                     *  highlight styling — same affordance, different
                     *  trigger. */
                    isSendTarget={sendingNow}
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
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Available Effect
            </h3>
            {selectedRow ? (
              <div className="mt-1 space-y-1 text-sm">
                <div className="font-display text-parchment">
                  {selectedRow.ability.name ?? selectedRow.ability.id}
                </div>
                <p className="text-xs text-parchment/75">
                  {selectedRow.ability.description ?? "(no description)"}
                </p>
                <div className="text-[11px] text-parchment/55">
                  Duration: {fmtDuration(selectedRow.ability.duration)}
                </div>
                <div className="text-[11px] text-parchment/55">
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
                  className="mt-1 rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50"
                >
                  {selectedRow.active
                    ? "Remove from active"
                    : "Add to active"}
                </button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-parchment/45">
                Select an effect on the left to see its details.
              </p>
            )}
          </section>

          {/* Gold + stash totals */}
          <section className="flex items-center justify-between rounded border border-parchment/15 bg-ink/30 px-2 py-1 text-sm">
            <span className="text-amber-300">GOLD: {party.gold ?? 0}</span>
            <span className="text-parchment/55">
              STASH: {party.inventory?.length ?? 0}
            </span>
          </section>
        </div>
      </div>

      {/* Bottom hint bar. Reflects whichever mode is active so the
          player isn't hunting for which keys do what. */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-[10px] uppercase tracking-wider text-parchment/45">
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
}: {
  label: string;
  onClick: () => void;
  enabled: boolean;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={hint}
      className={[
        "rounded border px-2 py-0.5 text-xs",
        enabled
          ? "border-ember/60 bg-ember/30 text-parchment hover:bg-ember/50"
          : "cursor-not-allowed border-parchment/15 bg-ink/40 text-parchment/35",
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
        <div className="text-[11px] text-parchment/70">
          {className_} · {raceName}
          {member.gender ? ` · ${member.gender}` : ""}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px] text-parchment/65">
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
        <div className="mt-0.5 font-mono text-[10px] text-parchment/50">
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
      <span className="text-parchment/45">{label}</span>
      <span className="h-1.5 w-full overflow-hidden rounded bg-ink/70">
        <span
          className={`block h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
