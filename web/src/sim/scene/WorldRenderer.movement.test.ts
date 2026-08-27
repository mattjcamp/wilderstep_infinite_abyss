import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVE_TWEEN_MS,
  TILE_SIZE,
  WorldRenderer,
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
  destroyed: boolean;
  texture: { key: string };
  setOrigin(): FakeImage;
  setDisplaySize(): FakeImage;
  setDepth(): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setTexture(k: string): FakeImage;
  setVisible(): FakeImage;
  setData(): FakeImage;
  destroy(): void;
}

function fakeImage(x: number, y: number, key: string): FakeImage {
  const img: FakeImage = {
    x,
    y,
    destroyed: false,
    texture: { key },
    setOrigin: () => img,
    setDisplaySize: () => img,
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
    setData: () => img,
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

function makeRenderer(moveTweenMs?: number) {
  const f = fakeScene();
  const renderer = new WorldRenderer({
    // The fake implements only the slice of Phaser.Scene these code
    // paths touch; the cast keeps the test honest about that.
    scene: f.scene as unknown as Phaser.Scene,
    grid: GRID,
    ...(moveTweenMs === undefined ? {} : { moveTweenMs }),
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
