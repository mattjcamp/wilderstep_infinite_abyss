/**
 * Spells loader — reads v2's module-scoped spells.json natively.
 *
 * v2 differences (these are the canonical model now):
 *   - `casting_type` is a single string (`"sorcerer"` / `"priest"`),
 *     not an array. Class eligibility comes from matching this against
 *     the class's `casting_type[]` list (Druid: ["sorcerer","priest"]).
 *   - `allowable_classes` is GONE — derived from casting_type + classes.
 *     Helpers that need class eligibility now take a ClassTemplate ref
 *     instead of a class-name string.
 *   - The effect descriptor split: v1 stored `effect_type` (e.g. "heal",
 *     "bless") + `effect_value` flat on the spell. v2 uses `action`
 *     (the discriminator) + `action_params` (the bag). The mapping is:
 *
 *       v1 effect_type === "heal"             ↔  v2 action === "heal"
 *       v1 effect_type === "bless"            ↔  v2 action === "apply_effect", params.effect_id === "bless"
 *       v1 effect_type === "fireball"         ↔  v2 action === "aoe_damage"
 *       etc.
 *
 *     The Spell type below carries BOTH v2's `action`/`action_params`
 *     and legacy/computed `effect_type`/`effect_value` fields. v2's
 *     fields are populated from JSON directly. The legacy fields are
 *     computed at load time so the 20+ CombatScene branches that read
 *     them keep working without rewrites. As consumers migrate to read
 *     `action`/`action_params` directly, the legacy fields can come
 *     off the type.
 */

import { modulePath } from "./Module";
import type { ClassTemplate } from "./Classes";
import type { PartyMember } from "./Party";

export interface SpellEffectValue {
  dice?: string;
  dice_count?: number;
  dice_sides?: number;
  stat_bonus?: string;
  min_damage?: number;
  min_heal?: number;
  ac_bonus?: number;
  range_bonus?: number;
  attack_bonus?: number;
  ac_penalty?: number;
  attack_penalty?: number;
  max_target_hp?: number;
  save_dc_stat?: string;
  save_dc_base?: number;
  save_stat?: string;
  hp_amount?: number;
  /** v2's apply_effect / cure_effect spells carry the target effect id here. */
  effect_id?: string;
  radius?: number;
  damage_type?: string;
  /** Damage spells: multiply final damage by this factor when the
   *  target is undead (e.g. Divine Smite's 1.5×). Ignored for living
   *  targets and for spells that omit it. */
  vs_undead_multiplier?: number;
  scope?: string;
  heal_percent?: number;
  mp_percent?: number;
  cure_effects?: string[];
  /** Directional damage spells: when true the bolt PIERCES — it passes
   *  through every tile in its line, damaging each creature (friend or
   *  foe) it crosses instead of stopping at the first. Lightning Bolt
   *  uses this. */
  pierce?: boolean;
  [key: string]: unknown;
}

export interface Spell {
  // ── v2 canonical fields ──────────────────────────────────────
  id: string;
  name: string;
  description: string;
  /** Single casting catalog: `"sorcerer"` or `"priest"`. */
  casting_type: string;
  min_level: number;
  class_min_levels?: Record<string, number>;
  mp_cost: number;
  duration: "instant" | number | string;
  /** Discriminator for the resolver — `"damage"`, `"heal"`,
   *  `"apply_effect"`, `"cure_effect"`, `"teleport"`, `"summon"`,
   *  `"aoe_damage"`, `"restore"`, `"knock"`, etc. */
  action: string;
  /** Action-specific parameters. Shape depends on `action`. */
  action_params?: SpellEffectValue | null;
  range?: number;
  targeting?: string;
  /** Where the spell can be cast: `"battle"` (in combat) or
   *  `"party"` (out of combat). */
  usable_in: string[];
  icon?: string;
  /** Reference into the Animation catalog (modules/default/animations.json).
   *  Combat dispatches the cast SFX, projectile/aura visual, and
   *  impact SFX through this id. */
  animation_id?: string | null;

  // ── Legacy / derived fields (computed at load) ───────────────
  // These mirror v1's spell shape so CombatScene's effect_type-based
  // branches keep working during the migration. Compute once at
  // load; do not write to these elsewhere.
  /** Same content as `action`, except apply_effect / cure_effect
   *  spells return the underlying effect id ("bless", "curse", etc.)
   *  matching v1's `effect_type` strings. */
  effect_type: string;
  /** Same object as `action_params`. */
  effect_value?: SpellEffectValue;
}

