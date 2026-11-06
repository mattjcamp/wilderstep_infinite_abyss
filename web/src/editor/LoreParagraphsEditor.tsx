"use client";

/**
 * Structured editor for a Lore record's `paragraphs` — one textarea per
 * paragraph, in reading order, with add / remove / move up / move down.
 * Blank paragraphs are kept while editing (so a fresh "+ Add paragraph"
 * box doesn't vanish) and dropped by the game when it reads the record.
 * Pure controlled component; RecordForm keeps the JSON draft.
 */

export function LoreParagraphsEditor({
  paragraphs,
  onChange,
}: {
  paragraphs: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
}) {
  const set = (idx: number, text: string) =>
    onChange(paragraphs.map((p, i) => (i === idx ? text : p)));
  const remove = (idx: number) => onChange(paragraphs.filter((_, i) => i !== idx));
  const move = (idx: number, by: -1 | 1) => {
    const to = idx + by;
    if (to < 0 || to >= paragraphs.length) return;
    const next = [...paragraphs];
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };
  const words = paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;

  const btn =
    "rounded border border-parchment/20 px-1.5 py-0.5 text-xs text-parchment/75 hover:bg-ink/60 disabled:opacity-30";

  return (
    <div className="flex-1 space-y-2">
      {paragraphs.length === 0 ? (
        <p className="rounded border border-parchment/15 bg-ink/40 px-3 py-2 text-sm text-parchment/60">
          No paragraphs yet. Add the first one — players read them in
          order, top to bottom.
        </p>
      ) : null}
      {paragraphs.map((text, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded border border-parchment/15 bg-ink/40 p-2"
        >
          <span className="mt-1 w-5 shrink-0 text-right font-mono text-xs text-parchment/50">
            {i + 1}
          </span>
          <div className="flex-1">
            <textarea
              value={text}
              onChange={(e) => set(i, e.target.value)}
              placeholder="Write the paragraph…"
              rows={4}
              className="w-full resize-y rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm leading-relaxed text-parchment placeholder:text-parchment/45 focus:border-parchment/60 focus:outline-none"
            />
            {text.trim() === "" ? (
              <p className="text-xs text-ember/80">Empty — skipped in game.</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="Move up"
              aria-label={`Move paragraph ${i + 1} up`}
              className={btn}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === paragraphs.length - 1}
              title="Move down"
              aria-label={`Move paragraph ${i + 1} down`}
              className={btn}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove this paragraph"
              aria-label={`Remove paragraph ${i + 1}`}
              className={btn}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...paragraphs, ""])}
          className="rounded border border-parchment/30 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/40"
        >
          + Add paragraph
        </button>
        <span className="text-xs text-parchment/50">
          {paragraphs.length} paragraph{paragraphs.length === 1 ? "" : "s"} ·{" "}
          {words} word{words === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
