"use client";

/**
 * PlayCombatHost — Phaser host for the play-side CombatScene.
 *
 * The world side (PlayHost) renders this when `spawn_encountered`
 * fires. We mount a fresh Phaser game with CombatScene, hand it the
 * encounter's monster ids, pin the active module so the scene's
 * loaders resolve against the right catalogs, and provide an
 * `onResolved` callback so the scene reports its outcome back to React
 * instead of bouncing to a v1 scene.
 *
 * The host doesn't decide anything about the outcome — it just
 * forwards the resolution upward. PlayHost applies the result (mark
 * encounter defeated, route to end screen, etc.).
 *
 * Lifecycle: parent re-creates this component each time a fight
 * starts (different React key), so the Phaser game is fresh per fight
 * and tears down cleanly on unmount.
 */

import { useEffect, useRef } from "react";
import type { CombatResolved } from "@/battle/scenes/CombatScene";
import type { ArenaCellInfo } from "@/battle/world/Maps";
import { seedBattleCaches } from "@/play/seedBattleCaches";
import type { WorldSave } from "@/play/saveTypes";

interface Props {
  moduleId: string;
  monsterIds: ReadonlyArray<string>;
  /** The active save. Seeds v1battle's caches with the saved party
   *  (HP/MP, custom characters, inventory) so CombatScene loads the
   *  *real* roster instead of falling back to the demo party. */
  save: WorldSave;
  /** 18×16 arena cell matrix — cropped from the world map around the
   *  encounter location. Paints the fight on the actual terrain
   *  (grass / road / forest), and the per-cell walkable + obstructs
   *  flags feed the scene's movement + line-of-sight predicates.
   *  Pass `undefined` to let the scene fall back to its generic
   *  green-field arena. */
  arenaCells?: ReadonlyArray<ReadonlyArray<ArenaCellInfo | null>>;
  /** When true, the combat scene paints a darkness overlay and uses
   *  the arena matrix's `light_source` cells (plus a small pool
   *  around the active member) to "punch" holes of light. Driven by
   *  the world's time-of-day at encounter time so a fight that
   *  triggers at night reads as a night fight, not a sunlit one. */
  darkness?: boolean;
  /** When true, the combat scene's infravision pass is "armed" —
   *  during a turn the scene will tint LOS cells red for the active
   *  actor IF that actor's race carries the infravision ability.
   *  Only meaningful while `darkness` is on; daylight fights ignore
   *  this. Routing the flag here means an active dwarf in a night
   *  fight automatically sees the dark cells he could otherwise not
   *  target — without a separate toggle UI on the play side. */
  partyInfravisionActive?: boolean;
  /** Called once when the fight resolves — winner side + XP/gold the
   *  scene awarded to the party. PlayHost applies the consequences. */
  onResolved: (result: CombatResolved) => void;
}

export function PlayCombatHost({
  moduleId,
  monsterIds,
  save,
  arenaCells,
  darkness,
  partyInfravisionActive,
  onResolved,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Latest onResolved — the Phaser scene captures the callback once at
  // boot; if React rerenders us with a new closure, the ref keeps the
  // scene calling into the current handler.
  const resolvedRef = useRef(onResolved);
  useEffect(() => {
    resolvedRef.current = onResolved;
  }, [onResolved]);

  // Lock the document's scroll while combat is mounted. The earlier
  // approach — a window-level `keydown` listener that called
  // `preventDefault()` for arrows / space / page-up/down — was
  // suppressing the browser's scroll BUT also breaking Phaser's
  // own keyboard manager: Phaser 4's manager checks
  // `event.defaultPrevented` and skips the per-key emit when it's
  // true, so any `preventDefault()` on the same event silently
  // killed combat's arrow / space bindings. Pinning `overflow:
  // hidden` on `<html>` and `<body>` removes the scroll entirely —
  // the browser still tries to scroll the page on those keys, but
  // there's nothing to scroll, so nothing happens. Phaser sees the
  // raw events unmolested and combat keys keep working.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | null = null;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;
      const { CombatScene } = await import("@/battle/scenes/CombatScene");
      const { setActiveModule } = await import("@/battle/world/Module");
      setActiveModule(moduleId);
      // Inheritance-aware cache seed. Without this, CombatScene's
      // loaders hit /modules/<id>/X.json — flat lookups that don't
      // walk the v2 `extends` chain — and a module like `test` that
      // ships only module.json + maps.json sees 404s on every catalog
      // (party, items, spells, monsters, races, effects). The result
      // is a fall-through to v1's hand-built demo party and empty
      // catalogs that grey out Cast / Throw / Use Item. Seeding the
      // caches up-front with merged data makes CombatScene's loaders
      // cache-hits and they never touch /modules/.
      await seedBattleCaches(moduleId, save);
      if (cancelled || !containerRef.current) return;

      // The v1 canvas is 960×720 by spec — CombatScene depends on
      // that geometry for its hand-laid HUD layout. Scale.FIT lets
      // the canvas DOM element shrink to fit the parent box on
      // smaller viewports without breaking the internal HUD math,
      // matching what PlayHost does for the overworld.
      game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 960,
        height: 720,
        parent: containerRef.current,
        backgroundColor: "#0c0c14",
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [],
        callbacks: {
          postBoot: (g) => {
            // `fromWorld: true` makes CombatScene fetch the live party
            // (modules/<id>/party.json + characters.json) via loadParty
            // rather than the hand-built demo party. `monsterNames`
            // names the encounter's monster catalog ids.
            g.scene.add(
              "CombatScene",
              CombatScene as unknown as typeof Phaser.Scene,
              true,
              {
                fromWorld: true,
                silent: true,
                monsterNames:
                  monsterIds.length > 0 ? [...monsterIds] : undefined,
                // Snapshot the matrix so a later mutation to the
                // host's React state can't desync mid-render — same
                // pattern the editor's BattleSim uses.
                arenaCells: arenaCells
                  ? arenaCells.map((row) => [...row])
                  : undefined,
                // Inherits the world's time-of-day at the moment the
                // encounter fired. A fight that triggers at dusk /
                // night reads as a dim / dark fight (the combat
                // scene paints its darkness overlay + uses any
                // light_source cells in the arena matrix); a fight
                // mid-day stays bright.
                darkness: !!darkness,
                // Race-based infravision passes through. The scene
                // checks `partyInfravisionActive && darkness &&
                // current.race ∈ infravisionRaces` per actor — so
                // setting this true is benign for the non-dwarf
                // party members; only the dwarf's turn paints red.
                partyInfravisionActive: !!partyInfravisionActive,
                // Routes the scene's exit through React instead of
                // letting it scene.start a v1 world scene that
                // doesn't exist anymore.
                onResolved: (result: CombatResolved) => {
                  resolvedRef.current(result);
                },
              },
            );
          },
        },
      });
    })();

    return () => {
      cancelled = true;
      if (game) {
        game.destroy(true);
        game = null;
      }
    };
    // moduleId + monsterIds are captured at mount — changing them
    // requires remounting (parent uses a `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Mirrors the overworld canvas wrapper in PlayHost so the
    // battle screen pegs to exactly 960×720 on a window with room
    // (and shrinks proportionally via the 4:3 aspect on narrower
    // viewports) instead of free-flowing as inline-block. Without
    // this the canvas would size itself purely from the Phaser
    // geometry and the surrounding page chrome could push it
    // around as React rerendered.
    <div
      ref={containerRef}
      className="aspect-[4/3] w-[960px] max-w-full overflow-hidden rounded border border-parchment/20 bg-ink/80 shadow-xl"
      style={{ aspectRatio: "4 / 3" }}
    />
  );
}
