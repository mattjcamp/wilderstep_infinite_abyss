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
import { SimPanel } from "@/sim/SimPanel";
import type {
  SimCharacter,
  SimEffect,
  SimGrid,
  SimLightSource,
  SimParty,
  SimRace,
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
}
/** Item record from items.json — `icon` is a bare sprite name that
 *  resolves to `item/${icon}.png` for overlay rendering. */
interface ItemRecord extends RefRecord {
  icon?: string;
  category?: string;
}

/** Per-animation Phaser particle-emitter config. Keys are the values
 *  TileType.animation can take ("none" excluded — no emitter at all). */
const ANIMATION_CONFIGS = {
  torch: {
    speedX: { min: -10, max: 10 },
    speedY: { min: -40, max: -20 },
    lifespan: { min: 400, max: 700 },
    scale: { start: 0.35, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 80,
    tint: [0xffaa44, 0xff6622, 0xffdd66],
    blendMode: "ADD" as const,
  },
  fire: {
    speedX: { min: -20, max: 20 },
    speedY: { min: -60, max: -30 },
    lifespan: { min: 500, max: 900 },
    scale: { start: 0.55, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 40,
    tint: [0xff3322, 0xff8844, 0xffdd66],
    blendMode: "ADD" as const,
  },
  fairy: {
    speedX: { min: -25, max: 25 },
    speedY: { min: -25, max: 5 },
    lifespan: { min: 1500, max: 2500 },
    scale: { start: 0.25, end: 0 },
    alpha: { start: 1, end: 0 },
    frequency: 220,
    tint: [0xaaeeff, 0xeeaaff, 0xffffff, 0x88ffcc],
    blendMode: "ADD" as const,
  },
  smoke: {
    speedX: { min: -10, max: 10 },
    speedY: { min: -25, max: -12 },
    lifespan: { min: 1000, max: 1800 },
    scale: { start: 0.4, end: 0.9 },
    alpha: { start: 0.55, end: 0 },
    frequency: 130,
    tint: [0x555555, 0x777777, 0x444444],
  },
} as const;

type AnimationKind = keyof typeof ANIMATION_CONFIGS;

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
  if (cell.sprite !== base.sprite) return false;
  if (JSON.stringify(cell.link ?? null) !== JSON.stringify(base.link ?? null))
    return false;
  return true;
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
      mapRecord: MapRecord;
      /** The whole maps.json shape for this module's own file (draft-
       *  aware) — needed so we can write back the modified map. */
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
      /** Simulation-only catalog. Loaded alongside the painting data
       *  so the scene can pre-load party sprites in its single
       *  preload() pass. Null when a load failed; sim mode is still
       *  reachable but the panel falls back to placeholders. */
      simParty: SimParty | null;
      simCharacters: SimCharacter[];
      simRaces: SimRace[];
      simEffects: SimEffect[];
      simClasses: Array<{ id: string; name: string }>;
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
  const [publishing, setPublishing] = useState(false);

  const [selectedCell, setSelectedCell] = useState<
    { col: number; row: number } | null
  >(null);
  /** "paint" → click/drag paints the active brush and selects the cell.
   *  "pan"  → click/drag scrolls the canvas viewport. Useful on
   *           laptops with no middle mouse button.
   *  "inspect" → click/drag only selects (so you can read attributes
   *  without modifying the map). */
  const [tool, setTool] = useState<"paint" | "inspect" | "pan">("paint");
  const toolRef = useRef<"paint" | "inspect" | "pan">("paint");
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
    /** Show / move the simulation party sprite. Sprite path is the
     *  full key passed to the scene's preload (so the texture is
     *  already cached). Position is in grid coords. */
    setPartyAt: (col: number, row: number, sprite: string) => void;
    /** Hide the party sprite entirely. Called on sim teardown. */
    clearParty: () => void;
    /** Override the party-light source the relight pass folds in.
     *  Null disables the extra source. */
    setPartyLight: (source: SimLightSource | null) => void;
  } | null>(null);
  /** The party-light source the simulation contributes. Read by the
   *  scene's relight on every pass — when sim mode is off this stays
   *  null and behavior is identical to the painting view. */
  const partyLightRef = useRef<SimLightSource | null>(null);

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

        const itemsMerged = mergeModel(
          "items",
          itemsLayers.inherited,
          itemsLayers.ownFile,
        ) as { items?: ItemRecord[] } | null;
        const items = itemsMerged?.items ?? [];

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
            character_classes?: Array<{ id: string; name: string }>;
          } | null);

        setState({
          kind: "ok",
          palette,
          counters,
          encounters,
          spawns,
          items,
          mapRecord,
          ownFile: ownEffective ?? null,
          isDraft: hasDraft(moduleId, MODEL_KEY),
          simParty: partyMerged ?? null,
          simCharacters: charactersMerged?.characters ?? [],
          simRaces: racesMerged?.races ?? [],
          simEffects: effectsMerged?.effects ?? [],
          simClasses: classesMerged?.character_classes ?? [],
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
        simParty,
        simCharacters,
      } = state;
      const paletteById = new Map(palette.map((t) => [t.id, t]));
      const encountersById = new Map(encounters.map((e) => [e.id, e]));
      const itemsById = new Map(items.map((i) => [i.id, i]));

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
      // Sim-mode sprites: party avatar + every active member's
      // portrait. Pre-load defensively so toggling sim on doesn't
      // need a second loader pass.
      if (simParty?.avatar) spriteKeys.add(simParty.avatar);
      for (const ch of simCharacters) {
        if (ch.sprite) spriteKeys.add(ch.sprite);
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
        /** Sim-mode party sprite (single Image, depth-300 above
         *  everything else). Null while sim mode is off. */
        partySprite: Phaser.GameObjects.Image | null = null;

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
            (p: Phaser.Input.Pointer) => this.paintAt(p),
          );
          this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
            if (p.isDown) this.paintAt(p);
          });

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

          // Selection highlight — drawn on top of everything.
          this.selectionGraphics = this.add.graphics();
          this.selectionGraphics.setDepth(200);

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
            setPartyAt: () => {
              // Assigned for real below — placeholder so the API object
              // matches the type until create() finishes wiring it.
            },
            clearParty: () => {
              // Assigned for real below.
            },
            setPartyLight: () => {
              // Assigned for real below.
            },
            relight: (mode) => {
              // Day = unconditionally full brightness, fast path. Also
              // clear tints on placed overlays so they don't keep the
              // dim look from a prior twilight/night pass.
              if (mode === "day") {
                for (const img of this.cells.values()) {
                  img.clearTint();
                }
                for (const img of this.encounterOverlays.values()) {
                  img.clearTint();
                }
                for (const img of this.itemOverlays.values()) {
                  img.clearTint();
                }
                return;
              }
              const ambient = mode === "twilight" ? 0.4 : 0.1;
              // Pre-collect light sources so the inner loop only walks
              // a small list per cell.
              const sources: Array<{
                col: number;
                row: number;
                range: number;
              }> = [];
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  if (!cell?.light_source) continue;
                  const range = cell.light_range ?? 0;
                  if (range <= 0) continue;
                  sources.push({ col: c, row: r, range });
                }
              }
              // Add the simulation party's own light source on top —
              // when sim mode is off this ref stays null so the
              // painting view's lighting is unchanged.
              const partyLight = partyLightRef.current;
              if (partyLight && partyLight.range > 0) {
                sources.push({
                  col: partyLight.col,
                  row: partyLight.row,
                  range: partyLight.range,
                });
              }
              /** Bresenham line-of-sight: returns true if no obstructs=true
               *  cell lies strictly between (srcCol,srcRow) and
               *  (dstCol,dstRow). The source and destination cells
               *  themselves are NOT checked — a wall can be lit on its
               *  visible face even though it blocks light beyond it. */
              const hasLOS = (
                srcCol: number,
                srcRow: number,
                dstCol: number,
                dstRow: number,
              ): boolean => {
                if (srcCol === dstCol && srcRow === dstRow) return true;
                const dx = Math.abs(dstCol - srcCol);
                const dy = Math.abs(dstRow - srcRow);
                const sx = srcCol < dstCol ? 1 : -1;
                const sy = srcRow < dstRow ? 1 : -1;
                let err = dx - dy;
                let c = srcCol;
                let r = srcRow;
                // Defensive iteration cap — Bresenham always terminates
                // within dx+dy steps, but guard against bad input.
                const maxSteps = dx + dy + 2;
                for (let i = 0; i < maxSteps; i++) {
                  const e2 = err * 2;
                  if (e2 > -dy) {
                    err -= dy;
                    c += sx;
                  }
                  if (e2 < dx) {
                    err += dx;
                    r += sy;
                  }
                  if (c === dstCol && r === dstRow) return true;
                  const cell = gridRef.current[r]?.[c];
                  if (cell?.obstructs) return false;
                }
                return false;
              };
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  let brightness = ambient;
                  for (const s of sources) {
                    const dist = Math.max(
                      Math.abs(c - s.col),
                      Math.abs(r - s.row),
                    );
                    if (dist > s.range) continue;
                    // LOS check — walls between source and target
                    // cast a shadow on cells beyond.
                    if (!hasLOS(s.col, s.row, c, r)) continue;
                    // Falloff: 1.0 at source, ~0 at edge of range.
                    const falloff = 1 - dist / (s.range + 1);
                    const lit = ambient + (1 - ambient) * falloff;
                    if (lit > brightness) brightness = lit;
                  }
                  const level = Math.max(
                    0,
                    Math.min(255, Math.floor(brightness * 255)),
                  );
                  const tint = (level << 16) | (level << 8) | level;
                  const key = `${c},${r}`;
                  const img = this.cells.get(key);
                  if (img) img.setTint(tint);
                  // Placed overlays share the cell's lighting. Any
                  // future placed-sprite layers (counters, etc.) should
                  // be tinted here as well.
                  const enc = this.encounterOverlays.get(key);
                  if (enc) enc.setTint(tint);
                  const itm = this.itemOverlays.get(key);
                  if (itm) itm.setTint(tint);
                }
              }
            },
          };
          // Add the animation-refresh API so React can sync emitters
          // whenever cells change. Keep the existing relight API call
          // and the initial day-mode tint application below.
          const sceneSelf = this;
          if (sceneApiRef.current) {
            sceneApiRef.current.setPartyAt = (col, row, spritePath) => {
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
            };
            sceneApiRef.current.setPartyLight = (source) => {
              partyLightRef.current = source;
              // Caller is expected to call relight() right after for
              // an instant visual update, but we set the ref here so
              // even a stale relight picks up the new source.
            };
          }
          if (sceneApiRef.current) {
            sceneApiRef.current.refreshEncounterOverlays = () => {
              for (let r = 0; r < mapRecord.height; r++) {
                for (let c = 0; c < mapRecord.width; c++) {
                  const cell = gridRef.current[r]?.[c];
                  const encId = cell?.encounter ?? "";
                  const key = `${c},${r}`;
                  const currentId =
                    sceneSelf.encounterOverlayIds.get(key) ?? "";
                  if (encId === currentId) continue;
                  // Remove the existing overlay (if any).
                  const existing = sceneSelf.encounterOverlays.get(key);
                  if (existing) {
                    existing.destroy();
                    sceneSelf.encounterOverlays.delete(key);
                    sceneSelf.encounterOverlayIds.delete(key);
                  }
                  if (!encId) continue;
                  const enc = encountersById.get(encId);
                  const sprite = enc?.monster_party_tile;
                  if (
                    !sprite ||
                    !sprite.includes("/") ||
                    !sceneSelf.textures.exists(sprite)
                  ) {
                    // No sprite or texture wasn't preloaded — track the
                    // id so we don't repeatedly retry, but don't draw.
                    sceneSelf.encounterOverlayIds.set(key, encId);
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
                  sceneSelf.encounterOverlayIds.set(key, encId);
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
          // Inspect + Pan never paint; just selecting is the whole job.
          // Pan-mode drags are normally swallowed by the React-layer
          // capture handler before Phaser sees them, but guard anyway
          // so a stray click can't repaint a cell unexpectedly.
          if (toolRef.current === "inspect" || toolRef.current === "pan")
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
      // Navigate to the linked map with sim still active and the
      // party landing at the destination coord. The new MapEditor
      // instance reads these params on mount.
      const url =
        `/editor/${moduleId}/maps/${link.map_id}` +
        `?sim=1&entryCol=${link.x}&entryRow=${link.y}`;
      router.push(url);
    },
    [moduleId, router],
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
      active_party: [],
      torch_steps: 0,
      galadriels_light_steps: 0,
    };

    const sim = new MapSimulation({
      grid,
      party,
      catalog: {
        characters: state.simCharacters,
        races: state.simRaces,
        effects: state.simEffects,
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
            onUpdate={(patch) => {
              if (!selectedCell) return;
              setCellFields(selectedCell.col, selectedCell.row, patch);
            }}
          />
        )}
      </div>
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

          <StringEditor
            label="Quest"
            help="Quest id reference. The quest model is not yet ported — this field stores the id verbatim so future ports preserve author intent."
            value={instance.quest ?? ""}
            paletteValue={base?.quest ?? instance.quest ?? ""}
            isModified={
              !!base && fieldDiffersFromPalette(instance, palette, "quest")
            }
            canReset={!!base}
            onChange={(v) => onUpdate({ quest: v })}
            onReset={() => onUpdate({ quest: undefined })}
          />

          <StringEditor
            label="Dungeon"
            help="Dungeon id reference. The dungeon model is not yet ported — this field stores the id verbatim so future ports preserve author intent."
            value={instance.dungeon ?? ""}
            paletteValue={base?.dungeon ?? instance.dungeon ?? ""}
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
  onChange,
  onReset,
}: {
  value: { map_id: string; x: number; y: number } | null;
  paletteValue: { map_id: string; x: number; y: number } | null;
  isModified: boolean;
  canReset: boolean;
  onChange: (
    v: { map_id: string; x: number; y: number } | null,
  ) => void;
  onReset: () => void;
}) {
  const hasLink = value !== null;
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
            <span className="text-[10px] text-parchment/45">map_id</span>
            <input
              type="text"
              value={value.map_id}
              onChange={(e) =>
                onChange({ ...value, map_id: e.target.value })
              }
              placeholder="target-map"
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
            />
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
