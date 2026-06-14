"use client";

/**
 * Modal overlay for editing a Module manifest's top-level metadata —
 * the fields stored in `web/public/modules/<id>/module.json`.
 *
 * Sibling to MapAttributesDialog. The Map dialog edits one record
 * inside a model file; this one edits the module's manifest itself.
 *
 * Editable here:
 *   - title       — required, free text.
 *   - description — optional, multi-line prose.
 *   - author      — optional.
 *   - version     — semver-style string (not validated).
 *   - role        — radio: playable / library. If the module is
 *                   already "core" that option is also shown so the
 *                   user can leave it as-is without forcibly demoting.
 *
 * Intentionally NOT editable (shown read-only for context):
 *   - id          — folder name on disk; renaming would break the
 *                   inheritance chain and inbound references.
 *   - extends     — inheritance parent. Changing this shuffles which
 *                   records inherit from which — a separate operation.
 *   - uses        — library import list, edited elsewhere.
 *
 * Save behavior: the dialog is a controlled form. It holds a local
 * draft of the edits and only fires onSave when the author clicks
 * "Save". Cancel/Escape discards the local draft. Persistence to
 * the module's manifest draft is the caller's job (see ModulePicker).
 */

import { useEffect, useState } from "react";
import type { ModuleSummary } from "@/data_model/ModuleSource";
import { SoundtrackPicker } from "./SoundtrackPicker";

/** Subset of ModuleSummary that this dialog is allowed to mutate.
 *  Caller merges this back over the existing manifest so untouched
 *  fields (extends, uses, future additions) survive unchanged. */
export interface ModulePropertiesPatch {
  title: string;
  description: string;
  author: string;
  version: string;
  role: string | undefined;
  /** Default background-music playlist for the module. Each entry is
   *  a file URL (typically under `/audio/...`). Empty array means
   *  the field is dropped from the saved manifest so quiet modules
   *  stay shape-clean. */
  soundtrack: string[];
  /** Per-lighting-mode fog-of-war sight radius (tiles). A mode set to
   *  `undefined` means "use the engine default" and is dropped from
   *  the saved manifest; a number is persisted under
   *  `settings.sight_radius.<mode>`. When all three are undefined the
   *  whole `settings.sight_radius` block is removed. */
  sightRadius: {
    day: number | undefined;
    twilight: number | undefined;
    night: number | undefined;
  };
}

/** Engine fallbacks shown as placeholder text so the author sees what
 *  they'll get if they leave a field blank. Must match
 *  `DEFAULT_SIGHT_RADIUS` in `sim/lighting.ts`. */
const SIGHT_RADIUS_DEFAULTS = { day: 10, twilight: 6, night: 1 } as const;

