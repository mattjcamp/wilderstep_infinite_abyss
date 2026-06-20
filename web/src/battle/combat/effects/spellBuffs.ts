/**
 * Spell → buff definitions. The single source of truth for what each
 * status spell's `effect_type` DOES: which numeric buff/debuff kind(s)
 * it confers, the source label (drives the expiry flavour line + the
 * scene's source-keyed visuals like Invisibility's alpha), the per-mod
 * default magnitude, and a default duration.
 *
 * Previously this mapping was hardcoded inline in the CombatScene's
 * per-spell cast branches — each branch reaching for `addBuff` with a
 * literal `kind` / `source`. Centralising it here is the last piece of
 * the effect-decoupling work (see
 * `docs/dev_guides/effect_decoupling_proposal.md`): the scene now just
 * asks the engine to apply "bless" / "curse" / … and keeps only its
 * animation + log copy. Any other applier (a monster that casts Bless,
 * an item) can reuse the same definitions.
 *
 * The buffs themselves are stored as `stat_modifier` effects in the
 * unified `Combatant.effects` list (see `buffEffects.ts`).
 */

import type { Buff, BuffKind } from "../Buffs";

interface SpellBuffMod {
  kind: BuffKind;
  /** Key read off the spell's `effect_value` for the magnitude. */
  valueKey: string;
  /** Magnitude when the spell record doesn't specify one. */
  fallback: number;
}

interface SpellBuffDef {
  /** Buff `source` tag — e.g. "Bless" (drives expiry copy + visuals). */
  source: string;
  /** Duration when the spell record doesn't specify one. */
  defaultTurns: number;
  /** One or more numeric modifiers the spell confers (Curse has two). */
  mods: SpellBuffMod[];
}

/** Keyed by spell `effect_type`. */
const SPELL_BUFFS: Record<string, SpellBuffDef> = {
  bless: {
    source: "Bless",
    defaultTurns: 4,
    mods: [{ kind: "attack_bonus", valueKey: "attack_bonus", fallback: 2 }],
  },
  ac_buff: {
    source: "Shield",
    defaultTurns: 3,
    mods: [{ kind: "ac_bonus", valueKey: "ac_bonus", fallback: 1 }],
  },
  curse: {
    source: "Curse",
    defaultTurns: 4,
    mods: [
      { kind: "attack_penalty", valueKey: "attack_penalty", fallback: 2 },
      { kind: "ac_penalty", valueKey: "ac_penalty", fallback: 2 },
    ],
  },
  range_buff: {
    source: "Long Shanks",
    defaultTurns: 3,
    mods: [{ kind: "range_bonus", valueKey: "range_bonus", fallback: 4 }],
  },
  invisibility: {
    source: "Invisibility",
    defaultTurns: 3,
    mods: [{ kind: "ac_bonus", valueKey: "ac_bonus", fallback: 6 }],
  },
};

/** Whether `effectType` is a recognised status-buff spell. */
export function isSpellBuff(effectType: string): boolean {
  return effectType in SPELL_BUFFS;
}

/**
 * Build the concrete `Buff[]` a status spell confers — reading
 * magnitudes off `effectValue` (with per-mod fallbacks) and resolving
 * the duration (spell `duration` → the definition's default). Pure:
 * returns the buffs to apply; the caller adds them. Returns `[]` for an
 * unrecognised `effectType`.
 */
export function spellBuffsFor(
  effectType: string,
  effectValue: Record<string, unknown> | undefined,
  duration: number | string | undefined,
): Buff[] {
  const def = SPELL_BUFFS[effectType];
  if (!def) return [];
  const turns = typeof duration === "number" ? duration : def.defaultTurns;
  return def.mods.map((m) => {
    const raw = effectValue?.[m.valueKey];
    return {
      kind: m.kind,
      value: typeof raw === "number" ? raw : m.fallback,
      turnsLeft: turns,
      source: def.source,
    };
  });
}
