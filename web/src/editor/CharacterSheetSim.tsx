"use client";

/**
 * CharacterSheetSim — read-only "in-game" view of a single character.
 * The screen the v1 game opens when the player presses 1-4 from the
 * Party screen. Layout faithfully ports v1's web-port:
 *
 *   ┌──── ALDRIC — Fighter • Human • Lvl 1 ────┐
 *   │ ┌──┐ Aldric              EQUIPPED        │
 *   │ │sp│ Fighter • Human • M  Hands  Club    │
 *   │ └──┘ Level 1 • EXP 0/1125 Body   Cloth   │
 *   │                                          │
 *   │ HP ▓▓▓▓▓▓▓▓ 16/16        PERSONAL ITEMS  │
 *   │ MP            0/0          (none)        │
 *   │                                          │
 *   │ COMBAT                                   │
 *   │ AC      10                               │
 *   │ Damage  1d4 +2 (Club)                    │
 *   │                                          │
 *   │ ATTRIBUTES                               │
 *   │ Strength    16  (+3)                     │
 *   │ Dexterity   11  (0)                      │
 *   │ … etc                                    │
 *   └──────────────────────────────────────────┘
 *
 * Scope intent — preview / simulation only:
 *   - The screen is read-only. Equipped + Personal Items render but
 *     don't equip/unequip. The hint bar is decorative, mirroring the
 *     v1 layout for visual continuity.
 *   - Stat math (modifiers, AC, damage roll) follows v1's
 *     CombatBridge:
 *       mod(stat)   = floor((stat - 10) / 2)
 *       ac          = 10 + dexMod + armor.evasion-based bonus
 *       atk bonus   = ranged ? dexMod : strMod
 *       damage      = power-tier dice + statMod (clubs etc → 1d4 + STR)
 *   - Reused by both the Party screen (drill-in on member click) and
 *     the Characters editor (sim preview next to the editable sheet).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { xpProgressInLevel as levelingXpProgress } from "@/battle/world/Leveling";
import {
  initialCharSheetNavState,
  reduceCharSheetNav,
  type CharSheetNavContext,
  type CharSheetNavState,
  type CharSheetZone,
} from "./characterSheetNav";
import type {
  PartyAbilityRef,
  PartyCharacterRef,
  PartyClassRef,
  PartyItemRef,
  PartyRaceRef,
  PartySpellRef,
} from "./PartyScreen";
import { DurabilityBar } from "./DurabilityBar";
import { resolveSpritePath } from "./spriteFields";
import {
  abilityMod as sharedAbilityMod,
  combatStatsFor as sharedCombatStatsFor,
} from "./combatStats";

const SPRITE_CONFIG = { category: "person", format: "path" } as const;

/** Item shape with the combat-relevant fields the sheet reads. The
 *  catalog passes more — this interface just narrows what the sim
 *  consumes so callers can pass loose records.
 *
 *  Magic-item fields (`bonus_damage`, `damage_type`, `wielder_passives`,
 *  `grants_effect`) mirror what `web/src/battle/world/Items.ts` declares
 *  on the full `Item` type — the sheet reads them so legendary gear
 *  (Sun Sword, Mystic Sword) displays its actual mechanical payload
 *  rather than collapsing back to its base power tier. `bonus_damage`
 *  is `string | number` because items.json stores it as a dice
 *  expression (`"1d6"`); the prior `number`-only typing was an oversight
 *  that meant every Sun Sword on the sheet rendered as a plain sword. */
export interface SheetItemRef extends PartyItemRef {
  category?: string;
  power?: number;
  ranged?: boolean;
  slots?: string[];
  evasion?: number;
  ac_bonus?: number;
  bonus_damage?: string | number;
  damage_type?: string;
  /** Magic-item passive ids stamped onto the wielder while equipped.
   *  Today's combat engine reads `"fire_resistance"` and
   *  `"poison_immunity"` — see `web/src/battle/combat/CombatBridge.ts`
   *  → `passiveFromWielderId`. Surfaced on the sheet as a small pill
   *  under the Equipped panel so the player can see "Sun Sword grants
   *  fire resistance" without diving into combat to find out. */
  wielder_passives?: string[];
  /** Party-wide effect granted while the item is equipped (Sun Sword's
   *  `sun_sword_aura`, Mystic Sword's mana glow, etc.). Display-only
   *  on the sheet; the actual HUD plumbing lives in
   *  `refreshItemGrantedEffects`. */
  grants_effect?: string;
}

const STAT_KEYS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
] as const;
type StatKey = (typeof STAT_KEYS)[number];

const STAT_LABELS: Record<StatKey, string> = {
  strength: "Strength",
  dexterity: "Dexterity",
  constitution: "Constitution",
  intelligence: "Intelligence",
  wisdom: "Wisdom",
};

// ── Helpers ────────────────────────────────────────────────────────

/** D&D-style ability modifier (10 = 0, 18 = +4, 8 = -1, …). Re-exports
 *  the shared editor/combatStats helper so this module's call sites
 *  keep the short local name without owning a second copy that could
 *  drift from the combat engine's formula. */
const abilityMod = sharedAbilityMod;

/** Render +N / -N / 0, with color hints applied by the caller. */
function fmtMod(n: number): string {
  if (n === 0) return "(0)";
  return n > 0 ? `(+${n})` : `(${n})`;
}

interface DamageRoll {
  dice: number;
  sides: number;
  bonus: number;
}

/** Format the base damage roll. Bonus damage (Sun Sword's fire 1d6)
 *  is appended separately in {@link fmtDamageWithBonus} so the sheet
 *  reads e.g. "2d8 +3 (Sun Sword) +1d6 fire". */
function fmtDamage(d: DamageRoll, weaponName: string | null): string {
  if (d.dice === 0) return `${d.bonus}${weaponName ? ` (${weaponName})` : ""}`;
  const sign = d.bonus === 0 ? "" : d.bonus > 0 ? ` +${d.bonus}` : ` ${d.bonus}`;
  return `${d.dice}d${d.sides}${sign}${weaponName ? ` (${weaponName})` : ""}`;
}

/** Append the weapon's magic `bonus_damage` (+ optional damage type
 *  tag) to the formatted base roll. Pure / no-op when the weapon
 *  carries no bonus damage, so plain swords render exactly as before.
 *  Numeric bonus_damage renders as a flat "+N", string values
 *  (dice expressions like "1d6") pass through verbatim. */
function fmtDamageWithBonus(
  d: DamageRoll,
  weapon: SheetItemRef | null,
): string {
  const base = fmtDamage(d, weapon?.name ?? null);
  if (!weapon || weapon.bonus_damage == null) return base;
  const bd = weapon.bonus_damage;
  const bonusText =
    typeof bd === "number" ? (bd >= 0 ? `+${bd}` : `${bd}`) : `+${bd}`;
  const typeTag = weapon.damage_type ? ` ${weapon.damage_type}` : "";
  return `${base} ${bonusText}${typeTag}`;
}

