"use client";

/**
 * Structured editor for an NPC's `dialogs` array — replaces the raw
 * JSON textarea in the NPC record form, which invited shape mistakes
 * (the classic: a single dialog written as a bare object instead of
 * a one-element array, which played back as "regards you in
 * silence").
 *
 * One card per dialog line: id (small, mono — stable handle), title
 * (optional header in the in-game dialog), and the spoken text.
 * Add / remove / reorder; the component always emits the canonical
 * array-of-lines shape, so whatever the record carried before
 * (object, string, array) is normalised on the first save.
 *
 * Pure controlled component: parent owns the value (RecordForm keeps
 * it as a JSON string draft and re-stringifies on every change).
 */

import type { NpcDialogLine } from "@/data_model/npcDialogs";

export function DialogsEditor({
  lines,
  onChange,
}: {
  lines: ReadonlyArray<NpcDialogLine>;
  onChange: (next: NpcDialogLine[]) => void;
}) {
  const patch = (idx: number, p: Partial<NpcDialogLine>) => {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  };
  const remove = (idx: number) => {
    onChange(lines.filter((_, i) => i !== idx));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };
  const add = () => {
    // Unique id — dialog_N skipping anything already taken.
    let n = lines.length + 1;
    const taken = new Set(lines.map((l) => l.id));
    while (taken.has(`dialog_${n}`)) n++;
    onChange([...lines, { id: `dialog_${n}`, title: "", text: "" }]);
  };

  return (
    <div className="flex-1 space-y-2">
      {lines.length === 0 ? (
        <p className="rounded border border-parchment/15 bg-ink/40 px-3 py-2 text-sm text-parchment/60">
          No dialogs yet — in game this NPC will &ldquo;regard you in
          silence.&rdquo;
        </p>
      ) : null}
      {lines.map((line, i) => (
        <div
          key={i}
          className="rounded border border-parchment/15 bg-ink/40 p-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-parchment/55">
              {i + 1}.
            </span>
            <input
              type="text"
              value={line.id}
              onChange={(e) => patch(i, { id: e.target.value })}
              title="Stable id for this dialog line."
              className="w-36 rounded border border-parchment/20 bg-ink/50 px-2 py-0.5 font-mono text-xs text-parchment/80 focus:border-parchment/60 focus:outline-none"
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="Move up — players read dialogs in this order."
              className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 enabled:hover:bg-ink/60 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === lines.length - 1}
              title="Move down."
              className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 enabled:hover:bg-ink/60 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove this dialog line."
              className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            value={line.title ?? ""}
            onChange={(e) => patch(i, { title: e.target.value })}
            placeholder="Title (optional — shown above the line in game)"
            className="mt-1.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment placeholder:text-parchment/45 focus:border-parchment/60 focus:outline-none"
          />
          <textarea
            value={line.text}
            onChange={(e) => patch(i, { text: e.target.value })}
            placeholder="What the NPC says…"
            rows={2}
            className="mt-1.5 w-full resize-y rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment placeholder:text-parchment/45 focus:border-parchment/60 focus:outline-none"
          />
          {line.text.trim() === "" ? (
            <p className="mt-1 text-xs text-ember/80">
              Empty text — this line will be dropped in game.
            </p>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-parchment/30 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/40"
      >
        + Add dialog
      </button>
      <p className="text-xs text-parchment/60">
        Players page through these lines in order when they bump into
        the NPC.
      </p>
    </div>
  );
}
