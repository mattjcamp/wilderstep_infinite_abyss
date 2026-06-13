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

import { editorMapHref } from "../moduleRoutes";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/util/basePath";
import { loadSpriteDraft } from "@/data_model/spriteDraft";
import {
  TILE_STAIRS,
  type DungeonLevel,
} from "@/battle/world/Dungeon";
import { TILE_STAIRS_DOWN } from "@/battle/world/Dungeon";
import { TILE_FOREST_ARCHWAY_UP, TILE_FOREST_ARCHWAY_DOWN } from "@/battle/world/Tiles";
import { mergeModel } from "@/data_model/merge";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import {
  MapSimulation,
  type LockEncounterOptions,
  type SceneBridge,
} from "@/sim/MapSimulation";
import { LockDialogOverlay } from "@/editor/LockDialogOverlay";
import {
  dungeonEncounterRefs,
  dungeonLevelToMap,
  EXIT_TO_OVERWORLD_MAP_ID,
  type DungeonMapRecord,
} from "@/sim/dungeon/dungeonLevelToMap";
import { DUNGEON_SPRITE_KEYS } from "@/sim/dungeon/tileMapping";
import {
  getFloorMutations,
  peekDungeonSession,
  writeFloorMutations,
} from "@/sim/dungeon/dungeonSession";
import { tintForCell } from "@/sim/lighting";
import { TILE_SIZE, WorldRenderer } from "@/sim/scene/WorldRenderer";
import type {
  SimCharacter,
  SimCharacterClass,
  SimEncounterRef,
  SimGrid,
  SimMonsterRef,
  SimParty,
  SimRace,
  SimSpell,
} from "@/sim/types";


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
  /** Lock-dialog state — populated by the sim's `lock_encountered`
   *  event when the party bumps a locked cell (interior doors the
   *  generator placed via `placeLockedDoors`). Cleared when the
   *  user picks/knocks the lock or dismisses the dialog. */
  const [lockEncounter, setLockEncounter] =
    useState<LockEncounterOptions | null>(null);
  /** Mirrors any open dialog into a ref so the keyboard bridge can
   *  gate movement without re-binding the listener on every state
   *  change. Same pattern MapEditor uses. */
  const overlaysOpenRef = useRef(false);
  useEffect(() => {
    overlaysOpenRef.current = !!lockEncounter;
  }, [lockEncounter]);
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
    const url = editorMapHref(moduleId, returnTo.mapId, {
      sim: "1",
      entryCol: returnTo.col,
      entryRow: returnTo.row,
    });
    router.push(url);
  }, [exited, returnTo, moduleId, router]);
  // Catalogs loaded once at mount — needed for the sim's roamer
  // sprite resolution, encounter rosters, AND the locked-door
  // dialog (character_classes for Knock-spell caster eligibility,
  // the Knock spell record itself for cost / DC).
  const [catalog, setCatalog] = useState<{
    party: SimParty | null;
    characters: SimCharacter[];
    races: SimRace[];
    monsters: SimMonsterRef[];
    classes: SimCharacterClass[];
    knockSpell: SimSpell | null;
    /** `map_tiles` palette id → sprite path, used to render
     *  custom-style floors/walls. Empty for non-custom dungeons. */
    customTileSprites: ReadonlyMap<string, string>;
  } | null>(null);

  // Load the sim catalogs once. The dungeon tester doesn't need
  // every catalog the map editor pulls (no quests, no NPCs, no
  // boats) — just enough to spawn a party and resolve monster
  // sprites for the placed encounters.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const src = getEditorModuleSource();
      const [
        partyLayers,
        charLayers,
        raceLayers,
        monsterLayers,
        classLayers,
        spellLayers,
        tileLayers,
      ] = await Promise.all([
        src.loadModelLayers(moduleId, "party").catch(() => null),
        src.loadModelLayers(moduleId, "characters").catch(() => null),
        src.loadModelLayers(moduleId, "races").catch(() => null),
        src.loadModelLayers(moduleId, "monsters").catch(() => null),
        // Classes + spells back the locked-door Knock dialog.
        // Non-fatal — without them only the Pick Lock row appears.
        src.loadModelLayers(moduleId, "character_classes").catch(() => null),
        src.loadModelLayers(moduleId, "spells").catch(() => null),
        // Tile palette — only custom-style dungeons read it, but it's
        // cheap and lets the converter resolve floor/wall sprites.
        src.loadModelLayers(moduleId, "map_tiles").catch(() => null),
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
      const classesMerged = classLayers
        ? (mergeModel(
            "character_classes",
            classLayers.inherited,
            classLayers.ownFile,
          ) as { character_classes?: SimCharacterClass[] } | null)
        : null;
      const spellsMerged = spellLayers
        ? (mergeModel(
            "spells",
            spellLayers.inherited,
            spellLayers.ownFile,
          ) as { spells?: SimSpell[] } | null)
        : null;
      // Pluck the Knock spell record out of the merged spells
      // list — the lock dialog only needs that one entry; the rest
      // of the spells catalog isn't consulted here.
      const knockSpell =
        spellsMerged?.spells?.find((s) => s.id === "knock") ?? null;
      const tilesMerged = tileLayers
        ? (mergeModel(
            "map_tiles",
            tileLayers.inherited,
            tileLayers.ownFile,
          ) as { map_tiles?: Array<{ id: string; sprite?: string }> } | null)
        : null;
      const customTileSprites = new Map<string, string>();
      for (const t of tilesMerged?.map_tiles ?? []) {
        if (t.id && t.sprite) customTileSprites.set(t.id, t.sprite);
      }
      setCatalog({
        party,
        characters: charactersMerged?.characters ?? [],
        races: racesMerged?.races ?? [],
        monsters: (monstersMerged?.monsters ?? []).map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          sprite: m.sprite ?? "",
        })),
        classes: classesMerged?.character_classes ?? [],
        knockSpell,
        customTileSprites,
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
      customTileSprites: catalog?.customTileSprites,
    });
  }, [levels, floorIdx, dungeonId, catalog?.customTileSprites]);

  // Encounter catalog for the active floor — each cell's `encounter`
  // id resolves to a synthetic SimEncounterRef built from the
  // generator's DungeonMonster entries. The monsters catalog feeds
  // sprite resolution so `monster_party_tile` ends up as the
  // actual Phaser texture key (e.g. "monster/giant_rat.png")
  // instead of the lead monster's bare id.
  const dungeonEncounters = useMemo<SimEncounterRef[]>(() => {
    const lvl = levels[floorIdx];
    if (!lvl || !catalog) return [];
    const monsterSpriteById = new Map<string, string | undefined>(
      catalog.monsters.map((m) => [m.id, m.sprite]),
    );
    return dungeonEncounterRefs(lvl, monsterSpriteById).map((e) => ({
      id: e.id,
      name: e.name,
      monster_party_tile: e.monster_party_tile,
      monsters: e.monsters,
    }));
  }, [levels, floorIdx, catalog]);

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
          const bg = (cell as { background_sprite?: string }).background_sprite;
          if (bg) spriteKeys.add(bg);
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
        /** Shared world renderer — owns cells, party sprite, roamers,
         *  placed encounters, particle emitters, and the relight
         *  pass. Created in `create()` once textures are loaded. */
        world: WorldRenderer | null = null;
        /** Placed-item overlay sprites keyed by "col,row". One per
         *  cell whose tile carried `placedItemSprite` (chests today;
         *  stairs/artifacts later if we extend the pattern).
         *  Rendered at depth 70 — above the floor cell image, below
         *  particle emitters (160) and roamers (250). Tinted by the
         *  WorldRenderer's `onRelight` hook so they share the same
         *  render band as the cell they sit on. */
        placedItemSprites: Map<
          string,
          Phaser.GameObjects.Image
        > = new Map();

        constructor() {
          super("DungeonScene");
        }

        preload() {
          // Sprite drafts (in-browser pixel editor) take precedence
          // over the on-disk PNG — see PlayHost preload for the same
          // pattern.
          for (const key of spriteKeys) {
            const draft = loadSpriteDraft(moduleId, key);
            this.load.image(
              key,
              draft ?? withBasePath(`/sprites/${key}`),
            );
          }
        }

        create() {
          // Detect infravision once at scene boot. Walks the party's
          // roster → character.race → race.abilities, returns true
          // when ANY active member's race carries the "infravision"
          // id. The flag stays static for the dungeon's lifetime
          // (re-mounting picks up a fresh value).
          const racesById = new Map(
            (catalog?.races ?? []).map((r) => [r.id, r]),
          );
          const charactersById = new Map(
            (catalog?.characters ?? []).map((c) => [c.id, c]),
          );
          const partyHasInfravision = (catalog?.party?.roster ?? []).some(
            (id) => {
              const c = charactersById.get(id);
              if (!c) return false;
              const r = racesById.get(c.race);
              if (!r) return false;
              return (r.abilities ?? []).includes("infravision");
            },
          );

          // Build the shared renderer. `onRelight` tints the dungeon-
          // specific chest overlays so they inherit the per-cell
          // render band (chest in red corridor reads red, in torchlit
          // room reads grayscale).
          this.world = new WorldRenderer({
            scene: this,
            grid: floorRecord!.grid,
            partyAvatar: catalog?.party?.avatar ?? "",
            partyHasInfravision,
            initialLightingMode: darkness ? "night" : "day",
            initialInfravisionActive: infravisionActive,
            onRelight: (result) => {
              for (const [key, img] of this.placedItemSprites) {
                const [cs, rs] = key.split(",");
                const t = tintForCell(result, Number(cs), Number(rs));
                if (t.mode === "clear") img.clearTint();
                else img.setTint(t.value);
              }
            },
          });

          // Expose scene controls back to React. The renderer owns
          // both setters; this just bridges them through the ref the
          // parent useEffects read.
          sceneRef.current = {
            setLightingMode: (m) => this.world?.setLightingMode(m),
            setPartyInfravisionActive: (active) => {
              this.world?.setPartyInfravisionActive(active);
            },
          };

          // Shared init: particle texture, cells, emitters.
          this.world.ensureParticleTexture();
          this.world.createCells();
          this.world.createEmitters();

          // Dungeon-only: chest / placed-item overlays. Anchored
          // center, depth 70 — above floor, below particles + party.
          for (let r = 0; r < floorRecord!.height; r++) {
            for (let c = 0; c < floorRecord!.width; c++) {
              const cell = floorRecord!.grid[r][c];
              const tex = cell.placedItemSprite;
              if (!tex || !this.textures.exists(tex)) continue;
              const img = this.add
                .image(
                  c * TILE_SIZE + TILE_SIZE / 2,
                  r * TILE_SIZE + TILE_SIZE / 2,
                  tex,
                )
                .setOrigin(0.5)
                .setDisplaySize(TILE_SIZE, TILE_SIZE)
                .setDepth(70);
              this.placedItemSprites.set(`${c},${r}`, img);
            }
          }

          // First relight + start the sim.
          this.world.relight();
          this.mountSim();
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
          };
          const classNameById = new Map<string, string>();
          // Capture renderer in a local for the bridge closures —
          // `this.world` is a Phaser scene field; the bridge
          // outlives the scene tear-down so it needs a stable ref.
          const renderer = this.world!;
          const bridge: SceneBridge = {
            setPartyAt: (c, r) => renderer.setPartyAt(c, r),
            clearParty: () => renderer.clearParty(),
            setPartyLight: (source) => renderer.setPartyLight(source),
            relight: () => renderer.relight(),
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
                // Pause movement while a modal dialog (locked door,
                // etc.) is up. The dialog drives the next step via
                // its own button handlers; letting the party keep
                // moving in the background would route around the
                // lock check.
                if (overlaysOpenRef.current) return;
                handler(e.key);
              };
              window.addEventListener("keydown", listener);
              return () => window.removeEventListener("keydown", listener);
            },
            setRoamerPositions: (positions) => {
              renderer.setRoamerPositions(positions);
            },
            setPlacedEncounterPositions: (positions) => {
              renderer.setPlacedEncounterPositions(positions);
            },
            setSuppressedEncounterCells: () => {},
            setCellSprite: (col, row, sprite) => {
              renderer.setCellSprite(col, row, sprite);
            },
            setPartyInfravisionActive: (active) => {
              renderer.setPartyInfravisionActive(active);
            },
          };

          // Pull this floor's mutations from the dungeon session
          // (created on first entry by the launcher). The Sets
          // are LIVE references — passing them as `initial*`
          // copies them into the sim's own state, and we re-snapshot
          // after each `state` event below so the session always
          // reflects the latest. `peekDungeonSession` returns
          // undefined when there's no active session (e.g. tests);
          // in that case the floor starts fresh.
          const session = peekDungeonSession(dungeonId);
          const initialMutations = session
            ? getFloorMutations(session, floorIdx)
            : null;
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
              // characterClasses + knockSpell wire the locked-door
              // dialog's Knock row. Without them the simulator
              // still emits lock_encountered events and the Pick
              // Lock row works; the Knock row is just suppressed.
              characterClasses: catalog.classes,
              knockSpell: catalog.knockSpell,
            },
            classNameById,
            bridge,
            startAt,
            initialUnlockedCells: initialMutations?.unlockedCells,
            initialDefeatedEncounters:
              initialMutations?.defeatedEncounters,
            initialDestroyedLairs: initialMutations?.destroyedLairs,
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
            if (ev.kind === "lock_encountered") {
              // Party bumped a locked door — pop the Pick Lock /
              // Cast Knock dialog. The simulator stores the
              // pending lock; the dialog drives the next step via
              // sim.attemptPickLock / attemptKnock / dismissLock.
              // Movement is gated by overlaysOpenRef while the
              // modal is up.
              setLockEncounter(ev.options);
            }
            // Mirror the sim's mutation state back into the
            // dungeon session on every state tick. Cheap: the
            // Sets are tiny, and the snapshot aliases the kernel's
            // internal Sets — we clone here so a later in-sim
            // mutation can't bleed back through stored references.
            // Catches every meaningful state change: defeated
            // encounters, picked locks, destroyed lairs (the
            // sim emits `state` after each).
            if (ev.kind === "state" && session) {
              const snap = sim!.snapshot();
              writeFloorMutations(session, floorIdx, {
                unlockedCells: new Set(snap.unlockedCells),
                defeatedEncounters: new Set(snap.defeatedEncounters),
                destroyedLairs: new Set(snap.destroyedLairs),
                pickedItemCells: new Set(snap.pickedItemCells),
              });
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
        <p className="text-parchment/80">
          Pick another dungeon or hit{" "}
          <em>Regenerate</em> above to roll a fresh run.
        </p>
      </div>
    );
  }

  if (!floorRecord) {
    return (
      <p className="text-sm text-parchment/75">No dungeon level to render.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-parchment/75">
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
      {/* Locked-door dialog — opens when the party bumps a cell
          flagged `locked: true` (interior doors the dungeon
          generator placed). Same overlay component the map
          editor uses; the sim drives the dice rolls + cell
          unlock through the simRef callbacks. */}
      {lockEncounter ? (
        <LockDialogOverlay
          options={lockEncounter}
          onPickLock={() => simRef.current?.attemptPickLock() ?? null}
          onCastKnock={() => simRef.current?.attemptKnock() ?? null}
          onClose={() => {
            simRef.current?.dismissLock();
            setLockEncounter(null);
          }}
        />
      ) : null}
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
