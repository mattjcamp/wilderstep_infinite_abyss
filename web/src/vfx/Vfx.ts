/**
 * Combat visual effects, painted on top of the existing CombatScene.
 *
 * Each helper takes a Phaser scene plus screen-space coordinates and
 * spawns short-lived game objects that the engine cleans up via
 * `onComplete: destroy`. Nothing in here mutates combat state — the
 * scene owns dice rolls and HP; we only draw the eye candy.
 *
 * Conventions:
 *   - Coordinates are arena-relative *screen* pixels (the scene already
 *     converts grid (col, row) → centre x/y via tileX / tileY).
 *   - Colours are 0xRRGGBB integers so they pass straight to Phaser.
 *   - Every effect resolves on its own; awaiting them is optional.
 */

// `import type` so this module stays SSR-safe — Next.js prerenders
// PlayHost's static shell on the server, and a runtime `import Phaser
// from "phaser"` touches `navigator` at module load and crashes the
// build. Phaser's value helpers (Math.Distance.Between / Math.Linear)
// are inlined below as vanilla TS so the file no longer needs the
// runtime side of phaser.
import type Phaser from "phaser";

/** Inline `Phaser.Math.Distance.Between` — Euclidean distance. */
function distBetween(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Inline `Phaser.Math.Linear` — single-axis lerp from `a` to `b`. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const TILE = 32;

const COLOURS: Record<string, number> = {
  fire:      0xff7a3a,
  ember:     0xffce5c,
  lightning: 0xa9d4ff,
  arcane:    0xc28bff,
  heal:      0x88ff9c,
  buff:      0xffe48a,
  curse:     0x9d4cff,
  shield:    0x9bcfff,
  miss:      0xbdb38a,
  blood:     0xff4f4f,
  white:     0xffffff,
};

type Pt = { x: number; y: number };

/** Single bright flash on a target body — colour-coded by intent. */
export function flashTarget(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject & { x: number; y: number },
  color = COLOURS.blood,
): void {
  const halo = scene.add.circle(
    (target as unknown as { x: number }).x,
    (target as unknown as { y: number }).y,
    18, color, 0.6,
  ).setDepth(50);
  scene.tweens.add({
    targets: halo,
    radius: 26, alpha: 0,
    duration: 220,
    onComplete: () => halo.destroy(),
  });
}

/** Brief tint flicker on the caster — telegraphs that they're casting. */
export function castGlow(
  scene: Phaser.Scene,
  caster: Phaser.GameObjects.GameObject & { x: number; y: number },
  color = COLOURS.arcane,
): void {
  const aura = scene.add.circle(
    (caster as unknown as { x: number }).x,
    (caster as unknown as { y: number }).y,
    20, color, 0.45,
  ).setDepth(40);
  scene.tweens.add({
    targets: aura,
    radius: 8, alpha: 0,
    duration: 320,
    onComplete: () => aura.destroy(),
  });
}

/**
 * Aimed projectile travelling from `from` → `to` on a slight arc. Used
 * by Throw, Range, and single-target damage spells. Rotates the dot to
 * face direction of travel for visual punch.
 */
export function projectileLine(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  color = COLOURS.arcane,
  durationMs = 220,
): Promise<void> {
  return new Promise((resolve) => {
    const dot = scene.add.rectangle(from.x, from.y, 8, 4, color, 1)
      .setDepth(60);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    dot.rotation = angle;
    // Arc midpoint: slight upward bow.
    const dist = distBetween(from.x, from.y, to.x, to.y);
    const apex = Math.min(28, dist * 0.18);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - apex;
    // Two-step tween: from → mid → to. Phaser doesn't ship a native
    // quadratic-bezier tween, so we just chain two.
    scene.tweens.add({
      targets: dot, x: midX, y: midY,
      duration: durationMs / 2,
      onComplete: () => {
        scene.tweens.add({
          targets: dot, x: to.x, y: to.y,
          duration: durationMs / 2,
          onComplete: () => { dot.destroy(); resolve(); },
        });
      },
    });
  });
}

/**
 * Sprite projectile — flies an actual image (an arrow, a crossbow bolt)
 * from `from` to `to` along the same gentle upward arc as
 * {@link projectileLine}, turning the sprite to follow the arc's
 * tangent so the head always leads. Falls back to the plain streak
 * when `textureKey` isn't loaded.
 *
 * `spriteAngle` is the direction the art itself points, in radians
 * (the item icons draw the shaft tip up-left, i.e. −3π/4). `trailColor`
 * drops small fading embers behind it (fire arrows / bolts). Duration
 * scales with distance (clamped) so the shot reads at any range.
 */
export function spriteProjectile(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  textureKey: string,
  opts: {
    durationMs?: number;
    size?: number;
    spriteAngle?: number;
    trailColor?: number;
  } = {},
): Promise<void> {
  if (!scene.textures.exists(textureKey)) {
    return projectileLine(scene, from, to, opts.trailColor ?? COLOURS.white, 240);
  }
  const dist = distBetween(from.x, from.y, to.x, to.y);
  const duration = opts.durationMs ?? Math.max(220, Math.min(420, dist * 1.1));
  const spriteAngle = opts.spriteAngle ?? -0.75 * Math.PI;
  const size = opts.size ?? 40;
  // Quadratic bezier with the control point lifted so the shot bows
  // upward like the streak does.
  const apex = Math.min(28, dist * 0.18) * 2;
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - apex;
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
      // Derivative — the direction of travel at t.
      dx: 2 * u * (cx - from.x) + 2 * t * (to.x - cx),
      dy: 2 * u * (cy - from.y) + 2 * t * (to.y - cy),
    };
  };
  return new Promise((resolve) => {
    const img = scene.add.image(from.x, from.y, textureKey).setDepth(60);
    img.setDisplaySize(size, size);
    const p0 = at(0);
    img.rotation = Math.atan2(p0.dy, p0.dx) - spriteAngle;
    let lastTrail = 0;
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const p = at(t);
        img.setPosition(p.x, p.y);
        img.rotation = Math.atan2(p.dy, p.dx) - spriteAngle;
        if (opts.trailColor !== undefined && t - lastTrail > 0.06) {
          lastTrail = t;
          const ember = scene.add
            .rectangle(p.x, p.y, 4, 4, opts.trailColor, 1)
            .setDepth(59);
          scene.tweens.add({
            targets: ember,
            alpha: 0,
            scale: 0.3,
            duration: 260,
            onComplete: () => ember.destroy(),
          });
        }
      },
      onComplete: () => {
        img.destroy();
        resolve();
      },
    });
  });
}

// Phaser.BlendModes.ADD as a literal — this file only imports Phaser's
// types (SSR safety), so the enum's runtime value isn't available.
const BLEND_ADD = 1;

/** A jagged path from `a` to `b`: `kinks` main joints pushed across the
 *  axis, each span split again with finer offsets so the line reads as
 *  a forking, fractal bolt rather than a stiff polyline. */
function boltPath(a: Pt, b: Pt, kinks: number, jitter: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const main: Pt[] = [a];
  for (let i = 1; i < kinks; i++) {
    const t = (i + (Math.random() - 0.5) * 0.5) / kinks;
    const off = (Math.random() - 0.5) * jitter * 1.6;
    main.push({ x: lerp(a.x, b.x, t) + nx * off, y: lerp(a.y, b.y, t) + ny * off });
  }
  main.push(b);
  const out: Pt[] = [a];
  for (let i = 1; i < main.length; i++) {
    const p = main[i - 1];
    const q = main[i];
    for (const t of [1 / 3, 2 / 3]) {
      const off = (Math.random() - 0.5) * jitter * 0.45;
      out.push({ x: lerp(p.x, q.x, t) + nx * off, y: lerp(p.y, q.y, t) + ny * off });
    }
    out.push(q);
  }
  return out;
}

/** Stroke a path as plasma: wide haze → glow → body → white-hot core.
 *  Draw into an ADD-blended Graphics so overlaps bloom toward white. */
function strokePlasma(
  g: Phaser.GameObjects.Graphics,
  pts: Pt[],
  width: number,
  glow: number,
  body: number,
  core: number,
  alpha = 1,
): void {
  const pass = (w: number, c: number, a: number) => {
    g.lineStyle(w, c, Math.min(1, a));
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.strokePath();
  };
  pass(width * 6, glow, 0.14 * alpha);
  pass(width * 3, glow, 0.35 * alpha);
  pass(width * 1.5, body, 0.9 * alpha);
  pass(Math.max(1, width * 0.55), core, alpha);
}

/** Short forks splitting off a bolt path at random angles. */
function forkPaths(main: Pt[], count: number, jitter: number, reach: number): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((main.length - 1) * (0.15 + Math.random() * 0.7));
    const p = main[idx];
    const q = main[idx + 1];
    const ang = Math.atan2(q.y - p.y, q.x - p.x)
      + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
    const len = reach * (0.5 + Math.random() * 0.6);
    out.push(boltPath(p, { x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len }, 3, jitter * 0.6));
  }
  return out;
}

