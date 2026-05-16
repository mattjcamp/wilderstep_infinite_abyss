/**
 * Runtime status effects — reads v2's module-scoped effects.json
 * natively.
 *
 * v2 differences (canonical model):
 *   - Catalog is a flat array under `effects`, keyed by `id`
 *     (snake_case). Same shape as items/spells/monsters.
 *   - Per-effect parameters carried on `params` (was scattered
 *     across separate fields in v1).
 *   - No `requirements` clause: v2 split the "who can use this"
 *     question off entirely. Party-effect togglability now lives
 *     on `Ability.party_effect: true` (abilities.json). Combat's
 *     runtime statuses (bless, curse, sleep, magic_light, ac_buff,
 *     poisoned, …) all stay on effects.json.
 *   - No `item_granted` flag: item-conferred effects come through
 *     `Item.grants_effect` referencing an effect id; the gating
 *     ("only if the item is equipped") is checked at the equipment
 *     layer rather than baked into the effect record.
 *
 * `canEquip` therefore degrades to a trivial "always true" — v1 had
 * Detect Traps / Infravision sitting in this catalog with class /
 * race requirements; in v2 those are abilities, surfaced by a
 * different code path. Until that path gets ported, the helper just
 * lets callers proceed.
 */

import { modulePath } from "./Module";

export interface EffectParams {
  /** Generic buff/debuff knobs. */
  ac_bonus?: number;
  ac_penalty?: number;
  attack_bonus?: number;
  attack_penalty?: number;
  range_bonus?: number;
  /** Per-turn damage tick (poisoned, consumed). */
  damage_per_turn?: number;
  /** Per-turn HP restore (regen). */
  amount?: number;
  /** Repel-monsters knobs. */
  radius?: number;
  push_distance?: number;
  [key: string]: unknown;
}

export interface Effect {
  id: string;
  name: string;
  description: string;
  /** Duration is "permanent" / "instant" / "until_save" / number
   *  (turns or steps depending on context). */
  duration: "permanent" | "instant" | "until_save" | number | string;
  params?: EffectParams | null;
}

interface RawEffect {
  id?: string;
  name?: string;
  description?: string;
  duration?: "permanent" | "instant" | "until_save" | number | string;
  params?: EffectParams | null;
}

let _cache: Effect[] | null = null;

export async function loadEffects(
  url = modulePath("effects.json"),
): Promise<Effect[]> {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = (await res.json()) as { effects?: RawEffect[] };
  // Spread + defaults — see itemFromRaw for the rationale; adding a
  // new field to Effect + effects.json shouldn't need a copy point
  // change here. Defaults seed the required scalars when JSON omits
  // them; spread carries every other field through.
  _cache = (raw.effects ?? []).map((e) => ({
    id: "",
    name: "?",
    description: "",
    duration: "permanent" as Effect["duration"],
    ...e,
  }));
  return _cache;
}

/**
 * Whether the party can pick this effect. v2 doesn't carry per-effect
 * eligibility clauses anymore — party-effect togglability moved to
 * Ability records (abilities.json with `party_effect: true`). Callers
 * that still go through this helper get a blanket `true`; the
 * eligibility checks should run against the ability catalog when the
 * Party migration lands.
 */
export function canEquip(_effect: Effect): boolean {
  return true;
}

/** Test-only cache reset. */
export function _clearEffectsCache(): void {
  _cache = null;
}
