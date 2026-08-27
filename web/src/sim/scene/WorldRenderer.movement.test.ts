import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVE_TWEEN_MS,
  DEFAULT_STEP_ANIM,
  TILE_SIZE,
  WorldRenderer,
  type StepAnimConfig,
} from "./WorldRenderer";

/**
 * Movement-interpolation tests for WorldRenderer.
 *
 * WorldRenderer imports Phaser with `import type`, which TypeScript
 * erases at compile time — so the module has no runtime dependency on
 * the engine and we can drive it with a hand-rolled fake scene under
 * plain node, no jsdom or canvas required. The fake records the tween
 * configs it is handed rather than running them, which is exactly the
 * surface these tests care about: *whether* a move slides or snaps,
 * and how the in-flight flag is managed around it.
 */

interface FakeImage {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  destroyed: boolean;
  texture: { key: string };
  setOrigin(): FakeImage;
  setDisplaySize(w: number, h: number): FakeImage;
  setDepth(): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setTexture(k: string): FakeImage;
  setVisible(): FakeImage;
  setFlipX(v: boolean): FakeImage;
  setData(k: string, v: unknown): FakeImage;
  getData(k: string): unknown;
  destroy(): void;
}

function fakeImage(x: number, y: number, key: string): FakeImage {
  // Real backing store for setData/getData — the step animation keeps
  // its base scale and current bob offset there, so a no-op stub would
  // quietly make the unwind logic untestable.
  const data = new Map<string, unknown>();
  const img: FakeImage = {
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    flipX: false,
    destroyed: false,
    texture: { key },
    setOrigin: () => img,
    setDisplaySize(w: number, h: number) {
      // Every sprite in this project is a 32x32 source PNG, so scale
      // is display size over tile size — which is how the renderer
      // ends up with roamers at 0.95 and the party at 1.
      img.scaleX = w / 32;
      img.scaleY = h / 32;
      return img;
    },
    setDepth: () => img,
    setPosition(nx: number, ny: number) {
      img.x = nx;
      img.y = ny;
      return img;
    },
    setTexture(k: string) {
      img.texture.key = k;
      return img;
    },
    setVisible: () => img,
    setFlipX(v: boolean) {
      img.flipX = v;
      return img;
    },
    setData(k: string, v: unknown) {
      data.set(k, v);
      return img;
    },
    getData(k: string) {
      return data.get(k);
    },
    destroy() {
      img.destroyed = true;
    },
  };
  return img;
}

interface TweenCfg {
  targets: unknown;
  x?: number;
  y?: number;
  duration?: number;
  ease?: string;
  onUpdate?: (tween: { progress: number }) => void;
  onComplete?: () => void;
}

function fakeScene() {
  const tweensAdded: TweenCfg[] = [];
  const killed: unknown[] = [];
  const scene = {
    textures: { exists: () => true },
    add: {
      image: (x: number, y: number, key: string) => fakeImage(x, y, key),
      // Chainable no-op Graphics. The renderer uses it two ways —
      // baking placeholder textures, and the immediate-mode quest
      // halo — and neither asserts on pixels here, so every method
      // just returns the object.
      graphics: () => {
        const g: Record<string, unknown> = {};
        for (const m of [
          "fillStyle",
          "fillRect",
          "fillCircle",
          "lineStyle",
          "strokeCircle",
          "beginPath",
          "moveTo",
          "lineTo",
          "strokePath",
          "generateTexture",
          "setDepth",
          "clear",
          "destroy",
        ]) {
          g[m] = () => g;
        }
        return g;
      },
    },
    tweens: {
      add(cfg: TweenCfg) {
        tweensAdded.push(cfg);
        return cfg;
      },
      killTweensOf(obj: unknown) {
        killed.push(obj);
      },
    },
  };
  return { scene, tweensAdded, killed };
}

/** 3x3 of empty walkable cells — the renderer only reads render
 *  properties off these, and none of the paths under test relight. */
const GRID = Array.from({ length: 3 }, () =>
  Array.from({ length: 3 }, () => ({ walkable: true })),
);

