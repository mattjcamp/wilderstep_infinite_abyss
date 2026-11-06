/**
 * Title-screen wanderers — the roster and spawn rules for the people,
 * animals and monsters that stroll across the /play title screen
 * behind the menu (rendered by app/play/TitleWanderers.tsx).
 *
 * The sprites are single 64×64 frames, so the "walk" is faked per
 * gait: people hop-step, animals trot, ghosts / bats / elementals float
 * or flap, oozes squash and stretch. Side-on sprites (the dog, the
 * dragon…) are flipped to face the way they travel.
 *
 * Pure data + a seedable `planWanderer` so the rules are unit-tested.
 */

export type Gait = "walk" | "trot" | "float" | "flap" | "ooze" | "hop";

export interface WandererKind {
  /** Path under the default module's sprites/ folder. */
  sprite: string;
  /** Which way the art faces. Side-on art is flipped to match travel. */
  facing: "left" | "right" | "front";
  gait: Gait;
  /** Size relative to a person (1). */
  size: number;
}

const RACES = ["dwarf", "elf", "gnome", "halfling", "person"] as const;
const GENDERS = ["female", "male"] as const;
const ADVENTURER_ROLES = [
  "fighter",
  "wizard",
  "cleric",
  "thief",
  "ranger",
  "paladin",
  "druid",
  "alchemist",
] as const;
const VILLAGER_ROLES = [
  "villager_normal",
  "villager_poor",
  "villager_noble",
  "villager_wealthy",
] as const;

const person = (file: string): WandererKind => ({
  sprite: `person/${file}.png`,
  facing: "front",
  gait: "walk",
  size: 1,
});

export const ADVENTURERS: ReadonlyArray<WandererKind> = RACES.flatMap((r) =>
  GENDERS.flatMap((g) => ADVENTURER_ROLES.map((role) => person(`${r}_${g}_${role}`))),
);

export const TOWNSFOLK: ReadonlyArray<WandererKind> = [
  ...RACES.flatMap((r) =>
    GENDERS.flatMap((g) => VILLAGER_ROLES.map((role) => person(`${r}_${g}_${role}`))),
  ),
  ...[
    "person_female_musician_fiddle",
    "person_female_musician_recorder",
    "person_male_musician_drum",
    "person_male_musician_harp",
    "person_male_musician_lute",
  ].map(person),
];

const animal = (
  name: string,
  facing: "left" | "right",
  gait: Gait = "trot",
  size = 0.85,
): WandererKind => ({ sprite: `person/animal_${name}.png`, facing, gait, size });

export const ANIMALS: ReadonlyArray<WandererKind> = [
  animal("bird", "left", "hop", 0.6),
  animal("cat", "right", "trot", 0.7),
  animal("cow", "left", "trot", 1.05),
  animal("dog", "left"),
  animal("goat", "right"),
  animal("pig", "right", "trot", 0.8),
  animal("sheep", "right"),
];

const monster = (
  name: string,
  gait: Gait = "walk",
  size = 1,
  facing: "left" | "right" | "front" = "front",
): WandererKind => ({ sprite: `monster/${name}.png`, facing, gait, size });

export const MONSTERS: ReadonlyArray<WandererKind> = [
  monster("air_elemental", "float", 1.05),
  monster("demon", "walk", 1.15),
  monster("dire_wolf", "trot", 1, "right"),
  monster("earth_elemental", "walk", 1.15),
  monster("fire_elemental", "float", 1.05),
  monster("gelatinous_cube", "ooze", 1),
  monster("ghost", "float", 0.95),
  monster("giant_bat", "flap", 0.85),
  monster("giant_rat", "trot", 0.75, "left"),
  monster("giant_spider", "trot", 1),
  monster("goblin", "walk", 0.85),
  monster("lich", "walk", 1.05),
  monster("orc", "walk", 1),
  monster("orc_cleric", "walk", 1),
  monster("orc_king", "walk", 1.1),
  monster("red_dragon", "walk", 1.6, "left"),
  monster("skeleton", "walk", 1),
  monster("slime_mold", "ooze", 0.85),
  monster("troll", "walk", 1.3),
  monster("vampire", "walk", 1),
  monster("water_elemental", "float", 1.05),
  monster("zombie", "walk", 1),
];

/** Creatures that sometimes travel in a pack of the same kind. */
const PACK_ANIMALS = new Set([
  "monster/dire_wolf.png",
  "monster/giant_rat.png",
  "monster/goblin.png",
  "monster/skeleton.png",
  "monster/zombie.png",
  "person/animal_sheep.png",
  "person/animal_goat.png",
  "person/animal_cow.png",
]);

/** Walking lanes, as a fraction of the screen height. Higher lanes are
 *  "farther away" — smaller, dimmer and slower. */
export const LANES: ReadonlyArray<number> = [0.06, 0.2, 0.35, 0.5, 0.65, 0.8, 0.92];

export interface WandererPlan {
  /** Members in marching order, leader first. */
  members: WandererKind[];
  /** Lane index into LANES. */
  lane: number;
  /** +1 = left → right, -1 = right → left. */
  dir: 1 | -1;
  /** Travel speed in px/s, already scaled for depth. */
  speed: number;
  /** Rendered height of a size-1 member, px, scaled for depth. */
  basePx: number;
  /** 0..1 — far lanes are dimmer. */
  opacity: number;
}

function pick<T>(list: ReadonlyArray<T>, rand: () => number): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

/** Depth for a lane: 0 = farthest (top), 1 = nearest (bottom). */
export function laneDepth(lane: number): number {
  return LANES.length <= 1 ? 1 : lane / (LANES.length - 1);
}

/** Roll the next wanderer (or group). `rand` is injectable for tests. */
export function planWanderer(rand: () => number = Math.random): WandererPlan {
  const roll = rand();
  let members: WandererKind[];
  if (roll < 0.26) {
    // An adventuring party of 2–4.
    const n = 2 + Math.floor(rand() * 3);
    members = Array.from({ length: n }, () => pick(ADVENTURERS, rand));
  } else if (roll < 0.64) {
    const m = pick(MONSTERS, rand);
    const pack = PACK_ANIMALS.has(m.sprite) && rand() < 0.5;
    members = pack ? Array.from({ length: 2 + Math.floor(rand() * 2) }, () => m) : [m];
  } else if (roll < 0.82) {
    const a = pick(ANIMALS, rand);
    const herd = PACK_ANIMALS.has(a.sprite) && rand() < 0.5;
    members = herd ? Array.from({ length: 2 + Math.floor(rand() * 2) }, () => a) : [a];
  } else {
    members = [pick(TOWNSFOLK, rand)];
  }
  const lane = Math.floor(rand() * LANES.length) % LANES.length;
  const depth = laneDepth(lane);
  const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;
  const lead = members[0];
  const gaitSpeed =
    lead.gait === "float" || lead.gait === "flap"
      ? 1.15
      : lead.gait === "ooze"
        ? 0.55
        : lead.gait === "trot"
          ? 1.3
          : 1;
  const speed = (28 + rand() * 22) * gaitSpeed * (0.6 + 0.4 * depth);
  return {
    members,
    lane,
    dir,
    speed,
    basePx: Math.round(46 + 34 * depth),
    opacity: 0.5 + 0.4 * depth,
  };
}