/** Little arcs snapping off a plasma ball at `at`, re-drawn on a fresh
 *  random path every ~40ms for `durationMs`, then faded out. */
function plasmaArcs(
  scene: Phaser.Scene,
  at: Pt,
  radius: number,
  count: number,
  durationMs: number,
  glow: number,
  body: number,
  core: number,
  width: number,
): void {
  const g = scene.add.graphics().setDepth(71).setBlendMode(BLEND_ADD);
  const draw = () => {
    g.clear();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = a + (Math.random() - 0.5) * 0.9;
      const r = radius * (0.6 + Math.random() * 0.7);
      const start = { x: at.x + Math.cos(a) * radius * 0.25, y: at.y + Math.sin(a) * radius * 0.25 };
      const end = { x: at.x + Math.cos(b) * r, y: at.y + Math.sin(b) * r };
      strokePlasma(g, boltPath(start, end, 3, radius * 0.5), width, glow, body, core, 0.6 + Math.random() * 0.4);
    }
  };
  draw();
  const ev = scene.time.addEvent({
    delay: 40,
    repeat: Math.max(0, Math.floor(durationMs / 40) - 1),
    callback: draw,
  });
  scene.time.delayedCall(durationMs, () => {
    ev.remove();
    scene.tweens.add({ targets: g, alpha: 0, duration: 90, onComplete: () => g.destroy() });
  });
}

/**
 * Lightning bolt — a crackling plasma arc from caster to target, in
 * four beats:
 *
 *   1. CHARGE: a violet plasma ball swells at the caster, small arcs
 *      snapping off it.
 *   2. LEADER: the ball races along a jagged path to the target,
 *      leaving a thin flickering trail.
 *   3. STRIKE: the full bolt, a fractal zigzag stroked in additive
 *      layers (violet haze → glow → pale-blue body → white core) with
 *      forks. It re-strikes `strikes` times on a fresh path, dimming
 *      between flashes, so it flickers like a live arc, and sheds
 *      glowing plasma motes along its length.
 *   4. IMPACT: a white flash, a churning plasma sphere with arcs
 *      crawling off it, a shock ring and a spray of sparks.
 *
 * Resolves the moment the bolt connects (beat 3) so the caller's hit
 * sound, shake and damage numbers land with it; the flicker and impact
 * keep playing on their own. Same signature as the old single-stroke
 * zigzag; the new looks are optional `opts`.
 */
export function lightningZigzag(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  segments = 8,
  opts: {
    color?: number;
    width?: number;
    jitter?: number;
    fadeMs?: number;
    /** Outer plasma haze colour. */
    glow?: number;
    /** White-hot centre colour. */
    core?: number;
    /** Forks split off the main bolt per strike. */
    branches?: number;
    /** How many times the bolt flickers / re-strikes. */
    strikes?: number;
    /** Charge-up time at the caster before the bolt flies (0 = none). */
    chargeMs?: number;
    /** Size multiplier for the charge ball and the impact. */
    size?: number;
  } = {},
): Promise<void> {
  const BODY = opts.color ?? COLOURS.lightning;
  const GLOW = opts.glow ?? 0x7b6cff;
  const CORE = opts.core ?? COLOURS.white;
  const W = Math.max(1, opts.width ?? 3);
  const jitter = opts.jitter ?? 18;
  const kinks = Math.max(2, Math.round(segments));
  const branches = Math.max(0, Math.round(opts.branches ?? 3));
  const strikes = Math.max(1, Math.round(opts.strikes ?? 3));
  const chargeMs = Math.max(0, opts.chargeMs ?? 120);
  const fadeMs = opts.fadeMs ?? 280;
  const K = Math.max(0.3, opts.size ?? 1);
  const dist = distBetween(from.x, from.y, to.x, to.y);
  const leaderMs = Math.max(50, Math.min(140, dist * 0.35));
  const reach = Math.max(14, Math.min(70, dist * 0.28));
  const STRIKE_GAP = 55;

  return new Promise((resolve) => {
    const path = boltPath(from, to, kinks, jitter);

    // The plasma ball — three additive layers that flicker in size.
    const haze = scene.add.circle(from.x, from.y, 4 * K, GLOW, 0.35).setDepth(69).setBlendMode(BLEND_ADD);
    const orb = scene.add.circle(from.x, from.y, 2 * K, BODY, 0.8).setDepth(70).setBlendMode(BLEND_ADD);
    const hot = scene.add.circle(from.x, from.y, 1 * K, CORE, 1).setDepth(71);
    const pulse = (s: number) => {
      haze.setRadius((6 + 10 * s + Math.random() * 4) * K);
      orb.setRadius((3 + 5 * s + Math.random() * 2) * K);
      hot.setRadius((1.5 + 2.5 * s + Math.random()) * K);
    };
    const moveBall = (p: Pt) => {
      haze.setPosition(p.x, p.y);
      orb.setPosition(p.x, p.y);
      hot.setPosition(p.x, p.y);
    };

    const mote = (p: Pt) => {
      const m = scene.add
        .circle(p.x, p.y, (2 + Math.random() * 2.5) * K, Math.random() < 0.5 ? GLOW : BODY, 0.8)
        .setDepth(69)
        .setBlendMode(BLEND_ADD);
      scene.tweens.add({
        targets: m,
        x: p.x + (Math.random() - 0.5) * 14,
        y: p.y + (Math.random() - 0.5) * 14 - 4,
        radius: (6 + Math.random() * 4) * K,
        alpha: 0,
        duration: 260 + Math.random() * 200,
        ease: "Quad.Out",
        onComplete: () => m.destroy(),
      });
    };

    // ── 4. Impact ────────────────────────────────────────────────
    const impact = () => {
      const flash = scene.add.circle(to.x, to.y, 6 * K, CORE, 1).setDepth(72).setBlendMode(BLEND_ADD);
      scene.tweens.add({
        targets: flash, radius: 24 * K, alpha: 0, duration: 180,
        onComplete: () => flash.destroy(),
      });
      const ring = scene.add.circle(to.x, to.y, 8 * K).setDepth(71).setBlendMode(BLEND_ADD);
      ring.setStrokeStyle(2, BODY, 0.9);
      scene.tweens.add({
        targets: ring, radius: 40 * K, alpha: 0, duration: 320, ease: "Cubic.Out",
        onComplete: () => ring.destroy(),
      });
      const sHaze = scene.add.circle(to.x, to.y, 14 * K, GLOW, 0.45).setDepth(69).setBlendMode(BLEND_ADD);
      const sBody = scene.add.circle(to.x, to.y, 8 * K, BODY, 0.75).setDepth(70).setBlendMode(BLEND_ADD);
      scene.tweens.addCounter({
        from: 0, to: 1, duration: 420,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          const shrink = 1 - t * 0.6;
          sHaze.setRadius((12 + Math.random() * 6) * K * shrink).setAlpha(0.45 * (1 - t));
          sBody
            .setPosition(to.x + (Math.random() - 0.5) * 3, to.y + (Math.random() - 0.5) * 3)
            .setRadius((6 + Math.random() * 4) * K * shrink)
            .setAlpha(0.75 * (1 - t));
        },
        onComplete: () => { sHaze.destroy(); sBody.destroy(); },
      });
      plasmaArcs(scene, to, 26 * K, 4, 320, GLOW, BODY, CORE, Math.max(1, W * 0.45));
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = (20 + Math.random() * 26) * K;
        const spark = scene.add
          .circle(to.x, to.y, 1.2 + Math.random() * 0.9, Math.random() < 0.5 ? CORE : BODY, 1)
          .setDepth(72)
          .setBlendMode(BLEND_ADD);
        scene.tweens.add({
          targets: spark,
          x: to.x + Math.cos(a) * d,
          y: to.y + Math.sin(a) * d + 6,
          alpha: 0,
          duration: 300 + Math.random() * 220,
          ease: "Quad.Out",
          onComplete: () => spark.destroy(),
        });
      }
    };

    // ── 3. Strike ────────────────────────────────────────────────
    const strike = () => {
      const bolt = scene.add.graphics().setDepth(70).setBlendMode(BLEND_ADD);
      let current = path;
      const draw = (fresh: boolean, intensity: number) => {
        if (fresh) current = boltPath(from, to, kinks, jitter);
        bolt.clear().setAlpha(1);
        strokePlasma(bolt, current, W, GLOW, BODY, CORE, intensity);
        for (const f of forkPaths(current, branches, jitter, reach)) {
          strokePlasma(bolt, f, Math.max(1, W * 0.5), GLOW, BODY, CORE, intensity * 0.75);
        }
        for (let i = 0; i < 3; i++) mote(current[Math.floor(Math.random() * current.length)]);
      };
      draw(false, 1);
      const cast = scene.add.circle(from.x, from.y, 4 * K, CORE, 1).setDepth(72).setBlendMode(BLEND_ADD);
      scene.tweens.add({
        targets: cast, radius: 14 * K, alpha: 0, duration: 160,
        onComplete: () => cast.destroy(),
      });
      impact();
      resolve();
      for (let i = 1; i < strikes; i++) {
        // Dim between flashes so the re-strikes read as flicker.
        scene.time.delayedCall(i * STRIKE_GAP - 22, () => bolt.setAlpha(0.3));
        scene.time.delayedCall(i * STRIKE_GAP, () => draw(true, 0.65 + Math.random() * 0.35));
      }
      scene.time.delayedCall((strikes - 1) * STRIKE_GAP + 40, () => {
        scene.tweens.add({
          targets: bolt, alpha: 0, duration: fadeMs,
          onComplete: () => bolt.destroy(),
        });
      });
    };

    // ── 2. Leader ────────────────────────────────────────────────
    const leader = () => {
      const trail = scene.add.graphics().setDepth(70).setBlendMode(BLEND_ADD);
      scene.tweens.addCounter({
        from: 0, to: 1, duration: leaderMs, ease: "Quad.In",
        onUpdate: (tw) => {
          const f = (tw.getValue() ?? 0) * (path.length - 1);
          const i0 = Math.min(path.length - 1, Math.floor(f));
          const i1 = Math.min(path.length - 1, i0 + 1);
          const u = f - i0;
          const head = { x: lerp(path[i0].x, path[i1].x, u), y: lerp(path[i0].y, path[i1].y, u) };
          const seg = path.slice(0, i1 + 1);
          seg[seg.length - 1] = head;
          trail.clear();
          strokePlasma(trail, seg, Math.max(1, W * 0.45), GLOW, BODY, CORE, 0.55 + Math.random() * 0.35);
          moveBall(head);
          pulse(0.7);
        },
        onComplete: () => {
          trail.destroy();
          haze.destroy();
          orb.destroy();
          hot.destroy();
          strike();
        },
      });
    };

    // ── 1. Charge ────────────────────────────────────────────────
    if (chargeMs > 0) {
      plasmaArcs(scene, from, 16 * K, 3, chargeMs, GLOW, BODY, CORE, Math.max(1, W * 0.4));
    }
    scene.tweens.addCounter({
      from: 0, to: 1, duration: Math.max(1, chargeMs),
      onUpdate: (tw) => pulse(tw.getValue() ?? 0),
      onComplete: leader,
    });
  });
}

