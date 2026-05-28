"use client";

/**
 * PlayHost — the game's world scene.
 *
 * Boot order on mount:
 *   1. Read the WorldSave from localStorage. No save → punt back to
 *      /play with a "no save" message.
 *   2. Load the module catalogs the kernel needs: maps + map_tiles
 *      palette (for grid materialization), characters, races, classes,
 *      effects, encounters, spawns, monsters, character_classes,
 *      spells (Knock for the lock dialog), counters (referenced by
 *      tiles).
 *   3. Resolve the saved currentMapId against the module's maps.json,
 *      backfill cells from the palette where fields are missing.
 *   4. Mount a small Phaser game containing one scene. The scene
 *      constructs a `WorldRenderer` for the shared scaffolding and a
 *      `MapSimulation` driven by a SceneBridge that delegates to the
 *      renderer.
 *
 * Event handling on the kernel:
 *   - `linked` → snapshot map mutations + party state into the save,
 *     write it, then either teleport the party (same-map portal) or
 *     remount the host with the new map.
 *   - `lock_encountered` → open the existing LockDialogOverlay.
 *   - Everything else (NPC, counter, spawn, dungeon) is logged for
 *     now; the overlay surface lands in Phase 2.5 / 4.
 *
 * Cross-map navigation strategy: same-map links call
 * `sim.teleport(x, y)` (the renderer's grid stays valid). Different-
 * map links bump a remount key; the load effect re-runs against the
 * new `currentMapId` and a fresh Phaser game spins up.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { withBasePath } from "@/util/basePath";
import { mergeModel } from "@/data_model/merge";
import { loadDraft } from "@/data_model/draft";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { ChestDialogOverlay } from "@/editor/ChestDialogOverlay";
import { LockDialogOverlay } from "@/editor/LockDialogOverlay";
import { QuestDialogOverlay } from "@/editor/QuestDialogOverlay";
import { PlayPartyScreenOverlay } from "./PlayPartyScreenOverlay";
import {
  PlayQuestCelebration,
  returnToGiverSubtitle,
  type PlayQuestCelebrationKind,
} from "./PlayQuestCelebration";
import { PlayLogOverlay } from "./PlayLogOverlay";
import { PlayCounterShopOverlay } from "./PlayCounterShopOverlay";
import { PlayNpcDialogOverlay } from "./PlayNpcDialogOverlay";
import type { CombatResolved } from "@/battle/scenes/CombatScene";
import { PlayCombatHost } from "./PlayCombatHost";
import { buildArenaCells, buildCustomArenaCells } from "@/play/buildArenaCells";
import { generateDungeonFromRecord } from "@/sim/dungeon/generateFromRecord";
import {
  dungeonEncounterRefs,
  dungeonLevelToMap,
  floorMapId,
  EXIT_TO_OVERWORLD_MAP_ID,
} from "@/sim/dungeon/dungeonLevelToMap";
import {
  clearAllDungeonSessions,
  getOrCreateDungeonSession,
  getFloorMutations,
  hydrateDungeonLevels,
  peekDungeonSession,
  serialiseDungeonLevels,
  writeFloorMutations,
} from "@/sim/dungeon/dungeonSession";
import type { DungeonRecord } from "@/sim/dungeon/types";
import type { DungeonLevel } from "@/battle/world/Dungeon";
import {
  TILE_STAIRS_DOWN,
} from "@/battle/world/Dungeon";
import { TILE_FOREST_ARCHWAY_DOWN } from "@/battle/world/Tiles";
import { DUNGEON_SPRITE_KEYS } from "@/sim/dungeon/tileMapping";
import type { EncounterTemplate } from "@/battle/world/Encounters";
import {
  MapSimulation,
  type LockEncounterOptions,
  type SceneBridge,
  type SpawnEncounterOptions,
} from "@/sim/MapSimulation";
import {
  claimQuestRewards,
  creditQuestRetrieve,
  ensureQuestStates,
  parseQuestsFile,
  type CombatLocation,
  type QuestDef,
  type QuestState,
  type QuestStepRewards,
} from "@/battle/world/Quests";
import { overlayVisibleAt, tintForCell } from "@/sim/lighting";
import { computeQuestGlowCells } from "@/sim/questGlow";
import { TILE_SIZE, WorldRenderer } from "@/sim/scene/WorldRenderer";
import { PaintedHelpScreen } from "@/sim/scene/PaintedHelpScreen";
import {
  PaintedQuestLog,
  type PaintedQuestLogData,
} from "@/sim/scene/PaintedQuestLog";
import {
  campfireRest,
  glowAura,
  healingSparkles,
  radialBurst,
  screenShake,
  VFX_COLOURS,
} from "@/vfx/Vfx";
import { Sfx } from "@/battle/audio/Sfx";
import { Soundtrack } from "@/audio/SoundtrackPlayer";
import { loadSpriteDraft } from "@/data_model/spriteDraft";
import {
  MINUTES_PER_STEP,
  advanceClock,
  fullStr,
  isDawn,
  isDay,
  isDusk,
  lunarPhaseName,
  makeClock,
} from "@/battle/world/GameTime";

/** How many log lines the adventure log retains. The in-canvas
 *  scene-log strip shows just the most recent one or two, but the
 *  L-key Log overlay (PlayLogOverlay) renders the full buffer, so we
 *  keep enough history to actually review a session. 200 lines is
 *  a few KB of strings; cheap to hold in memory. */
const MAX_LOG = 200;

/** Pixel height of the in-canvas bottom log strip — mirrors v1's
 *  `LOG_HEIGHT` constant from SceneLog. Reserved by the camera's
 *  setBounds (height + PLAY_LOG_HEIGHT) so the bottom row of tiles
 *  can scroll above the strip rather than hide behind it. */
const PLAY_LOG_HEIGHT = 32;

/** Map the game clock's time-of-day classification onto the
 *  WorldRenderer's lighting mode. Dawn + dusk both render as
 *  "twilight" (the lighting helper uses softer falloff than full
 *  night). Outside the day/twilight windows, the world is at full
 *  night ambient — full darkness with torch pools punching through. */
function lightingModeFromClock(
  clockMinutes: number,
): "day" | "twilight" | "night" {
  const clock = { totalMinutes: clockMinutes };
  if (isDay(clock)) return "day";
  if (isDawn(clock) || isDusk(clock)) return "twilight";
  return "night";
}

/** Convert a map's authored lighting override to the renderer's
 *  three-band lighting mode. Returns `null` when the map has no
 *  override (default `"world_time"`) — callers fall back to
 *  `lightingModeFromClock` in that case. The "darkness" authored
 *  value maps to the renderer's "night" mode so torches still throw
 *  light pools through it. */
function mapForcedLightingMode(
  map: { lighting?: "day" | "twilight" | "darkness" } | null | undefined,
): "day" | "twilight" | "night" | null {
  switch (map?.lighting) {
    case "day":
      return "day";
    case "twilight":
      return "twilight";
    case "darkness":
      return "night";
    default:
      return null;
  }
}

/** Apply a {@link QuestStepRewards} payload to a {@link WorldSave} and
 *  the live world side-effects (grid mutation, sprite repaint, boat
 *  registration, relight). Used by the kill-credit and retrieve-credit
 *  paths to fire step-scoped rewards the moment a step's
 *  `stepProgress` flips from false to true.
 *
 *  Semantics match {@link QuestRewards} application in `onQuestDecline`:
 *
 *   - **items** merge into the party's inventory via `addToInventory`
 *     (stack-aware via the items catalog). When `skipItems` is true
 *     the caller has already handled item granting another way
 *     (e.g. the kill-credit path mutates `gameState.partyData.inventory`
 *     so the post-combat sync — which would otherwise overwrite
 *     `save.party.inventory` from the kernel's view — preserves the
 *     additions). `summary` still reports the items so the
 *     celebration subtitle reads correctly.
 *   - **tileAdds** append to `save.maps[mapId].tileOverrides` so the
 *     mutation survives reload + re-entry. If the affected cell is on
 *     the currently-mounted map, the live grid + cell sprite update in
 *     the same frame so the player sees the bridge appear immediately;
 *     boat-flagged tiles also register with the kernel via `addBoatAt`
 *     so the boarding logic recognises the new cell. Cells on other
 *     maps just get the override stamped; the mount-time apply pass
 *     picks them up next visit.
 *
 *  Returns the next save plus a short summary suitable for appending
 *  to a step-completion celebration subtitle (e.g.
 *  `"+Camping Supplies · 1 map change"`) — empty when neither items
 *  nor tileAdds were authored. The renderer is relit when at least
 *  one tile_add landed, since walkability / light-source changes can
 *  flip torch behaviour in newly-passable corridors. */
function applyStepRewardsToSave(
  save: WorldSave,
  rewards: QuestStepRewards,
  ctx: {
    catalog: LoadedCatalog | null;
    renderer: WorldRenderer | null;
    sim: MapSimulation | null;
    /** True when the caller has already added the items elsewhere
     *  (e.g. directly into `gameState.partyData.inventory` during a
     *  kill-credit, to survive the post-combat sync's inventory
     *  overwrite). Defaults to false — the retrieve-credit path
     *  takes the default since it runs outside combat resolution and
     *  the save is the source of truth. */
    skipItems?: boolean;
  },
): { nextSave: WorldSave; summary: string; hadTileAdds: boolean } {
  if (rewards.items.length === 0 && rewards.tileAdds.length === 0) {
    return { nextSave: save, summary: "", hadTileAdds: false };
  }
  const summaryParts: string[] = [];

  // ── Items ───────────────────────────────────────────────────────
  const catalogItems = ctx.catalog?.items ?? [];
  let nextInventory = save.party.inventory;
  if (!ctx.skipItems) {
    nextInventory = save.party.inventory.map((e) => ({ ...e }));
    for (const id of rewards.items) {
      nextInventory = addToInventory(nextInventory, id, catalogItems, 1);
    }
  }
  if (rewards.items.length > 0) {
    // Use catalog display name when available; fall back to the raw
    // id so a missing catalog entry still surfaces *something* the
    // player can recognise.
    const labels = rewards.items.map((id) => {
      const def = catalogItems.find((it) => it.id === id);
      return def?.name || id;
    });
    summaryParts.push(`+${labels.join(", ")}`);
  }

  // ── Tile adds ──────────────────────────────────────────────────
  const nextMaps: typeof save.maps = { ...save.maps };
  const liveMap = ctx.catalog?.map;
  const palette = ctx.catalog?.palette ?? [];
  const r = ctx.renderer;
  let tileAddsApplied = 0;
  for (const op of rewards.tileAdds) {
    const { map: mapId, col, row, tile_id: tileId } = op;
    if (!tileId) continue;
    const prev = nextMaps[mapId] ?? {
      unlockedCells: [],
      defeatedEncounters: [],
      destroyedLairs: [],
    };
    const nextOverrides = [
      ...(prev.tileOverrides ?? []),
      { col, row, tileId },
    ];
    nextMaps[mapId] = { ...prev, tileOverrides: nextOverrides };
    tileAddsApplied += 1;
    if (liveMap && mapId === liveMap.id) {
      if (
        row >= 0 &&
        row < liveMap.height &&
        col >= 0 &&
        col < liveMap.width
      ) {
        const source = palette.find((t) => t.id === tileId);
        if (source) {
          liveMap.grid[row][col] = {
            ...source,
          } as typeof liveMap.grid[number][number];
          if (r && source.sprite) {
            r.setCellSprite(col, row, source.sprite);
          }
          if (
            (source as { boat?: boolean }).boat === true &&
            ctx.sim &&
            source.sprite
          ) {
            ctx.sim.addBoatAt(col, row, source.sprite);
          }
        }
      }
    }
  }
  if (tileAddsApplied > 0) {
    summaryParts.push(
      tileAddsApplied === 1
        ? "world changed"
        : `${tileAddsApplied} world changes`,
    );
  }

  const hadTileAdds = tileAddsApplied > 0;
  const nextSave: WorldSave = {
    ...save,
    party: {
      ...save.party,
      inventory: nextInventory,
    },
    maps: nextMaps,
  };
  if (r && hadTileAdds) r.relight();
  return { nextSave, summary: summaryParts.join(" · "), hadTileAdds };
}

/** Push step-reward items into the live `gameState.partyData.inventory`
 *  so the post-combat `applyCombatResultToSave` pass picks them up.
 *
 *  Why this exists: kill-credit step rewards fire from inside
 *  `resolveSpawnEncounter("won")` — which runs *before*
 *  `applyCombatResultToSave` overwrites `save.party.inventory` from
 *  `gameState.partyData.inventory`. If we only updated the save, the
 *  combat sync would silently throw the items away. Mutating the
 *  kernel's view ensures the additions survive the sync.
 *
 *  No-op when `gameState.partyData` is null (defensive — kill credits
 *  only fire during combat resolution, so this should always be live).
 *  Mirrors the stacking behaviour of `addToInventory` so a +1 Torch
 *  reward bumps an existing Torch stack rather than spawning a
 *  duplicate row.  */
function applyStepItemsToBattleState(
  items: ReadonlyArray<string>,
  catalog: LoadedCatalog | null,
): void {
  if (items.length === 0) return;
  const post = gameState.partyData;
  if (!post) return;
  const catalogItems = catalog?.items ?? [];
  let next: ReadonlyArray<{
    item: string;
    charges?: number;
    durability?: number;
  }> = post.inventory;
  for (const id of items) {
    next = addToInventory(next, id, catalogItems, 1);
  }
  // Mutate in place — `applyCombatResultToSave` re-reads
  // `gameState.partyData.inventory` so the array identity doesn't
  // matter, just the contents.
  post.inventory.length = 0;
  for (const e of next) post.inventory.push(e);
}

/** Build the JSON-safe SavedMapState for a current sim snapshot.
 *  Centralised so the three save sites — the explicit "save current"
 *  checkpoint, the same-map teleport branch, and the cross-map link
 *  branch — all persist the SAME fields. A missing field on any one
 *  path resets that state on the next mount (e.g. boatPositions
 *  falling back to a fresh grid scan, snapping every boat back to
 *  its authored cell). */
function mapStateFromSnapshot(
  snap: ReturnType<MapSimulation["snapshot"]>,
  prev?: SavedMapState | undefined,
  /** Live fog-of-war visited set — owned by the renderer, not the
   *  sim kernel (visibility is render-time LOS state, not gameplay
   *  state). The host pulls this from `rendererRef.current?.
   *  getVisitedCells()` at each save site so the union grown over
   *  the course of the visit lands in the save next to the other
   *  per-map deltas. When omitted (defensive default), the prior
   *  `prev.visitedCells` carries through — that protects us from
   *  accidentally clearing the fog on a save path that hasn't yet
   *  been wired up to pass the live set. */
  visitedCells?: ReadonlySet<string>,
): SavedMapState {
  const boatPositions: Record<string, string> = {};
  for (const [key, sprite] of snap.boatPositions) {
    boatPositions[key] = sprite;
  }
  // Spread `prev` first so any field the live snapshot DOESN'T
  // surface — today that's `tileOverrides`, tomorrow could be any
  // future authored-content per-map field — carries forward across
  // saves. Snapshot-derived fields overwrite the prev values
  // because the sim is the source of truth for runtime state
  // (boat positions, defeated encounters, etc.).
  //
  // Without this merge, crossing a cross-map link wiped any
  // `tileOverrides` the quest-reward path had written into
  // save.maps[id] — the snapshot built a fresh SavedMapState
  // without that field and overwrote the prior one. Symptom: a
  // quest that adds a boat-tile shows the boat until the party
  // walks through a link, then the tile disappears.
  return {
    ...(prev ?? {}),
    unlockedCells: Array.from(snap.unlockedCells),
    defeatedEncounters: Array.from(snap.defeatedEncounters),
    destroyedLairs: Array.from(snap.destroyedLairs),
    boatPositions,
    // Fog of war — prefer the live renderer set when supplied,
    // else fall back to whatever was already on disk so unwired
    // save paths don't reset the player's exploration progress.
    visitedCells: visitedCells
      ? Array.from(visitedCells)
      : prev?.visitedCells ?? [],
    // Picked-item cells — flushed from the kernel's running set so
    // collected items (regular walk-onto + chest-Open) stay gone
    // when the catalog reloads on the next map mount.
    pickedItemCells: Array.from(snap.pickedItemCells),
  };
}
import { loadWorld, saveWorld } from "@/play/save";
import { addToInventory } from "@/play/inventoryStacking";
import { applyCombatResultToSave } from "@/play/syncFromBattle";
import { gameState } from "@/battle/state";
import { awardQuestXpToSavedMembers } from "@/play/awardQuestXp";
import { herbalismOnStep } from "@/play/herbalism";
import {
  attemptPickpocket,
  canPickpocket,
} from "@/play/raceAbilities";
import type { SavedMapState, WorldSave } from "@/play/saveTypes";
import type {
  SimCharacter,
  SimCharacterClass,
  SimEffect,
  SimEncounterRef,
  SimGrid,
  SimMonsterRef,
  SimParty,
  SimQuestRef,
  SimRace,
  SimSpell,
} from "@/sim/types";
import type { SimSpawn } from "@/sim/spawn";
import type { CharacterRecord } from "@/editor/CharacterSheet";

/** Cells the kernel reads. Mirrors `TileType` from the editor without
 *  pulling that module's React-side type in. The cell carries every
 *  field MapSimulation looks at (walkable, link, locked, light_source,
 *  encounter, spawn, npc, counter, dungeon) plus the render fields
 *  WorldRenderer reads (sprite, animation). */
interface PlayCell {
  id: string;
  sprite?: string;
  walkable?: boolean;
  obstructs?: boolean;
  locked?: boolean;
  light_source?: boolean;
  light_range?: number;
  animation?: string | null;
  counter?: string;
  encounter?: string;
  spawn?: string;
  npc?: string;
  dungeon?: string;
  boat?: boolean;
  /** True = a boat can sail UNDER this tile (bridge semantics). The
   *  tile stays walkable on foot; the sim treats it as a sail-through
   *  for boat movement, and the play scene paints a bridge-top
   *  overlay above the boat so the vessel reads as passing beneath. */
  boat_passable?: boolean;
  tag?: string;
  link?: { map_id: string; x: number; y: number } | null;
  [k: string]: unknown;
}

interface PlayMapRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  grid: PlayCell[][];
  /** Optional authored lighting override. Absent → follow the world
   *  clock (the default). The three explicit values force the
   *  renderer into the matching band on this map regardless of the
   *  in-game hour: "darkness" maps to the renderer's "night" mode so
   *  torches throw real light pools, "day" / "twilight" lock the
   *  ambient brightness. Surfaced via the Map Properties dialog. */
  lighting?: "day" | "twilight" | "darkness";
  /** Optional per-map background-music playlist. Each entry is an
   *  audio file URL. When present + non-empty, this list overrides
   *  the module-level default while the party is on this map;
   *  absent / empty falls back to the module's playlist. */
  soundtrack?: string[];
}

/** Minimal item shape PlayHost uses to render overlays. The full
 *  v2 item record carries more (slots, durability, buy/sell, etc.);
 *  only the icon is read here. */
interface PlayItem {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  /** True when multiple copies of this id collapse into one
   *  inventory row (Torch, Arrows, Lockpicks, …). Read by the
   *  stacking helpers when granting quest rewards or loot. */
  stackable?: boolean;
  /** Catalog charges — per-use effect, not inventory quantity. Kept
   *  on this minimal type so the loader doesn't have to strip the
   *  field. */
  charges?: number;
  /** Shop prices (gold). Used by the in-world counter shop overlay.
   *  Items where the field is absent / null / 0 can't be bought
   *  (or sold) at the corresponding side of a counter. */
  buy?: number | null;
  sell?: number | null;
  /** Catalog peak durability for non-stackable wear. Read by the
   *  counter shop overlay's durability-scaled sell pricing — a
   *  half-worn weapon nets half its base sell. Absent for items
   *  that don't wear (consumables, quest tokens). */
  durability?: number;
  /** True when the item is consumable from the party stash (Torch,
   *  Camping Supplies, Antidote, etc). Surfaces the Use button in
   *  the Party screen's stash list. */
  usable?: boolean;
  /** True when the catalog record describes a treasure chest. Cells
   *  whose `item` is a chest fire `chest_encountered` on bump
   *  (Open / Leave dialog) instead of the normal walk-to-pickup
   *  `item_picked` flow. The host reads `contents` to apply the
   *  payload to the save on Open. */
  is_chest?: boolean;
  /** Authored payload delivered to the party when the chest is
   *  opened. Both fields are optional; an empty chest still opens
   *  but is a flavour-only encounter. */
  contents?: {
    gold?: number;
    items?: ReadonlyArray<{ id: string; qty?: number }>;
  };
}

/** One line of NPC chatter from npcs.json. Surfaced in the
 *  NPC-dialog modal so the player can cycle through what the NPC
 *  has to say. */
interface PlayNpcDialog {
  id: string;
  title?: string;
  text: string;
}

/** Minimal NPC shape PlayHost cares about — id + name + sprite +
 *  optional `counter` linking the NPC to a shop counter + optional
 *  `dialogs` array. When a player walks into an NPC, the dialog
 *  modal opens with the NPC's chatter; if the NPC also has a
 *  counter, the modal offers a Visit Counter button that opens
 *  the matching shop. */
interface PlayNpc {
  id: string;
  name?: string;
  sprite?: string;
  counter?: string;
  dialogs?: PlayNpcDialog[];
}

/** One temple-style service row on a `kind: "service"` counter
 *  (Heal All HP, Cure Poisons, Raise Dead, etc.). Applied to the
 *  whole party in one click; cost gates by gold. */
interface PlayCounterService {
  id: string;
  name?: string;
  description?: string;
  cost?: number;
}

/** Shop / temple counter shape PlayHost needs for the in-world
 *  buy/sell overlay. Mirrors counters.json: every counter has an
 *  id + display name. Shops carry `items` (id strings); temples
 *  set `kind: "service"` and carry `services[]` with apply-once
 *  recipe rows. The overlay branches on `kind`. */
interface PlayCounter {
  id: string;
  name?: string;
  description?: string;
  kind?: string;
  items?: string[];
  services?: PlayCounterService[];
}

/** Session-only state set when the party is exploring a dungeon.
 *  Lives in a ref on PlayHost — not persisted to the save (a tab
 *  close inside a dungeon drops the party back at the overworld
 *  entrance on next load). Tracks which dungeon record we generated
 *  from, the per-floor levels (regenerated once, cached for the
 *  session via dungeonSession), the current floor index, the
 *  overworld return cell, and the cell to mount the party on this
 *  floor. */
interface DungeonState {
  dungeonId: string;
  seed: number;
  levels: DungeonLevel[];
  floorIdx: number;
  /** Where on the overworld to drop the party when they exit. */
  returnTo: { mapId: string; col: number; row: number };
  /** Cell to land on when the floor mounts. Set by dungeon_entered
   *  (entrance of F0) and floor transitions (entry of the new floor).
   *  Consumed during the Phaser mount; survives across reloads of
   *  the *same* floor because the load effect re-reads it. */
  startAt: { col: number; row: number };
}

interface LoadedCatalog {
  map: PlayMapRecord;
  /** Every map in the module's maps catalog — used to resolve a
   *  spawn / encounter's `custom_map` field to an arena grid at
   *  combat-open time. Grids are NOT hydrated against the palette
   *  here (the world map is the only one that needs that for
   *  WorldRenderer); buildArenaCells reads `sprite` / `walkable` /
   *  `obstructs` / `light_*` directly off the cells, all of which
   *  v2 already materializes inline on every painted cell. */
  allMaps: PlayMapRecord[];
  /** Palette (map_tiles) — used for the destroy-lair fallback and
   *  cell-prototype hydration. */
  palette: PlayCell[];
  characters: SimCharacter[];
  races: SimRace[];
  classes: SimCharacterClass[];
  effects: SimEffect[];
  monsters: SimMonsterRef[];
  encounters: SimEncounterRef[];
  spawns: SimSpawn[];
  /** Authored dungeons catalog. Resolved at dungeon_entered time —
   *  the host looks up the matching record, generates its levels,
   *  and swaps the world map for the dungeon's first floor. */
  dungeons: DungeonRecord[];
  /** Authored NPC catalog. Cells carrying an `npc` id match against
   *  this list; the matched record's `sprite` paints a small overlay
   *  on the cell so the player can see who lives where. Identity
   *  carries through to the npc_encountered event for future dialog
   *  routing. */
  npcs: PlayNpc[];
  /** Authored counters catalog (shops, temples). Resolved at
   *  counter_encountered time (and when an NPC with a `counter`
   *  field is walked into) so the play host can mount the
   *  matching shop overlay. */
  counters: PlayCounter[];
  /** Authored quests catalog. Cells carrying a `quest` id match
   *  against this; on step the sim emits `quest_encountered` and
   *  the host opens the offer dialog. */
  quests: SimQuestRef[];
  knockSpell: SimSpell | null;
  /** Items catalog — used to resolve `cell.item` overlays to their
   *  icon sprite (`item/<icon>.png`). Kernel doesn't read this
   *  directly; it's a scene-render concern. */
  items: PlayItem[];
  /** Abilities catalog — read by per-step passive helpers
   *  (Herbalism today, future passives later) so the gameplay
   *  knobs (find chance, foraging terrain list, etc.) can live in
   *  data rather than code. Loose typing because each consumer
   *  reads its own subset of `params`. */
  abilities: ReadonlyArray<{
    id: string;
    name?: string;
    params?: Record<string, unknown> | null;
  }>;
  /** Recipes catalog — read by the Alchemist's brew_potion
   *  picker so a player can pick a recipe to convert reagents
   *  into a finished potion. Shape mirrors recipes.json
   *  (id, name, result_item, reagents-by-id-count). */
  recipes: ReadonlyArray<{
    id: string;
    name?: string;
    result_item: string;
    reagents: Record<string, number>;
  }>;
  /** Module-level default soundtrack — file URLs the SoundtrackPlayer
   *  rotates through when neither the current map nor the active
   *  dungeon has its own override. Loaded from the leaf module's
   *  manifest at catalog-resolve time. Absent / empty means "silence
   *  unless the map / dungeon authors a list." */
  moduleSoundtrack: string[];
}

interface State {
  kind: "loading" | "ok" | "error" | "no-save";
  message?: string;
  catalog?: LoadedCatalog;
  save?: WorldSave;
}

