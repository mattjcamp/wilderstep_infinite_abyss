"use client";

/**
 * Modal overlay shown when the simulator party stumbles into a
 * Monster Spawn fight — either by stepping onto a lair tile (boss
 * fight) or by being caught by a wandering roamer.
 *
 * The combat itself isn't run inline (the standalone /sim/battle
 * page owns the v1 CombatScene). For now this overlay gives the
 * tester two outcomes to drive the loop end-to-end:
 *
 *   - Defeat the encounter → boss → destroy the lair; roamer → kill
 *     the roamer.
 *   - Flee → no kills, no destruction.
 *
 * The roster is rendered as sprite thumbnails so it reads at a
 * glance whether the lair churned out a Goblin or a Dragon. The
 * encounter banner shows the lair name + cell coords so the user
 * can correlate with what they painted.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";
import type { SpawnEncounterOptions } from "@/sim/MapSimulation";
import type { SimMonsterRef } from "@/sim/types";

interface Props {
  options: SpawnEncounterOptions;
  monsters: ReadonlyArray<SimMonsterRef>;
  onResolve: (outcome: "won" | "fled") => void;
}

export function SpawnEncounterOverlay({
  options,
  monsters,
  onResolve,
}: Props) {
  const [resolved, setResolved] = useState<"won" | "fled" | null>(null);

  const byId = new Map(monsters.map((m) => [m.id, m]));

  // Auto-close after a victory so the player gets back to walking
  // without an extra click. Fleeing closes immediately on click.
  useEffect(() => {
    if (resolved !== "won") return;
    const t = setTimeout(() => onResolve("won"), 1100);
    return () => clearTimeout(t);
  }, [resolved, onResolve]);

  const handleWin = () => setResolved("won");
  const handleFlee = () => onResolve("fled");

  // Title / subtitle pivot on `kind` rather than a single boolean so
  // the three encounter flavours each get authoring-appropriate copy.
  const title = (() => {
    if (options.kind === "boss") return `Approach Lair: ${options.name}`;
    if (options.kind === "placed") return `Encounter: ${options.name}`;
    return `Ambush! Roaming ${
      byId.get(options.monsters[0])?.name ?? options.monsters[0]
    }`;
  })();
  const subtitle = (() => {
    if (options.kind === "boss") {
      return options.description ?? "A monster lair.";
    }
    if (options.kind === "placed") {
      return `Roamed in from (${options.sourcePos.col}, ${options.sourcePos.row}).`;
    }
    return `Spawned from ${options.name} at (${options.sourcePos.col}, ${options.sourcePos.row}).`;
  })();
  const reward =
    options.kind === "boss" && options.spawn
      ? `${options.spawn.xp_reward} XP · ${options.spawn.gold_reward} gold`
      : null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Monster encounter"
    >
      <div className="w-[460px] rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl">
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">{title}</h2>
          <span className="font-mono text-[11px] text-parchment/45">
            ({options.sourcePos.col}, {options.sourcePos.row})
          </span>
        </header>

        <p className="mb-3 text-sm text-parchment/75">{subtitle}</p>

        <div className="mb-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-parchment/45">
            {options.kind === "boss"
              ? "Boss Roster"
              : options.kind === "placed"
                ? "Encounter Roster"
                : "Attacker"}
          </p>
          <ul className="flex flex-wrap items-center gap-1">
            {options.monsters.map((id, i) => {
              const m = byId.get(id);
              const src = m?.sprite
                ? withBasePath(`/sprites/${m.sprite}`)
                : null;
              return (
                <li
                  key={`${id}-${i}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-parchment/20 bg-ink/80"
                  title={m?.name ? `${m.name} (${id})` : id}
                >
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      width={36}
                      height={36}
                      style={{ imageRendering: "pixelated" }}
                      className="h-9 w-9 object-contain"
                      onError={(e) => {
                        (
                          e.currentTarget as HTMLImageElement
                        ).style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <span className="px-1 text-[9px] text-parchment/55">
                      {id}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {reward ? (
          <p className="mb-3 text-xs text-parchment/55">
            Victory reward: <span className="text-parchment/85">{reward}</span>
          </p>
        ) : null}

        {resolved === "won" ? (
          <div className="mb-3 rounded border border-emerald-500/40 bg-emerald-700/20 px-3 py-2 text-sm text-emerald-100">
            {options.kind === "boss"
              ? `${options.name} destroyed — the lair falls silent.`
              : options.kind === "placed"
                ? `${options.name} defeated.`
                : "Roamer defeated."}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleWin}
            disabled={!!resolved}
            className="rounded border border-ember/60 bg-ember/25 px-3 py-2 text-left text-sm hover:bg-ember/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium">
              {options.kind === "boss"
                ? "Attack the lair"
                : options.kind === "placed"
                  ? "Engage the encounter"
                  : "Fight the roamer"}
            </div>
            <div className="text-[11px] text-parchment/55">
              {options.kind === "boss"
                ? "Defeat the boss roster and destroy the lair."
                : options.kind === "placed"
                  ? "Defeat the full roster — the encounter won't reappear this session."
                  : "Take down the roamer; the lair survives."}
            </div>
          </button>

          <button
            type="button"
            onClick={handleFlee}
            disabled={!!resolved}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-2 text-left text-sm hover:bg-ink/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium">Retreat</div>
            <div className="text-[11px] text-parchment/55">
              Close the dialog.{" "}
              {options.kind === "boss"
                ? "The lair stays active."
                : options.kind === "placed"
                  ? "The encounter keeps chasing."
                  : "The roamer keeps chasing."}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