/** Event a falling-from-the-sky effect emits on its scene so the host
 *  (CombatScene) can frame the target AND the sky above it. Payload:
 *  { x, y, sky, ms }: the landing point, how far above it the fall
 *  starts, and how long until it lands. Hosts that don't listen (the
 *  editor preview) are unaffected. */
export const SKY_FOCUS_EVENT = "vfx:sky-focus";

/** Mark an object as arena content. The combat scene routes objects to
 *  its cameras by position, and a rock that starts above the top row
 *  would otherwise be handed to the HUD camera. */
function arenaObj<T>(o: T): T {
  (o as unknown as { __arena?: boolean }).__arena = true;
  return o;
}

function arCircle(
  scene: Phaser.Scene, x: number, y: number, r: number, color?: number, alpha?: number,
): Phaser.GameObjects.Arc {
  return arenaObj(scene.add.circle(x, y, r, color, alpha));
}

function arEllipse(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, color?: number, alpha?: number,
): Phaser.GameObjects.Ellipse {
  return arenaObj(scene.add.ellipse(x, y, w, h, color, alpha));
}

/** Draw a jagged rock centred on the Graphics' own origin, so the
 *  Graphics can be positioned and spun freely. Dark body, molten rim,
 *  and a hot glowing face on the leading (lower-left) side. */
function drawRock(
  g: Phaser.GameObjects.Graphics,
  r: number,
  body: number,
  rim: number,
  hot: number,
): void {
  const n = 7 + Math.floor(Math.random() * 3);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const rr = r * (0.7 + Math.random() * 0.4);
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  // Phaser types these as Vector2[], but only reads x / y.
  const poly = pts as unknown as Phaser.Math.Vector2[];
  g.fillStyle(body, 1);
  g.fillPoints(poly, true);
  g.fillStyle(hot, 0.85);
  g.fillCircle(-r * 0.25, r * 0.25, r * 0.4);
  g.lineStyle(Math.max(1, r * 0.22), rim, 0.95);
  g.strokePoints(poly, true, true);
}

/** One flaming rock falling from `start` onto `land`. Leaves a fire and
 *  smoke trail and spins as it drops. Resolves on landing. */
function fallingRock(
  scene: Phaser.Scene,
  start: Pt,
  land: Pt,
  r: number,
  durationMs: number,
  c: { body: number; rim: number; hot: number; fire: number; ember: number; smoke: number },
): Promise<void> {
  return new Promise((resolve) => {
    const glow = arCircle(scene, start.x, start.y, r * 2.1, c.fire, 0.35).setDepth(69).setBlendMode(1);
    const rock = scene.add.graphics().setDepth(71).setPosition(start.x, start.y);
    drawRock(rock, r, c.body, c.rim, c.hot);
    const angle = Math.atan2(land.y - start.y, land.x - start.x);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4);
    let frame = 0;
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      ease: "Quad.In", // accelerate as it plummets
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const x = lerp(start.x, land.x, t);
        const y = lerp(start.y, land.y, t);
        rock.setPosition(x, y).setRotation(t * spin);
        glow.setPosition(x, y).setRadius(r * (1.9 + Math.random() * 0.5));
        frame++;
        // Flame licks streaming back up the fall line.
        const lick = arEllipse(scene, x, y, r * (3 + Math.random() * 2), r * 1.3, Math.random() < 0.5 ? c.fire : c.ember, 0.75)
          .setDepth(68)
          .setBlendMode(1);
        lick.rotation = angle;
        scene.tweens.add({
          targets: lick,
          x: x - Math.cos(angle) * r * 2.5,
          y: y - Math.sin(angle) * r * 2.5,
          scaleX: 0.3,
          scaleY: 0.3,
          alpha: 0,
          duration: 180 + Math.random() * 120,
          onComplete: () => lick.destroy(),
        });
        // Smoke left hanging in the sky behind it.
        if (frame % 3 === 0) {
          const puff = arCircle(scene, x, y, r * 0.9, c.smoke, 0.32)
            .setDepth(67);
          scene.tweens.add({
            targets: puff,
            x: puff.x + (Math.random() - 0.5) * 8,
            y: puff.y - 6 - Math.random() * 6,
            radius: r * (2 + Math.random()),
            alpha: 0,
            duration: 500 + Math.random() * 300,
            onComplete: () => puff.destroy(),
          });
        }
      },
      onComplete: () => {
        rock.destroy();
        glow.destroy();
        resolve();
      },
    });
  });
}

/** Rock chips thrown up from an impact on ballistic arcs, spinning,
 *  bouncing off the ground and fading. */
function rockDebris(
  scene: Phaser.Scene,
  at: Pt,
  count: number,
  K: number,
  c: { body: number; rim: number; hot: number },
): void {
  for (let i = 0; i < count; i++) {
    const g = scene.add.graphics().setDepth(72).setPosition(at.x, at.y);
    const r = (1.6 + Math.random() * 2) * K;
    drawRock(g, r, c.body, Math.random() < 0.5 ? c.rim : c.body, c.hot);
    const vx = (Math.random() - 0.5) * 90 * K;
    const up = (24 + Math.random() * 30) * K;
    const spin = (Math.random() - 0.5) * 14;
    const dur = 420 + Math.random() * 260;
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        // Parabola: rises to `up` at t=0.5 and lands back on the ground.
        g.setPosition(at.x + vx * t, at.y + 4 - up * 4 * t * (1 - t));
        g.setRotation(spin * t);
        if (t > 0.75) g.setAlpha(1 - (t - 0.75) / 0.25);
      },
      onComplete: () => g.destroy(),
    });
  }
}

/** Dust billowing out low along the ground from an impact point. */
function dustCloud(scene: Phaser.Scene, at: Pt, count: number, K: number, dust: number): void {
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const puff = arCircle(scene, at.x + (Math.random() - 0.5) * 8, at.y + 4, (4 + Math.random() * 3) * K, dust, 0.55)
      .setDepth(66);
    scene.tweens.add({
      targets: puff,
      x: at.x + side * (12 + Math.random() * 30) * K,
      y: at.y + 2 - (4 + Math.random() * 16) * K,
      radius: (10 + Math.random() * 7) * K,
      alpha: 0,
      delay: Math.random() * 60,
      duration: 600 + Math.random() * 350,
      ease: "Quad.Out",
      onComplete: () => puff.destroy(),
    });
  }
}

