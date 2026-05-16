"use client";

/**
 * BattleSimLauncher — visual-test launcher for the ported v1
 * CombatScene. For this phase the simulator uses v1's bundled sample
 * party + sample encounter (no v2 data adapter yet). Once the v1
 * visuals are confirmed working, the next pass adds the v2→v1 data
 * adapter so battles fight the player's real party against authored
 * encounters from v2's catalogs.
 */

import { useState } from "react";
import { BattleSimV1Mount } from "./BattleSimV1Mount";

export function BattleSimLauncher({ moduleId }: { moduleId: string }) {
  const [started, setStarted] = useState(false);

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="font-display text-3xl text-parchment">
          Battle Simulator
        </h1>
        <p className="mt-1 text-sm text-parchment/55">
          Visual test of v1&apos;s ported CombatScene. Uses v1&apos;s
          sample party + sample encounter so we can verify the original
          look, feel, and animations render correctly before wiring v2
          data. Module: <span className="font-mono">{moduleId}</span>
        </p>
      </header>

      <section className="mb-4 flex items-center gap-3">
        <button
          type="button"
          // `blur()` after the toggle is load-bearing: without it the
          // button keeps keyboard focus, and any Enter/Space the user
          // presses INSIDE the Phaser canvas (e.g. to confirm an
          // action picker) bubbles back to this button and re-fires
          // its onClick — silently flipping `started` back to false
          // and unmounting the canvas. The unmount produces no
          // exception, which makes it look like the battle "just
          // disappears" when the player tries to use the keyboard.
          onClick={(e) => {
            setStarted((v) => !v);
            e.currentTarget.blur();
          }}
          className="rounded border border-ember/60 bg-ember/30 px-4 py-1 text-sm text-parchment hover:bg-ember/50"
        >
          {started ? "Restart Battle" : "Start Battle"}
        </button>
        <p className="text-xs text-parchment/50">
          Sample data: 4-member party vs a random sample encounter.
        </p>
      </section>

      {started ? (
        // Remounted on every Start press via key, so a "Restart" gives
        // a fresh scene with fresh dice rolls + a fresh sample encounter.
        <BattleSimV1Mount key={String(started)} moduleId={moduleId} />
      ) : (
        <p className="text-sm text-parchment/45">
          Press <em>Start Battle</em> to mount the v1 combat scene.
        </p>
      )}
    </div>
  );
}