export function PlayHost() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  /** Bump to force the load effect to re-run when the current map
   *  changes (cross-map link). Same identity = no reload. */
  const [reloadKey, setReloadKey] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<MapSimulation | null>(null);
  const saveRef = useRef<WorldSave | null>(null);
  /** Lock-dialog state — populated by the sim's `lock_encountered`
   *  event when the party bumps a locked cell. Cleared on dismiss/
   *  success. Movement is gated on this via `overlaysOpenRef`. */
  const [lockEncounter, setLockEncounter] =
    useState<LockEncounterOptions | null>(null);
  /** Chest dialog state — set on `chest_encountered` (the sim emits
   *  this when the party bumps a cell whose `item` is flagged
   *  `is_chest: true` in the catalog). Cleared on Open / Leave.
   *  Carries the catalog id + cell position; the rendered dialog
   *  resolves the chest's `contents` from `state.catalog.items`. */
  const [chestEncounter, setChestEncounter] = useState<{
    chestId: string;
    pos: { col: number; row: number };
  } | null>(null);
  /** Quest dialog state — set on `quest_encountered`, cleared on
   *  Accept / Decline / Close. The kernel re-fires this event every
   *  time the party bumps the quest-giver tile (no status-based
   *  filtering), so the host computes the dialog mode here based on
   *  the current QuestState:
   *
   *   - `status: "available"` → offer (Accept / Decline)
   *   - `status: "active"`    → in-progress (Close)
   *   - `status: "completed"` → handoff (Close flips to "turned_in")
   *   - `status: "turned_in"` → suppressed entirely (handler bails)
   *
   *  All view inputs are computed at event time so the render block
   *  stays a pure function of state. Movement gates on this through
   *  overlaysOpenRef so a chained step doesn't slip past the dialog. */
  const [questOffer, setQuestOffer] = useState<{
    questId: string;
    quest: SimQuestRef;
    alreadyAccepted: boolean;
    complete: boolean;
    stepIdx: number;
    stepCount: number;
    activeStepName?: string;
    activeStepDescription?: string;
  } | null>(null);
  /** Active combat — set on `spawn_encountered`, cleared when the
   *  combat scene reports back via `onResolved`. While set the world
   *  Phaser game is unmounted and PlayCombatHost takes its place. */
  const [combat, setCombat] = useState<SpawnEncounterOptions | null>(null);
  /** Party screen toggle — opens with the `P` key, closes with `P`
   *  again (or ESC, or backdrop click). Mirrors the editor's
   *  `partyScreenOpen` flag. While true, movement keys are gated
   *  via overlaysOpenRef so the party doesn't keep stepping under
   *  the modal. */
  const [partyScreenOpen, setPartyScreenOpen] = useState(false);
  /** Inspector-screen open flags. Each opens with its respective key
   *  (Q/H/L) and closes on the same key or ESC. Gated through
   *  overlaysOpenRef so the sim pauses while any of them are up. */
  const [questLogOpen, setQuestLogOpen] = useState(false);
  const [helpTipsOpen, setHelpTipsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  /** When non-null, the play-side counter shop is open against this
   *  counter id. Set when the party walks into a counter tile or an
   *  NPC with a `counter` field. Cleared by the overlay's close
   *  callback. */
  const [counterShopId, setCounterShopId] = useState<string | null>(null);
  /** When the counter shop was opened from an NPC dialog (Visit
   *  Counter button), remember that NPC's id so closing the counter
   *  pops back to the same dialog the player came from instead of
   *  dropping them to the world map. Null for the tile-walk-into-
   *  counter path (no parent dialog to return to). Cleared the
   *  moment we restore the dialog, or on any forced close that
   *  shouldn't surface the NPC again (currently none, but kept as
   *  the explicit reset point). */
  const [counterReturnToNpcId, setCounterReturnToNpcId] = useState<
    string | null
  >(null);
  /** Queue of pending celebration placards. Pushed to whenever a
   *  quest step transitions from incomplete to complete (kill credit
   *  with `stepCompleted: true`) or when the player turns in a fully
   *  complete quest. The head of the queue is rendered until its
   *  `onDismiss` fires, then it shifts off. Stack semantics aren't
   *  ideal because two events firing close together would otherwise
   *  overdraw each other; queue lets them play in order. */
  const [questCelebrations, setQuestCelebrations] = useState<
    ReadonlyArray<{
      key: string;
      kind: PlayQuestCelebrationKind;
      title: string;
      subtitle?: string;
    }>
  >([]);
  /** NPC currently being talked to. Set when the party bumps an NPC
   *  cell; the dialog modal renders the NPC's chatter and, when the
   *  NPC has a counter, exposes a Visit Counter button that hands
   *  off to the shop overlay. */
  const [npcDialogId, setNpcDialogId] = useState<string | null>(null);
  /** Scrolling log of in-world messages — text-on-step from cells
   *  with the `text` field, plus the kernel's narrated events (Edge
   *  of the map, You descend into the dungeon, Approach Lair: …).
   *  Capped at MAX_LOG to keep render cheap. */
  const [logMessages, setLogMessages] = useState<string[]>([]);
  /** Live game clock — total minutes since the module's epoch.
   *  Initialised from the save on load, advanced MINUTES_PER_STEP per
   *  successful party move, and persisted by saveCurrent. Re-renders
   *  the HUD date/time/moon readout each tick. */
  const [clockMinutes, setClockMinutes] = useState(0);
  /** Mirror clock + renderer in refs so the per-step closure inside
   *  the bridge's `moved` listener reads the latest values without
   *  refreshing on every minute change. The renderer ref also
   *  shortcuts setLightingMode without a React render hop. */
  const clockRef = useRef(0);
  const rendererRef = useRef<WorldRenderer | null>(null);
  /** Painted in-canvas Help & Tips screen. Lives inside the Phaser
   *  scene and replaces the React `PlayHelpTipsOverlay` modal — first
   *  of the inspector screens to be painted (see PaintedHelpScreen
   *  comment for the rationale). Null between scene swaps; the
   *  helpTipsOpen sync effect calls `open()` / `close()` on it. */
  const helpScreenRef = useRef<PaintedHelpScreen | null>(null);
  /** Painted in-canvas Quest Log screen. Same pattern as
   *  `helpScreenRef` — React state owns the open boolean, the
   *  painter owns the pixels. The sync effect calls `open(data)`
   *  with a fresh snapshot from `saveRef.current` so the log always
   *  shows the live state (quest accepts + step credits mutate
   *  saveRef without re-rendering React; see the quest-log mount
   *  block for the same caveat the React overlay used to address). */
  const questLogScreenRef = useRef<PaintedQuestLog | null>(null);
  /** Per-cell item-overlay helpers exposed by the inline scene class.
   *  PlayHost talks through this ref to (a) drop a quest item on a
   *  cell when a retrieve step is accepted while the player is on
   *  the target map, and (b) tear down the overlay sprite after the
   *  party walks onto the cell to retrieve it (the kernel cleared
   *  `cell.item` already, but the Phaser Image needs an explicit
   *  destroy). Null between scene swaps. */
  const itemOverlayBridgeRef = useRef<{
    placeItem: (col: number, row: number, itemId: string) => void;
    removeItem: (col: number, row: number) => void;
  } | null>(null);
  const overlaysOpenRef = useRef(false);
  /** Session-only dungeon state. Null on the overworld. Populated
   *  when a `dungeon_entered` event lands; cleared when the party
   *  exits through stairs at F0 or stairs-down on the bottom floor.
   *  Read by the load effect (to overlay the catalog with the
   *  dungeon's floor) and by `saveCurrent` / `handleLinked`. */
  const dungeonStateRef = useRef<DungeonState | null>(null);
  /** Mirrors the React combat state into a ref so closures inside
   *  long-lived callbacks (notably `onCombatResolved`, which is
   *  memoized with a minimal dep list) read the live encounter
   *  rather than a stale capture. Same pattern as `saveRef`. */
  const combatRef = useRef<SpawnEncounterOptions | null>(null);
  /** Mirrors the loaded catalog into a ref for the same reason —
   *  callbacks created early in the React lifecycle (before the
   *  catalog finished loading) need a live read at call time, not
   *  the empty initial snapshot. */
  const catalogRef = useRef<LoadedCatalog | null>(null);
  /** Parsed v2 QuestDef[] — populated when the sim mounts. Used by
   *  the quest_encountered handler to compute the dialog mode and by
   *  the kill-credit listener to update save.questStepProgress. */
  const questDefsRef = useRef<QuestDef[]>([]);
  /** Sandbox-scoped quest state. Status / step kills / step progress
   *  per quest id. Bootstrapped from `save.acceptedQuests` +
   *  `save.questStepProgress` at sim-mount time so existing saves
   *  resume their progress; mutated as the player accepts quests
   *  and kills quest targets. (Saving the full QuestState into the
   *  save shape is a follow-up — for now, on reload, status is
   *  re-inferred from acceptedQuests + questStepProgress.) */
  const questStatesRef = useRef<Map<string, QuestState>>(new Map());
  /** Live set of cells (`"col,row"`) that currently hide an armed
   *  trap. Seeded at sim mount from the catalog's grid (any cell with
   *  `trap: true` after dungeonLevelToMap factored out already-
   *  triggered cells); pruned when a trap fires. Used by
   *  refreshDetectedTraps to push the right set to the renderer
   *  whenever Detect Traps toggles. */
  const liveTrapsRef = useRef<Set<string>>(new Set());
  /** Repaint the detected-trap overlay. Pushes an empty set to the
   *  renderer when Detect Traps isn't active (clears every red X).
   *  When active, pushes only the cells within the party's current
   *  light radius — traps far in the dark stay hidden until the
   *  party walks into range, matching v1's "you can only detect what
   *  you can see" rule. The radius is the same one
   *  `partyLightRange` returns (torch / Light spell); baseline
   *  1-cell vision when the party emits no light is enough that the
   *  cell the party stands on is always covered. */
  const refreshDetectedTraps = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const cur = saveRef.current;
    const hasDetect = !!cur?.party.party_effects?.includes("detect_traps");
    if (!hasDetect || liveTrapsRef.current.size === 0) {
      r.setDetectedTraps(new Set());
      return;
    }
    const sim = simRef.current;
    if (!sim) {
      r.setDetectedTraps(new Set());
      return;
    }
    const snap = sim.snapshot();
    // Use 1 as the floor — even with no light source the party can
    // see the tile they're standing on plus their cardinal
    // neighbours; matches the lighting helper's implicit baseline.
    const radius = Math.max(1, snap.lightRange);
    const px = snap.pos.col;
    const py = snap.pos.row;
    const visible = new Set<string>();
    for (const key of liveTrapsRef.current) {
      const [cs, rs] = key.split(",");
      const c = Number.parseInt(cs, 10);
      const ro = Number.parseInt(rs, 10);
      if (!Number.isFinite(c) || !Number.isFinite(ro)) continue;
      // Chebyshev distance — same shape the lighting pool uses
      // (square aura around the party). Euclidean would round-trip
      // the corners off; we'd rather match what the player's eyes
      // see in the lit area.
      const cheby = Math.max(Math.abs(c - px), Math.abs(ro - py));
      if (cheby <= radius) visible.add(key);
    }
    r.setDetectedTraps(visible);
  }, []);

  /** Enqueue a celebration placard + fire its sound and a gold
   *  radial burst at the party's current tile. The placard itself
   *  renders the React overlay; the burst + sfx are side effects
   *  that should fire ONCE per credit (placard re-renders shouldn't
   *  re-trigger them) so they're scheduled here, at the enqueue
   *  point, rather than inside the component.
   *
   *  Three things happen synchronously:
   *
   *   1. Push the placard onto `questCelebrations`. The render
   *      effect picks it up at the head of the queue and starts the
   *      fade-in.
   *   2. Play the matching SFX from the chiptune catalog. Both names
   *      already exist; `level_up` for steps reads as "progress
   *      tone", `victory` for quest-complete is the bigger fanfare.
   *   3. Spawn a gold radial-burst particle effect at the party's
   *      Phaser tile. The burst is purely cosmetic so a missing
   *      scene (between map swaps) is silently no-op.
   *
   *  Idempotent on the placard side — the `key` makes each entry
   *  unique so React doesn't collapse two back-to-back step
   *  completions for the same quest into one node.  */
  const fireQuestCelebration = useCallback(
    (args: {
      kind: PlayQuestCelebrationKind;
      title: string;
      subtitle?: string;
    }) => {
      const key = `${args.kind}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      setQuestCelebrations((prev) => [
        ...prev,
        { key, kind: args.kind, title: args.title, subtitle: args.subtitle },
      ]);
      // SFX choice tracks how big the moment feels — quest turn-ins
      // get the full victory fanfare; intermediate / final steps get
      // the smaller level_up chirp; race / class-active abilities
      // use a thematic cue (lockpick-style click for the Halfling's
      // deft pickpocket, a magic-burst chime for the Gnome's
      // tinkering, the level_up chirp for the Ranger's crafting
      // since it's a more mundane workbench moment). Quest accept
      // borrows the magic_burst chime — feels like a calling rather
      // than a milestone, and stays sonically distinct from
      // level_up which is the workhorse "step credited" chime.
      const sfx =
        args.kind === "quest"
          ? "victory"
          : args.kind === "quest-accept"
            ? "magic_burst"
            : args.kind === "pickpocket"
              ? "lock_pick_success"
              : args.kind === "tinker"
                ? "magic_burst"
                : args.kind === "craft"
                  ? "level_up"
                  : "level_up";
      Sfx.play(sfx);
      // Spawn the celebratory burst at the party's tile. Sim's
      // snapshot has the live position; the renderer turns that into
      // pixel coordinates. Skipping silently when either is missing
      // (e.g. mid map-swap) keeps the celebration robust.
      const r = rendererRef.current;
      const sim = simRef.current;
      if (r && sim) {
        const snap = sim.snapshot();
        const x = snap.pos.col * TILE_SIZE + TILE_SIZE / 2;
        const y = snap.pos.row * TILE_SIZE + TILE_SIZE / 2;
        if (args.kind === "quest-accept") {
          // Accept gets a sky-blue treatment instead of the gold of
          // the completion family — a soft expanding ring (glowAura)
          // as the primary cue plus a smaller, lighter radial burst
          // in the same palette so the moment reads as deliberate
          // without competing with the bigger gold turn-in placard.
          // VFX_COLOURS.lightning (0xa9d4ff) lines up with the
          // sky-300 border + halo on the placard.
          glowAura(r.scene, { x, y }, 0xa9d4ff).catch(() => undefined);
          radialBurst(
            r.scene,
            { x, y },
            0xa9d4ff,
            0xc6e3ff,
            48,
          ).catch(() => undefined);
        } else {
          // Gold burst — matches the quest-glow halo so the
          // celebration reads as part of the same visual family.
          // Burst radius grows with the moment: a mid-step credit
          // gets a small puff (56), race-active abilities get a
          // slightly wider one (62) so the player notices over the
          // map chatter, the final-step "objectives done" moment
          // gets a wider one (68) so it stands out from the routine
          // steps without stealing the full turn-in's payoff (80).
          const burstRadius =
            args.kind === "quest"
              ? 80
              : args.kind === "step-final"
                ? 68
                : args.kind === "pickpocket" ||
                    args.kind === "tinker" ||
                    args.kind === "craft"
                  ? 62
                  : 56;
          radialBurst(r.scene, { x, y }, 0xffd750, 0xffe580, burstRadius).catch(
            () => undefined,
          );
        }
      }
    },
    [],
  );

  /** Push the quest-relevance halo set into the renderer. Computed
   *  from the live grid + quest defs + the accepted-quests +
   *  turned-in-quests sets in the save. Quest givers glow as a
   *  breadcrumb that draws the player TO the quest in the first
   *  place — and back for the handoff after the work is done —
   *  but stop glowing once the quest is fully turned in (the giver
   *  has nothing left to offer). Kill-step encounters and fetch-
   *  step items glow only once the relevant quest is in
   *  acceptedQuests. Called at:
   *
   *   - Map mount (initial seed)
   *   - Quest accept (acceptedQuests grew)
   *   - Quest turn-in (turnedInQuests grew — giver cell goes dark)
   *
   *  Doesn't need to fire on kill credit or mid-quest step
   *  completion: encounter / item cells naturally disappear from
   *  the grid once consumed, so the next relight's halo pass
   *  paints nothing for them. */
  const refreshQuestGlow = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const grid = r.grid;
    if (!grid) return;
    const defs = questDefsRef.current ?? [];
    const accepted = new Set<string>(saveRef.current?.acceptedQuests ?? []);
    const turnedIn = new Set<string>(saveRef.current?.turnedInQuests ?? []);
    // Casts: WorldRenderer's `RenderGrid` types its cells as
    // RenderCell (sprite/light_*/obstructs only) since those are the
    // only fields the renderer itself reads, but the same cells
    // carry `quest`/`encounter`/`item` at runtime (the catalog hands
    // the full PlayCell shape in). The glow helper only reads those
    // three string fields, so the unknown-cast is safe. QuestDef's
    // steps are a structural superset of the helper's
    // `{ kind, params }` requirement.
    const cells = computeQuestGlowCells(
      grid as unknown as ReadonlyArray<
        ReadonlyArray<{ quest?: string; encounter?: string; item?: string }>
      >,
      defs,
      { acceptedQuests: accepted, turnedInQuests: turnedIn },
    );
    r.setQuestGlowCells(cells);
  }, []);

  /** Walk active retrieve steps and stamp their items onto the current
   *  map's grid (via the bridge — which both updates `cell.item` and
   *  creates the rendered overlay). Idempotent: a step whose target
   *  cell already carries its item leaves the bridge's placeItem to
   *  no-op via the existing-overlay guard.
   *
   *  Called at:
   *   - Mount: items for already-accepted steps land in `cell.item`
   *     directly in the scene's create() pass, before the overlay
   *     loop runs. THIS function isn't strictly needed there.
   *   - Quest accept: a newly-accepted quest may carry retrieve
   *     steps on the current map; we need to drop their items
   *     immediately so the player sees them.
   *
   *  Doesn't need to fire on step completion (the kernel cleared
   *  cell.item already and the pickup handler calls removeItem on
   *  the overlay). */
  const refreshRetrievePlacements = useCallback(() => {
    const bridge = itemOverlayBridgeRef.current;
    if (!bridge) return;
    const save = saveRef.current;
    if (!save) return;
    const map = catalogRef.current?.map;
    if (!map) return;
    const accepted = new Set(save.acceptedQuests ?? []);
    const turnedIn = new Set(save.turnedInQuests ?? []);
    const progress = save.questStepProgress ?? {};
    for (const def of questDefsRef.current) {
      if (!accepted.has(def.id)) continue;
      if (turnedIn.has(def.id)) continue;
      const completedIdx = progress[def.id] ?? 0;
      for (let i = 0; i < def.steps.length; i++) {
        if (i < completedIdx) continue;
        const step = def.steps[i];
        if (step.kind !== "retrieve") continue;
        if (step.mapId !== map.id) continue;
        if (!step.itemId) continue;
        bridge.placeItem(step.col, step.row, step.itemId);
      }
    }
    // Refresh the glow so newly-placed items light up immediately.
    refreshQuestGlow();
  }, [refreshQuestGlow]);

  useEffect(() => {
    // Lock dialog, quest offer, active combat, the Party screen, and
    // each of the three inspector overlays (Q quest log, H help, L
    // log) all gate keyboard movement through the same ref so the
    // world sim freezes under any of them.
    overlaysOpenRef.current =
      !!lockEncounter ||
      !!chestEncounter ||
      !!combat ||
      !!questOffer ||
      partyScreenOpen ||
      questLogOpen ||
      helpTipsOpen ||
      logOpen ||
      counterShopId !== null ||
      npcDialogId !== null;
  }, [
    lockEncounter,
    chestEncounter,
    combat,
    questOffer,
    partyScreenOpen,
    questLogOpen,
    helpTipsOpen,
    logOpen,
    counterShopId,
    npcDialogId,
  ]);
  useEffect(() => {
    combatRef.current = combat;
  }, [combat]);
  // Sync the painted Help & Tips screen with its React state flag.
  // Pattern that future painted screens will copy: React owns the
  // boolean (so overlaysOpenRef + the inspector-key listener don't
  // change), the painter owns the pixels. The painter's own onClose
  // callback flips the boolean back when the user dismisses with
  // H/Esc/click-outside; that re-enters this effect and the call
  // to `close()` is a safe no-op.
  useEffect(() => {
    const screen = helpScreenRef.current;
    if (!screen) return;
    if (helpTipsOpen) screen.open();
    else screen.close();
  }, [helpTipsOpen]);
  // Sync the painted Quest Log with its React state flag. Same
  // pattern as the help screen except `open()` takes data — we read
  // it fresh from `saveRef.current` here so the log shows quest
  // accepts / step credits / turn-ins that mutated the save without
  // triggering a React re-render (the play loop deliberately keeps
  // those off `state.save` to avoid remounting the Phaser scene).
  useEffect(() => {
    const screen = questLogScreenRef.current;
    if (!screen) return;
    if (questLogOpen) {
      const liveSave = saveRef.current ?? state.save;
      if (!liveSave || !state.catalog) return;
      const data: PaintedQuestLogData = {
        quests: state.catalog.quests,
        acceptedQuests: liveSave.acceptedQuests ?? [],
        questStepProgress: liveSave.questStepProgress ?? {},
        turnedInQuests: liveSave.turnedInQuests ?? [],
      };
      screen.open(data);
    } else {
      screen.close();
    }
  }, [questLogOpen, state.catalog, state.save]);
  // Inspector-screen keybindings:
  //
  //   P → Party screen        (roster + stash + effects)
  //   Q → Quest log           (active / completed quests)
  //   L → Adventure log       (full message back-buffer)
  //   H → Help & tips         (keyboard shortcuts cheat sheet)
  //
  // Each opens its respective modal when no other modal / dialog /
  // combat is in the way. The overlays themselves listen for their
  // own key (and ESC) to close, so a second tap dismisses cleanly —
  // this listener no-ops when its target is already open.
  useEffect(() => {
    const onInspectorKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        key !== "p" &&
        key !== "q" &&
        key !== "l" &&
        key !== "h"
      ) {
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (lockEncounter || combat || questOffer) return;
      // Already-open modal? The overlay's own listener handles the
      // close; just bail so we don't try to re-open it.
      if (partyScreenOpen || questLogOpen || helpTipsOpen || logOpen) {
        return;
      }
      e.preventDefault();
      if (key === "p") setPartyScreenOpen(true);
      else if (key === "q") setQuestLogOpen(true);
      else if (key === "l") setLogOpen(true);
      else if (key === "h") setHelpTipsOpen(true);
    };
    window.addEventListener("keydown", onInspectorKey);
    return () => window.removeEventListener("keydown", onInspectorKey);
  }, [
    lockEncounter,
    combat,
    questOffer,
    partyScreenOpen,
    questLogOpen,
    helpTipsOpen,
    logOpen,
  ]);
  useEffect(() => {
    catalogRef.current = state.catalog ?? null;
  }, [state.catalog]);

  // Soundtrack — switch the active playlist whenever the catalog
  // changes (new map / module) or a dungeon transition fires
  // (reloadKey bumps on every dungeon enter / exit + cross-map link).
  // Resolution order: dungeon override → map override → module
  // default. An empty effective list silences the player rather than
  // continuing the prior track, so a map that explicitly clears the
  // playlist gets actual quiet rather than music bleeding in from
  // wherever the party just came from.
  //
  // We DON'T call Soundtrack.play() here when the browser hasn't
  // seen a user gesture yet — that play() rejects under autoplay
  // policy and the player ends up idle. Instead, the bridge's
  // `moved` listener kicks `Soundtrack.play()` on the party's first
  // step, which IS a guaranteed user gesture. Subsequent
  // setPlaylist calls auto-pick a fresh random track because the
  // player is already in the `_playing` state from that first kick.
  useEffect(() => {
    if (state.kind !== "ok") return;
    const catalog = state.catalog;
    if (!catalog) return;
    const dungeon = dungeonStateRef.current;
    const dungeonRecord = dungeon
      ? catalog.dungeons.find((d) => d.id === dungeon.dungeonId) ?? null
      : null;
    const fromDungeon = dungeonRecord?.soundtrack;
    const fromMap = catalog.map.soundtrack;
    const playlist =
      fromDungeon && fromDungeon.length > 0
        ? fromDungeon
        : fromMap && fromMap.length > 0
          ? fromMap
          : catalog.moduleSoundtrack;
    Soundtrack.setPlaylist(playlist ?? []);
  }, [state, reloadKey]);

  // No unmount cleanup for the soundtrack: in React strict mode dev
  // double-invokes the mount/unmount cycle, and even in prod the
  // brief PlayHost unmount during a same-route reload would chop the
  // music. Letting the player module-scope singleton keep playing
  // bridges the intro screen → catalog load gap without any silence.
  // The pages that legitimately *end* a play session call
  // `Soundtrack.stop()` themselves: the play picker at /play (a fresh
  // session about to begin) and the death screen at /play/end.

  // Load save + catalogs + map. Re-runs when `reloadKey` bumps.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `let` because the catalog-load step below may rewrite this
      // reference once it backfills max_hp / max_mp onto save members
      // that were saved before those fields existed.
      let save = loadWorld();
      if (!save) {
        setState({ kind: "no-save" });
        return;
      }
      saveRef.current = save;
      // Rehydrate dungeon state from the save before catalog
      // assembly — `currentDungeon` on the party means the player
      // saved (or last left) inside a dungeon, and the floor
      // catalog needs to be in place before Phaser mounts. The
      // in-memory dungeonSession store is also primed here so the
      // same rolled layout the save captured comes back; no fresh
      // generation runs on reload.
      const cdRaw = save.party.currentDungeon;
      const persistedRaw = cdRaw ? save.dungeons?.[cdRaw.dungeonId] : null;
      if (cdRaw && persistedRaw && !dungeonStateRef.current) {
        const hydratedLevels = hydrateDungeonLevels(
          persistedRaw.levels,
        ) as DungeonLevel[];
        const session = getOrCreateDungeonSession(
          cdRaw.dungeonId,
          persistedRaw.seed,
          () => hydratedLevels,
        );
        // Replay per-floor mutations into the in-memory session
        // store so the kernel mount picks them up via
        // `getFloorMutations`.
        for (const f of persistedRaw.floors) {
          writeFloorMutations(session, f.floorIdx, {
            unlockedCells: new Set(f.state.unlockedCells),
            defeatedEncounters: new Set(f.state.defeatedEncounters),
            destroyedLairs: new Set(f.state.destroyedLairs),
          });
        }
        dungeonStateRef.current = {
          dungeonId: cdRaw.dungeonId,
          seed: persistedRaw.seed,
          levels: hydratedLevels,
          floorIdx: cdRaw.floorIdx,
          returnTo: cdRaw.returnTo,
          startAt: { col: cdRaw.col, row: cdRaw.row },
        };
      } else if (!cdRaw && dungeonStateRef.current) {
        // Defensive: a save that explicitly cleared currentDungeon
        // (e.g. EndScreen → new game) should also drop the live
        // ref so the next mount starts clean on the overworld.
        dungeonStateRef.current = null;
      }

      try {
        const baseCatalog = await loadCatalog(save);
        if (cancelled) return;
        // Backfill max_hp / max_mp on save members from the catalog
        // any time the save is missing them. Legacy saves shipped
        // before the field landed; without this the Party-screen
        // heal-to-full path (Camping Supplies, future Rest spells)
        // would have to derive max from the live characters.json,
        // which silently no-ops for custom characters that aren't
        // in the catalog. Once the backfill writes, every later
        // commit propagates the field through automatically.
        const catalogChars = baseCatalog.characters;
        const catalogById = new Map(catalogChars.map((c) => [c.id, c]));
        let backfilled = false;
        const nextMembers = save.party.members.map((m) => {
          const customRec = m.custom as
            | { hp?: number; mp?: number; level?: number; exp?: number }
            | null
            | undefined;
          const catalogRec = catalogById.get(m.id);
          // Source of truth for the peak: the custom-character
          // record (player-created) or the catalog character.
          const peakHpSource =
            (customRec?.hp as number | undefined) ?? catalogRec?.hp;
          const peakMpSource =
            (customRec?.mp as number | undefined) ?? catalogRec?.mp;
          // Level + XP fall back to the custom/catalog character at
          // load time so legacy saves (predating the XP-persistence
          // layer) end up with concrete values on disk. Without this
          // the Party screen's XP bar denominator is computed from
          // an undefined level and renders NaN, and every subsequent
          // save commit re-omits both fields. The catalog typically
          // hands us level 1 (memberFromRaw's default) and exp 0
          // (absent on characters.json); custom characters carry
          // whatever the player set in the formation screen.
          // SimCharacter declares `level` but not `exp` (the sim
          // kernel doesn't read exp itself). The on-disk
          // characters.json record may still carry a starting `exp`
          // designed by the author, so we widen the lookup to read
          // it if present — falling back to 0 for the common case.
          const levelSource = customRec?.level ?? catalogRec?.level ?? 1;
          const expSource =
            customRec?.exp ??
            (catalogRec as { exp?: number } | undefined)?.exp ??
            0;
          let patched = m;
          if (
            typeof m.max_hp !== "number" &&
            typeof peakHpSource === "number"
          ) {
            patched = { ...patched, max_hp: peakHpSource };
            backfilled = true;
          }
          if (
            typeof m.max_mp !== "number" &&
            typeof peakMpSource === "number"
          ) {
            patched = { ...patched, max_mp: peakMpSource };
            backfilled = true;
          }
          if (typeof m.level !== "number") {
            patched = { ...patched, level: levelSource };
            backfilled = true;
          }
          if (typeof m.exp !== "number") {
            patched = { ...patched, exp: expSource };
            backfilled = true;
          }
          return patched;
        });
        if (backfilled) {
          save = {
            ...save,
            party: { ...save.party, members: nextMembers },
          };
          saveRef.current = save;
          saveWorld(save);
        }
        // Overlay the dungeon's current floor when the party is
        // inside a dungeon. Both the dungeon mount and the
        // overworld mount run through the same Phaser scene below
        // — the overlay just swaps the grid + encounters the
        // kernel sees.
        const catalog = dungeonStateRef.current
          ? buildDungeonCatalog(baseCatalog, dungeonStateRef.current)
          : baseCatalog;
        setState({ kind: "ok", catalog, save });
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Snapshot the current sim's mutations + party position into the
  // save and persist. Called on link traversal; safe to call any
  // time as a manual save in future.
  const saveCurrent = useCallback(() => {
    const save = saveRef.current;
    const sim = simRef.current;
    if (!save || !sim) return;
    // While inside a dungeon, persist the dungeon's state instead
    // of the overworld map's. The overworld save's `currentMapId`
    // still points at the entrance map (where the party will
    // re-emerge); writing the kernel's snapshot under that key
    // would corrupt the saved overworld state. Instead we update
    // `save.party.currentDungeon` (live floor + cell) and mirror
    // the in-memory session into `save.dungeons[id]` so a reload
    // mid-floor lands the party right back where they were with
    // the rolled layout intact.
    const dungeonNow = dungeonStateRef.current;
    if (dungeonNow) {
      const session = peekDungeonSession(dungeonNow.dungeonId);
      const snapshot = session ? snapshotDungeonForSave(session) : null;
      const snap = sim.snapshot();
      const next: WorldSave = {
        ...save,
        clockMinutes: clockRef.current,
        party: {
          ...save.party,
          // Per-step counters (torch, magic light) tick inside the
          // sim each step — mirror those onto the save here so a
          // reload mid-dungeon resumes with the right remaining
          // duration AND so the Party screen overlay's Effects
          // panel can show the live count when the player opens
          // the screen mid-dungeon.
          torch_steps: snap.party.torch_steps,
          magic_light_steps: snap.party.magic_light_steps ?? 0,
          currentDungeon: {
            dungeonId: dungeonNow.dungeonId,
            floorIdx: dungeonNow.floorIdx,
            col: snap.pos.col,
            row: snap.pos.row,
            returnTo: dungeonNow.returnTo,
          },
        },
        dungeons: snapshot
          ? { ...save.dungeons, [dungeonNow.dungeonId]: snapshot }
          : save.dungeons,
      };
      saveWorld(next);
      saveRef.current = next;
      // Same rationale as the overworld branch below — no setState
      // here. The overlay reads saveRef.current at mount.
      return;
    }
    const snap = sim.snapshot();
    // Per-map mutations for the current map. Centralised in
    // mapStateFromSnapshot so the link-traversal branches below
    // can't drift on which fields get persisted (boatPositions in
    // particular was being dropped by the cross-map branch, which
    // is why boats reset on every link). Passing the prior
    // SavedMapState carries forward authored-content fields the
    // live snapshot doesn't surface (today: `tileOverrides` from
    // quest rewards).
    const mapState = mapStateFromSnapshot(
      snap,
      saveRef.current?.maps?.[saveRef.current.party.currentMapId],
      // Fog-of-war memory lives on the renderer — pull the live set
      // so the union grown over the course of this visit lands on
      // disk next to the other per-map deltas. The renderer may not
      // be mounted yet on the very first checkpoint of a fresh
      // game; in that case `getVisitedCells` is unreachable and we
      // fall back to "whatever was in the save already".
      rendererRef.current?.getVisitedCells(),
    );

    // Reconcile `party_effects` with the per-step counters the sim
    // ticked. The Cleric's Light spell and the Torch auto-expire
    // when their counter hits zero — drop the id so the Party
    // screen no longer renders the effect as active. Toggle-only
    // effects (Infravision) stay in lockstep with their own flag
    // since the user explicitly turns those off.
    const partyEffects: string[] = [];
    for (const id of save.party.party_effects ?? []) {
      if (id === "magic_light" && (snap.party.magic_light_steps ?? 0) <= 0) {
        continue; // Cleric's Light burnt out
      }
      if (id === "torch" && snap.party.torch_steps <= 0) {
        continue; // Torch burnt out — drop from the Effects panel
      }
      if (id === "infravision" && !snap.party.infravision_active) {
        continue; // disengaged — keep the two in lockstep
      }
      partyEffects.push(id);
    }

    const next: WorldSave = {
      ...save,
      // Clock advances on every step via the sim event handler and
      // lives in the ref to avoid one React render per minute. The
      // save just reads the latest from the ref at write time so
      // the timestamp survives reload + carries through link
      // traversal across maps.
      clockMinutes: clockRef.current,
      party: {
        ...save.party,
        col: snap.pos.col,
        row: snap.pos.row,
        infravision_active: !!snap.party.infravision_active,
        torch_steps: snap.party.torch_steps,
        magic_light_steps: snap.party.magic_light_steps ?? 0,
        party_effects: partyEffects,
        // Mid-voyage state — onBoat flips during boarding /
        // disembarking; currentBoatSprite carries the sprite of the
        // boat the party is riding. Persisting both lets a reload
        // drop the player straight back into the boat at the saved
        // cell instead of forcing them ashore.
        onBoat: snap.onBoat,
        currentBoatSprite: snap.currentBoatSprite,
      },
      maps: { ...save.maps, [save.party.currentMapId]: mapState },
    };
    saveWorld(next);
    saveRef.current = next;
    // NOTE: we do NOT call setState here. Pushing the save into
    // React state every step caused the Phaser mount effect (which
    // depends on `state.save`) to re-run, destroying + recreating
    // the game scene mid-step — flicker on every walk and a
    // deadlock when entering a dungeon. The Party screen reads
    // `saveRef.current` at mount time instead (see the
    // PlayPartyScreenOverlay mount below), so the Effects panel
    // still sees the latest counters without React having to
    // re-render the whole tree.
  }, []);

  // Phaser mount. Runs whenever we have a fresh catalog ready.
  useEffect(() => {
    if (state.kind !== "ok" || !state.catalog || !state.save) return;
    if (!containerRef.current) return;
    const { catalog, save } = state;

    let cancelled = false;
    let game: import("phaser").Game | null = null;
    let sim: MapSimulation | null = null;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;

      // Collect every sprite key the cells, party, monsters, and
      // dropped items need. Item icons resolve to `item/<icon>.png`
      // and are queued separately so cells with the `item` field
      // can paint their overlay sprite (sword, potion, scroll, etc.)
      // on top of the floor tile.
      const spriteKeys = new Set<string>();
      // Dungeon floors share a baseline set of sprites the prototype
      // table touches even when a given cell didn't get them assigned
      // (chests, locked doors, torches). Preload them up front so a
      // mid-game floor transition doesn't blink missing tiles.
      if (dungeonStateRef.current) {
        for (const key of DUNGEON_SPRITE_KEYS) spriteKeys.add(key);
      }
      for (const row of catalog.map.grid) {
        for (const cell of row) {
          if (cell.sprite) spriteKeys.add(cell.sprite);
        }
      }
      // Also preload every palette tile's sprite. The grid walk above
      // only sees sprites the authored map already uses, but quest
      // tile_add rewards (applied on turn-in via `setCellSprite`) can
      // swap cells to ANY palette tile id — including ones nowhere
      // on the current grid. Without this, the post-quest swap would
      // hit `textures.exists` false and silently no-op. Palette is
      // small (~tens of entries) so the over-preload cost is fine.
      for (const tile of catalog.palette) {
        if (tile.sprite) spriteKeys.add(tile.sprite);
      }
      if (save.party.avatar) spriteKeys.add(save.party.avatar);
      for (const m of catalog.monsters) {
        if (m.sprite) spriteKeys.add(m.sprite);
      }
      // The placed-encounter renderer keys textures off each
      // encounter's `monster_party_tile`. Most of those happen to
      // match a monster's `sprite` path (and so they'd be preloaded
      // by the loop above), but the two strings live in different
      // files and can drift — and dungeon-generated encounter refs
      // synthesise their tile from `DungeonMonster.name`, which is
      // an `enc.monsterPartyTile` value rather than a monsters.json
      // entry. Without this loop, a dungeon's quest-target rat
      // would have its sprite resolved to a key the preload never
      // queued, and diffSprites would fall back to PARTY_MARKER_TEX
      // (the green hollow box).
      for (const e of catalog.encounters) {
        if (e.monster_party_tile) spriteKeys.add(e.monster_party_tile);
      }
      // Dungeon-specific defense: every placed DungeonMonster's
      // `name` (which is the encounter's lead sprite path, despite
      // the field's misleading docstring) gets queued too. The
      // catalog.encounters loop above already covers the catalog
      // entries that arrived through buildDungeonCatalog this
      // render, but a persisted dungeon hydrated from save could
      // carry monsters whose synthetic encounter ref hasn't been
      // built yet at the time preload runs — better to load any
      // sprite path the level might reference than to render a
      // green placeholder.
      const dungeonNow = dungeonStateRef.current;
      if (dungeonNow) {
        const lvl = dungeonNow.levels[dungeonNow.floorIdx];
        if (lvl) {
          for (const m of lvl.monsters) {
            if (typeof m.name === "string" && m.name.length > 0) {
              spriteKeys.add(m.name);
            }
            for (const id of m.encounterNames ?? []) {
              // Roster monster ids — resolve to their sprite paths
              // off catalog.monsters and queue those too so combat
              // can paint them without going dark for a frame.
              const sp = catalog.monsters.find((cm) => cm.id === id)?.sprite;
              if (sp) spriteKeys.add(sp);
            }
          }
        }
      }
      // Item-icon resolution: id → icon. Authors set `cell.item`
      // to an item id; the catalog says which icon sprite to draw.
      const itemsById = new Map<string, PlayItem>();
      for (const it of catalog.items) itemsById.set(it.id, it);
      const itemIconKeys = new Set<string>();
      for (const row of catalog.map.grid) {
        for (const cell of row) {
          const itemId = cell.item;
          if (typeof itemId !== "string" || !itemId) continue;
          const item = itemsById.get(itemId);
          const icon = item?.icon;
          if (!icon) continue;
          itemIconKeys.add(`item/${icon}.png`);
        }
      }
      // Retrieve-step items aren't in the grid yet (the placement pass
      // runs in create() AFTER preload), so the authored-item walk
      // above misses them. Pre-resolve icons here so the preloader
      // has them ready when (a) the create() pass stamps cells for
      // already-accepted retrieve steps, or (b) a quest accepted
      // mid-play places its item via the bridge — both paths gate on
      // `this.textures.exists(tex)` and silently skip when the
      // texture wasn't preloaded. We walk EVERY quest's retrieve
      // steps targeting this map (not just accepted-but-unfinished
      // ones) so a future accept doesn't blink an invisible item.
      // Item icons are small PNGs; the over-preload cost is minimal.
      //
      // Parse the quest defs FRESH from catalog.quests rather than
      // relying on `questDefsRef.current`: the ref is only populated
      // later in create() by mountSim(), so on the very first scene
      // mount of a session (or a hard reload mid-dungeon) the ref is
      // still its initial empty array and every retrieve step gets
      // silently skipped — which is the bug that made authored
      // quest items vanish on level 4. parseQuestsFile is idempotent
      // and inexpensive enough to run twice per scene mount.
      const questDefsForPreload = parseQuestsFile({ quests: catalog.quests });
      for (const def of questDefsForPreload) {
        for (const step of def.steps) {
          if (step.kind !== "retrieve") continue;
          if (step.mapId !== catalog.map.id) continue;
          if (!step.itemId) continue;
          const icon = itemsById.get(step.itemId)?.icon;
          if (!icon) continue;
          itemIconKeys.add(`item/${icon}.png`);
        }
      }
      for (const key of itemIconKeys) spriteKeys.add(key);
      // Quest-giver overlay sprites. Cells tagged with a `quest` id
      // draw the quest_giver's npc_sprite on top of the floor so the
      // player can see *who* is offering the quest before stepping
      // on the cell. We resolve the quest catalog now + queue the
      // sprite key for preload; create() walks the grid + spawns
      // one Image per quest cell.
      const questsById = new Map<string, SimQuestRef>();
      for (const q of catalog.quests) questsById.set(q.id, q);
      for (const row of catalog.map.grid) {
        for (const cell of row) {
          const questId = cell.quest;
          if (typeof questId !== "string" || !questId) continue;
          const quest = questsById.get(questId);
          const giverSprite = quest?.quest_giver?.npc_sprite;
          if (giverSprite) spriteKeys.add(giverSprite);
        }
      }
      // NPC catalog + sprite preload. Cells whose `npc` field resolves
      // to a record with a `sprite` get an overlay Image painted on
      // top of their floor sprite. Identity (id, name) carries
      // through to the npc_encountered event for future dialog
      // overlays — today the play side just logs that the event
      // fired, but the visual placement is what this slice surfaces.
      const npcsById = new Map<string, PlayNpc>();
      for (const npc of catalog.npcs) npcsById.set(npc.id, npc);
      for (const row of catalog.map.grid) {
        for (const cell of row) {
          const npcId = (cell as { npc?: string }).npc;
          if (typeof npcId !== "string" || !npcId) continue;
          const npcSprite = npcsById.get(npcId)?.sprite;
          if (npcSprite) spriteKeys.add(npcSprite);
        }
      }
      // Boat sprite + water sprite for the board / disembark
      // texture swaps. The kernel tracks which cells have loose
      // boats; the scene flips between the boat texture and the
      // module's water texture as boats are boarded + dropped.
      // Picking the first water-tagged palette tile mirrors the
      // editor sim's heuristic so a custom-art module's water
      // sprite gets used instead of the hardcoded fallback.
      const waterSprite =
        catalog.palette.find((t) => (t as { tag?: string }).tag === "water")
          ?.sprite ?? "map/water.png";
      if (waterSprite) spriteKeys.add(waterSprite);

      // Viewport: a fixed 4:3 window matching the v1 web game's
      // 960×720 canvas. The Phaser canvas always renders at this
      // internal resolution — independent of the current map's
      // size — so crossing a link to a smaller map doesn't shrink
      // the play area. Scale.FIT (configured on the Game below)
      // scales the rendered output to whatever space the parent
      // container offers; tiles end up visually smaller on small
      // windows rather than the canvas clipping.
      //
      // For maps smaller than 30×22.5 tiles, the camera bounds set
      // up by WorldRenderer clamp scrolling to the map's actual
      // size — the canvas area outside the map just shows the
      // background color. Trade-off accepted to keep the play
      // framing consistent across map transitions.
      //
      // 960×720 at 32px tiles ≈ 30 × 22.5 visible tiles — enough
      // map context that the party never feels cramped, matching
      // the v1 game's framing.
      const PLAY_CANVAS_WIDTH = 960;
      const PLAY_CANVAS_HEIGHT = 720;
      const width = PLAY_CANVAS_WIDTH;
      const height = PLAY_CANVAS_HEIGHT;
      // Pixel extent of the current map — independent of the canvas
      // size now. Used below to set the camera's scroll bounds so the
      // player can't pan past the map's edge into background pixels.
      const mapPixelWidth = catalog.map.width * TILE_SIZE;
      const mapPixelHeight = catalog.map.height * TILE_SIZE;

      class PlayScene extends Phaser.Scene {
        world: WorldRenderer | null = null;
        /** Cell-bound item overlays keyed "col,row". One per cell
         *  whose `item` field resolves to a known item with an icon.
         *  Rendered at depth 70 — above the floor, below particles
         *  (160) and the party / roamers (250+). Tinted in the
         *  WorldRenderer onRelight hook so a dropped item picks up
         *  the same shade as the floor beneath it. */
        itemOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Cell-bound quest-giver overlays keyed "col,row". One per
         *  cell whose `quest` field resolves in the quest catalog to
         *  a record with a `quest_giver.npc_sprite`. Rendered at
         *  depth 80 — above item overlays (70), below particles
         *  (160) and party / roamers (250+). Tinted via the
         *  WorldRenderer onRelight hook so the giver dims into
         *  shadow on unlit cells just like other map sprites. */
        questOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Cell-bound NPC overlays keyed "col,row". One per cell whose
         *  `npc` field resolves in the NPC catalog to a record with a
         *  `sprite`. Rendered at depth 75 — above items (70), below
         *  quest givers (80) and combat-fired overlays. Tinted via
         *  the WorldRenderer's relight hook so a person standing in
         *  shadow reads as shadowed. Mirrors the MapEditor's
         *  `npcOverlays` rendering for parity between author + play. */
        npcOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Cells currently rendering a boat texture — keyed "col,row",
         *  value is the boat's sprite key. The map cell IS the boat:
         *  setBoatPositions diffs this against the kernel's live boat
         *  list and swaps each cell's texture between water (the
         *  party just boarded it) and the boat sprite (a boat is
         *  parked there). Initial state captured during the scene's
         *  create() pass from cells whose `boat` field is true. */
        boatTextures: Map<string, string> = new Map();
        /** Bridge-top overlays keyed "col,row". One per cell whose
         *  palette flag `boat_passable` is true (wooden footbridges,
         *  stone arches, etc.). The base cell still draws at depth 0
         *  (where the party sprite at depth 300 covers it when the
         *  party walks across — normal "I'm on the bridge" look).
         *  The overlay duplicates the cell's sprite at depth 350,
         *  ABOVE the party-boat sprite (300), so that when the party
         *  is sailing under the bridge the structure visually covers
         *  the boat. The overlay is HIDDEN while the party is on
         *  foot — otherwise it would also cover the party walking
         *  across — and SHOWN when the party boards a boat. Toggled
         *  by the same `setPartyBoatAt` bridge call that mounts /
         *  destroys `partyBoatSprite`. */
        bridgeOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Single Image that follows the party while they're aboard.
         *  Depth 300 matches the party sprite — when this is visible
         *  the partySprite is hidden, so the boat visually IS the
         *  party. Bobs gently via a perpetual sin-wave tween. Null
         *  while the party is on land. */
        partyBoatSprite: Phaser.GameObjects.Image | null = null;
        /** Bottom log strip — a background bar pinned to the canvas
         *  bottom via scrollFactor 0. Mirrors v1's SceneLog. Painted
         *  during create() after the camera + sim are wired up. */
        logBar: Phaser.GameObjects.Rectangle | null = null;
        /** Time/date readout drawn over `logBar`. Refreshed by
         *  `update()` when `clockRef.current` rolls over. */
        logText: Phaser.GameObjects.Text | null = null;
        /** Last clock value the log text was painted with — lets
         *  `update()` skip the setText call on frames where the
         *  minute hasn't changed. */
        lastClockShown = 0;
        constructor() {
          super("PlayScene");
        }
        preload() {
          // Sprite drafts (from the in-browser pixel editor) win over
          // the on-disk PNG. Phaser's load.image accepts data URLs
          // verbatim, so the draft's base64 payload threads through
          // without a separate codec. The draft module is keyed by
          // moduleId so edits in one module don't leak into another.
          for (const key of spriteKeys) {
            const draft = loadSpriteDraft(save.moduleId, key);
            this.load.image(
              key,
              draft ?? withBasePath(`/sprites/${key}`),
            );
          }
        }
        create() {
          // Apply per-cell tile overrides from the save BEFORE
          // anything reads catalog.map.grid. Each entry is `{ col,
          // row, tileId }` — populated by the `rewards.tile_add`
          // handler on quest turn-in. Missing palette ids (or out-
          // of-bounds coords / empty tileId) skip silently so a
          // broken record never crashes a load.
          //
          // The grid is mutated in place (the renderer + sim both
          // capture it by reference, so subsequent createCells +
          // step pipeline reads see the post-override values).
          {
            const overrides = save.maps[catalog.map.id]?.tileOverrides ?? [];
            for (const ov of overrides) {
              if (!ov.tileId) continue;
              if (!Number.isFinite(ov.col) || !Number.isFinite(ov.row)) {
                continue;
              }
              if (ov.row < 0 || ov.row >= catalog.map.height) continue;
              if (ov.col < 0 || ov.col >= catalog.map.width) continue;
              const source = catalog.palette.find((t) => t.id === ov.tileId);
              if (!source) continue;
              catalog.map.grid[ov.row][ov.col] = {
                ...source,
              } as typeof catalog.map.grid[number][number];
            }
          }

          // Detect race-driven infravision once at boot.
          const racesById = new Map(catalog.races.map((r) => [r.id, r]));
          const charactersById = new Map(
            catalog.characters.map((c) => [c.id, c]),
          );
          const partyHasInfravision = save.party.roster.some((id) => {
            const c = charactersById.get(id);
            if (!c) return false;
            const r = racesById.get(c.race);
            if (!r) return false;
            return (r.abilities ?? []).includes("infravision");
          });

          // Seed the clock + lighting mode from the save BEFORE the
          // renderer mounts. Subsequent advances flow through the
          // bridge's `moved` listener (advance) and the renderer ref
          // (setLightingMode). Reading directly here avoids waiting
          // for React state to settle through to the scene closure.
          clockRef.current = save.clockMinutes;
          setClockMinutes(save.clockMinutes);

          this.world = new WorldRenderer({
            scene: this,
            grid: catalog.map.grid,
            partyAvatar: save.party.avatar,
            partyHasInfravision,
            // Drive the initial lighting from the saved clock —
            // day at noon, night past dusk, twilight in the
            // transition windows. Subsequent ticks update via
            // renderer.setLightingMode after each move.
            // Dungeons are dim by definition — every floor renders
            // in night mode so torches throw real light pools and
            // the rest stays in shadow. Authored map overrides
            // (`lighting: "darkness" | "twilight" | "day"` on the
            // Map record) take precedence over the clock so an
            // indoor map can stay perma-dark, a shrine perma-lit,
            // etc. The overworld with no override inherits the
            // saved clock as before.
            initialLightingMode: dungeonStateRef.current
              ? "night"
              : (mapForcedLightingMode(catalog.map) ??
                  lightingModeFromClock(save.clockMinutes)),
            initialInfravisionActive: !!save.party.infravision_active,
            // Tint + visibility for the PlayScene-managed overlays
            // (items, quest givers, NPCs). These are the "static"
            // layer above the cell sprites — distinct from the
            // WorldRenderer-managed roamer + placed-encounter
            // overlays which run their own visibility pass via
            // `tintOverlay` → `overlayVisibleAt` inside the
            // renderer.
            //
            // Visibility rule (matches `overlayVisibleAt`): show
            // only when the cell is currently in the party's vision
            // pool (lit brightness > 30 or infravision-red). Cells
            // in the *remembered* band — terrain the party has seen
            // before but isn't looking at right now — get the
            // grayscale tile treatment for the floor itself, but
            // entities standing there are hidden. The user can't
            // see a goblin or shopkeeper that's currently in a
            // corridor they walked past last turn — both because
            // it'd be a gameplay cheat (lets you spy on patrol
            // routes through the fog) and because it'd visibly
            // teleport between frames as the entity moves.
            //
            // Quest givers + items get the same gate even though
            // they're effectively stationary today: it'd be
            // jarring for the player to see a quest icon glowing
            // through a wall in a corridor they remember.
            //
            // Tint still applies when visible so a sword on a dim
            // corridor reads dim alongside the cell, and so any
            // overlay picks up infravision red when relevant.
            onRelight: (result) => {
              const applyOverlayCellState = (
                img: Phaser.GameObjects.Image,
                key: string,
              ) => {
                const [cs, rs] = key.split(",");
                const c = Number(cs);
                const r = Number(rs);
                if (!overlayVisibleAt(result, c, r)) {
                  img.setVisible(false);
                  return;
                }
                img.setVisible(true);
                const t = tintForCell(result, c, r);
                if (t.mode === "clear") img.clearTint();
                else img.setTint(t.value);
              };
              for (const [key, img] of this.itemOverlays) {
                applyOverlayCellState(img, key);
              }
              for (const [key, img] of this.questOverlays) {
                applyOverlayCellState(img, key);
              }
              for (const [key, img] of this.npcOverlays) {
                applyOverlayCellState(img, key);
              }
            },
          });
          rendererRef.current = this.world;
          this.world.ensureParticleTexture();
          this.world.createCells();
          this.world.createEmitters();

          // Fog-of-war seed — restore the previously-visited set
          // for this surface so the player walks back into a map
          // already-mapped instead of pitch black. Dungeons store
          // exploredTiles directly on the in-memory DungeonLevel
          // (which serialises through dungeonSession); overworld /
          // interior maps land it on `SavedMapState.visitedCells`.
          // Defensive defaults to empty set so a brand-new game or
          // legacy save reads as "no exploration yet" and rebuilds
          // organically.
          const dungeonForFog = dungeonStateRef.current;
          if (dungeonForFog) {
            const lvl = dungeonForFog.levels[dungeonForFog.floorIdx];
            const seeded = lvl?.exploredTiles ?? new Set<string>();
            this.world.setVisitedCells(seeded);
          } else {
            const persisted =
              save.maps?.[save.party.currentMapId]?.visitedCells ?? [];
            this.world.setVisitedCells(new Set(persisted));
          }

          // Seed `boatTextures` from the authored grid BEFORE the
          // kernel's first `setBoatPositions` call lands. The grid's
          // `boat: true` cells render with their boat sprite via
          // createCells; the bridge's diff handler needs to know that
          // baseline so it can correctly swap cells back to water on
          // first init. Without this seed, a save where the party
          // moved a boat from A to B would: render cell A with the
          // boat sprite (from authored data), receive a setBoatPositions
          // call listing only B as wanted, find scene.boatTextures
          // empty, and never swap A to water — leaving a ghost boat
          // at the original cell.
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              if (cell.boat && cell.sprite) {
                this.boatTextures.set(`${c},${r}`, cell.sprite);
              }
            }
          }

          // Bridge-top overlays — paint a second copy of the bridge
          // sprite at depth 350 for every cell flagged `boat_passable`.
          // Hidden until the party boards a boat; the setPartyBoatAt
          // bridge call below flips them visible/invisible so a
          // walking party doesn't get covered while a sailing party
          // appears to pass under the bridge.
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              if (!cell.boat_passable) continue;
              const tex = cell.sprite;
              if (!tex || !this.textures.exists(tex)) continue;
              const img = this.add
                .image(c * TILE_SIZE, r * TILE_SIZE, tex)
                .setOrigin(0)
                .setDisplaySize(TILE_SIZE, TILE_SIZE)
                .setDepth(350)
                .setVisible(false);
              this.bridgeOverlays.set(`${c},${r}`, img);
            }
          }

          // Seed the live-traps set from the freshly-mounted catalog
          // grid. dungeonLevelToMap already cleared the `trap` flag
          // on cells the dungeon session marked as previously
          // triggered, so anything still flagged here is armed.
          // Refresh the detected-trap overlay so the player sees red
          // Xs on every armed trap if Detect Traps is currently
          // active (and an empty layer otherwise).
          liveTrapsRef.current = new Set();
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              if (
                (cell as { trap?: boolean } | undefined)?.trap
              ) {
                liveTrapsRef.current.add(`${c},${r}`);
              }
            }
          }
          refreshDetectedTraps();
          // Seed the quest-relevance halo for this map. Quest givers
          // on the freshly-mounted grid glow immediately so the
          // player can spot them; kill-step / fetch-step targets glow
          // only for already-accepted quests carried over from a
          // prior save.
          refreshQuestGlow();

          // Retrieve-step item placement — drop each accepted-but-
          // unfinished retrieve step's item onto its target cell on
          // the current map BEFORE the item-overlay loop runs so the
          // loop below picks them up alongside authored items. The
          // matching map id check ignores dungeon floors etc. — only
          // steps whose `mapId` equals the current map place here.
          // Cells already carrying an authored item are left alone
          // (the authored value wins; the retrieve step will appear
          // unplaceable in that corner case, but the editor can warn
          // about that later).
          //
          // Parse the quest defs FRESH from catalog.quests instead of
          // reading `questDefsRef.current` — the ref isn't populated
          // until mountSim() runs later in this same create() pass,
          // so on the first scene mount of a session (or a hard
          // reload mid-dungeon) the ref's initial empty array
          // silently skipped every retrieve step. That left authored
          // quest items (e.g. the Dragon Heart Relic on Auric Ruins
          // L4) missing from their target cell. We also stamp the
          // ref here so any handler that fires between now and
          // mountSim() — including refreshRetrievePlacements — sees
          // the live defs.
          // Picked-item clears — apply BEFORE retrieve-step placement
          // (so an active retrieve step targeting a previously-picked
          // cell can re-populate it: its placement guards on
          // `cell.item` being empty, and we just made it so) and
          // BEFORE the overlay paint loop (so cleared cells don't
          // paint a stale sprite). The kernel re-applies the same
          // clears in its constructor for snapshot consistency, but
          // both passes here run before mount so they're needed at
          // the host level too.
          {
            const picked =
              save.maps[catalog.map.id]?.pickedItemCells ?? [];
            for (const key of picked) {
              const [cs, rs] = key.split(",");
              const c = Number(cs);
              const r = Number(rs);
              if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
              if (r < 0 || r >= catalog.map.height) continue;
              if (c < 0 || c >= catalog.map.width) continue;
              const row = catalog.map.grid[r];
              if (!row) continue;
              const cell = row[c];
              if (!cell) continue;
              (cell as { item?: string }).item = "";
            }
          }

          {
            const acceptedSet = new Set(save.acceptedQuests ?? []);
            const turnedInSet = new Set(save.turnedInQuests ?? []);
            const progress = save.questStepProgress ?? {};
            const questDefsForPlacement = parseQuestsFile({
              quests: catalog.quests,
            });
            questDefsRef.current = questDefsForPlacement;
            for (const def of questDefsForPlacement) {
              if (!acceptedSet.has(def.id)) continue;
              if (turnedInSet.has(def.id)) continue;
              const completedIdx = progress[def.id] ?? 0;
              for (let i = 0; i < def.steps.length; i++) {
                if (i < completedIdx) continue;
                const step = def.steps[i];
                if (step.kind !== "retrieve") continue;
                if (step.mapId !== catalog.map.id) continue;
                if (!step.itemId) continue;
                const row = catalog.map.grid[step.row];
                if (!row) continue;
                const cell = row[step.col];
                if (!cell) continue;
                if (cell.item) continue; // don't trample authored items
                (cell as { item?: string }).item = step.itemId;
              }
            }
          }

          // Item overlays — one Image per cell whose `item` resolves
          // to a known icon. Authored via the editor's per-cell
          // `item` field (plus retrieve-step placements stamped just
          // above); the icon comes from items.json. Sized at 70% of
          // the tile so the floor underneath is still visible
          // (matches the "dropped on the floor" look from v1).
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              const itemId = cell.item;
              if (typeof itemId !== "string" || !itemId) continue;
              const item = itemsById.get(itemId);
              const icon = item?.icon;
              if (!icon) continue;
              const tex = `item/${icon}.png`;
              if (!this.textures.exists(tex)) continue;
              const img = this.add
                .image(
                  c * TILE_SIZE + TILE_SIZE / 2,
                  r * TILE_SIZE + TILE_SIZE / 2,
                  tex,
                )
                .setOrigin(0.5)
                .setDisplaySize(TILE_SIZE * 0.7, TILE_SIZE * 0.7)
                .setDepth(70);
              this.itemOverlays.set(`${c},${r}`, img);
            }
          }

          // Install the item-overlay bridge so PlayHost's React-side
          // code can place / remove items at runtime (a retrieve
          // quest accepted mid-play, a pickup completing a step).
          // Captures the scene + the items lookup in closure so the
          // helpers can build sprites with the same shape the boot
          // loop above does.
          {
            const sceneSelf = this;
            const mapRef = catalog.map;
            itemOverlayBridgeRef.current = {
              placeItem: (col, row, itemId) => {
                const r = mapRef.grid[row];
                if (!r) return;
                const cell = r[col];
                if (!cell) return;
                (cell as { item?: string }).item = itemId;
                const key = `${col},${row}`;
                if (sceneSelf.itemOverlays.has(key)) return;
                const item = itemsById.get(itemId);
                const icon = item?.icon;
                if (!icon) return;
                const tex = `item/${icon}.png`;
                if (!sceneSelf.textures.exists(tex)) return;
                const img = sceneSelf.add
                  .image(
                    col * TILE_SIZE + TILE_SIZE / 2,
                    row * TILE_SIZE + TILE_SIZE / 2,
                    tex,
                  )
                  .setOrigin(0.5)
                  .setDisplaySize(TILE_SIZE * 0.7, TILE_SIZE * 0.7)
                  .setDepth(70);
                sceneSelf.itemOverlays.set(key, img);
              },
              removeItem: (col, row) => {
                const r = mapRef.grid[row];
                if (r) {
                  const cell = r[col];
                  if (cell) (cell as { item?: string }).item = "";
                }
                const key = `${col},${row}`;
                const existing = sceneSelf.itemOverlays.get(key);
                if (existing) {
                  existing.destroy();
                  sceneSelf.itemOverlays.delete(key);
                }
              },
            };
          }

          // Quest-giver overlays — one Image per cell whose `quest`
          // field resolves in the quest catalog and whose quest_giver
          // declares an `npc_sprite`. Drawn at depth 80, full tile
          // size (the giver IS the figure on the cell, not a small
          // dropped overlay). Accepted quests still render the
          // overlay so the player can find the quest giver again for
          // a future end-dialog handoff.
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              const questId = cell.quest;
              if (typeof questId !== "string" || !questId) continue;
              const quest = questsById.get(questId);
              const giverSprite = quest?.quest_giver?.npc_sprite;
              if (!giverSprite || !this.textures.exists(giverSprite)) {
                continue;
              }
              const img = this.add
                .image(
                  c * TILE_SIZE + TILE_SIZE / 2,
                  r * TILE_SIZE + TILE_SIZE / 2,
                  giverSprite,
                )
                .setOrigin(0.5)
                .setDisplaySize(TILE_SIZE, TILE_SIZE)
                .setDepth(80);
              this.questOverlays.set(`${c},${r}`, img);
            }
          }

          // NPC overlays — one Image per cell whose `npc` field
          // resolves in the NPC catalog and carries a sprite. Drawn
          // at depth 75, slightly smaller than the cell (95%) so the
          // NPC reads as a person standing ON the tile rather than
          // a sprite that consumes the whole cell. Matches the
          // MapEditor render so authoring + play views agree.
          for (let r = 0; r < catalog.map.height; r++) {
            for (let c = 0; c < catalog.map.width; c++) {
              const cell = catalog.map.grid[r][c];
              const npcId = (cell as { npc?: string }).npc;
              if (typeof npcId !== "string" || !npcId) continue;
              const npcSprite = npcsById.get(npcId)?.sprite;
              if (!npcSprite || !this.textures.exists(npcSprite)) {
                continue;
              }
              const img = this.add
                .image(
                  c * TILE_SIZE + TILE_SIZE / 2,
                  r * TILE_SIZE + TILE_SIZE / 2,
                  npcSprite,
                )
                .setOrigin(0.5)
                .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
                .setDepth(75);
              this.npcOverlays.set(`${c},${r}`, img);
            }
          }

          this.world.relight();
          this.mountSim();

          // Camera setup — mirrors v1's `installCamera` in
          // OverworldScene exactly:
          //
          //   - Bounds extended downward by PLAY_LOG_HEIGHT so the
          //     camera has headroom to scroll the bottom row of tiles
          //     above the in-canvas log strip. Without that, when the
          //     party walks the bottom row of a tall map the player
          //     marker hides behind the strip pinned at the viewport
          //     bottom.
          //
          //   - startFollow with lerp 0.2: the camera eases toward
          //     the party rather than snapping, which reads smoother
          //     when the camera actually has room to scroll.
          //
          //   - When the map is at-or-smaller than the viewport
          //     (30×21 tiles or less, given the 32px log reservation),
          //     `setBounds` is smaller than the camera viewport — so
          //     Phaser clamps scroll to (0, 0) and the camera CANNOT
          //     move regardless of where the party walks. That's how
          //     v1 achieves its "locked" feel; design maps within the
          //     viewport and the camera stays put.
          //
          //   - roundPixels keeps the pixel-art alignment sharp.
          if (this.world.partySprite) {
            this.cameras.main.setBounds(
              0,
              0,
              mapPixelWidth,
              mapPixelHeight + PLAY_LOG_HEIGHT,
            );
            this.cameras.main.setRoundPixels(true);
            this.cameras.main.startFollow(
              this.world.partySprite,
              true,
              0.2,
              0.2,
            );
          }

          // Install the bottom log strip — mirrors v1's
          // `installSceneLog`. The strip uses scrollFactor 0 so its
          // y is screen-relative (not world-relative): it stays put
          // even as the camera scrolls on big maps. Depth 1000 keeps
          // it above every world sprite.
          //
          // Position: flush against the map's bottom edge — `min` of
          // the canvas bottom (for maps tall enough to fill or exceed
          // the viewport, where the strip pins to the canvas bottom)
          // and the map's pixel height (for shorter maps, where the
          // strip rides up to sit right below the last row of tiles
          // rather than leaving a dead gap of canvas bg between the
          // map and the log).
          const logY = Math.min(
            PLAY_CANVAS_HEIGHT - PLAY_LOG_HEIGHT,
            mapPixelHeight,
          );
          this.logBar = this.add
            .rectangle(
              0,
              logY,
              PLAY_CANVAS_WIDTH,
              PLAY_LOG_HEIGHT,
              0x161629,
              1,
            )
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(1000)
            .setStrokeStyle(1, 0x2a2a3a);
          this.logText = this.add
            .text(
              12,
              logY + 8,
              fullStr({ totalMinutes: clockRef.current }) +
                "  ·  " +
                lunarPhaseName({ totalMinutes: clockRef.current }),
              {
                fontFamily: "monospace",
                fontSize: "13px",
                color: "#dcdcc8",
              },
            )
            .setScrollFactor(0)
            .setDepth(1001);
          this.lastClockShown = clockRef.current;

          // Painted Help & Tips screen — first of the inspector
          // overlays to live inside Phaser. The host's `helpTipsOpen`
          // React state still drives open/close (so `overlaysOpenRef`
          // gating is unchanged), but the visible UI is painted into
          // this scene rather than a DOM modal layered on top. See
          // the PaintedHelpScreen module for the visual + lifecycle
          // contract. The instance is stashed on `helpScreenRef`
          // for the sync effect below to drive.
          helpScreenRef.current = new PaintedHelpScreen({
            scene: this,
            canvasWidth: PLAY_CANVAS_WIDTH,
            canvasHeight: PLAY_CANVAS_HEIGHT,
            soundtrack: Soundtrack,
            onClose: () => setHelpTipsOpen(false),
          });
          // Painted Quest Log — same family as the help screen.
          // Constructed alongside so the React→Phaser sync effect
          // below has somewhere to call into. The actual quest data
          // is handed in at `open()` time so the log always reads
          // the live save snapshot.
          questLogScreenRef.current = new PaintedQuestLog({
            scene: this,
            canvasWidth: PLAY_CANVAS_WIDTH,
            canvasHeight: PLAY_CANVAS_HEIGHT,
            onClose: () => setQuestLogOpen(false),
          });
        }

        /** Phaser update — runs every frame. We keep the log text
         *  in sync with the React-side `clockRef` (which advances
         *  per step via the sim's "moved" event handler). Guarded by
         *  `lastClockShown` so we only call setText when the minute
         *  actually rolled over — Text rebuilds are not free in
         *  Phaser, and the loop runs at ~60fps. */
        override update(): void {
          if (!this.logText) return;
          if (clockRef.current !== this.lastClockShown) {
            this.lastClockShown = clockRef.current;
            this.logText.setText(
              fullStr({ totalMinutes: clockRef.current }) +
                "  ·  " +
                lunarPhaseName({ totalMinutes: clockRef.current }),
            );
          }
        }

        mountSim() {
          if (!this.world) return;
          const renderer = this.world;

          // Build the party shape the kernel expects from the save.
          const partyForSim: SimParty = {
            start_position: {
              map_id: save.party.currentMapId,
              col: save.party.col,
              row: save.party.row,
            },
            avatar: save.party.avatar,
            roster: [...save.party.roster],
            torch_steps: save.party.torch_steps,
            magic_light_steps: save.party.magic_light_steps ?? 0,
            infravision_active: save.party.infravision_active,
            gold: save.party.gold,
            inventory: [...save.party.inventory],
          };

          // Per-map mutation seeds from the save — re-entering a
          // visited map remembers what the party did there.
          const mutations = save.maps[save.party.currentMapId];
          const initialUnlockedCells = mutations
            ? new Set(mutations.unlockedCells)
            : undefined;
          const initialDefeatedEncounters = mutations
            ? new Set(mutations.defeatedEncounters)
            : undefined;
          const initialDestroyedLairs = mutations
            ? new Set(mutations.destroyedLairs)
            : undefined;
          // Boat positions for this map — rehydrate the serialised
          // Record into a Map. When absent (legacy save or never-
          // visited map), the kernel falls back to scanning the
          // grid's `boat: true` cells, which matches a fresh boot.
          const initialBoatPositions = mutations?.boatPositions
            ? new Map(Object.entries(mutations.boatPositions))
            : undefined;
          // Picked-item cells — re-applied by the kernel during
          // construction so the freshly-loaded JSON catalog's items
          // don't respawn on a map re-entry / browser reload. Both
          // the regular walk-onto pickup path and the chest-Open
          // path feed this set; the host treats them uniformly here.
          const initialPickedItemCells = mutations?.pickedItemCells
            ? new Set(mutations.pickedItemCells)
            : undefined;

          // Ground tile for destroy-lair revert: grab the first
          // grass-tagged or first walkable palette entry.
          const groundPaletteEntry =
            catalog.palette.find((t) => t.tag === "grass") ??
            catalog.palette.find(
              (t) => t.walkable && !t.boat && !t.locked && !t.light_source,
            );
          const groundTile = groundPaletteEntry
            ? {
                id: groundPaletteEntry.id,
                sprite: groundPaletteEntry.sprite ?? "",
                walkable: !!groundPaletteEntry.walkable,
              }
            : undefined;

          const classNameById = new Map(
            catalog.classes.map((c) => [c.id, c.name]),
          );

          const bridge: SceneBridge = {
            setPartyAt: (c, r) => renderer.setPartyAt(c, r),
            clearParty: () => renderer.clearParty(),
            setPartyLight: (source) => renderer.setPartyLight(source),
            relight: () => renderer.relight(),
            // Float tile text over the destination cell briefly so
            // the player sees it without looking away. Implemented
            // as a transient label on the Phaser scene — fades out
            // after a beat. The scrolling log strip below captures
            // the same text durably via the `log` event.
            floatText: (col, row, text) => {
              const x = col * TILE_SIZE + TILE_SIZE / 2;
              const y = row * TILE_SIZE - 4;
              const label = this.add
                .text(x, y, text, {
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: "#f6efd6",
                  backgroundColor: "#0c0c14",
                  padding: { x: 4, y: 2 },
                })
                .setOrigin(0.5, 1)
                .setDepth(500);
              this.tweens.add({
                targets: label,
                alpha: { from: 1, to: 0 },
                y: { from: y, to: y - 12 },
                duration: 1800,
                onComplete: () => label.destroy(),
              });
            },
            // Boats render via cell-texture swaps + a party-bound
            // overlay sprite, mirroring the editor sim's pattern:
            //
            //   1. setBoatPositions — the kernel hands us the list of
            //      loose boats (cell + sprite). Cells that lost their
            //      boat (party just boarded) swap back to the water
            //      sprite; cells that gained one swap to the boat
            //      sprite. The map cell IS the boat.
            //   2. setPartyBoatAt — creates/destroys the
            //      `partyBoatSprite` overlay at the party's cell
            //      while aboard. Hides the partySprite so the boat
            //      visually IS the party. Idle bob via a perpetual
            //      sin-wave tween.
            setBoatPositions: (positions) => {
              const scene = this;
              const wanted = new Map(
                positions.map((p) => [`${p.col},${p.row}`, p.sprite]),
              );
              // Route through `renderer.setCellSprite` instead of
              // poking the cell image directly: the renderer needs to
              // update its `cellTextureKeys` map alongside the live
              // texture so the fog-of-war relight pass treats the new
              // sprite as the cell's "original" (otherwise relight
              // would revert a boarded boat cell back to the boat
              // texture on the next frame). setCellSprite also pre-
              // bakes a grayscale variant so the swapped cell still
              // grayscales correctly once it enters the remembered
              // band.
              //
              // Cells that lost their boat (party boarded here) →
              // back to the water sprite.
              for (const [key] of scene.boatTextures) {
                if (wanted.has(key)) continue;
                if (waterSprite && scene.textures.exists(waterSprite)) {
                  const [cs, rs] = key.split(",");
                  renderer.setCellSprite(Number(cs), Number(rs), waterSprite);
                }
                scene.boatTextures.delete(key);
              }
              // Cells that gained a boat (disembarked here, or first
              // boot from a save where the party left a boat behind).
              for (const [key, sprite] of wanted) {
                if (scene.boatTextures.get(key) === sprite) continue;
                if (sprite && scene.textures.exists(sprite)) {
                  const [cs, rs] = key.split(",");
                  renderer.setCellSprite(Number(cs), Number(rs), sprite);
                }
                scene.boatTextures.set(key, sprite);
              }
            },
            setPartyBoatAt: (col, row, visible, sprite) => {
              const scene = this;
              // Bridge-top overlay visibility tracks the boat. When
              // the party is sailing, the overlays paint above the
              // boat sprite so the structure visually covers the
              // vessel as it slides under. When the party is on
              // foot, the overlays are hidden so they don't paint
              // over the walking party sprite — the bridge cell's
              // base render at depth 0 is enough since the party
              // (depth 300) is already above the floor.
              const showBridgeTops = visible;
              for (const img of scene.bridgeOverlays.values()) {
                img.setVisible(showBridgeTops);
              }
              if (!visible) {
                if (scene.partyBoatSprite) {
                  scene.tweens.killTweensOf(scene.partyBoatSprite);
                  scene.partyBoatSprite.destroy();
                  scene.partyBoatSprite = null;
                }
                // Back on land — restore the party sprite.
                if (renderer.partySprite) {
                  renderer.partySprite.setVisible(true);
                }
                return;
              }
              // Pick a sprite: explicit arg (board) wins, then the
              // live boat sprite (sail), then bail.
              const resolved =
                sprite ?? scene.partyBoatSprite?.texture.key ?? "";
              if (!resolved || !scene.textures.exists(resolved)) return;
              if (!scene.partyBoatSprite) {
                scene.partyBoatSprite = scene.add
                  .image(
                    col * TILE_SIZE + TILE_SIZE / 2,
                    row * TILE_SIZE + TILE_SIZE / 2,
                    resolved,
                  )
                  .setOrigin(0.5)
                  .setDisplaySize(TILE_SIZE, TILE_SIZE)
                  // Same depth band as the party so the boat sits at
                  // the party's z when the party sprite is hidden.
                  .setDepth(300);
                // Idle bob — perpetual yoyo so the boat reads as
                // afloat even when the party is stationary.
                scene.tweens.add({
                  targets: scene.partyBoatSprite,
                  y: scene.partyBoatSprite.y - 2,
                  duration: 900,
                  yoyo: true,
                  repeat: -1,
                  ease: "Sine.easeInOut",
                });
              } else {
                scene.tweens.killTweensOf(scene.partyBoatSprite);
                scene.partyBoatSprite.setPosition(
                  col * TILE_SIZE + TILE_SIZE / 2,
                  row * TILE_SIZE + TILE_SIZE / 2,
                );
                if (
                  resolved &&
                  scene.partyBoatSprite.texture.key !== resolved
                ) {
                  scene.partyBoatSprite.setTexture(resolved);
                }
                scene.tweens.add({
                  targets: scene.partyBoatSprite,
                  y: scene.partyBoatSprite.y - 2,
                  duration: 900,
                  yoyo: true,
                  repeat: -1,
                  ease: "Sine.easeInOut",
                });
              }
              // Hide the on-foot party sprite while the boat is
              // visible — they're one entity from the player's POV.
              if (renderer.partySprite) {
                renderer.partySprite.setVisible(false);
              }
            },
            onKey: (handler) => {
              // Keys whose browser default would scroll the page —
              // arrows, space, page-up/down, home/end. Without
              // preventDefault, every arrow press here ALSO scrolls
              // the page by ~40px, which is why the header/log
              // strip kept marching off-screen as the party walked.
              // Capture as a string set (matches against e.key) so
              // we only suppress browser scroll for keys the world
              // sim actually cares about; typing into the date/time
              // header etc. still works because of the INPUT/TEXTAREA
              // guard below.
              const SCROLL_KEYS = new Set<string>([
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                " ",
                "Spacebar",
                "PageUp",
                "PageDown",
                "Home",
                "End",
              ]);
              const listener = (e: KeyboardEvent) => {
                const t = e.target as HTMLElement | null;
                if (
                  t &&
                  (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.isContentEditable)
                ) {
                  return;
                }
                if (overlaysOpenRef.current) return;
                if (SCROLL_KEYS.has(e.key)) e.preventDefault();
                handler(e.key);
              };
              window.addEventListener("keydown", listener);
              return () => window.removeEventListener("keydown", listener);
            },
            setRoamerPositions: (positions) =>
              renderer.setRoamerPositions(positions),
            setPlacedEncounterPositions: (positions) =>
              renderer.setPlacedEncounterPositions(positions),
            setSuppressedEncounterCells: () => {
              // Editor-side rendering nuance — placed-encounter cells
              // suppress their static glyph during sim. The play scene
              // has no static glyphs to suppress.
            },
            setCellSprite: (col, row, sprite) =>
              renderer.setCellSprite(col, row, sprite),
            setPartyInfravisionActive: (active) =>
              renderer.setPartyInfravisionActive(active),
            setDetectedTraps: (cells) =>
              renderer.setDetectedTraps(cells),
          };

          // While the party is inside a dungeon the per-floor
          // entry cell wins over the save's overworld coords —
          // those still point at the dungeon-entrance cell on the
          // overworld (where the party will return on exit) and
          // would land them off-grid otherwise. Floor mutations
          // come from the in-memory dungeon session so destroyed
          // lairs / picked locks / defeated encounters survive
          // floor transitions in both directions.
          const dungeonNow = dungeonStateRef.current;
          const dungeonMutations = dungeonNow
            ? getFloorMutations(
                getOrCreateDungeonSession(
                  dungeonNow.dungeonId,
                  dungeonNow.seed,
                  () => dungeonNow.levels,
                ),
                dungeonNow.floorIdx,
              )
            : null;
          const startAt = dungeonNow
            ? dungeonNow.startAt
            : { col: save.party.col, row: save.party.row };

          // Quest setup — parse the catalog's quest records through
          // the v2 loader so the sim receives structured QuestDef[]s
          // (kind, encounterId, count, locationKind, mapId, dungeonId,
          // dungeonLevel). Bootstrap each quest's state from the save
          // so progress survives a reload:
          //
          //   - `acceptedQuests` → promote "available" to "active"
          //   - `questStepProgress[id] = N` → flip first N
          //     stepProgress[] entries to true; if that completes
          //     every step, promote "active" → "completed"
          //   - `turnedInQuests` → final promotion "completed" →
          //     "turned_in" so the handoff dialog stays silent and
          //     `claimQuestRewards` won't re-grant rewards
          //
          // The full QuestState shape isn't persisted; we
          // reconstruct it from these three fields. Step-kill
          // counters (`stepKills[i]`) intentionally reset on
          // reload because the save only carries the "next pending
          // step" index — partial progress within a multi-kill
          // step rounds DOWN on reload. Acceptable trade-off given
          // how many credits a single step typically takes.
          const questDefs = parseQuestsFile({ quests: catalog.quests });
          ensureQuestStates(questDefs, questStatesRef.current);
          const accepted = new Set(save.acceptedQuests ?? []);
          const turnedIn = new Set(save.turnedInQuests ?? []);
          for (const def of questDefs) {
            const qs = questStatesRef.current.get(def.id);
            if (!qs) continue;
            if (accepted.has(def.id) && qs.status === "available") {
              qs.status = "active";
            }
            const nextStep = save.questStepProgress?.[def.id] ?? 0;
            for (let i = 0; i < Math.min(nextStep, qs.stepProgress.length); i++) {
              qs.stepProgress[i] = true;
            }
            if (
              qs.stepProgress.length > 0 &&
              qs.stepProgress.every((p) => p) &&
              qs.status === "active"
            ) {
              qs.status = "completed";
            }
            if (turnedIn.has(def.id) && qs.status === "completed") {
              qs.status = "turned_in";
            }
          }
          questDefsRef.current = questDefs;
          // Tell the sim where the party currently is so kill-step
          // matching knows which authored encounters belong on this
          // map/floor. Dungeon floors take precedence — when the
          // party is inside a dungeon, we ignore the overworld
          // mapId entirely.
          const currentLocation: CombatLocation = dungeonNow
            ? {
                kind: "dungeon",
                dungeonId: dungeonNow.dungeonId,
                dungeonLevel: dungeonNow.floorIdx,
              }
            : { kind: "map", mapId: save.party.currentMapId };

          sim = new MapSimulation({
            grid: catalog.map.grid as unknown as SimGrid,
            party: partyForSim,
            catalog: {
              characters: catalog.characters,
              races: catalog.races,
              effects: catalog.effects,
              characterClasses: catalog.classes,
              knockSpell: catalog.knockSpell,
              spawns: catalog.spawns,
              monsters: catalog.monsters,
              encounters: catalog.encounters,
              quests: catalog.quests,
              // Items catalog — the sim only reads is_chest +
              // contents (via SimItemRef) to route the bump pipeline
              // between chest_encountered and item_picked. The cast
              // narrows the host's richer PlayItem to the sim's
              // minimal shape; the extra fields are ignored.
              items: catalog.items,
              groundTile,
            },
            classNameById,
            bridge,
            startAt,
            initialUnlockedCells:
              dungeonMutations?.unlockedCells ?? initialUnlockedCells,
            initialDefeatedEncounters:
              dungeonMutations?.defeatedEncounters ??
              initialDefeatedEncounters,
            initialDestroyedLairs:
              dungeonMutations?.destroyedLairs ?? initialDestroyedLairs,
            initialAcceptedQuests: new Set(save.acceptedQuests ?? []),
            initialBoatPositions,
            initialPickedItemCells,
            initialOnBoat: save.party.onBoat,
            initialCurrentBoatSprite: save.party.currentBoatSprite,
            questDefs,
            questStates: questStatesRef.current,
            currentLocation,
            // Per-turn NPC / quest-giver wander — each tagged cell
            // rolls 50% per step to drift one cardinal tile. The
            // editor's sim mode shares its grid with the authoring
            // surface and intentionally leaves this off; the live
            // play scene wants the ambient motion so towns don't
            // feel static.
            enableNpcWander: true,
          });
          simRef.current = sim;

          sim.subscribe((ev) => {
            if (ev.kind === "moved") {
              // First-move soundtrack kick. Browsers refuse
              // autoplay until the page has seen a user gesture,
              // so the setPlaylist call in the load effect can't
              // start playback on its own. The arrow-key press
              // that fires this `moved` event IS a gesture, which
              // means `Soundtrack.play()` here succeeds. It's
              // idempotent (no-ops when already playing) so calling
              // it every step is harmless.
              try {
                Soundtrack.play();
              } catch {
                // Silent — a missing audio element / unsupported
                // codec shouldn't break movement.
              }
              // Time of day advances per step. Recompute the
              // lighting mode whenever the clock crosses a band
              // boundary (day → twilight → night → twilight → day);
              // identity-stable mode strings mean setLightingMode
              // is a no-op when nothing changed.
              const beforeMode = lightingModeFromClock(clockRef.current);
              const advanced = makeClock(clockRef.current);
              advanceClock(advanced, MINUTES_PER_STEP);
              clockRef.current = advanced.totalMinutes;
              setClockMinutes(advanced.totalMinutes);
              const afterMode = lightingModeFromClock(advanced.totalMinutes);
              // Map-level lighting override: when set on the
              // current catalog map (or implied by being in a
              // dungeon), the clock-driven band is ignored so the
              // authored ambiance stays locked. Otherwise the
              // renderer follows the clock as before.
              const mapOverride = mapForcedLightingMode(catalogRef.current?.map);
              if (
                afterMode !== beforeMode &&
                !dungeonStateRef.current &&
                !mapOverride
              ) {
                rendererRef.current?.setLightingMode(afterMode);
              }
              // Herbalism — Druid / Alchemist passively trickle in
              // potion reagents while walking foraging terrain
              // (grass, forest, …). Read the just-stepped-onto cell
              // and let the helper decide whether to roll AND what
              // to drop. The helper short-circuits when no
              // herbalist is alive or the tile isn't foragable, so
              // the cost on the hot step path is a Map lookup +
              // string check 99% of the time.
              try {
                const liveSave = saveRef.current;
                const cat = catalogRef.current;
                if (liveSave && cat) {
                  const cell = cat.map?.grid?.[ev.to.row]?.[ev.to.col];
                  const tileId =
                    typeof cell === "string"
                      ? cell
                      : (cell as { id?: string } | null | undefined)?.id ?? null;
                  const herb = herbalismOnStep(
                    liveSave,
                    cat.characters as ReadonlyArray<{
                      id: string;
                      name?: string;
                      class?: string;
                    }>,
                    cat.items as ReadonlyArray<{
                      id: string;
                      name?: string;
                      item_type?: string;
                      stackable?: boolean;
                      charges?: number;
                    }>,
                    cat.abilities,
                    tileId,
                  );
                  if (herb.found && herb.nextSave) {
                    // Commit the inventory mutation through the
                    // saveRef so the next reads see the new stash.
                    // Use the same mutate-and-mark pattern other
                    // per-step state changes use (no full setState
                    // / Phaser remount needed for inventory tweaks).
                    saveRef.current = herb.nextSave;
                    // Log line — subtle ("spots", not "FINDS!") so
                    // it reads as a flavour beat rather than a
                    // celebration moment. Matches the user's
                    // "subtle" brief on the cue.
                    const line = `${herb.found.finderName} spots a ${herb.found.itemName} in the brush.`;
                    setLogMessages((prev) => {
                      const next = [...prev, line];
                      return next.length > MAX_LOG
                        ? next.slice(next.length - MAX_LOG)
                        : next;
                    });
                    // Subtle Phaser cue on the party tile — small
                    // gold/green sparkle, no SFX (the user asked
                    // for subtle and reserved the celebration
                    // family for active abilities). Pixel coords
                    // come from the same TILE_SIZE math the rest
                    // of the burst sites use.
                    const r = rendererRef.current;
                    if (r?.scene) {
                      const x = ev.to.col * TILE_SIZE + TILE_SIZE / 2;
                      const y = ev.to.row * TILE_SIZE + TILE_SIZE / 2;
                      radialBurst(
                        r.scene,
                        { x, y },
                        0x9be8a0, // soft herb-green
                        0xffe580, // gold accent
                        20,
                      ).catch(() => undefined);
                    }
                  }
                }
              } catch {
                // Herbalism is a flavour passive — never let an
                // error in the find path crash the step handler.
              }
              // Persist every step. Without this the save only
              // committed on link crossings + combat resolution +
              // Save & Quit — so closing the tab mid-walk reverted
              // the party to the last checkpoint on reload. Now
              // every step writes col/row/clock + the map's
              // mutation state to localStorage, and Return to Game
              // resumes at the cell the player was actually on.
              // localStorage writes are sync but the save blob is
              // a few KB; the cost is invisible at this scale.
              saveCurrent();
              // Refresh the detected-trap overlay so red Xs follow
              // the party — traps that were just out of light range
              // come into view, traps the party left behind fade
              // back into the dark. refreshDetectedTraps no-ops
              // immediately when Detect Traps isn't active, so the
              // call is cheap on every step.
              refreshDetectedTraps();
              return;
            }
            if (ev.kind === "log") {
              // Append to the scrolling message log. Capped to the
              // last MAX_LOG lines so the list stays cheap to
              // re-render. Same shape MapEditor's SimPanel uses.
              setLogMessages((prev) => {
                const next = [...prev, ev.message];
                return next.length > MAX_LOG
                  ? next.slice(next.length - MAX_LOG)
                  : next;
              });
              return;
            }
            if (ev.kind === "linked") {
              handleLinked(ev.link);
              return;
            }
            if (ev.kind === "trap_triggered") {
              // Trap feedback — fire-and-forget VFX/SFX so the
              // player gets immediate "something just happened" cues
              // independent of how the rest of the handler resolves
              // (damage, log line, etc). Audio is a percussive
              // "explosion" tone; visual is a fire-orange radial
              // burst over the trap tile + a small screen shake.
              // Wrapped in try/catch because both calls touch Phaser
              // / WebAudio internals that can throw on a disposed
              // scene; we don't want a render glitch to drop the
              // damage application below.
              const r = rendererRef.current;
              try {
                Sfx.play("explosion");
              } catch {
                /* audio context not ready — skip */
              }
              if (r) {
                try {
                  const px = ev.pos.col * TILE_SIZE + TILE_SIZE / 2;
                  const py = ev.pos.row * TILE_SIZE + TILE_SIZE / 2;
                  void radialBurst(
                    r.scene,
                    { x: px, y: py },
                    VFX_COLOURS.fire,
                    VFX_COLOURS.ember,
                    64,
                  );
                  screenShake(r.scene, 0.008, 240);
                } catch {
                  /* scene disposed mid-step — skip */
                }
              }
              // Dungeon trap fired. Pick a random ALIVE party member
              // and deal 3 + d6 damage (v1's exact formula).
              // We mutate the saveRef in place (no setState — same
              // reasoning as elsewhere: that would force a Phaser
              // remount and teleport the party). The Party screen
              // reads from saveRef when opened, so the player will
              // see the post-hit HP next time they bring up the
              // sheet.
              const cur = saveRef.current;
              if (!cur) {
                liveTrapsRef.current.delete(`${ev.pos.col},${ev.pos.row}`);
                refreshDetectedTraps();
                return;
              }
              const aliveIdxs: number[] = [];
              cur.party.members.forEach((m, i) => {
                if (m.hp > 0) aliveIdxs.push(i);
              });
              if (aliveIdxs.length === 0) {
                liveTrapsRef.current.delete(`${ev.pos.col},${ev.pos.row}`);
                refreshDetectedTraps();
                return;
              }
              const victimIdx =
                aliveIdxs[Math.floor(Math.random() * aliveIdxs.length)];
              const victim = cur.party.members[victimIdx];
              const damage = 3 + Math.floor(Math.random() * 6);
              const newHp = Math.max(0, victim.hp - damage);
              const nextMembers = cur.party.members.map((m, i) =>
                i === victimIdx ? { ...m, hp: newHp } : m,
              );
              const nextSave: WorldSave = {
                ...cur,
                party: { ...cur.party, members: nextMembers },
              };
              saveRef.current = nextSave;
              saveWorld(nextSave);
              setLogMessages((prev) => {
                const line = `Trap! ${victim.id} takes ${damage} damage.`;
                const next = [...prev, line];
                return next.length > MAX_LOG
                  ? next.slice(next.length - MAX_LOG)
                  : next;
              });
              // Remove the just-triggered tile from the live-traps
              // set and persist into the in-memory DungeonLevel so a
              // remount (e.g. floor transition back to this level)
              // doesn't re-arm the trap. dungeonLevelToMap already
              // honours `level.triggeredTraps` when building the
              // cell grid. Then refresh the detected-trap overlay so
              // any red X on this cell clears.
              const key = `${ev.pos.col},${ev.pos.row}`;
              liveTrapsRef.current.delete(key);
              const dStateNow = dungeonStateRef.current;
              if (dStateNow) {
                const session = peekDungeonSession(dStateNow.dungeonId);
                const level = session?.levels[dStateNow.floorIdx];
                level?.triggeredTraps?.add(key);
              }
              refreshDetectedTraps();
              return;
            }
            if (ev.kind === "item_picked") {
              // Party stepped onto a cell carrying an item. We
              // handle two cases:
              //
              //   1. Retrieve-quest item: matches an active retrieve
              //      step's (mapId, col, row, itemId) tuple. Credit
              //      the step, add the item to inventory, fire the
              //      celebration placard, and tear down the overlay
              //      sprite (the kernel cleared cell.item already).
              //
              //   2. Plain item drop: no matching quest step. Add
              //      to inventory + log so the player still picks
              //      it up, but no celebration.
              //
              // The kernel doesn't distinguish — it just signals.
              // PlayHost owns the meaning.
              const save = saveRef.current;
              const map = catalogRef.current?.map;
              if (!save || !map) return;
              const accepted = new Set(save.acceptedQuests ?? []);
              const turnedIn = new Set(save.turnedInQuests ?? []);
              const progress = save.questStepProgress ?? {};
              let matchedQuestId: string | null = null;
              let matchedStepIdx = -1;
              for (const def of questDefsRef.current) {
                if (matchedQuestId) break;
                if (!accepted.has(def.id)) continue;
                if (turnedIn.has(def.id)) continue;
                const completedIdx = progress[def.id] ?? 0;
                for (let i = 0; i < def.steps.length; i++) {
                  if (i < completedIdx) continue;
                  const step = def.steps[i];
                  if (step.kind !== "retrieve") continue;
                  if (step.mapId !== map.id) continue;
                  if (step.col !== ev.pos.col) continue;
                  if (step.row !== ev.pos.row) continue;
                  if (step.itemId !== ev.itemId) continue;
                  matchedQuestId = def.id;
                  matchedStepIdx = i;
                  break;
                }
              }
              // Add the picked item to the party inventory. We do
              // this whether or not it matched a quest — the item
              // catalog is the source of truth for stackability, so
              // a quest item that's also a stackable consumable
              // merges into the existing stack the same way reward
              // items do.
              const catalogItems = catalogRef.current?.items ?? [];
              const nextInventory = addToInventory(
                save.party.inventory.map((e) => ({ ...e })),
                ev.itemId,
                catalogItems,
                1,
              );
              let nextSave: WorldSave = {
                ...save,
                party: { ...save.party, inventory: nextInventory },
              };
              // Quest credit (if matched) — update QuestState and
              // save.questStepProgress in the same shape kill credit
              // uses, so the save mirror stays consistent and the
              // bootstrap pass on reload re-derives the right active
              // step. fireQuestCelebration fires a step placard with
              // the quest name + step name.
              let stepRewardsSummary = "";
              if (matchedQuestId && matchedStepIdx >= 0) {
                const credit = creditQuestRetrieve(
                  questDefsRef.current,
                  questStatesRef.current,
                  matchedQuestId,
                  matchedStepIdx,
                );
                if (credit) {
                  const qs = questStatesRef.current.get(matchedQuestId);
                  if (qs) {
                    let nextIdx = qs.stepProgress.findIndex((p) => !p);
                    if (nextIdx === -1) nextIdx = qs.stepProgress.length;
                    nextSave = {
                      ...nextSave,
                      questStepProgress: {
                        ...(nextSave.questStepProgress ?? {}),
                        [matchedQuestId]: nextIdx,
                      },
                    };
                  }
                  // Apply the step's rewards immediately — items
                  // merge into the inventory we already mutated for
                  // the pickup; tile_add ops paint into the live
                  // grid + save.maps overrides so a "bridge appears
                  // after fetching the keystone" scenario reads in
                  // the same frame as the pickup. Retrieve credits
                  // always carry `stepRewards` (single-shot
                  // completion → never null), so we can apply
                  // unconditionally.
                  const applied = applyStepRewardsToSave(
                    nextSave,
                    credit.stepRewards,
                    {
                      catalog: catalogRef.current,
                      renderer: rendererRef.current,
                      sim: simRef.current,
                    },
                  );
                  nextSave = applied.nextSave;
                  stepRewardsSummary = applied.summary;
                  if (applied.hadTileAdds) refreshQuestGlow();
                  const def = questDefsRef.current.find(
                    (d) => d.id === matchedQuestId,
                  );
                  // Same final-step swap the kill-credit path does
                  // — if THIS pickup closed out the quest's last
                  // step, fire the louder "Objectives Complete"
                  // placard with a "Return to {giver}" prompt
                  // instead of the routine step placard. Matches
                  // the player-facing model: both kill and
                  // retrieve credits feed the same step-progress
                  // bookkeeping, so they should both signal the
                  // hand-off the same way.
                  if (credit.questCompleted) {
                    fireQuestCelebration({
                      kind: "step-final",
                      title: def?.name ?? matchedQuestId,
                      subtitle: returnToGiverSubtitle(
                        def?.questGiver?.npcName,
                      ),
                    });
                  } else {
                    const subtitle = stepRewardsSummary
                      ? credit.step.name
                        ? `${credit.step.name} — ${stepRewardsSummary}`
                        : stepRewardsSummary
                      : credit.step.name;
                    fireQuestCelebration({
                      kind: "step",
                      title: def?.name ?? matchedQuestId,
                      subtitle,
                    });
                  }
                  // Mirror reward summary into the log strip so the
                  // player can re-read what they got once the
                  // placard fades.
                  if (stepRewardsSummary) {
                    setLogMessages((prev) => {
                      const line = `Step reward: ${stepRewardsSummary}.`;
                      const next = [...prev, line];
                      return next.length > MAX_LOG
                        ? next.slice(next.length - MAX_LOG)
                        : next;
                    });
                  }
                }
              }
              saveWorld(nextSave);
              saveRef.current = nextSave;
              // Tear down the sprite overlay — kernel already
              // cleared cell.item but the Phaser Image is still
              // sitting on the cell until we destroy it.
              itemOverlayBridgeRef.current?.removeItem(ev.pos.col, ev.pos.row);
              // Refresh quest glow — the just-picked cell no longer
              // needs a halo, and any newly-active step might.
              refreshQuestGlow();
              return;
            }
            if (ev.kind === "lock_encountered") {
              setLockEncounter(ev.options);
              return;
            }
            if (ev.kind === "chest_encountered") {
              // Mount the Chest dialog. We don't pre-resolve the
              // contents here — the React render reads
              // `state.catalog.items` to look up the chest record
              // and pass its `contents` + display data to the
              // overlay. Keeps the event payload minimal.
              setChestEncounter({ chestId: ev.chestId, pos: ev.pos });
              return;
            }
            if (ev.kind === "quest_encountered") {
              // The kernel re-fires every time the party bumps the
              // giver tile, so the dialog mode is computed here from
              // the current QuestState.
              const qstate = questStatesRef.current.get(ev.questId);
              // "turned_in" → quest is done and rewards have been
              // handed off. Subsequent bumps stay silent.
              if (qstate?.status === "turned_in") return;
              const def = questDefsRef.current.find((d) => d.id === ev.questId);
              const stepCount = def?.steps.length ?? 0;
              const progress = qstate?.stepProgress ?? [];
              let pendingIdx = progress.findIndex((p) => !p);
              if (pendingIdx === -1) pendingIdx = stepCount;
              const activeStep =
                pendingIdx < stepCount ? def?.steps[pendingIdx] : null;
              setQuestOffer({
                questId: ev.questId,
                quest: ev.quest,
                alreadyAccepted:
                  qstate?.status === "active" ||
                  qstate?.status === "completed",
                complete: qstate?.status === "completed",
                stepIdx: pendingIdx,
                stepCount,
                activeStepName:
                  activeStep?.name || activeStep?.description || undefined,
                activeStepDescription:
                  activeStep && activeStep.name
                    ? activeStep.description
                    : undefined,
              });
              return;
            }
            if (ev.kind === "quest_kill_credited") {
              // Mirror the kernel's state mutation back into the save
              // so a reload preserves progress. We translate the v2
              // structured state (stepKills + stepProgress) into the
              // legacy save shape (questStepProgress[id] = first
              // incomplete step index) the rest of the save format
              // already understands.
              const qs = questStatesRef.current.get(ev.questId);
              const save = saveRef.current;
              // Step transitioned to complete? Apply the step's
              // rewards (items + tile_add) IMMEDIATELY so the next
              // step can depend on them — a bridge appearing, a key
              // landing in inventory. The same write commits the
              // questStepProgress bump below so a reload doesn't
              // split the credit from its rewards.
              let stepRewardsSummary = "";
              let nextSave: WorldSave | null = save;
              if (qs && nextSave) {
                let nextIdx = qs.stepProgress.findIndex((p) => !p);
                if (nextIdx === -1) nextIdx = qs.stepProgress.length;
                const prevProgress = nextSave.questStepProgress ?? {};
                if (prevProgress[ev.questId] !== nextIdx) {
                  nextSave = {
                    ...nextSave,
                    questStepProgress: {
                      ...prevProgress,
                      [ev.questId]: nextIdx,
                    },
                  };
                }
              }
              if (ev.stepCompleted && nextSave) {
                const def = questDefsRef.current.find(
                  (d) => d.id === ev.questId,
                );
                const stepRewards = def?.steps[ev.stepIdx]?.rewards;
                if (stepRewards) {
                  // Items go via gameState.partyData.inventory rather
                  // than the save: we're inside resolveSpawnEncounter("won"),
                  // which is called from onCombatResolved RIGHT BEFORE
                  // applyCombatResultToSave overwrites save.party.inventory
                  // from the kernel's view. Pushing into the kernel
                  // side means the post-combat sync carries the
                  // additions into the save instead of stomping them.
                  applyStepItemsToBattleState(
                    stepRewards.items,
                    catalogRef.current,
                  );
                  const applied = applyStepRewardsToSave(
                    nextSave,
                    stepRewards,
                    {
                      catalog: catalogRef.current,
                      renderer: rendererRef.current,
                      sim: simRef.current,
                      skipItems: true,
                    },
                  );
                  nextSave = applied.nextSave;
                  stepRewardsSummary = applied.summary;
                  // Tile mutations can change walkability; refresh
                  // the quest glow so a path opened by the reward
                  // re-tints correctly.
                  if (applied.hadTileAdds) refreshQuestGlow();
                }
              }
              if (nextSave && nextSave !== save) {
                saveWorld(nextSave);
                saveRef.current = nextSave;
              }
              // Step transitioned to complete on this credit? Fire a
              // celebration placard + sound + radial burst. We use
              // the kernel-supplied `stepCompleted` flag rather than
              // re-deriving it from stepProgress so a multi-kill
              // step doesn't fire on every individual credit — only
              // on the last one. When this credit ALSO completed the
              // last step of the quest (`ev.questCompleted`), swap
              // to the `step-final` variant — same celebration
              // footprint but with a brighter halo and a
              // "Return to {giver}" subtitle so the player gets an
              // immediate, in-game signal that the handoff is
              // waiting. The bigger "Quest Complete" placard still
              // fires at actual turn-in (see onQuestDecline's
              // complete branch).
              if (ev.stepCompleted) {
                const def = questDefsRef.current.find(
                  (d) => d.id === ev.questId,
                );
                const step = def?.steps[ev.stepIdx];
                if (ev.questCompleted) {
                  // Step-final wins over rewards in the subtitle —
                  // the "Return to {giver}" prompt is the most
                  // actionable thing the player can do. Rewards
                  // earned here get spoken to in the log strip
                  // below instead.
                  fireQuestCelebration({
                    kind: "step-final",
                    title: def?.name ?? ev.questId,
                    subtitle: returnToGiverSubtitle(
                      def?.questGiver?.npcName,
                    ),
                  });
                } else {
                  // Append the rewards summary to the step name so
                  // the placard surfaces both — "Find the key" on
                  // line 2 + "+Iron Key · world changed" on line 3
                  // is what the player reads in one glance.
                  const subtitle = stepRewardsSummary
                    ? step?.name
                      ? `${step.name} — ${stepRewardsSummary}`
                      : stepRewardsSummary
                    : step?.name;
                  fireQuestCelebration({
                    kind: "step",
                    title: def?.name ?? ev.questId,
                    subtitle,
                  });
                }
                // Mirror reward summary into the log strip so it
                // survives the placard's fade-out and the player
                // can re-read what they got.
                if (stepRewardsSummary) {
                  setLogMessages((prev) => {
                    const line = `Step reward: ${stepRewardsSummary}.`;
                    const next = [...prev, line];
                    return next.length > MAX_LOG
                      ? next.slice(next.length - MAX_LOG)
                      : next;
                  });
                }
              }
              return;
            }
            if (ev.kind === "dungeon_entered") {
              handleDungeonEntered(ev.dungeonId, ev.returnPos);
              return;
            }
            if (ev.kind === "spawn_encountered") {
              // Switch the React shell into combat mode. The world
              // Phaser game stays mounted underneath (its keyboard
              // listener is gated by overlaysOpenRef), but the canvas
              // is hidden while PlayCombatHost takes the screen.
              setCombat(ev.options);
              return;
            }
            if (ev.kind === "state") {
              // Mirror the kernel's mutation state into the dungeon
              // session every tick when the party is in a dungeon.
              // Floor mutations (destroyed lairs are a no-op here,
              // but picked locks and defeated encounters matter)
              // need to survive floor transitions in both
              // directions.
              const dungeonNow = dungeonStateRef.current;
              if (dungeonNow && sim) {
                const session = peekDungeonSession(dungeonNow.dungeonId);
                if (session) {
                  const snap = sim.snapshot();
                  writeFloorMutations(session, dungeonNow.floorIdx, {
                    unlockedCells: new Set(snap.unlockedCells),
                    defeatedEncounters: new Set(snap.defeatedEncounters),
                    destroyedLairs: new Set(snap.destroyedLairs),
                  });
                  // Fog-of-war write-back — copy the renderer's live
                  // visited set into the floor's exploredTiles so
                  // ascending stairs / leaving the dungeon and
                  // returning later still sees the mapped layout.
                  // `exploredTiles` is the v1-shaped Set the
                  // dungeon session serialiser already round-trips
                  // to disk; we own one source of truth.
                  const lvl = session.levels[dungeonNow.floorIdx];
                  const live = rendererRef.current?.getVisitedCells();
                  if (lvl && live) {
                    lvl.exploredTiles = new Set(live);
                  }
                }
              }
              return;
            }
            if (ev.kind === "counter_encountered") {
              // Tile-side counter — open the shop on the counter id
              // the cell carried. Catalog mismatch (e.g. typoed
              // counter id) silently no-ops; the player just walks
              // into a tile that does nothing.
              const id = ev.counterId;
              const def = catalog.counters.find((c) => c.id === id);
              if (def) setCounterShopId(id);
              else
                // eslint-disable-next-line no-console
                console.warn(
                  `[play] counter_encountered → no counter "${id}" in catalog`,
                );
              return;
            }
            if (ev.kind === "npc_encountered") {
              // NPC tile — open the dialog modal. The modal renders
              // the NPC's chatter and, when the NPC also carries a
              // `counter` field, surfaces a Visit Counter button
              // that routes the player to the matching shop /
              // temple overlay. Opening dialog-first (instead of
              // jumping straight to the shop) lets the player read
              // the NPC's lines before transacting and lets NPCs
              // without counters still surface chatter.
              const npc = catalog.npcs.find((n) => n.id === ev.npcId);
              if (!npc) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[play] npc_encountered → unknown npc "${ev.npcId}"`,
                );
                return;
              }
              setNpcDialogId(ev.npcId);
              return;
            }
            if (ev.kind === "npc_moved") {
              // The kernel just drifted an NPC / quest giver from
              // one cell to another (50% wander roll on this turn).
              // The grid mutation has already landed; we just need
              // to slide the corresponding Phaser overlay Image
              // over and re-key our per-cell map. Doing this here
              // keeps the visual in lockstep with the bump-detection
              // tag — without the move, the player would see the
              // sprite stuck at the old cell while bumping the new
              // cell would trigger the dialog.
              //
              // Quest givers ALSO need the glow halo to follow them;
              // we set a flag and refresh at the end of the loop so
              // a multi-mover step only kicks one refresh.
              const sceneSelf = this;
              const fromKey = `${ev.from.col},${ev.from.row}`;
              const toKey = `${ev.to.col},${ev.to.row}`;
              const toX = ev.to.col * TILE_SIZE + TILE_SIZE / 2;
              const toY = ev.to.row * TILE_SIZE + TILE_SIZE / 2;
              const npcImg = sceneSelf.npcOverlays.get(fromKey);
              if (npcImg) {
                sceneSelf.npcOverlays.delete(fromKey);
                npcImg.setPosition(toX, toY);
                sceneSelf.npcOverlays.set(toKey, npcImg);
              }
              const questImg = sceneSelf.questOverlays.get(fromKey);
              if (questImg) {
                sceneSelf.questOverlays.delete(fromKey);
                questImg.setPosition(toX, toY);
                sceneSelf.questOverlays.set(toKey, questImg);
              }
              if (ev.questId) {
                // Quest-glow cells track the live grid, which the
                // wander pass already mutated. Re-running the pass
                // moves the halo to follow the giver.
                refreshQuestGlow();
              }
              return;
            }
          });
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width,
        height,
        parent: containerRef.current,
        backgroundColor: "#0c0c14",
        pixelArt: true,
        // Match v1's framing: render at the chosen internal canvas
        // size and FIT-scale to the parent container. On smaller
        // windows the tiles shrink visually instead of getting
        // clipped; on larger windows they grow without going blurry
        // (pixelArt keeps the nearest-neighbor scaling crisp).
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: PlayScene,
      });
    })();

    /** Resolve a dungeon record's catalog id, generate its levels
     *  (or fetch the cached session), and remount the world against
     *  the entrance floor. The overworld save's currentMapId stays
     *  put — we use the in-memory `dungeonStateRef` to drive the
     *  swap so closing the tab mid-dungeon doesn't strand the
     *  player on a synthetic floor id with no session backing it. */
    function handleDungeonEntered(
      dungeonId: string,
      returnPos: { col: number; row: number },
    ) {
      const save = saveRef.current;
      const cat = state.kind === "ok" ? state.catalog : null;
      if (!save || !cat) return;
      const record = cat.dungeons.find((d) => d.id === dungeonId);
      if (!record) {
        // eslint-disable-next-line no-console
        console.warn(
          `[play] dungeon_entered: no dungeon record for id "${dungeonId}"`,
        );
        return;
      }
      // Persistent per-game seed: if the dungeon already has a
      // SavedDungeonSession on the save, reuse its seed (and its
      // already-generated levels via the in-memory store
      // pre-population that runs in the load effect). Otherwise
      // roll a fresh seed and bind it to the save below — that's
      // what makes this dungeon "fixed for the rest of the game".
      const persisted = save.dungeons?.[dungeonId];
      const seed = persisted
        ? persisted.seed
        : Math.floor(Math.random() * 0x7fffffff);
      // Encounter table + monster-difficulty lookup let the
      // generator populate rooms with combat. Without them the
      // floor is empty and every dungeon feels the same.
      // SimEncounterRef carries only the sim-facing fields, but
      // the raw JSON records (which the loader cast through to
      // SimEncounterRef) do carry `area` — read it back off the
      // unknown shape so the generator's area filter still works.
      const encountersByArea: Record<string, EncounterTemplate[]> = {};
      for (const e of cat.encounters) {
        const area =
          (e as unknown as { area?: string }).area ?? "dungeon";
        (encountersByArea[area] ??= []).push(
          e as unknown as EncounterTemplate,
        );
      }
      const monsterDifficulty = (id: string): string | undefined =>
        (cat.monsters.find((m) => m.id === id) as
          | (SimMonsterRef & { difficulty?: string })
          | undefined)?.difficulty;
      // Walk the accepted quests' kill-steps and group their target
      // monsters by destination floor. Step records carry
      // `dungeon_id` + `dungeon_level` (1-based "depth" per the
      // schema) + `params.monster_id`; we convert level→floorIdx by
      // subtracting 1 so the generator's 0-based index lines up.
      // Quests without a monster_id or without a matching dungeon
      // id contribute nothing — they don't break anything, they
      // just don't get the guarantee.
      const accepted = new Set<string>(save.acceptedQuests ?? []);
      const requiredByFloor = new Map<number, string[]>();
      for (const q of cat.quests) {
        if (!accepted.has(q.id)) continue;
        const steps =
          (q as unknown as {
            steps?: ReadonlyArray<{
              kind?: string;
              dungeon_id?: string;
              dungeon_level?: number;
              params?: { monster_id?: string } | null;
            }>;
          }).steps ?? [];
        for (const s of steps) {
          if (s.kind !== "kill") continue;
          if (s.dungeon_id !== dungeonId) continue;
          const monsterId = s.params?.monster_id;
          if (!monsterId) continue;
          const lvl = s.dungeon_level;
          if (typeof lvl !== "number" || !Number.isFinite(lvl)) continue;
          const floorIdx = Math.max(0, lvl - 1);
          const bucket = requiredByFloor.get(floorIdx) ?? [];
          if (!bucket.includes(monsterId)) bucket.push(monsterId);
          requiredByFloor.set(floorIdx, bucket);
        }
      }
      const session = getOrCreateDungeonSession(dungeonId, seed, () =>
        generateDungeonFromRecord(record, {
          seed,
          encounters: encountersByArea,
          monsterDifficulty,
          requiredMonstersByFloor: requiredByFloor,
        }),
      );
      const lvl0 = session.levels[0];
      if (!lvl0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[play] dungeon_entered: "${dungeonId}" has no floors`,
        );
        return;
      }
      // Save the overworld's mutations BEFORE the swap so re-emerging
      // from the dungeon resumes the right cleared / unlocked state.
      saveCurrent();
      const returnTo = {
        mapId: save.party.currentMapId,
        col: returnPos.col,
        row: returnPos.row,
      };
      dungeonStateRef.current = {
        dungeonId,
        seed: session.seed,
        levels: session.levels,
        floorIdx: 0,
        returnTo,
        startAt: { col: lvl0.entryCol, row: lvl0.entryRow },
      };
      // Persist the dungeon to the save so a reload mid-dungeon
      // (or a tab close + return) lands the party back in the
      // *same* dungeon with the *same* rolled layout — the seed
      // bound here is what the rest of the game session will see.
      const dungeonSnapshot = snapshotDungeonForSave(session);
      const nextSave: WorldSave = {
        ...save,
        clockMinutes: clockRef.current,
        party: {
          ...save.party,
          currentDungeon: {
            dungeonId,
            floorIdx: 0,
            col: lvl0.entryCol,
            row: lvl0.entryRow,
            returnTo,
          },
        },
        dungeons: dungeonSnapshot
          ? { ...save.dungeons, [dungeonId]: dungeonSnapshot }
          : save.dungeons,
      };
      saveWorld(nextSave);
      saveRef.current = nextSave;
      // Bump the reload key so the load effect re-runs, the dungeon
      // overlay kicks in via buildDungeonCatalog, and the Phaser
      // game remounts against the synthetic floor.
      setReloadKey((k) => k + 1);
    }

    /** Handle a link event from the kernel. Saves the current map's
     *  mutations + party position FIRST, then either teleports (same
     *  map) or bumps the reload key (cross-map). */
    function handleLinked(link: { map_id: string; x: number; y: number }) {
      const save = saveRef.current;
      if (!save) return;
      // ── Dungeon link handling ──────────────────────────────────────
      // Stairs cells in a generated dungeon link to synthetic map
      // ids (see `dungeonLevelToMap`). Recognise those before the
      // overworld branches so they don't try to fetch the link from
      // maps.json.
      const dungeonNow = dungeonStateRef.current;
      if (dungeonNow && link.map_id === EXIT_TO_OVERWORLD_MAP_ID) {
        // Drop the dungeon overlay and restore the overworld at the
        // saved return cell. Mirror the dungeon's latest state into
        // save.dungeons[id] BEFORE exiting so a re-entry next
        // session resumes with the right cleared rooms / unlocked
        // doors. We keep save.dungeons[id] populated even after
        // exit — that's how the seed stays bound for the rest of
        // the game.
        const session = peekDungeonSession(dungeonNow.dungeonId);
        const snapshot = session ? snapshotDungeonForSave(session) : null;
        const next: WorldSave = {
          ...save,
          clockMinutes: clockRef.current,
          party: {
            ...save.party,
            currentMapId: dungeonNow.returnTo.mapId,
            col: dungeonNow.returnTo.col,
            row: dungeonNow.returnTo.row,
            currentDungeon: undefined,
          },
          dungeons: snapshot
            ? { ...save.dungeons, [dungeonNow.dungeonId]: snapshot }
            : save.dungeons,
        };
        saveWorld(next);
        saveRef.current = next;
        dungeonStateRef.current = null;
        setReloadKey((k) => k + 1);
        return;
      }
      if (dungeonNow) {
        // Floor transition — `floorMapId(d, n)` shape. Pull n out
        // and remount on that floor's entrance cell. Floor mutations
        // for both directions live in the session store so the
        // descend / ascend round-trip preserves state on each floor.
        const match = link.map_id.match(/_f(\d+)__$/);
        const targetFloor = match
          ? Number.parseInt(match[1], 10)
          : Number.NaN;
        if (
          Number.isFinite(targetFloor) &&
          link.map_id === floorMapId(dungeonNow.dungeonId, targetFloor)
        ) {
          const lvl = dungeonNow.levels[targetFloor];
          if (lvl) {
            // Landing cell depends on direction:
            //   - descending (target floor is below the current
            //     one): land on the new floor's stairs-UP, which
            //     the generator records as entryCol/entryRow.
            //   - ascending (target floor is above): land on the
            //     new floor's stairs-DOWN — the spot the party
            //     would have descended from. Without this the
            //     ascent always dumps the party back on the
            //     entrance stairs even when they came up from a
            //     different shaft, which reads as teleportation.
            // Falls back to entryCol/entryRow when stairs-down
            // isn't on the destination floor (e.g. a single-floor
            // dungeon, or an authored map that pre-dates this).
            const ascending = targetFloor < dungeonNow.floorIdx;
            const stairsDown = ascending ? findStairsDownCell(lvl) : null;
            const landing =
              stairsDown ?? { col: lvl.entryCol, row: lvl.entryRow };
            dungeonStateRef.current = {
              ...dungeonNow,
              floorIdx: targetFloor,
              startAt: landing,
            };
            // Mirror the latest in-memory session into the save so
            // a reload mid-transition (or right after) resumes on
            // the new floor with the prior floor's mutations
            // preserved.
            const session = peekDungeonSession(dungeonNow.dungeonId);
            const snapshot = session
              ? snapshotDungeonForSave(session)
              : null;
            const next: WorldSave = {
              ...save,
              clockMinutes: clockRef.current,
              party: {
                ...save.party,
                currentDungeon: {
                  dungeonId: dungeonNow.dungeonId,
                  floorIdx: targetFloor,
                  col: landing.col,
                  row: landing.row,
                  returnTo: dungeonNow.returnTo,
                },
              },
              dungeons: snapshot
                ? { ...save.dungeons, [dungeonNow.dungeonId]: snapshot }
                : save.dungeons,
            };
            saveWorld(next);
            saveRef.current = next;
            setReloadKey((k) => k + 1);
            return;
          }
        }
        // Unknown synthetic id while in a dungeon — fall through to
        // the normal handler, which will log a missing-map error.
      }
      if (link.map_id === save.party.currentMapId) {
        // Same-map portal — teleport in place. We still save the
        // post-teleport position so a reload puts the party on the
        // landing cell, not the source one. We also persist the
        // current map's full mutation snapshot (unlocked cells,
        // defeated encounters, parked boats, etc.) and the party's
        // boat-state so a refresh after teleporting doesn't reset
        // any of it — the sim's in-memory state survives the
        // teleport, but a reload would otherwise rebuild from the
        // pre-teleport save.
        sim?.teleport(link.x, link.y);
        const snap = sim?.snapshot();
        if (snap) {
          const next: WorldSave = {
            ...save,
            // Pull the live clock from the ref — it advances per
            // step into the ref, not into the save. Without this
            // every link write would commit the stale clock from
            // the last explicit saveCurrent call.
            clockMinutes: clockRef.current,
            party: {
              ...save.party,
              col: snap.pos.col,
              row: snap.pos.row,
              onBoat: snap.onBoat,
              currentBoatSprite: snap.currentBoatSprite,
            },
            maps: {
              ...save.maps,
              // Pass the prior SavedMapState so authored fields
              // (tileOverrides from quest rewards) carry forward —
              // the live snapshot doesn't surface them.
              [save.party.currentMapId]: mapStateFromSnapshot(
                snap,
                save.maps?.[save.party.currentMapId],
                // Same-map teleport — the renderer + its visited set
                // survive the teleport. Pull the live set so the
                // refresh-after-teleport path doesn't reset the fog
                // back to the pre-teleport on-disk snapshot.
                rendererRef.current?.getVisitedCells(),
              ),
            },
          };
          saveWorld(next);
          saveRef.current = next;
        }
        return;
      }
      // Cross-map link — snapshot the current map's mutations under
      // its key, advance currentMapId + position, save, remount.
      // Use the shared mapStateFromSnapshot helper so we don't drop
      // boatPositions (the bug that previously reset every parked
      // boat to its authored cell whenever the party crossed a link)
      // OR tileOverrides (the bug that reset quest-added boat tiles
      // when the party crossed a link off the source map).
      const snap = sim?.snapshot();
      // Carry forward the prior SavedMapState — authored fields
      // (tileOverrides from quest rewards) need to survive the
      // snapshot rebuild. The fallback `{}` is for the
      // sim-missing edge case where there's no live snapshot to
      // build from; we'd rather preserve whatever was saved
      // before than wipe the map to empty.
      const prevMapState = save.maps?.[save.party.currentMapId];
      const mapState: SavedMapState = snap
        ? mapStateFromSnapshot(
            snap,
            prevMapState,
            // Cross-map link — the renderer is about to be torn
            // down and rebuilt for the new map. Snapshot the
            // outgoing map's visited set FIRST so the player's
            // exploration of the source map persists; the new map's
            // renderer will seed itself from save.maps[link.map_id]
            // on mount.
            rendererRef.current?.getVisitedCells(),
          )
        : prevMapState ?? {
            unlockedCells: [],
            defeatedEncounters: [],
            destroyedLairs: [],
            boatPositions: {},
          };
      const next: WorldSave = {
        ...save,
        // Live clock from the ref — same reason as the same-map
        // teleport branch above. Without this, the new map mount
        // calls `lightingModeFromClock(save.clockMinutes)` with the
        // *original* save value (or the most-recent saveCurrent
        // checkpoint) and snaps the world back to day even though
        // the player walked through hours of in-world time before
        // hitting the link.
        clockMinutes: clockRef.current,
        party: {
          ...save.party,
          currentMapId: link.map_id,
          col: link.x,
          row: link.y,
          // Persist mid-voyage state so a player who walks through
          // a link while aboard a boat keeps the boat on the new
          // map. Without these two fields the new map's mount
          // re-seeds from `boat: true` cells and the party lands
          // on foot at the link target.
          onBoat: snap ? snap.onBoat : false,
          currentBoatSprite: snap ? snap.currentBoatSprite : null,
        },
        maps: { ...save.maps, [save.party.currentMapId]: mapState },
      };
      saveWorld(next);
      saveRef.current = next;
      // Bump the reload key — the load effect re-runs against the
      // new currentMapId, fetches the new map, and re-mounts Phaser.
      setReloadKey((k) => k + 1);
    }

    return () => {
      cancelled = true;
      sim?.dispose();
      sim = null;
      simRef.current = null;
      // Painted help screen lives inside the scene, but its keydown
      // listener is registered against `window`. Dispose explicitly
      // before tearing the game down so a scene swap (cross-map link,
      // dungeon transition) doesn't leak the listener.
      helpScreenRef.current?.dispose();
      helpScreenRef.current = null;
      // Quest Log painter — same window-listener teardown concern.
      questLogScreenRef.current?.dispose();
      questLogScreenRef.current = null;
      if (game) {
        game.destroy(true);
        game = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.catalog, state.save]);

  /** Apply a combat outcome back to the world.
   *
   *  Win: the kernel's `resolveSpawnEncounter("won")` removes the
   *  trigger cell's spawn/encounter id + adds it to the appropriate
   *  defeated/destroyed Set. We then snapshot the save (now reflects
   *  the new mutation state) and clear the combat UI.
   *
   *  Loss: the kernel's `resolveSpawnEncounter("fled")` is called to
   *  release the pending-spawn lock, but we IMMEDIATELY navigate to
   *  the end screen. The current save was last written on the link
   *  that led here; the death-screen's "Continue" path reads the
   *  PREVIOUS save (the backup slot saveWorld rolls forward each
   *  time). */
  const onCombatResolved = useCallback((result: CombatResolved) => {
    const sim = simRef.current;
    if (!sim) {
      // Sim was disposed before combat finished — shouldn't happen,
      // but bail out gracefully.
      setCombat(null);
      return;
    }
    if (result.winner === "party") {
      sim.resolveSpawnEncounter("won");
      // Two reconciliations need to land before the save write:
      //   1. World-side mutations from the kernel (unlocked cells,
      //      defeated encounters, destroyed lairs, party position) —
      //      `saveCurrent` snapshots those off the sim.
      //   2. Combat-side mutations to the party (HP/MP/inventory
      //      changes per character, shared stash items consumed, gold
      //      from kills) — `applyCombatResultToSave` reads
      //      `gameState.partyData` which CombatScene mutated in place
      //      during the fight, and folds those deltas into the save's
      //      `members[]` + `party.gold` + `party.inventory`.
      //   3. Quest-step credit — walk accepted quests, advance any
      //      whose current step is a kill targeting monsters that
      //      just fell (and matching the dungeon+level when the
      //      step pins those). Has to read the just-won combat's
      //      monsters list off the React state since the
      //      SpawnEncounter snapshot lives there.
      //
      // Do (2) FIRST so saveRef.current carries the post-fight party
      // before saveCurrent reads it; then (3) layered on top so the
      // step counter lands in the same write.
      if (saveRef.current) {
        saveRef.current = applyCombatResultToSave(saveRef.current);
        // Read combat + catalog off refs rather than the closure-
        // captured state. onCombatResolved is memoized with a
        // narrow dep list, so its closure may have been built
        // before the catalog loaded or before this combat fired;
        // the refs always carry the live values.
        saveRef.current = creditKillStep(
          saveRef.current,
          combatRef.current,
          dungeonStateRef.current,
          catalogRef.current?.quests ?? [],
        );
      }
      saveCurrent();
      setCombat(null);
      return;
    }
    // Party wipe — release the pending-spawn so dispose() runs
    // clean, then route to the end screen. The previous save (rolled
    // into the backup slot by the last link save) remains intact.
    sim.resolveSpawnEncounter("fled");
    setCombat(null);
    router.push("/play/end");
  }, [router, saveCurrent]);

  // Lock-dialog wiring — Pick Lock / Cast Knock both call back into
  // the kernel, which mutates the cell + emits a state event the
  // bridge has already processed by the time we re-render.
  const onPickLock = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return null;
    return sim.attemptPickLock();
  }, []);
  const onCastKnock = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return null;
    return sim.attemptKnock();
  }, []);
  const onLockClose = useCallback(() => {
    const sim = simRef.current;
    sim?.dismissLock();
    setLockEncounter(null);
  }, []);

  /** Quest accept — mark the quest accepted on the kernel (so the
   *  trigger tile stops re-offering), flip the QuestState's status
   *  to "active", ask the sim to drop any newly-eligible kill-step
   *  encounters onto the live map, persist the accepted-set into
   *  the save, and fire a celebration placard + sky-blue glow burst
   *  at the party so the player gets a satisfying acknowledgment
   *  that they've taken on the calling. The placard's subtitle
   *  surfaces the first step's name so the player has an immediate
   *  "what next" signal once it fades. */
  const onQuestAccept = useCallback(() => {
    setQuestOffer((current) => {
      if (!current) return null;
      const sim = simRef.current;
      const id = current.questId;
      const newlyAccepted = sim?.markQuestAccepted(id) ?? false;
      const qs = questStatesRef.current.get(id);
      if (qs && qs.status === "available") qs.status = "active";
      sim?.refreshQuestPlacements();
      if (newlyAccepted) {
        const save = saveRef.current;
        if (save) {
          const prev = save.acceptedQuests ?? [];
          if (!prev.includes(id)) {
            const nextSave: WorldSave = {
              ...save,
              acceptedQuests: [...prev, id],
            };
            saveWorld(nextSave);
            saveRef.current = nextSave;
          }
        }
        // Newly-accepted quest may have kill-step / fetch-step targets
        // already painted on the current map. Re-run the glow pass so
        // those cells light up immediately.
        refreshQuestGlow();
        // The accepted quest may also carry retrieve steps targeting
        // cells on the current map. Stamp their items + create the
        // overlay sprites so the player sees them right away
        // (followed by another glow pass inside the helper so the
        // gold halo wraps the new icon).
        refreshRetrievePlacements();
        // Celebration — placard + sky-blue glow burst + magic_burst
        // chime at the party tile. Gated on `newlyAccepted` so a
        // re-bump of the giver tile (already-accepted quest re-opens
        // the dialog so the player can re-read the brief) doesn't
        // re-fire the cue. Subtitle pulls the FIRST step's name so
        // the player gets an "and your first task is…" prompt as
        // the placard fades. Falls back to the quest description
        // when steps aren't authored.
        const def = questDefsRef.current.find((d) => d.id === id);
        const firstStep = def?.steps[0];
        const stepLabel =
          firstStep?.name ||
          firstStep?.description ||
          def?.description ||
          undefined;
        fireQuestCelebration({
          kind: "quest-accept",
          title: def?.name ?? id,
          subtitle: stepLabel,
        });
      }
      return null;
    });
  }, [
    fireQuestCelebration,
    refreshQuestGlow,
    refreshRetrievePlacements,
  ]);

  /** Quest decline / close — routes both "Decline" (offer view) and
   *  "Close" (in-progress / complete view) through the same handler.
   *
   *  In the complete view we ALSO grant rewards: `claimQuestRewards`
   *  atomically flips status to "turned_in" and returns the reward
   *  payload (xp / gold / items) declared on the quest record. We
   *  apply those to the live save:
   *
   *   - **gold** is added to `save.party.gold`
   *   - **items** are appended to `save.party.inventory` as fresh
   *     entries (one row per id — proper stack-merging via
   *     `addToStash` is a follow-up that needs the full item
   *     catalog, which PlayHost doesn't load today)
   *   - **xp** is banked into every alive member's
   *     `SavedCharacterState.exp` via `awardQuestXpToSavedMembers`.
   *     Fallen members (hp <= 0) don't get a share — same
   *     "alive only" gate combat uses. The level-up math itself
   *     defers to the next combat: `seedBattleCaches` overlays
   *     the banked exp onto the PartyMember the kernel sees, and
   *     `awardXp`'s `while (member.exp >= member.level * xpPer)`
   *     loop catches up any pending thresholds in one pass. See
   *     `awardQuestXp.ts` for the rationale on why we don't run
   *     awardXp eagerly here.
   *
   *  Persistence: a single `saveWorld(nextSave)` commits gold +
   *  inventory + the resulting `questStepProgress` (already
   *  written by the `quest_kill_credited` handler on the way to
   *  completion). Status mutation (turned_in) lives in the
   *  questStatesRef and is rebuilt from save.acceptedQuests +
   *  questStepProgress on reload — see the bootstrap pass in the
   *  sim-construction effect. */
  const onQuestDecline = useCallback(() => {
    setQuestOffer((current) => {
      if (current?.complete) {
        const claim = claimQuestRewards(
          questDefsRef.current,
          questStatesRef.current,
          current.questId,
        );
        if (claim) {
          const save = saveRef.current;
          if (save) {
            // Quest reward items merge into existing stacks where
            // possible — picking up two more Lockpicks bumps an
            // existing Lockpicks row from 3 to 5 instead of creating
            // a second row. Falls back to a fresh row for non-
            // stackable items (unique magic items, etc.).
            const catalogItems = catalogRef.current?.items ?? [];
            let nextInventory = save.party.inventory.map((e) => ({ ...e }));
            for (const id of claim.items) {
              nextInventory = addToInventory(
                nextInventory,
                id,
                catalogItems,
                1,
              );
            }
            // Persist the turned-in flag so a reload doesn't let the
            // player re-bump the giver and re-claim. De-dupe via the
            // Set indirection in case (defensively) the save already
            // carried the id from a prior race.
            const turnedIn = new Set(save.turnedInQuests ?? []);
            turnedIn.add(claim.questId);
            // ── Tile-mutation rewards ────────────────────────────
            // Each tile_add op paints the named palette tile at
            // (map, col, row). It's the only tile-mutation reward —
            // "removal" is just a paint with the desired replacement
            // tile, fully specified. The op gets recorded into the
            // target map's `tileOverrides` so the mutation survives
            // reload + re-entry. If the player is currently ON the
            // affected map we ALSO mutate the live grid + repaint
            // the cell sprite immediately so the change reads in the
            // same frame as the turn-in dialog closes. Cells on
            // other maps just get the override stamped on the save;
            // the apply pass at map-mount picks them up next time
            // the player visits.
            const nextMaps: typeof save.maps = { ...save.maps };
            const liveMap = catalogRef.current?.map;
            const palette = catalogRef.current?.palette ?? [];
            const r = rendererRef.current;
            for (const op of claim.tileAdds) {
              const mapId = op.map;
              const { col, row, tile_id: tileId } = op;
              if (!tileId) continue;
              // Update the save's per-map override list (append; the
              // mount-time apply pass picks them up in order so the
              // latest write wins for repeat-paints of the same cell).
              const prev = nextMaps[mapId] ?? {
                unlockedCells: [],
                defeatedEncounters: [],
                destroyedLairs: [],
              };
              const nextOverrides = [
                ...(prev.tileOverrides ?? []),
                { col, row, tileId },
              ];
              nextMaps[mapId] = { ...prev, tileOverrides: nextOverrides };
              // Live-update if on the same map: mutate the grid +
              // setCellSprite. Out-of-bounds entries skip silently.
              if (liveMap && mapId === liveMap.id) {
                if (
                  row >= 0 &&
                  row < liveMap.height &&
                  col >= 0 &&
                  col < liveMap.width
                ) {
                  const source = palette.find((t) => t.id === tileId);
                  if (source) {
                    liveMap.grid[row][col] = {
                      ...source,
                    } as typeof liveMap.grid[number][number];
                    if (r && source.sprite) {
                      r.setCellSprite(col, row, source.sprite);
                    }
                    // If the new tile is flagged as a boat, register
                    // it with the kernel's boatPositions map — the
                    // seed-time grid scan only sees authored boats,
                    // so a runtime boat addition needs an explicit
                    // call here for the boarding logic to recognise
                    // the cell on the next step. Cells stamped at
                    // mount time (via the create() override pass)
                    // don't need this path; the kernel's seed loop
                    // picks them up before stepInDirection ever runs.
                    if (
                      (source as { boat?: boolean }).boat === true &&
                      simRef.current &&
                      source.sprite
                    ) {
                      simRef.current.addBoatAt(col, row, source.sprite);
                    }
                  }
                }
              }
            }
            // Bank the quest's XP into every alive member's saved
            // `exp` field. Full XP per member (matching the combat
            // reward semantics — no split). The level-up itself
            // fires when combat next runs awardXp on a non-zero
            // reward; see awardQuestXp.ts for the deferment
            // rationale. `changed` lets us avoid an unnecessary
            // members[] replacement when no one qualified (XP=0
            // or party wipe).
            const xpResult = awardQuestXpToSavedMembers(
              save.party.members,
              claim.xp,
            );
            const nextMembers = xpResult.changed
              ? xpResult.nextMembers
              : save.party.members;
            const nextSave: WorldSave = {
              ...save,
              party: {
                ...save.party,
                gold: save.party.gold + claim.gold,
                inventory: nextInventory,
                members: nextMembers,
              },
              turnedInQuests: [...turnedIn],
              maps: nextMaps,
            };
            // Tile mutations may have changed walkability / light
            // sources; trigger a relight so torches in newly-passable
            // corridors light up immediately.
            if (r && claim.tileAdds.length > 0) {
              r.relight();
            }
            saveWorld(nextSave);
            saveRef.current = nextSave;
            // The just-turned-in quest's giver cell should stop
            // glowing — the breadcrumb has done its job. Has to fire
            // AFTER saveRef.current is committed so the glow pass
            // sees the new turnedInQuests entry.
            refreshQuestGlow();
          }
          // Player-facing summary in the log strip. Format mirrors
          // the way combat reports loot: numbers prefixed with `+`,
          // items spelled out, all in one line so the log doesn't
          // flood.
          const parts: string[] = [];
          if (claim.gold > 0) parts.push(`+${claim.gold} gold`);
          if (claim.xp > 0) parts.push(`+${claim.xp} XP`);
          if (claim.items.length > 0) {
            parts.push(`items: ${claim.items.join(", ")}`);
          }
          const summary =
            parts.length > 0
              ? `Quest complete — ${claim.questName}. Rewards: ${parts.join(", ")}.`
              : `Quest complete — ${claim.questName}.`;
          setLogMessages((prev) => {
            const next = [...prev, summary];
            return next.length > MAX_LOG
              ? next.slice(next.length - MAX_LOG)
              : next;
          });
          // Big celebration — bigger placard, victory fanfare, wider
          // gold burst at the party. Fires AFTER state has been
          // committed so the queue's render sees the post-claim
          // state. Subtitle is the reward summary so the player sees
          // what they got without flipping to the log strip.
          fireQuestCelebration({
            kind: "quest",
            title: claim.questName,
            subtitle:
              parts.length > 0
                ? `Rewards: ${parts.join(", ")}`
                : "Rewards claimed",
          });
        }
      }
      return null;
    });
  }, [fireQuestCelebration, refreshQuestGlow]);

  // Render shells.
  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-parchment/55">Loading…</p>
      </main>
    );
  }
  if (state.kind === "no-save") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8">
        <p className="text-parchment/70">No save found.</p>
        <Link href="/play" className="text-ember underline">
          Back to title
        </Link>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8">
        <p className="text-red-300">Failed to load: {state.message}</p>
        <Link href="/play" className="text-parchment/70 underline">
          Back to title
        </Link>
      </main>
    );
  }

  return (
    // Fixed-viewport play frame — no browser-level scroll, ever. The
    // page is a 2-row grid: the canvas stage takes whatever vertical
    // space is left after the footer claims its single auto row, and
    // Phaser's Scale.FIT mode letterboxes the 960×720 game inside
    // whatever rectangle the stage cell ends up at.
    //
    // Why dvh + overflow-hidden instead of min-h-screen + scroll:
    //   - On a short window (or with the mobile address bar visible),
    //     `min-h-screen + flex` stacked padding + footer + a fixed-
    //     aspect 960×720 canvas above the fold, pushing the bottom
    //     log strip and the last row of tiles below the visible area.
    //     The user had to scroll the browser window to see them.
    //   - `h-dvh` is the *dynamic* viewport height — collapses with
    //     the mobile URL bar so we don't lose pixels when it shows,
    //     and grows back when it hides. Static `vh` would clip on
    //     mobile.
    //   - `overflow-hidden` on the outer main is a belt-and-braces
    //     guard against a future child overshooting. Modal overlays
    //     use `fixed inset-0` so they don't share this flow and stay
    //     unaffected.
    //
    // Scope: /play only. The editors live under app/editor/* with
    // their own h-full layout chain and aren't affected by this. */
    <main className="grid h-dvh w-screen grid-rows-[1fr_auto] overflow-hidden bg-[#0c0c14]">
      {/* Stage cell — flexible row. Houses the world canvas AND the
       *  combat canvas as absolutely-positioned siblings so toggling
       *  combat is a `display: none` swap rather than a layout shift.
       *  `min-h-0` is the CSS grid idiom for "this row may shrink
       *  below its content"; without it the row's auto size would
       *  push the footer off-screen on tight viewports.
       *
       *  The canvas wrappers themselves are intentionally bare —
       *  Phaser's Scale.FIT + CENTER_BOTH handles the letterboxing
       *  inside the cell, so any aspect-ratio styling on the
       *  wrappers would just fight the game's own scaling. */}
      <div className="relative min-h-0 overflow-hidden">
        {/* World canvas stays mounted under combat so re-rendering it
         *  on resolve doesn't require reloading + reseating sprites.
         *  We just hide it visually + gate movement via overlaysOpenRef.
         *  v1's 960×720 frame is preserved by Phaser internally; the
         *  wrapper just hands it an arbitrary-sized container to
         *  letterbox into. */}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden"
          style={{ display: combat ? "none" : "block" }}
        />

        {combat && state.save ? (
          <PlayCombatHost
          // Reseat the Phaser game per fight via React's key — every
          // new encounter gets a fresh CombatScene instance with the
          // right monster roster.
          key={`${combat.sourcePos.col},${combat.sourcePos.row}`}
          moduleId={state.save.moduleId}
          monsterIds={combat.monsters}
          // Prefer saveRef.current — it carries every per-step + Party
          // screen mutation (equip swaps, stash moves, effect toggles)
          // that the host deliberately keeps off state.save to avoid
          // forcing a Phaser remount. Without this, combat boots with
          // the pre-mutation snapshot and any post-combat sync writes
          // that stale equipment back over the player's swap.
          save={saveRef.current ?? state.save}
          // If the spawn / encounter authored a `custom_map`, resolve
          // it against the module's maps catalog and feed the
          // CombatScene a cropped 18×16 window of that authored grid.
          // Centering on the map's midpoint biases the action toward
          // the cosmetic centre of the authored arena (the source
          // cell coords are world coords — irrelevant once we've
          // swapped grids). Unknown ids and null fall through to the
          // default generic green-field arena.
          arenaCells={resolveCustomArenaCells(
            combat.customMapId,
            state.catalog?.allMaps ?? [],
          )}
          //
          // Darkness inherits from the *world renderer's current
          // lighting mode* at encounter time — the battle should
          // feel like a continuation of the map the party was on:
          //   - day  → bright battle
          //   - twilight / night → dark battle
          // Reading off the live renderer (rather than recomputing
          // from the clock here) means any future signal that
          // overrides the mode — e.g., interior maps authored as
          // always-dark — will propagate to combat automatically:
          // whatever the world view is showing is what the fight
          // shows. The arena map's own torches are decor only; they
          // never force darkness on.
          darkness={
            (rendererRef.current?.lightingMode ??
              lightingModeFromClock(clockMinutes)) !== "day"
          }
          // Race-derived infravision in combat. Always "armed" — the
          // combat scene's per-actor race check (e.g. dwarves) +
          // darkness gate produce the actual rendering: a dwarf's
          // turn during a night fight tints LOS cells red and lets
          // him target enemies on otherwise-invisible cells; humans
          // on the same turn-order see nothing extra. No effect in
          // daylight fights (darkness gate is false).
          partyInfravisionActive
          onResolved={onCombatResolved}
        />
      ) : null}
      </div>

      {/* Footer row — auto-sized, sits at the bottom of the dvh
       *  grid. Inline log + quest panels were removed and moved into
       *  dedicated inspector overlays opened by L and Q. The footer
       *  is the only persistent chrome below the canvas now. */}
      <footer className="flex-none px-3 py-1.5 text-center text-xs text-parchment/45">
        {combat
          ? "Combat resolves when one side falls."
          : "Arrow keys to move. Walking onto a link saves automatically."}
      </footer>

      {lockEncounter ? (
        <LockDialogOverlay
          options={lockEncounter}
          onPickLock={onPickLock}
          onCastKnock={onCastKnock}
          onClose={onLockClose}
        />
      ) : null}

      {chestEncounter && state.catalog ? (() => {
        // Resolve the chest record off the live catalog. A null
        // record means the chest id no longer exists (catalog edit
        // mid-session) — dismiss the dialog silently rather than
        // rendering a broken view.
        const chest = state.catalog.items.find(
          (i) => i.id === chestEncounter.chestId,
        );
        if (!chest) {
          setChestEncounter(null);
          return null;
        }
        // Pre-resolve per-item display data (name + icon stem) for
        // each line in the chest's contents so the dialog can paint
        // proper labels + sprites without itself reaching back into
        // the catalog.
        const itemDisplay = (chest.contents?.items ?? []).map((row) => {
          const def = state.catalog!.items.find((i) => i.id === row.id);
          return {
            id: row.id,
            name: def?.name,
            icon: def?.icon,
            qty: row.qty,
          };
        });
        const onOpen = () => {
          // Merge gold + items into the live save in one commit. We
          // read off `saveRef.current` (the kernel mutates it per
          // step; state.save lags by deliberate design — same
          // pattern PartyScreen + Combat + CounterShop use).
          const save = saveRef.current ?? state.save;
          if (!save) {
            setChestEncounter(null);
            return;
          }
          const goldGained = chest.contents?.gold ?? 0;
          let nextInventory = save.party.inventory.map((e) => ({ ...e }));
          for (const row of chest.contents?.items ?? []) {
            const qty = row.qty ?? 1;
            nextInventory = addToInventory(
              nextInventory,
              row.id,
              state.catalog!.items,
              qty,
            );
          }
          const nextSave = {
            ...save,
            party: {
              ...save.party,
              gold: (save.party.gold ?? 0) + goldGained,
              inventory: nextInventory,
            },
          };
          saveRef.current = nextSave;
          saveWorld(nextSave);
          // Treasure cue. Fires whether the chest had loot or was
          // empty — the lid-opening sound is the right ack for the
          // player's commit either way, and an empty chest is rare
          // enough that the player will read the dialog before they
          // click. Sfx.play silently no-ops if audio is muted or
          // unavailable, so no need to guard.
          Sfx.play("chest_open");
          // Clear the chest off the live grid via the kernel — this
          // also fires a `state` event so any downstream listeners
          // (visited-cells, glow refresh) see the change.
          simRef.current?.clearCellItem(
            chestEncounter.pos.col,
            chestEncounter.pos.row,
          );
          // Tear down the chest sprite overlay (the same item
          // overlay layer the normal item_picked path uses; the
          // bridge wraps the destroy + Map<col,row> bookkeeping).
          itemOverlayBridgeRef.current?.removeItem(
            chestEncounter.pos.col,
            chestEncounter.pos.row,
          );
          setChestEncounter(null);
        };
        const onLeave = () => {
          // No save mutation. The chest stays in place; the cell's
          // `item` is untouched. The player can come back later.
          setChestEncounter(null);
        };
        return (
          <ChestDialogOverlay
            chestName={chest.name ?? chest.id}
            chestIcon={chest.icon}
            contents={chest.contents}
            itemDisplay={itemDisplay}
            onOpen={onOpen}
            onLeave={onLeave}
          />
        );
      })() : null}

      {questOffer
        ? (
            <QuestDialogOverlay
              quest={questOffer.quest}
              alreadyAccepted={questOffer.alreadyAccepted}
              stepIdx={questOffer.stepIdx}
              stepCount={questOffer.stepCount}
              activeStepName={questOffer.activeStepName}
              activeStepDescription={questOffer.activeStepDescription}
              onAccept={onQuestAccept}
              onDecline={onQuestDecline}
            />
          )
        : null}

      {partyScreenOpen && state.save ? (
        <PlayPartyScreenOverlay
          moduleId={state.save.moduleId}
          // Read the LIVE save from saveRef rather than state.save.
          // saveCurrent updates saveRef every step but deliberately
          // does NOT setState (that would force the Phaser mount
          // effect to remount the whole scene per step → flicker).
          // The overlay only mounts on partyScreenOpen flipping
          // true; reading saveRef at that moment gives us the
          // fresh counters (Light duration, HP, MP) for free, and
          // once the screen is open the sim is paused so no further
          // ticks happen.
          save={saveRef.current ?? state.save}
          onClose={() => setPartyScreenOpen(false)}
          // Stash mutations from the Party screen (Use Torch, Send to
          // character, etc.) flow back here. Update saveRef.current so
          // any subsequent kernel write sees the post-mutation party,
          // persist the new value to localStorage, and refresh state.save
          // so the next render of the host (and any open overlays) sees
          // the freshly-mutated save without a reload.
          onMutateSave={(next) => {
            // Capture pre-mutation counters so we can detect Effect
            // toggles (Light spell, Torch, Infravision) and push the
            // change into the running sim — otherwise the kernel's
            // internal `this.party` keeps the old counter and the
            // lighting stays the same until the next map remount.
            const prev = saveRef.current;
            saveRef.current = next;
            saveWorld(next);
            // IMPORTANT: do NOT setState({save: next}) here. The
            // Phaser mount effect's dep list includes state.save —
            // pushing the updated save into React state caused it
            // to remount, which destroyed + recreated the running
            // game. When that happened inside a dungeon, the mount
            // re-spawned the party from `save.party.col/row`
            // (which still points at the overworld entrance, since
            // the dungeon position lives on
            // `save.party.currentDungeon`), so toggling Detect
            // Traps would teleport the party to the dungeon entrance
            // tile. saveRef + the explicit sim.castLightSpell /
            // setInfravisionActive calls below propagate everything
            // the gameplay surfaces care about; state.save stays
            // stable until a legitimate map / dungeon transition
            // bumps reloadKey.
            const sim = simRef.current;
            if (sim && prev) {
              // Cleric's Light spell — castLightSpell reseeds the
              // counter and re-renders lighting in one call. Passing
              // 0 turns the effect off.
              if (
                (next.party.magic_light_steps ?? 0) !==
                (prev.party.magic_light_steps ?? 0)
              ) {
                sim.castLightSpell(next.party.magic_light_steps ?? 0);
              }
              // Torch — also a party-level light source. Lighting a
              // torch (Use from the stash) or extinguishing one
              // (un-checking it in the Effects panel) lands here.
              // sim.lightTorch seeds torch_steps + triggers a
              // relight in one call.
              if (next.party.torch_steps !== prev.party.torch_steps) {
                sim.lightTorch(next.party.torch_steps);
              }
              // Infravision toggle. setInfravisionActive no-ops when
              // the value hasn't changed AND when no roster member has
              // the racial ability — so calling it unconditionally
              // here is safe.
              if (
                next.party.infravision_active !==
                prev.party.infravision_active
              ) {
                sim.setInfravisionActive(!!next.party.infravision_active);
              }
            }
            // Detect Traps toggle — refresh the red-X overlay layer.
            // refreshDetectedTraps reads `saveRef.current` (which we
            // just updated) to decide whether to paint or clear, and
            // pushes the current liveTrapsRef contents through the
            // bridge to the renderer.
            const prevDetect = !!prev?.party.party_effects?.includes(
              "detect_traps",
            );
            const nextDetect = !!next.party.party_effects?.includes(
              "detect_traps",
            );
            if (prevDetect !== nextDetect) {
              refreshDetectedTraps();
            }
          }}
          onSpellCast={(spellId) => {
            // Paint the spell's animation + play its SFX on the
            // party cell. The overlay is up so the player sees the
            // effect framing the world canvas behind the modal —
            // no need to dismiss the modal first. Wrapped in
            // try/catch so a disposed scene or unready audio
            // context can't bubble up and break the cast flow.
            const r = rendererRef.current;
            const sim = simRef.current;
            if (!r || !sim) return;
            const pos = sim.snapshot().pos;
            const px = pos.col * TILE_SIZE + TILE_SIZE / 2;
            const py = pos.row * TILE_SIZE + TILE_SIZE / 2;
            try {
              if (spellId === "light") {
                // Soft expanding gold ring — matches `buff_aura`
                // in the effect registry and the "Conjures a
                // radiant orb of divine light" flavor in the
                // catalog. Paired with a magic-burst chime so
                // there's an audible cue.
                void glowAura(r.scene, { x: px, y: py }, VFX_COLOURS.buff);
                Sfx.play("magic_burst");
              } else if (spellId === "heal" || spellId === "major_heal") {
                // Rising green sparkles + the dedicated heal SFX.
                // major_heal isn't party-castable today but we
                // tolerate it here so future spell additions
                // (mass_heal, etc.) Just Work without a code change.
                void healingSparkles(r.scene, { x: px, y: py });
                Sfx.play("heal");
              } else {
                // Unknown / unmapped spell — fall back to a generic
                // arcane radial so SOMETHING fires. Better than a
                // silent cast for spells the catalog adds later.
                void radialBurst(
                  r.scene,
                  { x: px, y: py },
                  VFX_COLOURS.arcane ?? 0xa0c8ff,
                );
                Sfx.play("magic_burst");
              }
            } catch {
              /* scene disposed / audio not ready — skip */
            }
          }}
          onItemUse={(itemId) => {
            // Mirror of onSpellCast for usable items. Same party-cell
            // pixel math, same try/catch so a disposed scene or
            // unready audio context can't bubble up. Today only
            // camping_supplies dispatches here; other items (Torch
            // etc.) succeed without a VFX/SFX cue.
            const r = rendererRef.current;
            const sim = simRef.current;
            if (!r || !sim) return;
            const pos = sim.snapshot().pos;
            const px = pos.col * TILE_SIZE + TILE_SIZE / 2;
            const py = pos.row * TILE_SIZE + TILE_SIZE / 2;
            try {
              if (itemId === "camping_supplies") {
                void campfireRest(r.scene, { x: px, y: py });
                Sfx.play("rest_complete");
              }
            } catch {
              /* scene disposed / audio not ready — skip */
            }
          }}
          onRaceAbilityFlash={(flash) => {
            // The Tinker / Craft happened inside the modal overlay;
            // the player needs an unmistakable confirmation that
            // something happened — a placard with the item name + a
            // matching SFX + a gold burst on the party tile.
            // `fireQuestCelebration` already handles all three: it
            // enqueues the placard, plays the kind-mapped SFX, and
            // spawns the gold burst on the party's current pixel
            // (via Phaser). Routing through it here keeps the
            // race / class-ability cue in lockstep with the rest of
            // the game's "you-just-did-something" feedback family.
            if (flash.kind === "tinker") {
              fireQuestCelebration({
                kind: "tinker",
                title: `${flash.memberName} tinkers`,
                subtitle: flash.itemName,
              });
            } else if (flash.kind === "craft") {
              // Title carries both the Ranger's name and the
              // ability variant ("Aldric • Craft Fire Arrows")
              // so the player sees WHICH craft fired in addition
              // to what came out of it. Subtitle includes the
              // bundle count (e.g. "Arrows ×20") so the payout
              // size is visible at a glance — matches the way
              // the shop call-out shows bundle quantities.
              const subtitle =
                flash.count > 1
                  ? `${flash.itemName} ×${flash.count}`
                  : flash.itemName;
              fireQuestCelebration({
                kind: "craft",
                title: `${flash.memberName} • ${flash.abilityName}`,
                subtitle,
              });
            } else if (flash.kind === "brew") {
              // Reuses the craft placard kind — structurally a brew
              // is the same beat as a craft (recipe in, finished
              // item out). Title names both the Alchemist and the
              // recipe so the player sees who did what; subtitle
              // is the produced potion's display name.
              fireQuestCelebration({
                kind: "craft",
                title: `${flash.memberName} • ${flash.recipeName}`,
                subtitle: flash.itemName,
              });
            }
          }}
        />
      ) : null}

      {/* Quest celebration placard — renders the head of the queue.
          The component fades itself in/out and calls onDismiss when
          done, at which point we shift the head off so the next
          enqueued placard (if any) gets its turn. */}
      {questCelebrations.length > 0 ? (
        <PlayQuestCelebration
          key={questCelebrations[0].key}
          kind={questCelebrations[0].kind}
          title={questCelebrations[0].title}
          subtitle={questCelebrations[0].subtitle}
          onDismiss={() =>
            setQuestCelebrations((prev) => prev.slice(1))
          }
        />
      ) : null}

      {/* Quest Log is painted inside the Phaser scene — see
          PaintedQuestLog and the questLogOpen sync effect that
          drives open(data) / close(). The boolean is still the
          source of truth for `overlaysOpenRef` and the inspector-key
          listener. Live save data is read from `saveRef.current` at
          open time, matching the pattern PartyScreen + Combat +
          CounterShop already use to bypass the stale React
          state.save during a long play session. */}

      {logOpen ? (
        <PlayLogOverlay
          messages={logMessages}
          onClose={() => setLogOpen(false)}
        />
      ) : null}

      {/* Help & Tips is painted inside the Phaser scene now — see
          PaintedHelpScreen and the sync effect that drives open/close
          off `helpTipsOpen`. No React modal lives at this spot
          anymore; the boolean is still the source of truth for
          `overlaysOpenRef` and the inspector-key listener. */}

      {npcDialogId && state.catalog ? (() => {
        const npc = state.catalog.npcs.find((n) => n.id === npcDialogId);
        if (!npc) {
          setNpcDialogId(null);
          return null;
        }
        const counterId = npc.counter;
        // Visit Counter is gated on the catalog actually containing
        // the named counter — bad data falls through to a missing-
        // button rather than a dead click.
        const hasCounter =
          !!counterId &&
          !!state.catalog.counters.find((c) => c.id === counterId);
        // Steal button — Halfling-only, once per NPC. The dialog
        // hides the button entirely (rather than greying it) when
        // unavailable, matching the action-menu convention.
        // Read the LIVE save from saveRef (state.save lags behind
        // quest / loot mutations that don't trigger setState) so
        // freshly-pickpocketed NPCs disappear the button correctly.
        const liveSave = saveRef.current ?? state.save;
        const stealAvailable =
          !!liveSave &&
          canPickpocket(liveSave, state.catalog.characters, npc.id);
        return (
          <PlayNpcDialogOverlay
            npcName={npc.name ?? npc.id}
            npcSprite={npc.sprite}
            dialogs={npc.dialogs ?? []}
            hasCounter={hasCounter}
            onVisitCounter={() => {
              if (!hasCounter || !counterId) return;
              // Hand the player to the counter overlay. Stamp the
              // current NPC id so the counter's close path can pop
              // back to the same dialog the player came from —
              // matches the player's expectation that Escape walks
              // up the dialog stack one level at a time (same model
              // as the character sheet → Party screen → world map).
              // Tile-walk-into-counter (line ~3285) skips this stamp
              // since there's no parent dialog to return to.
              setCounterReturnToNpcId(npcDialogId);
              setNpcDialogId(null);
              setCounterShopId(counterId);
            }}
            canSteal={stealAvailable}
            onSteal={() => {
              const save = saveRef.current;
              const catalog = catalogRef.current;
              if (!save || !catalog) return;
              // Capture pre-attempt totals so we can compute exactly
              // what was lifted (gold delta + new inventory row /
              // bumped stack) and surface it on the placard, without
              // re-parsing the helper's prose message.
              const prevGold = save.party.gold;
              const prevInvByItem = new Map(
                save.party.inventory.map(
                  (e) =>
                    [e.item, e.charges ?? 1] as const,
                ),
              );
              const result = attemptPickpocket(
                save,
                catalog.characters,
                catalog.items.map((i) => ({
                  id: i.id,
                  // PlayItem doesn't model `stackable` in its slim
                  // shape — widen the read so attemptPickpocket's
                  // stacking branch fires on the right items
                  // (Arrows, Lockpicks, etc.) just like the quest /
                  // shop paths do.
                  stackable: (i as { stackable?: boolean }).stackable,
                })),
                npc.id,
              );
              // Surface the outcome in the log regardless of
              // success — refusals ("already pickpocketed") are
              // information the player needs to see.
              setLogMessages((prev) => {
                const next = [...prev, result.message];
                return next.length > MAX_LOG
                  ? next.slice(next.length - MAX_LOG)
                  : next;
              });
              if (result.ok && result.nextSave) {
                saveWorld(result.nextSave);
                saveRef.current = result.nextSave;
                // Diff the new save against pre-attempt totals to
                // figure out what the helper actually awarded.
                // Gold delta wins when non-zero; otherwise scan
                // for the inventory row that gained a charge or
                // appeared fresh. Falls back to the helper's prose
                // message when neither lane changed (defensive —
                // shouldn't happen for an ok result).
                const goldDelta =
                  result.nextSave.party.gold - prevGold;
                let lootLabel = "";
                if (goldDelta > 0) {
                  lootLabel = `+${goldDelta} gold`;
                } else {
                  for (const row of result.nextSave.party.inventory) {
                    const prevQty = prevInvByItem.get(row.item) ?? 0;
                    const newQty = row.charges ?? 1;
                    if (newQty > prevQty) {
                      const def = catalog.items.find(
                        (i) => i.id === row.item,
                      );
                      lootLabel = def?.name ?? row.item;
                      break;
                    }
                  }
                }
                fireQuestCelebration({
                  kind: "pickpocket",
                  // Title is "Stole from {npc}" so the player sees
                  // both verbs in the placard's primary line.
                  title: `Stole from ${npc.name ?? npc.id}`,
                  // Subtitle is the loot — gold delta or item
                  // name. Empty subtitle falls through to a
                  // title-only placard (still informative; an
                  // unknown loot lane is rare).
                  subtitle: lootLabel || undefined,
                });
              }
              // Close the dialog on success so the player can see
              // the placard + log line without the modal in the way.
              // On refusal leave it open so they can read the NPC's
              // chatter or visit the counter.
              if (result.ok) setNpcDialogId(null);
            }}
            onClose={() => setNpcDialogId(null)}
          />
        );
      })() : null}

      {counterShopId && state.catalog && state.save ? (() => {
        const counter = state.catalog.counters.find(
          (c) => c.id === counterShopId,
        );
        if (!counter) {
          // Catalog disappeared between open + render (module
          // reload, defensive). Drop the overlay so the player
          // isn't stuck.
          setCounterShopId(null);
          return null;
        }
        // Peak HP/MP per character id — temple services (Heal All
        // HP, Restore All MP, Raise Dead) compare against these to
        // know whether each member has work to be done AND where to
        // clamp on apply. Source of truth is `save.party.members[].
        // max_hp / max_mp`: the load effect backfills those from
        // the catalog at first sight (line ~1273) and combat's
        // post-fight `applyMemberDeltas` keeps them current through
        // level-up bumps. The catalog characters themselves are NOT
        // a usable source — `loadCatalog` overwrites their `hp` /
        // `mp` fields with the SAVE'S LIVE values for the sim's
        // benefit, so reading `c.hp` here would (and did) yield the
        // current wounded value masquerading as a peak, collapsing
        // every `m.mp < max` check to `5 < 5` = false and greying
        // out Restore-All-MP even when the wizard clearly needed
        // restoration. Only fall back to the catalog (likely also
        // live by then) when the save predates the max_hp/max_mp
        // fields entirely.
        const maxHpById = new Map<string, number>();
        const maxMpById = new Map<string, number>();
        const memberNameById = new Map<string, string>();
        const catalogById = new Map(
          state.catalog.characters.map((c) => [c.id, c] as const),
        );
        for (const m of (saveRef.current ?? state.save).party.members) {
          const fallback = catalogById.get(m.id);
          const peakHp =
            typeof m.max_hp === "number"
              ? m.max_hp
              : typeof fallback?.hp === "number"
                ? fallback.hp
                : undefined;
          const peakMp =
            typeof m.max_mp === "number"
              ? m.max_mp
              : typeof fallback?.mp === "number"
                ? fallback.mp
                : undefined;
          if (typeof peakHp === "number") maxHpById.set(m.id, peakHp);
          if (typeof peakMp === "number") maxMpById.set(m.id, peakMp);
          // Display name for the temple counter's party panel.
          // Source of truth is the catalog character (`characters
          // .json`); custom characters carry their name on `m.custom`.
          const customName = (m.custom as { name?: string } | null)?.name;
          const name = customName ?? fallback?.name;
          if (typeof name === "string" && name.length > 0) {
            memberNameById.set(m.id, name);
          }
        }
        return (
          <PlayCounterShopOverlay
            counter={counter}
            save={saveRef.current ?? state.save}
            items={state.catalog.items}
            maxHpById={maxHpById}
            maxMpById={maxMpById}
            memberNameById={memberNameById}
            onMutateSave={(next) => {
              saveRef.current = next;
              saveWorld(next);
              // No setState here for the same reason
              // PlayPartyScreenOverlay omits it — the Phaser mount
              // effect depends on state.save, and re-running it
              // mid-shop would tear down the world canvas behind
              // the modal. The shop's own commit() pushes into its
              // liveSave so the UI updates immediately.
            }}
            onClose={() => {
              // Close the counter, then — if the player got here
              // via an NPC's Visit Counter button — re-open that
              // NPC's dialog. The id was captured at the moment we
              // opened the counter; clearing it here makes the
              // restore one-shot (a future Esc inside the
              // re-opened NPC dialog goes back to the map, not
              // back into the counter we just left).
              setCounterShopId(null);
              if (counterReturnToNpcId) {
                setNpcDialogId(counterReturnToNpcId);
                setCounterReturnToNpcId(null);
              }
            }}
          />
        );
      })() : null}
    </main>
  );
}

