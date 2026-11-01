/**
 * Moon-phase icons for the play screen's bottom bar. One small canvas
 * texture per lunar phase (GameTime.LUNAR_PHASES, 0 = New … 4 = Full),
 * painted once per scene: a dark disc with the lit part drawn as a
 * half-disc plus an elliptical terminator. Waxing phases light the
 * right side, waning the left.
 */

import type * as PhaserNS from "phaser";

export const MOON_TEXTURE_PX = 64;

export function moonTextureKey(phaseIdx: number): string {
  return `moon_phase_${((phaseIdx % 8) + 8) % 8}`;
}

/** Paint phase `phaseIdx` (0–7) into a 2D context of `size` px. */
export function drawMoonPhase(
  ctx: CanvasRenderingContext2D,
  size: number,
  phaseIdx: number,
): void {
  const c = size / 2;
  const r = size / 2 - size * 0.06;
  ctx.clearRect(0, 0, size, size);

  // Unlit disc + soft rim so the new moon still reads as a moon.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = "#2b2b40";
  ctx.fill();
  ctx.lineWidth = size * 0.04;
  ctx.strokeStyle = "#55557a";
  ctx.stroke();

  const p = ((phaseIdx % 8) + 8) % 8;
  if (p === 0) return;
  const lit = "#f1ead0";
  if (p === 4) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = lit;
    ctx.fill();
  } else {
    // k > 0 → crescent (terminator bulges toward the lit edge),
    // k < 0 → gibbous; |k| ≈ 0 at the quarters (straight terminator).
    const k = Math.cos((p / 8) * Math.PI * 2);
    const rx = Math.max(0.001, r * Math.abs(k));
    ctx.beginPath();
    if (p < 4) {
      // Waxing — right half lit, top → bottom, back up via terminator.
      ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(c, c, rx, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    } else {
      // Waning — left half lit, bottom → top, back down via terminator.
      ctx.arc(c, c, r, Math.PI / 2, (3 * Math.PI) / 2, false);
      ctx.ellipse(c, c, rx, r, 0, (3 * Math.PI) / 2, Math.PI / 2, k > 0);
    }
    ctx.closePath();
    ctx.fillStyle = lit;
    ctx.fill();
  }
  // A couple of faint maria for texture on the lit face.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "rgba(120, 110, 90, 0.18)";
  for (const [dx, dy, rr] of [
    [-0.25, -0.2, 0.18],
    [0.2, 0.15, 0.22],
    [-0.05, 0.35, 0.1],
  ]) {
    ctx.beginPath();
    ctx.arc(c + dx * r, c + dy * r, rr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Create the eight phase textures on `scene` if they don't exist yet. */
export function ensureMoonTextures(scene: PhaserNS.Scene): void {
  for (let i = 0; i < 8; i++) {
    const key = moonTextureKey(i);
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, MOON_TEXTURE_PX, MOON_TEXTURE_PX);
    const ctx = tex?.getContext();
    if (!tex || !ctx) continue;
    drawMoonPhase(ctx, MOON_TEXTURE_PX, i);
    tex.refresh();
  }
}