/**
 * Meteor Strike: flaming rocks falling from the sky onto the target.
 * Ignores the `from` (caster) point: the meteor comes "from the sky",
 * so the fall always starts high above and to one side of the target.
 *
 *   1. THE FALL: a jagged, spinning rock with a molten rim and a
 *      glowing hot face, wrapped in fire, streaming flame licks and a
 *      smoke trail. A few smaller chunks (`rocks`) fall alongside on
 *      their own staggered paths and land around the target.
 *   2. IMPACT: a white-hot flash and a burst of fire, a shock ring
 *      flattened along the ground, a scorched crater, dust billowing
 *      out low, and rock chips thrown up on arcs that bounce and fade.
 *      Each smaller chunk lands with its own puff of dust and chips.
 *
 * Resolves the moment the main rock lands, so the caller's hit sound
 * and damage land with it; the dust and debris settle afterwards.
 *
 * Used by Meteor Shower, the Starfall Sling and the Meteorfall Mace.
 */
export function meteorStrike(
  scene: Phaser.Scene,
  _from: Pt,
  to: Pt,
  color = COLOURS.fire,
  durationMs = 420,
  opts: {
    /** Molten rim / hot face colour. */
    ember?: number;
    rock?: number;
    dust?: number;
    smoke?: number;
    /** Extra smaller rocks falling alongside the main one. */
    rocks?: number;
    /** Size multiplier for the rocks and the impact. */
    size?: number;
  } = {},
): Promise<void> {
  const K = Math.max(0.3, opts.size ?? 1);
  const c = {
    body: opts.rock ?? 0x4a3a30,
    rim: opts.ember ?? COLOURS.ember,
    hot: 0xfff1c2,
    fire: color,
    ember: opts.ember ?? COLOURS.ember,
    smoke: opts.smoke ?? 0x2b2124,
  };
  const DUST = opts.dust ?? 0x8a7560;
  const extra = Math.max(0, Math.round(opts.rocks ?? 3));
  const side = Math.random() < 0.5 ? -1 : 1;

  return new Promise((resolve) => {
    // Ask the host to frame the target and the sky the rocks fall from.
    scene.events.emit(SKY_FOCUS_EVENT, { x: to.x, y: to.y, sky: 240, ms: durationMs });
    // Smaller chunks: offset starts, landing scattered around the
    // target, some ahead of the main rock and some just after it.
    for (let i = 0; i < extra; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = (14 + Math.random() * 16) * K;
      const land = { x: to.x + Math.cos(a) * d, y: to.y + Math.sin(a) * d * 0.5 + 4 };
      const start = {
        x: land.x + side * (70 + Math.random() * 40),
        y: land.y - 200 - Math.random() * 60,
      };
      const delay = (Math.random() - 0.3) * durationMs * 0.35;
      scene.time.delayedCall(Math.max(0, delay + durationMs * 0.12), () => {
        void fallingRock(scene, start, land, (2.5 + Math.random() * 2) * K, durationMs * (0.8 + Math.random() * 0.3), c)
          .then(() => {
            const pop = arCircle(scene, land.x, land.y, 3 * K, c.ember, 0.9).setDepth(72).setBlendMode(1);
            scene.tweens.add({ targets: pop, radius: 10 * K, alpha: 0, duration: 160, onComplete: () => pop.destroy() });
            dustCloud(scene, land, 3, K * 0.55, DUST);
            rockDebris(scene, land, 3, K * 0.6, c);
          });
      });
    }

    // The main rock.
    const start: Pt = { x: to.x + side * 84, y: to.y - 220 };
    void fallingRock(scene, start, to, 7 * K, durationMs, c).then(() => {
      // Scorched crater, left a moment then faded. Low depth so it
      // sits on the ground under the combatants.
      const crater = arEllipse(scene, to.x, to.y + 8, 30 * K, 11 * K, 0x1a1210, 0.55)
        .setDepth(1);
      scene.tweens.add({
        targets: crater, alpha: 0, delay: 500, duration: 700,
        onComplete: () => crater.destroy(),
      });
      // White-hot flash.
      const flash = arCircle(scene, to.x, to.y, 8 * K, COLOURS.white, 1).setDepth(73).setBlendMode(1);
      scene.tweens.add({
        targets: flash, radius: 30 * K, alpha: 0, duration: 200,
        onComplete: () => flash.destroy(),
      });
      // Burst of fire.
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * 16 * K;
        const blob = arCircle(scene, to.x, to.y, (4 + Math.random() * 3) * K, i % 3 === 0 ? c.ember : color, 0.9)
          .setDepth(70)
          .setBlendMode(1);
        scene.tweens.add({
          targets: blob,
          x: to.x + Math.cos(a) * d,
          y: to.y + Math.sin(a) * d * 0.6 - 8 * K,
          radius: (10 + Math.random() * 6) * K,
          alpha: 0,
          duration: 300 + Math.random() * 160,
          ease: "Quad.Out",
          onComplete: () => blob.destroy(),
        });
      }
      // Shock ring, squashed flat so it reads as running along the ground.
      const ring = arEllipse(scene, to.x, to.y + 6, 20 * K, 8 * K).setDepth(69);
      ring.setStrokeStyle(3, c.ember, 0.9);
      scene.tweens.add({
        targets: ring, scaleX: 3.4, scaleY: 3.4, alpha: 0, duration: 380, ease: "Cubic.Out",
        onComplete: () => ring.destroy(),
      });
      dustCloud(scene, to, 9, K, DUST);
      rockDebris(scene, to, 10, K, c);
      // Embers drifting up out of the strike.
      for (let i = 0; i < 8; i++) {
        const e = arCircle(scene, to.x + (Math.random() - 0.5) * 16 * K, to.y, 1.2 + Math.random(), c.ember, 1)
          .setDepth(72);
        scene.tweens.add({
          targets: e,
          x: e.x + (Math.random() - 0.5) * 20,
          y: to.y - (20 + Math.random() * 26) * K,
          alpha: 0,
          duration: 500 + Math.random() * 300,
          onComplete: () => e.destroy(),
        });
      }
      resolve();
    });
  });
}

/**
 * Magic Dart: a fast arcane orb streaking straight from caster to
 * target with a trail of fading sparkles behind it and a small white
 * impact flash at the endpoint. Distinct from the gentle bowed
 * `projectileLine` so directional dart casts read as "magic missile",
 * not "thrown rock".
 */
export function magicDart(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  color = COLOURS.arcane,
  durationMs = 240,
): Promise<void> {
  return new Promise((resolve) => {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    // Lead orb + soft halo travel together.
    const orb  = scene.add.circle(from.x, from.y, 5, color, 1).setDepth(60);
    const halo = scene.add.circle(from.x, from.y, 11, color, 0.35).setDepth(59);

    // Sparkle trail dropped along the flight path. Phaser tweens'
    // onUpdate fires every frame, but spawning per-frame would be
    // wasteful — sample 8 evenly-spaced points instead.
    const trailCount = 8;
    const interval = durationMs / trailCount;
    for (let i = 0; i < trailCount; i++) {
      scene.time.delayedCall(i * interval, () => {
        const t = (i + 0.5) / trailCount;
        const sx = from.x + (to.x - from.x) * t;
        const sy = from.y + (to.y - from.y) * t;
        const spark = scene.add
          .circle(sx, sy, 2.5 + Math.random(), color, 0.8)
          .setDepth(58);
        scene.tweens.add({
          targets: spark,
          alpha: 0,
          radius: 0.5,
          duration: 320,
          onComplete: () => spark.destroy(),
        });
      });
    }

    scene.tweens.add({
      targets: [orb, halo],
      x: to.x, y: to.y,
      duration: durationMs,
      ease: "Quad.Out",
      onComplete: () => {
        orb.destroy();
        halo.destroy();
        // Bright impact pop — ring + brief white flash.
        const flash = scene.add.circle(to.x, to.y, 4, COLOURS.white, 1).setDepth(62);
        const ring  = scene.add.circle(to.x, to.y, 6, color, 0).setDepth(61)
          .setStrokeStyle(2, color, 0.9);
        scene.tweens.add({
          targets: flash, radius: 14, alpha: 0,
          duration: 220,
          onComplete: () => flash.destroy(),
        });
        scene.tweens.add({
          targets: ring, radius: 22, alpha: 0,
          duration: 280,
          onComplete: () => { ring.destroy(); resolve(); },
        });
        // Suppress unused lint on `angle` while keeping the symbol
        // available if a future tweak wants to rotate the impact.
        void angle;
      },
    });
  });
}

/**
 * Void Orb: a large, glowing, MULTI-COLOURED sphere that streaks from
 * the caster to a single target. Layered shells (dark halo → bright
 * mid → white core) churn through a void palette (violet, magenta,
 * cyan, indigo) as it flies, trailing scattered multi-coloured sparks.
 * On arrival it implodes to a point, then erupts in a white flash, a
 * twin shockwave ring, and a multi-coloured ember scatter — a clearly
 * "ultimate" read, distinct from the fire / arcane projectiles it used
 * to borrow.
 */
