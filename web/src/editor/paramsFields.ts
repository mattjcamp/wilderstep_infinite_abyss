/**
 * Params-field vocabularies — P2 of the usability audit.
 *
 * `params` (and spells' `action_params`) are per-record knob bags:
 * the SHAPE varies record to record, but each model's key vocabulary
 * is small and known. This module declares those vocabularies so the
 * ParamsEditor can render typed rows (number inputs, enum selects,
 * catalog pickers) instead of a raw JSON textarea, while still
 * letting authors add custom keys the vocabulary hasn't met yet.
 *
 * Vocabularies were inventoried from the default module's data
 * (June 2026) plus the documented trap params. A key the data grows
 * later simply shows up as a "custom" row until it's added here —
 * nothing breaks.
 */

import type { IdListSource } from "./idListFields";
import { SFX_NAMES } from "@/battle/audio/Sfx";

export type ParamSpec =
  | { kind: "number"; integer?: boolean; min?: number; help?: string }
  | { kind: "string"; help?: string }
  | { kind: "enum"; options: ReadonlyArray<string>; help?: string }
  /** Single id picked from a source (rendered chip + Pick…). */
  | { kind: "id"; source: IdListSource; help?: string }
  /** Array of ids — rendered with the IdListPicker. */
  | { kind: "id_list"; source: IdListSource; help?: string }
  /** `{ map_id, col, row }` destination (teleport traps). */
  | { kind: "map_cell"; help?: string }
  /** Declared-but-complex values (inline JSON cell). */
  | { kind: "json"; help?: string };

export interface ParamsFieldConfig {
  /** Known keys in menu order. Insertion order of this object drives
   *  the "+ Add…" menu. */
  specs: Record<string, ParamSpec>;
}

const STATS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
] as const;

const SAVE_STAT: ParamSpec = {
  kind: "enum",
  options: STATS,
  help: "Ability score rolled for the save (d20 + modifier).",
};

const EFFECTS_PARAMS: ParamsFieldConfig = {
  specs: {
    amount: { kind: "number", help: "Generic magnitude (heal/regen per tick, …)." },
    damage_per_turn: { kind: "number", help: "Damage dealt each turn while active." },
    ac_bonus: { kind: "number", help: "Armor class bonus while active." },
    ac_penalty: { kind: "number", help: "Armor class penalty while active." },
    attack_bonus: { kind: "number", help: "Attack roll bonus while active." },
    attack_penalty: { kind: "number", help: "Attack roll penalty while active." },
    range_bonus: { kind: "number", help: "Extra range on ranged attacks." },
    radius: { kind: "number", help: "Area of effect, in tiles." },
    push_distance: { kind: "number", help: "Tiles the target is shoved." },
  },
};

const ABILITIES_PARAMS: ParamsFieldConfig = {
  specs: {
    save_stat: SAVE_STAT,
    dc: { kind: "number", help: "Difficulty class for the roll." },
    save_dc_base: { kind: "number", help: "Base DC before modifiers." },
    mp_cost: { kind: "number", help: "MP spent per use." },
    range: { kind: "number", help: "Range in tiles." },
    extra_range: { kind: "number", help: "Bonus range granted." },
    post_attack_range: { kind: "number", help: "Range after the attack resolves." },
    uses_per_day: { kind: "number", help: "Per-in-game-day use cap." },
    fail_hp_percent: { kind: "number", help: "HP % lost on a failed roll." },
    find_chance: {
      kind: "number",
      integer: false,
      help: "Per-step probability (0–1) — e.g. 0.02 = 2%.",
    },
    alchemist_multiplier: { kind: "number", help: "Multiplier applied for Alchemists." },
    weapon_type: { kind: "string", help: "Weapon type the ability applies to." },
    action: { kind: "string", help: "Action discriminator the engine dispatches on." },
    targeting: { kind: "string", help: "Targeting mode (self, ally, enemy, …)." },
    terrain: {
      kind: "id_list",
      source: { kind: "catalog", model: "map_tiles" },
      help: "Tile ids the ability works on (Herbalism foraging terrain).",
    },
    tinker_items: {
      kind: "id_list",
      source: { kind: "catalog", model: "items" },
      help: "Items a Gnome can tinker up — the choices the Tinker picker offers (replaces the old General Store stock).",
    },
    sfx: {
      kind: "enum",
      options: SFX_NAMES,
      help: "Sound effect played on use.",
    },
    note: { kind: "string", help: "Designer note — not shown to players." },
  },
};