function makeRenderer(
  moveTweenMs?: number,
  stepAnim?: Partial<StepAnimConfig>,
) {
  const f = fakeScene();
  const renderer = new WorldRenderer({
    // The fake implements only the slice of Phaser.Scene these code
    // paths touch; the cast keeps the test honest about that.
    scene: f.scene as unknown as Phaser.Scene,
    grid: GRID,
    ...(moveTweenMs === undefined ? {} : { moveTweenMs }),
    ...(stepAnim === undefined ? {} : { stepAnim }),
  });
  return { renderer, ...f };
}

const centerOf = (col: number, row: number) => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
});

describe("WorldRenderer — inter-cell movement", () => {
  it("places the sprite directly on the first setPartyAt", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    const { x, y } = centerOf(1, 1);
    expect(renderer.partySprite?.x).toBe(x);
    expect(renderer.partySprite?.y).toBe(y);
    // Spawning is not a move — nothing should animate.
    expect(tweensAdded).toHaveLength(0);
    expect(renderer.isPartyMoving()).toBe(false);
  });

  it("slides a single-cell step instead of snapping", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);

    expect(tweensAdded).toHaveLength(1);
    const t = tweensAdded[0];
    expect(t.x).toBe(centerOf(1, 2).x);
    expect(t.y).toBe(centerOf(1, 2).y);
    expect(t.duration).toBe(DEFAULT_MOVE_TWEEN_MS);
    // Linear, not eased — a walking step is constant velocity.
    expect(t.ease).toBe("Linear");
    // The sprite has NOT arrived yet; the kernel's position has.
    expect(renderer.partySprite?.y).toBe(centerOf(1, 1).y);
    expect(renderer.partyRow).toBe(2);
  });

  it("snaps a multi-cell jump — stairs, map links, warps", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(0, 0);
    renderer.setPartyAt(0, 2);

    expect(tweensAdded).toHaveLength(0);
    expect(renderer.partySprite?.y).toBe(centerOf(0, 2).y);
    expect(renderer.isPartyMoving()).toBe(false);
  });

  it("snaps every move when moveTweenMs is 0", () => {
    const { renderer, tweensAdded } = makeRenderer(0);
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);

    expect(tweensAdded).toHaveLength(0);
    expect(renderer.partySprite?.y).toBe(centerOf(1, 2).y);
  });

  it("reports motion in flight and clears it on completion", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);

    // This flag is what the host gates held-key input on.
    expect(renderer.isPartyMoving()).toBe(true);
    tweensAdded[0].onComplete?.();
    expect(renderer.isPartyMoving()).toBe(false);
  });

  it("retargets rather than compounding when a step lands mid-slide", () => {
    const { renderer, tweensAdded, killed } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    renderer.setPartyAt(2, 2);

    // Second step kills the first tween before starting its own, so
    // two tweens never drive the same sprite into a diagonal drift.
    expect(killed).toContain(renderer.partySprite);
    expect(tweensAdded).toHaveLength(2);
    expect(tweensAdded[1].x).toBe(centerOf(2, 2).x);
    expect(renderer.isPartyMoving()).toBe(true);
  });

  it("snapPartyToTarget plants the sprite and ends the slide", () => {
    const { renderer } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    expect(renderer.isPartyMoving()).toBe(true);

    renderer.snapPartyToTarget();

    expect(renderer.partySprite?.y).toBe(centerOf(1, 2).y);
    expect(renderer.isPartyMoving()).toBe(false);
  });

  it("cancels the tween before destroying the sprite on clearParty", () => {
    const { renderer, killed } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const sprite = renderer.partySprite;

    renderer.clearParty();

    // Order matters: a tween left live on a destroyed game object
    // keeps mutating freed state.
    expect(killed).toContain(sprite);
    expect(renderer.partySprite).toBeNull();
    expect(renderer.isPartyMoving()).toBe(false);
  });
});

