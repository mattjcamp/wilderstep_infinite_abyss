"use client";

/**
 * BattleSimMount — boots the canonical CombatScene against v2 data.
 *
 * This is the v2 combat path. The scene's heritage is the v1 Python
 * port (the file started life under `src/v1battle/`), but every
 * loader in `src/battle/` now reads v2 JSON shapes natively (no
 * translation adapter — v2 IS the data model), so the "v1" label
 * doesn't apply anymore. Future combat work — new actions, spells,
 * AI, encounter overlays — lands in this scene. When we eventually
 * wire combat into the live game, the entry point goes through this
 * mount too: editor sim and live game share the same combat path.
 *
 * Inputs:
 *   - `moduleId` — which module's catalogs to read. `setActiveModule`
 *     is pinned BEFORE the scene mounts so its preload fetches the
 *     right module's items/spells/monsters/party data.
 *   - `monsterIds` — the picked encounter's roster (catalog ids).
 *     Forwarded to CombatScene as `monsterNames` (the scene's existing
 *     init-data field). When omitted the scene falls back to the
 *     hand-built sample encounter.
 *   - `arenaCells` — optional per-cell sprite + walkable + obstructs
 *     matrix the picked arena map resolves to. CombatScene preloads
 *     the sprites, bakes them into the arena RT, and installs
 *     walkability + line-of-sight predicates into Combat so rocks /
 *     pits / tall grass actually affect the fight.
 *
 * The party comes from `modules/<id>/party.json` joined against
 * `characters.json` (see `loadParty`).
 */

import { useEffect, useRef } from "react";
import type { ArenaCellInfo } from "@/battle/world/Maps";

/** sessionStorage guard so a genuinely-missing chunk reloads at most
 *  once instead of looping. Cleared after a full successful mount. */
const CHUNK_RELOAD_KEY = "battlesim:chunk-reload";

/** True for a webpack "stale chunk" failure — the requested chunk's
 *  hashed filename no longer exists on the server. Happens after a dev
 *  recompile (which re-chunks and renames) or a production redeploy
 *  while the page was open. The data is fine; the page just holds a
 *  reference to a chunk name that's been superseded. */
function isChunkLoadError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "ChunkLoadError" ||
      /Loading chunk [\w-]+ failed/i.test(err.message))
  );
}

/** Dynamic-import wrapper that recovers from a stale-chunk 404 by
 *  reloading the page once (so it fetches the current chunk manifest).
 *  Re-throws anything that isn't a chunk-load error, and won't reload a
 *  second time in the same session — a real build break surfaces as the
 *  error rather than an infinite reload loop. On a chunk error it
 *  returns a never-settling promise so the caller doesn't proceed
 *  before the reload takes effect. */
async function importWithChunkRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
    } catch {
      /* sessionStorage unavailable — fall through to rethrow */
    }
    if (isChunkLoadError(err) && !alreadyReloaded && typeof window !== "undefined") {
      try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
      return new Promise<T>(() => {});
    }
    throw err;
  }
}

export function BattleSimMount({
  moduleId,
  monsterIds,
  arenaCells,
  darkness,
  partyInfravisionActive,
}: {
  moduleId: string;
  monsterIds?: readonly string[];
  arenaCells?: ReadonlyArray<ReadonlyArray<ArenaCellInfo | null>>;
  /** When true the CombatScene paints a darkness overlay over the arena
   *  and uses the map's `light_source` cells (plus a small pool around
   *  the active party member) to "punch" pools of light. Off keeps the
   *  legacy fully-bright look. */
  darkness?: boolean;
  /** When true (and darkness is on), the active party's infravision
   *  ability paints in-LOS dark cells red and makes them targetable.
   *  Inert when `darkness` is false. */
  partyInfravisionActive?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | null = null;

    // Surface uncaught errors / rejections that would otherwise be
    // swallowed by Phaser's animation loop or React's silent unmount,
    // so the in-canvas combat scene's failures show up clearly in the
    // browser console (with a recognisable [BattleSim] prefix).
    const onError = (e: ErrorEvent) => {
      // eslint-disable-next-line no-console
      console.error("[BattleSim] uncaught error:", e.error ?? e.message, e);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.error("[BattleSim] unhandled promise rejection:", e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    (async () => {
      const Phaser = await importWithChunkRetry(() => import("phaser"));
      if (cancelled || !containerRef.current) return;
      const { CombatScene } = await importWithChunkRetry(
        () => import("@/battle/scenes/CombatScene"),
      );
      // Point v1's loaders at the v2 module the user picked. Must
      // happen BEFORE the scene mounts since preload kicks off
      // module-scoped fetches.
      const { setActiveModule } = await import("@/battle/world/Module");
      setActiveModule(moduleId);

      // Reset gameState.partyData so the simulator always boots from
      // the live characters.json catalog (level 10 demo party), not
      // from a leftover save-derived snapshot.
      //
      // Background: the play-time path's seedBattleCaches() populates
      // `gameState.partyData` from the active save (Pippin LVL 1, etc.).
      // CombatScene.preload then does
      //   `if (!gameState.partyData) gameState.partyData = await loadParty()`
      // — which REUSES whatever is there. Without this reset, opening
      // the simulator after a play session inherits the save's roster,
      // making class abilities that gate on level (Backstab L3+,
      // Shadow Step L7+, Turn Undead L2+, etc.) silently fail to fire
      // even though characters.json puts the demo Thief at L10. The
      // simulator is a "what-if" pane, so always start from the catalog.
      const { gameState } = await import("@/battle/state");
      gameState.partyData = null;

      // v1 canvas is 960×720 by spec.
      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 960,
        height: 720,
        parent: containerRef.current,
        backgroundColor: "#0c0c14",
        pixelArt: true,
        scene: [],
        callbacks: {
          postBoot: (g) => {
            // `fromWorld: true` makes CombatScene fetch the live
            // party (modules/<id>/party.json + characters.json) via
            // loadParty(); without it, the scene falls back to v1's
            // hand-built demo party (Kael/Thora/Syl/Miren).
            //
            // `monsterNames` is the CombatScene init-data field for
            // a custom enemy roster. Omitting it (or passing an empty
            // array) keeps the v1 sample-encounter fallback.
            g.scene.add(
              "CombatScene",
              CombatScene as unknown as typeof Phaser.Scene,
              true,
              {
                fromWorld: true,
                // The simulator is a visual-test pane; running it
                // shouldn't blast the combat soundtrack at the user.
                // The scene's `silent` flag suppresses the per-area
                // music kick + stops any leftover track on entry.
                silent: true,
                monsterNames:
                  monsterIds && monsterIds.length > 0
                    ? [...monsterIds]
                    : undefined,
                // Snapshot the matrix so a later mutation to the
                // launcher's React state can't desync mid-render.
                arenaCells: arenaCells
                  ? arenaCells.map((row) => [...row])
                  : undefined,
                darkness: !!darkness,
                partyInfravisionActive: !!partyInfravisionActive,
              },
            );
          },
        },
      });
      // Full mount succeeded — clear the one-shot reload guard so a
      // future stale chunk (next deploy / next dev recompile) can
      // recover with its own single reload.
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (game) {
        game.destroy(true);
        game = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="rounded border border-parchment/20 bg-ink/80 shadow-xl"
      style={{ display: "inline-block" }}
    />
  );
}
