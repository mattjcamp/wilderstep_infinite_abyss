"use client";

/**
 * BattleSimMount — thin React shim that creates a Phaser game inside
 * a host `<div>`, wires the chosen encounter + map + catalogs into the
 * BattleSimScene, and tears it all down on unmount.
 *
 * The shim itself contains no game logic. Everything from this layer
 * inward is Phaser-only. Unmount happens on key change at the parent
 * (see BattleSimLauncher) so React's diff naturally drives a fresh
 * battle when the user reselects.
 */

import { useEffect, useRef } from "react";
import type {
  PartyAbilityRef,
  PartyCharacterRef,
  PartyClassRef,
  PartyItemRef,
  PartyRaceRef,
  PartyRecord,
  PartySpellRef,
} from "@/editor/PartyScreen";
import type {
  BattleEncounterRef,
  BattleMonsterRef,
} from "@/sim/battle/types";

/** Minimum Map record shape the battle scene reads. The editor's full
 *  MapRecord (web/src/editor/MapEditor.tsx) has more fields; we only
 *  pull the ones the arena needs. */
export interface BattleSimMapRecord {
  id: string;
  name?: string;
  width: number;
  height: number;
  grid: Array<
    Array<{
      id: string;
      sprite?: string;
      walkable?: boolean;
      obstructs?: boolean;
      light_source?: boolean;
      light_range?: number;
    }>
  >;
}

export function BattleSimMount({
  encounter,
  map,
  party,
  characters,
  races,
  classes,
  abilities,
  items,
  spells,
  monsters,
}: {
  encounter: BattleEncounterRef;
  map: BattleSimMapRecord;
  party: PartyRecord;
  characters: ReadonlyArray<PartyCharacterRef>;
  races: ReadonlyArray<PartyRaceRef>;
  classes: ReadonlyArray<PartyClassRef>;
  abilities: ReadonlyArray<PartyAbilityRef>;
  items: ReadonlyArray<PartyItemRef>;
  spells: ReadonlyArray<PartySpellRef>;
  monsters: ReadonlyArray<BattleMonsterRef>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | null = null;

    (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !containerRef.current) return;
      const { BattleSimScene } = await import("./BattleSimScene");
      // Canvas sizing: arena (map width × 32) + HUD (348) + padding.
      // Add room for the banner (32) on top and log (148) at bottom.
      const TILE = 32;
      const HUD_W = 348;
      const HEADER_H = 32;
      const LOG_H = 148;
      const padding = 24;
      const arenaW = map.width * TILE;
      const arenaH = map.height * TILE;
      const width = arenaW + HUD_W + padding * 3;
      const height = HEADER_H + Math.max(arenaH, 480) + LOG_H + padding * 4;

      // Don't auto-start the scene from the Phaser config — Phaser
      // would instantiate + run init/preload with no data, crashing
      // before `postBoot` gets a chance to pass it in. Instead, leave
      // the scene list empty in the config and add + start the scene
      // manually in postBoot with the proper init payload.
      game = new Phaser.Game({
        type: Phaser.AUTO,
        width,
        height,
        parent: containerRef.current,
        backgroundColor: "#0c0c14",
        pixelArt: true,
        scene: [],
        callbacks: {
          postBoot: (g) => {
            g.scene.add("BattleSimScene", BattleSimScene, true, {
              encounter,
              map,
              party,
              characters,
              races,
              classes,
              abilities,
              items,
              spells,
              monsters,
            });
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
