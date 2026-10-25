/**
 * Editor-only `tags` on records (encounters, monsters).
 *
 * Tags are stored as a JSON string[]. Earlier builds could save them as
 * a JSON-encoded *string* ('["Mutated Animal"]') when a brand-new record
 * had no peer to infer the field type from; `normalizeTags` reads either
 * shape (plus a plain comma list) so those records still load and get
 * re-saved as a proper array.
 */
export function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        return normalizeTags(JSON.parse(s));
      } catch {
        // fall through to comma split
      }
    }
    return s.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}