export function voidOrb(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  _color = COLOURS.curse,
  durationMs = 520,
): Promise<void> {
  return new Promise((resolve) => {
    // The orb cycles through these so it reads as "multi-coloured"
    // rather than a single tint.
    const palette = [0x9d4cff, 0xff4cf0, 0x4cc8ff, 0x6a3cff, 0xc28bff, 0x2ad6c8];

    // Layered shells travel together; a timer recolours them.
    const halo  = scene.add.circle(from.x, from.y, 18, palette[2], 0.26).setDepth(59);
    const outer = scene.add.circle(from.x, from.y, 12, palette[0], 0.55).setDepth(60);
    const mid   = scene.add.circle(from.x, from.y, 8,  palette[1], 0.85).setDepth(61);
    const core  = scene.add.circle(from.x, from.y, 4,  COLOURS.white, 1).setDepth(62);
    const shells = [halo, outer, mid, core];

    // Shimmer: rotate the palette across the shells (and breathe the
    // halo) so the orb visibly churns through colours in flight.
    let step = 0;
    const shimmer = scene.time.addEvent({
      delay: 60,
      loop: true,
      callback: () => {
        outer.setFillStyle(palette[step % palette.length], 0.55);
        mid.setFillStyle(palette[(step + 2) % palette.length], 0.85);
        halo.setFillStyle(palette[(step + 4) % palette.length], 0.26);
        halo.setScale(1 + 0.14 * Math.sin(step * 0.8));
        step += 1;
      },
    });

    // Scattered multi-coloured spark trail along the flight path.
    const trailCount = 12;
    const interval = durationMs / trailCount;
    for (let i = 0; i < trailCount; i++) {
      scene.time.delayedCall(i * interval, () => {
        const t = (i + 0.5) / trailCount;
        const sx = lerp(from.x, to.x, t) + (Math.random() - 0.5) * 9;
        const sy = lerp(from.y, to.y, t) + (Math.random() - 0.5) * 9;
        const c = palette[Math.floor(Math.random() * palette.length)];
        const spark = scene.add
          .circle(sx, sy, 2 + Math.random() * 2, c, 0.85)
          .setDepth(58);
        scene.tweens.add({
          targets: spark, alpha: 0, radius: 0.5,
          duration: 360,
          onComplete: () => spark.destroy(),
        });
      });
    }

    scene.tweens.add({
      targets: shells,
      x: to.x, y: to.y,
      duration: durationMs,
      ease: "Quad.In", // accelerate as the void collapses inward
      onComplete: () => {
        shimmer.remove();
        // Implode to a bright point...
        scene.tweens.add({
          targets: shells, radius: 0.5,
          duration: 90,
          onComplete: () => {
            shells.forEach((s) => s.destroy());
            // Resolve at the eruption so the caller's hit sound and
            // damage land with the flash; the rings play on.
            resolve();
            // ...then erupt: white flash + twin multi-coloured rings.
            const flash = scene.add.circle(to.x, to.y, 6, COLOURS.white, 1).setDepth(64);
            scene.tweens.add({
              targets: flash, radius: 26, alpha: 0,
              duration: 240,
              onComplete: () => flash.destroy(),
            });
            [palette[0], palette[2]].forEach((c, idx) => {
              const ring = scene.add
                .circle(to.x, to.y, 8, c, 0)
                .setDepth(63)
                .setStrokeStyle(3, c, 0.9);
              scene.tweens.add({
                targets: ring, radius: 40 + idx * 12, alpha: 0,
                duration: 360 + idx * 90,
                onComplete: () => ring.destroy(),
              });
            });
            void radialBurst(scene, to, palette[1], palette[3], 60);
          },
        });
      },
    });
  });
}

/**
 * Magic Arrow: an elongated glowing shaft with a brighter tip and a
 * sparkle trail. Aimed at a specific target (no arc, fast linear
 * flight) — visually distinct from a regular bow shot so casters
 * reading the arena can tell magic from mundane.
 */
export function magicArrow(
  scene: Phaser.Scene,
  from: Pt, to: Pt,
  color = COLOURS.lightning,
  durationMs = 280,
): Promise<void> {
  return new Promise((resolve) => {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const shaft = scene.add.rectangle(from.x, from.y, 18, 3, color, 1).setDepth(60);
    shaft.rotation = angle;
    const tip = scene.add.circle(from.x, from.y, 3.5, COLOURS.white, 1).setDepth(61);

    const trailCount = 7;
    const interval = durationMs / trailCount;
    for (let i = 0; i < trailCount; i++) {
      scene.time.delayedCall(i * interval, () => {
        const t = (i + 0.5) / trailCount;
        const sx = from.x + (to.x - from.x) * t;
        const sy = from.y + (to.y - from.y) * t;
        const spark = scene.add
          .circle(sx, sy, 2, color, 0.85)
          .setDepth(58);
        scene.tweens.add({
          targets: spark, alpha: 0,
          duration: 360,
          onComplete: () => spark.destroy(),
        });
      });
    }

    scene.tweens.add({
      targets: [shaft, tip],
      x: to.x, y: to.y,
      duration: durationMs,
      ease: "Quad.In",
      onComplete: () => {
        shaft.destroy();
        tip.destroy();
        // Impact: 6 spark fragments fanning outward + a centre flash.
        const sparks = 6;
        for (let i = 0; i < sparks; i++) {
          const a = (i / sparks) * Math.PI * 2;
          const tx = to.x + Math.cos(a) * 14;
          const ty = to.y + Math.sin(a) * 14;
          const frag = scene.add.rectangle(to.x, to.y, 3, 3, COLOURS.white, 1).setDepth(62);
          scene.tweens.add({
            targets: frag, x: tx, y: ty, alpha: 0,
            duration: 280,
            onComplete: () => frag.destroy(),
          });
        }
        scene.time.delayedCall(280, () => resolve());
      },
    });
  });
}

/**
 * Radial burst — used for Fireball / Turn Undead. Paints an expanding
 * filled circle plus a ring of dots that scatter outward.
 */
export function radialBurst(
  scene: Phaser.Scene,
  at: Pt,
  color = COLOURS.fire,
  emberColor = COLOURS.ember,
  radius = 56,
): Promise<void> {
  return new Promise((resolve) => {
    const orb = scene.add.circle(at.x, at.y, 8, color, 0.85).setDepth(55);
    scene.tweens.add({
      targets: orb,
      radius, alpha: 0,
      duration: 380,
      onComplete: () => orb.destroy(),
    });
    const ring = scene.add.circle(at.x, at.y, 4, emberColor, 0).setDepth(56);
    ring.setStrokeStyle(2, emberColor, 1);
    scene.tweens.add({
      targets: ring,
      radius: radius + 8, alpha: 0,
      duration: 480,
      onComplete: () => ring.destroy(),
    });
    // Embers — small dots flying outward.
    const sparks = 10;
    for (let i = 0; i < sparks; i++) {
      const a = (i / sparks) * Math.PI * 2;
      const sx = at.x, sy = at.y;
      const tx = sx + Math.cos(a) * (radius + 6);
      const ty = sy + Math.sin(a) * (radius + 6);
      const dot = scene.add.rectangle(sx, sy, 4, 4, emberColor, 1).setDepth(57);
      scene.tweens.add({
        targets: dot, x: tx, y: ty, alpha: 0,
        duration: 460,
        onComplete: () => dot.destroy(),
      });
    }
    scene.time.delayedCall(480, () => resolve());
  });
}

/**
 * Dragon's-breath cone — a torrent of flame erupting from `from`
 * (the dragon's mouth, in screen px) toward `to` (the victim's
 * cell, also screen px). Three composited layers carry the look:
 *
 *   1. A widening fire CONE — a triangular fan of overlapping
 *      semi-transparent orange/yellow ellipses tracking from
 *      caster to target. Each "tongue" is offset perpendicular
 *      to the breath axis so the silhouette reads as a forked
 *      jet, not a single beam.
 *   2. A STREAM of jittering ember dots travelling along the
 *      cone axis with slight perpendicular wobble — the visual
 *      "fuel" of the breath, persistent over the whole cast so
 *      the eye can't miss it.
 *   3. A fire IMPACT at the target — a quick fireball-style
 *      radial pop using the same VFX_COLOURS.fire / .ember
 *      palette as the explicit `radialBurst` so the impact
 *      reads at parity with caster-fired fireballs.
 *
 * Coordinates are screen pixels (caller resolves grid → px). The
 * returned Promise resolves a beat after the longest cue so a
 * caller can `await` before resolving HP damage or moving on to
 * the next combat action without the breath cutting off mid-flight.
 *
 * `width` defaults to ~1.4 tiles at the target end — wide enough
 * to read as a cone, narrow enough that the dragon isn't drawing
 * fire across half the arena. `durationMs` is the cone's lifetime
 * (the impact + linger add a small tail).
 */