// ── Catalog loading ──────────────────────────────────────────────────

/** Load every catalog the kernel + scene need to render the saved
 *  current map. Throws on a missing map or unreadable module data so
 *  the host's error state surfaces the problem cleanly. */
async function loadCatalog(save: WorldSave): Promise<LoadedCatalog> {
  const src = new StaticModuleSource();
  const moduleId = save.moduleId;
  const [
    mapTilesLayers,
    mapsLayers,
    charactersLayers,
    racesLayers,
    classesLayers,
    effectsLayers,
    monstersLayers,
    encountersLayers,
    spawnsLayers,
    spellsLayers,
    itemsLayers,
    abilitiesLayers,
    recipesLayers,
    dungeonsLayers,
    questsLayers,
    npcsLayers,
    countersLayers,
  ] = await Promise.all([
    src.loadModelLayers(moduleId, "map_tiles"),
    src.loadModelLayers(moduleId, "maps"),
    src.loadModelLayers(moduleId, "characters").catch(() => null),
    src.loadModelLayers(moduleId, "races").catch(() => null),
    src.loadModelLayers(moduleId, "character_classes").catch(() => null),
    src.loadModelLayers(moduleId, "effects").catch(() => null),
    src.loadModelLayers(moduleId, "monsters").catch(() => null),
    src.loadModelLayers(moduleId, "encounters").catch(() => null),
    src.loadModelLayers(moduleId, "spawns").catch(() => null),
    src.loadModelLayers(moduleId, "spells").catch(() => null),
    src.loadModelLayers(moduleId, "items").catch(() => null),
    src.loadModelLayers(moduleId, "abilities").catch(() => null),
    src.loadModelLayers(moduleId, "recipes").catch(() => null),
    src.loadModelLayers(moduleId, "dungeons").catch(() => null),
    src.loadModelLayers(moduleId, "quests").catch(() => null),
    src.loadModelLayers(moduleId, "npcs").catch(() => null),
    src.loadModelLayers(moduleId, "counters").catch(() => null),
  ]);

  const paletteDoc = (mergeModel(
    "map_tiles",
    mapTilesLayers.inherited,
    mapTilesLayers.ownFile,
  ) ?? {}) as { map_tiles?: PlayCell[] };
  const palette = paletteDoc.map_tiles ?? [];

  // Prefer the localStorage draft of maps.json so unpublished edits
  // (renamed tiles, new soundtrack overrides, fresh paint) show up
  // in play without forcing a publish step. Mirrors the
  // draft-overlay pattern used by MapEditor itself.
  const mapsDraft = await loadDraft<Record<string, unknown>>(moduleId, "maps");
  const mapsOwn = mapsDraft ?? mapsLayers.ownFile;
  const mapsDoc = (mergeModel(
    "maps",
    mapsLayers.inherited,
    mapsOwn,
  ) ?? {}) as { maps?: PlayMapRecord[] };
  const allMaps = mapsDoc.maps ?? [];
  const mapId = save.party.currentMapId;
  const found = allMaps.find((m) => m.id === mapId);
  if (!found) {
    throw new Error(`Map "${mapId}" not found in module "${moduleId}".`);
  }
  // Cell hydration — string cells (legacy) and field-light objects
  // backfill from the palette. Mirrors MapEditor's load path so the
  // play side reads identical content.
  const paletteById = new Map(palette.map((t) => [t.id, t]));
  const grid: PlayCell[][] = found.grid.map((row) =>
    row.map((cell) => {
      const raw = cell as unknown;
      if (typeof raw === "string") {
        const tpl = paletteById.get(raw);
        return tpl ? { ...tpl } : ({ id: raw, walkable: true } as PlayCell);
      }
      const obj = raw as PlayCell;
      const tpl = paletteById.get(obj.id);
      return tpl ? { ...tpl, ...obj } : { ...obj };
    }),
  );
  const map: PlayMapRecord = { ...found, grid };

  // Custom characters from the save are merged into the catalog so
  // the kernel can resolve them by id alongside module-supplied ones.
  const charsDoc = (mergeModel(
    "characters",
    charactersLayers?.inherited ?? [],
    charactersLayers?.ownFile ?? null,
  ) ?? {}) as { characters?: SimCharacter[] };
  const moduleCharacters = charsDoc.characters ?? [];
  const customCharacters: SimCharacter[] = [];
  for (const m of save.party.members) {
    if (!m.custom) continue;
    // The CharacterRecord shape from the editor maps cleanly onto
    // SimCharacter — both share id/name/class/race/level/hp/mp/sprite
    // and the stat fields. Cast through unknown to bridge the
    // structural overlap without dragging in the editor's type.
    customCharacters.push(m.custom as unknown as SimCharacter);
  }
  const characters = [...moduleCharacters, ...customCharacters];
  // Apply the saved HP/MP/level onto each catalog character so a
  // player mid-adventure returns at the right health AND at the
  // right level. Level matters for the lock-dialog's Knock-spell
  // eligibility check (`m.level < spell.min_level`) — without this
  // sync a wizard who level-ups from L1 to L2+ in play would still
  // look L1 to `findKnockCaster` and the Cast Knock row would say
  // "no eligible caster" even with full MP. inventory + effects
  // tracked separately on SavedCharacterState — kernel doesn't yet
  // consume per-character runtime inventory, so we leave it on the
  // save for the future inventory UI.
  for (const m of save.party.members) {
    const c = characters.find((cc) => cc.id === m.id);
    if (!c) continue;
    c.hp = m.hp;
    c.mp = m.mp;
    if (typeof m.level === "number") c.level = m.level;
  }

  const racesDoc = (mergeModel(
    "races",
    racesLayers?.inherited ?? [],
    racesLayers?.ownFile ?? null,
  ) ?? {}) as { races?: SimRace[] };
  const classesDoc = (mergeModel(
    "character_classes",
    classesLayers?.inherited ?? [],
    classesLayers?.ownFile ?? null,
  ) ?? {}) as { character_classes?: SimCharacterClass[] };
  const effectsDoc = (mergeModel(
    "effects",
    effectsLayers?.inherited ?? [],
    effectsLayers?.ownFile ?? null,
  ) ?? {}) as { effects?: SimEffect[] };
  const monstersDoc = (mergeModel(
    "monsters",
    monstersLayers?.inherited ?? [],
    monstersLayers?.ownFile ?? null,
  ) ?? {}) as { monsters?: SimMonsterRef[] };
  const encountersDoc = (mergeModel(
    "encounters",
    encountersLayers?.inherited ?? [],
    encountersLayers?.ownFile ?? null,
  ) ?? {}) as { encounters?: SimEncounterRef[] };
  const spawnsDoc = (mergeModel(
    "spawns",
    spawnsLayers?.inherited ?? [],
    spawnsLayers?.ownFile ?? null,
  ) ?? {}) as { spawns?: SimSpawn[] };
  const spellsDoc = (mergeModel(
    "spells",
    spellsLayers?.inherited ?? [],
    spellsLayers?.ownFile ?? null,
  ) ?? {}) as { spells?: SimSpell[] };
  // Knock — the lock dialog's Cast Knock row needs the canonical
  // spell record. Looked up by id; falls back to action match for
  // modules that haven't standardised on "knock" as the spell id.
  const knockSpell =
    (spellsDoc.spells ?? []).find(
      (s) => s.id === "knock" || s.action === "knock",
    ) ?? null;
  // Items — only the id + icon are needed for cell.item overlay
  // resolution. The full item record (slots, durability, etc.) is
  // a v1battle concern handled by the combat seeder.
  const itemsDoc = (mergeModel(
    "items",
    itemsLayers?.inherited ?? [],
    itemsLayers?.ownFile ?? null,
  ) ?? {}) as { items?: PlayItem[] };
  // Abilities catalog — read by per-step passive helpers (Herbalism
  // today). Loose typing because each consumer reads its own
  // params subset; merging plus a graceful empty fallback so a thin
  // module without abilities still loads.
  const abilitiesDoc = (mergeModel(
    "abilities",
    abilitiesLayers?.inherited ?? [],
    abilitiesLayers?.ownFile ?? null,
  ) ?? {}) as {
    abilities?: Array<{
      id: string;
      name?: string;
      params?: Record<string, unknown> | null;
    }>;
  };
  // Recipes catalog — read by the Alchemist's brew_potion picker.
  // Same merge pattern as items / abilities; missing-module
  // tolerated (the picker just renders an empty list).
  const recipesDoc = (mergeModel(
    "recipes",
    recipesLayers?.inherited ?? [],
    recipesLayers?.ownFile ?? null,
  ) ?? {}) as {
    recipes?: Array<{
      id: string;
      name?: string;
      result_item: string;
      reagents: Record<string, number>;
    }>;
  };
  // Same draft-overlay treatment for dungeons so an unpublished
  // soundtrack / level edit shows up in play. DungeonsBrowse writes
  // drafts under the same model key.
  const dungeonsDraft = await loadDraft<Record<string, unknown>>(
    moduleId,
    "dungeons",
  );
  const dungeonsOwn = dungeonsDraft ?? dungeonsLayers?.ownFile ?? null;
  const dungeonsDoc = (mergeModel(
    "dungeons",
    dungeonsLayers?.inherited ?? [],
    dungeonsOwn,
  ) ?? {}) as { dungeons?: DungeonRecord[] };
  const questsDoc = (mergeModel(
    "quests",
    questsLayers?.inherited ?? [],
    questsLayers?.ownFile ?? null,
  ) ?? {}) as { quests?: SimQuestRef[] };
  // NPC catalog — the play scene paints `sprite` over any cell whose
  // `npc` field resolves here. Identity (id, name) carries through
  // for future dialog overlays. Loose typing because the underlying
  // record has more fields (counter, dialogs, etc.) that the
  // overlay doesn't read.
  const npcsDoc = (mergeModel(
    "npcs",
    npcsLayers?.inherited ?? [],
    npcsLayers?.ownFile ?? null,
  ) ?? {}) as { npcs?: PlayNpc[] };
  // Counters catalog — looked up by cell.counter or npc.counter at
  // counter_encountered / npc_encountered time. The play host
  // hands the matched record to PlayCounterShopOverlay.
  const countersDoc = (mergeModel(
    "counters",
    countersLayers?.inherited ?? [],
    countersLayers?.ownFile ?? null,
  ) ?? {}) as { counters?: PlayCounter[] };

  // Module manifest — pull the default soundtrack playlist, walking
  // the extends chain so a parent module's playlist propagates to
  // every child unless the child overrides. Leaf wins; first
  // non-empty list along the chain is the resolved value. Drafts
  // are preferred over on-disk files at each level so unpublished
  // edits also reach the player.
  let moduleSoundtrack: string[] = [];
  try {
    moduleSoundtrack = await src.resolveModuleSoundtrack(moduleId);
  } catch {
    // Silent — silence is a fine default if the manifest read fails.
  }

  return {
    map,
    allMaps,
    palette,
    characters,
    races: racesDoc.races ?? [],
    classes: classesDoc.character_classes ?? [],
    effects: effectsDoc.effects ?? [],
    monsters: monstersDoc.monsters ?? [],
    encounters: encountersDoc.encounters ?? [],
    spawns: spawnsDoc.spawns ?? [],
    dungeons: dungeonsDoc.dungeons ?? [],
    quests: questsDoc.quests ?? [],
    npcs: npcsDoc.npcs ?? [],
    counters: countersDoc.counters ?? [],
    knockSpell,
    items: itemsDoc.items ?? [],
    abilities: abilitiesDoc.abilities ?? [],
    recipes: recipesDoc.recipes ?? [],
    moduleSoundtrack,
  };
}

