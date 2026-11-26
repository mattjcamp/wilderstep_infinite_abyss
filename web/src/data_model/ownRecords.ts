/**
 * Which records belong in a module's OWN file after an edit.
 *
 * Browse editors (Dungeons, Quests, Characters, Maps) edit the merged
 * view — inherited records (from `extends` parents and `uses`
 * libraries) plus the module's own. Saving that whole merged list back
 * to the module's own file froze a copy of every inherited record into
 * it: later edits made in Default / a library never reached the child
 * again (the child's copy wins by id).
 *
 * The own file must hold only:
 *   - records the module itself adds (ids not inherited), and
 *   - inherited records the module actually overrides (differ from the
 *     inherited version).
 * A record identical to what it would inherit is dropped, so stale
 * frozen copies heal themselves on the next save. Order follows the
 * merged list. (A module can't remove an inherited record — merge has
 * no tombstones — so deletions only ever remove own records.)
 */

/** JSON with object keys sorted, so key order doesn't count as a change. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        out[k] = (val as Record<string, unknown>)[k];
      }
      return out;
    }
    return val;
  });
}

/** True when `a` and `b` hold the same data (key order ignored). */
export function sameRecord(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function ownRecordsAfterEdit<T extends { id?: unknown }>(
  merged: ReadonlyArray<T>,
  inherited: ReadonlyArray<{ id?: unknown }>,
): T[] {
  // Untouched inherited records are the very same objects the merge
  // produced, so most drop on a reference check — the deep compare
  // only runs for edited / stale copies (big maps stay cheap).
  const inheritedById = new Map<string, unknown>();
  for (const r of inherited) {
    const id = String(r.id ?? "");
    if (id) inheritedById.set(id, r);
  }
  return merged.filter((r) => {
    const id = String(r.id ?? "");
    if (!id || !inheritedById.has(id)) return true;
    const base = inheritedById.get(id);
    if (base === r) return false;
    return !sameRecord(r, base);
  });
}

/** The record list under `key` in an inherited-layer payload. */
export function inheritedRecords<T = Record<string, unknown>>(
  inheritedPayload: unknown,
  key: string,
): T[] {
  const obj = inheritedPayload as Record<string, unknown> | null;
  return obj && Array.isArray(obj[key]) ? (obj[key] as T[]) : [];
}
