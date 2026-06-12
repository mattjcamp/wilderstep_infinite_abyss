"use client";

/**
 * Read-only record summary — replaces the raw `JSON.stringify` dumps
 * the browse views used to show for an expanded record. Authors get
 * a property sheet they can actually read; developers who want the
 * raw file open it in their own editor (it's plain JSON on disk).
 *
 * Rendering rules per value shape:
 *   - string / number / boolean → as text ("yes"/"no" for booleans)
 *   - null / undefined / ""     → an em-dash
 *   - array of scalars          → comma-joined
 *   - array of objects          → "N entries: a, b, c…" where each
 *     entry contributes its name / title / id / type (whichever it
 *     has) — enough to recognise dialogs, steps, levels at a glance
 *   - object                    → shallow "key: value" pairs; nested
 *     values summarise recursively (depth-capped)
 *
 * `summarizeValue` is exported for tests.
 */

interface Record_ {
  [k: string]: unknown;
}

const MAX_ITEMS_LISTED = 8;

function entryHandle(entry: Record<string, unknown>): string {
  for (const k of ["name", "title", "id", "type"]) {
    const v = entry[k];
    if (typeof v === "string" && v) return v;
  }
  return "(entry)";
}

/** One value → one display string. Depth-capped so a pathological
 *  nest can't wall-of-text the panel. */
export function summarizeValue(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v === "" ? "—" : v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    const scalars = v.every(
      (e) => typeof e === "string" || typeof e === "number",
    );
    if (scalars) {
      const shown = v.slice(0, MAX_ITEMS_LISTED).map(String).join(", ");
      return v.length > MAX_ITEMS_LISTED
        ? `${shown}, … (${v.length} total)`
        : shown;
    }
    const handles = v
      .slice(0, MAX_ITEMS_LISTED)
      .map((e) =>
        e && typeof e === "object"
          ? entryHandle(e as Record<string, unknown>)
          : String(e),
      )
      .join(", ");
    const suffix = v.length > MAX_ITEMS_LISTED ? ", …" : "";
    return `${v.length} ${v.length === 1 ? "entry" : "entries"}: ${handles}${suffix}`;
  }
  if (typeof v === "object") {
    if (depth >= 2) return "(nested)";
    const pairs = Object.entries(v as Record<string, unknown>);
    if (pairs.length === 0) return "—";
    return pairs
      .map(([k, val]) => `${k}: ${summarizeValue(val, depth + 1)}`)
      .join(", ");
  }
  return String(v);
}

export function RecordSummary({ record }: { record: Record_ | null }) {
  if (!record) {
    return <p className="text-sm text-parchment/55">No data.</p>;
  }
  const fields = Object.entries(record).filter(([k]) => k !== "_comment");
  return (
    <dl className="rounded border border-parchment/10 bg-ink/40 px-3 py-2">
      {fields.map(([key, val]) => (
        <div
          key={key}
          className="flex items-baseline gap-3 border-b border-parchment/10 py-1 last:border-b-0"
        >
          <dt className="min-w-[10rem] shrink-0 font-mono text-[13px] text-parchment/65">
            {key}
          </dt>
          <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-parchment/90">
            {summarizeValue(val)}
          </dd>
        </div>
      ))}
      {fields.length === 0 ? (
        <p className="py-1 text-sm text-parchment/55">No fields.</p>
      ) : null}
    </dl>
  );
}
