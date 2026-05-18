"use client";

/**
 * Phase 2a map editor — Phaser-based canvas painting with a Tile
 * Palette side panel and a grid-lines toggle. Bare workflow:
 *
 *   - Loads palette + map via the existing draft-aware source.
 *   - Mounts a Phaser scene that renders one Image per cell using
 *     palette sprites loaded as textures keyed by tile id.
 *   - Click + drag on the canvas to paint with the active brush.
 *   - Paint events update React's ownDraft (saved to localStorage)
 *     and the scene patches the affected cell in-place via
 *     setTexture — no full re-render.
 *
 * Phaser is dynamically-imported so its ~1MB bundle only loads when
 * the editor mounts; the rest of the app stays light.
 *
 * Bridges between React and Phaser:
 *   - brushRef.current — the active brush tile id (React state mirrored
 *     into a ref the scene's pointer handler reads).
 *   - gridRef.current — the live grid (2D array of tile ids); the scene
 *     mutates it on paint, React reads it to persist.
 *   - persistRef.current — function the scene calls after a paint to
 *     save the draft. Wrapped in a ref so the scene always sees the
 *     latest closure.
 *
 * Future phases add: cell inspector, links, paint tools (bucket /
 * rectangle), zoom/pan, walkable overlay, undo/redo.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  discardDraft,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { withBasePath } from "@/util/basePath";
import { publishItems } from "@/data_model/publishClient";
import { MapSimulation, type SceneBridge } from "@/sim/MapSimulation";
import {
  computeLighting,
  emitterVisibleAt,
  tintForCell,
} from "@/sim/lighting";
import { SimPanel } from "@/sim/SimPanel";
import { ANIMATION_CONFIGS } from "@/sim/tileAnimations";
import type { AnimationKind } from "@/sim/tileAnimations";
import { MapPartyScreenOverlay } from "./MapPartyScreenOverlay";
import { NpcDialogOverlay } from "./NpcDialogOverlay";
import { CounterShopOverlay } from "./CounterShopOverlay";
import { LockDialogOverlay } from "./LockDialogOverlay";
import { SpawnEncounterOverlay } from "./SpawnEncounterOverlay";
import type {
  LockEncounterOptions,
  SpawnEncounterOptions,
} from "@/sim/MapSimulation";
import type { SimSpawn } from "@/sim/spawn";
import type {
  SimCharacter,
  SimCharacterClass,
  SimEffect,
  SimGrid,
  SimLightSource,
  SimMonsterRef,
  SimParty,
  SimRace,
  SimSpell,
} from "@/sim/types";
import { usePublishServer } from "./usePublishServer";

const TILE_SIZE = 32;
const MODEL_KEY = "maps";

interface TileType {
  id: string;
  name: string;
  /** Optional grouping label used by the Map Editor's palette panel
   *  to organize tiles into collapsible folders. Empty string =
   *  untagged (lands in the "(untagged)" bucket). Purely an editor
   *  organizational hint — gameplay never reads it. */
  tag: string;
  walkable: boolean;
  /** True = tile blocks light effects and ranged-weapon line-of-sight.
   *  Walls/mountains obstruct; water and short obstacles typically don't. */
  obstructs: boolean;
  /** True = this tile IS a boat. Stepping onto it lets the party move
   *  through water tiles (the tile effectively becomes the vessel).
   *  Not "passable by boat" — that distinction is a tile being water,
   *  which is conveyed by the tile's other gameplay attributes. */
  boat: boolean;
  /** True = passage/interaction is gated until unlocked (key, scripted
   *  unlock, etc.). Pairs with link or interactive tile types. */
  locked: boolean;
  /** True = the tile emits light. */
  light_source: boolean;
  /** Light emission radius in cells. Only meaningful when
   *  light_source is true. */
  light_range: number;
  /** Narrative text shown in-game when the party steps on a cell
   *  painted with this tile. Empty string = silent. Drives signs,
   *  scripted callouts, and similar v1-style on-step messages. */
  text: string;
  /** Visual animation overlay played on cells painted with this tile.
   *  "none" disables. Configs live in ANIMATION_CONFIGS in MapEditor. */
  animation: "none" | "torch" | "fire" | "fairy" | "smoke";
  /** Counter (shop/service) id from counters.json that this tile
   *  fronts. Empty string means none. */
  counter: string;
  /** Encounter id from encounters.json. Empty string means none.
   *  The encounter's monster_party_tile renders as an overlay on the cell. */
  encounter: string;
  /** Spawn id from spawns.json (monster-lair behavior). Empty for none. */
  spawn: string;
  /** Item id from items.json. Empty for none. When set, the item's
   *  icon renders as an overlay sprite on the cell (layered graphic),
   *  and gameplay drops it when the party steps on the cell. */
  item: string;
  /** Quest id reference — placeholder; the quest model is not yet
   *  ported. Stored verbatim so future ports preserve author intent. */
  quest: string;
  /** Dungeon id reference — placeholder; the dungeon model is not yet
   *  ported. Stored verbatim so future ports preserve author intent. */
  dungeon: string;
  /** NPC id from npcs.json. Empty string means none. When set, the
   *  NPC's sprite renders as an overlay on the cell so designers can
   *  see at a glance where each villager / quest-giver stands. */
  npc: string;
  sprite: string;
  flags?: Record<string, unknown>;
  link?: { map_id: string; x: number; y: number } | null;
}

interface RefRecord {
  id: string;
  name?: string;
  [k: string]: unknown;
}
interface EncounterRecord extends RefRecord {
  monster_party_tile?: string;
  /** Monster ids in this encounter's roster — read by the quest-glow
   *  detector so a cell whose encounter contains a quest-relevant
   *  monster gets the same halo as a directly-referenced encounter. */
  monsters?: string[];
}
/** Item record from items.json — `icon` is a bare sprite name that
 *  resolves to `item/${icon}.png` for overlay rendering. */
interface ItemRecord extends RefRecord {
  icon?: string;
  category?: string;
}
/** NPC record from npcs.json — only the fields the map editor needs.
 *  `sprite` follows the standard person/<file>.png path so we can
 *  resolve a preview thumbnail and render the on-map overlay. */
interface NpcRecord extends RefRecord {
  sprite?: string;
}
/** Quest record from quests.json — only the bits the cell inspector
 *  dropdown and the quest-glow / quest-giver renderer actually read.
 *  Full schema is in docs/data_dictionary/quest.md. */
interface QuestRecord {
  id: string;
  name?: string;
  quest_giver?: {
    npc_name?: string;
    npc_sprite?: string;
    start_dialog?: string;
    end_dialog?: string;
  };
  steps?: Array<{
    id?: string;
    kind?: string;
    params?: Record<string, unknown> | null;
  }>;
}

// Per-tile animation configs + AnimationKind live in
// `sim/tileAnimations.ts` (imported above). Keeping a local
// note so the next person searching for "ANIMATION_CONFIGS"
// here finds the new location.

interface MapRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  width: number;
  height: number;
  /** Each cell is a full TileType instance — id, name, walkable,
   *  sprite, link, etc. all materialized inline. There is no separate
   *  overrides array; the cell IS its data. Painting a cell deep-
   *  copies the brush palette entry into it. */
  grid: TileType[][];
  [k: string]: unknown;
}

/** Comparing a painted cell to its palette-of-origin (matched by id)
 *  tells us whether the cell has been customized since paint. Used
 *  for the canvas marker + the "modified" pill in the inspector. */
function cellMatchesPalette(cell: TileType, palette: TileType[]): boolean {
  const base = palette.find((t) => t.id === cell.id);
  if (!base) return true; // Orphan id — no palette to compare; treat as "fresh."
  if (cell.name !== base.name) return false;
  if ((cell.tag ?? "") !== (base.tag ?? "")) return false;
  if (cell.walkable !== base.walkable) return false;
  if (cell.obstructs !== base.obstructs) return false;
  if ((cell.boat ?? false) !== (base.boat ?? false)) return false;
  if ((cell.text ?? "") !== (base.text ?? "")) return false;
  if ((cell.locked ?? false) !== (base.locked ?? false)) return false;
  if ((cell.light_source ?? false) !== (base.light_source ?? false))
    return false;
  if ((cell.light_range ?? 0) !== (base.light_range ?? 0)) return false;
  if ((cell.animation ?? "none") !== (base.animation ?? "none")) return false;
  if ((cell.counter ?? "") !== (base.counter ?? "")) return false;
  if ((cell.encounter ?? "") !== (base.encounter ?? "")) return false;
  if ((cell.spawn ?? "") !== (base.spawn ?? "")) return false;
  if ((cell.item ?? "") !== (base.item ?? "")) return false;
  if ((cell.quest ?? "") !== (base.quest ?? "")) return false;
  if ((cell.dungeon ?? "") !== (base.dungeon ?? "")) return false;
  if ((cell.npc ?? "") !== (base.npc ?? "")) return false;
  if (cell.sprite !== base.sprite) return false;
  if (JSON.stringify(cell.link ?? null) !== JSON.stringify(base.link ?? null))
    return false;
  return true;
}

/** Compute the set of `"col,row"` keys for cells that should carry the
 *  quest-related golden glow. A cell glows when any of the following
 *  is true:
 *
 *   - it has a non-empty `quest` field (the quest giver sits here);
 *   - it has an `encounter` whose id is named by a `kill`-kind step's
 *     `encounter_id`, OR whose `monsters[]` roster contains a monster
 *     id named by a `kill` step's `monster_id`;
 *   - it has an `item` named by a `fetch`-kind step's `item_id`.
 *
 *  `visit` and `talk` steps don't drive glow today — those refer to
 *  coordinates and NPCs that the engine surfaces differently. */
function computeQuestGlowCells(
  grid: TileType[][],
  quests: QuestRecord[],
  encounters: EncounterRecord[],
): Set<string> {
  const questEncounterIds = new Set<string>();
  const questMonsterIds = new Set<string>();
  const questItemIds = new Set<string>();
  for (const q of quests) {
    for (const s of q.steps ?? []) {
      const params = (s.params ?? {}) as Record<string, unknown>;
      if (s.kind === "kill") {
        const eid = params.encounter_id;
        const mid = params.monster_id;
        if (typeof eid === "string" && eid) questEncounterIds.add(eid);
        if (typeof mid === "string" && mid) questMonsterIds.add(mid);
      } else if (s.kind === "fetch") {
        const iid = params.item_id;
        if (typeof iid === "string" && iid) questItemIds.add(iid);
      }
    }
  }

  const encMonsters = new Map<string, ReadonlySet<string>>();
  for (const e of encounters) {
    const mons = Array.isArray(e.monsters) ? new Set(e.monsters) : new Set<string>();
    encMonsters.set(e.id, mons);
  }

  const glow = new Set<string>();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (cell.quest) {
        glow.add(`${c},${r}`);
        continue;
      }
      if (cell.encounter) {
        if (questEncounterIds.has(cell.encounter)) {
          glow.add(`${c},${r}`);
          continue;
        }
        const cellMons = encMonsters.get(cell.encounter);
        if (cellMons) {
          for (const m of questMonsterIds) {
            if (cellMons.has(m)) {
              glow.add(`${c},${r}`);
              break;
            }
          }
          if (glow.has(`${c},${r}`)) continue;
        }
      }
      if (cell.item && questItemIds.has(cell.item)) {
        glow.add(`${c},${r}`);
      }
    }
  }
  return glow;
}

function fieldDiffersFromPalette(
  cell: TileType,
  palette: TileType[],
  field: keyof TileType,
): boolean {
  const base = palette.find((t) => t.id === cell.id);
  if (!base) return false;
  if (field === "link") {
    return (
      JSON.stringify(cell.link ?? null) !==
      JSON.stringify(base.link ?? null)
    );
  }
  return cell[field] !== base[field];
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      palette: TileType[];
      counters: RefRecord[];
      encounters: EncounterRecord[];
      spawns: RefRecord[];
      items: ItemRecord[];
      npcs: NpcRecord[];
      mapRecord: MapRecord;
      /** The whole maps.json shape for this module's own file (draft-
       *  aware) — needed so we can write back the modified map. */
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
      /** Every map in the module (resolved view, including inherited
       *  + draft). Used by the cell-inspector's Link picker so authors
       *  can dropdown to a target map rather than typing the id by
       *  hand. Just `{id, name}` pairs — the full record isn't
       *  needed here. */
      availableMaps: Array<{ id: string; name: string }>;
      /** Every dungeon and quest in the module — feeds the cell
       *  inspector's Dungeon / Quest dropdowns so authors pick from
       *  the catalog instead of typing ids by hand. Quests carry the
       *  full record (not just id+name) because the map editor also
       *  reads quest_giver + steps for the on-map quest-giver sprite
       *  + golden-glow rendering. */
      availableDungeons: Array<{ id: string; name: string }>;
      availableQuests: QuestRecord[];
      /** Simulation-only catalog. Loaded alongside the painting data
       *  so the scene can pre-load party sprites in its single
       *  preload() pass. Null when a load failed; sim mode is still
       *  reachable but the panel falls back to placeholders. */
      simParty: SimParty | null;
      simCharacters: SimCharacter[];
      simRaces: SimRace[];
      simEffects: SimEffect[];
      simClasses: SimCharacterClass[];
      /** Knock-spell record (or null when the module hasn't defined
       *  one). Threaded into the MapSimulation catalog so the Pick
       *  Lock / Cast Knock dialog can offer the Knock row when the
       *  party has an eligible caster. */
      simKnockSpell: SimSpell | null;
      /** Resolved spawns.json catalog — passed straight to the sim
       *  so the per-step spawn loop can find lairs by cell.spawn id. */
      simSpawns: SimSpawn[];
      /** Resolved monsters.json catalog — gives the spawn loop sprite
       *  paths for roamers and lets the encounter overlay show
       *  roster thumbnails. */
      simMonsters: SimMonsterRef[];
    }
  | { kind: "error"; message: string };