const TRAPS_PARAMS: ParamsFieldConfig = {
  specs: {
    targets: {
      kind: "enum",
      options: ["one", "all"],
      help: "One random alive member, or the whole party.",
    },
    save_stat: SAVE_STAT,
    save_dc: {
      kind: "number",
      help: "Save DC — pass means half damage and no effect.",
    },
    teleport: {
      kind: "map_cell",
      help: "Teleport-trap destination cell.",
    },
  },
};

const SPELLS_ACTION_PARAMS: ParamsFieldConfig = {
  specs: {
    effect_id: {
      kind: "id",
      source: { kind: "catalog", model: "effects" },
      help: "Status effect the spell applies.",
    },
    dice_count: { kind: "number", help: "Number of damage/heal dice." },
    dice_sides: { kind: "number", help: "Sides per die." },
    min_damage: { kind: "number", help: "Damage floor after rolling." },
    min_heal: { kind: "number", help: "Heal floor after rolling." },
    stat_bonus: {
      kind: "enum",
      options: STATS,
      help: "Caster stat whose modifier is added to the roll.",
    },
    save_dc_base: { kind: "number", help: "Base save DC before modifiers." },
    save_dc_stat: SAVE_STAT,
    save_stat: SAVE_STAT,
    radius: { kind: "number", help: "Area of effect, in tiles." },
    max_target_hp: { kind: "number", help: "Only affects targets at or below this HP." },
    attack_bonus: { kind: "number", help: "Attack roll bonus granted." },
    push_distance: { kind: "number", help: "Tiles the target is shoved." },
    heal_percent: { kind: "number", help: "Heal as a % of max HP." },
    mp_percent: { kind: "number", help: "MP restored as a % of max MP." },
    damage_type: { kind: "string", help: "Damage flavour (fire, poison, …)." },
    vs_undead_multiplier: {
      kind: "number",
      help: "Multiply damage by this when the target is undead (e.g. 1.5 for Divine Smite).",
    },
    scope: { kind: "string", help: "Targeting scope discriminator." },
    cure_effects: {
      kind: "id_list",
      source: { kind: "catalog", model: "effects" },
      help: "Effect ids this spell removes from the target.",
    },
    creature: {
      kind: "json",
      help: "Summoned-creature block — edited as JSON for now.",
    },
  },
};

/** (modelKey, fieldKey) → vocabulary. */
const PER_MODEL: Record<string, Record<string, ParamsFieldConfig>> = {
  effects: { params: EFFECTS_PARAMS },
  abilities: { params: ABILITIES_PARAMS },
  traps: { params: TRAPS_PARAMS },
  spells: { action_params: SPELLS_ACTION_PARAMS },
};

/** Returns the vocabulary for a field, or null when the field isn't
 *  a params field on this model. */
export function getParamsFieldConfig(
  fieldKey: string,
  modelKey?: string,
): ParamsFieldConfig | null {
  if (!modelKey) return null;
  return PER_MODEL[modelKey]?.[fieldKey] ?? null;
}

/** Sensible starting value when a known key is added from the menu. */
export function defaultValueForSpec(spec: ParamSpec): unknown {
  switch (spec.kind) {
    case "number":
      return spec.min ?? 0;
    case "string":
      return "";
    case "enum":
      return spec.options[0] ?? "";
    case "id":
      return "";
    case "id_list":
      return [];
    case "map_cell":
      return { map_id: "", col: 0, row: 0 };
    case "json":
      return null;
  }
}
