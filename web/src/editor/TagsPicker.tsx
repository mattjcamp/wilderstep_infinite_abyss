"use client";

/**
 * Tag multi-select with autocomplete + create-new. Shared between
 * MapsBrowse, DungeonsBrowse, and QuestsBrowse since the tag-grouping
 * convention is uniform across those models.
 *
 * Behavior:
 *   - Renders the currently-selected tags as removable chips.
 *   - A dropdown lists every existing tag not already on this record
 *     for quick pick.
 *   - A free-form text input lets the author type a new tag; Enter
 *     or the + Add button commits it.
 */

import { useState } from "react";

export function TagsPicker({
  tags,
  existing,
  onChange,
}: {
  tags: string[];
  existing: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const remainingSuggestions = existing.filter((t) => !tags.includes(t));
  const trimmed = draft.trim();
  const canAddNew = trimmed.length > 0 && !tags.includes(trimmed);

  const add = (t: string) => {
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-ember/25 px-2 py-0.5 text-xs text-parchment/95"
          >
            <span className="font-mono">{t}</span>
            <button
              type="button"
              onClick={() => remove(t)}
              className="text-parchment/60 hover:text-parchment"
              title={`Remove tag "${t}"`}
            >
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 ? (
          <span className="text-xs text-parchment/45">(no tags)</span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {remainingSuggestions.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value);
            }}
            className="rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/85"
          >
            <option value="">— pick existing tag —</option>
            {remainingSuggestions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        ) : null}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canAddNew) {
                add(trimmed);
                setDraft("");
              }
            }
          }}
          placeholder="new tag…"
          className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
        />
        <button
          type="button"
          onClick={() => {
            if (canAddNew) {
              add(trimmed);
              setDraft("");
            }
          }}
          disabled={!canAddNew}
          className="rounded border border-ember/50 bg-ember/20 px-2 py-1 text-xs text-parchment hover:bg-ember/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add
        </button>
      </div>
    </div>
  );
}

/** Standard id-pattern enforced across browse components — lowercase
 *  letters/digits/hyphens/underscores, must start with a letter. */
export const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