export function breathOfFire(
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  opts: { width?: number; durationMs?: number; fire?: number; ember?: number } = {},
): Promise<void> {
  const width = opts.width ?? TILE * 1.4;
  const durationMs = opts.durationMs ?? 520;
  const FIRE_C = opts.fire ?? COLOURS.fire;
  const EMBER_C = opts.ember ?? COLOURS.ember;
  return new Promise((resolve) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    // Perpendicular axis — used to fan tongues + jitter embers
    // across the cone's width.
    const px = -Math.sin(angle);
    const py = Math.cos(angle);

    // ── Layer 1: cone tongues ────────────────────────────────────
    // Five overlapping flame "tongues", each a tall ellipse rotated
    // along the breath axis. Tongues spawn at the dragon's mouth
    // anchored to the caster end, scale outward toward the target,
    // and fade as they go. The perpendicular spread grows linearly
    // with travel so the silhouette opens into a proper cone.
    const TONGUES = 5;
    for (let i = 0; i < TONGUES; i++) {
      // Spread offsets fan from -0.5 .. +0.5 of the cone width.
      const spread = (i / (TONGUES - 1) - 0.5) * width;
      const startX = from.x;
      const startY = from.y;
      const endX = to.x + px * spread;
      const endY = to.y + py * spread;
      // Each tongue's body is a thin ellipse — width along the
      // cone axis, height perpendicular. Color alternates between
      // the deep fire orange and the brighter ember yellow so the
      // overlap reads as turbulence rather than a flat fill.
      const colour = i % 2 === 0 ? FIRE_C : EMBER_C;
      const tongue = scene.add
        .ellipse(startX, startY, 4, 10, colour, 0.85)
        .setDepth(58);
      tongue.rotation = angle;
      scene.tweens.add({
        targets: tongue,
        x: (startX + endX) / 2,
        y: (startY + endY) / 2,
        scaleX: Math.max(2, dist / 14),
        scaleY: 1.6 + Math.random() * 0.6,
        alpha: 0,
        // Stagger each tongue slightly so the breath looks like
        // it's pulsing forward rather than appearing all at once.
        delay: i * 28,
        duration: durationMs,
        ease: "Quad.Out",
        onComplete: () => tongue.destroy(),
      });
    }

    // ── Layer 2: ember stream ────────────────────────────────────
    // Lots of small dots travelling along the cone axis with random
    // perpendicular jitter — the "fuel" of the breath. Spawned at a
    // steady cadence over the breath's lifetime so the cone looks
    // continuously alive rather than a single flash.
    const EMBER_COUNT = 22;
    const interval = durationMs / EMBER_COUNT;
    const emberColors = [FIRE_C, EMBER_C, COLOURS.white];
    for (let i = 0; i < EMBER_COUNT; i++) {
      scene.time.delayedCall(i * interval * 0.6, () => {
        // Small per-ember randomisation makes the stream feel
        // alive — not every ember reaches the same depth, not
        // every one drifts the same way.
        const travel = 0.4 + Math.random() * 0.6;
        const jitterStart = (Math.random() - 0.5) * (width * 0.18);
        const jitterEnd = (Math.random() - 0.5) * width;
        const sx = from.x + px * jitterStart;
        const sy = from.y + py * jitterStart;
        const ex = from.x + dx * travel + px * jitterEnd;
        const ey = from.y + dy * travel + py * jitterEnd;
        const c = emberColors[i % emberColors.length];
        const dot = scene.add
          .circle(sx, sy, 2 + Math.random() * 1.5, c, 1)
          .setDepth(60);
        scene.tweens.add({
          targets: dot,
          x: ex,
          y: ey,
          alpha: 0,
          radius: 0.5,
          duration: 380 + Math.random() * 240,
          ease: "Cubic.Out",
          onComplete: () => dot.destroy(),
        });
      });
    }

    // ── Layer 3: target impact ───────────────────────────────────
    // Fire the impact ~70% of the way through the cone so it
    // visually "follows" the leading edge of the breath rather
    // than detonating before the flames arrive. radialBurst gives
    // us a fireball-quality pop for free; the tighter radius
    // keeps it inside the target tile.
    const impactDelay = Math.round(durationMs * 0.7);
    scene.time.delayedCall(impactDelay, () => {
      void radialBurst(scene, to, FIRE_C, EMBER_C, 36);
    });

    // Resolve slightly after the impact + ember tail so an
    // awaiting caller doesn't move on while flames are still
    // visible.
    scene.time.delayedCall(durationMs + 260, () => resolve());
  });
}

/**
 * Hellfire / monster Fireball — a roiling ball of flame hurled from
 * `from` to `to`, then a fiery eruption on the target:
 *
 *   1. The BALL: dark-red shell, orange body and white-hot core, each
 *      flickering in size every frame, flying on a low arc with flames
 *      licking off it, bright embers drifting up and faint smoke.
 *   2. The ERUPTION: a white-hot flash and a billowing cloud of red /
 *      orange / gold fire blobs.
 *   3. FLAME TONGUES rising from the target's feet, sparks thrown up
 *      and falling back, and smoke drifting up after the blast.
 *
 * Resolves once the blast has landed so the caller can apply the HP
 * flash after the flames arrive.
 */
export function hellfire(
  scene: Phaser.Scene,
  from: Pt,
  to: Pt,
  opts: {
    flightMs?: number;
    /** Size multiplier for the ball and the eruption (1 = default). */
    size?: number;
    outer?: number;
    body?: number;
    ember?: number;
    core?: number;
    smoke?: number;
  } = {},
): Promise<void> {
  const DEEP = opts.outer ?? 0xc0260f;   // hellfire red
  const FIRE = opts.body ?? COLOURS.fire;
  const EMBER = opts.ember ?? COLOURS.ember;
  const CORE = opts.core ?? 0xfff1c2;
  const SMOKE = opts.smoke ?? 0x2b2124;
  const K = Math.max(0.3, opts.size ?? 1);
  const FLAME = [DEEP, FIRE, FIRE, EMBER];
  const pick = () => FLAME[Math.floor(Math.random() * FLAME.length)];
  const dist = distBetween(from.x, from.y, to.x, to.y);
  const flight = opts.flightMs ?? Math.max(340, Math.min(640, dist * 1.6));
  // Low arc — control point lifted above the midpoint.
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - Math.min(36, dist * 0.22);
  const at = (t: number): Pt => {
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    };
  };

  return new Promise((resolve) => {
    const shell = scene.add.circle(from.x, from.y, 12 * K, DEEP, 0.6).setDepth(60);
    const body = scene.add.circle(from.x, from.y, 8.5 * K, FIRE, 0.95).setDepth(61);
    const core = scene.add.circle(from.x, from.y, 4.5 * K, CORE, 1).setDepth(62);
    let lastShed = -1;
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: flight,
      ease: "Sine.In",
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const p = at(t);
        // Flicker: each layer breathes at its own random rate.
        shell.setPosition(p.x, p.y).setRadius((10.5 + Math.random() * 4) * K);
        body
          .setPosition(p.x + (Math.random() - 0.5) * 2, p.y + (Math.random() - 0.5) * 2)
          .setRadius((7.5 + Math.random() * 2.5) * K);
        core.setPosition(p.x, p.y).setRadius((3.5 + Math.random() * 1.8) * K);
        if (t - lastShed < 0.02) return;
        lastShed = t;
        // Flames licking off the ball, streaming back and up.
        for (let k = 0; k < 2; k++) {
          const lick = scene.add
            .ellipse(
              p.x + (Math.random() - 0.5) * 10,
              p.y + (Math.random() - 0.5) * 10,
              6 + Math.random() * 4,
              9 + Math.random() * 6,
              pick(),
              0.85,
            )
            .setDepth(59);
          scene.tweens.add({
            targets: lick,
            y: lick.y - 8 - Math.random() * 10,
            scaleX: 0.3,
            scaleY: 0.5,
            alpha: 0,
            duration: 260 + Math.random() * 200,
            onComplete: () => lick.destroy(),
          });
        }
        // Bright embers drifting up out of the trail.
        const ember = scene.add
          .circle(p.x, p.y, 1.2 + Math.random() * 1.4, Math.random() < 0.6 ? EMBER : CORE, 1)
          .setDepth(59);
        scene.tweens.add({
          targets: ember,
          x: ember.x + (Math.random() - 0.5) * 10,
          y: ember.y - 12 - Math.random() * 14,
          alpha: 0,
          duration: 420 + Math.random() * 260,
          onComplete: () => ember.destroy(),
        });
        // A little dark smoke, kept faint.
        if (Math.random() < 0.25) {
          const puff = scene.add.circle(p.x, p.y, 4, SMOKE, 0.28).setDepth(58);
          scene.tweens.add({
            targets: puff,
            y: puff.y - 12,
            radius: 9,
            alpha: 0,
            duration: 560,
            onComplete: () => puff.destroy(),
          });
        }
      },
      onComplete: () => {
        shell.destroy();
        body.destroy();
        core.destroy();
        // ── Eruption: a white-hot flash, then a billowing fire cloud ─
        const flash = scene.add.circle(to.x, to.y, 8, CORE, 1).setDepth(64);
        scene.tweens.add({
          targets: flash,
          radius: 26 * K,
          alpha: 0,
          duration: 200,
          onComplete: () => flash.destroy(),
        });
        for (let i = 0; i < 9; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * TILE * 0.45 * K;
          const blob = scene.add
            .circle(to.x + Math.cos(a) * d * 0.4, to.y + Math.sin(a) * d * 0.4, 5 + Math.random() * 4, pick(), 0.9)
            .setDepth(62);
          scene.tweens.add({
            targets: blob,
            x: to.x + Math.cos(a) * d,
            y: to.y + Math.sin(a) * d - TILE * 0.25,
            radius: (11 + Math.random() * 7) * K,
            alpha: 0,
            delay: Math.random() * 80,
            duration: 380 + Math.random() * 220,
            ease: "Quad.Out",
            onComplete: () => blob.destroy(),
          });
        }
        // ── Flame tongues rising from the target's feet ──────────
        const TONGUES = 10;
        for (let i = 0; i < TONGUES; i++) {
          const ox = (i / (TONGUES - 1) - 0.5) * TILE * 1.1 * K;
          const tongue = scene.add
            .ellipse(to.x + ox, to.y + TILE * 0.4, 6, 10, pick(), 0.95)
            .setDepth(61);
          scene.tweens.add({
            targets: tongue,
            y: to.y - TILE * K * (0.25 + Math.random() * 0.6),
            scaleY: 2.4 + Math.random() * 1.4,
            scaleX: 0.55,
            alpha: 0,
            delay: 40 + Math.random() * 220,
            duration: 520 + Math.random() * 260,
            ease: "Quad.Out",
            onComplete: () => tongue.destroy(),
          });
        }
        // Sparks thrown up and falling back.
        for (let i = 0; i < 14; i++) {
          const spark = scene.add
            .circle(to.x, to.y, 1.4 + Math.random(), Math.random() < 0.5 ? EMBER : CORE, 1)
            .setDepth(63);
          const vx = (Math.random() - 0.5) * TILE * 1.6;
          const peak = TILE * (0.6 + Math.random() * 0.7);
          scene.tweens.add({
            targets: spark,
            x: to.x + vx,
            duration: 620,
            onComplete: () => spark.destroy(),
          });
          scene.tweens.add({
            targets: spark,
            y: to.y - peak,
            duration: 300,
            ease: "Quad.Out",
            yoyo: true,
          });
          scene.tweens.add({ targets: spark, alpha: 0, delay: 360, duration: 260 });
        }
        // Smoke drifting up after the blast.
        for (let i = 0; i < 4; i++) {
          const puff = scene.add
            .circle(to.x + (Math.random() - 0.5) * 14, to.y - 4, 5, SMOKE, 0.35)
            .setDepth(57);
          scene.tweens.add({
            targets: puff,
            y: to.y - TILE * (0.9 + Math.random() * 0.5),
            radius: 11 + Math.random() * 4,
            alpha: 0,
            delay: 260 + i * 80,
            duration: 760,
            onComplete: () => puff.destroy(),
          });
        }
        scene.time.delayedCall(480, () => resolve());
      },
    });
  });
}