export function MapEditor({
  moduleId,
  mapId,
}: {
  moduleId: string;
  mapId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeBrush, setActiveBrush] = useState<string | null>(null);
  const [gridLinesOn, setGridLinesOn] = useState(true);
  /** Simulation mode state machine.
   *   - "off"     → Inspector visible, paint/inspect/pan tools work.
   *   - "placing" → user clicked Simulate; the next walkable click on
   *                 the canvas drops the party there and transitions
   *                 to "active". Painting is suppressed while placing.
   *   - "active"  → SimPanel visible, party sprite on the map, WASD /
   *                 arrows drive movement, paint is suppressed.
   *  Link traversal (URL `?sim=1&entryCol=X&entryRow=Y`) skips
   *  "placing" and lands directly in "active" at the destination cell. */
  const [simMode, setSimMode] = useState<"off" | "placing" | "active">(
    "off",
  );
  /** Mirror in a ref so the Phaser scene's pointer handler — which
   *  reads from refs only — can branch on the current sim state. */
  const simModeRef = useRef<"off" | "placing" | "active">("off");
  useEffect(() => {
    simModeRef.current = simMode;
  }, [simMode]);
  /** Live MapSimulation instance while simMode === "active". Held as
   *  a ref because we never want it to drive React renders — it
   *  pushes updates through events. */
  const simRef = useRef<MapSimulation | null>(null);
  /** The Sim panel needs the instance to subscribe; we mirror simRef
   *  into state purely for the SimPanel prop. Updated when sim mounts
   *  or unmounts. */
  const [simInstance, setSimInstance] = useState<MapSimulation | null>(null);
  /** True while the P-key party screen overlay is open. Bound only
   *  during simMode === "active" so editing the map normally doesn't
   *  trip the modal. The overlay self-owns its own ESC handling and
   *  closes via this setter. */
  const [partyScreenOpen, setPartyScreenOpen] = useState(false);
  /** NPC currently being interacted with (id from npcs.json). Null when
   *  no dialog overlay is open. Set by the sim's npc_encountered
   *  event; cleared when the player closes the dialog. */
  const [npcEncounterId, setNpcEncounterId] = useState<string | null>(null);
  /** Lock-dialog state — set when the sim emits `lock_encountered`,
   *  cleared on dismiss / successful unlock. Keeps the option snapshot
   *  so the overlay renders without re-querying the sim. */
  const [lockEncounter, setLockEncounter] = useState<LockEncounterOptions | null>(null);
  /** Spawn-encounter dialog state — set when the sim emits
   *  `spawn_encountered` (party stepped on a lair, or a roamer
   *  caught up). Cleared once the player resolves it via the
   *  overlay's Win/Flee buttons. */
  const [spawnEncounter, setSpawnEncounter] =
    useState<SpawnEncounterOptions | null>(null);
  /** Counter currently being shopped (id from counters.json). Null when
   *  the shop overlay is closed. The shop overlay is launched from
   *  inside the NPC dialog; closing it returns the player to the
   *  dialog. */
  const [shopCounterId, setShopCounterId] = useState<string | null>(null);
  /** Mirrors npcEncounterId/shopCounterId in a ref so the sim's
   *  keyboard listener can gate movement without re-binding on every
   *  state change. */
  const overlaysOpenRef = useRef(false);
  useEffect(() => {
    overlaysOpenRef.current =
      !!npcEncounterId ||
      !!shopCounterId ||
      partyScreenOpen ||
      !!lockEncounter ||
      !!spawnEncounter;
  }, [
    npcEncounterId,
    shopCounterId,
    partyScreenOpen,
    lockEncounter,
    spawnEncounter,
  ]);
  /** Callback the Phaser scene invokes when the user clicks a tile
   *  during "placing" — held in a ref so the scene closure stays
   *  stable while React re-renders. */
  const onSimPlaceRef = useRef<(col: number, row: number) => void>(
    () => {},
  );
  /** Discrete zoom presets. Index into ZOOM_STEPS; the canvas is
   *  CSS-scaled by this factor so the outer overflow-auto container
   *  produces matching scrollbars for pan. Phaser pointer events still
   *  resolve to correct game coordinates because getBoundingClientRect
   *  returns post-transform dimensions. */
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
  const DEFAULT_ZOOM_IDX = 2; // = 1.0
  const [zoomIdx, setZoomIdx] = useState<number>(DEFAULT_ZOOM_IDX);
  const zoom = ZOOM_STEPS[zoomIdx];
  /** Ref to the scrollable canvas viewport so middle-mouse-drag and
   *  Space+drag panning can mutate scrollLeft/scrollTop directly
   *  without React re-renders. */
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  /** True while the user holds Space — enables drag-to-pan and
   *  swaps the cursor to "grab" so the gesture is discoverable. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Track Space at the window level so it works no matter which
  // editor element has focus. Ignore the keydown if the user is
  // typing in an input/textarea so cell-text editing isn't blocked.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };
    const isSpace = (e: KeyboardEvent) =>
      e.code === "Space" || e.key === " " || e.key === "Spacebar";
    const onDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      if (isTyping(e.target)) return;
      // Suppress on EVERY Space keydown — including auto-repeats —
      // otherwise the browser's default "Space = page down" scrolls
      // the canvas viewport while the user is trying to pan.
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      setSpaceHeld(false);
    };
    // Capture phase so we beat any inner scroll handler that would
    // otherwise consume the event before we get to preventDefault.
    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }, []);

  // P toggles the in-game Party screen — but ONLY while the simulation
  // is active. Outside sim, pressing P shouldn't pop the modal (and
  // shouldn't fight cell-text inputs). When the overlay is open, the
  // overlay itself owns the P / ESC handling for dismissal so we
  // intentionally bail out here.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };
    const onPartyKey = (e: KeyboardEvent) => {
      if (simModeRef.current !== "active") return;
      if (partyScreenOpen) return;
      if (e.key !== "p" && e.key !== "P") return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setPartyScreenOpen(true);
    };
    window.addEventListener("keydown", onPartyKey);
    return () => window.removeEventListener("keydown", onPartyKey);
  }, [partyScreenOpen]);

  // If the user leaves simulation while any overlay is still open,
  // dismiss them so they don't linger over the inspector pane.
  useEffect(() => {
    if (simMode !== "active") {
      if (npcEncounterId) setNpcEncounterId(null);
      if (shopCounterId) setShopCounterId(null);
      if (lockEncounter) setLockEncounter(null);
    }
  }, [simMode, npcEncounterId, shopCounterId, lockEncounter]);
  useEffect(() => {
    if (simMode !== "active" && partyScreenOpen) {
      setPartyScreenOpen(false);
    }
  }, [simMode, partyScreenOpen]);
  const [publishing, setPublishing] = useState(false);

  const [selectedCell, setSelectedCell] = useState<
    { col: number; row: number } | null
  >(null);
  /** "paint" → click/drag paints the active brush and selects the cell.
   *  "fill"  → click/drag draws a rectangle preview; on release every
   *            cell inside the rect is painted with the active brush
   *            in a single batched persist.
   *  "pan"  → click/drag scrolls the canvas viewport. Useful on
   *           laptops with no middle mouse button.
   *  "inspect" → click/drag only selects (so you can read attributes
   *  without modifying the map). */
  const [tool, setTool] = useState<"paint" | "inspect" | "pan" | "fill">(
    "paint",
  );
  const toolRef = useRef<"paint" | "inspect" | "pan" | "fill">("paint");
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  /** Ambient lighting simulation. Day = full bright. Twilight = dim
   *  ambient with light sources lifting nearby cells. Night = near-
   *  black ambient, same lighting rules. */
  const [lightingMode, setLightingMode] = useState<
    "day" | "twilight" | "night"
  >("day");
  /** Mirror of lightingMode in a ref so the sim's relight callback
   *  can trigger a pass without re-binding the closure each render. */
  const lightingModeRef = useRef<"day" | "twilight" | "night">("day");
  useEffect(() => {
    lightingModeRef.current = lightingMode;
  }, [lightingMode]);
  /** Which palette-tag sections are currently collapsed in the side
   *  panel. Tags are expanded by default; entries here are the
   *  exceptions. */
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(
    () => new Set(),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Refs that bridge React state into the Phaser scene's closure.
  const brushRef = useRef<string | null>(null);
  /** Start cell of an in-progress Fill rectangle drag. Set on pointer-
   *  down while the Fill tool is active, cleared on pointer-up after
   *  the rectangle commits. Null at all other times. */
  const fillStartRef = useRef<{ col: number; row: number } | null>(null);
  /** The live grid the scene mutates on paint. Each cell is a full
   *  TileType instance — paint replaces it with a deep-copy of the
   *  brush palette entry. */
  const gridRef = useRef<TileType[][]>([]);
  const paletteRef = useRef<TileType[]>([]);
  const persistRef = useRef<() => void>(() => {});
  /** Scene calls this on every cell the pointer touches so the React
   *  inspector tracks the latest interaction. */
  const onCellTouchedRef = useRef<(col: number, row: number) => void>(
    () => {},
  );
  const sceneApiRef = useRef<{
    setGridLinesVisible: (on: boolean) => void;
    setSelected: (cell: { col: number; row: number } | null) => void;
    setOverrideMarkers: (cells: Array<{ col: number; row: number }>) => void;
    /** Update a single cell's rendered texture from its sprite path. */
    refreshCell: (col: number, row: number, spriteKey: string) => void;
    /** Re-tint every cell based on the lighting mode + current grid. */
    relight: (mode: "day" | "twilight" | "night") => void;
    /** Sync per-cell particle emitters to the current grid's animation values. */
    refreshAnimations: () => void;
    /** Sync per-cell encounter-sprite overlays from each cell's encounter field. */
    refreshEncounterOverlays: () => void;
    /** Sync per-cell item-sprite overlays from each cell's item field. */
    refreshItemOverlays: () => void;
    /** Sync per-cell NPC-sprite overlays from each cell's npc field. */
    refreshNpcOverlays: () => void;
    /** Sync the quest-giver sprite overlay (cells with `quest` set
     *  render the quest's quest_giver.npc_sprite) AND the soft
     *  golden glow drawn behind quest-relevant cells (givers,
     *  encounters tied to kill steps, items tied to fetch steps). */
    refreshQuestOverlays: () => void;
    /** Show / move the simulation party sprite. Sprite path is the
     *  full key passed to the scene's preload (so the texture is
     *  already cached). Position is in grid coords. */
    setPartyAt: (col: number, row: number, sprite: string) => void;
    /** Hide the party sprite entirely. Called on sim teardown. */
    clearParty: () => void;
    /** Override the party-light source the relight pass folds in.
     *  Null disables the extra source. */
    setPartyLight: (source: SimLightSource | null) => void;
    /** Sync the "loose" boats sitting on the world map. Each entry
     *  carries the boat's sprite so cells can swap their render
     *  texture between boat and water as boats move around. */
    setBoatPositions: (
      positions: ReadonlyArray<{
        col: number;
        row: number;
        sprite: string;
      }>,
    ) => void;
    /** Show / move the boat sprite that follows the party while
     *  they're aboard. The scene also hides partySprite while the
     *  boat is showing (the party is "inside" the boat). `sprite`
     *  is the boat's render key — passed on board, omitted on sail. */
    setPartyBoatAt: (
      col: number,
      row: number,
      visible: boolean,
      sprite?: string,
    ) => void;
    /** Briefly show `text` floating up over the cell at (col, row).
     *  Used when the party steps onto a tile whose `text` field is
     *  set. Rises and fades over ~1.4s. Self-cleaning. */
    floatText: (col: number, row: number, text: string) => void;
    /** Sync per-roamer sprites with the live set from the simulator.
     *  Roamers render at near-full cell size with a depth just below
     *  the party (so the party sprite reads on top when they collide). */
    setRoamerPositions: (
      positions: ReadonlyArray<{
        id: string;
        col: number;
        row: number;
        sprite: string;
      }>,
    ) => void;
    /** Swap the cell at (col, row) to a different sprite/walkable.
     *  Used by the destroy-lair path so a defeated Monster Spawn
     *  reverts to plain ground visually in-session. */
    setCellSprite: (
      col: number,
      row: number,
      sprite: string,
      walkable: boolean,
    ) => void;
    /** Sync sprites for the live placed-encounter entities. Same
     *  shape and depth as roamers — they're just sourced from
     *  encounter cells instead of spawns. */
    setPlacedEncounterPositions: (
      positions: ReadonlyArray<{
        id: string;
        col: number;
        row: number;
        sprite: string;
      }>,
    ) => void;
    /** Tell the scene to suppress the static cell-encounter overlay
     *  for these "col,row" keys. Pairs with the placed-encounter
     *  renderer so a roaming entity doesn't double up with the
     *  painted sprite. Cleared (empty set) when sim mode ends. */
    setSuppressedEncounterCells: (cells: ReadonlySet<string>) => void;
  } | null>(null);
  /** The party-light source the simulation contributes. Read by the
   *  scene's relight on every pass — when sim mode is off this stays
   *  null and behavior is identical to the painting view. */
  const partyLightRef = useRef<SimLightSource | null>(null);
  /** True when at least one active party member's race carries the
   *  `infravision` ability AND the player has currently engaged
   *  it. The ability part is computed once on catalog load; the
   *  activation half is pushed in through the
   *  `setPartyInfravisionActive` bridge callback every time the
   *  user toggles it via the SimPanel button. The relight pass
   *  reads the combined value through the closure. */
  const partyInfravisionActiveRef = useRef<boolean>(false);
  /** Separately tracked: does the party even have the ability? UI
   *  controls (the SimPanel toggle) gate on this so a non-Dwarf
   *  party doesn't show an Activate Infravision button at all. */
  const partyHasInfravisionRef = useRef<boolean>(false);

  // Selection follows the cursor.
  useEffect(() => {
    onCellTouchedRef.current = (col, row) => {
      setSelectedCell({ col, row });
    };
  }, []);

  // Mirror React state into refs so Phaser sees fresh values.
  useEffect(() => {
    brushRef.current = activeBrush;
  }, [activeBrush]);

  // ── Initial load ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const src = new StaticModuleSource();
        const [
          paletteLayers,
          mapsLayers,
          countersLayers,
          encountersLayers,
          spawnsLayers,
          itemsLayers,
          partyLayers,
          charactersLayers,
          racesLayers,
          effectsLayers,
          classesLayers,
          dungeonsLayers,
          questsLayers,
          npcsLayers,
          spellsLayers,
          monstersLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "map_tiles"),
          src.loadModelLayers(moduleId, "maps"),
          src.loadModelLayers(moduleId, "counters"),
          src.loadModelLayers(moduleId, "encounters"),
          src.loadModelLayers(moduleId, "spawns"),
          src.loadModelLayers(moduleId, "items"),
          // Sim-only catalog. Failures here are non-fatal — the editor
          // still functions for painting; sim mode just degrades.
          src.loadModelLayers(moduleId, "party").catch(() => null),
          src.loadModelLayers(moduleId, "characters").catch(() => null),
          src.loadModelLayers(moduleId, "races").catch(() => null),
          src.loadModelLayers(moduleId, "effects").catch(() => null),
          src.loadModelLayers(moduleId, "character_classes").catch(() => null),
          // Cell-inspector pickers for the dungeon/quest fields.
          // Same non-fatal pattern — empty list if the module hasn't
          // populated these yet.
          src.loadModelLayers(moduleId, "dungeons").catch(() => null),
          src.loadModelLayers(moduleId, "quests").catch(() => null),
          // NPC catalog for the cell inspector's NPC picker + the
          // on-map NPC-sprite overlay. Non-fatal too.
          src.loadModelLayers(moduleId, "npcs").catch(() => null),
          // Spells catalog — only the Knock spell is consumed by the
          // simulator today (Pick Lock / Cast Knock dialog). Non-fatal
          // so a module without spells still boots into sim mode.
          src.loadModelLayers(moduleId, "spells").catch(() => null),
          // Monsters catalog — read by the spawn subsystem so the
          // roamer renderer + encounter overlay can resolve a
          // monster id to a sprite + display name. Non-fatal so
          // modules without monsters.json still mount.
          src.loadModelLayers(moduleId, "monsters").catch(() => null),
        ]);
        if (cancelled) return;

        // Resolve palette (tile types are catalog-only, no drafts needed
        // for this read — the picker side panel just shows what's defined).
        const paletteMerged = mergeModel(
          "map_tiles",
          paletteLayers.inherited,
          paletteLayers.ownFile,
        ) as { map_tiles?: TileType[] } | null;
        const palette = paletteMerged?.map_tiles ?? [];

        const countersMerged = mergeModel(
          "counters",
          countersLayers.inherited,
          countersLayers.ownFile,
        ) as { counters?: RefRecord[] } | null;
        const counters = countersMerged?.counters ?? [];

        const encountersMerged = mergeModel(
          "encounters",
          encountersLayers.inherited,
          encountersLayers.ownFile,
        ) as { encounters?: EncounterRecord[] } | null;
        const encounters = encountersMerged?.encounters ?? [];

        const spawnsMerged = mergeModel(
          "spawns",
          spawnsLayers.inherited,
          spawnsLayers.ownFile,
        ) as { spawns?: RefRecord[] } | null;
        const spawns = spawnsMerged?.spawns ?? [];
        // Build the typed SimSpawn list the simulator consumes. We
        // backfill the few fields v1 docs allow to be optional with
        // the same defaults the v1 reference loader applied — so a
        // partially-authored Spawn record still drives a sensible
        // loop instead of throwing.
        const simSpawns: SimSpawn[] = spawns.map((s) => {
          const rec = s as RefRecord & {
            description?: string;
            spawn_monsters?: string[];
            spawn_chance?: number;
            spawn_radius?: number;
            max_spawned?: number;
            boss_monsters?: string[];
            xp_reward?: number;
            gold_reward?: number;
            loot?: string[];
          };
          return {
            id: rec.id,
            name: (rec.name as string) ?? "Monster Spawn",
            description: rec.description ?? "",
            spawn_monsters: rec.spawn_monsters ?? [],
            spawn_chance:
              typeof rec.spawn_chance === "number" ? rec.spawn_chance : 20,
            spawn_radius:
              typeof rec.spawn_radius === "number" ? rec.spawn_radius : 3,
            max_spawned:
              typeof rec.max_spawned === "number" ? rec.max_spawned : 2,
            boss_monsters: rec.boss_monsters ?? [],
            xp_reward:
              typeof rec.xp_reward === "number" ? rec.xp_reward : 50,
            gold_reward:
              typeof rec.gold_reward === "number" ? rec.gold_reward : 25,
            loot: rec.loot ?? [],
          };
        });

        const itemsMerged = mergeModel(
          "items",
          itemsLayers.inherited,
          itemsLayers.ownFile,
        ) as { items?: ItemRecord[] } | null;
        const items = itemsMerged?.items ?? [];

        const npcsMerged =
          npcsLayers &&
          (mergeModel(
            "npcs",
            npcsLayers.inherited,
            npcsLayers.ownFile,
          ) as { npcs?: NpcRecord[] } | null);
        const npcs = npcsMerged?.npcs ?? [];

        // Resolve maps with draft applied so a half-painted map survives reloads.
        const draft = loadDraft<Record<string, unknown>>(moduleId, MODEL_KEY);
        const ownEffective =
          draft ?? (mapsLayers.ownFile as Record<string, unknown> | null);
        const mapsMerged = mergeModel(
          "maps",
          mapsLayers.inherited,
          ownEffective,
        ) as { maps?: MapRecord[] } | null;
        const allMaps = mapsMerged?.maps ?? [];
        const found = allMaps.find((m) => m.id === mapId);
        if (!found) {
          setState({
            kind: "error",
            message: `Map "${mapId}" not found in module "${moduleId}".`,
          });
          return;
        }
        // Auto-migrate string cells → full instances on load, so old
        // data files still open. For object cells missing fields (new
        // attributes added to the palette after the cell was painted),
        // backfill from the palette entry that shares the cell's id.
        // Cell values win where present; palette fills the gaps.
        const paletteById = new Map(palette.map((t) => [t.id, t]));
        const materialized: TileType[][] = found.grid.map((row) =>
          row.map((cell) => {
            if (typeof cell === "string") {
              const tpl = paletteById.get(cell);
              return tpl
                ? { ...tpl }
                : ({
                    id: cell,
                    name: cell,
                    tag: "",
                    walkable: true,
                    obstructs: false,
                    boat: false,
                    locked: false,
                    light_source: false,
                    light_range: 0,
                    text: "",
                    animation: "none",
                    counter: "",
                    encounter: "",
                    spawn: "",
                    item: "",
                    quest: "",
                    dungeon: "",
                    npc: "",
                    sprite: "",
                  } as TileType);
            }
            const obj = cell as TileType;
            const tpl = paletteById.get(obj.id);
            return tpl ? { ...tpl, ...obj } : { ...obj };
          }),
        );
        const mapRecord: MapRecord = {
          ...found,
          grid: materialized,
        };
        // Drop any leftover sparse overrides from older data revisions.
        delete (mapRecord as Record<string, unknown>).cells;
        gridRef.current = materialized;
        paletteRef.current = palette;
        // Seed the brush with the first walkable tile, falling back to first tile.
        const firstBrush =
          palette.find((t) => t.walkable)?.id ?? palette[0]?.id ?? null;
        setActiveBrush(firstBrush);
        // Sim-catalog merges. The sim only reads a small subset of
        // each record; we resolve them through the same mergeModel
        // pipeline so module extends/uses chains work identically.
        const partyMerged =
          partyLayers &&
          (mergeModel(
            "party",
            partyLayers.inherited,
            partyLayers.ownFile,
          ) as SimParty | null);
        const charactersMerged =
          charactersLayers &&
          (mergeModel(
            "characters",
            charactersLayers.inherited,
            charactersLayers.ownFile,
          ) as { characters?: SimCharacter[] } | null);
        const racesMerged =
          racesLayers &&
          (mergeModel(
            "races",
            racesLayers.inherited,
            racesLayers.ownFile,
          ) as { races?: SimRace[] } | null);
        const effectsMerged =
          effectsLayers &&
          (mergeModel(
            "effects",
            effectsLayers.inherited,
            effectsLayers.ownFile,
          ) as { effects?: SimEffect[] } | null);
        const classesMerged =
          classesLayers &&
          (mergeModel(
            "character_classes",
            classesLayers.inherited,
            classesLayers.ownFile,
          ) as {
            character_classes?: SimCharacterClass[];
          } | null);
        // Spells catalog — the sim only needs the Knock spell today
        // (lock-unlock dialog). We pull the full list through mergeModel
        // and then pluck the entry whose id matches; missing → null,
        // which suppresses the Cast Knock row in the dialog.
        const spellsMerged =
          spellsLayers &&
          (mergeModel(
            "spells",
            spellsLayers.inherited,
            spellsLayers.ownFile,
          ) as { spells?: SimSpell[] } | null);
        const knockSpell: SimSpell | null =
          spellsMerged?.spells?.find((s) => s.id === "knock") ?? null;

        // Monsters catalog — the spawn subsystem needs ids + names +
        // sprite paths. We only pluck those three fields out of the
        // (much larger) monsters.json record so the sim type stays
        // narrow. monsters.json paths are already in the "monster/foo.png"
        // shape battle's loader resolves.
        const monstersMerged =
          monstersLayers &&
          (mergeModel(
            "monsters",
            monstersLayers.inherited,
            monstersLayers.ownFile,
          ) as {
            monsters?: Array<{ id: string; name?: string; sprite?: string }>;
          } | null);
        const simMonsters: SimMonsterRef[] =
          (monstersMerged?.monsters ?? []).map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            sprite: m.sprite ?? "",
          }));

        // Build the picker list once at load. The full record set is
        // resolved by mergeModel above (allMaps); we strip to id+name
        // since the inspector doesn't need anything else and the list
        // is rendered as a flat <select>.
        const availableMaps = allMaps
          .map((m) => ({ id: m.id, name: m.name ?? m.id }))
          .sort((a, b) => a.name.localeCompare(b.name));

        // Same shape for the dungeons / quests pickers in the cell
        // inspector. Failures upstream become empty lists.
        const dungeonsMerged =
          dungeonsLayers &&
          (mergeModel(
            "dungeons",
            dungeonsLayers.inherited,
            dungeonsLayers.ownFile,
          ) as { dungeons?: Array<{ id: string; name?: string }> } | null);
        const availableDungeons = (dungeonsMerged?.dungeons ?? [])
          .map((d) => ({ id: d.id, name: d.name ?? d.id }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const questsMerged =
          questsLayers &&
          (mergeModel(
            "quests",
            questsLayers.inherited,
            questsLayers.ownFile,
          ) as { quests?: QuestRecord[] } | null);
        const availableQuests = (questsMerged?.quests ?? [])
          .slice()
          .sort((a, b) =>
            (a.name ?? a.id).localeCompare(b.name ?? b.id),
          );

        setState({
          kind: "ok",
          palette,
          counters,
          encounters,
          spawns,
          items,
          npcs,
          mapRecord,
          ownFile: ownEffective ?? null,
          isDraft: hasDraft(moduleId, MODEL_KEY),
          availableMaps,
          availableDungeons,
          availableQuests,
          simParty: partyMerged ?? null,
          simCharacters: charactersMerged?.characters ?? [],
          simRaces: racesMerged?.races ?? [],
          simEffects: effectsMerged?.effects ?? [],
          simClasses: classesMerged?.character_classes ?? [],
          simKnockSpell: knockSpell,
          simSpawns,
          simMonsters,
        });
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
  }, [moduleId, mapId]);

  // ── Persist grid edits into the draft ────────────────────────────
  // Defined as a callback that captures `state` via a ref so the scene
  // always invokes the latest version (state.ownFile changes after each save).
  useEffect(() => {
    persistRef.current = () => {
      if (state.kind !== "ok") return;
      const baseFile: Record<string, unknown> = state.ownFile
        ? { ...state.ownFile }
        : { maps: [] };
      const list = Array.isArray(baseFile.maps)
        ? [...(baseFile.maps as MapRecord[])]
        : [];
      const idx = list.findIndex((m) => m.id === mapId);
      const updatedMap: MapRecord = {
        ...state.mapRecord,
        grid: gridRef.current.map((row) => row.map((cell) => ({ ...cell }))),
      };
      // Defensively drop any vestigial overrides field.
      delete (updatedMap as Record<string, unknown>).cells;
      if (idx >= 0) list[idx] = updatedMap;
      else list.push(updatedMap);
      baseFile.maps = list;
      saveDraft(moduleId, MODEL_KEY, baseFile);
      setState({
        ...state,
        mapRecord: updatedMap,
        ownFile: baseFile,
        isDraft: true,
      });
    };
  }, [state, moduleId, mapId]);

  // Override markers — a cell is "modified" when it diverges from its
  // palette-of-origin (matched by id). Recompute whenever state changes.
  useEffect(() => {
    if (state.kind !== "ok") return;
    const modified: Array<{ col: number; row: number }> = [];
    for (let r = 0; r < state.mapRecord.height; r++) {
      for (let c = 0; c < state.mapRecord.width; c++) {
        const cell = state.mapRecord.grid[r]?.[c];
        if (!cell) continue;
        if (!cellMatchesPalette(cell, state.palette)) {
          modified.push({ col: c, row: r });
        }
      }
    }
    sceneApiRef.current?.setOverrideMarkers(modified);
  }, [state]);

  // ── Mount Phaser ────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind !== "ok") return;
    if (!containerRef.current) return;

    let game: import("phaser").Game | null = null;
    let cancelled = false;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;

      const {
        palette,
        mapRecord,
        encounters,
        items,
        npcs,
        availableQuests,
        simParty,
        simCharacters,
        simRaces,
        simMonsters,
      } = state;
      const paletteById = new Map(palette.map((t) => [t.id, t]));
      const encountersById = new Map(encounters.map((e) => [e.id, e]));
      const itemsById = new Map(items.map((i) => [i.id, i]));
      const npcsById = new Map(npcs.map((n) => [n.id, n]));
      const questsById = new Map(availableQuests.map((q) => [q.id, q]));
      // Map id → sprite for the roamer renderer. Sprites are
      // already in the "monster/foo.png" shape the preload pipeline
      // consumes, so they slot straight into spriteKeys below.
      const monstersById = new Map(simMonsters.map((m) => [m.id, m]));
      // Compute partyHasInfravision once now that the catalog is
      // in hand. Walks roster → character.race → race.abilities.
      // The flag is read by relight via the ref so subsequent
      // re-renders pick up changes after a fresh module load.
      {
        const racesById = new Map(simRaces.map((r) => [r.id, r]));
        const charactersById = new Map(
          simCharacters.map((c) => [c.id, c]),
        );
        partyHasInfravisionRef.current = (simParty?.roster ?? []).some(
          (id) => {
            const c = charactersById.get(id);
            if (!c) return false;
            const r = racesById.get(c.race);
            if (!r) return false;
            return (r.abilities ?? []).includes("infravision");
          },
        );
      }

      // Gather every unique sprite path used by the palette + the
      // current grid + every encounter's monster_party_tile + every
      // item's icon so we can render placed-sprite overlays on cells
      // that reference one.
      const spriteKeys = new Set<string>();
      for (const t of palette) if (t.sprite) spriteKeys.add(t.sprite);
      for (const row of gridRef.current) {
        for (const cell of row) if (cell?.sprite) spriteKeys.add(cell.sprite);
      }
      for (const e of encounters) {
        const s = e.monster_party_tile;
        if (s && s.includes("/")) spriteKeys.add(s);
      }
      for (const i of items) {
        if (i.icon) spriteKeys.add(`item/${i.icon}.png`);
      }
      // Quest-giver NPC sprites — preload so the on-map overlay is
      // ready as soon as a cell with `tile.quest` becomes visible.
      for (const q of availableQuests) {
        const sprite = q.quest_giver?.npc_sprite;
        if (sprite && sprite.includes("/")) spriteKeys.add(sprite);
      }
      // NPC sprites from the npcs catalog — same rationale as
      // quest-giver sprites. Tolerate bare-stem sprite paths
      // (e.g. "cleric1") by defaulting to the person/ folder.
      const resolveNpcSpriteKey = (raw: string | undefined): string => {
        if (!raw) return "";
        if (raw.includes("/")) return raw;
        return `person/${/\.[a-z]+$/i.test(raw) ? raw : `${raw}.png`}`;
      };
      for (const n of npcs) {
        const key = resolveNpcSpriteKey(n.sprite);
        if (key) spriteKeys.add(key);
      }
      // Resolve a "swap to water" sprite for cells that lose their
      // boat. Pick the first water-tagged tile in the palette (the
      // designer's chosen canonical water) and fall back to a known
      // path if the palette doesn't have one. Pre-add it to the
      // sprite keys so boards never miss the texture.
      const WATER_SPRITE_KEY =
        palette.find((t) => t.tag === "water")?.sprite ?? "map/water.png";
      if (WATER_SPRITE_KEY) spriteKeys.add(WATER_SPRITE_KEY);
      // Sim-mode sprites: party avatar + every active member's
      // portrait. Pre-load defensively so toggling sim on doesn't
      // need a second loader pass.
      if (simParty?.avatar) spriteKeys.add(simParty.avatar);
      for (const ch of simCharacters) {
        if (ch.sprite) spriteKeys.add(ch.sprite);
      }
      // Monster sprites — the spawn loop renders one Phaser Image per
      // roamer using these textures. Preloading them up front means
      // a freshly-spawned monster appears immediately without the
      // mid-step loader hop.
      for (const m of simMonsters) {
        if (m.sprite) spriteKeys.add(m.sprite);
      }

      class MapScene extends Phaser.Scene {
        cells: Map<string, Phaser.GameObjects.Image> = new Map();
        gridGraphics: Phaser.GameObjects.Graphics | null = null;
        selectionGraphics: Phaser.GameObjects.Graphics | null = null;
        overrideGraphics: Phaser.GameObjects.Graphics | null = null;
        /** Animation emitters keyed by "col,row". Each is a Phaser
         *  particle emitter; null when a cell has no animation. */
        emitters: Map<
          string,
          Phaser.GameObjects.Particles.ParticleEmitter
        > = new Map();
        /** Current animation key per cell so refresh can skip no-ops. */
        emitterKinds: Map<string, AnimationKind> = new Map();
        /** Encounter overlay sprites keyed by "col,row". */
        encounterOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Current encounter id per cell so refresh can skip no-ops. */
        encounterOverlayIds: Map<string, string> = new Map();
        /** Item overlay sprites keyed by "col,row". */
        itemOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Current item id per cell so refresh can skip no-ops. */
        itemOverlayIds: Map<string, string> = new Map();
        /** NPC overlay sprites keyed by "col,row" — the NPC's portrait
         *  rendered on cells with `tile.npc` set. */
        npcOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Current NPC id per cell so refresh can skip no-ops. */
        npcOverlayIds: Map<string, string> = new Map();
        /** Sim-mode party sprite (single Image, depth-300 above
         *  everything else). Null while sim mode is off. */
        partySprite: Phaser.GameObjects.Image | null = null;
        /** Last known party cell — captured every `setPartyAt` so
         *  the relight pass (shared with the dungeon scene) can
         *  root the party-vision pool and gate torch LOS. Null when
         *  sim mode is off; the shared helper interprets `null` as
         *  "painting view, no LOS gating". */
        partyCol: number | null = null;
        partyRow: number | null = null;
        /** Live roamer sprites keyed by SimRoamer.id. Mutated by
         *  setRoamerPositions — entries that disappear from the
         *  incoming list are destroyed, new ids spawn a fresh Image,
         *  surviving ids tween/snap to their new position. */
        roamerSprites: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Live placed-encounter sprites keyed by SimPlacedEncounter.id.
         *  Same diff'd-update pattern as roamers; they share the same
         *  depth band (250) so they layer naturally with each other. */
        placedEncounterSprites: Map<
          string,
          Phaser.GameObjects.Image
        > = new Map();
        /** Cell keys whose static encounter overlay should currently
         *  stay hidden. Driven by the sim subsystem — every cell
         *  with a live placed-encounter entity (plus every cell whose
         *  entity has been defeated) lands here while sim mode is
         *  on. Cleared back to an empty Set on sim teardown. */
        suppressedEncounterCells: Set<string> = new Set();
        /** Sprite key for each cell that currently holds a loose boat.
         *  Boats render via the cell's own image (swapped between
         *  boat and water textures) rather than a separate overlay —
         *  so when the party boards, the same cell smoothly becomes
         *  water. The Map gives the scene memory of which cells need
         *  to be reverted back to water when the boat is picked up. */
        boatTextures: Map<string, string> = new Map();
        /** Boat sprite that follows the party while they're aboard.
         *  Single Image, depth just below the party sprite so the
         *  party rides the boat — except partySprite is hidden while
         *  this is visible, so visually the boat IS the party. Null
         *  when the party is on land. */
        partyBoatSprite: Phaser.GameObjects.Image | null = null;
        /** Quest-giver overlay sprites keyed by "col,row" — the
         *  NPC sprite from a quest's quest_giver, rendered on cells
         *  with `tile.quest` set. Diff'd against questGiverIds the
         *  same way encounter/item overlays are. */
        questGiverOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        questGiverIds: Map<string, string> = new Map();
        /** Single Graphics layer that draws the soft golden halo
         *  behind quest-relevant cells. Recomputed wholesale on
         *  refresh — cheap enough that diffing per cell isn't
         *  worth the complexity. */
        questGlowGraphics: Phaser.GameObjects.Graphics | null = null;
        /** Preview rectangle drawn while the user drags with the Fill
         *  tool. Cleared on pointer up when the rectangle commits.
         *  Depth 199 — above cells/overrides/grid/halo but below the
         *  selection highlight (200). */
        fillPreviewGraphics: Phaser.GameObjects.Graphics | null = null;

        preload() {
          for (const sprite of spriteKeys) {
            this.load.image(sprite, withBasePath(`/sprites/${sprite}`));
          }
        }

        create() {
          for (let r = 0; r < mapRecord.height; r++) {
            for (let c = 0; c < mapRecord.width; c++) {
              const cell = gridRef.current[r][c];
              // Cells are materialized — each one carries its own sprite.
              // Fall back to first palette tile only as a last resort.
              const texKey = cell?.sprite || palette[0]?.sprite || "";
              const img = this.add
                .image(c * TILE_SIZE, r * TILE_SIZE, texKey)
                .setOrigin(0)
                .setDisplaySize(TILE_SIZE, TILE_SIZE);
              this.cells.set(`${c},${r}`, img);
            }
          }
          // Draw the grid lines once into a Graphics layer, then toggle
          // visibility on/off via setVisible — Phaser 4's clear+redraw
          // path was unreliable for us. Bright parchment-tinted color
          // so the lines actually stand out against the tiles.
          this.gridGraphics = this.add.graphics();
          this.gridGraphics.lineStyle(1, 0xece0c4, 0.45);
          for (let c = 0; c <= mapRecord.width; c++) {
            this.gridGraphics.lineBetween(
              c * TILE_SIZE,
              0,
              c * TILE_SIZE,
              mapRecord.height * TILE_SIZE,
            );
          }
          for (let r = 0; r <= mapRecord.height; r++) {
            this.gridGraphics.lineBetween(
              0,
              r * TILE_SIZE,
              mapRecord.width * TILE_SIZE,
              r * TILE_SIZE,
            );
          }
          this.gridGraphics.setVisible(gridLinesOn);
          // Keep the grid on top of all cells.
          this.gridGraphics.setDepth(100);

          this.input.on(
            "pointerdown",
            (p: Phaser.Input.Pointer) => {
              if (toolRef.current === "fill") {
                this.fillStart(p);
              } else {
                this.paintAt(p);
              }
            },
          );
          this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            if (!p.isDown) return;
            if (toolRef.current === "fill") {
              this.fillDrag(p);
            } else {
              this.paintAt(p);
            }
          });
          // Pointer-up commits a Fill drag. Use both pointerup (release
          // over the canvas) and pointerupoutside (release after the
          // pointer left the canvas mid-drag) so a swift drag off the
          // edge still finalizes the rect.
          const onPointerUp = (p: Phaser.Input.Pointer) => {
            if (toolRef.current === "fill") this.fillCommit(p);
          };
          this.input.on("pointerup", onPointerUp);
          this.input.on("pointerupoutside", onPointerUp);

          // Generate the white particle source texture used for all
          // animations (tinted per-emitter for color variation).
          if (!this.textures.exists("__particle")) {
            const g = this.add.graphics();
            g.fillStyle(0xffffff, 1);
            g.fillCircle(8, 8, 8);
            g.generateTexture("__particle", 16, 16);
            g.destroy();
          }

          // Override markers — small ember dot per overridden cell.
          // Sits between grid lines (100) and selection (200).
          this.overrideGraphics = this.add.graphics();
          this.overrideGraphics.setDepth(150);

          // Quest-relevance halo — a single Graphics layer drawn
          // BELOW the item/encounter overlays so the halo sits
          // behind the sprite. Depth 65 places it above the base
          // cell (no explicit depth) and below items (70) /
          // encounters (80).
          this.questGlowGraphics = this.add.graphics();
          this.questGlowGraphics.setDepth(65);

          // Selection highlight — drawn on top of everything.
          this.selectionGraphics = this.add.graphics();
          this.selectionGraphics.setDepth(200);

          // Fill-tool preview rectangle — sits just below the
          // selection so the active cell's highlight still reads.
          this.fillPreviewGraphics = this.add.graphics();
          this.fillPreviewGraphics.setDepth(199);

          // Expose a small API the React side can call.
          sceneApiRef.current = {
            setGridLinesVisible: (on) => {
              this.gridGraphics?.setVisible(on);
            },
            setSelected: (cell) => {
              if (!this.selectionGraphics) return;
              this.selectionGraphics.clear();
              if (!cell) return;
              this.selectionGraphics.lineStyle(2, 0xffb84d, 1);
              this.selectionGraphics.strokeRect(
                cell.col * TILE_SIZE,
                cell.row * TILE_SIZE,
                TILE_SIZE,
                TILE_SIZE,
              );
            },
            setOverrideMarkers: (overridden) => {
              if (!this.overrideGraphics) return;
              this.overrideGraphics.clear();
              this.overrideGraphics.fillStyle(0xffb84d, 1);
              for (const { col, row } of overridden) {
                this.overrideGraphics.fillCircle(
                  col * TILE_SIZE + TILE_SIZE - 4,
                  row * TILE_SIZE + 4,
                  3,
                );
              }
            },
            refreshCell: (col, row, spriteKey) => {
              const img = this.cells.get(`${col},${row}`);
              if (!img) return;
              if (!this.textures.exists(spriteKey)) return;
              img.setTexture(spriteKey);
            },
            refreshAnimations: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            refreshEncounterOverlays: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            refreshItemOverlays: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            refreshNpcOverlays: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            refreshQuestOverlays: () => {
              // Assigned for real below.
            },
            setPartyAt: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            setBoatPositions: () => {
              // Assigned for real below.
            },
            setPartyBoatAt: () => {
              // Assigned for real below.
            },
            clearParty: () => {
              // Assigned for real below.
            },
            setPartyLight: () => {
              // Assigned for real below.
            },
            floatText: () => {
              // Assigned for real below.
            },
            setRoamerPositions: () => {
              // Assigned for real below.
            },
            setCellSprite: () => {
              // Assigned for real below.
            },
            setPlacedEncounterPositions: () => {
              // Assigned for real below.
            },
            setSuppressedEncounterCells: () => {
              // Assigned for real below.
            },
            relight: (mode) => {
              // All lighting math lives in `sim/lighting.ts` and is
              // shared with the dungeon scene. We just consume the
              // result and apply tints to cells + overlays.
              // Painting view (sim off) → partyCol/Row are null →
              // helper falls back to "no party, no LOS gate" so
              // overworld twilight/night still reads sensibly even
              // before the user enters sim mode.
              const party =
                this.partyCol !== null && this.partyRow !== null
                  ? { col: this.partyCol, row: this.partyRow }
                  : null;
              const result = computeLighting({
                grid: gridRef.current as unknown as SimGrid,
                party,
                partyLight: partyLightRef.current,
                // Combined check — the ability has to be present
                // AND the player has to have engaged it. Either
                // alone disables the red band.
                partyInfravisionActive:
                  partyHasInfravisionRef.current &&
                  partyInfravisionActiveRef.current,
                mode,
              });
              // Phaser dispatch — `tintForCell` returns the tint
              // value; we always use multiply mode. v2 tile sprites
              // lean heavily on "mostly black with coloured detail
              // pixels" (grass = green specks on near-black bg).
              // Multiply preserves that look — the black stays
              // black and only the detail pixels read as red under
              // infravision, which lands closer to heat vision
              // than a uniform red fill that loses every detail.
              const applyTint = (
                img: Phaser.GameObjects.Image,
                col: number,
                row: number,
              ) => {
                const t = tintForCell(result, col, row);
                if (t.mode === "clear") img.clearTint();
                else img.setTint(t.value);
              };
              // Cells.
              for (const [key] of result.cells) {
                const img = this.cells.get(key);
                if (!img) continue;
                const [cs, rs] = key.split(",");
                applyTint(img, Number(cs), Number(rs));
              }
              // Placed overlays share their cell's render band so
              // a goblin in red infravision territory reads as red,
              // an item on a torchlit tile reads in grayscale.
              // Quest-glow / boat sprite / fill-preview stay
              // un-tinted — they're UI affordances, not part of the
              // diegetic world.
              for (const [key, img] of this.encounterOverlays) {
                const [cs, rs] = key.split(",");
                applyTint(img, Number(cs), Number(rs));
              }
              for (const [key, img] of this.itemOverlays) {
                const [cs, rs] = key.split(",");
                applyTint(img, Number(cs), Number(rs));
              }
              for (const [key, img] of this.npcOverlays) {
                const [cs, rs] = key.split(",");
                applyTint(img, Number(cs), Number(rs));
              }
              for (const [key, img] of this.questGiverOverlays) {
                const [cs, rs] = key.split(",");
                applyTint(img, Number(cs), Number(rs));
              }
              // Emitter visibility — particle animations (fairy
              // lights, smoke, fire on non-light-source cells)
              // render independent of the cell tint, so without
              // gating they'd float bright through dark areas the
              // party can't see. The shared rule hides emitters on
              // cells at ambient brightness OR infravision-red.
              //
              // Painting view (no party on the map) keeps every
              // emitter visible — authors need to see what they
              // painted while iterating, even in night mode.
              if (party !== null) {
                for (const [key, emitter] of this.emitters) {
                  const [cs, rs] = key.split(",");
                  emitter.setVisible(
                    emitterVisibleAt(result, Number(cs), Number(rs)),
                  );
                }
              } else {
                for (const emitter of this.emitters.values()) {
                  emitter.setVisible(true);
                }
              }
              // Loose boats render via the cell image itself
              // (texture-swapped between boat and water) so the
              // per-cell tint loop above already handles them.
              // The partyBoatSprite is a separate Image; clear its
              // tint in Day, leave alone otherwise (it follows the
              // party and the party owns the light pool around it).
              if (mode === "day" && this.partyBoatSprite) {
                this.partyBoatSprite.clearTint();
              }
            },
          };
          // Add the animation-refresh API so React can sync emitters
          // whenever cells change. Keep the existing relight API call
          // and the initial day-mode tint application below.
          const sceneSelf = this;
          if (sceneApiRef.current) {
            sceneApiRef.current.setPartyAt = (col, row, spritePath) => {
              // Capture the party's cell BEFORE drawing the sprite —
              // the shared lighting helper reads partyCol/Row to
              // root the 1-tile vision pool and gate torch LOS.
              // The bridge wires a relight call after every step,
              // so this stays current.
              sceneSelf.partyCol = col;
              sceneSelf.partyRow = row;
              // Lazy-create the sprite the first time the sim shows.
              // Anchored center for natural alignment with the cell.
              const px = col * TILE_SIZE + TILE_SIZE / 2;
              const py = row * TILE_SIZE + TILE_SIZE / 2;
              if (!sceneSelf.partySprite) {
                if (!spritePath || !sceneSelf.textures.exists(spritePath)) {
                  // Texture wasn't preloaded (empty path, mismatched
                  // file name, or party.json without a usable avatar).
                  // Warn so the user can fix the module's avatar
                  // value, then render a fallback marker so the user
                  // can still see where the party is on the map.
                  // eslint-disable-next-line no-console
                  console.warn(
                    `[sim] missing party sprite "${spritePath}" — ` +
                      `falling back to a marker. Check party.avatar ` +
                      `in this module's party.json.`,
                  );
                  // Generate a one-off ember circle the first time
                  // we need a fallback, then reuse it.
                  const MARKER_KEY = "__party_marker";
                  if (!sceneSelf.textures.exists(MARKER_KEY)) {
                    const g = sceneSelf.add.graphics();
                    g.fillStyle(0xffb84d, 1);
                    g.fillCircle(16, 16, 13);
                    g.lineStyle(2, 0x4a1c00, 1);
                    g.strokeCircle(16, 16, 13);
                    g.generateTexture(MARKER_KEY, 32, 32);
                    g.destroy();
                  }
                  sceneSelf.partySprite = sceneSelf.add
                    .image(px, py, MARKER_KEY)
                    .setOrigin(0.5)
                    .setDisplaySize(TILE_SIZE, TILE_SIZE)
                    .setDepth(300);
                  return;
                }
                sceneSelf.partySprite = sceneSelf.add
                  .image(px, py, spritePath)
                  .setOrigin(0.5)
                  .setDisplaySize(TILE_SIZE, TILE_SIZE)
                  // Above grid lines (100), override markers (150),
                  // emitters (160), selection (200), and the encounter/
                  // item overlays (70-80).
                  .setDepth(300);
              } else {
                sceneSelf.partySprite.setPosition(px, py);
                if (
                  spritePath &&
                  sceneSelf.textures.exists(spritePath) &&
                  sceneSelf.partySprite.texture.key !== spritePath
                ) {
                  sceneSelf.partySprite.setTexture(spritePath);
                }
              }
            };
            sceneApiRef.current.clearParty = () => {
              if (sceneSelf.partySprite) {
                sceneSelf.partySprite.destroy();
                sceneSelf.partySprite = null;
              }
              // Also drop the party-boat sprite if the sim shut down
              // while the party was aboard.
              if (sceneSelf.partyBoatSprite) {
                sceneSelf.tweens.killTweensOf(sceneSelf.partyBoatSprite);
                sceneSelf.partyBoatSprite.destroy();
                sceneSelf.partyBoatSprite = null;
              }
              // Sim is leaving — the painting view's relight pass
              // should run without a party (no LOS gating). Null
              // out the tracked position so the shared lighting
              // helper picks up the right branch.
              sceneSelf.partyCol = null;
              sceneSelf.partyRow = null;
            };
            // Floater for tile.text. Spawned about two tiles above
            // the cell so the party sprite doesn't sit on top of the
            // text — without that offset the label kept getting eaten
            // by the avatar in the first half-second when the player
            // most wants to read it. Depth 320 sits above the party
            // sprite (300) and any grid / encounter overlays.
            //
            // Lifecycle: hold for a moment at full opacity so the
            // player has a chance to start reading, THEN rise + fade.
            // Total visible time is ~3.4s (700ms hold + 2700ms drift),
            // and the wordWrap is generous so multi-sentence text
            // entries don't shoot off the canvas edge.
            sceneApiRef.current.floatText = (col, row, text) => {
              const trimmed = (text ?? "").trim();
              if (!trimmed) return;
              const px = col * TILE_SIZE + TILE_SIZE / 2;
              // Lift the label ~2 tiles above the cell centre so the
              // party sprite (centred on the cell) doesn't overlap
              // it. The origin is bottom-centred (0.5, 1) so the
              // anchor sits at the top of the gap.
              const py = row * TILE_SIZE + TILE_SIZE / 2 - TILE_SIZE * 2;
              const FONT = {
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "10px",
                color: "#fff2c8",
                stroke: "#1a0e00",
                strokeThickness: 3,
                align: "center" as const,
                wordWrap: { width: TILE_SIZE * 8, useAdvancedWrap: true },
              };
              const label = sceneSelf.add
                .text(px, py, trimmed, FONT)
                .setOrigin(0.5, 1)
                .setDepth(320);
              // Drop shadow for legibility over light tiles — second
              // text under the main one, slightly offset and dim.
              const shadow = sceneSelf.add
                .text(px + 1, py + 2, trimmed, {
                  ...FONT,
                  color: "#000000",
                  stroke: "#000000",
                  strokeThickness: 0,
                })
                .setOrigin(0.5, 1)
                .setAlpha(0.35)
                .setDepth(319);
              const rise = 32;
              const holdMs = 700;
              const driftMs = 2700;
              // First tween: hold in place at full opacity so the
              // player can start reading before motion kicks in.
              sceneSelf.tweens.add({
                targets: [label, shadow],
                alpha: { from: 1, to: 1 },
                duration: holdMs,
                onComplete: () => {
                  // Second tween: rise + fade. We destroy both pieces
                  // when the drift finishes so the scene stays clean
                  // even if the party walks across a string of
                  // text-bearing cells.
                  sceneSelf.tweens.add({
                    targets: [label, shadow],
                    y: `-=${rise}`,
                    alpha: 0,
                    duration: driftMs,
                    ease: "Sine.easeOut",
                    onComplete: () => {
                      label.destroy();
                      shadow.destroy();
                    },
                  });
                },
              });
            };
            // ── Boat helpers ───────────────────────────────────────────
            // Boats render via cell-texture swaps, not extra overlay
            // sprites. The cell image at a boat's position carries the
            // boat texture; when the party boards we swap that cell to
            // a water texture and show the partyBoatSprite instead.
            //
            //   1. applyBoatBob — perpetual sin-wave y tween so the
            //      partyBoatSprite rocks gently on the water.
            //   2. setBoatPositions — diffs the host-supplied set of
            //      loose boats; cells that lost their boat get the
            //      water sprite, cells that gained one get the boat's
            //      sprite. The map cell IS the boat.
            //   3. setPartyBoatAt — lazily creates the partyBoatSprite
            //      while aboard; hides the partySprite at the same
            //      time so the party visually IS the boat.
            const WATER_SPRITE = WATER_SPRITE_KEY;
            const applyBoatBob = (img: Phaser.GameObjects.Image) => {
              img.setData("baseY", img.y);
              sceneSelf.tweens.add({
                targets: img,
                y: img.y - 2,
                duration: 900,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
              });
            };
            const repositionWithBob = (
              img: Phaser.GameObjects.Image,
              col: number,
              row: number,
            ) => {
              sceneSelf.tweens.killTweensOf(img);
              img.setPosition(
                col * TILE_SIZE + TILE_SIZE / 2,
                row * TILE_SIZE + TILE_SIZE / 2,
              );
              applyBoatBob(img);
            };
            sceneApiRef.current.setBoatPositions = (positions) => {
              const wanted = new Map(
                positions.map((p) => [`${p.col},${p.row}`, p.sprite]),
              );
              // Cells that lost their boat (party just boarded here)
              // get swapped back to the water sprite.
              for (const [key, _sprite] of sceneSelf.boatTextures) {
                if (wanted.has(key)) continue;
                const baseImg = sceneSelf.cells.get(key);
                if (
                  baseImg &&
                  WATER_SPRITE &&
                  sceneSelf.textures.exists(WATER_SPRITE)
                ) {
                  baseImg.setTexture(WATER_SPRITE);
                }
                sceneSelf.boatTextures.delete(key);
                // Silence unused-binding warnings without using `_`
                // in a way that complicates the destructure.
                void _sprite;
              }
              // Cells that gained a boat (disembarked here, or sim
              // start-up) get the boat sprite painted in.
              for (const [key, sprite] of wanted) {
                if (sceneSelf.boatTextures.get(key) === sprite) continue;
                const baseImg = sceneSelf.cells.get(key);
                if (
                  baseImg &&
                  sprite &&
                  sceneSelf.textures.exists(sprite)
                ) {
                  baseImg.setTexture(sprite);
                }
                sceneSelf.boatTextures.set(key, sprite);
              }
            };
            sceneApiRef.current.setPartyBoatAt = (
              col,
              row,
              visible,
              sprite,
            ) => {
              if (!visible) {
                if (sceneSelf.partyBoatSprite) {
                  sceneSelf.tweens.killTweensOf(sceneSelf.partyBoatSprite);
                  sceneSelf.partyBoatSprite.destroy();
                  sceneSelf.partyBoatSprite = null;
                }
                // Party is on land again — restore its sprite.
                if (sceneSelf.partySprite) {
                  sceneSelf.partySprite.setVisible(true);
                }
                return;
              }
              // Resolve the sprite to render. Prefer the caller's
              // explicit arg (board); fall back to the live texture
              // (sail) since the boat already has one.
              const resolved =
                sprite ?? sceneSelf.partyBoatSprite?.texture.key ?? "";
              if (!resolved || !sceneSelf.textures.exists(resolved)) return;
              if (!sceneSelf.partyBoatSprite) {
                sceneSelf.partyBoatSprite = sceneSelf.add
                  .image(
                    col * TILE_SIZE + TILE_SIZE / 2,
                    row * TILE_SIZE + TILE_SIZE / 2,
                    resolved,
                  )
                  .setOrigin(0.5)
                  .setDisplaySize(TILE_SIZE, TILE_SIZE)
                  // Above floors / items / encounters / NPCs (≤ 80),
                  // at the same depth band the party uses so the boat
                  // visually "is" the party while the partySprite is
                  // hidden.
                  .setDepth(300);
                applyBoatBob(sceneSelf.partyBoatSprite);
              } else {
                if (
                  sprite &&
                  sceneSelf.partyBoatSprite.texture.key !== sprite
                ) {
                  sceneSelf.partyBoatSprite.setTexture(sprite);
                }
                repositionWithBob(sceneSelf.partyBoatSprite, col, row);
              }
              // Hide the party sprite — the boat IS the party.
              if (sceneSelf.partySprite) {
                sceneSelf.partySprite.setVisible(false);
              }
            };
            sceneApiRef.current.setPartyLight = (source) => {
              partyLightRef.current = source;
              // Caller is expected to call relight() right after for
              // an instant visual update, but we set the ref here so
              // even a stale relight picks up the new source.
            };
            // Roamer rendering — one Image per live SimRoamer. Diffs
            // against the previously-drawn set: drop sprites for ids
            // that vanished, snap surviving ids to their new cell,
            // create fresh ones for new entries.
            sceneApiRef.current.setRoamerPositions = (positions) => {
              const wanted = new Map(positions.map((p) => [p.id, p]));
              // Drop sprites for ids that left the list.
              for (const [id, img] of sceneSelf.roamerSprites) {
                if (wanted.has(id)) continue;
                img.destroy();
                sceneSelf.roamerSprites.delete(id);
              }
              // Update / create the wanted entries.
              for (const [id, p] of wanted) {
                const px = p.col * TILE_SIZE + TILE_SIZE / 2;
                const py = p.row * TILE_SIZE + TILE_SIZE / 2;
                let img = sceneSelf.roamerSprites.get(id);
                if (!img) {
                  // Fall back to a roamer-marker dot when the
                  // monster's sprite didn't preload (missing
                  // sprite path, typo). The roamer still moves;
                  // the user sees "something" is chasing them.
                  const ROAMER_MARKER_KEY = "__roamer_marker";
                  const texKey =
                    p.sprite && sceneSelf.textures.exists(p.sprite)
                      ? p.sprite
                      : ROAMER_MARKER_KEY;
                  if (
                    texKey === ROAMER_MARKER_KEY &&
                    !sceneSelf.textures.exists(texKey)
                  ) {
                    const g = sceneSelf.add.graphics();
                    g.fillStyle(0xb84d4d, 1);
                    g.fillCircle(16, 16, 12);
                    g.lineStyle(2, 0x4a1c00, 1);
                    g.strokeCircle(16, 16, 12);
                    g.generateTexture(texKey, 32, 32);
                    g.destroy();
                  }
                  img = sceneSelf.add
                    .image(px, py, texKey)
                    .setOrigin(0.5)
                    .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
                    // Below the party sprite (300) so a collision
                    // visually reads "party on top of monster," but
                    // above encounter overlays (80) and NPCs (75).
                    .setDepth(250);
                  sceneSelf.roamerSprites.set(id, img);
                } else {
                  img.setPosition(px, py);
                  if (
                    p.sprite &&
                    sceneSelf.textures.exists(p.sprite) &&
                    img.texture.key !== p.sprite
                  ) {
                    img.setTexture(p.sprite);
                  }
                }
              }
            };
            // Destroy-lair texture swap. Replaces the base cell
            // image's texture with the supplied sprite and clears
            // its tint so the freshly-revealed grass doesn't keep
            // the spawn-tile lighting. Also re-runs the encounter /
            // animation passes — destroying a spawn cell may have
            // cleared overlay state the diffs need to see.
            sceneApiRef.current.setCellSprite = (col, row, sprite) => {
              const key = `${col},${row}`;
              const img = sceneSelf.cells.get(key);
              if (!img) return;
              if (sprite && sceneSelf.textures.exists(sprite)) {
                img.setTexture(sprite);
              }
              // The animation/encounter/etc. overlays on this cell
              // (if any) are tied to the cell's other fields; the
              // destroy path also cleared the spawn id off the cell,
              // so the next refresh pass will pick that up. No
              // explicit refresh here — callers run them on a state
              // tick anyway.
            };
            // Placed-encounter rendering — same diff'd-update pattern
            // as roamers. Distinct map so suppression bookkeeping
            // doesn't have to differentiate; both render at depth 250.
            sceneApiRef.current.setPlacedEncounterPositions = (positions) => {
              const wanted = new Map(positions.map((p) => [p.id, p]));
              for (const [id, img] of sceneSelf.placedEncounterSprites) {
                if (wanted.has(id)) continue;
                img.destroy();
                sceneSelf.placedEncounterSprites.delete(id);
              }
              for (const [id, p] of wanted) {
                const px = p.col * TILE_SIZE + TILE_SIZE / 2;
                const py = p.row * TILE_SIZE + TILE_SIZE / 2;
                let img = sceneSelf.placedEncounterSprites.get(id);
                if (!img) {
                  // Encounter sprites come from monster_party_tile —
                  // already a "monster/foo.png" path. Fall back to a
                  // marker dot when the texture didn't preload.
                  const ENC_MARKER_KEY = "__placed_encounter_marker";
                  const texKey =
                    p.sprite && sceneSelf.textures.exists(p.sprite)
                      ? p.sprite
                      : ENC_MARKER_KEY;
                  if (
                    texKey === ENC_MARKER_KEY &&
                    !sceneSelf.textures.exists(texKey)
                  ) {
                    const g = sceneSelf.add.graphics();
                    g.fillStyle(0xc66666, 1);
                    g.fillCircle(16, 16, 12);
                    g.lineStyle(2, 0x4a1c00, 1);
                    g.strokeCircle(16, 16, 12);
                    g.generateTexture(texKey, 32, 32);
                    g.destroy();
                  }
                  img = sceneSelf.add
                    .image(px, py, texKey)
                    .setOrigin(0.5)
                    .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
                    // Same depth band as roamers — both are "monsters
                    // pursuing the party."
                    .setDepth(250);
                  sceneSelf.placedEncounterSprites.set(id, img);
                } else {
                  img.setPosition(px, py);
                  if (
                    p.sprite &&
                    sceneSelf.textures.exists(p.sprite) &&
                    img.texture.key !== p.sprite
                  ) {
                    img.setTexture(p.sprite);
                  }
                }
              }
            };
            // Suppression set for the static cell-encounter overlay.
            // Updating the set destroys any existing overlay for the
            // newly-suppressed cells; calling refreshEncounterOverlays
            // afterwards is a no-op for those (the diff sees no change).
            // Cells that LEAVE the suppression set get re-rendered
            // through a fresh refresh pass, which we also trigger so
            // sim teardown restores the painted overlays without the
            // caller doing it explicitly.
            sceneApiRef.current.setSuppressedEncounterCells = (cells) => {
              const next = new Set(cells);
              const prev = sceneSelf.suppressedEncounterCells;
              // Drop overlays for cells that just got suppressed.
              for (const key of next) {
                if (prev.has(key)) continue;
                const existing = sceneSelf.encounterOverlays.get(key);
                if (existing) {
                  existing.destroy();
                  sceneSelf.encounterOverlays.delete(key);
                  sceneSelf.encounterOverlayIds.delete(key);
                }
              }
              sceneSelf.suppressedEncounterCells = next;
              // Cells that just LEFT the suppression set need their
              // overlays brought back — refreshEncounterOverlays
              // sees a missing overlay for a still-set encounter id
              // and recreates it. Safe to call on every change since
              // it's diff'd internally.
              sceneApiRef.current?.refreshEncounterOverlays();
            };
          }
          if (sceneApiRef.current) {
            sceneApiRef.current.refreshEncounterOverlays = () => {
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const encId = cell?.encounter ?? "";
                  const key = `${c},${r}`;
                  // Sim-mode override: cells whose static overlay is
                  // suppressed (because a live placed encounter is
                  // standing in for it) don't get painted here. Treat
                  // them as "no encounter" from this pass's POV — any
                  // existing overlay is torn down, no new one created.
                  const suppressed =
                    sceneSelf.suppressedEncounterCells.has(key);
                  const effectiveId = suppressed ? "" : encId;
                  const currentId =
                    sceneSelf.encounterOverlayIds.get(key) ?? "";
                  if (effectiveId === currentId) continue;
                  // Remove the existing overlay (if any).
                  const existing = sceneSelf.encounterOverlays.get(key);
                  if (existing) {
                    existing.destroy();
                    sceneSelf.encounterOverlays.delete(key);
                    sceneSelf.encounterOverlayIds.delete(key);
                  }
                  if (!effectiveId) continue;
                  const enc = encountersById.get(effectiveId);
                  const sprite = enc?.monster_party_tile;
                  if (
                    !sprite ||
                    !sprite.includes("/") ||
                    !sceneSelf.textures.exists(sprite)
                  ) {
                    // No sprite or texture wasn't preloaded — track the
                    // id so we don't repeatedly retry, but don't draw.
                    sceneSelf.encounterOverlayIds.set(key, effectiveId);
                    continue;
                  }
                  const img = sceneSelf.add
                    .image(
                      c * TILE_SIZE + TILE_SIZE / 2,
                      r * TILE_SIZE + TILE_SIZE / 2,
                      sprite,
                    )
                    .setOrigin(0.5)
                    .setDisplaySize(TILE_SIZE, TILE_SIZE)
                    .setDepth(80);
                  // Match the base cell's current lighting tint so the
                  // overlay doesn't pop bright in a dim/dark cell until
                  // the next relight pass.
                  const baseImg = sceneSelf.cells.get(key);
                  if (baseImg && baseImg.isTinted) {
                    img.setTint(baseImg.tintTopLeft);
                  }
                  sceneSelf.encounterOverlays.set(key, img);
                  sceneSelf.encounterOverlayIds.set(key, effectiveId);
                }
              }
            };
            sceneApiRef.current.refreshItemOverlays = () => {
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const itemId = cell?.item ?? "";
                  const key = `${c},${r}`;
                  const currentId =
                    sceneSelf.itemOverlayIds.get(key) ?? "";
                  if (itemId === currentId) continue;
                  // Remove the existing overlay (if any).
                  const existing = sceneSelf.itemOverlays.get(key);
                  if (existing) {
                    existing.destroy();
                    sceneSelf.itemOverlays.delete(key);
                    sceneSelf.itemOverlayIds.delete(key);
                  }
                  if (!itemId) continue;
                  const item = itemsById.get(itemId);
                  const icon = item?.icon;
                  const sprite = icon ? `item/${icon}.png` : "";
                  if (!sprite || !sceneSelf.textures.exists(sprite)) {
                    // No icon or texture wasn't preloaded — track the
                    // id so we don't repeatedly retry, but don't draw.
                    sceneSelf.itemOverlayIds.set(key, itemId);
                    continue;
                  }
                  const img = sceneSelf.add
                    .image(
                      c * TILE_SIZE + TILE_SIZE / 2,
                      r * TILE_SIZE + TILE_SIZE / 2,
                      sprite,
                    )
                    .setOrigin(0.5)
                    // Items render slightly smaller than the cell so the
                    // floor tile is still visible around them — the
                    // "item dropped on the floor" look from v1.
                    .setDisplaySize(TILE_SIZE * 0.7, TILE_SIZE * 0.7)
                    // Above the base cell, below encounter overlays so
                    // a monster sprite covers a dropped item if both
                    // happen to share a tile.
                    .setDepth(70);
                  // Match the base cell's current lighting tint so a
                  // newly-dropped item doesn't pop bright in a dim/dark
                  // cell until the next relight pass.
                  const baseImg = sceneSelf.cells.get(key);
                  if (baseImg && baseImg.isTinted) {
                    img.setTint(baseImg.tintTopLeft);
                  }
                  sceneSelf.itemOverlays.set(key, img);
                  sceneSelf.itemOverlayIds.set(key, itemId);
                }
              }
            };
            sceneApiRef.current.refreshNpcOverlays = () => {
              // Same diff'd-overlay pattern as items/encounters: walk
              // every cell, compare its current npc id to the one we
              // last rendered, and only mutate the scene where it
              // changed. NPC sprites render slightly above items but
              // below encounters so a tile carrying both a dropped
              // item and a stationed NPC reads "person standing on
              // the dropped thing."
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const npcId = cell?.npc ?? "";
                  const key = `${c},${r}`;
                  const currentId =
                    sceneSelf.npcOverlayIds.get(key) ?? "";
                  if (npcId === currentId) continue;
                  // Remove any existing overlay first.
                  const existing = sceneSelf.npcOverlays.get(key);
                  if (existing) {
                    existing.destroy();
                    sceneSelf.npcOverlays.delete(key);
                    sceneSelf.npcOverlayIds.delete(key);
                  }
                  if (!npcId) continue;
                  const npc = npcsById.get(npcId);
                  const spriteKey = resolveNpcSpriteKey(npc?.sprite);
                  if (!spriteKey || !sceneSelf.textures.exists(spriteKey)) {
                    // No sprite (or texture didn't preload) — record
                    // the id so we don't retry every refresh.
                    sceneSelf.npcOverlayIds.set(key, npcId);
                    continue;
                  }
                  const img = sceneSelf.add
                    .image(
                      c * TILE_SIZE + TILE_SIZE / 2,
                      r * TILE_SIZE + TILE_SIZE / 2,
                      spriteKey,
                    )
                    .setOrigin(0.5)
                    // Cover most of the cell — NPCs are people, not
                    // dropped objects; they should read at roughly
                    // the same scale as a party member would.
                    .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
                    // Above items (70) and below encounter monsters
                    // (80) so a wandering monster overrides a
                    // stationary NPC if they happen to share a tile.
                    .setDepth(75);
                  const baseImg = sceneSelf.cells.get(key);
                  if (baseImg && baseImg.isTinted) {
                    img.setTint(baseImg.tintTopLeft);
                  }
                  sceneSelf.npcOverlays.set(key, img);
                  sceneSelf.npcOverlayIds.set(key, npcId);
                }
              }
            };
            sceneApiRef.current.refreshQuestOverlays = () => {
              // ── Quest-giver sprite overlay ────────────────────────
              // Diff'd against questGiverIds so unchanged cells skip
              // sprite re-creation. Mirrors the encounter/item layer.
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const questId = cell?.quest ?? "";
                  const key = `${c},${r}`;
                  const currentId =
                    sceneSelf.questGiverIds.get(key) ?? "";
                  if (questId === currentId) continue;
                  const existing = sceneSelf.questGiverOverlays.get(key);
                  if (existing) {
                    existing.destroy();
                    sceneSelf.questGiverOverlays.delete(key);
                    sceneSelf.questGiverIds.delete(key);
                  }
                  if (!questId) continue;
                  const quest = questsById.get(questId);
                  const sprite = quest?.quest_giver?.npc_sprite;
                  if (
                    !sprite ||
                    !sprite.includes("/") ||
                    !sceneSelf.textures.exists(sprite)
                  ) {
                    sceneSelf.questGiverIds.set(key, questId);
                    continue;
                  }
                  const img = sceneSelf.add
                    .image(
                      c * TILE_SIZE + TILE_SIZE / 2,
                      r * TILE_SIZE + TILE_SIZE / 2,
                      sprite,
                    )
                    .setOrigin(0.5)
                    .setDisplaySize(TILE_SIZE, TILE_SIZE)
                    // Above items (70) and encounters (80) so the
                    // quest-giver sits on top of any monster sprite
                    // sharing the cell.
                    .setDepth(85);
                  const baseImg = sceneSelf.cells.get(key);
                  if (baseImg && baseImg.isTinted) {
                    img.setTint(baseImg.tintTopLeft);
                  }
                  sceneSelf.questGiverOverlays.set(key, img);
                  sceneSelf.questGiverIds.set(key, questId);
                }
              }
              // ── Golden quest-relevance halo ───────────────────────
              // Computed wholesale each refresh — cheap, since the
              // total set is small and Graphics redraw is fast.
              // Per-cell brightness comes from the base cell's
              // current tint (relight has already painted it). Untinted
              // cells (Day mode) get full brightness; tinted cells get
              // a halo whose RGB is multiplied by the same brightness
              // applied to the scene, so the halo dims uniformly with
              // the rest of the world.
              const g = sceneSelf.questGlowGraphics;
              if (!g) return;
              g.clear();
              const glowCells = computeQuestGlowCells(
                gridRef.current,
                availableQuests,
                encounters,
              );
              const BASE_R = 0xff;
              const BASE_G = 0xd7;
              const BASE_B = 0x50;
              const HALO_ALPHA = 0.22;
              for (const key of glowCells) {
                const [csStr, rsStr] = key.split(",");
                const cs = Number(csStr);
                const rs = Number(rsStr);
                if (!Number.isFinite(cs) || !Number.isFinite(rs)) continue;
                // Read brightness from the base sprite's current tint.
                // relight applies a grayscale tint where all three
                // channels are equal, so the low byte is the brightness
                // level 0..255.
                let brightness = 1;
                const baseImg = sceneSelf.cells.get(key);
                if (baseImg && baseImg.isTinted) {
                  brightness = (baseImg.tintTopLeft & 0xff) / 255;
                }
                const r = Math.round(BASE_R * brightness);
                const gg = Math.round(BASE_G * brightness);
                const b = Math.round(BASE_B * brightness);
                const color = (r << 16) | (gg << 8) | b;
                g.fillStyle(color, HALO_ALPHA);
                const cx = cs * TILE_SIZE + TILE_SIZE / 2;
                const cy = rs * TILE_SIZE + TILE_SIZE / 2;
                // Slightly wider than the cell so the halo bleeds
                // past the sprite edges.
                g.fillCircle(cx, cy, TILE_SIZE * 0.72);
              }
            };
            sceneApiRef.current.refreshAnimations = () => {
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const kind = (cell?.animation ?? "none") as
                    | "none"
                    | AnimationKind;
                  const key = `${c},${r}`;
                  const currentKind = sceneSelf.emitterKinds.get(key);
                  if (kind === "none") {
                    if (currentKind) {
                      sceneSelf.emitters.get(key)?.destroy();
                      sceneSelf.emitters.delete(key);
                      sceneSelf.emitterKinds.delete(key);
                    }
                    continue;
                  }
                  if (currentKind === kind) continue;
                  // Replace existing emitter (different kind, or none).
                  sceneSelf.emitters.get(key)?.destroy();
                  const cfg = ANIMATION_CONFIGS[kind as AnimationKind];
                  const x = c * TILE_SIZE + TILE_SIZE / 2;
                  const y = r * TILE_SIZE + TILE_SIZE / 2;
                  const emitter = sceneSelf.add.particles(
                    x,
                    y,
                    "__particle",
                    cfg as unknown as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
                  );
                  // Above grid lines, below selection.
                  emitter.setDepth(160);
                  sceneSelf.emitters.set(key, emitter);
                  sceneSelf.emitterKinds.set(key, kind as AnimationKind);
                }
              }
            };
          }

          // Initial light pass — picks up Day default until React
          // pushes the current mode in via the lighting useEffect.
          sceneApiRef.current.relight("day");
          // Initial animation pass — seeds emitters for any cells
          // whose data carries animation values on load.
          sceneApiRef.current.refreshAnimations();
          // Initial encounter-overlay pass — seeds sprites for cells
          // whose encounter is set at load time.
          sceneApiRef.current.refreshEncounterOverlays();
          // Initial item-overlay pass — seeds sprites for cells whose
          // item is set at load time.
          sceneApiRef.current.refreshItemOverlays();
          // Initial NPC-overlay pass — seeds sprites for cells whose
          // npc is set at load time.
          sceneApiRef.current.refreshNpcOverlays();
          // Initial quest-overlay pass — seeds quest-giver sprites
          // for any cell with `quest` set, and draws the golden glow
          // behind quest-relevant cells (givers + matching encounters
          // + matching items).
          sceneApiRef.current.refreshQuestOverlays();
        }

        paintAt(p: Phaser.Input.Pointer) {
          const c = Math.floor(p.x / TILE_SIZE);
          const r = Math.floor(p.y / TILE_SIZE);
          if (
            c < 0 ||
            r < 0 ||
            c >= mapRecord.width ||
            r >= mapRecord.height
          )
            return;
          // Simulation modes intercept the canvas click. "placing"
          // routes the click into the spawn picker; "active" swallows
          // the click entirely (movement is keyboard-driven, mouse
          // clicks shouldn't repaint cells underneath the party).
          if (simModeRef.current === "placing") {
            onSimPlaceRef.current(c, r);
            return;
          }
          if (simModeRef.current === "active") return;
          // Selection always follows the cursor — both tools update it.
          onCellTouchedRef.current(c, r);
          // Inspect + Pan + Fill never paint via this path; just
          // selecting is the whole job here. Pan-mode drags are
          // normally swallowed by the React-layer capture handler
          // before Phaser sees them, but guard anyway so a stray
          // click can't repaint a cell unexpectedly. Fill uses its
          // own pointerdown/move/up handlers below.
          if (
            toolRef.current === "inspect" ||
            toolRef.current === "pan" ||
            toolRef.current === "fill"
          )
            return;
          const brush = brushRef.current;
          if (!brush) return;
          const brushTile = paletteById.get(brush);
          if (!brushTile) return;
          // Skip if the cell already equals the brush tile field-for-
          // field (drag-over of already-painted cells is a hot path).
          const existing = gridRef.current[r][c];
          if (
            existing &&
            existing.id === brushTile.id &&
            existing.name === brushTile.name &&
            (existing.tag ?? "") === (brushTile.tag ?? "") &&
            existing.walkable === brushTile.walkable &&
            existing.obstructs === brushTile.obstructs &&
            (existing.boat ?? false) === (brushTile.boat ?? false) &&
            (existing.text ?? "") === (brushTile.text ?? "") &&
            (existing.locked ?? false) === (brushTile.locked ?? false) &&
            (existing.light_source ?? false) ===
              (brushTile.light_source ?? false) &&
            (existing.light_range ?? 0) === (brushTile.light_range ?? 0) &&
            (existing.animation ?? "none") ===
              (brushTile.animation ?? "none") &&
            (existing.counter ?? "") === (brushTile.counter ?? "") &&
            (existing.encounter ?? "") === (brushTile.encounter ?? "") &&
            (existing.spawn ?? "") === (brushTile.spawn ?? "") &&
            (existing.item ?? "") === (brushTile.item ?? "") &&
            (existing.quest ?? "") === (brushTile.quest ?? "") &&
            (existing.dungeon ?? "") === (brushTile.dungeon ?? "") &&
            (existing.npc ?? "") === (brushTile.npc ?? "") &&
            existing.sprite === brushTile.sprite &&
            JSON.stringify(existing.link ?? null) ===
              JSON.stringify(brushTile.link ?? null)
          ) {
            return;
          }
          // Paint = fresh deep-copy of the palette entry. Every field
          // materializes inline; the cell is its own data from here.
          const fresh: TileType = { ...brushTile };
          gridRef.current[r][c] = fresh;
          const img = this.cells.get(`${c},${r}`);
          if (img && fresh.sprite && this.textures.exists(fresh.sprite)) {
            img.setTexture(fresh.sprite);
          }
          persistRef.current();
        }

        /** Fill tool — pointerdown. Remember the starting cell and
         *  draw a single-cell preview rect. Simulation-mode hooks
         *  match paintAt so the fill tool can't accidentally hijack
         *  a sim placement or click. */
        fillStart(p: Phaser.Input.Pointer) {
          const c = Math.floor(p.x / TILE_SIZE);
          const r = Math.floor(p.y / TILE_SIZE);
          if (
            c < 0 ||
            r < 0 ||
            c >= mapRecord.width ||
            r >= mapRecord.height
          )
            return;
          if (simModeRef.current === "placing") {
            onSimPlaceRef.current(c, r);
            return;
          }
          if (simModeRef.current === "active") return;
          onCellTouchedRef.current(c, r);
          fillStartRef.current = { col: c, row: r };
          this.drawFillPreview(c, r, c, r);
        }

        /** Fill tool — pointermove while the button is held. Updates
         *  the preview rectangle's far corner to the cursor cell
         *  (clamped to the map). */
        fillDrag(p: Phaser.Input.Pointer) {
          const start = fillStartRef.current;
          if (!start) return;
          const c = Math.floor(p.x / TILE_SIZE);
          const r = Math.floor(p.y / TILE_SIZE);
          const cc = Math.max(0, Math.min(mapRecord.width - 1, c));
          const rr = Math.max(0, Math.min(mapRecord.height - 1, r));
          onCellTouchedRef.current(cc, rr);
          this.drawFillPreview(start.col, start.row, cc, rr);
        }

        /** Fill tool — pointerup. Commits every cell inside the
         *  rectangle defined by the press point and the release
         *  point. Identical cells short-circuit so only changed
         *  cells get reassigned + their texture refreshed, then
         *  persistRef fires once for the whole batch. */
        fillCommit(p: Phaser.Input.Pointer) {
          const start = fillStartRef.current;
          fillStartRef.current = null;
          if (this.fillPreviewGraphics) this.fillPreviewGraphics.clear();
          if (!start) return;
          if (
            simModeRef.current === "placing" ||
            simModeRef.current === "active"
          )
            return;
          const c = Math.floor(p.x / TILE_SIZE);
          const r = Math.floor(p.y / TILE_SIZE);
          const cc = Math.max(0, Math.min(mapRecord.width - 1, c));
          const rr = Math.max(0, Math.min(mapRecord.height - 1, r));
          const brush = brushRef.current;
          if (!brush) return;
          const brushTile = paletteById.get(brush);
          if (!brushTile) return;
          const c0 = Math.min(start.col, cc);
          const c1 = Math.max(start.col, cc);
          const r0 = Math.min(start.row, rr);
          const r1 = Math.max(start.row, rr);
          let changed = false;
          for (let row = r0; row <= r1; row++) {
            for (let col = c0; col <= c1; col++) {
              const existing = gridRef.current[row][col];
              if (
                existing &&
                existing.id === brushTile.id &&
                existing.name === brushTile.name &&
                (existing.tag ?? "") === (brushTile.tag ?? "") &&
                existing.walkable === brushTile.walkable &&
                existing.obstructs === brushTile.obstructs &&
                (existing.boat ?? false) === (brushTile.boat ?? false) &&
                (existing.text ?? "") === (brushTile.text ?? "") &&
                (existing.locked ?? false) === (brushTile.locked ?? false) &&
                (existing.light_source ?? false) ===
                  (brushTile.light_source ?? false) &&
                (existing.light_range ?? 0) ===
                  (brushTile.light_range ?? 0) &&
                (existing.animation ?? "none") ===
                  (brushTile.animation ?? "none") &&
                (existing.counter ?? "") === (brushTile.counter ?? "") &&
                (existing.encounter ?? "") ===
                  (brushTile.encounter ?? "") &&
                (existing.spawn ?? "") === (brushTile.spawn ?? "") &&
                (existing.item ?? "") === (brushTile.item ?? "") &&
                (existing.quest ?? "") === (brushTile.quest ?? "") &&
                (existing.dungeon ?? "") === (brushTile.dungeon ?? "") &&
                existing.sprite === brushTile.sprite &&
                JSON.stringify(existing.link ?? null) ===
                  JSON.stringify(brushTile.link ?? null)
              ) {
                continue;
              }
              const fresh: TileType = { ...brushTile };
              gridRef.current[row][col] = fresh;
              const img = this.cells.get(`${col},${row}`);
              if (
                img &&
                fresh.sprite &&
                this.textures.exists(fresh.sprite)
              ) {
                img.setTexture(fresh.sprite);
              }
              changed = true;
            }
          }
          onCellTouchedRef.current(cc, rr);
          if (changed) persistRef.current();
        }

        /** Render the Fill-tool's preview rectangle between two cell
         *  coords. The rect is normalized — caller can pass corners
         *  in any order. */
        drawFillPreview(
          c0In: number,
          r0In: number,
          c1In: number,
          r1In: number,
        ) {
          if (!this.fillPreviewGraphics) return;
          const c0 = Math.min(c0In, c1In);
          const c1 = Math.max(c0In, c1In);
          const r0 = Math.min(r0In, r1In);
          const r1 = Math.max(r0In, r1In);
          this.fillPreviewGraphics.clear();
          this.fillPreviewGraphics.fillStyle(0xffb84d, 0.18);
          this.fillPreviewGraphics.fillRect(
            c0 * TILE_SIZE,
            r0 * TILE_SIZE,
            (c1 - c0 + 1) * TILE_SIZE,
            (r1 - r0 + 1) * TILE_SIZE,
          );
          this.fillPreviewGraphics.lineStyle(2, 0xffb84d, 0.9);
          this.fillPreviewGraphics.strokeRect(
            c0 * TILE_SIZE,
            r0 * TILE_SIZE,
            (c1 - c0 + 1) * TILE_SIZE,
            (r1 - r0 + 1) * TILE_SIZE,
          );
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: mapRecord.width * TILE_SIZE,
        height: mapRecord.height * TILE_SIZE,
        parent: containerRef.current,
        scene: MapScene,
        backgroundColor: "#0a0908",
        // No banner spam in dev console.
        banner: false,
      } as Phaser.Types.Core.GameConfig);
    })();

    return () => {
      cancelled = true;
      if (game) {
        game.destroy(true);
        game = null;
      }
      sceneApiRef.current = null;
    };
    // Only rebuild the scene when the map identity changes — paint
    // updates patch the existing scene in-place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === "ok" ? state.mapRecord.id : null]);

  // ── Simulation mode lifecycle ───────────────────────────────────
  /** Pending spawn position for the next sim mount. Set by either:
   *   - the URL-query auto-entry (link traversal landed us here), or
   *   - the click-to-place handler (user picked a tile on this map).
   *  Consumed by the lifecycle effect on sim mount, then cleared so
   *  a subsequent exit-then-restart doesn't reuse a stale coord. */
  const spawnAtRef = useRef<{ col: number; row: number } | null>(null);
  // Honor `?sim=1` on initial render — drop straight into "active"
  // sim mode at the entry coord. This is how link traversal lands:
  // we push to the new map URL with these params, and the new
  // MapEditor picks them up here. We router.replace() the params
  // away on read so a browser refresh doesn't re-trigger the
  // auto-entry.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sim = searchParams?.get("sim");
    if (sim !== "1") return;
    const colStr = searchParams.get("entryCol");
    const rowStr = searchParams.get("entryRow");
    const col = colStr != null ? Number(colStr) : NaN;
    const row = rowStr != null ? Number(rowStr) : NaN;
    if (Number.isFinite(col) && Number.isFinite(row)) {
      spawnAtRef.current = { col, row };
    }
    // Link arrivals skip "placing" — we already know the entry cell.
    setSimMode("active");
    // Strip the query so this only fires once per navigation.
    router.replace(`/editor/${moduleId}/maps/${mapId}`, { scroll: false });
    // Run-once on mount: searchParams is stable enough here that
    // re-triggering on its identity change would be a bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep onSimPlaceRef pointed at a fresh closure with the latest
  // grid — when the user clicks a tile while "placing", we validate
  // walkability and transition to "active" with the chosen spawn.
  useEffect(() => {
    onSimPlaceRef.current = (col, row) => {
      if (state.kind !== "ok") return;
      const cell = state.mapRecord.grid[row]?.[col];
      if (!cell) return;
      if (!cell.walkable) {
        // Click landed on a wall / water / impassable tile. We just
        // ignore it — the user can click somewhere else. The cursor
        // stays in "placing" so the gesture is repeatable without
        // re-clicking the toolbar button.
        return;
      }
      spawnAtRef.current = { col, row };
      setSimMode("active");
    };
  }, [state]);

  const onLinkTraversed = useCallback(
    (link: { map_id: string; x: number; y: number }) => {
      // Same-map portals (e.g. a teleporter pair on one map) can't
      // route through the URL: Next's App Router treats a push to the
      // current pathname with new query params as same-route, so
      // MapEditor doesn't remount and the lifecycle effect that
      // consumes the entry-coord query never re-fires. The party
      // would visually stay on the source cell while the address bar
      // updated. Instead, teleport the party in the running sim — the
      // sim is already correctly wired to this map, so there's
      // nothing to rebuild.
      const currentMapId = state.kind === "ok" ? state.mapRecord.id : mapId;
      if (link.map_id === currentMapId) {
        simRef.current?.teleport(link.x, link.y);
        return;
      }
      // Cross-map: route through the URL so the new MapEditor mount
      // picks the entry coord up via searchParams and seeds spawnAt.
      const url =
        `/editor/${moduleId}/maps/${link.map_id}` +
        `?sim=1&entryCol=${link.x}&entryRow=${link.y}`;
      router.push(url);
    },
    [moduleId, router, state, mapId],
  );

  useEffect(() => {
    if (simMode !== "active" || state.kind !== "ok") {
      // Tear down any existing sim when leaving "active" (toggling
      // off, or transitioning back to "placing" — though placing only
      // appears on the way IN, we still defensively dispose).
      if (simRef.current) {
        simRef.current.dispose();
        simRef.current = null;
        setSimInstance(null);
      }
      return;
    }
    // Build a SimGrid view of the painted grid. Each TileType
    // already carries the SimCell shape, so a shallow cast is safe.
    const grid = state.mapRecord.grid as unknown as SimGrid;

    const bridge: SceneBridge = {
      setPartyAt: (col, row) => {
        const sprite = state.simParty?.avatar ?? "";
        sceneApiRef.current?.setPartyAt(col, row, sprite);
      },
      clearParty: () => {
        sceneApiRef.current?.clearParty();
      },
      setPartyLight: (source) => {
        sceneApiRef.current?.setPartyLight(source);
      },
      relight: () => {
        sceneApiRef.current?.relight(lightingModeRef.current);
      },
      setBoatPositions: (positions) => {
        sceneApiRef.current?.setBoatPositions(positions);
      },
      setPartyBoatAt: (col, row, visible, sprite) => {
        sceneApiRef.current?.setPartyBoatAt(col, row, visible, sprite);
      },
      floatText: (col, row, text) => {
        sceneApiRef.current?.floatText(col, row, text);
      },
      setRoamerPositions: (positions) => {
        sceneApiRef.current?.setRoamerPositions(positions);
      },
      setCellSprite: (col, row, sprite, walkable) => {
        sceneApiRef.current?.setCellSprite(col, row, sprite, walkable);
      },
      setPlacedEncounterPositions: (positions) => {
        sceneApiRef.current?.setPlacedEncounterPositions(positions);
      },
      setSuppressedEncounterCells: (cells) => {
        sceneApiRef.current?.setSuppressedEncounterCells(cells);
      },
      setPartyInfravisionActive: (active) => {
        // Sim is the source of truth — when it tells us the
        // activation flag flipped, store it in the ref the
        // relight pass reads and trigger a relight so the next
        // frame reflects the change. The SimPanel button calls
        // `sim.setInfravisionActive` which routes through here.
        partyInfravisionActiveRef.current = active;
        sceneApiRef.current?.relight(lightingModeRef.current);
      },
      onKey: (handler) => {
        // Window-scoped listener. Ignore the keystroke if the user is
        // typing in an input/textarea so cell-text editing isn't
        // blocked when sim mode is on for a quick test.
        const isTyping = (t: EventTarget | null) => {
          if (!(t instanceof HTMLElement)) return false;
          const tag = t.tagName;
          return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            t.isContentEditable
          );
        };
        const listener = (e: KeyboardEvent) => {
          if (isTyping(e.target)) return;
          // Pause sim movement while a modal overlay (NPC dialog,
          // shop, party screen) is open — otherwise the party would
          // keep stepping in the background while the player reads.
          if (overlaysOpenRef.current) return;
          handler(e.key);
        };
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
      },
    };

    const classNameById = new Map<string, string>(
      state.simClasses.map((c) => [c.id, c.name]),
    );
    // Synthesize a minimal Party if the module had none — sim still
    // runs (so the user can walk an empty placeholder around) but
    // with no light/effect data and a hardcoded center spawn.
    const party: SimParty = state.simParty ?? {
      start_position: {
        col: Math.floor(state.mapRecord.width / 2),
        row: Math.floor(state.mapRecord.height / 2),
      },
      avatar: "",
      roster: [],
      torch_steps: 0,
      galadriels_light_steps: 0,
    };

    // Pick a ground tile the destroy-lair path can revert a defeated
    // spawn cell to. Prefer a tile tagged "grass"; fall back to the
    // first walkable, non-special palette entry. Failure to find one
    // is non-fatal — the destroy path still clears the cell's spawn
    // id, the visual just won't change.
    const groundPaletteEntry =
      state.palette.find((t) => t.tag === "grass") ??
      state.palette.find(
        (t) => t.walkable && !t.boat && !t.locked && !t.light_source,
      ) ??
      null;
    const groundTile = groundPaletteEntry
      ? {
          id: groundPaletteEntry.id,
          sprite: groundPaletteEntry.sprite,
          walkable: groundPaletteEntry.walkable,
        }
      : undefined;

    const sim = new MapSimulation({
      grid,
      party,
      catalog: {
        characters: state.simCharacters,
        races: state.simRaces,
        effects: state.simEffects,
        // Threaded through for the Pick Lock / Cast Knock dialog —
        // findKnockCaster reads classes' `casting_type[]` to match
        // members against the spell's catalog.
        characterClasses: state.simClasses,
        knockSpell: state.simKnockSpell,
        // Monster-lair subsystem catalogs. Both can be empty for
        // modules that haven't authored either — the spawn loop
        // just stays dormant in that case.
        spawns: state.simSpawns,
        monsters: state.simMonsters,
        // Encounter catalog feeds the placed-encounter pursuit loop.
        // Each cell with `tile.encounter` set spawns one roaming
        // entity whose collision opens this encounter's roster.
        encounters: state.encounters.map((e) => ({
          id: e.id,
          name: (e.name as string) ?? e.id,
          monster_party_tile: e.monster_party_tile,
          monsters: e.monsters ?? [],
        })),
        groundTile,
      },
      classNameById,
      bridge,
      startAt: spawnAtRef.current ?? undefined,
    });
    // Consume the one-shot spawn coord so a subsequent exit + Simulate
    // returns the user to the "placing" picker rather than reusing
    // the previous spot.
    spawnAtRef.current = null;

    const unsubscribe = sim.subscribe((ev) => {
      if (ev.kind === "linked") onLinkTraversed(ev.link);
      if (ev.kind === "npc_encountered") {
        // Open the NPC dialog overlay. Movement is gated via
        // overlaysOpenRef so the party doesn't keep stepping while
        // the player reads.
        setNpcEncounterId(ev.npcId);
      }
      if (ev.kind === "lock_encountered") {
        // Pop the Pick Lock / Cast Knock / Leave dialog. The same
        // overlaysOpenRef gate freezes keyboard movement under the
        // modal.
        setLockEncounter(ev.options);
      }
      if (ev.kind === "counter_encountered") {
        // Tile-planted shop counter — open the CounterShopOverlay
        // directly. The existing shopCounterId state path (used by
        // the NPC-broker route) is reused, so closing the overlay
        // cleanly returns the player to keyboard movement.
        setShopCounterId(ev.counterId);
      }
      if (ev.kind === "spawn_encountered") {
        // Monster Spawn fight — boss or roamer. The overlay pops with
        // Win/Flee buttons; movement is gated through overlaysOpenRef
        // until resolveSpawnEncounter lands the outcome.
        setSpawnEncounter(ev.options);
      }
      if (ev.kind === "spawn_destroyed") {
        // No special UI today — the cell visual is already swapped by
        // setCellSprite and the inspector picks up the change on its
        // next render. Just log the event for the user.
      }
      if (ev.kind === "dungeon_entered") {
        // Dungeon entrance — route to the dedicated dungeon sim
        // page with the dungeon id + the return cell, so exiting
        // drops the party back here at the entrance. The dungeon
        // sim handles the procedural generation + the simulation
        // for the entire underground run.
        const params = new URLSearchParams({
          id: ev.dungeonId,
          return: state.kind === "ok" ? state.mapRecord.id : mapId,
          col: String(ev.returnPos.col),
          row: String(ev.returnPos.row),
        });
        router.push(
          `/editor/${moduleId}/sim/dungeon?${params.toString()}`,
        );
      }
    });

    simRef.current = sim;
    setSimInstance(sim);

    return () => {
      unsubscribe();
      sim.dispose();
      if (simRef.current === sim) {
        simRef.current = null;
        setSimInstance(null);
      }
    };
    // Map identity is the primary lifetime key — when the user
    // traverses a link the route remounts MapEditor entirely, so this
    // effect re-runs cleanly. simMode is the user toggle. State is
    // intentionally omitted: we don't want to rebuild the sim on
    // every paint while sim is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Re-run when sim transitions in/out of "active" (the only state
    // that mounts a sim) and when the user navigates to a new map.
    simMode === "active",
    state.kind === "ok" ? state.mapRecord.id : null,
    onLinkTraversed,
  ]);

  // Propagate grid-lines toggle to the running scene.
  useEffect(() => {
    sceneApiRef.current?.setGridLinesVisible(gridLinesOn);
  }, [gridLinesOn]);

  // Propagate selection highlight to the running scene.
  useEffect(() => {
    sceneApiRef.current?.setSelected(selectedCell);
  }, [selectedCell]);

  // Recompute lighting whenever the mode changes or the grid does.
  // The relight pass is cheap (one pass over cells × light sources)
  // and idempotent, so over-calling it is fine.
  useEffect(() => {
    sceneApiRef.current?.relight(lightingMode);
  }, [lightingMode, state]);

  // Sync animation emitters with the grid. refreshAnimations only
  // replaces emitters whose `animation` value actually changed.
  useEffect(() => {
    sceneApiRef.current?.refreshAnimations();
  }, [state]);

  // Sync encounter overlay sprites with the grid. refreshEncounterOverlays
  // is similarly diff-based — unchanged cells are skipped.
  useEffect(() => {
    sceneApiRef.current?.refreshEncounterOverlays();
  }, [state]);

  // Sync item overlay sprites with the grid. Same diff-based refresh
  // pattern — items dropped on the floor render as a smaller sprite
  // above the base tile but below encounter overlays.
  useEffect(() => {
    sceneApiRef.current?.refreshItemOverlays();
  }, [state]);

  // Sync NPC overlay sprites with the grid. NPCs render at near-full
  // tile size and sit between items (70) and encounters (80) on the
  // depth stack.
  useEffect(() => {
    sceneApiRef.current?.refreshNpcOverlays();
  }, [state]);

  // Sync the quest-giver overlay + golden glow with the grid. Runs
  // whenever the grid, the quest/encounter catalogs, OR the lighting
  // mode changes. The dep on lightingMode matters because the halo
  // dims using each cell's current tint — when the user toggles
  // Day/Twilight/Night, the halo needs a fresh draw after relight
  // has finished its tint pass. React fires effects in declaration
  // order, so this useEffect (declared after the relight effect)
  // sees the freshly-tinted cells.
  useEffect(() => {
    sceneApiRef.current?.refreshQuestOverlays();
  }, [state, lightingMode]);

  // ── Cell mutators (driven by the Inspector) ─────────────────────
  /** Apply a field patch directly to the cell at (col, row). The cell
   *  is its own data — no separate overrides array. `undefined` in the
   *  patch means "reset this field to the palette default" (looked up
   *  by the cell's current id). */
  const setCellFields = (
    col: number,
    row: number,
    patch: Partial<TileType>,
  ) => {
    if (state.kind !== "ok") return;
    const current = state.mapRecord.grid[row]?.[col];
    if (!current) return;
    const base = state.palette.find((t) => t.id === current.id);
    const next: TileType = { ...current };
    const nextAsAny = next as unknown as Record<string, unknown>;
    const baseAsAny = base as unknown as Record<string, unknown> | null;
    let spriteChanged = false;
    for (const k of Object.keys(patch) as Array<keyof TileType>) {
      const v = patch[k];
      if (v === undefined) {
        // Reset → restore from palette base.
        if (baseAsAny && k in baseAsAny) {
          nextAsAny[k] = baseAsAny[k];
        } else {
          delete nextAsAny[k];
        }
      } else {
        nextAsAny[k] = v;
      }
      if (k === "sprite") spriteChanged = true;
    }
    // Mutate the live grid + state.
    const nextGrid = state.mapRecord.grid.map((rowCells, ri) =>
      ri === row
        ? rowCells.map((c, ci) => (ci === col ? next : c))
        : rowCells,
    );
    gridRef.current = nextGrid;
    const nextMap: MapRecord = { ...state.mapRecord, grid: nextGrid };
    setState({ ...state, mapRecord: nextMap });
    if (spriteChanged && next.sprite) {
      sceneApiRef.current?.refreshCell(col, row, next.sprite);
    }
    queueMicrotask(() => persistRef.current());
  };

  // ── Mutators outside paint flow ─────────────────────────────────
  /** Delete the current map from the module's maps file. Writes the
   *  pruned file as a draft + navigates back to the maps browse view.
   *  The user can still Publish or Discard afterward. */
  const onDeleteMap = () => {
    if (typeof window === "undefined") return;
    if (state.kind !== "ok") return;
    const ok = window.confirm(
      `Delete map "${state.mapRecord.id}" (${state.mapRecord.name})?\n\n` +
        `This removes it from this module's maps file. The change saves ` +
        `to the draft until you Publish.`,
    );
    if (!ok) return;
    const baseFile: Record<string, unknown> = state.ownFile
      ? { ...state.ownFile }
      : { maps: [] };
    const list = Array.isArray(baseFile.maps)
      ? (baseFile.maps as MapRecord[]).filter((m) => m.id !== mapId)
      : [];
    baseFile.maps = list;
    saveDraft(moduleId, MODEL_KEY, baseFile);
    router.push(`/editor/${moduleId}/maps`);
  };

  const onDiscardDraft = () => {
    if (typeof window === "undefined") return;
    if (!hasDraft(moduleId, MODEL_KEY)) return;
    if (
      !window.confirm(
        "Discard pending map edits? This reverts to the on-disk maps.json and reloads.",
      )
    )
      return;
    discardDraft(moduleId, MODEL_KEY);
    window.location.reload();
  };

  const onPublish = async () => {
    if (state.kind !== "ok" || !state.ownFile) return;
    setPublishing(true);
    try {
      const res = await publishItems([
        {
          kind: "model",
          moduleId,
          modelKey: MODEL_KEY,
          fileName: "maps.json",
          content: state.ownFile,
        },
      ]);
      const r = res.results[0];
      if (!r.ok) {
        window.alert(`Publish failed: ${r.error}`);
        return;
      }
      discardDraft(moduleId, MODEL_KEY);
      setState({ ...state, isDraft: false });
    } catch (e) {
      window.alert(
        `Publish error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────
  const activeBrushTile = useMemo(() => {
    if (state.kind !== "ok" || !activeBrush) return null;
    return state.palette.find((t) => t.id === activeBrush) ?? null;
  }, [state, activeBrush]);

  /** The tile instance at the selected cell — the cell IS the data. */
  const selectedInstance = useMemo<TileType | null>(() => {
    if (state.kind !== "ok" || !selectedCell) return null;
    return (
      state.mapRecord.grid[selectedCell.row]?.[selectedCell.col] ?? null
    );
  }, [state, selectedCell]);
  /** Palette-of-origin for the selected cell — what `Reset` would
   *  restore each field to. Found by id. May be null if the cell's
   *  id no longer exists in the palette. */
  const selectedBase = useMemo<TileType | null>(() => {
    if (state.kind !== "ok" || !selectedInstance) return null;
    return state.palette.find((t) => t.id === selectedInstance.id) ?? null;
  }, [state, selectedInstance]);

  // ── Render ──────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return <p className="p-4 text-parchment/60">Loading map…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="p-4">
        <p className="text-ember">Failed to load map editor.</p>
        <p className="mt-2 font-mono text-sm text-parchment/60">
          {state.message}
        </p>
      </div>
    );
  }

  const { palette, mapRecord, isDraft } = state;

  return (
    <div className="flex flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-parchment/10 bg-ink/30 px-4 py-2 text-sm">
        <h1 className="font-display text-xl text-parchment">
          {mapRecord.name}
        </h1>
        <span className="text-parchment/50">
          {mapRecord.width}×{mapRecord.height}
        </span>
        {Array.isArray(mapRecord.tags) && mapRecord.tags.length > 0 ? (
          <span className="text-parchment/45">
            tags: {mapRecord.tags.join(", ")}
          </span>
        ) : null}
        <span className="text-parchment/40">·</span>
        <div
          role="group"
          aria-label="Tool"
          className="flex overflow-hidden rounded border border-parchment/20"
        >
          <button
            type="button"
            onClick={() => setTool("paint")}
            className={`px-2 py-0.5 text-xs transition ${
              tool === "paint"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Click/drag paints with the active brush + selects the cell."
          >
            🖌 Paint
          </button>
          <button
            type="button"
            onClick={() => setTool("inspect")}
            className={`border-l border-parchment/15 px-2 py-0.5 text-xs transition ${
              tool === "inspect"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Click/drag only selects — no painting. Read attributes without changing the map."
          >
            🔍 Inspect
          </button>
          <button
            type="button"
            onClick={() => setTool("fill")}
            className={`border-l border-parchment/15 px-2 py-0.5 text-xs transition ${
              tool === "fill"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Click and drag to fill a rectangle with the active brush."
          >
            🪣 Fill
          </button>
          <button
            type="button"
            onClick={() => setTool("pan")}
            className={`border-l border-parchment/15 px-2 py-0.5 text-xs transition ${
              tool === "pan"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Click/drag scrolls the map. No mouse needed — great on a trackpad."
          >
            ✋ Pan
          </button>
        </div>
        <div
          role="group"
          aria-label="Lighting"
          className="flex overflow-hidden rounded border border-parchment/20"
        >
          <button
            type="button"
            onClick={() => setLightingMode("day")}
            className={`px-2 py-0.5 text-xs transition ${
              lightingMode === "day"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Full daylight — no darkness overlay."
          >
            ☀ Day
          </button>
          <button
            type="button"
            onClick={() => setLightingMode("twilight")}
            className={`border-l border-parchment/15 px-2 py-0.5 text-xs transition ${
              lightingMode === "twilight"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Dim ambient light — light_source tiles brighten cells within their light_range."
          >
            🌆 Twilight
          </button>
          <button
            type="button"
            onClick={() => setLightingMode("night")}
            className={`border-l border-parchment/15 px-2 py-0.5 text-xs transition ${
              lightingMode === "night"
                ? "bg-ember/30 text-parchment"
                : "bg-ink/40 text-parchment/65 hover:bg-ink/60"
            }`}
            title="Near-darkness — only light sources illuminate."
          >
            🌙 Night
          </button>
        </div>
        <label className="flex items-center gap-2 text-parchment/75">
          <input
            type="checkbox"
            checked={gridLinesOn}
            onChange={(e) => setGridLinesOn(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Grid lines
        </label>
        <button
          type="button"
          onClick={() =>
            setSimMode((v) => (v === "off" ? "placing" : "off"))
          }
          className={`rounded border px-2 py-0.5 text-xs transition ${
            simMode === "active"
              ? "border-ember/60 bg-ember/30 text-parchment"
              : simMode === "placing"
                ? "border-ember/60 bg-ember/15 text-parchment animate-pulse"
                : "border-parchment/20 bg-ink/40 text-parchment/70 hover:bg-ink/60"
          }`}
          title={
            simMode === "off"
              ? "Drop the Party onto this map and walk it around. Tests movement, lighting, party effects, and tile links."
              : simMode === "placing"
                ? "Click a walkable tile to place the party. Click Simulate again to cancel."
                : "Exit simulation."
          }
        >
          {simMode === "active"
            ? "▣ Simulating"
            : simMode === "placing"
              ? "○ Click a tile…"
              : "▶ Simulate"}
        </button>
        <div
          className="flex items-center gap-1"
          title="Zoom — also pinch on trackpad or Ctrl/⌘ + wheel. Pan: two-finger scroll, Space + drag, or middle-mouse drag."
        >
          <span className="text-xs text-parchment/45">Zoom</span>
          <button
            type="button"
            disabled={zoomIdx <= 0}
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoomIdx(DEFAULT_ZOOM_IDX)}
            className="min-w-[3.25rem] rounded border border-parchment/20 px-2 py-0.5 text-center font-mono text-xs text-parchment/75 hover:bg-ink/40"
            title="Reset to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            disabled={zoomIdx >= ZOOM_STEPS.length - 1}
            onClick={() =>
              setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))
            }
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            +
          </button>
        </div>
        <span className="ml-auto flex items-center gap-2">
          {activeBrushTile ? (
            <span className="text-xs text-parchment/55">
              brush:{" "}
              <span className="text-parchment/90">{activeBrushTile.name}</span>
            </span>
          ) : (
            <span className="text-xs text-ember/80">no brush</span>
          )}
          {isDraft ? (
            <span className="rounded bg-ember/30 px-2 py-0.5 text-xs text-parchment/90">
              draft
            </span>
          ) : null}
          {isDraft ? (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            >
              Discard
            </button>
          ) : null}
          {isDraft && publishAvailable === true ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="rounded border border-ember/60 bg-ember/30 px-2 py-0.5 text-xs text-parchment hover:bg-ember/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDeleteMap}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/65 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
            title="Delete this map from the module's maps file."
          >
            Delete map
          </button>
        </span>
      </div>

      {/* Body: palette + canvas */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 overflow-auto border-r border-parchment/10 bg-ink/20 p-3">
          {(() => {
            // Derive the full set of tag-section headers so the toggle
            // can flip between "all collapsed" and "all expanded".
            // Mirrors the bucketing PaletteByTag uses internally.
            const UNTAGGED = "(untagged)";
            const allTags = new Set<string>();
            for (const t of palette) {
              const tag = t.tag && t.tag.trim() ? t.tag : UNTAGGED;
              allTags.add(tag);
            }
            // If anything is still expanded, the toggle collapses all;
            // once everything's collapsed, it flips to expand-all.
            const allCollapsed =
              allTags.size > 0 && collapsedTags.size >= allTags.size;
            return (
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-parchment/45">
                  Tile Palette
                </p>
                {allTags.size > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedTags(allCollapsed ? new Set() : allTags)
                    }
                    className="rounded border border-parchment/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/65 hover:bg-ink/50 hover:text-parchment/90"
                    title={
                      allCollapsed
                        ? "Expand all tag sections"
                        : "Collapse all tag sections"
                    }
                  >
                    {allCollapsed ? "Expand all" : "Collapse all"}
                  </button>
                ) : null}
              </div>
            );
          })()}
          {palette.length === 0 ? (
            <p className="text-xs text-parchment/55">
              No tile types yet — add some in the Tile Palette editor.
            </p>
          ) : (
            <PaletteByTag
              palette={palette}
              activeBrush={activeBrush}
              collapsed={collapsedTags}
              onToggleTag={(tag) =>
                setCollapsedTags((prev) => {
                  const next = new Set(prev);
                  if (next.has(tag)) next.delete(tag);
                  else next.add(tag);
                  return next;
                })
              }
              onPickBrush={setActiveBrush}
            />
          )}
        </aside>

        <div
          ref={canvasScrollRef}
          className="flex flex-1 items-start justify-start overflow-auto bg-ink/40 p-4"
          style={{
            // Contain scroll so two-finger trackpad swipes at the
            // map's edge don't trigger the browser's back/forward
            // navigation gesture.
            overscrollBehavior: "contain",
            cursor:
              simMode === "placing"
                ? "crosshair"
                : tool === "pan" || spaceHeld
                  ? "grab"
                  : tool === "fill"
                    ? "crosshair"
                    : undefined,
          }}
          onWheel={(e) => {
            // Ctrl/⌘ + wheel = zoom. Bare wheel keeps native scroll.
            // Trackpad pinch on macOS also surfaces as ctrlKey+wheel,
            // so pinch-to-zoom works out of the box.
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoomIdx((idx) => {
              const step = e.deltaY > 0 ? -1 : 1;
              return Math.max(
                0,
                Math.min(ZOOM_STEPS.length - 1, idx + step),
              );
            });
          }}
          onMouseDownCapture={(e) => {
            // Drag-to-pan paths:
            //  - Pan tool active + left button (trackpad-friendly)
            //  - Space held + left button (Photoshop/Figma convention)
            //  - Middle mouse button (external-mouse convention)
            // Capture phase so we beat Phaser to the event; otherwise
            // paint would fire on the first cell underneath the cursor.
            const isPanToolDrag = tool === "pan" && e.button === 0;
            const isSpaceDrag = spaceHeld && e.button === 0;
            const isMiddleDrag = e.button === 1;
            if (!isPanToolDrag && !isSpaceDrag && !isMiddleDrag) return;
            e.preventDefault();
            e.stopPropagation();
            const el = canvasScrollRef.current;
            if (!el) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = el.scrollLeft;
            const startTop = el.scrollTop;
            const prevCursor = el.style.cursor;
            el.style.cursor = "grabbing";
            const onMove = (ev: MouseEvent) => {
              el.scrollLeft = startLeft - (ev.clientX - startX);
              el.scrollTop = startTop - (ev.clientY - startY);
            };
            const onUp = () => {
              el.style.cursor = prevCursor;
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        >
          {/* Outer wrapper is sized to the SCALED dimensions so the
              parent's overflow-auto produces scrollbars that match the
              visible canvas. The inner container keeps its intrinsic
              size and is CSS-transformed; Phaser pointer events still
              resolve to correct game-space coords. */}
          <div
            style={{
              width: mapRecord.width * TILE_SIZE * zoom,
              height: mapRecord.height * TILE_SIZE * zoom,
            }}
          >
            <div
              ref={containerRef}
              className="rounded border border-parchment/20 shadow-lg"
              style={{
                width: mapRecord.width * TILE_SIZE,
                height: mapRecord.height * TILE_SIZE,
                transformOrigin: "0 0",
                transform: `scale(${zoom})`,
              }}
            />
          </div>
        </div>

        {simMode === "active" && simInstance ? (
          <SimPanel
            sim={simInstance}
            onExitSim={() => setSimMode("off")}
          />
        ) : simMode === "placing" ? (
          <SimPlacingPanel onCancel={() => setSimMode("off")} />
        ) : (
          <Inspector
            selectedCell={selectedCell}
            instance={selectedInstance}
            base={selectedBase}
            palette={state.palette}
            counters={state.counters}
            encounters={state.encounters}
            spawns={state.spawns}
            items={state.items}
            npcs={state.npcs}
            availableMaps={state.availableMaps}
            availableDungeons={state.availableDungeons}
            availableQuests={state.availableQuests}
            onUpdate={(patch) => {
              if (!selectedCell) return;
              setCellFields(selectedCell.col, selectedCell.row, patch);
            }}
          />
        )}
      </div>
      {/* In-game party screen (P during sim). Mounted at the editor
          root so the fixed-positioned overlay sits above the canvas
          AND the side panels. */}
      {partyScreenOpen ? (
        <MapPartyScreenOverlay
          moduleId={moduleId}
          onClose={() => setPartyScreenOpen(false)}
        />
      ) : null}
      {/* NPC dialog overlay — opens when the party steps onto a cell
          whose `npc` is set. Hidden behind the shop overlay if the
          player taps Shop. */}
      {npcEncounterId && !shopCounterId
        ? (() => {
            const npc = state.npcs.find((n) => n.id === npcEncounterId);
            if (!npc) return null;
            return (
              <NpcDialogOverlay
                npc={npc as Parameters<typeof NpcDialogOverlay>[0]["npc"]}
                onOpenShop={(counterId) => setShopCounterId(counterId)}
                onClose={() => setNpcEncounterId(null)}
              />
            );
          })()
        : null}
      {/* Lock dialog overlay — opens when the party bumps a locked
          cell during simulation. Three actions: Pick Lock, Cast Knock,
          Leave. Rolls + grid mutation happen in the sim; we just close
          the overlay when the user dismisses or succeeds. */}
      {lockEncounter
        ? (
            <LockDialogOverlay
              options={lockEncounter}
              onPickLock={() => simRef.current?.attemptPickLock() ?? null}
              onCastKnock={() => simRef.current?.attemptKnock() ?? null}
              onClose={() => {
                simRef.current?.dismissLock();
                setLockEncounter(null);
              }}
            />
          )
        : null}
      {/* Spawn-encounter overlay — opens when the party steps onto a
          Monster Spawn lair OR is caught by a roamer. The overlay's
          Win button resolves the encounter through the sim, which
          either destroys the lair (boss fights) or removes the
          roamer (roamer fights). */}
      {spawnEncounter
        ? (
            <SpawnEncounterOverlay
              options={spawnEncounter}
              monsters={state.simMonsters}
              onResolve={(outcome) => {
                simRef.current?.resolveSpawnEncounter(outcome);
                setSpawnEncounter(null);
              }}
            />
          )
        : null}
      {/* Counter shop overlay — opens from inside the NPC dialog. */}
      {shopCounterId
        ? (() => {
            const counter = state.counters.find(
              (c) => c.id === shopCounterId,
            );
            if (!counter || !state.simParty) {
              // Counter missing OR no party loaded — bounce back to
              // the NPC dialog rather than rendering a broken shop.
              setShopCounterId(null);
              return null;
            }
            return (
              <CounterShopOverlay
                counter={counter as Parameters<typeof CounterShopOverlay>[0]["counter"]}
                party={state.simParty}
                items={state.items as Parameters<typeof CounterShopOverlay>[0]["items"]}
                onClose={() => setShopCounterId(null)}
              />
            );
          })()
        : null}
    </div>
  );
}

/** Stand-in panel rendered while sim mode is in its "placing" step.
 *  Replaces the Inspector during the gesture so the right rail still
 *  has useful content (and a Cancel button) instead of going blank. */
function SimPlacingPanel({ onCancel }: { onCancel: () => void }) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-auto border-l border-parchment/10 bg-ink/30 p-3 text-sm text-parchment/85">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base text-parchment">Place Party</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          title="Cancel and return to the Inspector."
        >
          Cancel
        </button>
      </header>
      <p className="text-xs text-parchment/70">
        Click a <span className="text-parchment">walkable</span> tile on
        the map to drop the party there. Clicks on walls, water, or
        other impassable tiles are ignored.
      </p>
      <p className="text-xs text-parchment/55">
        Once placed, use <span className="font-mono">WASD</span> or the
        arrow keys to move. Stepping on a tile with a link traverses to
        the target map.
      </p>
    </aside>
  );
}

/** Right-side inspector panel — shows attributes for the cell the
 *  user last clicked, and lets the author override any of them on a
 *  per-cell basis. Edits go into the map's sparse `cells` array; a
 *  cell with no override entry uses palette defaults. Reset clears
 *  the override for that field; clearing all fields removes the
 *  override entry entirely. */

/** Group + collapse the Tile Palette side panel by tag. Each section
 *  is a clickable header (toggles collapsed/expanded) and a body of
 *  tiles. Untagged tiles bucket as "(untagged)" at the end. */
function PaletteByTag({
  palette,
  activeBrush,
  collapsed,
  onToggleTag,
  onPickBrush,
}: {
  palette: TileType[];
  activeBrush: string | null;
  collapsed: Set<string>;
  onToggleTag: (tag: string) => void;
  onPickBrush: (id: string) => void;
}) {
  const UNTAGGED = "(untagged)";
  const groups = new Map<string, TileType[]>();
  for (const t of palette) {
    const tag = t.tag && t.tag.trim() ? t.tag : UNTAGGED;
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(t);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    if (a === UNTAGGED) return 1;
    if (b === UNTAGGED) return -1;
    return a.localeCompare(b);
  });
  return (
    <div className="space-y-2">
      {ordered.map((tag) => {
        const tiles = groups.get(tag)!;
        const isCollapsed = collapsed.has(tag);
        return (
          <section
            key={tag}
            className="rounded border border-parchment/10 bg-ink/30"
          >
            <button
              type="button"
              onClick={() => onToggleTag(tag)}
              className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs uppercase tracking-wide text-parchment/65 hover:bg-ink/50"
            >
              <span className="flex items-center gap-1">
                <span className="text-parchment/55">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                {tag}
              </span>
              <span className="text-parchment/45 normal-case tracking-normal">
                {tiles.length}
              </span>
            </button>
            {!isCollapsed ? (
              <ul className="space-y-1 px-1 pb-1">
                {tiles.map((t) => {
                  const active = activeBrush === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => onPickBrush(t.id)}
                        className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-sm transition ${
                          active
                            ? "border-ember/60 bg-ember/20 text-parchment"
                            : "border-parchment/10 bg-ink/40 text-parchment/85 hover:border-parchment/40 hover:bg-ink/60"
                        }`}
                      >
                        <img
                          src={withBasePath(`/sprites/${t.sprite}`)}
                          alt=""
                          width={24}
                          height={24}
                          style={{ imageRendering: "pixelated" }}
                          className="h-6 w-6 shrink-0 object-contain"
                        />
                        <span className="flex-1 truncate">
                          {t.name || t.id}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Inspector({
  selectedCell,
  instance,
  base,
  palette,
  counters,
  encounters,
  spawns,
  items,
  npcs,
  availableMaps,
  availableDungeons,
  availableQuests,
  onUpdate,
}: {
  selectedCell: { col: number; row: number } | null;
  /** The tile data living at the selected cell. The cell IS this data. */
  instance: TileType | null;
  /** The Tile Palette entry that shares this cell's id — used to
   *  decide whether each field has been modified, and as the source
   *  for "Reset" actions. May be null if no palette entry has this id
   *  (orphan cell). */
  base: TileType | null;
  palette: TileType[];
  counters: RefRecord[];
  encounters: EncounterRecord[];
  spawns: RefRecord[];
  items: ItemRecord[];
  npcs: NpcRecord[];
  /** Every map in the module — fed to the Link editor's map_id picker. */
  availableMaps: Array<{ id: string; name: string }>;
  /** Every dungeon and quest in the module — fed to the cell-inspector's
   *  Dungeon and Quest dropdowns. Quests carry the full record (used
   *  by the on-map quest-giver sprite + glow logic). */
  availableDungeons: Array<{ id: string; name: string }>;
  availableQuests: QuestRecord[];
  onUpdate: (patch: Partial<TileType>) => void;
}) {
  const modified =
    !!instance && !!base && !cellMatchesPalette(instance, palette);
  return (
    <aside className="w-72 shrink-0 overflow-auto border-l border-parchment/10 bg-ink/20 p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-parchment/45">
        Cell Inspector
        {modified ? (
          <span className="ml-2 rounded bg-ember/30 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-parchment/90">
            modified
          </span>
        ) : null}
      </p>
      {!selectedCell || !instance ? (
        <p className="text-xs text-parchment/55">
          Click any cell on the map to inspect or customize its attributes.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-parchment/40">
              Position
            </p>
            <p className="font-mono text-sm text-parchment/90">
              col {selectedCell.col}, row {selectedCell.row}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <img
              src={withBasePath(`/sprites/${instance.sprite}`)}
              alt=""
              width={48}
              height={48}
              style={{ imageRendering: "pixelated" }}
              className="h-12 w-12 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-base text-parchment">
                {instance.name}
              </p>
              <p className="truncate font-mono text-xs text-parchment/55">
                {instance.id}
              </p>
            </div>
          </div>

          <WalkableEditor
            value={instance.walkable}
            paletteValue={base?.walkable ?? instance.walkable}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "walkable")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ walkable: v })}
            onReset={() => onUpdate({ walkable: undefined })}
          />

          <BoolEditor
            label="Obstructs"
            help="Blocks light effects and ranged-weapon line-of-sight."
            value={instance.obstructs ?? false}
            paletteValue={base?.obstructs ?? instance.obstructs ?? false}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "obstructs")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ obstructs: v })}
            onReset={() => onUpdate({ obstructs: undefined })}
          />

          <BoolEditor
            label="Boat"
            help="True = this tile IS a boat. Stepping onto it lets the party move through water tiles (the tile becomes the vessel)."
            value={instance.boat ?? false}
            paletteValue={base?.boat ?? instance.boat ?? false}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "boat")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ boat: v })}
            onReset={() => onUpdate({ boat: undefined })}
          />

          <BoolEditor
            label="Locked"
            help="Gates passage/interaction until unlocked (key, scripted, etc.)."
            value={instance.locked ?? false}
            paletteValue={base?.locked ?? instance.locked ?? false}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "locked")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ locked: v })}
            onReset={() => onUpdate({ locked: undefined })}
          />

          <BoolEditor
            label="Light source"
            help="True = this tile emits light. Pair with Light range."
            value={instance.light_source ?? false}
            paletteValue={
              base?.light_source ?? instance.light_source ?? false
            }
            isModified={
              !!base &&
              fieldDiffersFromPalette(instance, palette, "light_source")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ light_source: v })}
            onReset={() => onUpdate({ light_source: undefined })}
          />

          <NumberEditor
            label="Light range"
            help="Light radius in cells. Only meaningful when Light source is true."
            value={instance.light_range ?? 0}
            paletteValue={base?.light_range ?? instance.light_range ?? 0}
            isModified={
              !!base &&
              fieldDiffersFromPalette(instance, palette, "light_range")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ light_range: v })}
            onReset={() => onUpdate({ light_range: undefined })}
          />

          <StringEditor
            label="Text"
            help="Narrative text called out in-game when the party steps on this cell. Leave blank for none."
            value={instance.text ?? ""}
            paletteValue={base?.text ?? instance.text ?? ""}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "text")
            }
            canReset={!!base}
            placeholder="(no on-step text)"
            onChange={(v) => onUpdate({ text: v })}
            onReset={() => onUpdate({ text: undefined })}
          />

          <SelectEditor
            label="Animation"
            help="Visual effect overlay rendered on this cell."
            value={instance.animation ?? "none"}
            paletteValue={base?.animation ?? instance.animation ?? "none"}
            options={[
              { value: "none", label: "(none)" },
              { value: "torch", label: "Torch" },
              { value: "fire", label: "Fire" },
              { value: "fairy", label: "Fairy lights" },
              { value: "smoke", label: "Smoke" },
            ]}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "animation")
            }
            canReset={!!base}
            onChange={(v) =>
              onUpdate({ animation: v as TileType["animation"] })
            }
            onReset={() => onUpdate({ animation: undefined })}
          />

          <SelectEditor
            label="Counter"
            help="Shop/service counter from counters.json. Empty for none."
            value={instance.counter ?? ""}
            paletteValue={base?.counter ?? instance.counter ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...counters.map((c) => ({
                value: c.id,
                label: c.name ? `${c.name} — ${c.id}` : c.id,
              })),
            ]}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "counter")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ counter: v })}
            onReset={() => onUpdate({ counter: undefined })}
          />

          <SelectEditor
            label="Encounter"
            help="Random encounter from encounters.json. Empty for none. The encounter's sprite renders on the cell."
            value={instance.encounter ?? ""}
            paletteValue={base?.encounter ?? instance.encounter ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...encounters.map((e) => ({
                value: e.id,
                label: e.name ? `${e.name} — ${e.id}` : e.id,
              })),
            ]}
            previewSrc={(() => {
              const id = instance.encounter ?? "";
              if (!id) return null;
              const found = encounters.find((e) => e.id === id);
              const tile = found?.monster_party_tile;
              if (!tile) return null;
              return tile.includes("/")
                ? withBasePath(`/sprites/${tile}`)
                : null;
            })()}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "encounter")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ encounter: v })}
            onReset={() => onUpdate({ encounter: undefined })}
          />

          <SelectEditor
            label="Spawn"
            help="Spawn template from spawns.json (monster-lair behavior). Empty for none."
            value={instance.spawn ?? ""}
            paletteValue={base?.spawn ?? instance.spawn ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...spawns.map((s) => ({
                value: s.id,
                label: s.name ? `${s.name} — ${s.id}` : s.id,
              })),
            ]}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "spawn")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ spawn: v })}
            onReset={() => onUpdate({ spawn: undefined })}
          />

          <SelectEditor
            label="Item"
            help="Item from items.json placed on this tile. The item's icon layers over the floor, and gameplay drops it when the party steps on the cell. Empty for none."
            value={instance.item ?? ""}
            paletteValue={base?.item ?? instance.item ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...items.map((i) => ({
                value: i.id,
                label: i.name ? `${i.name} — ${i.id}` : i.id,
              })),
            ]}
            previewSrc={(() => {
              const id = instance.item ?? "";
              if (!id) return null;
              const found = items.find((i) => i.id === id);
              const icon = found?.icon;
              if (!icon) return null;
              return withBasePath(`/sprites/item/${icon}.png`);
            })()}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "item")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ item: v })}
            onReset={() => onUpdate({ item: undefined })}
          />

          <SelectEditor
            label="NPC"
            help="NPC from npcs.json. Empty for none. The NPC's sprite renders as an overlay on the cell so you can place villagers / shopkeepers / quest-givers visually."
            value={instance.npc ?? ""}
            paletteValue={base?.npc ?? instance.npc ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...npcs.map((n) => ({
                value: n.id,
                label: n.name ? `${n.name} — ${n.id}` : n.id,
              })),
              // Preserve a value pointing at an NPC not in the catalog
              // (forward reference / library record) so it round-trips
              // through save / load.
              ...(instance.npc &&
              !npcs.some((n) => n.id === instance.npc)
                ? [
                    {
                      value: instance.npc,
                      label: `(missing) ${instance.npc}`,
                    },
                  ]
                : []),
            ]}
            previewSrc={(() => {
              const id = instance.npc ?? "";
              if (!id) return null;
              const found = npcs.find((n) => n.id === id);
              const sprite = found?.sprite;
              if (!sprite) return null;
              // NPC sprites are stored as folder-relative paths
              // (e.g. "person/cleric1.png"). Match the resolver the
              // SpritePicker uses elsewhere — slash-bearing paths go
              // under /sprites/, bare stems fall back to the default
              // person folder.
              return sprite.includes("/")
                ? withBasePath(`/sprites/${sprite}`)
                : withBasePath(`/sprites/person/${sprite}`);
            })()}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "npc")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ npc: v })}
            onReset={() => onUpdate({ npc: undefined })}
          />

          <SelectEditor
            label="Quest"
            help="Quest from quests.json. Empty for none. A cell carrying a Quest id is a trigger tile for that quest."
            value={instance.quest ?? ""}
            paletteValue={base?.quest ?? instance.quest ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...availableQuests.map((q) => ({
                value: q.id,
                label: q.name ? `${q.name} — ${q.id}` : q.id,
              })),
              // Preserve a value pointing at a quest not in the catalog
              // (forward reference / library record) so it round-trips.
              ...(instance.quest &&
              !availableQuests.some((q) => q.id === instance.quest)
                ? [
                    {
                      value: instance.quest,
                      label: `(missing) ${instance.quest}`,
                    },
                  ]
                : []),
            ]}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "quest")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ quest: v })}
            onReset={() => onUpdate({ quest: undefined })}
          />

          <SelectEditor
            label="Dungeon"
            help="Dungeon from dungeons.json. Empty for none. A cell carrying a Dungeon id is an entrance trigger — stepping on it generates and enters the dungeon's first level."
            value={instance.dungeon ?? ""}
            paletteValue={base?.dungeon ?? instance.dungeon ?? ""}
            options={[
              { value: "", label: "(none)" },
              ...availableDungeons.map((d) => ({
                value: d.id,
                label: d.name ? `${d.name} — ${d.id}` : d.id,
              })),
              ...(instance.dungeon &&
              !availableDungeons.some((d) => d.id === instance.dungeon)
                ? [
                    {
                      value: instance.dungeon,
                      label: `(missing) ${instance.dungeon}`,
                    },
                  ]
                : []),
            ]}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "dungeon")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ dungeon: v })}
            onReset={() => onUpdate({ dungeon: undefined })}
          />

          <LinkEditor
            value={instance.link ?? null}
            paletteValue={base?.link ?? null}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "link")
            }
            canReset={!!base}
            availableMaps={availableMaps}
            onChange={(v) => onUpdate({ link: v })}
            onReset={() => onUpdate({ link: undefined })}
          />

          {!base ? (
            <p className="rounded border border-ember/40 bg-ember/15 p-2 text-[11px] text-parchment/75">
              No Tile Palette entry with id <code>{instance.id}</code> —
              this cell is an orphan. Reset is disabled until a matching
              palette entry exists.
            </p>
          ) : null}

          <p className="border-t border-parchment/10 pt-2 text-[11px] text-parchment/45">
            Each cell is its own data — edits modify the cell directly.
            Painting a cell over copies the brush palette entry fresh.
            Reset restores a single field from the palette entry that
            shares this cell&apos;s id.
          </p>
        </div>
      )}
    </aside>
  );
}

