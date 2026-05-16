"use client";

/**
 * Modal overlay that pops up when the party bumps into an NPC during
 * simulation. Mounted by MapEditor on the npc_encountered sim event.
 *
 * Layout (top-down):
 *   - Header: NPC sprite + name + close
 *   - Speech: a single dialog drawn at random from the NPC's dialogs
 *             array, shown like the NPC said it. Stays stable while
 *             the overlay is open — re-bumping the NPC re-rolls.
 *             Tapping "Backstory" swaps this area for the
 *             personal_history text instead; "Back" returns to speech.
 *   - Footer: [Backstory toggle] [Shop (if counter)] [Leave]
 *
 * The overlay is purely a viewer + branch-launcher; it doesn't mutate
 * any state itself. The Shop button calls onOpenShop with the
 * counter id and the host opens the CounterShopOverlay; Leave calls
 * onClose so MapEditor can re-enable keyboard movement.
 */

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/util/basePath";

interface DialogEntry {
  id: string;
  title?: string;
  text: string;
}

export interface NpcOverlayRecord {
  id: string;
  name: string;
  sprite?: string;
  personal_history?: string;
  counter?: string;
  dialogs?: DialogEntry[];
}

/** Resolve an NPC's sprite field to a URL the editor can render. Bare
 *  stems default to the person/ folder; slash-bearing values go under
 *  /sprites/ verbatim. Mirrors the resolver used by the cell-inspector
 *  preview so the overlay's portrait matches the on-map render. */
function resolveNpcSpriteUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("/")) return withBasePath(`/sprites/${raw}`);
  const withExt = /\.[a-z]+$/i.test(raw) ? raw : `${raw}.png`;
  return withBasePath(`/sprites/person/${withExt}`);
}

export function NpcDialogOverlay({
  npc,
  onOpenShop,
  onClose,
}: {
  npc: NpcOverlayRecord;
  /** Invoked when the player clicks Shop. The host opens the
   *  CounterShopOverlay with the npc's counter id. Pass the id rather
   *  than the full counter record so the overlay doesn't need to know
   *  the counter shape. */
  onOpenShop: (counterId: string) => void;
  onClose: () => void;
}) {
  // "speech" shows the randomly-picked dialog; "backstory" swaps in
  // the personal_history text. Default to speech — the speech is the
  // NPC's voice, the backstory is auxiliary writing context.
  const [view, setView] = useState<"speech" | "backstory">("speech");

  // Pick one dialog at random on mount and keep it stable while the
  // overlay is open. Re-bumping the NPC re-mounts the overlay and
  // therefore re-rolls. Keyed on npc.id so swapping NPCs without
  // unmounting (defensive) still picks a fresh line.
  const dialogs = useMemo<DialogEntry[]>(
    () => (Array.isArray(npc.dialogs) ? npc.dialogs : []),
    [npc.dialogs],
  );
  const randomDialog = useMemo<DialogEntry | null>(() => {
    if (dialogs.length === 0) return null;
    const idx = Math.floor(Math.random() * dialogs.length);
    return dialogs[idx] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npc.id, dialogs.length]);

  // ESC closes — convention shared with the party-screen overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const spriteUrl = resolveNpcSpriteUrl(npc.sprite);
  const hasShop = !!(npc.counter && npc.counter.length > 0);
  const hasBackstory = !!(
    npc.personal_history && npc.personal_history.trim().length > 0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-6"
      onClick={(e) => {
        // Backdrop click closes — but only if the click started on
        // the backdrop itself, not bubbled from an inner button.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[36rem] max-w-full flex-col rounded border border-parchment/25 bg-ink/95 shadow-xl">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-parchment/15 px-4 py-3">
          {spriteUrl ? (
            <img
              src={spriteUrl}
              alt=""
              width={48}
              height={48}
              style={{ imageRendering: "pixelated" }}
              className="h-12 w-12 rounded border border-parchment/20 bg-ink/40 object-contain"
            />
          ) : (
            <div className="h-12 w-12 rounded border border-parchment/20 bg-ink/40" />
          )}
          <div className="flex-1">
            <h2 className="font-display text-xl text-parchment">
              {npc.name || npc.id}
            </h2>
            <p className="font-mono text-[10px] text-parchment/40">{npc.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/70 hover:bg-ink/40"
            title="Leave (Esc)"
          >
            ✕
          </button>
        </header>

        {/* Speech / Backstory swap area */}
        <section className="min-h-[8rem] flex-1 overflow-auto px-4 py-4">
          {view === "speech" ? (
            randomDialog ? (
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-parchment/90">
                “{randomDialog.text}”
              </p>
            ) : (
              <p className="text-sm italic text-parchment/55">
                {npc.name} nods silently.
              </p>
            )
          ) : hasBackstory ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] uppercase tracking-wide text-parchment/45">
                Backstory
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-parchment/80">
                {npc.personal_history}
              </p>
            </div>
          ) : (
            <p className="text-sm italic text-parchment/55">
              No recorded history for {npc.name}.
            </p>
          )}
        </section>

        {/* Action footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-parchment/15 px-4 py-3">
          {hasBackstory ? (
            <button
              type="button"
              onClick={() =>
                setView((v) => (v === "speech" ? "backstory" : "speech"))
              }
              className="mr-auto rounded border border-parchment/20 bg-ink/40 px-3 py-1.5 text-sm text-parchment/80 hover:bg-ink/60"
              title={
                view === "speech"
                  ? `Read ${npc.name}'s backstory.`
                  : `Return to ${npc.name}'s words.`
              }
            >
              {view === "speech" ? "📖 Backstory" : "← Back"}
            </button>
          ) : null}
          {hasShop ? (
            <button
              type="button"
              onClick={() => onOpenShop(npc.counter as string)}
              className="rounded border border-ember/60 bg-ember/30 px-3 py-1.5 text-sm text-parchment hover:bg-ember/50"
              title={`Browse ${npc.name}'s shop.`}
            >
              🪙 Shop
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 px-3 py-1.5 text-sm text-parchment/75 hover:bg-ink/40"
          >
            Leave
          </button>
        </footer>
      </div>
    </div>
  );
}
