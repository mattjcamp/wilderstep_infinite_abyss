"use client";

/**
 * CharacterSheet — a reusable controlled form for editing a Character
 * record (the v2 schema in docs/data_dictionary/character.md). This
 * component is intentionally low-level:
 *
 *   - It doesn't know about modules, drafts, or persistence. The host
 *     passes a `character` prop and an `onChange` callback; whenever
 *     a field changes the component calls `onChange(next)` with the
 *     fully-updated record. Persistence is the host's problem.
 *   - It takes race + class catalogs (id+name lists) so the lineage
 *     dropdowns can populate from the module the host is editing
 *     (or, in a game-side flow, from whichever module is loaded).
 *   - It preserves opaque fields it doesn't render — today that
 *     means `equipped` and `inventory` round-trip through but aren't
 *     editable here; they have their own model views and can be
 *     wired into this sheet in a later pass.
 *
 * Reusable surface intent: the same component will mount inside the
 * editor's CharactersBrowse (this PR) AND inside the future game
 * character-creation screen (when /play gains an "add character"
 * flow). The game-side flow can wrap with point-buy logic or
 * race-modifier previews without changing this file.
 */

import { SpritePicker } from "./SpritePicker";
import { withBasePath } from "@/util/basePath";

/** Slim Item view the sheet needs — id, display name, icon
 *  (resolved against /sprites/item/<icon>.png), and the slots the
 *  item can equip into. Hosts can pass any item shape that satisfies
 *  this; CharactersBrowse forwards its full SheetItemRef[]. */
export interface SheetItemOption {
  id: string;
  name?: string;
  icon?: string;
  slots?: string[];
}

/** The two equip slots the v2 character schema models. `head` is
 *  reserved on items.json for forward-compat helmets, but PartyMember
 *  doesn't carry a head slot today. */
type EquipSlot = "hands" | "body";

const EQUIP_SLOT_ORDER: readonly EquipSlot[] = ["hands", "body"];

const SLOT_LABELS: Record<EquipSlot, string> = {
  hands: "Hands",
  body:  "Body",
};

/** A reasonably-complete Character record. Optional fields default
 *  sensibly; unknown fields round-trip through `extra`. */
export interface CharacterRecord {
  id: string;
  name: string;
  class: string;
  race: string;
  gender: string;
  level: number;
  exp: number;
  hp: number;
  mp: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  sprite?: string;
  equipped?: Record<string, string>;
  inventory?: Array<Record<string, unknown>>;
  /** Any other fields the loader saw on the record — preserved so
   *  the sheet doesn't strip future additions. The host should merge
   *  these in before saving back out. */
  [k: string]: unknown;
}

/** The ability-stat keys the sheet renders, in display order. */
const STAT_KEYS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
] as const;
type StatKey = (typeof STAT_KEYS)[number];

const GENDERS = ["Male", "Female", "Other"] as const;

const NPC_SPRITE_CONFIG = { category: "person", format: "path" } as const;

