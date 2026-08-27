#!/usr/bin/env python3
"""Upgrade the test fake for step-animation state, then add coverage."""
import io, os

PATH = os.path.expanduser(
    "~/mnt/wilderstep_infinite_abyss/web/src/sim/scene/WorldRenderer.movement.test.ts"
)
src = io.open(PATH, encoding="utf-8").read()
orig = src


def sub(old, new, label):
    global src
    n = src.count(old)
    assert n == 1, "%s: expected 1 match, found %d" % (label, n)
    src = src.replace(old, new)
    print("  ok  %s" % label)


# ── Richer fake image: flip, scale, real data store ─────────────────
sub(
    '''interface FakeImage {
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
}''',
    '''interface FakeImage {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipX: boolean;
  destroyed: boolean;
  texture: { key: string };
  setOrigin(): FakeImage;
  setDisplaySize(): FakeImage;
  setDepth(): FakeImage;
  setPosition(x: number, y: number): FakeImage;
  setTexture(k: string): FakeImage;
  setVisible(): FakeImage;
  setFlipX(v: boolean): FakeImage;
  setData(k: string, v: unknown): FakeImage;
  getData(k: string): unknown;
  destroy(): void;
}''',
    "FakeImage interface",
)

sub(
    '''function fakeImage(x: number, y: number, key: string): FakeImage {
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
}''',
    '''function fakeImage(x: number, y: number, key: string): FakeImage {
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
}''',
    "fakeImage impl",
)

sub(
    '''interface TweenCfg {
  targets: unknown;
  x?: number;
  y?: number;
  duration?: number;
  ease?: string;
  onComplete?: () => void;
}''',
    '''interface TweenCfg {
  targets: unknown;
  x?: number;
  y?: number;
  duration?: number;
  ease?: string;
  onUpdate?: (tween: { progress: number }) => void;
  onComplete?: () => void;
}''',
    "TweenCfg onUpdate",
)

ADD = '''
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
    expect(sprite.getData(\"__stepBob\")).toBe(0);
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
'''

# makeRenderer needs a second arg for stepAnim overrides.
sub(
    '''function makeRenderer(moveTweenMs?: number) {
  const f = fakeScene();
  const renderer = new WorldRenderer({
    // The fake implements only the slice of Phaser.Scene these code
    // paths touch; the cast keeps the test honest about that.
    scene: f.scene as unknown as Phaser.Scene,
    grid: GRID,
    ...(moveTweenMs === undefined ? {} : { moveTweenMs }),
  });
  return { renderer, ...f };
}''',
    '''function makeRenderer(
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
}''',
    "makeRenderer stepAnim arg",
)

sub(
    '''import {
  DEFAULT_MOVE_TWEEN_MS,
  TILE_SIZE,
  WorldRenderer,
} from "./WorldRenderer";''',
    '''import {
  DEFAULT_MOVE_TWEEN_MS,
  DEFAULT_STEP_ANIM,
  TILE_SIZE,
  WorldRenderer,
  type StepAnimConfig,
} from "./WorldRenderer";''',
    "test imports",
)

assert "step animation on static art" not in src
src = src.rstrip("\n") + "\n" + ADD
assert src != orig
io.open(PATH, "w", encoding="utf-8").write(src)
print("wrote %s" % PATH)
