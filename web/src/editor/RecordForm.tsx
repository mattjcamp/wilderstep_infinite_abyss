"use client";

/**
 * Auto-generated record form. Inspects an existing record (or a
 * template from a peer record) to infer each field's type, then
 * renders an appropriate input:
 *
 *   string + key === "description"  → multi-line textarea
 *   string                          → single-line text input
 *   number                          → number input
 *   boolean                         → checkbox
 *   array | object                  → JSON textarea with parse validation
 *   null                            → text input (treated as empty string)
 *
 * The form returns a typed record on submit. Each value is coerced
 * back to its inferred type (numbers parsed, booleans normalized,
 * JSON-typed fields re-parsed).
 *
 * Forms aren't aware of cross-references or domain validation yet —
 * those would arrive with a Zod layer.
 */

import { useMemo, useState } from "react";
import { SpritePicker } from "./SpritePicker";
import { getSpriteFieldConfig } from "./spriteFields";
import { AnimationPicker } from "./AnimationPicker";
import { getAnimationFieldConfig } from "./animationFields";
import { CounterPicker } from "./CounterPicker";
import { getCounterFieldConfig } from "./counterFields";
import { MapPicker } from "./MapPicker";
import { getMapFieldConfig } from "./mapFields";
import { TagsPicker } from "./TagsPicker";
import { DialogsEditor } from "./DialogsEditor";
import { npcDialogLinesForEditing } from "@/data_model/npcDialogs";
import { IdListPicker } from "./IdListPicker";
import { getIdListFieldConfig } from "./idListFields";
import { InventoryEditor, type InventoryEntry } from "./InventoryEditor";
import { getInventoryFieldConfig } from "./inventoryFields";
import { KeyMapEditor } from "./KeyMapEditor";
import { getKeyMapFieldConfig } from "./keyMapFields";
import { ParamsEditor } from "./ParamsEditor";
import { getParamsFieldConfig } from "./paramsFields";

/** Models whose records carry a free-form `tags: string[]` for editor
 *  organization. The form injects the field (even when a record hasn't
 *  set it yet) and renders the chip-style TagsPicker for it. */
const TAGGED_MODELS = new Set(["encounters"]);

type FieldKind =
  | "string"
  | "string-long"
  | "number"
  | "boolean"
  | "json"
  | "null";

interface FieldSpec {
  key: string;
  kind: FieldKind;
}

function inferKind(
  key: string,
  value: unknown,
  sample?: unknown,
  modelKey?: string,
): FieldKind {
  // Known sprite-typed fields are always strings, so the picker can
  // render even when the field is currently null/empty (e.g., a
  // freshly-added `avatar` on Party).
  if (getSpriteFieldConfig(key, modelKey) !== null) return "string";
  // Animation-typed fields are likewise always strings (Animation id).
  // The picker renders an empty-state when the value is null/"".
  if (getAnimationFieldConfig(key, modelKey) !== null) return "string";
  // Counter-typed fields are strings too (Counter id). The CounterPicker
  // handles a null/"" value as "(none)".
  if (getCounterFieldConfig(key, modelKey) !== null) return "string";
  // Map-typed fields (e.g., spawn.custom_map, encounter.custom_map)
  // are Map id strings. The MapPicker handles null/"" as "(none)".
  if (getMapFieldConfig(key, modelKey) !== null) return "string";
  // Id-list fields are always JSON (string arrays) so the picker can
  // render even when the record's current value is null.
  if (getIdListFieldConfig(key, modelKey) !== null) return "json";
  // Inventory fields are JSON ({ item, charges }[]) so the editor can
  // render — and so submit re-parses the string back into an array —
  // even when the record's current value is null/empty.
  if (getInventoryFieldConfig(key, modelKey) !== null) return "json";
  // Key-map fields (reagents, stat_modifiers, equipped) likewise.
  if (getKeyMapFieldConfig(key, modelKey) !== null) return "json";
  // Params fields (effects/abilities/traps params, spell action
  // params) likewise.
  if (getParamsFieldConfig(key, modelKey) !== null) return "json";
  // Prefer the actual record's value; fall back to a sample peer.
  const v = value ?? sample;
  if (Array.isArray(v) || (v !== null && typeof v === "object")) return "json";
  if (typeof v === "string") {
    // Prose-shaped fields render as a multi-line textarea instead of
    // a single-line input. `description` and `_comment` are universal;
    // `personal_history` is the NPC backstory field. Add new prose
    // keys here as new models introduce them.
    if (
      key === "description" ||
      key === "_comment" ||
      key === "personal_history"
    ) {
      return "string-long";
    }
    return "string";
  }
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v === null || v === undefined) return "null";
  return "string";
}

