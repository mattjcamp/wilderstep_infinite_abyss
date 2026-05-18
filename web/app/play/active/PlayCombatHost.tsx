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

interface Props {
  moduleId: string;
  monsterIds: ReadonlyArray<string>;
  /** Called once when the fight resolves — winner side + XP/gold the
   *  scene awarded to the party. PlayHost applies the consequences. */
  onResolved: (result: CombatResolved) => void;
}

export function PlayCombatHost({ moduleId, monsterIds, onResolved }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Latest onResolved — the Phaser scene captures the callback once at
  // boot; if React rerenders us with a new closure, the ref keeps the
  // scene calling into the current handler.
  const resolvedRef = useRef(onResolved);
  useEffect(() => {
    resolvedRef.current = onResolved;
  }, [onResolved]);

  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | null = null;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;
      const { CombatScene } = await import("@/battle/scenes/CombatScene");
      const { setActiveModule } = await import("@/battle/world/Module");
      setActiveModule(moduleId);

      // The v1 canvas is 960×720 by spec — CombatScene depends on
      // that geometry for its hand-laid HUD layout.
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
    <div
      ref={containerRef}
      className="rounded border border-parchment/20 bg-ink/80 shadow-xl"
      style={{ display: "inline-block" }}
    />
  );
}