interface RawSpell {
  id?: string;
  name?: string;
  description?: string;
  casting_type?: string;
  min_level?: number;
  class_min_levels?: Record<string, number>;
  mp_cost?: number;
  duration?: "instant" | number | string;
  action?: string;
  action_params?: SpellEffectValue | null;
  range?: number;
  targeting?: string;
  usable_in?: string[] | string;
  icon?: string;
  animation_id?: string | null;
}

let _cache: Spell[] | null = null;

export async function loadSpells(
  url = modulePath("spells.json"),
): Promise<Spell[]> {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as { spells?: RawSpell[] };
  _cache = (raw.spells ?? []).map((s) => spellFromRaw(s));
  return _cache;
}

/**
 * Hydrate a v2 spell record.
 *
 * Defaults seed required fields when the JSON omits them; spread
 * carries every other field through unconditionally (project
 * principle — catalog data lives in the model + spells.json, not in
 * loader copy points). Overrides re-stamp the fields that need
 * shaping: `usable_in` accepts a singleton string for convenience
 * and gets normalised to an array, and the computed `effect_type` /
 * `effect_value` legacy fields are derived from `action` +
 * `action_params`.
 */
export function spellFromRaw(s: RawSpell): Spell {
  const action = s.action ?? "";
  const params = s.action_params ?? {};
  const effectType =
    (action === "apply_effect" || action === "cure_effect") &&
    typeof params.effect_id === "string"
      ? params.effect_id
      : action;
  return {
    id: "",
    name: "?",
    description: "",
    casting_type: "",
    min_level: 1,
    mp_cost: 0,
    duration: "instant",
    ...s,
    action,
    action_params: s.action_params,
    usable_in: Array.isArray(s.usable_in)
      ? s.usable_in
      : typeof s.usable_in === "string"
        ? [s.usable_in]
        : [],
    // Legacy / derived — kept out of the raw shape so they always
    // reflect the action+params pair, not whatever the JSON happened
    // to carry.
    effect_type: effectType,
    effect_value: params as SpellEffectValue,
  };
}

/** Per-class minimum level required to cast — `class_min_levels` wins
 *  over `min_level`. Class identifier is the lowercase class id. */
export function minLevelFor(spell: Spell, klass: string): number {
  const ck = spell.class_min_levels?.[klass.toLowerCase()];
  if (typeof ck === "number" && Number.isFinite(ck)) return ck;
  return spell.min_level;
}

/** True when a class with `template` as its template can cast spells
 *  of `spell.casting_type`. v2 derives eligibility from the class's
 *  casting_type[] list rather than a per-spell allowlist. */
export function classCanCast(spell: Spell, template: ClassTemplate | null): boolean {
  if (!template) return false;
  return template.casting_type.includes(spell.casting_type);
}

/**
 * Active members who can cast this spell. Caller passes the class-
 * template map so we can check casting_type eligibility (v2's gate)
 * + the level threshold + MP cost.
 */
export function castersFor(
  spell: Spell,
  members: PartyMember[],
  classTemplates: Map<string, ClassTemplate>,
): PartyMember[] {
  return members.filter((m) => {
    if (m.hp <= 0) return false;
    const tpl = classTemplates.get(m.class.toLowerCase()) ?? null;
    if (!classCanCast(spell, tpl)) return false;
    if (m.level < minLevelFor(spell, m.class)) return false;
    if (m.max_mp == null || (m.mp ?? 0) < spell.mp_cost) return false;
    return true;
  });
}

/**
 * Spells the player can pick from the Party Inventory's CAST menu —
 * usable outside of combat AND at least one party member can cast
 * it right now.
 */
export function spellsCastableFromMenu(
  spells: Spell[],
  members: PartyMember[],
  classTemplates: Map<string, ClassTemplate>,
): Spell[] {
  return spells.filter((s) => {
    if (s.usable_in.length === 0) return false;
    const outsideCombat = s.usable_in.some((c) => c !== "battle");
    if (!outsideCombat) return false;
    return castersFor(s, members, classTemplates).length > 0;
  });
}

/** Test-only cache reset. */
export function _clearSpellsCache(): void {
  _cache = null;
}