function InspectorRow({
  label,
  isModified,
  canReset,
  onReset,
  children,
}: {
  label: string;
  isModified?: boolean;
  canReset?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-parchment/40">
          {label}
          {isModified ? (
            <span className="ml-1.5 rounded bg-ember/25 px-1 py-0.5 text-[9px] text-parchment/85">
              modified
            </span>
          ) : null}
        </p>
        {isModified && canReset && onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-parchment/55 hover:text-parchment/85"
            title="Restore this field from the Tile Palette entry that shares this cell's id."
          >
            reset
          </button>
        ) : null}
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function WalkableEditor({
  value,
  paletteValue,
  isModified,
  canReset,
  onChange,
  onReset,
}: {
  value: boolean;
  paletteValue: boolean;
  isModified: boolean;
  canReset: boolean;
  onChange: (v: boolean) => void;
  onReset: () => void;
}) {
  return (
    <BoolEditor
      label="Walkable"
      value={value}
      paletteValue={paletteValue}
      isModified={isModified}
      canReset={canReset}
      onChange={onChange}
      onReset={onReset}
    />
  );
}

/** Generic number attribute editor — number input + palette default
 *  annotation + reset. */
function NumberEditor({
  label,
  help,
  value,
  paletteValue,
  isModified,
  canReset,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  value: number;
  paletteValue: number;
  isModified: boolean;
  canReset: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <InspectorRow
      label={label}
      isModified={isModified}
      canReset={canReset}
      onReset={onReset}
    >
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          className="w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
        />
        <span className="text-[10px] text-parchment/40">
          palette: {paletteValue}
        </span>
      </div>
      {help ? (
        <p className="mt-1 text-[10px] text-parchment/45">{help}</p>
      ) : null}
    </InspectorRow>
  );
}

/** Generic string attribute editor — single-line input + palette
 *  default annotation + reset. Used for `effect` (effect id) today;
 *  future cross-reference fields can pivot to a dropdown without
 *  changing the call sites. */
function StringEditor({
  label,
  help,
  value,
  paletteValue,
  isModified,
  canReset,
  placeholder,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  value: string;
  paletteValue: string;
  isModified: boolean;
  canReset: boolean;
  placeholder?: string;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <InspectorRow
      label={label}
      isModified={isModified}
      canReset={canReset}
      onReset={onReset}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90 placeholder:text-parchment/30 focus:border-parchment/60 focus:outline-none"
      />
      {paletteValue ? (
        <p className="mt-0.5 text-[10px] text-parchment/40">
          palette: <span className="font-mono">{paletteValue}</span>
        </p>
      ) : null}
      {help ? (
        <p className="mt-1 text-[10px] text-parchment/45">{help}</p>
      ) : null}
    </InspectorRow>
  );
}

/** Generic enum/select attribute editor — dropdown + palette default
 *  annotation + reset. Used for `animation` and any future enumerated
 *  per-cell field. */
function SelectEditor({
  label,
  help,
  value,
  paletteValue,
  options,
  previewSrc,
  isModified,
  canReset,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  value: string;
  paletteValue: string;
  options: Array<{ value: string; label: string }>;
  /** Optional sprite path to show as a thumbnail next to the select.
   *  Used by Encounter to surface the encounter's monster_party_tile. */
  previewSrc?: string | null;
  isModified: boolean;
  canReset: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <InspectorRow
      label={label}
      isModified={isModified}
      canReset={canReset}
      onReset={onReset}
    >
      <div className="flex items-start gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90 focus:border-parchment/60 focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {previewSrc ? (
          <img
            src={previewSrc}
            alt=""
            width={32}
            height={32}
            style={{ imageRendering: "pixelated" }}
            className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility =
                "hidden";
            }}
          />
        ) : null}
      </div>
      <p className="mt-0.5 text-[10px] text-parchment/40">
        palette: {options.find((o) => o.value === paletteValue)?.label ?? paletteValue}
      </p>
      {help ? (
        <p className="mt-1 text-[10px] text-parchment/45">{help}</p>
      ) : null}
    </InspectorRow>
  );
}