export function CharacterSheet({
  character,
  races,
  classes,
  items = [],
  onChange,
  lockId = false,
}: {
  character: CharacterRecord;
  races: Array<{ id: string; name?: string }>;
  classes: Array<{ id: string; name?: string }>;
  /** Item catalog for the equipped-slot pickers. When omitted the
   *  equipped section degrades to read-only text — the host hasn't
   *  loaded items.json yet, but the rest of the sheet still works. */
  items?: ReadonlyArray<SheetItemOption>;
  onChange: (next: CharacterRecord) => void;
  /** When true, the id field is read-only. Useful in the game-side
   *  flow where ids are auto-generated and shouldn't be editable. */
  lockId?: boolean;
}) {
  const patch = (p: Partial<CharacterRecord>) =>
    onChange({ ...character, ...p });

  // Mutate a single key on `character.equipped` without dropping
  // unknown keys (forward-compat with future slots like head).
  const patchEquipped = (slot: EquipSlot, itemId: string) => {
    const next = { ...(character.equipped ?? {}) };
    if (itemId) next[slot] = itemId;
    else delete next[slot];
    patch({ equipped: next });
  };

  return (
    <div className="space-y-4">
      {/* Identity ───────────────────────────────────────────── */}
      <section className="rounded border border-parchment/15 bg-ink/40 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment/55">
          Identity
        </h3>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          {/* Sprite */}
          <div className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              Sprite
            </span>
            <div className="mt-0.5">
              <SpritePicker
                value={character.sprite ?? ""}
                config={NPC_SPRITE_CONFIG}
                onChange={(v) => patch({ sprite: v })}
              />
            </div>
          </div>
          {/* Name + ID + Gender stacked */}
          <div className="grid content-start gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                Name
              </span>
              <input
                type="text"
                value={character.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Aldric"
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-sm text-parchment/90"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                ID {lockId ? "(locked)" : ""}
              </span>
              <input
                type="text"
                value={character.id}
                readOnly={lockId}
                onChange={(e) => patch({ id: e.target.value })}
                placeholder="aldric"
                className={`mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 font-mono text-xs text-parchment/90 ${
                  lockId ? "cursor-not-allowed opacity-60" : ""
                }`}
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-parchment/45">
                Gender
              </span>
              <select
                value={character.gender}
                onChange={(e) => patch({ gender: e.target.value })}
                className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
              >
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                {/* Preserve any legacy / custom value already on the record. */}
                {character.gender &&
                !GENDERS.includes(
                  character.gender as (typeof GENDERS)[number],
                ) ? (
                  <option value={character.gender}>
                    {character.gender} (custom)
                  </option>
                ) : null}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* Lineage + Progression ────────────────────────────────── */}
      <section className="rounded border border-parchment/15 bg-ink/40 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment/55">
          Lineage &amp; Progression
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              Race
            </span>
            <select
              value={character.race}
              onChange={(e) => patch({ race: e.target.value })}
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            >
              {/* Allow legacy / unknown value to round-trip. */}
              {character.race &&
              !races.some((r) => r.id === character.race) ? (
                <option value={character.race}>
                  (missing) {character.race}
                </option>
              ) : null}
              {!character.race ? (
                <option value="">— choose a race —</option>
              ) : null}
              {races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.id} ({r.id})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              Class
            </span>
            <select
              value={character.class}
              onChange={(e) => patch({ class: e.target.value })}
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            >
              {character.class &&
              !classes.some((c) => c.id === character.class) ? (
                <option value={character.class}>
                  (missing) {character.class}
                </option>
              ) : null}
              {!character.class ? (
                <option value="">— choose a class —</option>
              ) : null}
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id} ({c.id})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              Level
            </span>
            <input
              type="number"
              min={1}
              value={character.level}
              onChange={(e) =>
                patch({ level: Number(e.target.value) || 0 })
              }
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              XP
            </span>
            <input
              type="number"
              min={0}
              value={character.exp}
              onChange={(e) => patch({ exp: Number(e.target.value) || 0 })}
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            />
          </label>
        </div>
      </section>

      {/* Vitals + Ability stats ──────────────────────────────── */}
      <section className="rounded border border-parchment/15 bg-ink/40 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment/55">
          Stats
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              HP
            </span>
            <input
              type="number"
              value={character.hp}
              onChange={(e) => patch({ hp: Number(e.target.value) || 0 })}
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              MP
            </span>
            <input
              type="number"
              value={character.mp}
              onChange={(e) => patch({ mp: Number(e.target.value) || 0 })}
              className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          {STAT_KEYS.map((k) => (
            <StatField
              key={k}
              label={STAT_LABELS[k]}
              value={character[k]}
              onChange={(v) => patch({ [k]: v } as Partial<CharacterRecord>)}
            />
          ))}
        </div>
      </section>

      {/* Equipped ───────────────────────────────────────────── */}
      <section className="rounded border border-parchment/15 bg-ink/40 p-3">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-parchment/55">
          Equipped
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {EQUIP_SLOT_ORDER.map((slot) => (
            <EquipSlotPicker
              key={slot}
              slot={slot}
              value={character.equipped?.[slot] ?? ""}
              items={items}
              onChange={(itemId) => patchEquipped(slot, itemId)}
            />
          ))}
        </div>
        {items.length === 0 ? (
          <p className="mt-2 text-[10px] text-parchment/40">
            (Item catalog unavailable — pickers fall back to the raw id.)
          </p>
        ) : null}
      </section>

      {/* Personal inventory note ──────────────────────────────── */}
      <p className="text-[11px] text-parchment/45">
        Personal inventory rounds through unchanged for now. The Hands +
        Body slots above edit <span className="font-mono">equipped</span>;
        the rest of the equipment ribbon (helmets, etc.) joins this sheet
        when the matching gameplay returns.
      </p>
    </div>
  );
}

