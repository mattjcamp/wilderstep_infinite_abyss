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
  /** Pressure plate — null/undefined when this cell is not a plate.
   *  Stepping onto the cell TOGGLES the target cell's tile: the
   *  first press swaps `(map_id, col, row)` to the palette tile
   *  `tile_id` (persisted as a tile override, so it survives reload
   *  and map re-entry); the next press removes the override,
   *  restoring the authored tile. `map_id` may name the current map
   *  (the swap renders live) or any other map (applied on next
   *  visit). Authored on door/gate mechanisms: plate opens the door,
   *  stepping again closes it. */
  pressure_plate?: {
    map_id: string;
    col: number;
    row: number;
    /** Palette tile id (map_tiles.json) painted onto the target
     *  while the plate is active. */
    tile_id: string;
  } | null;
  /** Optional purely-visual background sprite, drawn BEHIND the
   *  cell's main `sprite` and tinted by the same lighting pass. Lets a
   *  foreground tile with transparent pixels (a tower, a tree) sit on
   *  a chosen terrain (grass, forest, mountain) instead of the dark
   *  canvas — without needing a separate combined tile per terrain.
   *  Absent → nothing is drawn behind, so the dark canvas shows
   *  through (the original look). Carries NO gameplay meaning. */
  background_sprite?: string;
  /** When true on a link OR dungeon-entrance cell, stepping onto it
   *  shows a confirm placard (destination name + description +
   *  explored badge) instead of traversing/entering immediately —
   *  the party only crosses if the player confirms. Opt-in per tile
   *  so mundane doors don't interrupt every step; flagged tiles
   *  (dungeon mouths, region portals) announce themselves. Absent /
   *  false → traverse or enter immediately, the original behaviour. */
  show_link_placard?: boolean;
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
  /** True = a boat can sail through this cell (the boat passes UNDER
   *  it). Authored on bridge tiles so the bridge stays walkable on
   *  foot AND sailable underneath; the sim's classification treats
   *  the cell like water for boat-move purposes, while the renderer
   *  paints a "bridge top" overlay above the boat sprite so the
   *  vessel reads as passing beneath the structure. Distinct from
   *  `tag === "water"` because a bridge tile is still walkable on
   *  foot — water tiles are not. */
  boat_passable?: boolean;
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
  /** RESERVED for the future multi-lock system — inert today. When
   *  set, names the lock category this door belongs to; only a key
   *  whose {@link SimItemRef.opens} matches (or a generic key with no
   *  `opens`) will fit. Unset = a plain lock any generic key opens,
   *  which is every locked door today. Nothing reads this yet. */
  lock_type?: string;
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
  /** Catalog id from quests.json — when set, stepping onto this
   *  cell offers the quest. The sim emits `quest_encountered`
   *  with the quest's id / name / description / quest_giver
   *  block; the host opens a dialog where the player can Accept
   *  or Decline. Empty / undefined = no quest offer here. Once
   *  the quest is accepted (the host calls `markQuestAccepted`),
   *  subsequent steps onto the cell don't re-fire. */
  quest?: string;
  /** True when this cell hides a trap. Stepping onto a `trap` cell
   *  fires a `trap_triggered` event AFTER the move resolves — the
   *  party walks onto the cell, then takes damage. The kernel
   *  disarms the cell on trigger (sets `trap = false`) so it can't
   *  refire. Dungeon-generated cells set this from the `TILE_TRAP`
   *  prototype; overworld cells can also carry it. */
  trap?: boolean;
  /** Catalog id from traps.json — when set, this cell is a trap that
   *  resolves through the trap catalog (damage roll, status effect,
   *  or teleport per the record's `trap_type`). Same disarm-on-
   *  trigger semantics as the boolean `trap`; the kernel clears both
   *  fields and passes the id through on the `trap_triggered` event.
   *  Takes precedence over `trap` when both are set. Empty /
   *  undefined = not a catalog trap (the boolean may still arm a
   *  legacy default trap). */
  trap_id?: string;
  /** Catalog id of an item lying on this tile. Walking onto a normal
   *  item fires `item_picked` after the move resolves and the kernel
   *  clears this field. When the catalog flags the item as a chest
   *  (`is_chest: true`), the kernel routes the bump through the
   *  `chest_encountered` event instead — the party blocks at the
   *  cell and the host opens the chest dialog. Empty / undefined =
   *  no item here.
   *
   *  Always typed as `string` so authors / saves can serialise it
   *  uniformly. The field was previously cast dynamically; pinning
   *  it on the interface makes the read sites typecheck without the
   *  per-call `as { item?: string }` boilerplate. */
  item?: string;
}

/** Minimal record describing the chest contents the host will hand
 *  the party on Open. Both fields are optional so an authored chest
 *  can be gold-only, items-only, or mixed. Listed item ids are
 *  resolved against the items catalog by the host (the sim doesn't
 *  consume them — they pass through verbatim on the
 *  `chest_encountered` event). */
export interface ChestContents {
  gold?: number;
  items?: ReadonlyArray<{ id: string; qty?: number }>;
}

/** Minimal items.json record the sim reads. Only the fields the
 *  bump pipeline + the host-side chest dialog actually consume —
 *  the full catalog item carries many more fields (durability,
 *  power, slots, stackable, …) which stay in the host catalog. */
