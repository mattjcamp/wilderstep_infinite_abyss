/**
 * Fog-of-war cover styles.
 *
 * Never-seen cells on a fogged map are draped with a cover tile until
 * the party scouts them (see `isUnexplored` in `lighting.ts` and the
 * cover pass in `WorldRenderer.relight`). Authors can choose how that
 * cover LOOKS, per lighting band, via the map's `fog_style` field:
 *
 *   "fog_style": { "day": "cloud", "twilight": "cloud", "night": "darkness" }
 *
 * Styles:
 *   - "cloud"    — the original billowy cloud tile. Tinted by time of
 *                  day (white at noon, dusk-grey at twilight, near-black
 *                  at night) exactly as before this field existed.
 *   - "dark_cloud" — heavy charcoal storm clouds. Same billowy shape as
 *                  "cloud" but slate-grey with darker undersides; dimmed
 *                  at twilight / night but still readable as cloud.
 *   - "darkness" — an inky black void with faint mottling. Not tinted
 *                  by the lighting band: unexplored ground simply reads
 *                  as "lost in the dark" at any hour.
 *
 * Any band absent from the record falls back to {@link DEFAULT_FOG_STYLE}
 * ("cloud"), so existing maps render identically. The band is the
 * renderer's EFFECTIVE lighting mode — the world clock, or the map's
 * `lighting` override when one is authored (a "darkness"-lit map always
 * resolves the `night` style; dungeons always run at `night`).
 */

import type { LightingMode } from "@/sim/lighting";

export type FogStyle = "cloud" | "dark_cloud" | "darkness";

/** Per-lighting-band cover style. Partial — missing bands use the
 *  default. Stored on the Map record as `fog_style`. */
export type FogStyleByMode = Partial<Record<LightingMode, FogStyle>>;

export const FOG_STYLES: readonly FogStyle[] = [
  "cloud",
  "dark_cloud",
  "darkness",
];

/** Display labels for the editor dropdowns. */
export const FOG_STYLE_LABELS: Record<FogStyle, string> = {
  cloud: "Clouds",
  dark_cloud: "Dark clouds",
  darkness: "Darkness",
};

export const DEFAULT_FOG_STYLE: FogStyle = "cloud";

export const LIGHTING_MODES: readonly LightingMode[] = [
  "day",
  "twilight",
  "night",
];

export function isFogStyle(v: unknown): v is FogStyle {
  return v === "cloud" || v === "dark_cloud" || v === "darkness";
}

/** Which cover style applies in `mode`. */
export function resolveFogStyle(
  styles: FogStyleByMode | null | undefined,
  mode: LightingMode,
): FogStyle {
  const v = styles?.[mode];
  return isFogStyle(v) ? v : DEFAULT_FOG_STYLE;
}

/** Sanitise a raw `fog_style` value from a map record (hand-edited
 *  JSON, older modules, etc.). Drops unknown bands / values AND
 *  entries equal to the default, so the persisted shape stays minimal.
 *  Returns `undefined` when nothing non-default remains — callers use
 *  that to omit the field entirely. */
export function normalizeFogStyles(raw: unknown): FogStyleByMode | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: FogStyleByMode = {};
  for (const mode of LIGHTING_MODES) {
    const v = src[mode];
    if (isFogStyle(v) && v !== DEFAULT_FOG_STYLE) out[mode] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
