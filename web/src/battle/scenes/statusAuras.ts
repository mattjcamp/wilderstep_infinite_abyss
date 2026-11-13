/**
 * On-character status visuals for the battle arena — one look per
 * effect, drawn every frame around each combatant's sprite while the
 * effect is active:
 *
 *   poisoned     green haze pooling around the body + rising bubbles
 *   asleep       blue "Z"s drifting up from the head
 *   charmed      two pink hearts circling the head
 *   slowed       grey ring at the feet, pulsing slowly, with drag marks
 *   cursed       violet wisps swirling around the body
 *   blessed      golden halo above the head
 *   shielded     pale-blue bubble around the body
 *   long shanks  green chevrons sweeping under the feet
 *   empowered    warm red-orange glow (Elixir of Strength and kin)
 *   invisible    the sprite turns see-through + a faint shimmer ring
 *   regenerating soft green "+" motes rising (monsters with regen)
 *
 * Everything is drawn into ONE Graphics object that is cleared and
 * redrawn each frame from time-based sine math, so there are no
 * per-effect tweens to create, track or leak. `statusVisualsFor` is
 * pure (combatant → list of looks) and unit-tested.
 */

import type Phaser from "phaser";
import type { Combatant } from "../types";

export type StatusVisual =
  | "poison"
  | "sleep"
  | "charm"
  | "slow"
  | "curse"
  | "bless"
  | "shield"
  | "haste"
  | "empower"
  | "invisible"
  | "regen";

/** Which looks a combatant should show right now, in draw order. */
export function statusVisualsFor(c: Combatant): StatusVisual[] {
  const out = new Set<StatusVisual>();
  for (const e of c.effects ?? []) {
    switch (e.effectId) {
      case "poisoned": out.add("poison"); break;
      case "sleep": out.add("sleep"); break;
      case "charm": out.add("charm"); break;
      case "slowed": out.add("slow"); break;
      case "stat_modifier": {
        const kind = String(e.params.kind ?? "");
        const source = String(e.state.source ?? "");
        if (kind === "attack_penalty" || kind === "ac_penalty") out.add("curse");
        else if (kind === "range_bonus") out.add("haste");
        else if (kind === "ac_bonus" && source === "Invisibility") out.add("invisible");
        else if (kind === "ac_bonus") out.add("shield");
        else if (kind === "attack_bonus" && source === "Bless") out.add("bless");
        else if (kind === "attack_bonus" || kind === "damage_bonus") out.add("empower");
        break;
      }
      default:
        break;
    }
  }
  for (const p of c.passives ?? []) {
    if (p.type === "regen") out.add("regen");
  }
  return [...out];
}

interface BodyLike {
  x: number;
  y: number;
  visible: boolean;
  displayWidth: number;
  displayHeight: number;
  setAlpha?: (a: number) => unknown;
}

const TAU = Math.PI * 2;

export class StatusAuraLayer {
  private readonly g: Phaser.GameObjects.Graphics;
  /** Last applied see-through state per combatant, so the sprite's
   *  alpha is only touched when invisibility starts / ends (never
   *  every frame — hit-flash tweens own alpha in between). */
  private readonly invisible = new Map<string, boolean>();

  constructor(scene: Phaser.Scene, depth = 3) {
    this.g = scene.add.graphics().setDepth(depth);
    // Route to the arena camera (see CombatScene.cameraFor).
    (this.g as unknown as { __arena?: boolean }).__arena = true;
  }

  destroy(): void {
    this.g.destroy();
  }

  draw(
    now: number,
    combatants: ReadonlyArray<Combatant>,
    bodies: ReadonlyMap<string, BodyLike>,
  ): void {
    const g = this.g;
    g.clear();
    const t = now / 1000;
    for (const c of combatants) {
      const body = bodies.get(c.id);
      if (!body) continue;
      const looks = c.hp > 0 ? statusVisualsFor(c) : [];
      const inv = looks.includes("invisible");
      if ((this.invisible.get(c.id) ?? false) !== inv) {
        this.invisible.set(c.id, inv);
        if (c.hp > 0) body.setAlpha?.(inv ? 0.45 : 1);
      }
      if (!body.visible || looks.length === 0) continue;
      const r = Math.max(10, Math.min(body.displayWidth, body.displayHeight) / 2);
      const x = body.x;
      const y = body.y;
      // Per-combatant phase so a row of poisoned goblins doesn't pulse
      // in lockstep.
      let seed = 0;
      for (let i = 0; i < c.id.length; i++) seed = (seed * 31 + c.id.charCodeAt(i)) % 997;
      const ph = seed / 997 * TAU;
      for (const look of looks) {
        this.drawLook(look, x, y, r, t, ph);
      }
    }
  }