describe("WorldRenderer — roamer movement", () => {
  const roamer = (col: number, row: number) => [
    { id: "r1", col, row, sprite: "monster/rat.png" },
  ];

  it("slides a roamer that wanders one cell", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions(roamer(1, 1));
    expect(tweensAdded).toHaveLength(0); // spawn

    renderer.setRoamerPositions(roamer(1, 2));
    expect(tweensAdded).toHaveLength(1);
    expect(tweensAdded[0].y).toBe(centerOf(1, 2).y);
  });

  it("snaps a roamer that is re-placed across the map", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions(roamer(0, 0));
    renderer.setRoamerPositions(roamer(0, 2));
    expect(tweensAdded).toHaveLength(0);
    expect(renderer.roamerSprites.get("r1")?.y).toBe(centerOf(0, 2).y);
  });

  it("cancels tweens for roamers that leave the list", () => {
    const { renderer, killed } = makeRenderer();
    renderer.setRoamerPositions(roamer(1, 1));
    const sprite = renderer.roamerSprites.get("r1");
    renderer.setRoamerPositions([]);

    expect(killed).toContain(sprite);
    expect(renderer.roamerSprites.size).toBe(0);
  });
});

describe("WorldRenderer — caller-owned overlay sprites", () => {
  // NPCs and quest givers are moved by the kernel swapping a tag
  // between grid cells, so their Images are owned by the host, not by
  // diffSprites. slideSprite is the seam that keeps them on the same
  // timing rule as everything else that moves.

  it("slides an overlay sprite one cell", () => {
    const { renderer, scene, tweensAdded } = makeRenderer();
    const img = scene.add.image(
      centerOf(1, 1).x,
      centerOf(1, 1).y,
      "person/villager.png",
    );

    renderer.slideSprite(img as unknown as Phaser.GameObjects.Image, 1, 2);

    expect(tweensAdded).toHaveLength(1);
    expect(tweensAdded[0].x).toBe(centerOf(1, 2).x);
    expect(tweensAdded[0].y).toBe(centerOf(1, 2).y);
    expect(tweensAdded[0].duration).toBe(DEFAULT_MOVE_TWEEN_MS);
  });

  it("snaps an overlay relocated further than a step", () => {
    // The "ask an NPC to step aside" dialog and any authored
    // relocation can move a giver further than one tile.
    const { renderer, scene, tweensAdded } = makeRenderer();
    const img = scene.add.image(
      centerOf(0, 0).x,
      centerOf(0, 0).y,
      "person/villager.png",
    );

    renderer.slideSprite(img as unknown as Phaser.GameObjects.Image, 0, 2);

    expect(tweensAdded).toHaveLength(0);
    expect(img.y).toBe(centerOf(0, 2).y);
  });

  it("does not disturb the party's in-flight slide", () => {
    // Both move on the same turn: the party steps, then the wander
    // pass drifts an NPC. The NPC's tween must not clear the flag
    // the host gates movement input on.
    const { renderer, scene } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const npc = scene.add.image(
      centerOf(2, 2).x,
      centerOf(2, 2).y,
      "person/villager.png",
    );

    renderer.slideSprite(npc as unknown as Phaser.GameObjects.Image, 2, 1);

    expect(renderer.isPartyMoving()).toBe(true);
  });

  it("honours moveTweenMs: 0 for overlays too", () => {
    const { renderer, scene, tweensAdded } = makeRenderer(0);
    const img = scene.add.image(
      centerOf(1, 1).x,
      centerOf(1, 1).y,
      "person/villager.png",
    );

    renderer.slideSprite(img as unknown as Phaser.GameObjects.Image, 1, 2);

    expect(tweensAdded).toHaveLength(0);
    expect(img.y).toBe(centerOf(1, 2).y);
  });
});

describe("WorldRenderer — quest halo travel", () => {
  // The halo is immediate-mode Graphics rebuilt from cell keys, so it
  // has no sprite to tween. slideQuestGlow animates a draw-time offset
  // instead; these tests pin the offset's shape rather than the pixels,
  // which is the part that has to agree with the sprite.

  it("tweens an offset that starts at the old cell", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setQuestGlowCells(new Set(["1,2"]));

    renderer.slideQuestGlow({ col: 1, row: 1 }, { col: 1, row: 2 });

    expect(tweensAdded).toHaveLength(1);
    const t = tweensAdded[0] as TweenCfg & {
      targets: { dx: number; dy: number };
      dx?: number;
      dy?: number;
    };
    // Offset starts one tile back the way the giver came...
    expect(t.targets.dy).toBe(-TILE_SIZE);
    expect(t.targets.dx).toBe(0);
    // ...and is driven to nothing over the shared step duration.
    expect(t.dy).toBe(0);
    expect(t.duration).toBe(DEFAULT_MOVE_TWEEN_MS);
  });

  it("snaps the halo when the giver is relocated further than a step", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setQuestGlowCells(new Set(["0,2"]));

    renderer.slideQuestGlow({ col: 0, row: 0 }, { col: 0, row: 2 });

    // Same teleport rule as the sprite it chases — no travel.
    expect(tweensAdded).toHaveLength(0);
  });

  it("does not animate a giver that did not move", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.slideQuestGlow({ col: 1, row: 1 }, { col: 1, row: 1 });
    expect(tweensAdded).toHaveLength(0);
  });

  it("honours moveTweenMs: 0", () => {
    const { renderer, tweensAdded } = makeRenderer(0);
    renderer.slideQuestGlow({ col: 1, row: 1 }, { col: 1, row: 2 });
    expect(tweensAdded).toHaveLength(0);
  });
});

