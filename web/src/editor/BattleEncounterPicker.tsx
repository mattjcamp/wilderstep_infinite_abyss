"use client";

/**
 * BattleEncounterPicker — lists every Encounter in the loaded module
 * so the designer can pick one to test against the current party.
 *
 * The picker is intentionally simple: id + name + level + monster
 * count. Filtering / sorting can come later. Clicking a row fires
 * `onPick(encounter)` and the parent swaps over to <BattleScreen>.
 */

import type { BattleEncounterRef } from "@/sim/battle/types";

export function BattleEncounterPicker({
  encounters,
  onPick,
  onCancel,
}: {
  encounters: ReadonlyArray<BattleEncounterRef>;
  onPick: (encounter: BattleEncounterRef) => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-xl overflow-auto rounded-lg border border-parchment/20 bg-ink/95 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-parchment/15 px-3 py-1.5">
          <h2 className="font-display text-base text-parchment">
            Pick an Encounter
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-parchment/20 px-2 py-0.5 text-xs text-parchment/70 hover:bg-ink/40"
            title="Cancel (ESC)"
          >
            Cancel
          </button>
        </div>
        <ul className="divide-y divide-parchment/10">
          {encounters.length === 0 ? (
            <li className="px-3 py-2 text-sm text-parchment/55">
              No encounters in this module.
            </li>
          ) : null}
          {encounters.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onPick(e)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-ink/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm text-parchment">
                    {e.name ?? e.id}{" "}
                    <span className="font-mono text-[11px] text-parchment/45">
                      {e.id}
                    </span>
                  </div>
                  <div className="text-[11px] text-parchment/60">
                    Level {e.level ?? "?"} ·{" "}
                    {e.monsters?.length ?? 0} monster
                    {(e.monsters?.length ?? 0) === 1 ? "" : "s"}
                    {e.monsters?.length ? ` · ${e.monsters.join(", ")}` : ""}
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-amber-300">
                  Test →
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