function buildFieldList(
  record: Record<string, unknown>,
  template: Record<string, unknown>,
  modelKey?: string,
): FieldSpec[] {
  // Union of keys, in the order they appear in the template first,
  // then any extra keys on the record.
  const seen = new Set<string>();
  const fields: FieldSpec[] = [];
  for (const k of Object.keys(template)) {
    if (k === "_comment") continue;
    seen.add(k);
    fields.push({ key: k, kind: inferKind(k, record[k], template[k], modelKey) });
  }
  for (const k of Object.keys(record)) {
    if (seen.has(k) || k === "_comment") continue;
    fields.push({ key: k, kind: inferKind(k, record[k], undefined, modelKey) });
  }
  // Tagged models always expose a `tags` field even when the record
  // hasn't set one yet, so authors can start tagging without first
  // editing the JSON. Stored + parsed as a JSON array (string[]).
  if (modelKey && TAGGED_MODELS.has(modelKey) && !seen.has("tags")) {
    fields.push({ key: "tags", kind: "json" });
  }
  return fields;
}

function valueToInput(kind: FieldKind, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (kind === "json") return JSON.stringify(v, null, 2);
  return String(v);
}

function inputToValue(
  kind: FieldKind,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (kind === "boolean") {
    return { ok: true, value: raw === "true" };
  }
  if (kind === "number") {
    if (raw.trim() === "") return { ok: true, value: null };
    const n = Number(raw);
    if (Number.isNaN(n)) return { ok: false, error: "not a number" };
    return { ok: true, value: n };
  }
  if (kind === "json") {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "null") return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "invalid JSON",
      };
    }
  }
  if (kind === "null" || kind === "string" || kind === "string-long") {
    if (raw === "") return { ok: true, value: null };
    return { ok: true, value: raw };
  }
  return { ok: true, value: raw };
}

