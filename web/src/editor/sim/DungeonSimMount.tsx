"use client";

/**
 * DungeonSimMount — Phaser host + MapSimulation harness for walking
 * a procedurally generated dungeon.
 *
 * The mount creates a Phaser game, loads every sprite the dungeon
 * tiles could use, renders the converted grid, and threads keyboard
 * input into a MapSimulation kernel. The sim's roamer / encounter /
 * lock / lighting subsystems all carry through unchanged — a
 * dungeon is just another `SimGrid` to them.
 *
 * Floor-to-floor transitions are intercepted from the simulator's
 * `linked` event: a stairs cell links to the next floor's synthetic
 * map id (see `dungeonLevelToMap.floorMapId`). When the simulator
 * emits that event we tear down the current sim, swap to the new
 * floor's grid (regenerated lazily, cached for the session), and
 * remount the sim at the matching stairs landing on the new floor.
 *
 * Exiting via the entrance stairs on floor 0 (or via stairs-down on
 * the bottom floor of a multi-floor dungeon) emits a separate
 * "exit" link target which we render as a return-to-picker prompt.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/util/basePath";
import {
  TILE_STAIRS,
  type DungeonLevel,
} from "@/v1battle/world/Dungeon";
import { TILE_STAIRS_DOWN } from "@/v1battle/world/Dungeon";
import { TILE_FOREST_ARCHWAY_UP, TILE_FOREST_ARCHWAY_DOWN } from "@/v1battle/world/Tiles";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import { MapSimulation, type SceneBridge } from "@/sim/MapSimulation";
import {
  dungeonEncounterRefs,
  dungeonLevelToMap,
  EXIT_TO_OVERWORLD_MAP_ID,
  type DungeonMapRecord,
} from "@/sim/dungeon/dungeonLevelToMap";
import { DUNGEON_SPRITE_KEYS } from "@/sim/dungeon/tileMapping";
import {
  computeLighting,
  emitterVisibleAt,
  tintForCell,
} from "@/sim/lighting";
import { ANIMATION_CONFIGS } from "@/sim/tileAnimations";
import type {
  SimCharacter,
  SimEncounterRef,
  SimGrid,
  SimLightSource,
  SimMonsterRef,
  SimParty,
  SimRace,
} from "@/sim/types";

const TILE_SIZE = 32;

interface Props {
  moduleId: string;
  dungeonId: string;
  levels: DungeonLevel[];
  /** Floor index to start on (0-based). */
  floorIdx: number;
  /** When set, exiting the dungeon (via stairs-up on F1 or
   *  stairs-down on the bottom floor) routes the user back to the
   *  named overworld map at (col, row). Used when the dungeon was
   *  entered from an entrance cell during overworld sim — the
   *  party comes back out where they came in. */
  returnTo?: { mapId: string; col: number; row: number } | null;
  /** When true, the dungeon renders with the "night" ambient
   *  lighting model — full Bresenham-LOS falloff from torches,
   *  cells beyond a light pool stay near-black. When false, the
   *  whole floor renders at full brightness (matches the editor's
   *  "Day" mode). Used by the launcher's Darkness toggle so
   *  authors can compare lit / unlit layouts at a glance. */
  darkness?: boolean;
  /** When true, the party engages its infravision ability (if any
   *  active member has it). Drives the lighting model's
   *  `partyInfravisionActive` flag. Defaults to false — infravision
   *  is opt-in, matching torches and other party-light effects. */
  infravisionActive?: boolean;
}

