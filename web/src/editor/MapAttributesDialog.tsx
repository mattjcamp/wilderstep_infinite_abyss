"use client";

/**
 * Modal overlay for editing the Map record's metadata — the
 * fields that aren't part of the painted grid itself.
 *
 * Authors paint the map's *contents* via the Tile Palette + canvas,
 * but the Map data model also carries top-level attributes
 * (display name, prose description, organizational tags) that
 * weren't reachable from the editor UI. This dialog fills that gap.
 *
 * Editable here:
 *   - name        — required, free text.
 *   - description — optional, multi-line prose.
 *   - tags        — editor-only organizational labels; uses the
 *                   shared TagsPicker so existing tags in the module
 *                   surface as suggestions.
 *
 * Intentionally NOT editable:
 *   - id           — the URL key; renaming would break inbound links.
 *   - width/height — changing dimensions requires reshaping the grid;
 *                    that's a separate operation (and a much bigger
 *                    blast radius) than metadata editing.
 *
 * Save behavior: the dialog is a controlled form. It holds a local
 * draft of the edits and only fires onSave when the author clicks
 * "Save". Cancel/escape discards the local draft. Persistence to
 * the module's draft file is the caller's job (see MapEditor).
 */

import { useEffect, useState } from "react";
import { TagsPicker } from "./TagsPicker";

interface MapAttributes {
  name: string;
  description?: string;
  tags?: string[];
}

export function MapAttributesDialog({
  mapId,
  initial,
  existingTags,
  onSave,
  onClose,
}: {
  mapId: string;
  initial: MapAttributes;
  existingTags: string[];
  onSave: (next: MapAttributes) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [nameError, setNameError] = useState<string | null>(null);

  // Close on Escape, save on Cmd/Ctrl+Enter — mirrors common
  // form-modal expectations and matches the keyboard-friendliness
  // of the rest of the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleSave is defined inside the component but is stable enough
    // for this — the closure reads the latest state via React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, tags]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required.");
      return;
    }
    const trimmedDesc = description.trim();
    onSave({
      name: trimmedName,
      // Omit description when blank so the saved file stays tidy —
      // matches how new maps are created without an empty string.
      description: trimmedDesc ? trimmedDesc : undefined,
      // Same treatment for tags: drop the field when empty.
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label="Map properties"
      onClick={(e) => {
        // Click-outside-to-close. The inner panel stops propagation.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[520px] max-w-[90vw] rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Map Properties</h2>
          <span className="font-mono text-[11px] text-parchment/45">
            id: {mapId}
          </span>
        </header>

        <div className="flex flex-col gap-3">
          {/* Name ------------------------------------------------ */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-parchment/70 font-mono">name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              autoFocus
              className={`rounded border bg-ink/40 px-2 py-1 text-sm text-parchment ${
                nameError
                  ? "border-ember focus:border-ember"
                  : "border-parchment/20 focus:border-parchment/45"
              }`}
            />
            {nameError ? (
              <span className="text-[11px] text-ember">{nameError}</span>
            ) : null}
          </label>

          {/* Description ----------------------------------------- */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-parchment/70 font-mono">
              description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
              placeholder="Optional. Free-form notes about this map."
            />
          </label>

          {/* Tags ------------------------------------------------ */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-parchment/70 font-mono">tags</span>
            <TagsPicker
              tags={tags}
              existing={existingTags}
              onChange={setTags}
            />
            <span className="text-[11px] text-parchment/45">
              Editor-only labels for organizing maps in the browser. Not
              visible in-game.
            </span>
          </div>
        </div>

        <footer className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-1 text-xs text-parchment/70 hover:bg-ink/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-xs text-parchment hover:bg-ember/50"
            title="Save (⌘/Ctrl + Enter)"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