/**
 * Dropdown + thumbnail picker for one equip slot. Filters the items
 * catalog to entries whose `slots` include this slot. Mirrors the
 * map editor's item field (dropdown + 32×32 sprite preview from
 * `item.icon`) so the editor's two "pick an item" surfaces look the
 * same.
 */
function EquipSlotPicker({
  slot,
  value,
  items,
  onChange,
}: {
  slot: EquipSlot;
  value: string;
  items: ReadonlyArray<SheetItemOption>;
  onChange: (itemId: string) => void;
}) {
  // Slot-matched options. Items missing a `slots` array don't qualify
  // even for hands — the catalog flags equippable gear explicitly.
  const candidates = items.filter((i) => (i.slots ?? []).includes(slot));
  const current = items.find((i) => i.id === value) ?? null;
  // If the saved value points at an item the catalog doesn't recognise
  // (renamed / library reference / stale draft), keep it round-tripping
  // via a synthetic "(missing)" option so we don't silently drop it.
  const missing = value && !current ? value : "";

  const previewSrc = current?.icon
    ? withBasePath(`/sprites/item/${current.icon}.png`)
    : null;

  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-parchment/45">
        {SLOT_LABELS[slot]}
      </span>
      <div className="mt-0.5 flex items-start gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-xs text-parchment/90 focus:border-parchment/60 focus:outline-none"
        >
          <option value="">(none)</option>
          {missing ? (
            <option value={missing}>(missing) {missing}</option>
          ) : null}
          {candidates.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name ? `${i.name} — ${i.id}` : i.id}
            </option>
          ))}
        </select>
        {previewSrc ? (
          <img
            src={previewSrc}
            alt=""
            width={32}
            height={32}
            style={{ imageRendering: "pixelated" }}
            className="h-8 w-8 shrink-0 rounded border border-parchment/20 bg-ink/80 object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility =
                "hidden";
            }}
          />
        ) : (
          <div className="h-8 w-8 shrink-0 rounded border border-parchment/15 bg-ink/40" />
        )}
      </div>
    </label>
  );
}

/** Display labels for the five ability stats. */
const STAT_LABELS: Record<StatKey, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
};

/** Numeric stat input — separated so the layout stays compact. */
function StatField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-parchment/45">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-0.5 w-full rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-center text-sm text-parchment/90"
      />
    </label>
  );
}

/** Build a fresh Character record with reasonable defaults — used by
 *  the "+ New Character" form in CharactersBrowse and the future
 *  game-side character creator. The host fills in `id` and `name`. */
export function makeBlankCharacter(
  id: string,
  name: string,
): CharacterRecord {
  return {
    id,
    name,
    class: "fighter",
    race: "human",
    gender: "Male",
    level: 1,
    exp: 0,
    hp: 10,
    mp: 0,
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    sprite: "",
    equipped: {},
    inventory: [],
  };
}
