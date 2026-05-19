/**
 * Shared types for the map simulation kernel.
 *
 * The kernel is split into pure helpers (movement.ts) and a Phaser-
 * aware controller (MapSimulation.ts) so the pure parts can be reused
 * from anywhere — including a future /play scene that may not use
 * Phaser at all. The Phaser-aware controller is the editor's mount
 * point today, and the same controller is the natural home for the
 * /play scene's overworld layer when we build it.
 *
 * None of these types depend on Phaser. They mirror the shape of the
 * data model (Map, MapTile, Party, Character, CharacterClass, Effect)
 * but only carry the fields the simulation actually reads — that
 * isolates the kernel from churn in the editor's TileType.
 */

export type Direction = "up" | "down" | "left" | "right";

/** The subset of a painted tile cell that the simulation reads. Each
 *  field mirrors the same-named field on the editor's TileType / the
 *  data dictionary's MapTile entry. Other tile fields (sprite, name,
 *  encounter, animation, …) are ignored by the kernel — the scene
 *  renders them on its own. */
export interface SimCell {
  id: string;
  walkable: boolean;
  /** Blocks light + LOS — used to cast shadows from light sources. */
  obstructs: boolean;
  /** True = tile emits light at light_range cells. */
  light_source: boolean;
  light_range: number;
  /** Inter-map portal — null/undefined when this cell does not link. */
  link?: { map_id: string; x: number; y: number } | null;
  /** NPC id from npcs.json — when the party steps onto this cell, the
   *  sim emits an npc_encountered event so the host can open a dialog
   *  overlay. Empty / undefined when no NPC stands here. */
  npc?: string;
  /** Counter id from counters.json — an unattended shop / fountain
   *  / service desk planted directly on a tile. Bumping the cell
   *  emits a counter_encountered event so the host opens the
   *  CounterShopOverlay without needing an NPC to broker the
   *  conversation. Empty / undefined = no counter on this cell. */
  counter?: string;
  /** True = this cell is a boat the party can board. Stepping onto it
   *  from land mounts the party; the sim then lets them sail across
   *  tiles tagged "water" until they step onto walkable land again,
   *  at which point the boat stays behind on the last water cell. */
  boat?: boolean;
  /** Free-form designer tag. The sim only reads "water" — boats can
   *  sail across cells whose `tag === "water"`. Other tag values are
   *  ignored by the kernel. */
  tag?: string;
  /** Render texture for the cell. The sim kernel doesn't paint, but
   *  it passes this through to the host on boat boarding so the
   *  scene knows which sprite to use for the boat-under-the-party. */
  sprite?: string;
  /** True when the cell is "locked" — the editor exposes this as a
   *  per-cell BoolEditor. Walking onto a locked cell opens the
   *  Pick Lock / Cast Knock / Leave dialog instead of moving; once
   *  unlocked (success or designer override) the gate lifts and the
   *  normal `walkable` check decides movement. */
  locked?: boolean;
  /** Catalog id from spawns.json — when set, this cell is a monster
   *  lair. The sim's spawn loop drops roamers from `spawn_monsters`
   *  around it each step; stepping onto the cell starts a boss
   *  fight against `boss_monsters`. Winning the boss fight destroys
   *  the lair (cell reverts to plain ground). Empty / undefined =
   *  not a lair. */
  spawn?: string;
  /** Catalog id from encounters.json — when set, this cell is the
   *  starting position of a placed encounter. The sim seeds one
   *  roaming entity per encounter cell at construction; from there
   *  it pursues the party like a spawn roamer. Stepping into / onto
   *  the entity opens combat against the encounter's full roster;
   *  victory removes the entity permanently for the session. Empty
   *  / undefined = no encounter on this cell. */
  encounter?: string;
  /** Catalog id from dungeons.json — when set, this cell is a
   *  dungeon entrance. Stepping onto it emits `dungeon_entered`
   *  and the host transitions the simulator into the procedurally
   *  generated dungeon. Empty / undefined = not an entrance. */
  dungeon?: string;
}

/** Minimal monsters.json record the sim reads — just the fields the
 *  roamer renderer and the encounter banner need. Loader casts the
 *  merged monsters list to this shape. */
export interface SimMonsterRef {
  id: string;
  name: string;
  /** Sprite path like "monster/goblin.png" — the host renders this
   *  on every roamer tile and inside the encounter dialog. */
  sprite?: string;
}

/** Minimal encounters.json record the sim reads. Loader pulls these
 *  three fields per entry — the rest of the encounter record (area,
 *  level, weight, …) is irrelevant to the spawn / pursuit loop. */
export interface SimEncounterRef {
  id: string;
  name: string;
  /** Lead monster's sprite path the placed-encounter renderer draws
   *  as the entity icon. Already in "monster/foo.png" form. */
  monster_party_tile?: string;
  /** Full combat roster. Fed to the encounter banner + handed to
   *  combat on victory resolution. */
  monsters: string[];
  /** Optional id of a Map (from maps.json) that should back this
   *  encounter's battle as the arena. Null / undefined falls back to
   *  the generic green-field arena. Authored via the editor's
   *  MapPicker on the `custom_map` field. */
  custom_map?: string | null;
}

/** Row-major grid: grid[row][col]. */
export type SimGrid = ReadonlyArray<ReadonlyArray<SimCell>>;

/** Result of attempting a one-step move. `stayed` means the move was
 *  rejected (off-grid or non-walkable); `moved` means the party stepped
 *  to the new cell; `linked` means the new cell carries a link that
 *  the runtime should traverse (load a different map). */
export type StepResult =
  | { kind: "stayed"; reason: "off_grid" | "blocked" }
  | { kind: "moved"; col: number; row: number }
  | {
      kind: "linked";
      col: number;
      row: number;
      link: { map_id: string; x: number; y: number };
    };