describe("WorldRenderer — step animation on static art", () => {
  /** Drive a slide's onUpdate to a given progress, 0..1. */
  const at = (t: TweenCfg, progress: number) => t.onUpdate?.({ progress });

  it("arcs the sprite up at mid-step and lands it flat", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const sprite = renderer.partySprite!;
    const t = tweensAdded[0];

    at(t, 0.5);
    // Half a tile along, and lifted by the full bob height.
    const midY = (centerOf(1, 1).y + centerOf(1, 2).y) / 2;
    expect(sprite.y).toBeCloseTo(midY - DEFAULT_STEP_ANIM.bobPx, 5);

    t.onComplete?.();
    expect(sprite.y).toBe(centerOf(1, 2).y);
  });

  it("does not let the bob compound across frames", () => {
    // The offset is recomputed from the endpoints each frame rather
    // than added to the sprite's live y — this is the regression that
    // would otherwise walk the party off the map over a long journey.
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const sprite = renderer.partySprite!;
    const t = tweensAdded[0];

    for (const p of [0.2, 0.4, 0.5, 0.5, 0.5, 0.8]) at(t, p);
    at(t, 0.5);

    const midY = (centerOf(1, 1).y + centerOf(1, 2).y) / 2;
    expect(sprite.y).toBeCloseTo(midY - DEFAULT_STEP_ANIM.bobPx, 5);
  });

  it("stretches at the apex and restores base scale on landing", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const sprite = renderer.partySprite!;
    const t = tweensAdded[0];

    at(t, 0.5);
    expect(sprite.scaleY).toBeGreaterThan(1);
    expect(sprite.scaleX).toBeLessThan(1);

    t.onComplete?.();
    expect(sprite.scaleY).toBe(1);
    expect(sprite.scaleX).toBe(1);
  });

  it("turns to face travel, and keeps facing through a vertical step", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    const sprite = renderer.partySprite!;

    renderer.setPartyAt(0, 1); // west
    expect(sprite.flipX).toBe(true);
    tweensAdded[0].onComplete?.();

    renderer.setPartyAt(0, 2); // south — facing must persist
    expect(sprite.flipX).toBe(true);
    tweensAdded[1].onComplete?.();

    renderer.setPartyAt(1, 2); // east
    expect(sprite.flipX).toBe(false);
  });

  it("unwinds a half-finished step when a new one interrupts it", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(1, 2);
    const sprite = renderer.partySprite!;

    at(tweensAdded[0], 0.5); // caught mid-hop, 2px high and stretched
    renderer.setPartyAt(2, 2); // interrupt

    // The replacement tween must start from the sprite's true line,
    // not from the lifted position, or the bob bakes itself in.
    expect(sprite.scaleY).toBe(1);
    expect(sprite.getData("__stepBob")).toBe(0);
  });

  it("leaves the sprite alone when every knob is off", () => {
    const { renderer, tweensAdded } = makeRenderer(undefined, {
      bobPx: 0,
      squashFactor: 0,
      flipToFaceTravel: false,
      leanDegrees: 0,
    });
    renderer.setPartyAt(1, 1);
    renderer.setPartyAt(0, 1);
    const sprite = renderer.partySprite!;

    at(tweensAdded[0], 0.5);

    expect(sprite.flipX).toBe(false);
    expect(sprite.scaleY).toBe(1);
    expect(sprite.rotation).toBe(0);
    // Still slides — the motion and the step dressing are separate.
    expect(tweensAdded).toHaveLength(1);
  });
});

