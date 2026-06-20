/**
 * Pure helpers for merging a child module's per-model data on top of
 * a parent's, by record id. Used both at load time
 * (StaticModuleSource) and live in the editor (ModelView) to recompute
 * the display whenever the ownDraft overlay changes.
 *
 *  - Collections (records under collectionKey, addressed by id): child
 *    records override parent records of the same id; new ids are
 *    appended in child-declared order. Sibling top-level fields (like
 *    `_comment`) prefer the child.
 *  - Singletons (collectionKey === null, e.g. party): merged field by
 *    field — a key the child sets overrides the parent's; a key the
 *    child omits is INHERITED from the parent. (Previously the child
 *    replaced the parent wholesale, which meant a child file had to
 *    re-declare every field or silently blank the ones it left out.)
 */

export function mergeModel(
  collectionKey: string | null,
  parent: unknown,
  child: unknown,
): unknown {
  if (collectionKey === null) {
    // Singleton: shallow field-level merge so a child module inherits
    // any field it doesn't set (e.g. the party roster) instead of
    // wiping it. An absent child (no own file) leaves the parent as-is;
    // an absent parent leaves the child as-is. A key the child sets —
    // including an explicit empty array — still overrides the parent,
    // so a module can deliberately blank a field when it means to.
    const parentObj = (parent as Record<string, unknown> | null) ?? null;
    const childObj = (child as Record<string, unknown> | null) ?? null;
    if (childObj === null) return parentObj;
    if (parentObj === null) return childObj;
    return { ...parentObj, ...childObj };
  }
  const parentObj = (parent as Record<string, unknown> | null) ?? null;
  const childObj = (child as Record<string, unknown> | null) ?? null;
  const parentList =
    parentObj && Array.isArray(parentObj[collectionKey])
      ? (parentObj[collectionKey] as Record<string, unknown>[])
      : [];
  const childList =
    childObj && Array.isArray(childObj[collectionKey])
      ? (childObj[collectionKey] as Record<string, unknown>[])
      : [];

  const byId = new Map<string, Record<string, unknown>>();
  const order: string[] = [];
  for (const rec of parentList) {
    const id = String(rec.id ?? "");
    if (!id) continue;
    byId.set(id, rec);
    order.push(id);
  }
  for (const rec of childList) {
    const id = String(rec.id ?? "");
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, rec);
  }
  const mergedList = order.map((id) => byId.get(id)!);

  const out: Record<string, unknown> = {
    ...(parentObj ?? {}),
    ...(childObj ?? {}),
  };
  out[collectionKey] = mergedList;
  return out;
}

/** Convenience: pull the record list out of a collection-file payload. */
export function extractRecords(
  collectionKey: string,
  payload: unknown,
): Record<string, unknown>[] {
  const obj = (payload as Record<string, unknown> | null) ?? null;
  if (obj && Array.isArray(obj[collectionKey])) {
    return obj[collectionKey] as Record<string, unknown>[];
  }
  return [];
}
