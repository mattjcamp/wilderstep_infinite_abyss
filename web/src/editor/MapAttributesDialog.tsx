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
import { SoundtrackPicker } from "./SoundtrackPicker";
import { TagsPicker } from "./TagsPicker";
import {
  DEFAULT_FOG_STYLE,
  FOG_STYLE_LABELS,
  FOG_STYLES,
  type FogStyle,
  type FogStyleByMode,
  normalizeFogStyles,
  resolveFogStyle,
} from "@/sim/fogStyle";

/** Authored lighting override for a map. `world_time` (default,
 *  expressed as `undefined`) defers to the world clock — day during
 *  the day, twilight at dawn / dusk, darkness at night. The three
 *  explicit values lock the map's ambient lighting regardless of
 *  the clock. Useful for interiors that should always feel candle-
 *  lit ("darkness"), permanent dusk ambiance ("twilight"), or
 *  perpetually-bright shrines ("day"). */
export type MapLighting = "world_time" | "day" | "twilight" | "darkness";

interface MapAttributes {
  name: string;
  description?: string;
  tags?: string[];
  /** Absent / "world_time" → follow the clock. The other three force
   *  the renderer into the matching lighting band on this map. */
  lighting?: MapLighting;
  /** Whether fog-of-war applies on this map. Absent → `true` (the
   *  default: most maps use fog). Stored as `false` only when the
   *  author turns it off — e.g. a shop interior the player should see
   *  in full the moment they enter. Lighting is independent; turning
   *  fog off doesn't brighten a dark map, it just stops the
   *  explored / unexplored (cloud) gating. */
  fog_of_war?: boolean;
  /** Per-lighting-band cover style for unexplored tiles ("cloud" |
   *  "darkness"). Missing bands → "cloud". The dialog emits only the
   *  non-default bands, or `undefined` when every band is "cloud". */
  fog_style?: FogStyleByMode;
  /** Per-map background-music playlist override. Each entry is a
   *  file URL. Absent / empty array → fall back to the module
   *  manifest's default soundtrack (or silence if the module's is
   *  also empty). The play host re-points the SoundtrackPlayer at
   *  this list on map entry. */
  soundtrack?: string[];
  /** Optional "restful" passive regen. When present, the party
   *  recovers `hp` HP and `mp` MP per turn (step or wait) while on
   *  this map, capped at each member's peak — for towns / taverns /
   *  safe havens. Absent → no passive healing. Never applies in
   *  dungeons. */
  passive_regen?: { hp: number; mp: number };
}

type FogBand = "day" | "twilight" | "night";