describe("WorldRenderer — monsters and NPCs step like the party", () => {
  const at = (t: TweenCfg, progress: number) => t.onUpdate?.({ progress });
  const roamerAt = (col: number, row: number) => [
    { id: "r1", col, row, sprite: "monster/rat.png" },
  ];

  it("bobs and squashes a roaming monster", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions(roamerAt(1, 1));
    renderer.setRoamerPositions(roamerAt(1, 2));
    const img = renderer.roamerSprites.get("r1")!;

    at(tweensAdded[0], 0.5);

    const midY = (centerOf(1, 1).y + centerOf(1, 2).y) / 2;
    expect(img.y).toBeCloseTo(midY - DEFAULT_STEP_ANIM.bobPx, 5);
    expect(img.scaleY).toBeGreaterThan(img.scaleX);
  });

  it("multiplies the roamer's own resting scale, not 1", () => {
    // Roamers render at 95% of a tile. If the squash maths assumed a
    // base of 1, every monster would pop to full tile size the instant
    // it took a step and stay there.
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions(roamerAt(1, 1));
    const img = renderer.roamerSprites.get("r1")!;
    const resting = img.scaleY;
    expect(resting).toBeCloseTo(0.95, 5);

    renderer.setRoamerPositions(roamerAt(1, 2));
    at(tweensAdded[0], 0.5);
    expect(img.scaleY).toBeCloseTo(
      resting * (1 + DEFAULT_STEP_ANIM.squashFactor),
      5,
    );

    tweensAdded[0].onComplete?.();
    expect(img.scaleY).toBeCloseTo(resting, 5);
  });

  it("turns a monster to face the way it is moving", () => {
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions(roamerAt(1, 1));
    const img = renderer.roamerSprites.get("r1")!;

    renderer.setRoamerPositions(roamerAt(0, 1)); // west
    expect(img.flipX).toBe(true);
    tweensAdded[0].onComplete?.();

    renderer.setRoamerPositions(roamerAt(1, 1)); // east
    expect(img.flipX).toBe(false);
  });

  it("bobs and turns a wandering NPC", () => {
    const { renderer, scene, tweensAdded } = makeRenderer();
    const npc = scene.add.image(
      centerOf(2, 1).x,
      centerOf(2, 1).y,
      "person/villager.png",
    );

    renderer.slideSprite(npc as unknown as Phaser.GameObjects.Image, 1, 1);

    expect(npc.flipX).toBe(true); // walked west
    // X is interpolated by Phaser's tween engine, which this fake does
    // not run — so assert the tween was aimed correctly, and assert the
    // bob on Y, which the renderer writes itself in onUpdate.
    expect(tweensAdded[0].x).toBe(centerOf(1, 1).x);
    at(tweensAdded[0], 0.5);
    expect(npc.y).toBeCloseTo(centerOf(1, 1).y - DEFAULT_STEP_ANIM.bobPx, 5);
  });

  it("gives each mover its own independent step state", () => {
    // Two monsters mid-step at different phases must not share a base
    // scale or a bob offset.
    const { renderer, tweensAdded } = makeRenderer();
    renderer.setRoamerPositions([
      { id: "a", col: 0, row: 0, sprite: "monster/rat.png" },
      { id: "b", col: 2, row: 2, sprite: "monster/bat.png" },
    ]);
    renderer.setRoamerPositions([
      { id: "a", col: 0, row: 1, sprite: "monster/rat.png" },
      { id: "b", col: 2, row: 1, sprite: "monster/bat.png" },
    ]);
    const a = renderer.roamerSprites.get("a")!;
    const b = renderer.roamerSprites.get("b")!;

    at(tweensAdded[0], 1.0); // a has landed
    at(tweensAdded[1], 0.5); // b is at its apex

    expect(a.y).toBeCloseTo(centerOf(0, 1).y, 5);
    const bMid = (centerOf(2, 2).y + centerOf(2, 1).y) / 2;
    expect(b.y).toBeCloseTo(bMid - DEFAULT_STEP_ANIM.bobPx, 5);
  });
});
