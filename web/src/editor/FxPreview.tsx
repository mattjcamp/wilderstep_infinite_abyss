"use client";

/**
 * FX preview — a small Phaser stage that plays one FX from the catalog
 * between a caster (left) and a target (right), using the params the
 * author is editing right now (not the saved ones), so every change is
 * visible immediately.
 *
 * The parent bumps `playKey` (or changes `params`) to replay. With
 * `loop` on, the effect replays on its own after a short pause.
 */

import { useEffect, useRef } from "react";
import type { FxDef, FxParams } from "@/vfx/fxCatalog";
import { spriteUrl } from "@/data_model/spriteUrl";

const W = 640;
const H = 220;
const ZOOM = 2;
/** World coords (32-px tiles), seen through a ×2 camera. */
const CASTER = { x: 64, y: 62 };
const TARGET = { x: 256, y: 62 };

interface StageApi {
  play: (def: FxDef, params: FxParams) => Promise<void>;
}

export function FxPreview({
  def,
  params,
  playKey,
  loop,
}: {
  def: FxDef;
  params: FxParams;
  playKey: number;
  loop: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<StageApi | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);

  // Boot the Phaser stage once.
  useEffect(() => {
    let cancelled = false;
    let game: import("phaser").Game | null = null;
    readyRef.current = (async () => {
      const Phaser = await import("phaser");
      if (cancelled || !hostRef.current) return;
      await new Promise<void>((resolve) => {
        class Stage extends Phaser.Scene {
          preload() {
            this.load.image("caster", spriteUrl("person/elf_female_wizard.png"));
            this.load.image("target", spriteUrl("monster/demon.png"));
            this.load.image("floor", spriteUrl("map/grass.png"));
            // Missing art is fine — placeholders are drawn instead.
            this.load.on("loaderror", () => undefined);
          }
          create() {
            const cam = this.cameras.main;
            cam.setZoom(ZOOM);
            cam.centerOn(W / ZOOM / 2, H / ZOOM / 2);
            const worldW = W / ZOOM;
            const worldH = H / ZOOM;
            if (this.textures.exists("floor")) {
              for (let x = 0; x < worldW; x += 32) {
                for (let y = 0; y < worldH; y += 32) {
                  this.add.image(x + 16, y + 16, "floor").setDisplaySize(32, 32).setAlpha(0.55);
                }
              }
            } else {
              this.add.rectangle(worldW / 2, worldH / 2, worldW, worldH, 0x2d3a26);
            }
            const actor = (key: string, at: { x: number; y: number }, color: number) =>
              this.textures.exists(key)
                ? this.add.image(at.x, at.y, key).setDisplaySize(32, 32)
                : this.add.rectangle(at.x, at.y, 22, 26, color);
            actor("caster", CASTER, 0x6b7fa8);
            actor("target", TARGET, 0xa84b4b);
            stageRef.current = {
              play: (d, p) => d.play(this, CASTER, TARGET, p),
            };
            resolve();
          }
        }
        game = new Phaser.Game({
          type: Phaser.AUTO,
          width: W,
          height: H,
          parent: hostRef.current!,
          backgroundColor: "#14121a",
          pixelArt: true,
          scene: [Stage],
        });
      });
    })();
    return () => {
      cancelled = true;
      stageRef.current = null;
      game?.destroy(true);
      game = null;
    };
  }, []);

  // Play on selection / param change / Replay; loop if asked.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      await readyRef.current;
      if (stop || !stageRef.current) return;
      try {
        await stageRef.current.play(def, params);
      } catch {
        /* stage torn down mid-play */
      }
      if (!stop && loop) timer = setTimeout(run, 700);
    };
    // Small debounce so dragging a slider doesn't stack dozens of plays.
    timer = setTimeout(run, 120);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [def, params, playKey, loop]);

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded border border-parchment/20"
      style={{ width: W, maxWidth: "100%", height: H, imageRendering: "pixelated" }}
    />
  );
}
