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
import type { CombatResolved } from "@/battle/scenes/CombatScene";
import { PlayCombatHost } from "./PlayCombatHost";
import {
  MapSimulation,
  type LockEncounterOptions,
  type SceneBridge,
  type SpawnEncounterOptions,
} from "@/sim/MapSimulation";
import { TILE_SIZE, WorldRenderer } from "@/sim/scene/WorldRenderer";
import { buildArenaCells } from "@/play/buildArenaCells";
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

interface LoadedCatalog {
  map: PlayMapRecord;
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
  knockSpell: SimSpell | null;
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
  /** Active combat — set on `spawn_encountered`, cleared when the
   *  combat scene reports back via `onResolved`. While set the world
   *  Phaser game is unmounted and PlayCombatHost takes its place. */
  const [combat, setCombat] = useState<SpawnEncounterOptions | null>(null);
  const overlaysOpenRef = useRef(false);
  useEffect(() => {
    // Both modal lock-dialog AND active combat gate keyboard movement
    // through the same ref so the world sim freezes under either.
    overlaysOpenRef.current = !!lockEncounter || !!combat;
  }, [lockEncounter, combat]);

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
      try {
        const catalog = await loadCatalog(save);
        if (cancelled) return;
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
    const snap = sim.snapshot();
    // Per-map mutations for the current map.
    const mapState = {
      unlockedCells: Array.from(snap.unlockedCells),
      defeatedEncounters: Array.from(snap.defeatedEncounters),
      destroyedLairs: Array.from(snap.destroyedLairs),
    };
    const next: WorldSave = {
      ...save,
      party: {
        ...save.party,
        col: snap.pos.col,
        row: snap.pos.row,
        infravision_active: !!snap.party.infravision_active,
        torch_steps: snap.party.torch_steps,
        galadriels_light_steps: snap.party.galadriels_light_steps,
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

      // Collect every sprite key the cells, party, and monsters need.
      const spriteKeys = new Set<string>();
      for (const row of catalog.map.grid) {
        for (const cell of row) {
          if (cell.sprite) spriteKeys.add(cell.sprite);
        }
      }
      if (save.party.avatar) spriteKeys.add(save.party.avatar);
      for (const m of catalog.monsters) {
        if (m.sprite) spriteKeys.add(m.sprite);
      }

      const width = catalog.map.width * TILE_SIZE;
      const height = catalog.map.height * TILE_SIZE;

      class PlayScene extends Phaser.Scene {
        world: WorldRenderer | null = null;
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

          this.world = new WorldRenderer({
            scene: this,
            grid: catalog.map.grid,
            partyAvatar: save.party.avatar,
            partyHasInfravision,
            // Day for testing — full-brightness rendering so authors
            // can walk the world without torch-LOS gating getting in
            // the way. The future game clock + per-map ambient flag
            // will pick "night" automatically (dungeons, after-dusk
            // overworld, etc.); for now everywhere reads as daylit.
            initialLightingMode: "day",
            initialInfravisionActive: !!save.party.infravision_active,
          });
          this.world.ensureParticleTexture();
          this.world.createCells();
          this.world.createEmitters();
          this.world.relight();
          this.mountSim();
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
            setBoatPositions: () => {
              // Boat-as-cell-texture is editor-side bookkeeping today;
              // the play scene relies on the sim's own cell sprite
              // swap path through setCellSprite, which the kernel
              // routes correctly for board / disembark.
            },
            setPartyBoatAt: () => {
              // Same caveat — the party-on-boat sprite (a separate
              // image overlay) is editor-only. The kernel still
              // tracks boat state for movement; the visual just
              // doesn't change here yet.
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
              groundTile,
            },
            classNameById,
            bridge,
            startAt: { col: save.party.col, row: save.party.row },
            initialUnlockedCells,
            initialDefeatedEncounters,
            initialDestroyedLairs,
          });
          simRef.current = sim;

          sim.subscribe((ev) => {
            if (ev.kind === "linked") {
              handleLinked(ev.link);
              return;
            }
            if (ev.kind === "lock_encountered") {
              setLockEncounter(ev.options);
              return;
            }
            if (ev.kind === "dungeon_entered") {
              // Phase 4 territory — surface a stub log so the
              // designer knows the trigger fired without crashing
              // through into a half-built dungeon path.
              // eslint-disable-next-line no-console
              console.info(
                `[play] dungeon_entered "${ev.dungeonId}" (Phase 4b)`,
              );
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

    /** Handle a link event from the kernel. Saves the current map's
     *  mutations + party position FIRST, then either teleports (same
     *  map) or bumps the reload key (cross-map). */
    function handleLinked(link: { map_id: string; x: number; y: number }) {
      const save = saveRef.current;
      if (!save) return;
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
      //
      // Do (2) FIRST so saveRef.current carries the post-fight party
      // before saveCurrent reads it.
      if (saveRef.current) {
        saveRef.current = applyCombatResultToSave(saveRef.current);
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

      {combat && state.save && state.catalog ? (
        <PlayCombatHost
          // Reseat the Phaser game per fight via React's key — every
          // new encounter gets a fresh CombatScene instance with the
          // right monster roster.
          key={`${combat.sourcePos.col},${combat.sourcePos.row}`}
          moduleId={state.save.moduleId}
          monsterIds={combat.monsters}
          save={state.save}
          arenaCells={buildArenaCells(
            state.catalog.map.grid,
            combat.sourcePos.col,
            combat.sourcePos.row,
          )}
          onResolved={onCombatResolved}
        />
      ) : null}

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

  return {
    map,
    palette,
    characters,
    races: racesDoc.races ?? [],
    classes: classesDoc.character_classes ?? [],
    effects: effectsDoc.effects ?? [],
    monsters: monstersDoc.monsters ?? [],
    encounters: encountersDoc.encounters ?? [],
    spawns: spawnsDoc.spawns ?? [],
    knockSpell,
  };
}

// Reference to silence "unused" lints — keeps the SavedCharacterState
// import expressive in the source even though we don't reference it
// after the loader pulls it through type widening above.
type _SavedCharacterStateBridge = CharacterRecord;
