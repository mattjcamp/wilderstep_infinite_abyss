/**
 * NPC dialog shape normalisation.
 *
 * The canonical authored shape is an ARRAY of dialog lines:
 *
 *   "dialogs": [ { "id": "...", "title": "...", "text": "..." }, ... ]
 *
 * but hand-edited JSON drifts: a single dialog gets written as a bare
 * object (no `[ ]`), or a quick line as a plain string. Those slips
 * used to render in play as the silent fallback ("<name> regards you
 * in silence") while the browse table happily counted the object's
 * KEYS as dialogs — maximally confusing. This helper is the single
 * tolerant reader both the play host and the editor use:
 *
 *   - array        → entries with usable text kept (strings allowed)
 *   - bare object  → treated as a one-element array
 *   - bare string  → one dialog line with that text
 *   - anything else → empty (the overlay shows its fallback line)
 *
 * Ids/titles are backfilled so the overlay's keying + header always
 * have something to render.
 */

export interface NpcDialogLine {
  id: string;
  title?: string;
  text: string;
}

function lineFromObject(
  raw: Record<string, unknown>,
  idx: number,
): NpcDialogLine | null {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const id =
    typeof raw.id === "string" && raw.id.length > 0
      ? raw.id
      : `dialog_${idx + 1}`;
  const title = typeof raw.title === "string" ? raw.title : undefined;
  return { id, title, text };
}

/** Editing-time variant of {@link normalizeNpcDialogs} — same shape
 *  coercion (bare object / string → array) but KEEPS lines whose
 *  text is still empty. The DialogsEditor renders the value on every
 *  keystroke; the strict normaliser would delete a freshly-added
 *  card before the author finished typing its text. Play uses the
 *  strict version, so empty lines saved through the editor are
 *  simply skipped in game. */
export function npcDialogLinesForEditing(value: unknown): NpcDialogLine[] {
  if (Array.isArray(value)) {
    const out: NpcDialogLine[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        out.push({ id: `dialog_${out.length + 1}`, text: entry });
        continue;
      }
      if (entry && typeof entry === "object") {
        const raw = entry as Record<string, unknown>;
        out.push({
          id:
            typeof raw.id === "string" && raw.id.length > 0
              ? raw.id
              : `dialog_${out.length + 1}`,
          title: typeof raw.title === "string" ? raw.title : undefined,
          text: typeof raw.text === "string" ? raw.text : "",
        });
      }
    }
    return out;
  }
  // Non-array shapes (bare object, string, null) go through the
  // strict reader — there's no in-progress typing to preserve when
  // the record didn't carry an array to begin with.
  return normalizeNpcDialogs(value);
}

/** Coerce whatever an npcs.json record carries in `dialogs` into the
 *  canonical array-of-lines shape. Never throws. */
export function normalizeNpcDialogs(value: unknown): NpcDialogLine[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [{ id: "dialog_1", text }] : [];
  }
  if (Array.isArray(value)) {
    const out: NpcDialogLine[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const text = entry.trim();
        if (text) out.push({ id: `dialog_${out.length + 1}`, text });
        continue;
      }
      if (entry && typeof entry === "object") {
        const line = lineFromObject(
          entry as Record<string, unknown>,
          out.length,
        );
        if (line) out.push(line);
      }
    }
    return out;
  }
  if (typeof value === "object") {
    // The classic slip — a single dialog written without the `[ ]`.
    const line = lineFromObject(value as Record<string, unknown>, 0);
    return line ? [line] : [];
  }
  return [];
}
