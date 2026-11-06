/**
 * Lore — authored pieces of world writing (histories, letters, legends,
 * inscriptions) the party can find and read.
 *
 *   lore.json → { "lore": [ { id, name, tags, xp, paragraphs } ] }
 *
 * Players discover lore two ways:
 *   - Map objects: a map cell carries `lore: "<id>"` (a bookshelf, a
 *     plaque, a gravestone). Bumping it opens the reading screen.
 *   - Readable items: an item carries `lore: "<id>"` (a book, a
 *     scroll). Using it from the inventory reads it; it isn't consumed.
 *
 * The first read of each lore record adds it to the party's journal
 * (J) and pays its `xp` (default {@link DEFAULT_LORE_XP}) to every
 * living party member. Re-reading is free. Tags are player-facing:
 * the journal filters by them.
 */

/** XP for a first read when the record doesn't set `xp`. */
export const DEFAULT_LORE_XP = 25;

export interface LoreRecord {
  id: string;
  /** Display title. Falls back to the id. */
  name: string;
  /** Player-facing tags ("History", "The Orc Wars", …) — the journal
   *  filters by these. */
  tags: string[];
  /** XP each living party member earns on the first read (0 = none). */
  xp: number;
  /** The text, one entry per paragraph. */
  paragraphs: string[];
}

function cleanXp(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return DEFAULT_LORE_XP;
}

/** Paragraphs from a record: the `paragraphs` array (blank entries
 *  dropped), or — for hand-written JSON — a single `text` string split
 *  on blank lines. */
function cleanParagraphs(raw: Record<string, unknown>): string[] {
  if (Array.isArray(raw.paragraphs)) {
    return raw.paragraphs
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  if (typeof raw.text === "string") {
    return raw.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  return [];
}

/** Parse lore.json (the `{ lore: [...] }` envelope or a bare array).
 *  Records without an id are dropped; tags are trimmed + de-duplicated. */
export function normalizeLore(raw: unknown): LoreRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { lore?: unknown }).lore)
      ? ((raw as { lore: unknown[] }).lore)
      : [];
  const out: LoreRecord[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    if (!id) continue;
    const name =
      typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : id;
    const tags = Array.isArray(rec.tags)
      ? [
          ...new Set(
            rec.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ]
      : [];
    out.push({ id, name, tags, xp: cleanXp(rec.xp), paragraphs: cleanParagraphs(rec) });
  }
  return out;
}

/** Record a read. `firstTime` is true only the first time `id` is read,
 *  which is when the XP pays out. Pure — returns a fresh list. */
export function markLoreRead(
  readIds: ReadonlyArray<string> | undefined,
  id: string,
): { firstTime: boolean; next: string[] } {
  const prev = readIds ?? [];
  if (prev.includes(id)) return { firstTime: false, next: [...prev] };
  return { firstTime: true, next: [...prev, id] };
}

/** The journal: lore the party has read that still exists in the
 *  catalog, most recently discovered first. */
export function journalEntries(
  catalog: ReadonlyArray<LoreRecord>,
  readIds: ReadonlyArray<string> | undefined,
): LoreRecord[] {
  const byId = new Map(catalog.map((l) => [l.id, l]));
  const out: LoreRecord[] = [];
  for (const id of [...(readIds ?? [])].reverse()) {
    const rec = byId.get(id);
    if (rec) out.push(rec);
  }
  return out;
}

/** Every tag used by `entries`, alphabetical (case-insensitive). */
export function loreTags(entries: ReadonlyArray<LoreRecord>): string[] {
  const seen = new Map<string, string>();
  for (const e of entries) {
    for (const t of e.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/** Entries matching a tag filter (null = all) and a free-text search
 *  over title, tags and text. */
export function filterLore(
  entries: ReadonlyArray<LoreRecord>,
  tag: string | null,
  search = "",
): LoreRecord[] {
  const q = search.trim().toLowerCase();
  return entries.filter((e) => {
    if (tag && !e.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      return false;
    }
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)) ||
      e.paragraphs.some((p) => p.toLowerCase().includes(q))
    );
  });
}