export function DungeonSimMount({
  moduleId,
  dungeonId,
  levels,
  floorIdx: initialFloorIdx,
  returnTo,
  darkness = true,
  infravisionActive = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [floorIdx, setFloorIdx] = useState(initialFloorIdx);
  const [exited, setExited] = useState(false);
  /** Active Phaser scene — captured on create() so the React side
   *  can push prop updates (lighting mode toggles, infravision
   *  activation) without rebuilding the whole game. Cleared in
   *  the mount effect's teardown. */
  const sceneRef = useRef<{
    setLightingMode: (m: "day" | "night") => void;
    setPartyInfravisionActive: (active: boolean) => void;
  } | null>(null);
  /** Active MapSimulation. Exposed so the launcher's Infravision
   *  checkbox (or any future prop sync) can call
   *  `sim.setInfravisionActive` — which updates the canonical
   *  `party.infravision_active` field and signals the bridge.
   *  Cleared on teardown alongside `sceneRef`. */
  const simRef = useRef<MapSimulation | null>(null);

  // When `exited` flips and we have a returnTo target, navigate back
  // to the overworld map with sim mode re-engaged at the entrance
  // coords. The MapEditor's existing ?sim=1&entryCol=...&entryRow=...
  // protocol drops the party onto the named cell with sim active.
  useEffect(() => {
    if (!exited || !returnTo) return;
    const url = `/editor/${moduleId}/maps/${returnTo.mapId}?sim=1&entryCol=${returnTo.col}&entryRow=${returnTo.row}`;
    router.push(url);
  }, [exited, returnTo, moduleId, router]);
  // Catalogs loaded once at mount — needed for the sim's roamer
  // sprite resolution and encounter rosters.
  const [catalog, setCatalog] = useState<{
    party: SimParty | null;
    characters: SimCharacter[];
    races: SimRace[];
    monsters: SimMonsterRef[];
  } | null>(null);

  // Load the sim catalogs once. The dungeon tester doesn't need
  // every catalog the map editor pulls (no quests, no NPCs, no
  // boats) — just enough to spawn a party and resolve monster
  // sprites for the placed encounters.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const src = new StaticModuleSource();
      const [partyLayers, charLayers, raceLayers, monsterLayers] =
        await Promise.all([
          src.loadModelLayers(moduleId, "party").catch(() => null),
          src.loadModelLayers(moduleId, "characters").catch(() => null),
          src.loadModelLayers(moduleId, "races").catch(() => null),
          src.loadModelLayers(moduleId, "monsters").catch(() => null),
        ]);
      if (cancelled) return;
      const party =
        partyLayers
          ? (mergeModel(
              "party",
              partyLayers.inherited,
              partyLayers.ownFile,
            ) as SimParty | null)
          : null;
      const charactersMerged = charLayers
        ? (mergeModel(
            "characters",
            charLayers.inherited,
            charLayers.ownFile,
          ) as { characters?: SimCharacter[] } | null)
        : null;
      const racesMerged = raceLayers
        ? (mergeModel(
            "races",
            raceLayers.inherited,
            raceLayers.ownFile,
          ) as { races?: SimRace[] } | null)
        : null;
      const monstersMerged = monsterLayers
        ? (mergeModel(
            "monsters",
            monsterLayers.inherited,
            monsterLayers.ownFile,
          ) as {
            monsters?: Array<{ id: string; name?: string; sprite?: string }>;
          } | null)
        : null;
      setCatalog({
        party,
        characters: charactersMerged?.characters ?? [],
        races: racesMerged?.races ?? [],
        monsters: (monstersMerged?.monsters ?? []).map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          sprite: m.sprite ?? "",
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Convert the active floor's DungeonLevel into a v2 map record.
  // Memoised so floor flicker doesn't re-run the converter on every
  // render.
  const floorRecord = useMemo<DungeonMapRecord | null>(() => {
    const lvl = levels[floorIdx];
    if (!lvl) return null;
    return dungeonLevelToMap(lvl, {
      dungeonId,
      floorIdx,
      totalFloors: levels.length,
    });
  }, [levels, floorIdx, dungeonId]);

  // Encounter catalog for the active floor — each cell's `encounter`
  // id resolves to a synthetic SimEncounterRef built from the
  // generator's DungeonMonster entries.
  const dungeonEncounters = useMemo<SimEncounterRef[]>(() => {
    const lvl = levels[floorIdx];
    if (!lvl) return [];
    return dungeonEncounterRefs(lvl).map((e) => ({
      id: e.id,
      name: e.name,
      monsters: e.monsters,
    }));
  }, [levels, floorIdx]);

  // Mount Phaser when (a) the catalog finished loading and (b) we
  // have a floor record to render. Tear down the entire game on
  // unmount or floor change — simpler than swapping scenes inside
  // a running game.
  useEffect(() => {
    if (exited) return;
    if (!floorRecord || !catalog) return;
    if (!containerRef.current) return;

    let cancelled = false;
    let game: import("phaser").Game | null = null;
    let sim: MapSimulation | null = null;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;

      const spriteKeys = new Set<string>(DUNGEON_SPRITE_KEYS);
      // Add every cell's sprite (covers anything the prototype table
      // didn't pre-declare).
      for (const row of floorRecord.grid) {
        for (const cell of row) {
          if (cell.sprite) spriteKeys.add(cell.sprite);
        }
      }
      // Party sprite + monster sprites.
      if (catalog.party?.avatar) spriteKeys.add(catalog.party.avatar);
      for (const m of catalog.monsters) {
        if (m.sprite) spriteKeys.add(m.sprite);
      }

      const width = floorRecord.width * TILE_SIZE;
      const height = floorRecord.height * TILE_SIZE;

      class DungeonScene extends Phaser.Scene {
        cells: Map<string, Phaser.GameObjects.Image> = new Map();
        partySprite: Phaser.GameObjects.Image | null = null;
        roamerSprites: Map<string, Phaser.GameObjects.Image> = new Map();
        placedSprites: Map<string, Phaser.GameObjects.Image> = new Map();
        encounterOverlays: Map<string, Phaser.GameObjects.Image> = new Map();
        /** Phaser particle emitters keyed by "col,row" — torch
         *  flames, one per `animation: "torch"` cell. Lazy-created
         *  in `create()` after the cell textures land. */
        emitters: Map<
          string,
          Phaser.GameObjects.Particles.ParticleEmitter
        > = new Map();
        partyLight: SimLightSource | null = null;
        /** Last known party cell. Captured every `setPartyAt` so
         *  the relight pass knows where to root the party-vision
         *  light pool and which torches the party currently has
         *  LOS to. Defaults to (0, 0) before the sim mounts;
         *  immediately overwritten by `setPartyAt` on the first
         *  simulator tick. */
        partyCol = 0;
        partyRow = 0;
        /** True when at least one active party member's race grants
         *  the `infravision` ability. Set once at scene boot from
         *  the catalog. The ability being present isn't enough on
         *  its own — see `partyInfravisionActive` below. */
        partyHasInfravision = false;
        /** Whether the player has currently *engaged* infravision.
         *  Pushed via `setPartyInfravisionActive` on the bridge —
         *  the React mount drives this from the launcher's
         *  Infravision checkbox + the sim's `setInfravisionActive`
         *  method. Combined with `partyHasInfravision` at relight
         *  time: red rendering only happens when both are true. */
        partyInfravisionActive = false;
        /** Lighting mode: "day" = full bright, no tinting;
         *  "night" = dark ambient with Bresenham-LOS falloff from
         *  light sources. Toggled by the launcher's Darkness
         *  checkbox via the React `darkness` prop. */
        lightingMode: "day" | "night" = "night";

        constructor() {
          super("DungeonScene");
        }

        preload() {
          for (const key of spriteKeys) {
            this.load.image(key, withBasePath(`/sprites/${key}`));
          }
        }

        create() {
          // Seed the lighting mode from the React prop captured at
          // mount time. The React-side effect below pushes
          // subsequent toggles through `setLightingMode`.
          this.lightingMode = darkness ? "night" : "day";
          // Seed infravision activation from the React prop. The
          // launcher's checkbox + the parent useEffect below keep
          // this in sync.
          this.partyInfravisionActive = infravisionActive;
          sceneRef.current = {
            setLightingMode: (m) => this.setLightingMode(m),
            setPartyInfravisionActive: (active) => {
              if (this.partyInfravisionActive === active) return;
              this.partyInfravisionActive = active;
              this.relight();
            },
          };
          // Detect infravision once at scene boot. Walks the
          // party's roster → character.race → race.abilities,
          // returns true when ANY active member's race carries the
          // "infravision" id. The flag stays static for the
          // dungeon's lifetime (re-mounting picks up a fresh value).
          const racesById = new Map(
            (catalog?.races ?? []).map((r) => [r.id, r]),
          );
          const charactersById = new Map(
            (catalog?.characters ?? []).map((c) => [c.id, c]),
          );
          this.partyHasInfravision = (catalog?.party?.roster ?? []).some(
            (id) => {
              const c = charactersById.get(id);
              if (!c) return false;
              const r = racesById.get(c.race);
              if (!r) return false;
              return (r.abilities ?? []).includes("infravision");
            },
          );
          // Render every cell as an Image keyed by "col,row".
          for (let r = 0; r < floorRecord!.height; r++) {
            for (let c = 0; c < floorRecord!.width; c++) {
              const cell = floorRecord!.grid[r][c];
              const tex = cell.sprite;
              if (!tex || !this.textures.exists(tex)) continue;
              const img = this.add
                .image(c * TILE_SIZE, r * TILE_SIZE, tex)
                .setOrigin(0)
                .setDisplaySize(TILE_SIZE, TILE_SIZE);
              this.cells.set(`${c},${r}`, img);
            }
          }
          // Particle source texture — a 16×16 white circle that
          // each emitter tints + scales. Same one-shot init pattern
          // MapEditor's scene uses so the visual stays consistent.
          if (!this.textures.exists("__particle")) {
            const g = this.add.graphics();
            g.fillStyle(0xffffff, 1);
            g.fillCircle(8, 8, 8);
            g.generateTexture("__particle", 16, 16);
            g.destroy();
          }
          // One particle emitter per cell whose `animation` value
          // names a known config. Shared with the overworld map
          // scene via `sim/tileAnimations.ts` so a torch reads the
          // same in both. Depth 160 sits above the cell tint
          // (a `setTint` on the cell image) but below party /
          // roamer sprites.
          for (let r = 0; r < floorRecord!.height; r++) {
            for (let c = 0; c < floorRecord!.width; c++) {
              const cell = floorRecord!.grid[r][c];
              const animation = (cell.animation ?? "none") as
                | keyof typeof ANIMATION_CONFIGS
                | "none";
              if (animation === "none") continue;
              const cfg = ANIMATION_CONFIGS[animation];
              if (!cfg) continue;
              const x = c * TILE_SIZE + TILE_SIZE / 2;
              const y = r * TILE_SIZE + TILE_SIZE / 2;
              const emitter = this.add.particles(
                x,
                y,
                "__particle",
                cfg as unknown as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
              );
              emitter.setDepth(160);
              this.emitters.set(`${c},${r}`, emitter);
            }
          }
          // Initial encounter-sprite pass — render the dungeon
          // monster lead-sprite on every cell that carries one. The
          // simulator's placed-encounter subsystem will animate them
          // once the sim mounts; this just makes the starting state
          // visible.
          this.refreshEncounterOverlays();
          this.relight();
          // Start the simulation once the textures are ready.
          this.mountSim();
        }

        /** Mode setter — re-runs the lighting pass with the new
         *  ambient. Called from the React effect that watches the
         *  `darkness` prop. */
        setLightingMode(mode: "day" | "night") {
          if (this.lightingMode === mode) return;
          this.lightingMode = mode;
          this.relight();
        }

        refreshEncounterOverlays() {
          // Drop existing.
          for (const img of this.encounterOverlays.values()) img.destroy();
          this.encounterOverlays.clear();
          // No static overlays for dungeons — every encounter is a
          // moving entity rendered via setPlacedEncounterPositions.
        }

        relight() {
          // All the math lives in `sim/lighting.ts` (shared with
          // the overworld scene). We just consume the result and
          // apply tints to cell images, source emitters, and any
          // overlay sprites we track. Same input shape both scenes
          // use, so the dungeon torch + overworld torch render
          // identically.
          const result = computeLighting({
            grid: floorRecord!.grid as unknown as SimGrid,
            party: { col: this.partyCol, row: this.partyRow },
            partyLight: this.partyLight,
            // Infravision renders red only when the party both
            // *has* the ability AND has activated it. Either alone
            // does nothing.
            partyInfravisionActive:
              this.partyHasInfravision && this.partyInfravisionActive,
            mode: this.lightingMode,
          });
          // Per-sprite Phaser dispatch. `tintForCell` returns the
          // tint value to apply; we always use multiply mode so
          // mostly-black sprites (grass, water, etc.) stay mostly
          // black and only their coloured detail pixels read as
          // red in infravision — that lands closer to "heat
          // vision" than a uniform red fill that hides every
          // detail.
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
          // Emitter visibility — covers torch flames AND any
          // decorative animation (fairy / smoke / fire) on cells
          // the party can't actually see. Without this, particle
          // emitters poke through the darkness because they
          // render independent of the cell tint. The shared rule
          // hides emitters on cells at ambient brightness OR
          // infravision-red.
          for (const [key, emitter] of this.emitters) {
            const [cs, rs] = key.split(",");
            emitter.setVisible(
              emitterVisibleAt(result, Number(cs), Number(rs)),
            );
          }
          // Roamer + placed-encounter overlays inherit their cell's
          // render band so a monster in red territory reads as red.
          const tintOverlay = (img: Phaser.GameObjects.Image) => {
            const col = Math.round((img.x - TILE_SIZE / 2) / TILE_SIZE);
            const row = Math.round((img.y - TILE_SIZE / 2) / TILE_SIZE);
            applyTint(img, col, row);
          };
          for (const img of this.roamerSprites.values()) tintOverlay(img);
          for (const img of this.placedSprites.values()) tintOverlay(img);
        }

        setPartyAt(col: number, row: number) {
          // Capture the cell BEFORE we draw the sprite — relight()
          // reads partyCol/Row to root the party-vision pool and
          // gate torch LOS. The bridge wires this so every sim
          // step re-runs relight after the position update.
          this.partyCol = col;
          this.partyRow = row;
          const sprite = catalog!.party?.avatar ?? "";
          const px = col * TILE_SIZE + TILE_SIZE / 2;
          const py = row * TILE_SIZE + TILE_SIZE / 2;
          if (!this.partySprite) {
            const tex =
              sprite && this.textures.exists(sprite) ? sprite : "__party_marker";
            if (
              tex === "__party_marker" &&
              !this.textures.exists("__party_marker")
            ) {
              const g = this.add.graphics();
              g.fillStyle(0xffb84d, 1);
              g.fillCircle(16, 16, 13);
              g.lineStyle(2, 0x4a1c00, 1);
              g.strokeCircle(16, 16, 13);
              g.generateTexture("__party_marker", 32, 32);
              g.destroy();
            }
            this.partySprite = this.add
              .image(px, py, tex)
              .setOrigin(0.5)
              .setDisplaySize(TILE_SIZE, TILE_SIZE)
              .setDepth(300);
          } else {
            this.partySprite.setPosition(px, py);
          }
        }

        setRoamerPositions(
          positions: ReadonlyArray<{
            id: string;
            col: number;
            row: number;
            sprite: string;
          }>,
        ) {
          this.diffMonsterSprites(this.roamerSprites, positions);
        }
        setPlacedEncounterPositions(
          positions: ReadonlyArray<{
            id: string;
            col: number;
            row: number;
            sprite: string;
          }>,
        ) {
          this.diffMonsterSprites(this.placedSprites, positions);
        }

        diffMonsterSprites(
          map: Map<string, Phaser.GameObjects.Image>,
          positions: ReadonlyArray<{
            id: string;
            col: number;
            row: number;
            sprite: string;
          }>,
        ) {
          const wanted = new Map(positions.map((p) => [p.id, p]));
          for (const [id, img] of map) {
            if (wanted.has(id)) continue;
            img.destroy();
            map.delete(id);
          }
          for (const [id, p] of wanted) {
            const px = p.col * TILE_SIZE + TILE_SIZE / 2;
            const py = p.row * TILE_SIZE + TILE_SIZE / 2;
            let img = map.get(id);
            if (!img) {
              const tex =
                p.sprite && this.textures.exists(p.sprite)
                  ? p.sprite
                  : "__party_marker";
              img = this.add
                .image(px, py, tex)
                .setOrigin(0.5)
                .setDisplaySize(TILE_SIZE * 0.95, TILE_SIZE * 0.95)
                .setDepth(250);
              map.set(id, img);
            } else {
              img.setPosition(px, py);
              if (
                p.sprite &&
                this.textures.exists(p.sprite) &&
                img.texture.key !== p.sprite
              ) {
                img.setTexture(p.sprite);
              }
            }
          }
        }

        mountSim() {
          if (!catalog) return;
          // Pick a sensible start cell for THIS floor. F0 starts on
          // the entrance stairs (TILE_STAIRS) so the player can see
          // where they came in. Descending floors start on the
          // matching stairs-up tile too (the generator places one).
          const lvl = levels[floorIdx];
          const startAt = { col: lvl.entryCol, row: lvl.entryRow };
          const grid = floorRecord!.grid as unknown as SimGrid;
          const partyForSim: SimParty = catalog.party ?? {
            start_position: { col: startAt.col, row: startAt.row },
            avatar: "",
            roster: [],
            torch_steps: 0,
            galadriels_light_steps: 0,
          };
          const classNameById = new Map<string, string>();
          const bridge: SceneBridge = {
            setPartyAt: (c, r) => this.setPartyAt(c, r),
            clearParty: () => {
              if (this.partySprite) {
                this.partySprite.destroy();
                this.partySprite = null;
              }
            },
            setPartyLight: (source) => {
              this.partyLight = source;
            },
            relight: () => this.relight(),
            setBoatPositions: () => {},
            setPartyBoatAt: () => {},
            onKey: (handler) => {
              const listener = (e: KeyboardEvent) => {
                const target = e.target as HTMLElement | null;
                if (
                  target &&
                  (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
                ) {
                  return;
                }
                handler(e.key);
              };
              window.addEventListener("keydown", listener);
              return () => window.removeEventListener("keydown", listener);
            },
            setRoamerPositions: (positions) => {
              this.setRoamerPositions(positions);
            },
            setPlacedEncounterPositions: (positions) => {
              this.setPlacedEncounterPositions(positions);
            },
            setSuppressedEncounterCells: () => {},
            setCellSprite: (col, row, sprite) => {
              const img = this.cells.get(`${col},${row}`);
              if (img && this.textures.exists(sprite)) {
                img.setTexture(sprite);
              }
            },
            setPartyInfravisionActive: (active) => {
              // The sim is the source of truth — push the flag
              // into the scene's stored field via sceneRef so the
              // next relight picks it up.
              sceneRef.current?.setPartyInfravisionActive(active);
            },
          };

          sim = new MapSimulation({
            grid,
            party: { ...partyForSim, infravision_active: infravisionActive },
            catalog: {
              characters: catalog.characters,
              races: catalog.races,
              effects: [],
              monsters: catalog.monsters,
              encounters: dungeonEncounters,
              // No spawns inside a procedurally generated dungeon —
              // the monsters are placed inline as encounters.
            },
            classNameById,
            bridge,
            startAt,
          });
          simRef.current = sim;
          sim.subscribe((ev) => {
            if (ev.kind === "linked") {
              const target = ev.link.map_id;
              if (target === EXIT_TO_OVERWORLD_MAP_ID) {
                setExited(true);
                return;
              }
              // Parse out the floor index from the synthetic id —
              // shape is `__dungeon_<id>_f<n>__`.
              const match = target.match(/_f(\d+)__$/);
              if (match) {
                const next = Number.parseInt(match[1], 10);
                if (Number.isFinite(next)) setFloorIdx(next);
              }
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
        scene: DungeonScene,
      });
    })();

    return () => {
      cancelled = true;
      sim?.dispose();
      sim = null;
      sceneRef.current = null;
      simRef.current = null;
      if (game) {
        game.destroy(true);
        game = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorRecord, catalog, exited]);

  // Push `darkness` prop changes into the scene without rebuilding
  // the whole game. The scene already captured the React prop on
  // create() — this effect just re-applies updates while the game
  // is alive.
  useEffect(() => {
    sceneRef.current?.setLightingMode(darkness ? "night" : "day");
  }, [darkness]);

  // Mirror the launcher's Infravision checkbox into the sim by
  // way of `sim.setInfravisionActive` — which updates the
  // canonical `party.infravision_active` field, signals the
  // bridge, and re-runs the relight. We fall back to pushing
  // directly to the scene ref when the sim isn't mounted yet
  // (the bridge's initial-state push will still happen on
  // construction, this is just for prop changes that arrive
  // between renders).
  useEffect(() => {
    const sim = simRef.current;
    if (sim) {
      sim.setInfravisionActive(infravisionActive);
    } else {
      sceneRef.current?.setPartyInfravisionActive(infravisionActive);
    }
  }, [infravisionActive]);

  if (exited) {
    return (
      <div className="rounded border border-parchment/25 bg-ink/60 p-4 text-sm text-parchment">
        <p className="mb-2 font-display text-base">You leave the dungeon.</p>
        <p className="text-parchment/65">
          Pick another dungeon or hit{" "}
          <em>Regenerate</em> above to roll a fresh run.
        </p>
      </div>
    );
  }

  if (!floorRecord) {
    return (
      <p className="text-sm text-parchment/55">No dungeon level to render.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-parchment/55">
        Floor <span className="text-parchment/90">{floorIdx + 1}</span>
        {" / "}
        {levels.length} · grid{" "}
        <span className="font-mono">
          {floorRecord.width}×{floorRecord.height}
        </span>
        · Use WASD or arrow keys.{" "}
        {floorIdx > 0 ? "Stairs ↑ ascend; " : "Stairs ↑ exit; "}
        {floorIdx < levels.length - 1
          ? "stairs ↓ descend."
          : "stairs ↓ exit."}
      </div>
      <div
        ref={containerRef}
        className="rounded border border-parchment/20 bg-ink/80 shadow-xl"
        style={{ display: "inline-block" }}
      />
      <UnusedTilesNote
        unused={[TILE_STAIRS, TILE_STAIRS_DOWN, TILE_FOREST_ARCHWAY_UP, TILE_FOREST_ARCHWAY_DOWN]}
      />
    </div>
  );
}

/** Helper to keep TS quiet about imports the mount reads only for
 *  type clarity. */
function UnusedTilesNote({ unused: _ }: { unused: readonly number[] }) {
  return null;
}
