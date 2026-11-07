"use client";

/**
 * Row of tag chips that filters a list ("All" + one chip per tag, each
 * with a count). Shared by the Soundtrack editor and the
 * SoundtrackPicker so both surfaces present soundtrack tags the same way.
 */
export function TagFilterBar({
  tags,
  active,
  total,
  countFor,
  onPick,
  label = "Tags",
}: {
  tags: ReadonlyArray<string>;
  /** Selected tag, or null for "All". */
  active: string | null;
  total: number;
  countFor: (tag: string) => number;
  onPick: (tag: string | null) => void;
  label?: string;
}) {
  const chip = (text: string, count: number, on: boolean, pick: string | null) => (
    <button
      key={`${text}-${pick ?? ""}`}
      type="button"
      onClick={() => onPick(pick)}
      aria-pressed={on}
      className={`rounded border px-2 py-0.5 text-[13px] ${
        on
          ? "border-ember/60 bg-ember/25 text-parchment"
          : "border-parchment/20 text-parchment/80 hover:bg-ink/40"
      }`}
    >
      {text}
      <span className="ml-1 text-parchment/55">{count}</span>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label ? (
        <span className="mr-1 text-[13px] text-parchment/65">{label}</span>
      ) : null}
      {chip("All", total, active === null, null)}
      {tags.map((t) => chip(t, countFor(t), active === t, t))}
    </div>
  );
}
