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
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { LockDialogOverlay } from "@/editor/LockDialogOverlay";
import { QuestDialogOverlay } from "@/editor/QuestDialogOverlay";
import type { CombatResolved } from "@/battle/scenes/CombatScene";
import { PlayCombatHost } from "./PlayCombatHost";
import { buildArenaCells } from "@/play/buildArenaCells";
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
import { tintForCell } from "@/sim/lighting";
import { TILE_SIZE, WorldRenderer } from "@/sim/scene/WorldRenderer";
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

/** How many log lines the in-world message strip retains. Larger
 *  values cost rendering for marginal value — players read the bottom
 *  3-4 lines, not the back-buffer. */
const MAX_LOG = 6;

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
import { loadWorld, saveWorld } from "@/play/save";
import { applyCombatResultToSave } from "@/play/syncFromBattle";
import type { WorldSave } from "@/play/saveTypes";
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
}

/** Minimal item shape PlayHost uses to render overlays. The full
 *  v2 item record carries more (slots, durability, buy/sell, etc.);
 *  only the icon is read here. */
interface PlayItem {
  id: string;
  icon?: string;
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
  /** Authored quests catalog. Cells carrying a `quest` id match
   *  against this; on step the sim emits `quest_encountered` and
   *  the host opens the offer dialog. */
  quests: SimQuestRef[];
  knockSpell: SimSpell | null;
  /** Items catalog — used to resolve `cell.item` overlays to their
   *  icon sprite (`item/<icon>.png`). Kernel doesn't read this
   *  directly; it's a scene-render concern. */
  items: PlayItem[];
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
  /** Quest-offer state — set on `quest_encountered`, cleared when the
   *  player Accepts or Declines via the overlay. Movement gates on
   *  this through overlaysOpenRef so a chained step doesn't slip past
   *  the dialog. */
  const [questOffer, setQuestOffer] = useState<SimQuestRef | null>(null);
  /** Active combat — set on `spawn_encountered`, cleared when the
   *  combat scene reports back via `onResolved`. While set the world
   *  Phaser game is unmounted and PlayCombatHost takes its place. */
  const [combat, setCombat] = useState<SpawnEncounterOptions | null>(null);
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
  useEffect(() => {
    // Lock dialog, quest offer, AND active combat each gate keyboard
    // movement through the same ref so the world sim freezes under
    // any of them.
    overlaysOpenRef.current =
      !!lockEncounter || !!combat || !!questOffer;
  }, [lockEncounter, combat, questOffer]);
  useEffect(() => {
    combatRef.current = combat;
  }, [combat]);
  useEffect(() => {
    catalogRef.current = state.catalog ?? null;
  }, [state.catalog]);