/** Generic boolean attribute editor — checkbox + palette default
 *  annotation + reset. Used for walkable, obstructs, and any future
 *  boolean per-cell field. */
function BoolEditor({
  label,
  help,
  value,
  paletteValue,
  isModified,
  canReset,
  onChange,
  onReset,
}: {
  label: string;
  help?: string;
  value: boolean;
  paletteValue: boolean;
  isModified: boolean;
  canReset: boolean;
  onChange: (v: boolean) => void;
  onReset: () => void;
}) {
  return (
    <InspectorRow
      label={label}
      isModified={isModified}
      canReset={canReset}
      onReset={onReset}
    >
      <label
        className="flex items-center gap-2 text-parchment/90"
        title={help}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        <span>{value ? "yes" : "no"}</span>
        <span className="text-[10px] text-parchment/40">
          palette: {paletteValue ? "yes" : "no"}
        </span>
      </label>
      {help ? (
        <p className="mt-1 text-[10px] text-parchment/45">{help}</p>
      ) : null}
    </InspectorRow>
  );
}

function LinkEditor({
  value,
  paletteValue,
  isModified,
  canReset,
  availableMaps,
  onChange,
  onReset,
}: {
  value: { map_id: string; x: number; y: number } | null;
  paletteValue: { map_id: string; x: number; y: number } | null;
  isModified: boolean;
  canReset: boolean;
  /** All maps in the module — feeds the map_id dropdown. */
  availableMaps: Array<{ id: string; name: string }>;
  onChange: (
    v: { map_id: string; x: number; y: number } | null,
  ) => void;
  onReset: () => void;
}) {
  const hasLink = value !== null;
  // True when the current map_id doesn't appear in the picker — either
  // a forward reference to a map that doesn't exist yet, or the
  // target has been deleted since this link was authored. Either way
  // we surface the existing string instead of silently dropping it.
  const valueIsOrphan =
    !!value &&
    !!value.map_id &&
    !availableMaps.some((m) => m.id === value.map_id);
  /** When true, the user opted into the text-input fallback so they
   *  can type a custom / future map id. Engaged automatically when
   *  the current value is already an orphan. */
  const [customMode, setCustomMode] = useState<boolean>(false);
  const useCustom = customMode || valueIsOrphan;
  return (
    <InspectorRow
      label="Link"
      isModified={isModified}
      canReset={canReset}
      onReset={onReset}
    >
      {hasLink ? (
        <div className="space-y-1">
          <label className="block">
            <span className="flex items-center justify-between">
              <span className="text-[10px] text-parchment/45">map_id</span>
              <button
                type="button"
                onClick={() => setCustomMode((c) => !c)}
                className="text-[10px] uppercase tracking-wide text-parchment/45 hover:text-parchment/80"
                title={
                  useCustom
                    ? "Switch back to picking from the maps list."
                    : "Switch to a free-form text field to type a custom or future map id."
                }
              >
                {useCustom ? "Pick from list" : "Custom id"}
              </button>
            </span>
            {useCustom ? (
              <input
                type="text"
                value={value.map_id}
                onChange={(e) =>
                  onChange({ ...value, map_id: e.target.value })
                }
                placeholder="target-map"
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
              />
            ) : (
              <select
                value={value.map_id}
                onChange={(e) =>
                  onChange({ ...value, map_id: e.target.value })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
              >
                {!value.map_id ? (
                  <option value="">— choose a map —</option>
                ) : null}
                {availableMaps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            )}
            {valueIsOrphan ? (
              <span className="mt-0.5 block text-[10px] text-ember/80">
                Map id <code>{value.map_id}</code> isn&apos;t in this
                module yet — value preserved so the link still
                round-trips.
              </span>
            ) : null}
          </label>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-[10px] text-parchment/45">x (col)</span>
              <input
                type="number"
                value={value.x}
                onChange={(e) =>
                  onChange({ ...value, x: Number(e.target.value) || 0 })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
              />
            </label>
            <label className="flex-1">
              <span className="text-[10px] text-parchment/45">y (row)</span>
              <input
                type="number"
                value={value.y}
                onChange={(e) =>
                  onChange({ ...value, y: Number(e.target.value) || 0 })
                }
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded border border-parchment/20 px-2 py-0.5 text-[10px] text-parchment/65 hover:bg-ink/40"
            title="Remove the link from this cell (still an override — the palette tile keeps its link, but this cell explicitly has none)."
          >
            Remove link
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-parchment/40">—</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                map_id: paletteValue?.map_id ?? "",
                x: paletteValue?.x ?? 0,
                y: paletteValue?.y ?? 0,
              })
            }
            className="rounded border border-parchment/30 px-2 py-0.5 text-[10px] text-parchment/85 hover:bg-ink/40"
          >
            + Add link
          </button>
          {paletteValue ? (
            <span className="text-[10px] text-parchment/40">
              (palette: {paletteValue.map_id})
            </span>
          ) : null}
        </div>
      )}
    </InspectorRow>
  );
}