/**
 * Rising green sparkles for heal-type spells. Spawns a handful of dots
 * just below the target sprite that float up while fading.
 */
export function healingSparkles(
  scene: Phaser.Scene,
  at: Pt,
  count = 8,
  opts: { color?: number; accent?: number } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const colors = [opts.color ?? COLOURS.heal, opts.accent ?? 0xb4f5be, 0xeaffe0];
    for (let i = 0; i < count; i++) {
      const ox = (Math.random() - 0.5) * TILE;
      const sx = at.x + ox;
      const sy = at.y + TILE / 2;
      const dot = scene.add.circle(
        sx, sy, 2.5, colors[i % colors.length], 1,
      ).setDepth(55);
      scene.tweens.add({
        targets: dot,
        y: sy - TILE - 8 - Math.random() * 8,
        alpha: 0,
        duration: 700 + Math.random() * 300,
        delay: Math.random() * 120,
        onComplete: () => dot.destroy(),
      });
    }
    scene.time.delayedCall(900, () => resolve());
  });
}

/**
 * Campfire rest — fired when the party uses Camping Supplies on the
 * Party screen. Plays a stack of three cues so the rest reads as
 * something more substantial than a one-shot heal:
 *
 *   1. A warm orange glow pool at the party's feet (slow fade-in
 *      then fade-out, like a settled fire).
 *   2. A couple of flame-shaped "flicker" tongues licking upward
 *      from the centre, slightly off-axis so they read as a fire
 *      rather than a heal sparkle.
 *   3. ~10 ember dots drifting upward and fading — the same idea
 *      as healingSparkles but tinted ember / fire so it doesn't
 *      look like a Cleric heal.
 *
 * Tunable counts default to a comfortable middle setting; tests
 * can pass `embers: 0, flickers: 0` to keep the helper cheap.
 */
export function campfireRest(
  scene: Phaser.Scene,
  at: Pt,
  opts: { embers?: number; flickers?: number } = {},
): Promise<void> {
  const embers = opts.embers ?? 10;
  const flickers = opts.flickers ?? 3;
  return new Promise((resolve) => {
    // 1. Warm pool of light at the party's feet. Fades in over the
    //    first third of the animation, holds briefly, then fades out.
    const pool = scene.add
      .circle(at.x, at.y + TILE * 0.25, TILE * 0.55, COLOURS.fire, 0)
      .setDepth(44);
    scene.tweens.add({
      targets: pool,
      alpha: 0.35,
      duration: 320,
      yoyo: true,
      hold: 380,
      onComplete: () => pool.destroy(),
    });

    // 2. Flame flicker tongues — short vertical ellipses that pop
    //    up off the pool centre and fade as they rise.
    for (let i = 0; i < flickers; i++) {
      const ox = (Math.random() - 0.5) * TILE * 0.4;
      const flame = scene.add
        .ellipse(
          at.x + ox,
          at.y + TILE * 0.15,
          TILE * 0.18,
          TILE * 0.32,
          COLOURS.ember,
          0.85,
        )
        .setDepth(46);
      scene.tweens.add({
        targets: flame,
        y: flame.y - TILE * 0.5,
        scaleX: 0.6,
        scaleY: 1.3,
        alpha: 0,
        duration: 480 + Math.random() * 160,
        delay: 80 + i * 70,
        onComplete: () => flame.destroy(),
      });
    }

    // 3. Rising embers. Same broad idea as healingSparkles but
    //    fire-tinted and lifted a little higher so the eye reads
    //    "smoke + sparks off a fire" rather than "heal sparkles".
    const colors = [COLOURS.ember, COLOURS.fire, 0xfff1c2];
    for (let i = 0; i < embers; i++) {
      const ox = (Math.random() - 0.5) * TILE * 0.7;
      const sx = at.x + ox;
      const sy = at.y + TILE / 3;
      const dot = scene.add
        .circle(sx, sy, 2 + Math.random() * 1.2, colors[i % colors.length], 1)
        .setDepth(55);
      scene.tweens.add({
        targets: dot,
        // Embers drift slightly side-to-side as they rise.
        x: sx + (Math.random() - 0.5) * TILE * 0.5,
        y: sy - TILE * 1.2 - Math.random() * 12,
        alpha: 0,
        duration: 900 + Math.random() * 400,
        delay: 60 + Math.random() * 280,
        onComplete: () => dot.destroy(),
      });
    }

    // Resolve a little after the longest cue so callers awaiting the
    // promise get a clean "rest finished" moment.
    scene.time.delayedCall(1300, () => resolve());
  });
}

/**
 * Item-pickup sparkle — fired when the party walks onto a map cell
 * carrying an item and collects it. A warm golden "collected!" cue
 * composited from three layers, sized to a single tile so it reads
 * as picking something up off the ground:
 *
 *   1. A soft filled glow pool that blooms briefly and fades.
 *   2. An expanding golden ring (the "pop").
 *   3. A handful of gold/ember/white sparkles rising and fading.
 *
 * Coordinates are screen pixels (caller resolves grid → centre px).
 * `depth` lets the caller lift the effect above whatever sits on the
 * tile — on the overworld the party sprite rides high (depth ~300),
 * so the host passes a depth above that; the combat default (60)
 * suits the arena's lower depth band. Non-blocking: the helper owns
 * and cleans up its own objects.
 */