/** Map id treated as the project-wide fallback battle arena. Lives
 *  in the `default` module so every module inherits it through the
 *  extends chain. When a spawn / encounter doesn't author a
 *  `custom_map` — or authors an id that no longer resolves —
 *  resolveCustomArenaCells falls back to this map's grid instead of
 *  the combat scene's hard-coded green field. Authors can override
 *  by adding their own map with the same id higher in the chain. */
const DEFAULT_BATTLE_ARENA_ID = "default_battle_arena";

/**
 * Resolve a spawn / encounter's `custom_map` Map id to the
 * `arenaCells` matrix CombatScene consumes.
 *
 * Resolution order:
 *   1. Authored `custom_map` id, if set AND it resolves in the
 *      catalog. A set-but-unknown id falls through to step 2
 *      (typoed ids see the themed default arena rather than the
 *      engine's generic green field — friendlier than silently
 *      using the wrong terrain).
 *   2. The conventional `default_battle_arena` map id, which the
 *      `default` module ships and every other module inherits via
 *      the `extends` chain.
 *   3. `undefined` — the combat scene falls back to its built-in
 *      dark-green-fill arena. Only triggers when even the default
 *      module is missing the map (e.g. a stripped-down test
 *      module).
 *
 * `buildCustomArenaCells` places the source map's (0, 0) at arena
 * (1, 1) so the perimeter-wall ring the combat scene paints
 * unconditionally doesn't eat the map's leftmost column + topmost
 * row. Effective drawing canvas is the 16×14 interior.
 */