/** Human-readable label for a `wielder_passives` id. The engine-side
 *  taxonomy is small (today: fire_resistance, poison_immunity); anything
 *  it doesn't recognise falls back to a Title Cased version of the id
 *  so a future passive surfaces immediately on the sheet without a
 *  code change here. */
const WIELDER_PASSIVE_LABELS: Record<string, string> = {
  fire_resistance: "Fire Resistance",
  poison_immunity: "Poison Immunity",
};
function prettifyPassiveId(id: string): string {
  if (WIELDER_PASSIVE_LABELS[id]) return WIELDER_PASSIVE_LABELS[id];
  return id
    .split("_")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Collect deduped `wielder_passives` from every equipped slot — the
 *  same walk CombatBridge does. Used to render the "Magic Gear" pill
 *  strip under the Equipped panel so the player sees what passives
 *  their gear is granting them out of combat. */
function collectEquippedPassives(
  member: PartyCharacterRef,
  itemById: ReadonlyMap<string, SheetItemRef>,
): string[] {
  const equipped = (member.equipped ?? {}) as Record<string, string>;
  const seen = new Set<string>();
  for (const slotId of Object.values(equipped)) {
    const it = slotId ? itemById.get(slotId) ?? null : null;
    const declared = it?.wielder_passives;
    if (!Array.isArray(declared)) continue;
    for (const p of declared) {
      if (typeof p === "string" && !seen.has(p)) seen.add(p);
    }
  }
  return [...seen];
}

/** XP progress *within the current level* — thin adapter over
 *  Leveling.ts's `xpProgressInLevel` (single source of truth for
 *  the XP curve, including the rising-increment math) that handles
 *  this sheet's optional fields and race override defaulting
 *  (Humans level faster at 1125, others 1500). */
function xpProgressInLevel(
  member: PartyCharacterRef,
  race?: PartyRaceRef,
): { into: number; needed: number } {
  const base = race?.exp_per_level ?? 1500;
  return levelingXpProgress(member.level ?? 1, member.exp ?? 0, base);
}

// ── Component ──────────────────────────────────────────────────────

export function CharacterSheetSim({
  character,
  classes,
  races,
  items,
  abilities = [],
  spells = [],
  onBack,
  onCastSpell,
  onUsePersonalItem,
  onReturnPersonalItem,
  onEquipPersonalItem,
  onUnequipSlot,
  onUseAbility,
  abilityCooldowns,
}: {
  character: PartyCharacterRef;
  classes: ReadonlyArray<PartyClassRef>;
  races: ReadonlyArray<PartyRaceRef>;
  items: ReadonlyArray<SheetItemRef>;
  /** Full Ability catalog. The sheet filters to the ids granted by
   *  the character's race + class (with min_level satisfied). Pass an
   *  empty array — or omit entirely — and the Abilities sections
   *  render empty. */
  abilities?: ReadonlyArray<PartyAbilityRef>;
  /** Full Spell catalog. The sheet filters to spells whose
   *  `casting_type` matches one of the character's class casting
   *  types and whose `min_level` is satisfied (`class_min_levels`
   *  override honoured if present). */
  spells?: ReadonlyArray<PartySpellRef>;
  /** Optional Back button — shown when present. Lets the Party screen
   *  drill-in / drill-out, while standalone hosts can omit it. */
  onBack?: () => void;
  /** Fires when the player clicks Cast on a party-castable spell.
   *  The handler is responsible for any target picker (heals) or
   *  immediate apply (self-cast like Light), MP deduction, and save
   *  persistence. When omitted, Cast still shows a preview message
   *  but no state changes (the screen stays a pure preview). */
  onCastSpell?: (casterId: string, spellId: string) => void;
  /** Fires when the player clicks "Use" on an item in this
   *  character's personal inventory. Host applies the item's effect
   *  (Torch → bump party light, etc.), decrements the stack, and
   *  persists. When omitted (editor preview), the button is hidden. */
  onUsePersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Fires when the player clicks "Return to stash" on a personal
   *  inventory entry. Host moves ONE physical item back into the
   *  shared stash and persists. When omitted, the button is hidden. */
  onReturnPersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Fires when the player clicks "Equip" on a personal inventory
   *  entry whose `slots` array names a known slot ("hands", "body").
   *  Host moves the item from inventory into `equipped[slot]`,
   *  bouncing whatever was already in that slot back into the
   *  personal inventory. When omitted, the button is hidden. */
  onEquipPersonalItem?: (memberId: string, itemIndex: number) => void;
  /** Fires when the player clicks "Unequip" on a selected equipped
   *  slot. Host removes the item from `equipped[slot]` and pushes
   *  it into the personal inventory (merging with an existing
   *  stack on stackable items). When omitted, the button is hidden. */
  onUnequipSlot?: (memberId: string, slot: string) => void;
  /** Fires when the player clicks "Use" on a `usable_in: ["party"]`
   *  ability row (Tinker today; Pickpocket would also flow here
   *  but it really wants an NPC target so the play overlay points
   *  the player to the NPC dialog instead). When omitted, the
   *  button still appears but only flashes the local "preview
   *  only" line — matches the editor's authoring-preview
   *  semantics. The host gets the member id + the full ability
   *  record so a single handler can branch on `ability.id` and
   *  route to the right picker / dispatcher. */
  onUseAbility?: (memberId: string, ability: PartyAbilityRef) => void;
  /** Optional per-ability cooldown labels — `{ abilityId: "label" }`.
   *  When an entry is present for an ability id, the sheet renders
   *  the Use button disabled with the supplied label in place of
   *  the click target ("Used today", "Resting", etc.). Hosts pass
   *  this for the once-per-day class abilities (Craft Arrows /
   *  Craft Fire Arrows / Tinker) so the player sees the cooldown
   *  on the button itself, not just after clicking + reading a
   *  refusal banner. Abilities not in the map render normally. */
  abilityCooldowns?: ReadonlyMap<string, string>;
}) {
  const className =
    classes.find((c) => c.id === character.class)?.name ?? character.class;
  const raceName =
    races.find((r) => r.id === character.race)?.name ?? character.race;
  const race = races.find((r) => r.id === character.race);
  const klass = classes.find((c) => c.id === character.class);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const abilityById = new Map(abilities.map((a) => [a.id, a]));

  // ── Resolve granted abilities ────────────────────────────────────
  // Race abilities are unconditional; class abilities gate on
  // min_level. Each entry pairs the catalog record with whatever
  // metadata the granter supplied (today: min_level from class).
  const raceAbilities: PartyAbilityRef[] = (race?.abilities ?? [])
    .map((id) => abilityById.get(id))
    .filter((a): a is PartyAbilityRef => Boolean(a));
  const classAbilities: PartyAbilityRef[] = (klass?.abilities ?? [])
    .filter((link) => (link.min_level ?? 1) <= (character.level ?? 1))
    .map((link) => abilityById.get(link.ability_id ?? link.id ?? ""))
    .filter((a): a is PartyAbilityRef => Boolean(a));

  // ── Resolve known spells ─────────────────────────────────────────
  // A spell shows up on the character sheet's "Spells" list (with a
  // Cast button) when ALL of:
  //   - the class's casting_type[] includes the spell's casting_type
  //   - character.level >= per-class override OR global min_level
  //   - the spell's `usable_in` either omits the field OR contains
  //     "party" — i.e. the spell can actually be cast from the party
  //     screen. Spells that can ONLY be cast in a specific context
  //     (Knock from the lock dialog, Long Shanks in combat, …) carry
  //     a `usable_in` list that excludes "party"; rendering a Cast
  //     button for those would just produce an "isn't wired up out
  //     of combat" refusal, which is what the user reported for
  //     Knock specifically. Empty / absent `usable_in` keeps the
  //     legacy behaviour so a hand-rolled spell without the field
  //     still surfaces — the filter is opt-out, not opt-in.
  const knownSpells: PartySpellRef[] = (klass?.casting_type
    ? spells.filter((s) => {
        if (!s.casting_type) return false;
        if (!klass.casting_type!.includes(s.casting_type)) return false;
        const gate =
          s.class_min_levels?.[klass.id] ?? s.min_level ?? 1;
        if ((character.level ?? 1) < gate) return false;
        // usable_in gate: when the field is present + non-empty, it
        // must include "party" for the sheet's Cast button to make
        // sense. Absent / empty = unrestricted (legacy behaviour).
        const usable = s.usable_in;
        if (Array.isArray(usable) && usable.length > 0) {
          if (!usable.includes("party")) return false;
        }
        return true;
      })
    : []) as PartySpellRef[];

  // ── Last-used feedback line (preview-only) ───────────────────────
  // Click an ability/spell button → flash a confirmation here. No
  // state mutation, no targeting picker; real mechanics land when
  // the runtime is ready.
  const [lastAction, setLastAction] = useState<string | null>(null);
  // Auto-clear after a few seconds so a synchronous Cast (e.g.
  // Light) doesn't leave a misleading "Casting …" line stuck on
  // screen indefinitely. The host (PlayPartyScreenOverlay) renders
  // its own authoritative cast banner with its own timeout, so the
  // sheet's local line is purely a click acknowledgement.
  useEffect(() => {
    if (!lastAction) return;
    const t = setTimeout(() => setLastAction(null), 3000);
    return () => clearTimeout(t);
  }, [lastAction]);

  // ── Personal-items selection ────────────────────────────────────
  // Click a row to highlight; Use / Return-to-stash buttons appear
  // beneath the list operating on the selected row. Reset on
  // character drill-out (the parent passes a different character.id)
  // and clamp when the list shrinks past the cursor (e.g. the last
  // Torch got Used, splicing the row).
  const [personalSelectedIndex, setPersonalSelectedIndex] = useState<
    number | null
  >(null);
  /** Equipped-slot selection. Mutually exclusive with the personal-
   *  inventory cursor — clicking one clears the other so the action
   *  row at the bottom of the right pane is unambiguous. */
  const [equippedSelectedSlot, setEquippedSelectedSlot] = useState<
    string | null
  >(null);
  useEffect(() => {
    setPersonalSelectedIndex(null);
    setEquippedSelectedSlot(null);
  }, [character.id]);
  const selectPersonal = (i: number | null) => {
    setPersonalSelectedIndex(i);
    setEquippedSelectedSlot(null);
  };
  const selectEquipped = (slot: string | null) => {
    setEquippedSelectedSlot(slot);
    setPersonalSelectedIndex(null);
  };
  /** Slot ids the sheet renders + accepts as equip targets. Adding a
   *  third slot ("offhand", "head", etc.) means painting another
   *  EquipRow + extending this set. */
  const KNOWN_EQUIP_SLOTS = new Set(["hands", "body"]);
  /** First slot this item can be equipped into, restricted to the
   *  ones the sheet actually renders. Returns null when the item
   *  has no `slots` array or names only unknown slots — i.e. it
   *  isn't equippable from this screen. */
  const equipSlotFor = (
    def: SheetItemRef | null | undefined,
  ): string | null => {
    if (!def || !Array.isArray(def.slots) || def.slots.length === 0)
      return null;
    for (const s of def.slots) {
      if (typeof s === "string" && KNOWN_EQUIP_SLOTS.has(s)) return s;
    }
    return null;
  };

  const equipped = (character.equipped ?? {}) as Record<string, string>;
  const handsId = equipped.hands;
  const bodyId = equipped.body;
  // Per-slot current durability for whatever's in `equipped`. The
  // host (PlayPartyScreenOverlay) merges the save's
  // `equipped_durability` onto the character ref so a worn weapon
  // shows partial wear; an unmerged record (editor preview) leaves
  // the field undefined → bar paints full from the catalog max.
  const equippedDur =
    ((character as { equipped_durability?: Record<string, number | null> })
      .equipped_durability ?? {}) as Record<string, number | null>;
  const weapon: SheetItemRef | null =
    handsId && itemById.get(handsId)?.category === "weapons"
      ? itemById.get(handsId) ?? null
      : null;

  // Source AC + base damage from the shared editor/combatStats helper
  // so the sheet stays in lockstep with the live combat engine
  // (`web/src/battle/combat/CombatBridge.ts`). The local
  // `damageForWeapon` / `computeAc` we used to keep here drifted off the
  // engine's updated formulas — Chain's `/2` evasion divisor and the
  // extended 1d12 / 2d6 / 2d8 power tiers — which is why the screenshot
  // showed AC 11 and "1d10 +3" for a Chain + Sun Sword fighter that
  // should read AC 14 and "2d8 +3 (Sun Sword) +1d6 fire".
  const stats = sharedCombatStatsFor(character, itemById);
  const ac = stats.ac;
  const damage: DamageRoll = stats.damage;
  const damageStr = fmtDamageWithBonus(damage, weapon);
  const equippedPassives = collectEquippedPassives(character, itemById);

  const hp = character.hp ?? 0;
  const mp = character.mp ?? 0;
  // Per-level XP progress — see xpProgressInLevel for why the
  // readout can't show `character.exp` directly (cumulative XP would
  // make a freshly-levelled character look 50% of the way to the
  // NEXT level instead of having just reset to 0).
  const { into: xpInto, needed: xpNeeded } = xpProgressInLevel(
    character,
    race,
  );
  const level = character.level ?? 1;
  // Real peak values when the play overlay attached them; otherwise
  // fall back to current so the bar denominator stays sane in
  // editor preview contexts.
  const maxHp = character.maxHp ?? hp;
  const maxMp = character.maxMp ?? mp;
  const fallen = hp <= 0;
  const characterEffects = character.effects ?? [];

  const portrait = character.sprite
    ? resolveSpritePath(character.sprite, SPRITE_CONFIG)
    : null;

  const personalItems = Array.isArray(character.inventory)
    ? (character.inventory as Array<Record<string, unknown>>)
    : [];

  // ── Keyboard navigation across sections ─────────────────────────
  // The sheet is a vertical stack of interactive lists: Equipped →
  // Personal → (Race | Class abilities side-by-side) → Spells. The
  // arrow-nav reducer in ./characterSheetNav owns the cross-section
  // spill rules; we synthesise its context from whatever lists are
  // currently rendered, run it on every keydown, and dispatch
  // trigger actions back to the host callbacks (Unequip / Use /
  // Equip / Return / Cast). Esc is handled by PartyScreen's drill-
  // in listener (sheet-level Esc pops back to the two-pane view),
  // so this handler deliberately ignores it.
  const navCtx: CharSheetNavContext = useMemo(
    () => ({
      equippedCount: 2,
      personalCount: personalItems.length,
      raceCount: raceAbilities.length,
      classCount: classAbilities.length,
      spellCount: knownSpells.length,
      canEquippedAct: !!onUnequipSlot,
      canPersonalAct:
        !!onUsePersonalItem ||
        !!onEquipPersonalItem ||
        !!onReturnPersonalItem,
      canAbilityAct: !!onUseAbility,
      canSpellAct: !!onCastSpell,
    }),
    [
      personalItems.length,
      raceAbilities.length,
      classAbilities.length,
      knownSpells.length,
      onUnequipSlot,
      onUsePersonalItem,
      onEquipPersonalItem,
      onReturnPersonalItem,
      onUseAbility,
      onCastSpell,
    ],
  );
  const [navState, setNavState] = useState<CharSheetNavState>(() =>
    initialCharSheetNavState(navCtx),
  );
  // Reset nav state on character drill-out so the next member's
  // sheet starts on Equipped[0] instead of inheriting the previous
  // member's cursor. character.id is the parent-driven key.
  useEffect(() => {
    setNavState(initialCharSheetNavState(navCtx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  // Mirror reducer-driven cursor into the existing legacy selection
  // state so the same Personal action row + Equipped Unequip button
  // surface for keyboard nav as they did for click. Goes one-way:
  // arrow key → legacy selection. Mouse clicks still call
  // selectPersonal / selectEquipped directly (which set both legacy
  // state AND call into the reducer via the keydown effect's mouse
  // setters below). The "this zone" gate prevents arrow-away from
  // clobbering whatever was last clicked.
  useEffect(() => {
    if (navState.zone === "personal" && navState.personalIndex >= 0) {
      setPersonalSelectedIndex(navState.personalIndex);
      setEquippedSelectedSlot(null);
    } else if (navState.zone === "equipped") {
      const slot = navState.equippedIndex === 0 ? "hands" : "body";
      setEquippedSelectedSlot(slot);
      setPersonalSelectedIndex(null);
    }
  }, [navState.zone, navState.personalIndex, navState.equippedIndex]);

  // Mirror the host callbacks into a ref so the (empty-deps)
  // keydown listener below can call the LATEST closures when Enter
  // fires a trigger. Without this we'd either re-register the
  // listener on every render (losing first-registered ordering vs.
  // PartyScreen's drill-in Esc handler) or capture stale callbacks.
  const handlersRef = useRef({
    onUnequipSlot,
    onUsePersonalItem,
    onEquipPersonalItem,
    onReturnPersonalItem,
    onUseAbility,
    onCastSpell,
    setLastAction,
  });
  useEffect(() => {
    handlersRef.current = {
      onUnequipSlot,
      onUsePersonalItem,
      onEquipPersonalItem,
      onReturnPersonalItem,
      onUseAbility,
      onCastSpell,
      setLastAction,
    };
  });

  // Live nav state + context refs so the keydown listener can read
  // fresh values without depending on them — same first-registered
  // listener trick used by PartyScreen's drill-in Esc handler.
  const navStateRef = useRef(navState);
  useEffect(() => {
    navStateRef.current = navState;
  }, [navState]);
  const navCtxRef = useRef(navCtx);
  useEffect(() => {
    navCtxRef.current = navCtx;
  }, [navCtx]);
  // Static data the trigger dispatcher needs to look up by index.
  const triggerDataRef = useRef({
    character,
    personalItems,
    raceAbilities,
    classAbilities,
    knownSpells,
    itemById,
    equipSlotFor,
  });
  useEffect(() => {
    triggerDataRef.current = {
      character,
      personalItems,
      raceAbilities,
      classAbilities,
      knownSpells,
      itemById,
      equipSlotFor,
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore typing into form fields (dev console, future rename).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Sheet-level Esc is owned by PartyScreen's drill-in listener
      // (it pops focusedMemberId back to null). Don't trap it here.
      if (e.key === "Escape") return;
      const cur = navStateRef.current;
      const liveCtx = navCtxRef.current;
      const result = reduceCharSheetNav(
        cur,
        { kind: "key", key: e.key },
        liveCtx,
      );
      if (result.consumed) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (result.state !== cur) {
        setNavState(result.state);
      }
      if (result.action.kind === "trigger") {
        const h = handlersRef.current;
        const d = triggerDataRef.current;
        const zone = result.action.zone;
        const idx = result.action.index;
        switch (zone) {
          case "equipped": {
            // Map index → slot id ("hands" / "body"). Bail when the
            // slot is empty or the host hasn't wired Unequip.
            const slot = idx === 0 ? "hands" : "body";
            const equipped = (d.character.equipped ?? {}) as Record<
              string,
              string
            >;
            if (!h.onUnequipSlot || !equipped[slot]) break;
            h.onUnequipSlot(d.character.id, slot);
            break;
          }
          case "personal": {
            const entry = d.personalItems[idx];
            if (!entry) break;
            const id =
              typeof entry.item === "string" ? entry.item : null;
            const def = id ? d.itemById.get(id) ?? null : null;
            // Try Use first (most common consumable action), then
            // Equip (gear), then Return-to-stash (least-likely Enter
            // intent — kept as a click-only path for now).
            if (h.onUsePersonalItem && def?.usable) {
              h.onUsePersonalItem(d.character.id, idx);
              break;
            }
            const equipSlot = d.equipSlotFor(def);
            if (h.onEquipPersonalItem && equipSlot) {
              h.onEquipPersonalItem(d.character.id, idx);
              break;
            }
            // Nothing actionable — quietly do nothing rather than
            // surprise the player with a Return-to-stash.
            break;
          }
          case "race-abilities":
          case "class-abilities": {
            const rows =
              zone === "race-abilities"
                ? d.raceAbilities
                : d.classAbilities;
            const a = rows[idx];
            if (!a) break;
            const usable = (a.usable_in ?? []).includes("party");
            if (!usable) break;
            if (h.onUseAbility) h.onUseAbility(d.character.id, a);
            else
              h.setLastAction(
                `Used ${a.name ?? a.id} — preview only.`,
              );
            break;
          }
          case "spells": {
            const s = d.knownSpells[idx];
            if (!s) break;
            const usable = (s.usable_in ?? []).includes("party");
            if (!usable) break;
            if (h.onCastSpell) h.onCastSpell(d.character.id, s.id);
            else
              h.setLastAction(
                `Cast ${s.name ?? s.id} — preview only.`,
              );
            break;
          }
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
    // Empty deps — listener reads everything via refs. Keeps it at a
    // stable position in the window-capture listener queue (relevant
    // when the sheet is mounted under PartyScreen, whose Esc handler
    // also lives at the window level).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll the focused row into view ───────────────────────
  // The sheet itself is non-scrolling, but the PartyScreen overlay
  // wraps it in a `max-h-[90vh] overflow-auto` container. When the
  // nav cursor walks past the bottom of that container — into the
  // Spells section on a long sheet, typically — the focused row
  // sits off-screen and the player has nothing to react to.
  //
  // Mirrors PartyScreen's stash auto-scroll: tag the focused row
  // with `data-nav-focused="true"` per zone, then query for it and
  // call scrollIntoView({ block: "nearest" }). `nearest` only moves
  // the row when it's actually outside the viewport, so navigating
  // among already-visible rows doesn't jitter the container.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = sheetRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>('[data-nav-focused="true"]');
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [navState]);

  return (
    <div
      ref={sheetRef}
      className="flex flex-col gap-2 rounded-md border border-parchment/15 bg-ink/40 p-3 text-parchment/90"
    >
      {/* Title bar — character name + class • race • level */}
      <div className="flex items-center justify-between gap-2 border-b border-parchment/15 pb-1">
        <div className="flex-1 text-center font-display text-base uppercase tracking-[0.25em] text-amber-300">
          {character.name} <span className="text-parchment/60">—</span>{" "}
          {className}
          <span className="text-parchment/60"> • </span>
          {raceName}
          <span className="text-parchment/60"> • </span>
          Lvl {level}
          {fallen ? (
            <span
              className="ml-2 rounded border border-ember/60 bg-ember/25 px-1.5 py-px font-mono text-xs tracking-wider text-ember"
              title="Fallen — needs Raise Dead at a temple."
            >
              FALLEN
            </span>
          ) : null}
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-parchment/20 px-2 py-0.5 text-[13px] text-parchment/85 hover:bg-ink/40"
            title="Back to Party screen"
          >
            ← Back
          </button>
        ) : null}
      </div>

      {/* Two-pane body */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Left pane: identity + bars + combat + attributes */}
        <div className="space-y-3">
          {/* Identity row */}
          <div className="flex items-start gap-3">
            {portrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={portrait}
                alt=""
                width={56}
                height={56}
                style={{ imageRendering: "pixelated" }}
                className="h-14 w-14 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
              />
            ) : (
              <span className="h-14 w-14 shrink-0 rounded border border-parchment/20 bg-ink/80" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg text-parchment">
                {character.name}
              </div>
              <div className="text-[13px] text-parchment/80">
                {className} <span className="text-parchment/60">•</span>{" "}
                {raceName}
                {character.gender ? (
                  <>
                    {" "}
                    <span className="text-parchment/60">•</span>{" "}
                    {character.gender}
                  </>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-xs text-parchment/75">
                Level {level} <span className="text-parchment/55">•</span> EXP{" "}
                {xpInto} / {xpNeeded}
              </div>
            </div>
          </div>

          {/* HP + MP bars */}
          <div className="space-y-1.5">
            <StatBar
              label="HP"
              value={hp}
              max={Math.max(maxHp, 1)}
              color="bg-emerald-500/80"
            />
            <StatBar
              label="MP"
              value={mp}
              max={Math.max(maxMp, 1)}
              color="bg-sky-500/70"
              dimWhenZero
            />
          </div>

          {/* Per-character conditions — poison, curses, buffs.
              Sourced from the live save's SavedCharacterState.effects
              by way of the play overlay; absent in editor preview. */}
          {characterEffects.length > 0 ? (
            <section>
              <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
                Conditions
              </h3>
              <ul className="mt-1 flex flex-wrap gap-1">
                {characterEffects.map((e) => (
                  <li
                    key={e.id}
                    className="rounded border border-parchment/25 bg-ink/50 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider text-parchment/85"
                  >
                    {e.id.replace(/_/g, " ")}
                    {typeof e.duration === "number" ? (
                      <span className="ml-1 text-parchment/75">
                        {e.duration}
                      </span>
                    ) : e.duration === "permanent" ? (
                      <span className="ml-1 text-parchment/75">∞</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Combat block */}
          <section>
            <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
              Combat
            </h3>
            <table className="mt-1 w-full font-mono text-[13px]">
              <tbody>
                <tr>
                  <td className="py-0.5 pr-3 text-parchment/80">AC</td>
                  <td className="py-0.5 text-parchment/95">{ac}</td>
                </tr>
                {/* With a ranged weapon equipped the two attack modes
                    have different profiles: shooting uses the weapon's
                    real punch (1d6 + power, DEX to-hit), while swinging
                    it at an adjacent enemy is an improvised club
                    (1d4 − 1 + STR). Show both so the player can see
                    why they want a backup blade. */}
                {stats.ranged ? (
                  <>
                    <tr>
                      <td className="py-0.5 pr-3 text-parchment/80">Ranged</td>
                      <td className="py-0.5 text-parchment/95">
                        {fmtDamage(stats.ranged, weapon?.name ?? null)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-0.5 pr-3 text-parchment/80">Melee</td>
                      <td className="py-0.5 text-parchment/95">
                        {damageStr}
                        <span className="ml-1 text-parchment/55">(improvised)</span>
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td className="py-0.5 pr-3 text-parchment/80">Damage</td>
                    <td className="py-0.5 text-parchment/95">{damageStr}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* Attributes block — STR/DEX/CON/INT/WIS with mod coloring */}
          <section>
            <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
              Attributes
            </h3>
            <table className="mt-1 w-full font-mono text-[13px]">
              <tbody>
                {STAT_KEYS.map((k) => {
                  const v = (character[k] as number | undefined) ?? 10;
                  const m = abilityMod(v);
                  const colorClass =
                    m > 0
                      ? "text-emerald-400"
                      : m < 0
                        ? "text-red-400"
                        : "text-parchment/65";
                  return (
                    <tr key={k}>
                      <td className="py-0.5 pr-3 text-parchment/75">
                        {STAT_LABELS[k]}
                      </td>
                      <td className="py-0.5 pr-3 text-parchment/95">{v}</td>
                      <td className={`py-0.5 ${colorClass}`}>{fmtMod(m)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        {/* Right pane: equipped + personal items */}
        <div className="space-y-3">
          <section>
            <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
              Equipped
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              <EquipRow
                slot="Hands"
                slotKey="hands"
                itemId={handsId}
                itemById={itemById}
                durability={equippedDur.hands ?? null}
                selected={equippedSelectedSlot === "hands"}
                navFocused={
                  navState.zone === "equipped" &&
                  navState.equippedIndex === 0
                }
                onSelect={
                  onUnequipSlot
                    ? (slot) => {
                        selectEquipped(slot);
                        setNavState((cur) =>
                          reduceCharSheetNav(
                            cur,
                            { kind: "set-equipped", index: 0 },
                            navCtx,
                          ).state,
                        );
                      }
                    : undefined
                }
              />
              <EquipRow
                slot="Body"
                slotKey="body"
                itemId={bodyId}
                itemById={itemById}
                durability={equippedDur.body ?? null}
                selected={equippedSelectedSlot === "body"}
                navFocused={
                  navState.zone === "equipped" &&
                  navState.equippedIndex === 1
                }
                onSelect={
                  onUnequipSlot
                    ? (slot) => {
                        selectEquipped(slot);
                        setNavState((cur) =>
                          reduceCharSheetNav(
                            cur,
                            { kind: "set-equipped", index: 1 },
                            navCtx,
                          ).state,
                        );
                      }
                    : undefined
                }
              />
            </ul>
            {/* Magic-gear passives — pulled from every equipped slot's
                `wielder_passives` list (Sun Sword grants
                fire_resistance, future Bracers might add
                poison_immunity, etc.). Surfaces here so the player
                sees the granted passive without having to enter
                combat to discover it. Hidden when nothing's equipped
                grants a passive. */}
            {equippedPassives.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs uppercase tracking-wider text-parchment/65">
                  Grants
                </span>
                {equippedPassives.map((p) => (
                  <span
                    key={p}
                    className="rounded border border-amber-300/40 bg-amber-300/10 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wider text-amber-200/90"
                    title={`Passive granted by your equipped gear: ${prettifyPassiveId(p)}.`}
                  >
                    {prettifyPassiveId(p)}
                  </span>
                ))}
              </div>
            ) : null}
            {/* Unequip action — visible only when an equipped slot is
                selected AND that slot actually holds an item. Clicking
                fires the host handler with the slot key; the host
                moves the item back into the personal inventory and
                clears the slot. */}
            {(() => {
              if (!onUnequipSlot || !equippedSelectedSlot) return null;
              const slotId =
                equippedSelectedSlot === "hands" ? handsId : bodyId;
              if (!slotId) return null;
              return (
                <div className="mt-2 flex gap-2 text-[13px]">
                  <button
                    type="button"
                    onClick={() =>
                      onUnequipSlot(character.id, equippedSelectedSlot)
                    }
                    className="rounded border border-parchment/30 px-2 py-1 text-parchment/85 hover:bg-ink/50"
                    title="Return the equipped item to this character's personal inventory."
                  >
                    Unequip
                  </button>
                </div>
              );
            })()}
          </section>

          <section>
            <h3 className="text-[13px] uppercase tracking-wide text-amber-300">
              Personal Items
            </h3>
            {personalItems.length === 0 ? (
              <p className="mt-1 text-sm text-parchment/65">(none)</p>
            ) : (
              <ul
                className="mt-1 space-y-0.5 text-sm"
                role="listbox"
                aria-label="Personal items"
              >
                {personalItems.map((entry, i) => {
                  const id =
                    typeof entry.item === "string" ? entry.item : null;
                  const def = id ? itemById.get(id) ?? null : null;
                  const label = def?.name ?? id ?? "(unknown)";
                  // Quantity badge mirrors the stash list: only show
                  // a count when the catalog flags the item stackable
                  // AND the stack has more than one copy. Non-
                  // stackable items show as just the name.
                  const qty =
                    def?.stackable && typeof entry.charges === "number"
                      ? entry.charges
                      : 1;
                  const qtyLabel = qty > 1 ? ` (${qty})` : "";
                  // Durability bar — only for non-stackable gear whose
                  // catalog defines a positive max. Reads the per-
                  // instance value off the inventory entry (so a worn
                  // sword shows partial wear), falling back to the
                  // catalog max for a fresh item with no stored value.
                  const durMax = def?.durability ?? 0;
                  const showDur = !def?.stackable && durMax > 0;
                  const durCur = showDur
                    ? (typeof entry.durability === "number"
                        ? entry.durability
                        : durMax)
                    : 0;
                  const isSel = i === personalSelectedIndex;
                  // When no host handlers are wired, fall back to
                  // the original static `<li>` rendering — preserves
                  // the editor preview's read-only behavior.
                  const interactive =
                    !!onUsePersonalItem || !!onReturnPersonalItem;
                  if (!interactive) {
                    return (
                      <li
                        key={`${id ?? "_"}-${i}`}
                        className="flex items-center justify-between gap-2 text-parchment/85"
                      >
                        <span className="truncate">
                          {label}
                          {qtyLabel}
                        </span>
                        {showDur ? (
                          <DurabilityBar current={durCur} max={durMax} />
                        ) : null}
                      </li>
                    );
                  }
                  const isNavFocused =
                    navState.zone === "personal" &&
                    navState.personalIndex === i;
                  return (
                    <li key={`${id ?? "_"}-${i}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        data-nav-focused={isNavFocused ? "true" : undefined}
                        onClick={() => {
                          selectPersonal(i);
                          setNavState((cur) =>
                            reduceCharSheetNav(
                              cur,
                              { kind: "set-personal", index: i },
                              navCtx,
                            ).state,
                          );
                        }}
                        className={[
                          "flex w-full items-center justify-between gap-2 rounded border px-2 py-0.5 text-left",
                          isSel
                            ? "border-ember/60 bg-ember/15 text-parchment"
                            : "border-transparent text-parchment/85 hover:bg-ink/50",
                        ].join(" ")}
                        title={def?.description ?? "Click to select"}
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
            )}
            {/* Action row for the selected personal item. Only
                visible when at least one host handler is wired AND
                the cursor points at a real row. Buttons gate
                individually: Use shows only when the item is
                catalog-flagged usable. */}
            {(() => {
              if (personalSelectedIndex == null) return null;
              const entry = personalItems[personalSelectedIndex];
              if (!entry) return null;
              const id =
                typeof entry.item === "string" ? entry.item : null;
              const def = id ? itemById.get(id) ?? null : null;
              const canUse = !!onUsePersonalItem && !!def?.usable;
              const canReturn = !!onReturnPersonalItem;
              const equipTarget = equipSlotFor(def);
              const canEquip =
                !!onEquipPersonalItem && equipTarget !== null;
              if (!canUse && !canReturn && !canEquip) return null;
              return (
                <div className="mt-2 flex gap-2 text-[13px]">
                  {canUse ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUsePersonalItem?.(
                          character.id,
                          personalSelectedIndex,
                        )
                      }
                      className="rounded border border-ember/60 bg-ember/20 px-2 py-1 text-parchment hover:bg-ember/40"
                      title={`Use ${def?.name ?? id}.`}
                    >
                      Use
                    </button>
                  ) : null}
                  {canEquip ? (
                    <button
                      type="button"
                      onClick={() =>
                        onEquipPersonalItem?.(
                          character.id,
                          personalSelectedIndex,
                        )
                      }
                      className="rounded border border-ember/60 bg-ember/20 px-2 py-1 text-parchment hover:bg-ember/40"
                      title={`Equip in the ${equipTarget} slot. Any item currently equipped there moves back to the inventory.`}
                    >
                      Equip
                    </button>
                  ) : null}
                  {canReturn ? (
                    <button
                      type="button"
                      onClick={() =>
                        onReturnPersonalItem?.(
                          character.id,
                          personalSelectedIndex,
                        )
                      }
                      className="rounded border border-parchment/30 px-2 py-1 text-parchment/85 hover:bg-ink/50"
                      title="Move one back to the shared stash."
                    >
                      Return to stash
                    </button>
                  ) : null}
                </div>
              );
            })()}
          </section>

          {!onUsePersonalItem && !onReturnPersonalItem ? (
            <p className="text-xs text-parchment/65">
              Read-only preview. The play-time sheet lets the player
              Use or Return-to-stash personal items.
            </p>
          ) : null}
        </div>
      </div>

      {/* Abilities + Spells — full-width below the two-pane block.
          Each section lists everything granted to / known by the
          character; rows whose `usable_in` includes "party" get a
          Use / Cast button that flashes a preview-only confirmation
          (no state mutation in this pass). */}
      <div className="grid gap-3 md:grid-cols-2">
        <AbilitySection
          title="Race Abilities"
          rows={raceAbilities}
          emptyHint={`${raceName} grants no listed abilities.`}
          cooldowns={abilityCooldowns}
          sectionFocused={navState.zone === "race-abilities"}
          focusedIndex={navState.raceIndex}
          onRowFocus={(i) =>
            setNavState((s) =>
              reduceCharSheetNav(s, { kind: "set-race", index: i }, navCtx)
                .state,
            )
          }
          onUse={(a) => {
            // Real handler wins when the host provides one (live
            // play overlay); editor preview falls through to the
            // local "preview only" flash. The host decides whether
            // to route to a picker, surface a "do this elsewhere"
            // hint, or no-op.
            if (onUseAbility) onUseAbility(character.id, a);
            else setLastAction(`Used ${a.name ?? a.id} — preview only.`);
          }}
        />
        <AbilitySection
          title="Class Abilities"
          rows={classAbilities}
          emptyHint={`${className} grants no abilities at level ${level}.`}
          cooldowns={abilityCooldowns}
          sectionFocused={navState.zone === "class-abilities"}
          focusedIndex={navState.classIndex}
          onRowFocus={(i) =>
            setNavState((s) =>
              reduceCharSheetNav(s, { kind: "set-class", index: i }, navCtx)
                .state,
            )
          }
          onUse={(a) => {
            if (onUseAbility) onUseAbility(character.id, a);
            else setLastAction(`Used ${a.name ?? a.id} — preview only.`);
          }}
        />
      </div>

      <section>
        <h3
          className={[
            "text-[13px] uppercase tracking-wide pl-2 -ml-2 border-l-2",
            navState.zone === "spells"
              ? "border-amber-200 text-amber-200"
              : "border-transparent text-amber-300/80",
          ].join(" ")}
        >
          {navState.zone === "spells" ? "▸ " : ""}Spells
        </h3>
        {knownSpells.length === 0 ? (
          <p className="mt-1 text-sm text-parchment/65">
            {klass?.casting_type && klass.casting_type.includes("none")
              ? "Not a spellcaster."
              : `No spells known at level ${level}.`}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {knownSpells.map((s, i) => (
              <SpellRow
                key={s.id}
                spell={s}
                focused={
                  navState.zone === "spells" && navState.spellIndex === i
                }
                onFocus={() =>
                  setNavState((cur) =>
                    reduceCharSheetNav(
                      cur,
                      { kind: "set-spell", index: i },
                      navCtx,
                    ).state,
                  )
                }
                onCast={() => {
                  // Fire the host-side handler first — if a real
                  // handler is wired (PlayPartyScreenOverlay) it
                  // mutates the save, opens a target picker, etc.
                  // Either way, leave a one-line preview message
                  // behind so the player sees feedback for spells
                  // whose host-side handler hasn't been written
                  // yet (e.g., Knock, Push).
                  onCastSpell?.(character.id, s.id);
                  setLastAction(
                    onCastSpell
                      ? `Casting ${s.name ?? s.id}…`
                      : `Cast ${s.name ?? s.id} — preview only (MP ${
                          s.mp_cost ?? 0
                        }).`,
                  );
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Transient action feedback line. Empty by default; populates
          on Use / Cast clicks. */}
      {lastAction ? (
        <p className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1 text-[13px] text-amber-200/90">
          {lastAction}
        </p>
      ) : null}

      {/* Bottom hint bar (cosmetic — keys aren't bound in this pass) */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-xs uppercase tracking-wider text-parchment/65">
        [↑↓] select · [Enter] equip / unequip · [R] return to stash · [1-4]
        switch character · [ESC] back · [P] close
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function EquipRow({
  slot,
  slotKey,
  itemId,
  itemById,
  durability,
  selected,
  navFocused = false,
  onSelect,
}: {
  /** Label rendered on the left ("Hands", "Body"). */
  slot: string;
  /** Slot id used by the data model ("hands", "body"). Passed back
   *  to `onSelect` so the host can pick the right slot to mutate. */
  slotKey: string;
  itemId: string | undefined;
  itemById: ReadonlyMap<string, SheetItemRef>;
  /** Remaining durability for the item currently in this slot.
   *  `null` (or `undefined`) means "uninitialised" — render the bar
   *  at full when the item itself has a catalog max, or omit the bar
   *  entirely for indestructible items. */
  durability?: number | null;
  /** True when this row is the current selection (host highlights it
   *  + reveals the Unequip action). */
  selected?: boolean;
  /** True when the keyboard nav cursor is on this slot. Drives the
   *  `data-nav-focused` attribute used by the sheet's auto-scroll
   *  effect — kept separate from `selected` so a click that selects
   *  a slot without engaging the keyboard cursor doesn't trigger a
   *  scroll. (In practice `selected` and this flag track 1:1, but
   *  keeping them distinct makes the contract explicit.) */
  navFocused?: boolean;
  /** Optional click handler. When provided the row renders as a
   *  button (click to select); when omitted the row is static and
   *  shows the legacy highlight strip on the first slot only. */
  onSelect?: (slotKey: string) => void;
}) {
  const def = itemId ? itemById.get(itemId) ?? null : null;
  const label = def?.name ?? itemId ?? "(empty)";
  // Durability max from the catalog. 0 / absent means indestructible
  // — no bar gets painted. The per-slot current value falls back to
  // max when uninitialised (a freshly-equipped item reads full).
  const durMax = def?.durability ?? 0;
  const showDur = !!itemId && durMax > 0;
  const durCur = showDur
    ? (typeof durability === "number" ? durability : durMax)
    : 0;
  const rowClass = [
    "grid grid-cols-[80px_1fr_auto] items-baseline gap-2 rounded px-2 py-0.5 text-left w-full",
    selected
      ? "border-l-2 border-ember/70 bg-ember/15 text-parchment"
      : "border-l-2 border-transparent",
  ].join(" ");
  const content = (
    <>
      <span className="text-parchment/85">{slot}</span>
      <span className="truncate text-parchment/95">{label}</span>
      <span className="justify-self-end">
        {showDur ? <DurabilityBar current={durCur} max={durMax} /> : null}
      </span>
    </>
  );
  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          role="option"
          aria-selected={selected}
          data-nav-focused={navFocused ? "true" : undefined}
          onClick={() => onSelect(slotKey)}
          className={`${rowClass} hover:bg-ink/50`}
        >
          {content}
        </button>
      </li>
    );
  }
  return <li className={rowClass}>{content}</li>;
}

function StatBar({
  label,
  value,
  max,
  color,
  dimWhenZero,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  dimWhenZero?: boolean;
}) {
  const isZero = value === 0 && max <= 1;
  const pct = isZero ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={`w-8 font-display text-sm ${
          dimWhenZero && isZero ? "text-parchment/55" : "text-amber-300"
        }`}
      >
        {label}
      </span>
      <span className="relative h-2 flex-1 overflow-hidden rounded bg-ink/70">
        <span
          className={`block h-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`font-mono text-[13px] ${
          dimWhenZero && isZero ? "text-parchment/55" : "text-parchment/80"
        }`}
      >
        {value} / {max <= 1 && value === 0 ? 0 : max}
      </span>
    </div>
  );
}

// ── Abilities & spells ─────────────────────────────────────────────

function AbilitySection({
  title,
  rows,
  emptyHint,
  onUse,
  cooldowns,
  focusedIndex,
  sectionFocused = false,
  onRowFocus,
}: {
  title: string;
  rows: ReadonlyArray<PartyAbilityRef>;
  emptyHint: string;
  onUse: (a: PartyAbilityRef) => void;
  /** Optional cooldown labels keyed by ability id — when an entry
   *  exists the button is rendered disabled with the label so the
   *  player sees the gate without clicking. */
  cooldowns?: ReadonlyMap<string, string>;
  /** Index of the row the keyboard cursor is pointing at, or -1
   *  when the cursor is somewhere else. Only renders a focus ring
   *  when `sectionFocused` is true (i.e., this section's zone owns
   *  the cursor) — keeps the visual ring from showing on whichever
   *  section was last navigated when focus has moved on. */
  focusedIndex?: number;
  /** True iff this section's zone (race-abilities OR class-abilities)
   *  is the active keyboard zone. Drives the section header's
   *  amber-bar focus indicator + which row shows the cursor ring. */
  sectionFocused?: boolean;
  /** Click handler — clicking a row's body (not the Use button)
   *  parks the keyboard cursor on this section + row. Optional so
   *  read-only editor previews can omit it. */
  onRowFocus?: (index: number) => void;
}) {
  return (
    <section>
      <h3
        className={[
          "text-[13px] uppercase tracking-wide pl-2 -ml-2 border-l-2",
          sectionFocused
            ? "border-amber-200 text-amber-200"
            : "border-transparent text-amber-300/80",
        ].join(" ")}
      >
        {sectionFocused ? "▸ " : ""}{title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-parchment/65">{emptyHint}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((a, i) => {
            const usable = (a.usable_in ?? []).includes("party");
            const cooldownLabel = cooldowns?.get(a.id);
            const isFocused = sectionFocused && i === focusedIndex;
            return (
              <li
                key={a.id}
                onClick={() => onRowFocus?.(i)}
                data-nav-focused={isFocused ? "true" : undefined}
                className={[
                  "rounded border bg-ink/30 px-2 py-1 transition-colors",
                  isFocused
                    ? "border-ember/70 ring-1 ring-ember/40"
                    : "border-parchment/10",
                  onRowFocus ? "cursor-pointer" : "",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-parchment/95">
                    {a.name ?? a.id}
                  </span>
                  {usable ? (
                    cooldownLabel ? (
                      // On cooldown — keep the button shape so the
                      // layout doesn't shift, but disable the click
                      // and dim it. The label tells the player why
                      // (e.g. "Used today"). Hovering shows the
                      // same label via `title` for accessibility.
                      <button
                        type="button"
                        disabled
                        title={cooldownLabel}
                        className="rounded border border-parchment/15 bg-ink/20 px-2 py-0.5 text-xs text-parchment/65 cursor-not-allowed"
                      >
                        {cooldownLabel}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUse(a)}
                        className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50"
                      >
                        Use
                      </button>
                    )
                  ) : (
                    <span className="text-xs uppercase tracking-wider text-parchment/55">
                      {(a.usable_in ?? []).includes("battle")
                        ? "Combat"
                        : "Passive"}
                    </span>
                  )}
                </div>
                {a.description ? (
                  <p className="mt-0.5 text-xs text-parchment/80">
                    {a.description}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SpellRow({
  spell,
  onCast,
  focused = false,
  onFocus,
}: {
  spell: PartySpellRef;
  onCast: () => void;
  /** True iff the keyboard cursor is on this row. Drives an ember
   *  ring on the row so the player can see what Enter would Cast. */
  focused?: boolean;
  /** Optional click handler — clicking the row body (not the Cast
   *  button) parks the keyboard cursor here. */
  onFocus?: () => void;
}) {
  const usable = (spell.usable_in ?? []).includes("party");
  return (
    <li
      onClick={onFocus}
      data-nav-focused={focused ? "true" : undefined}
      className={[
        "rounded border bg-ink/30 px-2 py-1 transition-colors",
        focused
          ? "border-ember/70 ring-1 ring-ember/40"
          : "border-parchment/10",
        onFocus ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-parchment/95">
          {spell.name ?? spell.id}
          <span className="ml-2 font-mono text-xs text-parchment/65">
            MP {spell.mp_cost ?? 0}
            {spell.casting_type ? ` · ${spell.casting_type}` : ""}
            {spell.min_level ? ` · L${spell.min_level}+` : ""}
          </span>
        </span>
        {usable ? (
          <button
            type="button"
            onClick={onCast}
            className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50"
          >
            Cast
          </button>
        ) : (
          <span className="text-xs uppercase tracking-wider text-parchment/55">
            {(spell.usable_in ?? []).includes("battle")
              ? "Combat"
              : "—"}
          </span>
        )}
      </div>
      {spell.description ? (
        <p className="mt-0.5 text-xs text-parchment/80">
          {spell.description}
        </p>
      ) : null}
    </li>
  );
}
