/**
 * Log Events — authored lines of text that appear in the exploration
 * log a set number of steps after the party enters a map. Use them for
 * tutorials, or a description that unfolds as the party explores.
 *
 * Records live in `log_events.json` (editor: Module data → Log Events):
 *
 *   { "id": "caravan_intro", "name": "Caravan intro",
 *     "map_id": "destroyed_caravan", "repeat": "once",
 *     "entries": [ { "steps": 0, "text": "Smoke still rises…" },
 *                  { "steps": 5, "text": "Tracks lead north." } ] }
 *
 * `steps` counts the party's moves on that map since it arrived (0 =
 * the moment it arrives). `repeat: "once"` (default) shows each line a
 * single time per save; `"every_visit"` shows it again on every visit.
 */

export type LogEventRepeat = "once" | "every_visit";

export interface LogEventEntry {
  steps: number;
  text: string;
}

export interface LogEventRecord {
  id: string;
  name?: string;
  map_id: string;
  repeat?: LogEventRepeat;
  entries: LogEventEntry[];
}

export const LOG_EVENT_REPEAT_CHOICES: ReadonlyArray<{
  value: LogEventRepeat;
  label: string;
}> = [
  { value: "once", label: "Once per save" },
  { value: "every_visit", label: "Every visit to the map" },
];

/** Coerce a loosely-shaped JSON value into clean records, dropping
 *  anything without a map or with no usable lines. */
export function normalizeLogEvents(raw: unknown): LogEventRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: LogEventRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (typeof rec.id !== "string" || typeof rec.map_id !== "string") continue;
    if (!rec.map_id) continue;
    const entries = normalizeLogEventEntries(rec.entries);
    if (entries.length === 0) continue;
    out.push({
      id: rec.id,
      name: typeof rec.name === "string" ? rec.name : undefined,
      map_id: rec.map_id,
      repeat: rec.repeat === "every_visit" ? "every_visit" : "once",
      entries,
    });
  }
  return out;
}

export function normalizeLogEventEntries(raw: unknown): LogEventEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const { steps, text } = e as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "") return [];
    const n = typeof steps === "number" ? steps : Number(steps);
    return [{ steps: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0, text }];
  });
}

/** Save key for a "once" line: `<event id>#<entry index>`. */
export function logEventKey(eventId: string, idx: number): string {
  return `${eventId}#${idx}`;
}

/**
 * Lines due on `mapId` at exactly `steps` moves after arriving.
 * Returns the lines (in authoring order) plus the save keys of the
 * "once" lines among them, which the caller adds to the save so they
 * never show again.
 */
export function dueLogEventLines(
  events: ReadonlyArray<LogEventRecord>,
  mapId: string,
  steps: number,
  shown: ReadonlySet<string>,
): { lines: string[]; shownKeys: string[] } {
  const lines: string[] = [];
  const shownKeys: string[] = [];
  for (const ev of events) {
    if (ev.map_id !== mapId) continue;
    ev.entries.forEach((entry, idx) => {
      if (entry.steps !== steps) return;
      if (ev.repeat !== "every_visit") {
        const key = logEventKey(ev.id, idx);
        if (shown.has(key)) return;
        shownKeys.push(key);
      }
      lines.push(entry.text);
    });
  }
  return { lines, shownKeys };
}
