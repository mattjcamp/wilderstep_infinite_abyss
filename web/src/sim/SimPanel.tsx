"use client";

/**
 * SimPanel — right-side panel shown while the editor is in Simulation
 * mode. Displays the live party state (position, light radius, the
 * active four members' HP/MP/level), exposes torch / magic-light
 * controls, and tails a small event log.
 *
 * The panel is a thin view over a MapSimulation instance: it
 * subscribes to `state` events and renders the latest snapshot. All
 * gameplay decisions live in the kernel; the panel only reads.
 */

import { useEffect, useState } from "react";
import type { MapSimulation, SimEvent } from "./MapSimulation";
import type { SimSnapshot } from "./MapSimulation";

const LOG_LIMIT = 40;

export function SimPanel({
  sim,
  onExitSim,
}: {
  sim: MapSimulation;
  onExitSim: () => void;
}) {
  // Snapshot is replaced wholesale on each `state` event. Pulling it
  // into React state (rather than reading sim.snapshot() inline) lets
  // the panel re-render only on changes.
  const [snap, setSnap] = useState<SimSnapshot>(() => sim.snapshot());
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    setSnap(sim.snapshot());
    setLog([]);
    const unsub = sim.subscribe((ev: SimEvent) => {
      if (ev.kind === "state") {
        setSnap(sim.snapshot());
      } else if (ev.kind === "log") {
        setLog((prev) => {
          const next = [...prev, ev.message];
          // Keep the panel from ballooning during long sessions.
          return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next;
        });
      } else if (ev.kind === "linked") {
        // Linked navigation is owned by the host (router.push). We
        // still capture it in the log so the user sees the event.
        setLog((prev) => [
          ...prev,
          `Traversing link → ${ev.link.map_id}@${ev.link.x},${ev.link.y}`,
        ]);
      }
    });
    return unsub;
  }, [sim]);

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-auto border-l border-parchment/10 bg-ink/30 p-3 text-sm text-parchment/85">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base text-parchment">Simulation</h2>
        <button
          type="button"
          onClick={onExitSim}
          className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
          title="Exit Simulation mode and return to painting."
        >
          Exit
        </button>
      </header>
      <p className="text-xs text-parchment/55">
        WASD or arrow keys to move. Cells must be walkable. Stepping
        on a tile with a link traverses to the target map.
      </p>

      <section className="rounded border border-parchment/10 bg-ink/40 p-2">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-parchment/55">
          Party
        </h3>
        <p className="font-mono text-xs text-parchment/80">
          pos: ({snap.pos.col}, {snap.pos.row})
        </p>
        <p className="font-mono text-xs text-parchment/80">
          light radius: {snap.lightRange}
        </p>
        <p className="font-mono text-xs text-parchment/80">
          torch: {snap.party.torch_steps} · galadriel: {snap.party.galadriels_light_steps}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => sim.lightTorch()}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs hover:bg-ink/50"
            title="Set torch_steps to 100 — useful for dark-map testing."
          >
            Light Torch
          </button>
          <button
            type="button"
            onClick={() => sim.castMagicLight()}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs hover:bg-ink/50"
            title="Set galadriels_light_steps to 200 — same idea, bigger radius."
          >
            Magic Light
          </button>
        </div>
      </section>

      <section className="rounded border border-parchment/10 bg-ink/40 p-2">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-parchment/55">
          Active Party ({snap.activeMembers.length}/4)
        </h3>
        {snap.activeMembers.length === 0 ? (
          <p className="text-xs text-parchment/55">
            No active members resolved from the module&apos;s
            characters.json. Check party.json &gt; active_party.
          </p>
        ) : (
          <ul className="space-y-1">
            {snap.activeMembers.map((m) => (
              <li
                key={m.id}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="truncate text-parchment/90">{m.name}</span>
                <span className="font-mono text-parchment/60">
                  L{m.level} {snap.classNameById.get(m.class) ?? m.class} ·
                  HP {m.hp} MP {m.mp}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded border border-parchment/10 bg-ink/40 p-2">
        <h3 className="mb-1 text-xs uppercase tracking-wide text-parchment/55">
          Log
        </h3>
        {log.length === 0 ? (
          <p className="text-xs text-parchment/45">
            (nothing yet — try walking around)
          </p>
        ) : (
          <ol className="space-y-0.5 overflow-auto text-xs text-parchment/75">
            {log.map((line, i) => (
              <li key={i} className="font-mono">
                {line}
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