  // Load save + catalogs + map. Re-runs when `reloadKey` bumps.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const save = loadWorld();
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
      const next: WorldSave = {
        ...save,
        clockMinutes: clockRef.current,
        party: {
          ...save.party,
          currentDungeon: {
            dungeonId: dungeonNow.dungeonId,
            floorIdx: dungeonNow.floorIdx,
            col: sim.snapshot().pos.col,
            row: sim.snapshot().pos.row,
            returnTo: dungeonNow.returnTo,
          },
        },
        dungeons: snapshot
          ? { ...save.dungeons, [dungeonNow.dungeonId]: snapshot }
          : save.dungeons,
      };
      saveWorld(next);
      saveRef.current = next;
      return;
    }
    const snap = sim.snapshot();
    // Per-map mutations for the current map.
    // Boat positions serialise to a plain Record for JSON-safety.
    // The kernel's snapshot exposes them as a ReadonlyMap; we
    // flatten to { "col,row": sprite } so the save can round-trip
    // through JSON.parse/stringify without any custom revivers.
    const boatPositionsObj: Record<string, string> = {};
    for (const [key, sprite] of snap.boatPositions) {
      boatPositionsObj[key] = sprite;
    }
    const mapState = {
      unlockedCells: Array.from(snap.unlockedCells),
      defeatedEncounters: Array.from(snap.defeatedEncounters),
      destroyedLairs: Array.from(snap.destroyedLairs),
      boatPositions: boatPositionsObj,
    };
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
        galadriels_light_steps: snap.party.galadriels_light_steps,
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

      // Viewport: a fixed window centered on the party rather than
      // the full map blown out to the page. The Phaser canvas stays
      // at this size; the camera scrolls within the map's bounds as
      // the party walks. Capped to the map's actual dimensions so a
      // 16×16 building doesn't render black bars to the right /
      // bottom.
      //
      // 19×15 is a reasonable "around the party" frame — wide enough
      // to read context (a few tiles in every direction), tight
      // enough that the party doesn't get lost in a vast canvas.
      const VIEWPORT_COLS = 19;
      const VIEWPORT_ROWS = 15;
      const mapPixelWidth = catalog.map.width * TILE_SIZE;
      const mapPixelHeight = catalog.map.height * TILE_SIZE;
      const width = Math.min(VIEWPORT_COLS * TILE_SIZE, mapPixelWidth);
      const height = Math.min(VIEWPORT_ROWS * TILE_SIZE, mapPixelHeight);

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
        /** Cells currently rendering a boat texture — keyed "col,row",
         *  value is the boat's sprite key. The map cell IS the boat:
         *  setBoatPositions diffs this against the kernel's live boat
         *  list and swaps each cell's texture between water (the
         *  party just boarded it) and the boat sprite (a boat is
         *  parked there). Initial state captured during the scene's
         *  create() pass from cells whose `boat` field is true. */
        boatTextures: Map<string, string> = new Map();
        /** Single Image that follows the party while they're aboard.
         *  Depth 300 matches the party sprite — when this is visible
         *  the partySprite is hidden, so the boat visually IS the
         *  party. Bobs gently via a perpetual sin-wave tween. Null
         *  while the party is on land. */
        partyBoatSprite: Phaser.GameObjects.Image | null = null;
        constructor() {
          super("PlayScene");
        }
        preload() {
          for (const key of spriteKeys) {
            this.load.image(key, withBasePath(`/sprites/${key}`));
          }
        }
        create() {
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
            // the rest stays in shadow. The overworld inherits the
            // saved clock as before.
            initialLightingMode: dungeonStateRef.current
              ? "night"
              : lightingModeFromClock(save.clockMinutes),
            initialInfravisionActive: !!save.party.infravision_active,
            // Tint item overlays in sync with the floor cell they
            // sit on so a sword on a dim corridor reads dim too,
            // and so they pick up infravision red when relevant.
            onRelight: (result) => {
              for (const [key, img] of this.itemOverlays) {
                const [cs, rs] = key.split(",");
                const t = tintForCell(result, Number(cs), Number(rs));
                if (t.mode === "clear") img.clearTint();
                else img.setTint(t.value);
              }
              for (const [key, img] of this.questOverlays) {
                const [cs, rs] = key.split(",");
                const t = tintForCell(result, Number(cs), Number(rs));
                if (t.mode === "clear") img.clearTint();
                else img.setTint(t.value);
              }
            },
          });
          rendererRef.current = this.world;
          this.world.ensureParticleTexture();
          this.world.createCells();
          this.world.createEmitters();

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

          // Item overlays — one Image per cell whose `item` resolves
          // to a known icon. Authored via the editor's per-cell
          // `item` field; the icon comes from items.json. Sized at
          // 70% of the tile so the floor underneath is still visible
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

          this.world.relight();
          this.mountSim();

          // Lock the camera into a fixed viewport that follows the
          // party. Bounds clamp scrolling to the map's pixel extent
          // so we don't pan past the edge into the background. Lerp
          // = 1 means the camera snaps; a smaller value would ease
          // into position over a few frames, but combat / overworld
          // movement reads cleaner without the lag. roundPixels
          // keeps the pixel-art alignment sharp.
          if (this.world.partySprite) {
            this.cameras.main.setBounds(
              0,
              0,
              mapPixelWidth,
              mapPixelHeight,
            );
            this.cameras.main.setRoundPixels(true);
            this.cameras.main.startFollow(this.world.partySprite, true);
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
            galadriels_light_steps: save.party.galadriels_light_steps,
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
              // Cells that lost their boat (party boarded here) →
              // back to the water sprite.
              for (const [key] of scene.boatTextures) {
                if (wanted.has(key)) continue;
                const baseImg = renderer.cells.get(key);
                if (
                  baseImg &&
                  waterSprite &&
                  scene.textures.exists(waterSprite)
                ) {
                  baseImg.setTexture(waterSprite);
                }
                scene.boatTextures.delete(key);
              }
              // Cells that gained a boat (disembarked here, or first
              // boot from a save where the party left a boat behind).
              for (const [key, sprite] of wanted) {
                if (scene.boatTextures.get(key) === sprite) continue;
                const baseImg = renderer.cells.get(key);
                if (
                  baseImg &&
                  sprite &&
                  scene.textures.exists(sprite)
                ) {
                  baseImg.setTexture(sprite);
                }
                scene.boatTextures.set(key, sprite);
              }
            },
            setPartyBoatAt: (col, row, visible, sprite) => {
              const scene = this;
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
            initialOnBoat: save.party.onBoat,
            initialCurrentBoatSprite: save.party.currentBoatSprite,
          });
          simRef.current = sim;

          sim.subscribe((ev) => {
            if (ev.kind === "moved") {
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
              if (
                afterMode !== beforeMode &&
                !dungeonStateRef.current
              ) {
                // Suspended in dungeons — every dungeon floor stays
                // in "night" mode regardless of the world clock so
                // torch pools paint correctly.
                rendererRef.current?.setLightingMode(afterMode);
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
            if (ev.kind === "lock_encountered") {
              setLockEncounter(ev.options);
              return;
            }
            if (ev.kind === "quest_encountered") {
              setQuestOffer(ev.quest);
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
                }
              }
              return;
            }
            if (
              ev.kind === "npc_encountered" ||
              ev.kind === "counter_encountered"
            ) {
              // NPC + shop dialog routing arrives in Phase 4 polish.
              // For now, log so a tester knows the event fired.
              // eslint-disable-next-line no-console
              console.info(`[play] ${ev.kind}`, ev);
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
        // landing cell, not the source one.
        sim?.teleport(link.x, link.y);
        // Update save with the post-teleport position.
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
            },
          };
          saveWorld(next);
          saveRef.current = next;
        }
        return;
      }
      // Cross-map link — snapshot the current map's mutations under
      // its key, advance currentMapId + position, save, remount.
      const snap = sim?.snapshot();
      const mapState = snap
        ? {
            unlockedCells: Array.from(snap.unlockedCells),
            defeatedEncounters: Array.from(snap.defeatedEncounters),
            destroyedLairs: Array.from(snap.destroyedLairs),
          }
        : { unlockedCells: [], defeatedEncounters: [], destroyedLairs: [] };
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
   *  trigger tile stops re-offering) and persist into the save. */
  const onQuestAccept = useCallback(() => {
    setQuestOffer((current) => {
      if (!current) return null;
      const sim = simRef.current;
      const newlyAccepted = sim?.markQuestAccepted(current.id) ?? false;
      if (newlyAccepted) {
        const save = saveRef.current;
        if (save) {
          const prev = save.acceptedQuests ?? [];
          if (!prev.includes(current.id)) {
            const nextSave: WorldSave = {
              ...save,
              acceptedQuests: [...prev, current.id],
            };
            saveWorld(nextSave);
            saveRef.current = nextSave;
          }
        }
      }
      return null;
    });
  }, []);

  /** Quest decline — close the overlay without flipping the
   *  accepted-quest set. Re-stepping the trigger cell will re-offer.
   *  We intentionally don't write to the save here; declining is a
   *  transient choice. */
  const onQuestDecline = useCallback(() => {
    setQuestOffer(null);
  }, []);

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
    <main className="flex min-h-screen flex-col items-center gap-3 p-4">
      <header className="flex w-full max-w-5xl items-center justify-between">
        <div>
          <span className="font-display text-lg text-parchment">
            {state.save?.moduleId}
          </span>
          <span className="ml-3 text-xs text-parchment/55">
            on {state.save?.party.currentMapId}
          </span>
        </div>
        {/* Date / time / moon phase. Advances per step via the
         *  `moved` event handler. Hidden during combat — the combat
         *  scene runs on its own time. */}
        {!combat ? (
          <div className="text-xs text-parchment/75">
            <span className="font-mono">{fullStr({ totalMinutes: clockMinutes })}</span>
            <span className="ml-3 text-parchment/55">
              · {lunarPhaseName({ totalMinutes: clockMinutes })}
            </span>
          </div>
        ) : null}
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              saveCurrent();
              router.push("/play");
            }}
            className="rounded border border-parchment/30 px-3 py-1 text-parchment/80 hover:bg-ink/50"
          >
            Save & Quit
          </button>
        </div>
      </header>

      {/* World canvas stays mounted under combat so re-rendering it
       *  on resolve doesn't require reloading + reseating sprites.
       *  We just hide it visually + gate movement via overlaysOpenRef. */}
      <div
        ref={containerRef}
        className="rounded border border-parchment/20 bg-ink/80 shadow-xl"
        style={{
          display: combat ? "none" : "inline-block",
        }}
      />

      {combat && state.save ? (
        <PlayCombatHost
          // Reseat the Phaser game per fight via React's key — every
          // new encounter gets a fresh CombatScene instance with the
          // right monster roster.
          key={`${combat.sourcePos.col},${combat.sourcePos.row}`}
          moduleId={state.save.moduleId}
          monsterIds={combat.monsters}
          save={state.save}
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

      {/* In-world message log. Surfaces text-on-step + the kernel's
       *  narrated events (locks, links, edge of map, boss approach).
       *  Hidden during combat — the combat scene has its own log. */}
      {!combat && logMessages.length > 0 ? (
        <div className="w-full max-w-5xl rounded border border-parchment/15 bg-ink/60 p-2 font-mono text-xs leading-snug text-parchment/70">
          {logMessages.map((msg, i) => (
            <div key={`${i}-${msg}`}>{msg}</div>
          ))}
        </div>
      ) : null}

      {/* Quest log — every accepted quest's name + the active
       *  step's name + description, or a "Complete" badge when all
       *  steps are done. Hidden during combat. Step progress reads
       *  off save.questStepProgress (kill steps advance on combat
       *  victory against the target monster). */}
      {!combat && state.catalog && state.save?.acceptedQuests
        ? renderQuestLog(
            state.catalog.quests,
            state.save.acceptedQuests,
            state.save.questStepProgress ?? {},
          )
        : null}
      <footer className="text-xs text-parchment/45">
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

      {questOffer
        ? renderQuestOffer({
            quest: questOffer,
            save: state.save ?? null,
            onAccept: onQuestAccept,
            onDecline: onQuestDecline,
          })
        : null}
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
    dungeonsLayers,
    questsLayers,
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
    src.loadModelLayers(moduleId, "dungeons").catch(() => null),
    src.loadModelLayers(moduleId, "quests").catch(() => null),
  ]);

  const paletteDoc = (mergeModel(
    "map_tiles",
    mapTilesLayers.inherited,
    mapTilesLayers.ownFile,
  ) ?? {}) as { map_tiles?: PlayCell[] };
  const palette = paletteDoc.map_tiles ?? [];

  const mapsDoc = (mergeModel(
    "maps",
    mapsLayers.inherited,
    mapsLayers.ownFile,
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
  // Apply the saved HP/MP onto each catalog character so a player
  // mid-adventure returns at the right health. inventory + effects
  // tracked separately on SavedCharacterState — kernel doesn't yet
  // consume per-character runtime inventory, so we leave it on the
  // save for the future inventory UI.
  for (const m of save.party.members) {
    const c = characters.find((cc) => cc.id === m.id);
    if (!c) continue;
    c.hp = m.hp;
    c.mp = m.mp;
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
  const dungeonsDoc = (mergeModel(
    "dungeons",
    dungeonsLayers?.inherited ?? [],
    dungeonsLayers?.ownFile ?? null,
  ) ?? {}) as { dungeons?: DungeonRecord[] };
  const questsDoc = (mergeModel(
    "quests",
    questsLayers?.inherited ?? [],
    questsLayers?.ownFile ?? null,
  ) ?? {}) as { quests?: SimQuestRef[] };

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
    knockSpell,
    items: itemsDoc.items ?? [],
  };
}

/**
 * Resolve a spawn / encounter's `custom_map` Map id to the
 * `arenaCells` matrix CombatScene consumes, or `undefined` when the
 * id is null / unknown (so the scene falls back to the generic
 * green-field arena).
 *
 * The custom map IS the arena, so we crop its grid centered on its
 * own midpoint rather than around any world coord. Smaller-than-18×16
 * maps null-pad at the edges via buildArenaCells's normal behavior.
 */
function resolveCustomArenaCells(
  customMapId: string | null,
  maps: ReadonlyArray<PlayMapRecord>,
):
  | ReadonlyArray<ReadonlyArray<ReturnType<typeof buildArenaCells>[number][number]>>
  | undefined {
  if (!customMapId) return undefined;
  const map = maps.find((m) => m.id === customMapId);
  if (!map) return undefined;
  const centerCol = Math.floor((map.width || map.grid[0]?.length || 0) / 2);
  const centerRow = Math.floor((map.height || map.grid.length) / 2);
  return buildArenaCells(map.grid, centerCol, centerRow);
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
 * Render the QuestDialogOverlay with the right step props pulled
 * off the save. The accept / progress / complete states drive
 * different copy in the overlay; this helper centralises the
 * "compute step idx + active step name/description from raw
 * quest record" plumbing so the JSX site stays compact.
 */
function renderQuestOffer({
  quest,
  save,
  onAccept,
  onDecline,
}: {
  quest: SimQuestRef;
  save: WorldSave | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const accepted = save?.acceptedQuests?.includes(quest.id) ?? false;
  const steps =
    (quest as unknown as {
      steps?: ReadonlyArray<{ name?: string; description?: string }>;
    }).steps ?? [];
  const stepIdx = save?.questStepProgress?.[quest.id] ?? 0;
  const stepCount = steps.length;
  const active = stepIdx < stepCount ? steps[stepIdx] : undefined;
  return (
    <QuestDialogOverlay
      quest={quest}
      alreadyAccepted={accepted}
      stepIdx={stepIdx}
      stepCount={stepCount}
      activeStepName={active?.name}
      activeStepDescription={active?.description}
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
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

/**
 * Render the quest-log strip — one row per accepted quest with the
 * quest name and the active step's name + description. Currently
 * "active step" is always step 0; once step completion lands the
 * per-quest progress lookup will drive the index.
 *
 * Returns null when the player has no accepted quests so the panel
 * doesn't render an empty box.
 */
function renderQuestLog(
  catalogQuests: ReadonlyArray<SimQuestRef>,
  accepted: ReadonlyArray<string>,
  progress: Readonly<Record<string, number>>,
) {
  if (accepted.length === 0) return null;
  const byId = new Map(catalogQuests.map((q) => [q.id, q]));
  const rows = accepted
    .map((id) => byId.get(id))
    .filter((q): q is SimQuestRef => !!q);
  if (rows.length === 0) return null;
  return (
    <aside className="w-full max-w-5xl rounded border border-parchment/15 bg-ink/60 p-3 text-xs text-parchment/80">
      <header className="mb-2 text-[10px] uppercase tracking-wide text-parchment/45">
        Quest Log
      </header>
      <ul className="space-y-2">
        {rows.map((q) => {
          const steps =
            (q as unknown as {
              steps?: ReadonlyArray<{
                name?: string;
                description?: string;
              }>;
            }).steps ?? [];
          const stepIdx = progress[q.id] ?? 0;
          const stepCount = steps.length;
          const complete = stepCount > 0 && stepIdx >= stepCount;
          const active = !complete ? steps[stepIdx] : undefined;
          return (
            <li key={q.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-parchment">{q.name}</span>
                <span
                  className={`font-mono text-[10px] ${
                    complete ? "text-emerald-300" : "text-parchment/50"
                  }`}
                >
                  {complete
                    ? "Complete"
                    : `${stepIdx}/${stepCount} done`}
                </span>
              </div>
              {active?.name ? (
                <div className="text-[11px] text-parchment/70">
                  → {active.name}
                </div>
              ) : null}
              {active?.description ? (
                <div className="text-[11px] italic text-parchment/55">
                  {active.description}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// Reference to silence "unused" lints — keeps the SavedCharacterState
// import expressive in the source even though we don't reference it
// after the loader pulls it through type widening above.
type _SavedCharacterStateBridge = CharacterRecord;
