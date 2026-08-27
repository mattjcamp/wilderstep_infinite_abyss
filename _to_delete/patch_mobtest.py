#!/usr/bin/env python3
"""Prove monsters and NPCs get the same step animation as the party,
and pin the non-unit base scale that roamers actually render at."""
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


# Model setDisplaySize for real: the renderer sizes roamers at 95% of a
# tile, so their resting scale is 0.95, not 1. A no-op stub here would
# hide any code that assumes base scale is 1.
sub(
    '''    setOrigin: () => img,
    setDisplaySize: () => img,
    setDepth: () => img,''',
    '''    setOrigin: () => img,
    setDisplaySize(w: number, h: number) {
      // Every sprite in this project is a 32x32 source PNG, so scale
      // is display size over tile size — which is how the renderer
      // ends up with roamers at 0.95 and the party at 1.
      img.scaleX = w / 32;
      img.scaleY = h / 32;
      return img;
    },
    setDepth: () => img,''',
    "fake setDisplaySize models scale",
)

sub(
    '''  setOrigin(): FakeImage;
  setDisplaySize(): FakeImage;''',
    '''  setOrigin(): FakeImage;
  setDisplaySize(w: number, h: number): FakeImage;''',
    "FakeImage setDisplaySize signature",
)

ADD = '''
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
    at(tweensAdded[0], 0.5);
    const midX = (centerOf(2, 1).x + centerOf(1, 1).x) / 2;
    expect(npc.x).toBeCloseTo(midX, 5);
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
'''

assert "monsters and NPCs step like the party" not in src
src = src.rstrip("\n") + "\n" + ADD
assert src != orig
io.open(PATH, "w", encoding="utf-8").write(src)
print("wrote %s" % PATH)