function resolveCustomArenaCells(
  customMapId: string | null,
  maps: ReadonlyArray<PlayMapRecord>,
):
  | ReadonlyArray<ReadonlyArray<ReturnType<typeof buildArenaCells>[number][number]>>
  | undefined {
  if (customMapId) {
    const map = maps.find((m) => m.id === customMapId);
    if (map) return buildCustomArenaCells(map.grid);
    // Authored id doesn't resolve — fall through to the default
    // arena below rather than silently using the engine's generic
    // green field. Typoed custom_map values still see a themed
    // arena, which makes the bug easier to spot too.
  }
  const fallback = maps.find((m) => m.id === DEFAULT_BATTLE_ARENA_ID);
  if (!fallback) return undefined;
  return buildCustomArenaCells(fallback.grid);
}


/**
 * Locate the (col, row) of a level's "stairs-down" cell — either
 * the standard stone stairs or the forest archway equivalent.
 * Returns null when the level doesn't carry one (e.g. the bottom
 * floor of a single-level dungeon, or one where the generator
 * placed the exit as an overworld archway). Used by the ascent
 * branch in `handleLinked` so going up from floor N lands the
 * party on floor N-1's stairs-down — i.e. the spot they descended
 * from — rather than the floor's entrance.
 */
function findStairsDownCell(
  level: DungeonLevel,
): { col: number; row: number } | null {
  for (let r = 0; r < level.tiles.length; r++) {
    const row = level.tiles[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const tid = row[c];
      if (tid === TILE_STAIRS_DOWN || tid === TILE_FOREST_ARCHWAY_DOWN) {
        return { col: c, row: r };
      }
    }
  }
  return null;
}

