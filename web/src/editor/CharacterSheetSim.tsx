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

import type {
  PartyCharacterRef,
  PartyClassRef,
  PartyItemRef,
  PartyRaceRef,
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
  onBack,
}: {
  character: PartyCharacterRef;
  classes: ReadonlyArray<PartyClassRef>;
  races: ReadonlyArray<PartyRaceRef>;
  items: ReadonlyArray<SheetItemRef>;
  /** Optional Back button — shown when present. Lets the Party screen
   *  drill-in / drill-out, while standalone hosts can omit it. */
  onBack?: () => void;
}) {
  const className =
    classes.find((c) => c.id === character.class)?.name ?? character.class;
  const raceName =
    races.find((r) => r.id === character.race)?.name ?? character.race;
  const race = races.find((r) => r.id === character.race);
  const itemById = new Map(items.map((it) => [it.id, it]));

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
                itemId={handsId}
                itemById={itemById}
                highlight
              />
              <EquipRow slot="Body" itemId={bodyId} itemById={itemById} />
            </ul>
          </section>

          <section>
            <h3 className="text-xs uppercase tracking-wide text-amber-300">
              Personal Items
            </h3>
            {personalItems.length === 0 ? (
              <p className="mt-1 text-sm text-parchment/45">(none)</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {personalItems.map((entry, i) => {
                  const id =
                    typeof entry.item === "string" ? entry.item : null;
                  const def = id ? itemById.get(id) ?? null : null;
                  const label = def?.name ?? id ?? "(unknown)";
                  const charges =
                    typeof entry.charges === "number"
                      ? ` (${entry.charges})`
                      : "";
                  return (
                    <li
                      key={`${id ?? "_"}-${i}`}
                      className="text-parchment/85"
                    >
                      {label}
                      {charges}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="text-[11px] text-parchment/45">
            Read-only preview. The in-game sheet allows{" "}
            <kbd className="rounded border border-parchment/30 px-1 font-mono">
              Enter
            </kbd>{" "}
            to unequip and{" "}
            <kbd className="rounded border border-parchment/30 px-1 font-mono">
              R
            </kbd>{" "}
            to return an item to the stash; those actions land when the
            game-side P screen is wired up.
          </p>
        </div>
      </div>

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
  itemId,
  itemById,
  highlight,
}: {
  slot: string;
  itemId: string | undefined;
  itemById: ReadonlyMap<string, SheetItemRef>;
  /** When true, render with a left-side accent strip — used to echo
   *  v1's selected-row highlight on the first slot. Purely visual. */
  highlight?: boolean;
}) {
  const def = itemId ? itemById.get(itemId) ?? null : null;
  const label = def?.name ?? itemId ?? "(empty)";
  return (
    <li
      className={[
        "grid grid-cols-[80px_1fr] items-baseline gap-2 rounded px-2 py-0.5",
        highlight
          ? "border-l-2 border-ember/70 bg-ink/50"
          : "border-l-2 border-transparent",
      ].join(" ")}
    >
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