export function ModulePropertiesDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: ModuleSummary;
  onSave: (next: ModulePropertiesPatch) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [author, setAuthor] = useState(initial.author ?? "");
  const [version, setVersion] = useState(initial.version ?? "");
  /** "" represents the conventional "omitted == playable" case so the
   *  saved manifest can drop the field. We map to "playable" in the UI
   *  for clarity, then translate back on save. */
  const initialRole =
    initial.role === undefined || initial.role === "" ? "playable" : initial.role;
  const [role, setRole] = useState<string>(initialRole);
  // Ordered list of audio paths. The SoundtrackPicker owns the
  // selection UI (preview + reorder + add/remove); we just hold the
  // working list here and pass it to the picker.
  const [soundtrack, setSoundtrack] = useState<string[]>(
    initial.soundtrack ? [...initial.soundtrack] : [],
  );
  // Fog-of-war sight radius per lighting mode. Held as strings so the
  // inputs can be cleared back to "" (= "use engine default"); parsed
  // to numbers on save. Seeded from the module's own manifest values
  // (blank when the module doesn't override that mode).
  const radiusToInput = (v: number | undefined): string =>
    typeof v === "number" ? String(v) : "";
  const [sightDay, setSightDay] = useState(
    radiusToInput(initial.sightRadius?.day),
  );
  const [sightTwilight, setSightTwilight] = useState(
    radiusToInput(initial.sightRadius?.twilight),
  );
  const [sightNight, setSightNight] = useState(
    radiusToInput(initial.sightRadius?.night),
  );

  const [titleError, setTitleError] = useState<string | null>(null);

  // Same keyboard ergonomics as MapAttributesDialog — Escape closes,
  // ⌘/Ctrl+Enter saves. Authors switch between the two dialogs often
  // enough that consistency matters.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    title,
    description,
    author,
    version,
    role,
    soundtrack,
    sightDay,
    sightTwilight,
    sightNight,
  ]);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("Title is required.");
      return;
    }
    onSave({
      title: trimmedTitle,
      description: description.trim(),
      author: author.trim(),
      version: version.trim(),
      // Translate the UI's "playable" sentinel back to omitted, keeping
      // file contents idiomatic per ModuleSummary's docstring.
      role: role === "playable" ? undefined : role,
      // Picker hands back a clean ordered list; we forward it
      // verbatim. Caller (ModulePicker) decides whether to persist
      // or drop the field based on emptiness.
      soundtrack: [...soundtrack],
      // Parse each radius field. Blank → undefined ("use the engine
      // default"); a valid non-negative number is forwarded. Garbage
      // / negative input is treated as blank so a typo can't write a
      // broken radius into the manifest.
      sightRadius: {
        day: parseRadius(sightDay),
        twilight: parseRadius(sightTwilight),
        night: parseRadius(sightNight),
      },
    });
  };

  /** Parse a sight-radius input string. Returns `undefined` for blank
   *  / invalid / negative input so those modes fall back to the
   *  engine default rather than persisting a bad value. */
  function parseRadius(s: string): number | undefined {
    const t = s.trim();
    if (t === "") return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return undefined;
    // Whole tiles only — the LOS gate uses an integer Chebyshev
    // distance, so floor any decimal the author typed.
    return Math.floor(n);
  }

  // If the module is currently "core" we keep that option in the
  // radio group so the user can leave it. NewModuleForm only offers
  // playable / library, so non-core modules see exactly those two.
  const roleOptions: Array<{ value: string; label: string; hint: string }> = [
    {
      value: "playable",
      label: "Playable",
      hint: "Shown in the play picker as a runnable adventure.",
    },
    {
      value: "library",
      label: "Library",
      hint: "Importable add-on. Not playable on its own.",
    },
  ];
  if (initial.role === "core") {
    roleOptions.push({
      value: "core",
      label: "Core",
      hint: "Base module everyone inherits from. Editable, not surfaced in the play picker.",
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Module properties"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-[560px] max-w-[92vw] flex-col rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex shrink-0 items-baseline justify-between">
          <h2 className="font-display text-xl">Module Properties</h2>
          <span className="font-mono text-xs text-parchment/65">
            id: {initial.id}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {/* Title ----------------------------------------------- */}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              autoFocus
              className={`rounded border bg-ink/40 px-2 py-1 text-sm text-parchment ${
                titleError
                  ? "border-ember focus:border-ember"
                  : "border-parchment/20 focus:border-parchment/45"
              }`}
            />
            {titleError ? (
              <span className="text-xs text-ember">{titleError}</span>
            ) : null}
          </label>

          {/* Description ----------------------------------------- */}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">
              description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full min-w-0 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
              placeholder="Short summary shown on the module card and play picker."
            />
          </label>

          {/* Author + Version ----------------------------------- */}
          <div className="flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[13px] text-parchment/85 font-mono">
                author
              </span>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full min-w-0 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
                placeholder="Your name (optional)"
              />
            </label>
            <label className="flex w-32 flex-col gap-1">
              <span className="text-[13px] text-parchment/85 font-mono">
                version
              </span>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="0.1.0"
                className="w-full min-w-0 rounded border border-parchment/20 bg-ink/40 px-2 py-1 font-mono text-sm text-parchment focus:border-parchment/45"
              />
            </label>
          </div>

          {/* Soundtrack ----------------------------------------- */}
          {/* Default background-music playlist for the module. The
              picker reads /audio/index.json for available tracks
              and supports preview + reorder. Per-map and per-dungeon
              overrides live on the respective Map / Dungeon records. */}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">
              soundtrack
            </span>
            <SoundtrackPicker
              value={soundtrack}
              onChange={setSoundtrack}
              emptyHint="The play host stays silent unless a map or dungeon authors its own playlist."
            />
            <span className="text-xs text-parchment/65">
              The play host picks a random track and rotates through
              the list as tracks end. Maps and dungeons can override
              this list from their own properties.
            </span>
          </div>

          {/* Fog of war (sight radius) --------------------------- */}
          {/* Per-lighting-mode reveal radius. How many tiles out from
              the party a surface is uncovered + remembered each step.
              Blank = use the engine default (shown as placeholder). A
              party torch always reveals at least its own light pool on
              top of these, so a dark dungeon is governed by the
              torch, not by `night`. */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[13px] text-parchment/85 font-mono">
              fog of war — sight radius (tiles)
            </legend>
            <div className="flex gap-3">
              {(
                [
                  ["day", sightDay, setSightDay],
                  ["twilight", sightTwilight, setSightTwilight],
                  ["night", sightNight, setSightNight],
                ] as const
              ).map(([mode, value, setValue]) => (
                <label key={mode} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-parchment/80 font-mono">
                    {mode}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={`default ${SIGHT_RADIUS_DEFAULTS[mode]}`}
                    className="w-full min-w-0 rounded border border-parchment/20 bg-ink/40 px-2 py-1 font-mono text-sm text-parchment focus:border-parchment/45"
                  />
                </label>
              ))}
            </div>
            <span className="text-xs text-parchment/65">
              How far the party uncovers + remembers the map each step,
              by time of day. Leave blank to use the defaults (day{" "}
              {SIGHT_RADIUS_DEFAULTS.day}, twilight{" "}
              {SIGHT_RADIUS_DEFAULTS.twilight}, night{" "}
              {SIGHT_RADIUS_DEFAULTS.night}). A carried torch always
              reveals at least its own light pool, so dungeons stay lit
              by the torch regardless of the night value.
            </span>
          </fieldset>

          {/* Role ------------------------------------------------ */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-[13px] text-parchment/85 font-mono">
              role
            </legend>
            <div className="flex flex-col gap-1">
              {roleOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-start gap-2 rounded border border-parchment/15 bg-ink/30 px-2 py-1 text-sm hover:bg-ink/50"
                >
                  <input
                    type="radio"
                    name="module-role"
                    value={opt.value}
                    checked={role === opt.value}
                    onChange={() => setRole(opt.value)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{opt.label}</span>
                    <span className="ml-2 text-xs text-parchment/75">
                      {opt.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Read-only context ----------------------------------- */}
          {(initial.extends ||
            (initial.uses && initial.uses.length > 0)) ? (
            <div className="mt-1 rounded border border-parchment/15 bg-ink/30 px-2 py-1.5 text-xs text-parchment/75">
              {initial.extends ? (
                <div>
                  <span className="font-mono text-parchment/65">extends:</span>{" "}
                  <span className="text-parchment/75">{initial.extends}</span>
                </div>
              ) : null}
              {initial.uses && initial.uses.length > 0 ? (
                <div>
                  <span className="font-mono text-parchment/65">uses:</span>{" "}
                  <span className="text-parchment/75">
                    {initial.uses.join(", ")}
                  </span>
                </div>
              ) : null}
              <div className="mt-1 text-parchment/60">
                Edit inheritance + library imports from inside the module
                editor.
              </div>
            </div>
          ) : null}
        </div>

        <footer className="mt-4 flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-parchment/20 bg-ink/40 px-3 py-1 text-[13px] text-parchment/85 hover:bg-ink/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-[13px] text-parchment hover:bg-ember/50"
            title="Save (⌘/Ctrl + Enter)"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