/**
 * Mirror an in-memory DungeonSession into the JSON-safe
 * SavedDungeonSession shape WorldSave expects. Flattens the levels'
 * internal Sets (openedChests, triggeredTraps, etc.) and every
 * floor's mutation Sets so the result round-trips through
 * localStorage cleanly. Pure — produces a fresh object.
 */
function snapshotDungeonForSave(
  session: ReturnType<typeof peekDungeonSession>,
) {
  if (!session) return null;
  const floors = Array.from(session.floors.entries()).map(
    ([floorIdx, state]) => ({
      floorIdx,
      state: {
        unlockedCells: Array.from(state.unlockedCells),
        defeatedEncounters: Array.from(state.defeatedEncounters),
        destroyedLairs: Array.from(state.destroyedLairs),
      },
    }),
  );
  return {
    dungeonId: session.dungeonId,
    seed: session.seed,
    levels: serialiseDungeonLevels(session.levels as unknown[]),
    floors,
  };
}

/**
 * Build the catalog the kernel should mount when the party is
 * inside a dungeon. Overlays the base (overworld) catalog with:
 *
 *   - `map` swapped for the current dungeon floor's synthetic map
 *     (built via `dungeonLevelToMap` from the generated DungeonLevel)
 *   - `allMaps` extended with that floor record so any inner lookup
 *     can find it by id
 *   - `spawns` zeroed — procedurally generated dungeons place their
 *     monsters as inline encounters, not as lairs
 *   - `encounters` extended with one synthetic SimEncounterRef per
 *     placed dungeon monster, sprite-resolved from the monsters
 *     catalog so the placed-encounter renderer draws the real
 *     creature instead of a red marker
 *
 * Pure — the dungeonStateRef is the caller's concern. The result is
 * a fresh LoadedCatalog object; the base is not mutated.
 */
