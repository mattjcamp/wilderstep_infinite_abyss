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

import { useEffect, useState } from "react";
import type {
  PartyAbilityRef,
  PartyCharacterRef,
  PartyClassRef,
  PartyItemRef,
  PartyRaceRef,
  PartySpellRef,
} from "./PartyScreen";
import { resolveSpritePath } from "./spriteFields";

const SPRITE_CONFIG = { category: "person", format: "path" } as const;

/** Item shape with the combat-relevant fields the sheet reads. The
 *  catalog passes more — this interface just narrows what the sim
 *  consumes so callers can pass loose records. */
export interface SheetItemRef extends PartyItemRef {
  category?: string;
  power?: number;
  ranged?: boolean;
  slots?: string[];
  evasion?: number;
  ac_bonus?: number;
  bonus_damage?: number;
  damage_type?: string;
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

/** D&D-style ability modifier (10 = 0, 18 = +4, 8 = -1, …). */
function abilityMod(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

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

/** Power-tier damage dice — direct port of v1 CombatBridge. */
function damageForWeapon(
  member: PartyCharacterRef,
  weapon: SheetItemRef | null,
): DamageRoll {
  if (!weapon || typeof weapon.power !== "number") {
    return { dice: 0, sides: 0, bonus: 1 };
  }
  const isRanged = !!weapon.ranged;
  const statMod = isRanged
    ? abilityMod(member.dexterity ?? 10)
    : abilityMod(member.strength ?? 10);
  const wp = weapon.power;
  if (wp <= 0) return { dice: 0, sides: 0, bonus: 1 };
  if (wp === 1) return { dice: 1, sides: 4, bonus: statMod - 1 };
  if (wp <= 3) return { dice: 1, sides: 4, bonus: statMod };
  if (wp <= 5) return { dice: 1, sides: 6, bonus: statMod };
  if (wp <= 8) return { dice: 1, sides: 8, bonus: statMod };
  return { dice: 1, sides: 10, bonus: statMod };
}

function fmtDamage(d: DamageRoll, weaponName: string | null): string {
  if (d.dice === 0) return `${d.bonus}${weaponName ? ` (${weaponName})` : ""}`;
  const sign = d.bonus === 0 ? "" : d.bonus > 0 ? ` +${d.bonus}` : ` ${d.bonus}`;
  return `${d.dice}d${d.sides}${sign}${weaponName ? ` (${weaponName})` : ""}`;
}

/** AC = 10 + DEX_mod + armor.evasion-derived bonus + Σ ac_bonus on
 *  any equipped item. Mirrors v1 (`(evasion - 50) / 5`). Cloth's
 *  evasion = 50 → 0, matches the screenshot. */
function computeAc(
  member: PartyCharacterRef,
  itemById: ReadonlyMap<string, SheetItemRef>,
): number {
  const equipped = (member.equipped ?? {}) as Record<string, string>;
  const dexMod = abilityMod(member.dexterity ?? 10);
  const bodyId = equipped.body;
  const body = bodyId ? itemById.get(bodyId) ?? null : null;
  const evasion = body && typeof body.evasion === "number" ? body.evasion : 50;
  const armorBonus = Math.floor((evasion - 50) / 5);
  let acBonusTotal = 0;
  for (const slotId of Object.values(equipped)) {
    const it = slotId ? itemById.get(slotId) ?? null : null;
    if (it?.ac_bonus) acBonusTotal += it.ac_bonus;
  }
  return 10 + dexMod + armorBonus + acBonusTotal;
}

/** XP threshold to the NEXT level — race-specific overrides apply
 *  (Humans level faster at 1125, others 1500). */
function xpForNextLevel(
  member: PartyCharacterRef,
  race?: PartyRaceRef,
): number {
  const base = race?.exp_per_level ?? 1500;
  return (member.level ?? 1) * base;
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
  // Spell is castable when:
  //   - the class's casting_type[] includes the spell's casting_type
  //   - character.level >= per-class override OR global min_level
  const knownSpells: PartySpellRef[] = (klass?.casting_type
    ? spells.filter((s) => {
        if (!s.casting_type) return false;
        if (!klass.casting_type!.includes(s.casting_type)) return false;
        const gate =
          s.class_min_levels?.[klass.id] ?? s.min_level ?? 1;
        return (character.level ?? 1) >= gate;
      })
    : []) as PartySpellRef[];

  // ── Last-used feedback line (preview-only) ───────────────────────
  // Click an ability/spell button → flash a confirmation here. No
  // state mutation, no targeting picker; real mechanics land when
  // the runtime is ready.
  const [lastAction, setLastAction] = useState<string | null>(null);

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
  const weapon: SheetItemRef | null =
    handsId && itemById.get(handsId)?.category === "weapons"
      ? itemById.get(handsId) ?? null
      : null;

  const ac = computeAc(character, itemById);
  const damage = damageForWeapon(character, weapon);
  const damageStr = fmtDamage(damage, weapon?.name ?? null);

  const hp = character.hp ?? 0;
  const mp = character.mp ?? 0;
  const exp = character.exp ?? 0;
  const xpNext = xpForNextLevel(character, race);
  const level = character.level ?? 1;

  const portrait = character.sprite
    ? resolveSpritePath(character.sprite, SPRITE_CONFIG)
    : null;

  const personalItems = Array.isArray(character.inventory)
    ? (character.inventory as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-parchment/15 bg-ink/40 p-3 text-parchment/90">
      {/* Title bar — character name + class • race • level */}
      <div className="flex items-center justify-between gap-2 border-b border-parchment/15 pb-1">
        <div className="flex-1 text-center font-display text-base uppercase tracking-[0.25em] text-amber-300">
          {character.name} <span className="text-parchment/40">—</span>{" "}
          {className}
          <span className="text-parchment/40"> • </span>
          {raceName}
          <span className="text-parchment/40"> • </span>
          Lvl {level}
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
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
              <div className="text-xs text-parchment/65">
                {className} <span className="text-parchment/40">•</span>{" "}
                {raceName}
                {character.gender ? (
                  <>
                    {" "}
                    <span className="text-parchment/40">•</span>{" "}
                    {character.gender}
                  </>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-parchment/55">
                Level {level} <span className="text-parchment/35">•</span> EXP{" "}
                {exp} / {xpNext}
              </div>
            </div>
          </div>

          {/* HP + MP bars */}
          <div className="space-y-1.5">
            <StatBar
              label="HP"
              value={hp}
              max={Math.max(hp, 1)}
              color="bg-emerald-500/80"
            />
            <StatBar
              label="MP"
              value={mp}
              max={Math.max(mp, 1)}
              color="bg-sky-500/70"
              dimWhenZero
            />
          </div>

          {/* Combat block */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Combat
            </h3>
            <table className="mt-1 w-full font-mono text-xs">
              <tbody>
                <tr>
                  <td className="py-0.5 pr-3 text-parchment/65">AC</td>
                  <td className="py-0.5 text-parchment/95">{ac}</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-3 text-parchment/65">Damage</td>
                  <td className="py-0.5 text-parchment/95">{damageStr}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Attributes block — STR/DEX/CON/INT/WIS with mod coloring */}
          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Attributes
            </h3>
            <table className="mt-1 w-full font-mono text-xs">
              <tbody>
                {STAT_KEYS.map((k) => {
                  const v = (character[k] as number | undefined) ?? 10;
                  const m = abilityMod(v);
                  const colorClass =
                    m > 0
                      ? "text-emerald-400"
                      : m < 0
                        ? "text-red-400"
                        : "text-parchment/45";
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
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Equipped
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              <EquipRow
                slot="Hands"
                slotKey="hands"
                itemId={handsId}
                itemById={itemById}
                selected={equippedSelectedSlot === "hands"}
                onSelect={onUnequipSlot ? selectEquipped : undefined}
              />
              <EquipRow
                slot="Body"
                slotKey="body"
                itemId={bodyId}
                itemById={itemById}
                selected={equippedSelectedSlot === "body"}
                onSelect={onUnequipSlot ? selectEquipped : undefined}
              />
            </ul>
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
                <div className="mt-2 flex gap-2 text-xs">
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
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Personal Items
            </h3>
            {personalItems.length === 0 ? (
              <p className="mt-1 text-sm text-parchment/45">(none)</p>
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
                        className="text-parchment/85"
                      >
                        {label}
                        {qtyLabel}
                      </li>
                    );
                  }
                  return (
                    <li key={`${id ?? "_"}-${i}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => selectPersonal(i)}
                        className={[
                          "flex w-full items-center justify-between rounded border px-2 py-0.5 text-left",
                          isSel
                            ? "border-ember/60 bg-ember/15 text-parchment"
                            : "border-transparent text-parchment/85 hover:bg-ink/50",
                        ].join(" ")}
                        title={def?.description ?? "Click to select"}
                      >
                        <span className="truncate">{label}</span>
                        <span className="ml-2 shrink-0 text-xs text-parchment/55">
                          {qty > 1 ? `(${qty})` : ""}
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
                <div className="mt-2 flex gap-2 text-xs">
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
            <p className="text-[11px] text-parchment/45">
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
          onUse={(a) =>
            setLastAction(`Used ${a.name ?? a.id} — preview only.`)
          }
        />
        <AbilitySection
          title="Class Abilities"
          rows={classAbilities}
          emptyHint={`${className} grants no abilities at level ${level}.`}
          onUse={(a) =>
            setLastAction(`Used ${a.name ?? a.id} — preview only.`)
          }
        />
      </div>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-amber-300">
          Spells
        </h3>
        {knownSpells.length === 0 ? (
          <p className="mt-1 text-sm text-parchment/45">
            {klass?.casting_type && klass.casting_type.includes("none")
              ? "Not a spellcaster."
              : `No spells known at level ${level}.`}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {knownSpells.map((s) => (
              <SpellRow
                key={s.id}
                spell={s}
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
        <p className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1 text-xs text-amber-200/90">
          {lastAction}
        </p>
      ) : null}

      {/* Bottom hint bar (cosmetic — keys aren't bound in this pass) */}
      <div className="border-t border-parchment/15 pt-1 text-center font-mono text-[10px] uppercase tracking-wider text-parchment/45">
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
  selected,
  onSelect,
}: {
  /** Label rendered on the left ("Hands", "Body"). */
  slot: string;
  /** Slot id used by the data model ("hands", "body"). Passed back
   *  to `onSelect` so the host can pick the right slot to mutate. */
  slotKey: string;
  itemId: string | undefined;
  itemById: ReadonlyMap<string, SheetItemRef>;
  /** True when this row is the current selection (host highlights it
   *  + reveals the Unequip action). */
  selected?: boolean;
  /** Optional click handler. When provided the row renders as a
   *  button (click to select); when omitted the row is static and
   *  shows the legacy highlight strip on the first slot only. */
  onSelect?: (slotKey: string) => void;
}) {
  const def = itemId ? itemById.get(itemId) ?? null : null;
  const label = def?.name ?? itemId ?? "(empty)";
  const rowClass = [
    "grid grid-cols-[80px_1fr] items-baseline gap-2 rounded px-2 py-0.5 text-left w-full",
    selected
      ? "border-l-2 border-ember/70 bg-ember/15 text-parchment"
      : "border-l-2 border-transparent",
  ].join(" ");
  if (onSelect) {
    return (
      <li>
        <button
          type="button"
          role="option"
          aria-selected={selected}
          onClick={() => onSelect(slotKey)}
          className={`${rowClass} hover:bg-ink/50`}
        >
          <span className="text-parchment/70">{slot}</span>
          <span className="text-parchment/95">{label}</span>
        </button>
      </li>
    );
  }
  return (
    <li className={rowClass}>
      <span className="text-parchment/70">{slot}</span>
      <span className="text-parchment/95">{label}</span>
    </li>
  );
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
          dimWhenZero && isZero ? "text-parchment/35" : "text-amber-300"
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
        className={`font-mono text-xs ${
          dimWhenZero && isZero ? "text-parchment/35" : "text-parchment/80"
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
}: {
  title: string;
  rows: ReadonlyArray<PartyAbilityRef>;
  emptyHint: string;
  onUse: (a: PartyAbilityRef) => void;
}) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wide text-amber-300">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-parchment/45">{emptyHint}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((a) => {
            const usable = (a.usable_in ?? []).includes("party");
            return (
              <li
                key={a.id}
                className="rounded border border-parchment/10 bg-ink/30 px-2 py-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-parchment/95">
                    {a.name ?? a.id}
                  </span>
                  {usable ? (
                    <button
                      type="button"
                      onClick={() => onUse(a)}
                      className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[11px] text-parchment hover:bg-ember/50"
                    >
                      Use
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-parchment/35">
                      {(a.usable_in ?? []).includes("battle")
                        ? "Combat"
                        : "Passive"}
                    </span>
                  )}
                </div>
                {a.description ? (
                  <p className="mt-0.5 text-[11px] text-parchment/65">
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
}: {
  spell: PartySpellRef;
  onCast: () => void;
}) {
  const usable = (spell.usable_in ?? []).includes("party");
  return (
    <li className="rounded border border-parchment/10 bg-ink/30 px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-parchment/95">
          {spell.name ?? spell.id}
          <span className="ml-2 font-mono text-[10px] text-parchment/45">
            MP {spell.mp_cost ?? 0}
            {spell.casting_type ? ` · ${spell.casting_type}` : ""}
            {spell.min_level ? ` · L${spell.min_level}+` : ""}
          </span>
        </span>
        {usable ? (
          <button
            type="button"
            onClick={onCast}
            className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-[11px] text-parchment hover:bg-ember/50"
          >
            Cast
          </button>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-parchment/35">
            {(spell.usable_in ?? []).includes("battle")
              ? "Combat"
              : "—"}
          </span>
        )}
      </div>
      {spell.description ? (
        <p className="mt-0.5 text-[11px] text-parchment/65">
          {spell.description}
        </p>
      ) : null}
    </li>
  );
}
