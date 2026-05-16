"use client";

/**
 * BattleSimV1Mount — boots v1's CombatScene against v2 data.
 *
 * Migration model: the v1 game directory was copied verbatim under
 * `src/v1battle/`. Loaders inside that directory now read v2 JSON
 * shapes natively (no translation adapter — v2 IS the data model).
 * The CombatScene + the combat logic above the loaders stays v1.
 *
 * The party comes from `modules/<id>/party.json` joined against
 * `characters.json` (see `loadParty`). The encounter is still v1's
 * bundled sample for this phase — encounter pickers are a separate
 * pass.
 */

import { useEffect, useRef } from "react";

export function BattleSimV1Mount({
  moduleId,
}: {
  moduleId: string;
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
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;
      const { CombatScene } = await import(
        "@/v1battle/scenes/CombatScene"
      );
      // Point v1's loaders at the v2 module the user picked. Must
      // happen BEFORE the scene mounts since preload kicks off
      // module-scoped fetches.
      const { setActiveModule } = await import("@/v1battle/world/Module");
      setActiveModule(moduleId);

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
            g.scene.add(
              "CombatScene",
              CombatScene as unknown as typeof Phaser.Scene,
              true,
              { fromWorld: true },
            );
          },
        },
      });
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