function buildDungeonCatalog(
  baseCatalog: LoadedCatalog,
  dungeon: DungeonState,
): LoadedCatalog {
  const lvl = dungeon.levels[dungeon.floorIdx];
  const dungeonMap = dungeonLevelToMap(lvl, {
    dungeonId: dungeon.dungeonId,
    floorIdx: dungeon.floorIdx,
    totalFloors: dungeon.levels.length,
  });
  const spriteByMonsterId = new Map(
    baseCatalog.monsters.map((m) => [m.id, m.sprite]),
  );
  const dungeonEncs: SimEncounterRef[] = dungeonEncounterRefs(
    lvl,
    spriteByMonsterId,
  ).map((e) => ({
    id: e.id,
    name: e.name,
    monster_party_tile: e.monster_party_tile,
    monsters: e.monsters,
    // Preserve the per-entry tint so quest-target placements
    // arrive at the kernel + renderer with their gold halo intact.
    // A prior pass through this map() dropped the field silently,
    // which is why the halo never appeared.
    tint: e.tint,
  }));
  // The synthetic dungeon map record is structurally compatible with
  // PlayMapRecord — id / name / width / height / grid — and the cells
  // already carry the same shape PlayCell expects. Cast through to
  // satisfy the typed shell without dragging the DungeonMapCell type
  // into the overworld surface.
  const asPlayMap = dungeonMap as unknown as PlayMapRecord;
  return {
    ...baseCatalog,
    map: asPlayMap,
    allMaps: [...baseCatalog.allMaps, asPlayMap],
    spawns: [],
    encounters: [...baseCatalog.encounters, ...dungeonEncs],
  };
}