export interface SimItemRef {
  id: string;
  name?: string;
  /** Stem of an icon under `/sprites/item/<icon>.png`. Optional;
   *  the chest dialog and overlay renderer fall back to the id
   *  when missing. */
  icon?: string;
  /** True = this is a treasure chest. The bump pipeline switches
   *  from the post-move `item_picked` flow to a pre-move
   *  `chest_encountered` event so the party stops, the host opens
   *  the Open / Leave dialog, and only the dialog's Open path
   *  delivers the chest's `contents`. */
  is_chest?: boolean;
  /** Authored contents revealed when the chest opens. The kernel
   *  passes the chest id through to the host on the
   *  `chest_encountered` event; the host reads this off the
   *  matching catalog record and applies it to the save. */
  contents?: ChestContents;
  /** Item category from items.json (`"key"`, `"quest_item"`,
   *  `"weapon"`, …). The lock kernel reads this to recognise a
   *  *usable* key: an inventory entry whose catalog `item_type` is
   *  exactly `"key"` can open a locked door (consumed on use). Note
   *  the "Keys of Shadow" (gold_key, silver_key, …) are authored as
   *  `"quest_item"`, NOT `"key"`, so they're deliberately excluded —
   *  they're plot tokens, not door openers. Optional; absent reads
   *  as "no special behaviour." */
  item_type?: string;
  /** Light radius (tiles) this item emits when lit/carried — read off
   *  the full items.json record. The overworld/dungeon light model
   *  reads the held torch's value here so a torch's reach is
   *  data-driven (matching the combat side, which already reads
   *  `light_range` off items/ammo) rather than a hardcoded constant.
   *  Absent → the engine falls back to `TORCH_LIGHT_RANGE`. */
  light_range?: number;
  /** RESERVED for the future multi-lock system — inert today. When
   *  set, names the lock category this key fits (matched against a
   *  door's {@link SimCell.lock_type}). A key with no `opens` (like
   *  the current `iron_key`) is a GENERIC key that fits any plain
   *  lock. Nothing reads this yet; reserving it now means adding
   *  keyed locks later needs no save/catalog migration. */
  opens?: string;
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

/** Minimal quests.json record the sim reads — just enough to drive
 *  the quest-offer dialog when the party steps onto a `quest`-tagged
 *  cell. The full Quest record carries steps / rewards / completion
 *  dialog too; those are not consumed by the kernel today (the v1
 *  quest log + step tracking is a follow-up). */
export interface SimQuestRef {
  id: string;
  name: string;
  description?: string;
  /** NPC that offers (and later accepts) the quest. The overlay
   *  renders the sprite + name + start_dialog. */
  quest_giver?: {
    npc_name?: string;
    npc_sprite?: string;
    start_dialog?: string;
    end_dialog?: string;
    /** Optional chatter for AFTER the quest is turned in — the giver
     *  becomes a normal NPC and this is their line. Falls back to a
     *  generic "thanks again" when absent. */
    post_dialog?: string;
  };
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
  /** Optional tint (packed RGB, e.g. 0xffe580) the placed-encounter
   *  renderer should overlay on the sprite — used today by dungeon
   *  quest-target placements to render a faint gold halo. Multiplied
   *  with the per-cell lighting tint at draw time so the colour
   *  reads natural at any ambient. */
  tint?: number;
  /** Editor-side organizational labels. Gameplay ignores them; carried
   *  through so the loader doesn't drop them on the round-trip. */
  tags?: string[];
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
  /** Step countdown for the Light spell (Cleric/priest). >0 =
   *  +MAGIC_LIGHT_RANGE to the party's emitted light radius.
   *  Decrements one per step. Optional in the type because legacy
   *  SimParty inputs (older tests, fresh saves) may omit it; the
   *  kernel coerces absence to 0. */
  magic_light_steps?: number;
  /** Step countdown for the priest's Push spell (repel_monsters
   *  party effect). >0 = roaming monsters inside the repel aura are
   *  driven away from the party each step instead of pursuing.
   *  Decrements one per step; optional like the other counters. */
  repel_monsters_steps?: number;
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
  /** Effect-specific knobs from effects.json (e.g. repel_monsters'
   *  `radius` + `push_distance` aura). Optional — most effects carry
   *  none, and legacy catalog casts pass through whatever is there. */
  params?: Record<string, unknown> | null;
}

/** Light range constants — same magic numbers v1 used. Held here so
 *  the panel UI and the kernel agree on what "lighting a torch" means. */
export const TORCH_LIGHT_RANGE = 3;
/** Light range when the Cleric's Light spell is active. */
export const MAGIC_LIGHT_RANGE = 5;
// INFRAVISION_RANGE used to live here as a stand-in for the
// Dwarf infravision ability. It was implemented as a 999-cell
// party light, which lit the entire map and meant a dwarf in
// the roster trivialised dungeon darkness. Infravision is a
// vision ability (the character sees in low light), not a
// physical light source the party emits. It'll come back as a
// separate "render mode" for the party when vision abilities
// land; for now the constant is intentionally absent so a
// stray reference fails the type-check.