export function itemPickup(
  scene: Phaser.Scene,
  at: Pt,
  opts: { color?: number; depth?: number } = {},
): void {
  const color = opts.color ?? COLOURS.buff;
  const depth = opts.depth ?? 60;

  // 1. Soft glow pool — blooms outward from the tile centre.
  const glow = scene.add
    .circle(at.x, at.y, TILE * 0.28, color, 0.5)
    .setDepth(depth - 1);
  scene.tweens.add({
    targets: glow,
    radius: TILE * 0.6,
    alpha: 0,
    duration: 420,
    ease: "Quad.Out",
    onComplete: () => glow.destroy(),
  });

  // 2. Expanding ring — the "pop".
  const ring = scene.add.circle(at.x, at.y, 6, color, 0).setDepth(depth);
  ring.setStrokeStyle(2, color, 0.9);
  scene.tweens.add({
    targets: ring,
    radius: TILE * 0.9,
    alpha: 0,
    duration: 480,
    ease: "Quad.Out",
    onComplete: () => ring.destroy(),
  });

  // 3. Rising sparkles — gold / ember / white motes drifting up.
  const colors = [COLOURS.buff, COLOURS.ember, COLOURS.white];
  const SPARKS = 8;
  for (let i = 0; i < SPARKS; i++) {
    const ox = (Math.random() - 0.5) * TILE * 0.8;
    const sx = at.x + ox;
    const sy = at.y + (Math.random() - 0.5) * TILE * 0.3;
    const dot = scene.add
      .circle(sx, sy, 1.6 + Math.random() * 1.4, colors[i % colors.length], 1)
      .setDepth(depth + 1);
    scene.tweens.add({
      targets: dot,
      x: sx + (Math.random() - 0.5) * TILE * 0.3,
      y: sy - TILE * 0.9 - Math.random() * 10,
      alpha: 0,
      duration: 600 + Math.random() * 260,
      delay: Math.random() * 120,
      onComplete: () => dot.destroy(),
    });
  }
}

/**
 * Buff aura — slow expanding ring around an ally. Used for Bless,
 * Shield, Long Shanks, Invisibility (slightly different colours per
 * source; caller picks).
 */
export function glowAura(
  scene: Phaser.Scene,
  at: Pt,
  color = COLOURS.buff,
  opts: { radius?: number; durationMs?: number; width?: number } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const ring = scene.add.circle(at.x, at.y, 10, color, 0).setDepth(45);
    ring.setStrokeStyle(opts.width ?? 2, color, 0.9);
    scene.tweens.add({
      targets: ring,
      radius: opts.radius ?? 28, alpha: 0,
      duration: opts.durationMs ?? 520,
      onComplete: () => { ring.destroy(); resolve(); },
    });
  });
}

/** Quick screen shake — used for crits, explosions, big damage. */
export function screenShake(
  scene: Phaser.Scene,
  intensity = 0.005,
  durationMs = 180,
): void {
  if (!scene.cameras?.main) return;
  scene.cameras.main.shake(durationMs, intensity);
}

/** Floating "miss" or "X" marker over a target. Doesn't block. */
export function floatingX(
  scene: Phaser.Scene,
  at: Pt,
): void {
  const t = scene.add.text(at.x, at.y - 4, "✕", {
    fontFamily: "Georgia, serif",
    fontSize: "20px",
    color: "#bdb38a",
    stroke: "#1a1a2e",
    strokeThickness: 3,
  }).setOrigin(0.5).setDepth(80);
  scene.tweens.add({
    targets: t, y: t.y - 16, alpha: 0,
    duration: 480,
    onComplete: () => t.destroy(),
  });
}

/**
 * Item-shatter effect — fired when a piece of equipment hits zero
 * durability and is destroyed. Layers four pieces of feedback so the
 * player can't miss it:
 *
 *   1. A bright radial burst at the wearer's body (orb + ring + sparks).
 *   2. ~10 jagged "fragments" (small rotating rectangles) flying
 *      outward in a ring, slowing and fading like real debris.
 *   3. A floating "<ITEM> SHATTERED!" label that rises and fades.
 *   4. A short camera shake — punchier than a normal crit because the
 *      player just lost a piece of gear.
 *
 * `color` and `accent` let the caller tint by item type (gold/red for
 * weapons, blue/white for armor); both default to fire-ember.
 */
export function shatterEffect(
  scene: Phaser.Scene,
  at: Pt,
  itemName: string,
  color = COLOURS.fire,
  accent = COLOURS.ember,
): void {
  // 1. Underlying burst — re-uses the existing radial-burst helper.
  void radialBurst(scene, at, color, accent, 50);

  // 2. Debris fragments — small rotating rectangles flying outward.
  const FRAGMENTS = 10;
  for (let i = 0; i < FRAGMENTS; i++) {
    const angle = (i / FRAGMENTS) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 28 + Math.random() * 28;
    const tx = at.x + Math.cos(angle) * dist;
    const ty = at.y + Math.sin(angle) * dist;
    const w = 3 + Math.random() * 3;
    const h = 5 + Math.random() * 4;
    const c = i % 2 === 0 ? color : accent;
    const frag = scene.add.rectangle(at.x, at.y, w, h, c, 1).setDepth(78);
    frag.rotation = Math.random() * Math.PI * 2;
    scene.tweens.add({
      targets: frag,
      x: tx, y: ty,
      rotation: frag.rotation + (Math.random() - 0.5) * 4,
      alpha: 0,
      duration: 520 + Math.random() * 200,
      ease: "Cubic.Out",
      onComplete: () => frag.destroy(),
    });
  }

  // 3. Floating label — rises ~28px while fading.
  const label = scene.add.text(at.x, at.y - 12, `${itemName.toUpperCase()} SHATTERED!`, {
    fontFamily: "Georgia, serif",
    fontSize: "12px",
    color: "#ffe48a",
    stroke: "#1a1a2e",
    strokeThickness: 4,
  }).setOrigin(0.5, 1).setDepth(82);
  scene.tweens.add({
    targets: label,
    y: label.y - 28,
    alpha: 0,
    duration: 900,
    onComplete: () => label.destroy(),
  });

  // 4. Camera shake — short and sharp.
  screenShake(scene, 0.008, 240);
}

/**
 * Party-member death sequence — body slumps + red burst + heavy
 * shake. Returns a Promise that resolves when the body animation
 * finishes (~700ms) so callers can chain the next combat action
 * after a beat.
 *
 * The body's rotation and alpha are mutated permanently so the
 * sprite stays "fallen" for the rest of the encounter (the scene's
 * `refreshVisibility` only touches alpha; rotation sticks). The
 * caller is still expected to dim the body to its dead alpha via
 * the usual visibility refresh — this helper just animates the
 * transition there.
 */
export function partyDeathSlump(
  scene: Phaser.Scene,
  body: Phaser.GameObjects.GameObject & { x: number; y: number; rotation: number; alpha: number },
): Promise<void> {
  // Underlying red burst — feels like a wound spraying outward.
  void radialBurst(scene, { x: body.x, y: body.y }, COLOURS.blood, COLOURS.fire, 36);
  screenShake(scene, 0.012, 360);
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: body,
      // Tilt onto the side and slide down a few pixels — reads as
      // "knocked over" without needing a custom death sprite.
      rotation: Math.PI / 2,
      y: body.y + 8,
      alpha: 0.35,
      duration: 600,
      ease: "Cubic.Out",
      onComplete: () => resolve(),
    });
  });
}

/**
 * Centre-arena banner announcing a party member's death. Big red
 * text with stroke, holds for ~2.4s then fades out over 600ms so
 * the next combat tick can move on. Returns immediately — the
 * banner cleans itself up. Pass arena bounds so the banner sits
 * over the playfield rather than the HUD column.
 */
export function partyDeathBanner(
  scene: Phaser.Scene,
  bounds: { x: number; y: number; width: number; height: number },
  name: string,
): void {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  // Smoky backdrop — slight darkening so the bright red text reads
  // even when the arena tile colour is similarly warm.
  const veil = scene.add
    .rectangle(cx, cy, bounds.width, 80, 0x000000, 0.55)
    .setOrigin(0.5)
    .setDepth(199)
    .setAlpha(0);
  const text = scene.add
    .text(cx, cy, `${name.toUpperCase()} HAS FALLEN!`, {
      fontFamily: "Georgia, serif",
      fontSize: "32px",
      color: "#ff4f4f",
      stroke: "#1a1a2e",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setDepth(200)
    .setAlpha(0);
  // Quick fade-in (180ms) → hold (~2s) → slow fade-out (600ms).
  // Tweening alpha rather than killing the timeline outright keeps
  // the message readable across the transition into the next turn.
  scene.tweens.add({
    targets: [veil, text],
    alpha: 1,
    duration: 180,
    onComplete: () => {
      scene.time.delayedCall(2000, () => {
        scene.tweens.add({
          targets: [veil, text],
          alpha: 0,
          duration: 600,
          onComplete: () => { veil.destroy(); text.destroy(); },
        });
      });
    },
  });
}

export const VFX_COLOURS = COLOURS;