/**
 * Walk every accepted quest, find its active step, and increment
 * the per-quest progress counter when:
 *
 *   - the active step's `kind` is "kill"
 *   - the step's `params.monster_id` was one of the monsters in the
 *     just-resolved combat's roster
 *   - if the step pins `dungeon_id` / `dungeon_level`, we're in
 *     that dungeon on the matching floor
 *
 * Returns a fresh WorldSave with `questStepProgress` updated. When
 * no quest credit applies, returns the input save unchanged.
 *
 * Step indexing convention: `questStepProgress[id]` is the index of
 * the NEXT incomplete step (0 = first step pending, N = all done).
 */
function creditKillStep(
  save: WorldSave,
  combat: SpawnEncounterOptions | null,
  dungeon: DungeonState | null,
  quests: ReadonlyArray<SimQuestRef>,
): WorldSave {
  if (!combat || combat.monsters.length === 0) return save;
  const accepted = save.acceptedQuests ?? [];
  if (accepted.length === 0) return save;
  const monsterIdsInCombat = new Set(combat.monsters);
  const byId = new Map(quests.map((q) => [q.id, q]));
  const progress: Record<string, number> = {
    ...(save.questStepProgress ?? {}),
  };
  let changed = false;
  for (const questId of accepted) {
    const quest = byId.get(questId);
    if (!quest) continue;
    const steps =
      (quest as unknown as {
        steps?: ReadonlyArray<{
          kind?: string;
          params?: { monster_id?: string; count?: number } | null;
          dungeon_id?: string;
          dungeon_level?: number;
        }>;
      }).steps ?? [];
    const activeIdx = progress[questId] ?? 0;
    const step = steps[activeIdx];
    if (!step || step.kind !== "kill") continue;
    const targetMonsterId = step.params?.monster_id;
    if (!targetMonsterId) continue;
    if (!monsterIdsInCombat.has(targetMonsterId)) continue;
    // Dungeon-pinned steps only credit when we're in the right
    // dungeon and floor. Steps without dungeon_id credit anywhere.
    if (step.dungeon_id) {
      if (!dungeon || dungeon.dungeonId !== step.dungeon_id) continue;
      if (typeof step.dungeon_level === "number") {
        const expectedFloorIdx = Math.max(0, step.dungeon_level - 1);
        if (dungeon.floorIdx !== expectedFloorIdx) continue;
      }
    }
    progress[questId] = activeIdx + 1;
    changed = true;
  }
  if (!changed) return save;
  return { ...save, questStepProgress: progress };
}

// `renderQuestLog` used to be defined here for the inline quest log
// strip. That UI moved into PlayQuestLogOverlay (Q-key inspector), so
// the inline helper is no longer reachable.

// Reference to silence "unused" lints — keeps the SavedCharacterState
// import expressive in the source even though we don't reference it
// after the loader pulls it through type widening above.
type _SavedCharacterStateBridge = CharacterRecord;