export function RecordForm({
  record,
  template,
  onSave,
  onCancel,
  submitLabel = "Save",
  modelKey,
  moduleId,
  existingTags = [],
}: {
  record: Record<string, unknown>;
  /** A peer record used to fill in field types when `record` has nulls. */
  template?: Record<string, unknown>;
  onSave: (updated: Record<string, unknown>) => void;
  onCancel: () => void;
  submitLabel?: string;
  /** The model this record belongs to. Threads through to sprite-field
   *  config so per-model overrides (e.g., map_tiles.sprite → category
   *  "map" vs Character.sprite → category "person") apply correctly. */
  modelKey?: string;
  /** Module whose resolved catalogs feed reference pickers (id-list
   *  options respect module inheritance). Optional — pickers fall
   *  back to the base module when absent. */
  moduleId?: string;
  /** Tag suggestions (union of sibling records' tags) for the tags
   *  picker's autocomplete — keeps tag spelling consistent so the
   *  grouping doesn't fragment. */
  existingTags?: string[];
}) {
  const fields = useMemo(
    () => buildFieldList(record, template ?? record, modelKey),
    [record, template, modelKey],
  );

  // String state per field — every input is a string, coerced on submit.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = valueToInput(f.kind, record[f.key]);
    // Also seed booleans as "true"/"false" strings.
    for (const f of fields)
      if (f.kind === "boolean") seed[f.key] = String(Boolean(record[f.key]));
    return seed;
  });

  // Per-field parse errors, surfaced inline.
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (key: string, raw: string) => {
    setDrafts((d) => ({ ...d, [key]: raw }));
    setErrors((e) => {
      if (!e[key]) return e;
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
  };

  const handleSubmit = () => {
    const next: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const f of fields) {
      const r = inputToValue(f.kind, drafts[f.key] ?? "");
      if (!r.ok) nextErrors[f.key] = r.error;
      else next[f.key] = r.value;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    onSave(next);
  };

  return (
    <div className="rounded border border-parchment/20 bg-ink/60 p-4">
      <div className="grid gap-3">
        {fields.map((f) => (
          <FieldRow
            key={f.key}
            spec={f}
            value={drafts[f.key] ?? ""}
            error={errors[f.key]}
            modelKey={modelKey}
            moduleId={moduleId}
            existingTags={existingTags}
            onChange={(v) => update(f.key, v)}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="rounded border border-ember/60 bg-ember/30 px-3 py-1 text-sm text-parchment hover:bg-ember/50"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/40"
        >
          Cancel
        </button>
        {Object.keys(errors).length > 0 ? (
          <span className="ml-2 text-[13px] text-ember">
            Fix {Object.keys(errors).length} field
            {Object.keys(errors).length === 1 ? "" : "s"} above
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FieldRow({
  spec,
  value,
  error,
  modelKey,
  moduleId,
  existingTags = [],
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  error?: string;
  modelKey?: string;
  moduleId?: string;
  existingTags?: string[];
  onChange: (v: string) => void;
}) {
  const labelClasses =
    "min-w-[10rem] shrink-0 pt-1 text-sm text-parchment/85 font-mono";

  // Id-list fields (encounter rosters, spawn lists, race abilities,
  // item slots, …) render the IdListPicker — chips + a filterable
  // catalog panel — instead of a raw JSON textarea. Draft stays a
  // JSON string (same contract as every json field). Values that
  // aren't a plain string array (legacy hand-edits with objects
  // inside) fall through to the textarea so nothing is uneditable.
  {
    const idListCfg = getIdListFieldConfig(spec.key, modelKey);
    if (idListCfg) {
      let ids: string[] | null = null;
      try {
        const parsed = value.trim() === "" ? [] : JSON.parse(value);
        if (parsed === null) ids = [];
        else if (
          Array.isArray(parsed) &&
          parsed.every((x) => typeof x === "string")
        ) {
          ids = parsed as string[];
        }
      } catch {
        ids = null;
      }
      if (ids !== null) {
        return (
          <div className="flex items-start gap-3">
            <span className={labelClasses}>{spec.key}</span>
            <IdListPicker
              value={ids}
              source={idListCfg.source}
              moduleId={moduleId}
              allowDuplicates={idListCfg.allowDuplicates}
              help={idListCfg.help}
              onChange={(next) => onChange(JSON.stringify(next))}
            />
          </div>
        );
      }
    }
  }
  // Inventory fields ({ item, charges }[]) render the InventoryEditor —
  // an item picker (with sprites) + a per-row quantity — instead of a
  // raw JSON textarea. A value that isn't an array of `{ item: string }`
  // objects (legacy hand-edits) falls through to the textarea so it
  // stays editable.
  {
    const invCfg = getInventoryFieldConfig(spec.key, modelKey);
    if (invCfg) {
      let entries: InventoryEntry[] | null = null;
      try {
        const parsed = value.trim() === "" ? [] : JSON.parse(value);
        if (parsed === null) entries = [];
        else if (
          Array.isArray(parsed) &&
          parsed.every(
            (x) =>
              x !== null &&
              typeof x === "object" &&
              !Array.isArray(x) &&
              typeof (x as { item?: unknown }).item === "string",
          )
        ) {
          entries = parsed as InventoryEntry[];
        }
      } catch {
        entries = null;
      }
      if (entries !== null) {
        return (
          <div className="flex items-start gap-3">
            <span className={labelClasses}>{spec.key}</span>
            <InventoryEditor
              value={entries}
              moduleId={moduleId}
              help={invCfg.help}
              onChange={(next) => onChange(JSON.stringify(next, null, 1))}
            />
          </div>
        );
      }
    }
  }
  // Params fields render the ParamsEditor — typed rows from the
  // model's knob vocabulary plus a custom-key escape hatch — instead
  // of a raw JSON textarea. Any flat object (or null) qualifies;
  // non-object values (legacy hand-edits) fall through to the
  // textarea.
  {
    const paramsCfg = getParamsFieldConfig(spec.key, modelKey);
    if (paramsCfg) {
      let obj: Record<string, unknown> | null = null;
      try {
        const parsed = value.trim() === "" ? {} : JSON.parse(value);
        if (parsed === null) obj = {};
        else if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          obj = parsed as Record<string, unknown>;
        }
      } catch {
        obj = null;
      }
      if (obj !== null) {
        return (
          <div className="flex items-start gap-3">
            <span className={labelClasses}>{spec.key}</span>
            <ParamsEditor
              value={obj}
              config={paramsCfg}
              moduleId={moduleId}
              onChange={(next) => onChange(JSON.stringify(next, null, 1))}
            />
          </div>
        );
      }
    }
  }
  // Key-map fields (recipe reagents, stat modifiers, equipment
  // slots) render the KeyMapEditor — rows of key → number / key →
  // catalog-id — instead of a raw JSON textarea. Same parse-or-fall-
  // through policy as the id-list branch: a value that isn't a flat
  // map of numbers (number mode) or strings (id mode) keeps the
  // textarea so legacy hand-edits stay editable.
  {
    const keyMapCfg = getKeyMapFieldConfig(spec.key, modelKey);
    if (keyMapCfg) {
      let map: Record<string, string | number> | null = null;
      try {
        const parsed = value.trim() === "" ? {} : JSON.parse(value);
        if (parsed === null) map = {};
        else if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          const entries = Object.entries(parsed as Record<string, unknown>);
          const want = keyMapCfg.value.kind === "number" ? "number" : "string";
          if (entries.every(([, v]) => typeof v === want)) {
            map = parsed as Record<string, string | number>;
          }
        }
      } catch {
        map = null;
      }
      if (map !== null) {
        return (
          <div className="flex items-start gap-3">
            <span className={labelClasses}>{spec.key}</span>
            <KeyMapEditor
              value={map}
              config={keyMapCfg}
              moduleId={moduleId}
              onChange={(next) => onChange(JSON.stringify(next, null, 1))}
            />
          </div>
        );
      }
    }
  }
  // NPC `dialogs` render the structured DialogsEditor instead of a
  // raw JSON textarea — the textarea invited the shape mistake of a
  // bare single-dialog object (no `[ ]`), which played back as the
  // silent fallback. The draft stays a JSON string (same contract as
  // every other json field); normalizeNpcDialogs coerces whatever
  // shape the record carried (object / string / array) into the
  // canonical array, so the first save through this editor also
  // FIXES a malformed record. Unparseable raw JSON falls through to
  // the plain textarea so it's still recoverable by hand.
  if (spec.key === "dialogs" && modelKey === "npcs") {
    let parsed: unknown = null;
    let parseable = true;
    try {
      parsed = value.trim() === "" ? [] : JSON.parse(value);
    } catch {
      parseable = false;
    }
    if (parseable) {
      return (
        <div className="flex items-start gap-3">
          <span className={labelClasses}>dialogs</span>
          <DialogsEditor
            lines={npcDialogLinesForEditing(parsed)}
            onChange={(next) => onChange(JSON.stringify(next, null, 2))}
          />
        </div>
      );
    }
  }
  // A `tags` field renders the chip-style TagsPicker instead of a raw
  // JSON textarea. The on-disk value stays a JSON string[] so the
  // submit-time `inputToValue("json", …)` round-trips it unchanged.
  if (spec.key === "tags") {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(value || "[]");
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      tags = [];
    }
    return (
      <div className="flex items-start gap-3">
        <span className={labelClasses}>tags</span>
        <div className="flex-1">
          <TagsPicker
            tags={tags}
            existing={existingTags}
            onChange={(next) => onChange(JSON.stringify(next))}
          />
          <p className="mt-1 text-xs text-parchment/60">
            Editor-only labels for grouping. Gameplay ignores them.
          </p>
        </div>
      </div>
    );
  }
  const inputBase =
    "flex-1 rounded border bg-ink/40 px-2 py-1 text-sm text-parchment placeholder:text-parchment/50 focus:outline-none";
  const inputColor = error
    ? "border-ember focus:border-ember"
    : "border-parchment/20 focus:border-parchment/60";

  if (spec.kind === "boolean") {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
        </label>
        <div className="flex-1">
          <label className="inline-flex items-center gap-2 text-sm text-parchment/90">
            <input
              id={spec.key}
              type="checkbox"
              checked={value === "true"}
              onChange={(e) => onChange(String(e.target.checked))}
              className="h-4 w-4"
            />
            <span className="text-parchment/80">{value}</span>
          </label>
        </div>
      </div>
    );
  }

  if (spec.kind === "string-long" || spec.kind === "json") {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
          {spec.kind === "json" ? (
            <span className="block text-xs text-parchment/60">JSON</span>
          ) : null}
        </label>
        <div className="flex-1">
          <textarea
            id={spec.key}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={spec.kind === "json" ? Math.min(10, value.split("\n").length + 1) : 3}
            className={`${inputBase} ${inputColor} font-mono`}
          />
          {error ? (
            <p className="mt-1 text-[13px] text-ember">{error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // Sprite-typed string fields get a picker instead of a plain text
  // input. The picker still lets the user type into the text input as
  // a fallback, but offers a thumbnail + browsable grid of sprites
  // from the module's sprite library.
  const spriteConfig =
    spec.kind === "string" ? getSpriteFieldConfig(spec.key, modelKey) : null;
  if (spriteConfig) {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
          <span className="block text-xs text-parchment/60">sprite</span>
        </label>
        <div className="flex-1">
          <SpritePicker
            value={value}
            config={spriteConfig}
            onChange={onChange}
          />
          {error ? <p className="mt-1 text-[13px] text-ember">{error}</p> : null}
        </div>
      </div>
    );
  }

  // Animation-typed string fields get the AnimationPicker. Same shape
  // as sprite fields, but it reads from the module's animations.json
  // catalog instead of the sprite index.
  const animationConfig =
    spec.kind === "string"
      ? getAnimationFieldConfig(spec.key, modelKey)
      : null;
  if (animationConfig) {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
          <span className="block text-xs text-parchment/60">
            animation
          </span>
        </label>
        <div className="flex-1">
          <AnimationPicker value={value} onChange={onChange} />
          {error ? <p className="mt-1 text-[13px] text-ember">{error}</p> : null}
        </div>
      </div>
    );
  }

  // Counter-typed string fields get the CounterPicker. Same pattern,
  // reading counters.json instead.
  const counterConfig =
    spec.kind === "string"
      ? getCounterFieldConfig(spec.key, modelKey)
      : null;
  if (counterConfig) {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
          <span className="block text-xs text-parchment/60">counter</span>
        </label>
        <div className="flex-1">
          <CounterPicker value={value} onChange={onChange} />
          {error ? <p className="mt-1 text-[13px] text-ember">{error}</p> : null}
        </div>
      </div>
    );
  }

  // Map-typed string fields (spawn.custom_map, encounter.custom_map)
  // get the MapPicker — reads maps.json and writes the picked Map id.
  const mapConfig =
    spec.kind === "string" ? getMapFieldConfig(spec.key, modelKey) : null;
  if (mapConfig) {
    return (
      <div className="flex items-start gap-3">
        <label htmlFor={spec.key} className={labelClasses}>
          {spec.key}
          <span className="block text-xs text-parchment/60">map</span>
        </label>
        <div className="flex-1">
          <MapPicker
            value={value}
            onChange={onChange}
            requiredTag={mapConfig.requiredTag}
          />
          {error ? <p className="mt-1 text-[13px] text-ember">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <label htmlFor={spec.key} className={labelClasses}>
        {spec.key}
      </label>
      <div className="flex-1">
        <input
          id={spec.key}
          type={spec.kind === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputBase} ${inputColor}`}
        />
        {error ? <p className="mt-1 text-[13px] text-ember">{error}</p> : null}
      </div>
    </div>
  );
}