  private drawLook(look: StatusVisual, x: number, y: number, r: number, t: number, ph: number): void {
    const g = this.g;
    switch (look) {
      case "poison": {
        // Green haze: three soft blobs breathing around the lower body.
        for (let i = 0; i < 3; i++) {
          const a = t * 1.3 + ph + (i * TAU) / 3;
          const bx = x + Math.cos(a) * r * 0.45;
          const by = y + r * 0.25 + Math.sin(a * 1.4) * r * 0.2;
          const pulse = 0.18 + 0.1 * Math.sin(t * 2.2 + i + ph);
          g.fillStyle(0x5fd35a, pulse);
          g.fillCircle(bx, by, r * 0.55);
        }
        // Bubbles rising and fading.
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.7 + i / 3 + ph) % 1;
          const bx = x + Math.sin(k * TAU + i * 2 + ph) * r * 0.5;
          const by = y + r * 0.4 - k * r * 1.6;
          g.fillStyle(0x9cf08a, 0.7 * (1 - k));
          g.fillCircle(bx, by, 1.6 + k * 1.4);
        }
        break;
      }
      case "sleep": {
        // Three "Z"s drifting up-right from the head, growing as they go.
        for (let i = 0; i < 3; i++) {
          const k = (t * 0.45 + i / 3 + ph) % 1;
          const s = 2.5 + k * 3.5;
          const zx = x + r * 0.35 + k * r * 0.6;
          const zy = y - r * 0.6 - k * r * 1.1;
          g.lineStyle(1.5, 0xbcd6ff, 1 - k);
          g.beginPath();
          g.moveTo(zx - s, zy - s);
          g.lineTo(zx + s, zy - s);
          g.lineTo(zx - s, zy + s);
          g.lineTo(zx + s, zy + s);
          g.strokePath();
        }
        break;
      }
      case "charm": {
        // Two hearts orbiting above the head.
        for (let i = 0; i < 2; i++) {
          const a = t * 1.8 + ph + i * Math.PI;
          const hx = x + Math.cos(a) * r * 0.7;
          const hy = y - r * 0.85 + Math.sin(a) * r * 0.2;
          this.heart(hx, hy, 3.2, 0xff7ac8, 0.85);
        }
        break;
      }
      case "slow": {
        // Heavy grey ring at the feet, slow pulse, plus drag lines.
        const p = 0.5 + 0.5 * Math.sin(t * 1.1 + ph);
        g.lineStyle(2, 0xa9b4c6, 0.35 + 0.35 * p);
        g.strokeEllipse(x, y + r * 0.8, r * (1.5 + 0.2 * p), r * 0.45);
        g.lineStyle(1, 0xa9b4c6, 0.5);
        for (let i = -1; i <= 1; i++) {
          g.lineBetween(x + i * r * 0.35, y + r * 0.95, x + i * r * 0.35 - r * 0.3, y + r * 1.1);
        }
        break;
      }
      case "curse": {
        // Violet wisps spiralling round the body.
        for (let i = 0; i < 4; i++) {
          const a = -t * 1.6 + ph + (i * TAU) / 4;
          const rr = r * (0.75 + 0.15 * Math.sin(t * 3 + i));
          g.fillStyle(0xa35cff, 0.45);
          g.fillCircle(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, 2.4);
          g.fillStyle(0x6b2fbf, 0.18);
          g.fillCircle(x + Math.cos(a - 0.35) * rr, y + Math.sin(a - 0.35) * rr * 0.6, 3.4);
        }
        break;
      }
      case "bless": {
        // Golden halo above the head.
        const p = 0.5 + 0.5 * Math.sin(t * 2 + ph);
        g.lineStyle(2, 0xffd75a, 0.55 + 0.35 * p);
        g.strokeEllipse(x, y - r * 1.05, r * 1.0, r * 0.32);
        break;
      }
      case "shield": {
        // Pale-blue bubble.
        const p = 0.5 + 0.5 * Math.sin(t * 1.6 + ph);
        g.fillStyle(0x8fd3ff, 0.08 + 0.05 * p);
        g.fillCircle(x, y, r * 1.15);
        g.lineStyle(1.5, 0x8fd3ff, 0.45 + 0.25 * p);
        g.strokeCircle(x, y, r * 1.15);
        break;
      }
      case "haste": {
        // Chevrons sweeping under the feet.
        for (let i = 0; i < 2; i++) {
          const k = (t * 1.2 + i / 2 + ph) % 1;
          const cx = x - r * 0.6 + k * r * 1.2;
          const cy = y + r * 0.95;
          g.lineStyle(1.5, 0xb6f26a, 0.9 * (1 - Math.abs(k - 0.5) * 2));
          g.beginPath();
          g.moveTo(cx - 3, cy - 3);
          g.lineTo(cx, cy);
          g.lineTo(cx - 3, cy + 3);
          g.strokePath();
        }
        break;
      }
      case "empower": {
        const p = 0.5 + 0.5 * Math.sin(t * 3 + ph);
        g.fillStyle(0xff7a3c, 0.08 + 0.08 * p);
        g.fillCircle(x, y, r * 1.05);
        break;
      }
      case "invisible": {
        const p = 0.5 + 0.5 * Math.sin(t * 2.4 + ph);
        g.lineStyle(1, 0xe8f2ff, 0.15 + 0.2 * p);
        g.strokeCircle(x, y, r * (0.95 + 0.1 * p));
        break;
      }
      case "regen": {
        // Occasional green "+" motes rising.
        const k = (t * 0.5 + ph) % 1;
        const px = x + Math.sin(ph * 3) * r * 0.5;
        const py = y - k * r * 1.4;
        g.lineStyle(1.5, 0x7be2a8, 0.7 * (1 - k));
        g.lineBetween(px - 2.5, py, px + 2.5, py);
        g.lineBetween(px, py - 2.5, px, py + 2.5);
        break;
      }
    }
  }

  private heart(x: number, y: number, s: number, color: number, alpha: number): void {
    const g = this.g;
    g.fillStyle(color, alpha);
    g.fillCircle(x - s * 0.5, y - s * 0.2, s * 0.6);
    g.fillCircle(x + s * 0.5, y - s * 0.2, s * 0.6);
    g.fillTriangle(x - s * 1.08, y, x + s * 1.08, y, x, y + s * 1.2);
  }
}
