/**
 * Play a trap's FX on the map scene: its cast sound, its visual from
 * `from` to `to` (burst visuals just play on `to`), then its hit sound
 * the moment the visual lands. Fire-and-forget; never throws.
 */

import { Sfx } from "@/battle/audio/Sfx";
import {
  fxPartsVisible,
  fxRecordParts,
  fxVisualDef,
  playFxParts,
  type FxRecord,
} from "@/vfx/fxCatalog";

export interface MapPt {
  x: number;
  y: number;
}

/** True when the record's visual travels (needs a separate origin). */
export function trapFxTravels(rec: FxRecord): boolean {
  return fxVisualDef(rec)?.kind === "projectile";
}

export function playTrapFx(
  scene: Phaser.Scene,
  rec: FxRecord,
  from: MapPt,
  to: MapPt,
): void {
  try {
    if (rec.cast_sfx) Sfx.play(rec.cast_sfx);
  } catch {
    /* audio context not ready — skip */
  }
  const parts = fxRecordParts(rec);
  const start = trapFxTravels(rec) ? from : to;
  const landed = fxPartsVisible(parts)
    ? playFxParts(scene, start, to, parts)
    : Promise.resolve();
  void landed
    .then(() => {
      if (rec.hit_sfx) Sfx.play(rec.hit_sfx);
    })
    .catch(() => undefined);
}