const FOG_BANDS: ReadonlyArray<{ band: FogBand; label: string }> = [
  { band: "day", label: "Day" },
  { band: "twilight", label: "Twilight" },
  { band: "night", label: "Night" },
];

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
  const [lighting, setLighting] = useState<MapLighting>(
    initial.lighting ?? "world_time",
  );
  // Default ON — only an explicit `false` in the record disables fog.
  const [fogOfWar, setFogOfWar] = useState<boolean>(
    initial.fog_of_war !== false,
  );
  // Cover style per lighting band. Seeded from the record; any band it
  // doesn't name shows the default ("cloud").
  const [fogStyle, setFogStyle] = useState<Record<FogBand, FogStyle>>(() => ({
    day: resolveFogStyle(initial.fog_style, "day"),
    twilight: resolveFogStyle(initial.fog_style, "twilight"),
    night: resolveFogStyle(initial.fog_style, "night"),
  }));
  const [soundtrack, setSoundtrack] = useState<string[]>(
    initial.soundtrack ? [...initial.soundtrack] : [],
  );
  // Passive regen ("restful" maps). Enabled when the record carries a
  // rate that actually heals; the per-stat rates default to 1/turn.
  const [regenEnabled, setRegenEnabled] = useState<boolean>(
    !!initial.passive_regen &&
      ((initial.passive_regen.hp ?? 0) > 0 ||
        (initial.passive_regen.mp ?? 0) > 0),
  );
  const [regenHp, setRegenHp] = useState<number>(
    initial.passive_regen?.hp ?? 1,
  );
  const [regenMp, setRegenMp] = useState<number>(
    initial.passive_regen?.mp ?? 1,
  );
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
  }, [
    name,
    description,
    tags,
    lighting,
    soundtrack,
    fogOfWar,
    fogStyle,
    regenEnabled,
    regenHp,
    regenMp,
  ]);

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
      // World-time is the default — omit it from the persisted file
      // so unchanged maps stay shape-identical (no field churn just
      // because the player opened the dialog). The explicit three
      // are stored verbatim.
      lighting: lighting === "world_time" ? undefined : lighting,
      // Soundtrack — empty array → undefined so the caller drops
      // the field cleanly. Non-empty passes the picker's ordered
      // list through verbatim.
      soundtrack: soundtrack.length > 0 ? [...soundtrack] : undefined,
      // Fog-of-war defaults ON, so only persist the field when the
      // author turned it OFF — keeps fogged maps shape-identical
      // (no `"fog_of_war": true` churn). `false` is stored verbatim.
      fog_of_war: fogOfWar ? undefined : false,
      // Fog style: keep only bands that differ from the default so a
      // map left on clouds everywhere carries no `fog_style` key. Kept
      // even while fog is off, so re-enabling fog restores the choice.
      fog_style: normalizeFogStyles(fogStyle),
      // Passive regen: persist only when enabled AND at least one rate
      // heals, so non-restful maps stay shape-clean (no field at all).
      // Rates are clamped to non-negative integers.
      passive_regen:
        regenEnabled && (regenHp > 0 || regenMp > 0)
          ? {
              hp: Math.max(0, Math.floor(regenHp) || 0),
              mp: Math.max(0, Math.floor(regenMp) || 0),
            }
          : undefined,
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
        // Cap the panel at the viewport height and lay it out as a
        // column: the header and footer (with Save) stay pinned while
        // the field list in the middle scrolls. Without this the panel
        // grew with its content and pushed Save below the fold once the
        // soundtrack list was expanded.
        className="flex max-h-[90vh] w-[520px] max-w-[90vw] flex-col rounded-lg border border-parchment/25 bg-ink/95 p-4 text-parchment shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex shrink-0 items-baseline justify-between">
          <h2 className="font-display text-xl">Map Properties</h2>
          <span className="font-mono text-xs text-parchment/65">
            id: {mapId}
          </span>
        </header>

        {/* Scrollable field list — `min-h-0` lets it shrink inside the
            flex column so `overflow-y-auto` actually engages; `-mr-1
            pr-1` insets the scrollbar so it doesn't crowd the inputs. */}
        <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {/* Name ------------------------------------------------ */}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">name</span>
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
              <span className="text-xs text-ember">{nameError}</span>
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
              rows={4}
              className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
              placeholder="Optional. Free-form notes about this map."
            />
          </label>

          {/* Tags ------------------------------------------------ */}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">tags</span>
            <TagsPicker
              tags={tags}
              existing={existingTags}
              onChange={setTags}
            />
            <span className="text-xs text-parchment/65">
              Editor-only labels for organizing maps in the browser. Not
              visible in-game.
            </span>
          </div>

          {/* Soundtrack ----------------------------------------- */}
          {/* Per-map playlist that overrides the module-level
              default while the party is on this map. Leave empty
              to inherit the module default. */}
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">
              soundtrack
            </span>
            <SoundtrackPicker
              value={soundtrack}
              onChange={setSoundtrack}
              emptyHint="Inherits the module-level playlist."
            />
            <span className="text-xs text-parchment/65">
              Overrides the module-level soundtrack while the party is
              on this map. Empty inherits the module default.
            </span>
          </div>

          {/* Lighting -------------------------------------------- */}
          {/* Selects how the renderer paints this map's ambient
              lighting. World-time is the default — the in-game clock
              decides. The three explicit values force the map into
              the matching band regardless of the clock; useful for
              perpetual-night interiors, always-dawn shrines, etc. */}
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-parchment/85 font-mono">lighting</span>
            <select
              value={lighting}
              onChange={(e) => setLighting(e.target.value as MapLighting)}
              className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
            >
              <option value="world_time">World time (default)</option>
              <option value="day">Day</option>
              <option value="twilight">Twilight</option>
              <option value="darkness">Darkness</option>
            </select>
            <span className="text-xs text-parchment/65">
              Override the world clock for this map. World-time follows
              day / twilight / darkness as the in-game hour advances; the
              three explicit values lock the lighting band.
            </span>
          </label>

          {/* Fog of war ------------------------------------------ */}
          {/* On by default. Turning it off reveals the whole map the
              moment the party enters — handy for small "known" spaces
              like shop interiors. Independent of lighting: a dark map
              with fog off is still dark, it just isn't gated by
              exploration / clouded where unseen. */}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={fogOfWar}
              onChange={(e) => setFogOfWar(e.target.checked)}
              className="mt-0.5"
            />
            <span className="flex flex-col">
              <span className="text-[13px] text-parchment/85 font-mono">
                fog of war
              </span>
              <span className="text-xs text-parchment/65">
                When on (default), unexplored tiles stay hidden until the
                party sees them. Turn off for maps that should be fully
                visible on entry, like shops or small interiors.
              </span>
            </span>
          </label>

          {/* Fog style by time of day ---------------------------- */}
          {/* How unexplored tiles are hidden in each lighting band.
              Resolved against the EFFECTIVE band — the clock, or the
              map's lighting override (a "darkness" map uses Night). */}
          <div
            className={`ml-6 flex flex-col gap-1 ${
              fogOfWar ? "" : "pointer-events-none opacity-50"
            }`}
            aria-disabled={!fogOfWar}
          >
            <span className="text-[13px] text-parchment/85 font-mono">
              fog style
            </span>
            <div className="grid grid-cols-3 gap-2">
              {FOG_BANDS.map(({ band, label }) => (
                <label key={band} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-parchment/65">
                    {label}
                  </span>
                  <select
                    value={fogStyle[band]}
                    disabled={!fogOfWar}
                    onChange={(e) =>
                      setFogStyle((prev) => ({
                        ...prev,
                        [band]: e.target.value as FogStyle,
                      }))
                    }
                    className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
                  >
                    {FOG_STYLES.map((style) => (
                      <option key={style} value={style}>
                        {FOG_STYLE_LABELS[style]}
                        {style === DEFAULT_FOG_STYLE ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <span className="text-xs text-parchment/65">
              How unexplored tiles are hidden at each time of day — e.g.
              clouds in the daytime, dark clouds at dusk, darkness at
              night. Follows the
              map&apos;s lighting override when one is set.
            </span>
          </div>

          {/* Passive regen --------------------------------------- */}
          {/* "Restful" maps slowly heal the party each turn (step or
              wait). Off by default; meant for towns / taverns / safe
              havens. Never applies in dungeons. */}
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={regenEnabled}
                onChange={(e) => setRegenEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span className="flex flex-col">
                <span className="text-[13px] text-parchment/85 font-mono">
                  passive regen (restful)
                </span>
                <span className="text-xs text-parchment/65">
                  Living members slowly recover HP / MP each turn while on
                  this map — for towns, taverns, and safe havens. Capped
                  at each member&apos;s max; never revives the downed and
                  never applies in dungeons.
                </span>
              </span>
            </label>
            {regenEnabled ? (
              <div className="ml-6 grid grid-cols-[6rem_6rem] gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-parchment/65">
                    HP / turn
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={regenHp}
                    onChange={(e) =>
                      setRegenHp(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-parchment/65">
                    MP / turn
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={regenMp}
                    onChange={(e) =>
                      setRegenMp(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment focus:border-parchment/45"
                  />
                </label>
              </div>
            ) : null}
          </div>
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
