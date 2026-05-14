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

import { useEffect, useMemo, useRef, useState } from "react";
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
import { usePublishServer } from "./usePublishServer";

const TILE_SIZE = 32;
const MODEL_KEY = "maps";

interface TileType {
  id: string;
  name: string;
  walkable: boolean;
  sprite: string;
  flags?: { transparent?: boolean };
  link?: { map_id: string; x: number; y: number };
}

interface MapRecord {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  width: number;
  height: number;
  default_tile: string;
  grid: string[][];
  [k: string]: unknown;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      palette: TileType[];
      mapRecord: MapRecord;
      /** The whole maps.json shape for this module's own file (draft-
       *  aware) — needed so we can write back the modified map. */
      ownFile: Record<string, unknown> | null;
      isDraft: boolean;
    }
  | { kind: "error"; message: string };

export function MapEditor({
  moduleId,
  mapId,
}: {
  moduleId: string;
  mapId: string;
}) {
  const { available: publishAvailable } = usePublishServer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [activeBrush, setActiveBrush] = useState<string | null>(null);
  const [gridLinesOn, setGridLinesOn] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Refs that bridge React state into the Phaser scene's closure.
  const brushRef = useRef<string | null>(null);
  const gridRef = useRef<string[][]>([]);
  const persistRef = useRef<() => void>(() => {});
  const sceneApiRef = useRef<{ setGridLinesVisible: (on: boolean) => void } | null>(
    null,
  );

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
        const [paletteLayers, mapsLayers] = await Promise.all([
          src.loadModelLayers(moduleId, "map_tiles"),
          src.loadModelLayers(moduleId, "maps"),
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
        // Deep-clone the grid so mutations don't leak into other readers.
        const clonedGrid = found.grid.map((row) => [...row]);
        const mapRecord: MapRecord = { ...found, grid: clonedGrid };
        gridRef.current = clonedGrid;
        // Seed the brush with the first walkable tile, falling back to first tile.
        const firstBrush =
          palette.find((t) => t.walkable)?.id ?? palette[0]?.id ?? null;
        setActiveBrush(firstBrush);
        setState({
          kind: "ok",
          palette,
          mapRecord,
          ownFile: ownEffective ?? null,
          isDraft: hasDraft(moduleId, MODEL_KEY),
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
        grid: gridRef.current.map((row) => [...row]),
      };
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

  // ── Mount Phaser ────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind !== "ok") return;
    if (!containerRef.current) return;

    let game: import("phaser").Game | null = null;
    let cancelled = false;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;

      const { palette, mapRecord } = state;
      const paletteById = new Map(palette.map((t) => [t.id, t]));

      class MapScene extends Phaser.Scene {
        cells: Map<string, Phaser.GameObjects.Image> = new Map();
        gridGraphics: Phaser.GameObjects.Graphics | null = null;

        preload() {
          for (const tile of palette) {
            this.load.image(
              tile.id,
              withBasePath(`/sprites/${tile.sprite}`),
            );
          }
        }

        create() {
          // Background sized to the grid so out-of-bounds clicks don't
          // capture (the canvas is fixed to the grid size anyway).
          for (let r = 0; r < mapRecord.height; r++) {
            for (let c = 0; c < mapRecord.width; c++) {
              const tileId = gridRef.current[r][c];
              const texKey = paletteById.has(tileId)
                ? tileId
                : mapRecord.default_tile;
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

          // Expose a small API the React side can call.
          sceneApiRef.current = {
            setGridLinesVisible: (on) => {
              this.gridGraphics?.setVisible(on);
            },
          };
        }

        paintAt(p: Phaser.Input.Pointer) {
          const brush = brushRef.current;
          if (!brush || !paletteById.has(brush)) return;
          const c = Math.floor(p.x / TILE_SIZE);
          const r = Math.floor(p.y / TILE_SIZE);
          if (
            c < 0 ||
            r < 0 ||
            c >= mapRecord.width ||
            r >= mapRecord.height
          )
            return;
          if (gridRef.current[r][c] === brush) return;
          gridRef.current[r][c] = brush;
          const img = this.cells.get(`${c},${r}`);
          if (img) img.setTexture(brush);
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

  // Propagate grid-lines toggle to the running scene.
  useEffect(() => {
    sceneApiRef.current?.setGridLinesVisible(gridLinesOn);
  }, [gridLinesOn]);

  // ── Mutators outside paint flow ─────────────────────────────────
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
        <label className="flex items-center gap-2 text-parchment/75">
          <input
            type="checkbox"
            checked={gridLinesOn}
            onChange={(e) => setGridLinesOn(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Grid lines
        </label>
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
        </span>
      </div>

      {/* Body: palette + canvas */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 shrink-0 overflow-auto border-r border-parchment/10 bg-ink/20 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-parchment/45">
            Tile Palette
          </p>
          {palette.length === 0 ? (
            <p className="text-xs text-parchment/55">
              No tile types yet — add some in the Tile Palette editor.
            </p>
          ) : (
            <ul className="space-y-1">
              {palette.map((t) => {
                const active = activeBrush === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setActiveBrush(t.id)}
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
                      <span className="flex-1 truncate">{t.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <div className="flex flex-1 items-start justify-start overflow-auto bg-ink/40 p-4">
          <div
            ref={containerRef}
            className="rounded border border-parchment/20 shadow-lg"
            style={{
              width: mapRecord.width * TILE_SIZE,
              height: mapRecord.height * TILE_SIZE,
            }}
          />
        </div>
      </div>
    </div>
  );
}
