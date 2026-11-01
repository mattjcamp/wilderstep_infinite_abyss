"use client";

/**
 * Structured editor for a Log Event's `entries` — one row per line of
 * text, each with the step count (moves on the map since arriving) at
 * which it appears in the exploration log. Rows are kept sorted by
 * step on "Sort" so authors can see the order the party will read
 * them in. Pure controlled component; RecordForm keeps the JSON draft.
 */

import type { LogEventEntry } from "@/play/logEvents";

export function LogEventEntriesEditor({
  entries,
  onChange,
}: {
  entries: ReadonlyArray<LogEventEntry>;
  onChange: (next: LogEventEntry[]) => void;
}) {
  const patch = (idx: number, p: Partial<LogEventEntry>) =>
    onChange(entries.map((e, i) => (i === idx ? { ...e, ...p } : e)));
  const remove = (idx: number) => onChange(entries.filter((_, i) => i !== idx));
  const add = () => {
    const last = entries.reduce((m, e) => Math.max(m, e.steps), -1);
    onChange([...entries, { steps: last < 0 ? 0 : last + 5, text: "" }]);
  };
  const sorted = entries.every((e, i) => i === 0 || entries[i - 1].steps <= e.steps);
  const sort = () =>
    onChange([...entries].sort((a, b) => a.steps - b.steps));

  return (
    <div className="flex-1 space-y-2">
      {entries.length === 0 ? (
        <p className="rounded border border-parchment/15 bg-ink/40 px-3 py-2 text-sm text-parchment/60">
          No lines yet. Add one — step 0 shows the moment the party
          arrives on the map.
        </p>
      ) : null}
      {entries.map((entry, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded border border-parchment/15 bg-ink/40 p-2"
        >
          <label className="flex shrink-0 flex-col text-xs text-parchment/60">
            After step
            <input
              type="number"
              min={0}
              value={entry.steps}
              onChange={(e) =>
                patch(i, { steps: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
              className="mt-0.5 w-20 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment focus:border-parchment/60 focus:outline-none"
            />
          </label>
          <div className="flex-1">
            <textarea
              value={entry.text}
              onChange={(e) => patch(i, { text: e.target.value })}
              placeholder="What appears in the log…"
              rows={2}
              className="w-full resize-y rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment placeholder:text-parchment/45 focus:border-parchment/60 focus:outline-none"
            />
            {entry.text.trim() === "" ? (
              <p className="text-xs text-ember/80">Empty — this line is skipped in game.</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            title="Remove this line."
            className="rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          className="rounded border border-parchment/30 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/40"
        >
          + Add line
        </button>
        {!sorted ? (
          <button
            type="button"
            onClick={sort}
            className="rounded border border-parchment/30 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/40"
          >
            Sort by step
          </button>
        ) : null}
      </div>
      <p className="text-xs text-parchment/60">
        Steps count the party&rsquo;s moves on this map since it arrived.
        Lines on the same step appear together, in this order.
      </p>
    </div>
  );
}