/** Position on the current map. */
export interface Position {
  col: number;
  row: number;
}

/** A single light source the renderer should treat as illuminating
 *  cells within `range` Chebyshev tiles (with obstructs-LOS shadows).
 *  The grid's own `light_source` cells are gathered separately by the
 *  scene; this type is for *additional* sources the simulation
 *  contributes — primarily the party itself. */
export interface SimLightSource {
  col: number;
  row: number;
  range: number;
}

/** Subset of the party.json record the simulation reads. Everything
 *  else (gold, inventory, …) is ignored by the kernel; the editor's
 *  panel still has the full record on hand. */
export interface SimParty {
  /** Where the party spawns. `map_id` names a Map record; `col`/`row`
   *  are the cell within that map. The sim kernel doesn't load the
   *  named map itself (the host scene is already showing one and the
   *  click-to-place flow can override) — it reads `col`/`row` as the
   *  preferred spawn coordinate. The future /play scene will be the
   *  consumer that honors `map_id` to pick the right map to mount. */
  start_position: { map_id?: string; col: number; row: number };
  avatar: string;
  /** Character ids in the adventuring party. Every entry is in play —
   *  v2 collapsed v1's roster + active_party into this single list. */
  roster: string[];
  /** Step countdown for a held torch. >0 = +TORCH_LIGHT_RANGE to the
   *  party's emitted light radius. Decrements one per step. */
  torch_steps: number;
  /** Step countdown for the Galadriel's Light effect (Elf race).
   *  >0 = +GALADRIELS_LIGHT_RANGE. Decrements one per step. */
  galadriels_light_steps: number;
  /** Whether the party has currently *engaged* their infravision
   *  ability. The ability itself is a passive race trait (Dwarf in
   *  the default module); this flag is the player-controlled
   *  on/off switch. True means the lighting renderer should show
   *  every in-LOS cell — cells lit by another source render
   *  normally, cells lit only by infravision render in red.
   *
   *  Defaults to false: infravision is opt-in. Toggle via
   *  `MapSimulation.setInfravisionActive(active)`. */
  infravision_active?: boolean;
  /** Gold on hand. Optional in the type because the sim kernel itself
   *  never touches it; the editor's shop overlay reads + mutates it
   *  when the player buys / sells at a counter. */
  gold?: number;
  /** Item stash carried by the party as a whole. Same caveat as gold —
   *  the kernel ignores this, but the shop overlay mutates it during a
   *  sim session. Each entry is { item: string; charges?: number }. */
  inventory?: PartyInventoryEntry[];
}

/** One row in the party's stash. The editor's shop overlay and any
 *  future inventory UI write to this shape. */
export interface PartyInventoryEntry {
  item: string;
  charges?: number;
}

/** Subset of a character record the sim reads. */
export interface SimCharacter {
  id: string;
  name: string;
  /** Class id (snake_case): "fighter", "wizard", … */
  class: string;
  /** Race id (snake_case): "human", "elf", … */
  race: string;
  level: number;
  hp: number;
  mp: number;
  sprite: string;
  // Ability scores — optional because the sim itself doesn't need
  // them for movement / lighting, but the lock-pick + Knock-spell
  // rolls do. Loader casts characters.json straight to SimCharacter,
  // so these come through automatically when the JSON declares them.
  strength?: number;
  dexterity?: number;
  intelligence?: number;
  wisdom?: number;
  constitution?: number;
}

/** Subset of the character_classes record the sim reads. */
export interface SimCharacterClass {
  id: string;
  name: string;
  /** Catalogs this class can draw from — e.g. `["sorcerer"]` for
   *  Wizard. Used by the Knock-spell finder to pick an eligible
   *  caster from the party. Optional so non-caster classes (Fighter,
   *  Thief) can omit it. */
  casting_type?: string[];
}

/** Just enough of a Spell record for the simulator's lock-unlock
 *  dialog to roll the Knock spell. Loader pulls this out of
 *  spells.json by id. */
export interface SimSpell {
  id: string;
  name: string;
  /** Catalog the spell belongs to (matches `SimCharacterClass.casting_type`). */
  casting_type: string;
  min_level: number;
  mp_cost: number;
  /** Action discriminator — `"knock"` for the Knock spell. */
  action?: string;
  /** Free-form action params; the lock-unlock path reads
   *  `save_dc_base` (default 12) and `save_stat` (default
   *  "intelligence") out of this bag. */
  action_params?: Record<string, unknown>;
}

/** Subset of the race record the sim reads. */
export interface SimRace {
  id: string;
  name: string;
  /** Innate Ability ids this race grants. Used to detect e.g.
   *  Infravision so the lighting kernel can extend the party's
   *  effective light radius in dark maps. */
  abilities?: string[];
}

/** Subset of an effect record the sim reads. */
export interface SimEffect {
  id: string;
  name: string;
  description: string;
  duration: number | "permanent" | "instant" | "until_save";
}

/** Light range constants — same magic numbers v1 used. Held here so
 *  the panel UI and the kernel agree on what "lighting a torch" means. */
export const TORCH_LIGHT_RANGE = 3;
export const GALADRIELS_LIGHT_RANGE = 5;
// INFRAVISION_RANGE used to live here as a stand-in for the
// Dwarf infravision ability. It was implemented as a 999-cell
// party light, which lit the entire map and meant a dwarf in
// the roster trivialised dungeon darkness. Infravision is a
// vision ability (the character sees in low light), not a
// physical light source the party emits. It'll come back as a
// separate "render mode" for the party when vision abilities
// land; for now the constant is intentionally absent so a
// stray reference fails the type-check.
