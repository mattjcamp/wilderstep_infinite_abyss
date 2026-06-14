"use client";

/**
 * PartyFormation — pick + create your adventuring party.
 *
 * The module ships a default roster in party.json. The player can:
 *   - **Create** a new character via the prominent CTA at the top of
 *     the page. New characters auto-join the party when there's a
 *     free slot; otherwise they land in the Available pool so the
 *     player can swap them in.
 *   - **Reorder** their party by drag-and-drop (HTML5 native — no
 *     dependency). Position 1 is the lead member shown on the world
 *     map and acts first in combat.
 *   - **Remove** a party member, sending them back to the Available
 *     pool. Module-supplied characters can be re-added; custom ones
 *     stay around for the lifetime of the formation flow.
 *   - **Add** any character from the Available pool to the party as
 *     long as there's room.
 *
 * Party size is soft-capped at `max(rosterSize, 4)` — the module's
 * default party size, but never less than four so a one-character
 * tutorial module doesn't strand the player. Begin is disabled when
 * the party is empty.
 *
 * On "Begin", the assembled party (slot resolution + custom-character
 * records for any non-module slots) is stashed in sessionStorage so
 * the beginning-screen page can read it. Refreshing the page resets
 * the draft on purpose — it's a short flow, no need for persistence
 * across a hard reload.
 */

import { playBeginHref } from "@/play/playRoutes";
import { getModuleSource } from "@/data_model/sourceConfig";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { withBasePath } from "@/util/basePath";
import { mergeModel } from "@/data_model/merge";
import { StaticModuleSource } from "@/data_model/StaticModuleSource";
import {
  CharacterCreator,
  type RaceRecord,
  type ClassRecord,
  type AbilityRecord,
} from "@/editor/CharacterCreator";
import type { CharacterRecord } from "@/editor/CharacterSheet";

/** A resolved slot — either a reference to a module-supplied
 *  character by id, or a freshly built CharacterRecord the player
 *  rolled in CharacterCreator. The save layer treats these the same
 *  at write time; the loader joins module-id slots against the
 *  module's characters.json while custom slots are self-contained. */
type Slot =
  | { kind: "module"; characterId: string }
  | { kind: "custom"; character: CharacterRecord };

/** sessionStorage key shape — namespaced per module so two modules
 *  can hold concurrent drafts (e.g. tab-switching). */
function draftKey(moduleId: string): string {
  return `wsia.play.draft.party.${moduleId}`;
}

interface ModulePartyDoc {
  start_position?: { map_id?: string; col?: number; row?: number };
  avatar?: string;
  gold?: number;
  roster?: string[];
  party_effects?: unknown[];
  inventory?: Array<{ item: string; charges?: number }>;
}

interface LoadedCatalog {
  party: ModulePartyDoc;
  characters: CharacterRecord[];
  races: RaceRecord[];
  classes: ClassRecord[];
  abilities: AbilityRecord[];
}

/** Hard floor on party size when the module ships a smaller roster —
 *  four slots is the canonical CRPG party shape and matches what the
 *  combat scene's layout was designed against. Modules that ship six
 *  characters get six slots; one-character tutorial modules still
 *  give the player up to four. */
const MIN_PARTY_CAP = 4;

export function PartyFormation({ moduleId }: { moduleId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; catalog: LoadedCatalog } | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [slots, setSlots] = useState<Slot[]>([]);
  /** Custom (player-created) characters that exist for this formation
   *  session. A character lands here on creation and STAYS here even
   *  if removed from the party — so the player can swap them back in
   *  without re-rolling. Module-supplied characters live in
   *  `catalog.characters` and aren't duplicated here. */
  const [customChars, setCustomChars] = useState<CharacterRecord[]>([]);
  /** True when the inline CharacterCreator is open. Mutually
   *  exclusive — one creator at a time. */
  const [creating, setCreating] = useState(false);
  /** Index of the slot currently being dragged. `null` = no drag in
   *  flight. */
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  /** Index the dragged row is currently hovering over — drives the
   *  drop-indicator line so the player can see where the row will
   *  land before they release. */
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Load the module's party + character catalogs. Same pattern the
  // editor's CharactersBrowse uses, scoped down to the fields we
  // actually need for formation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = getModuleSource();
        const [
          partyLayers,
          characterLayers,
          raceLayers,
          classLayers,
          abilityLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
        ]);
        if (cancelled) return;
        const party = (mergeModel(
          "party",
          partyLayers.inherited,
          partyLayers.ownFile,
        ) ?? {}) as ModulePartyDoc;
        const chars = (mergeModel(
          "characters",
          characterLayers.inherited,
          characterLayers.ownFile,
        ) ?? {}) as { characters?: CharacterRecord[] };
        const races = (mergeModel(
          "races",
          raceLayers.inherited,
          raceLayers.ownFile,
        ) ?? {}) as { races?: RaceRecord[] };
        const classes = (mergeModel(
          "character_classes",
          classLayers.inherited,
          classLayers.ownFile,
        ) ?? {}) as { character_classes?: ClassRecord[] };
        const abilities = (mergeModel(
          "abilities",
          abilityLayers.inherited,
          abilityLayers.ownFile,
        ) ?? {}) as { abilities?: AbilityRecord[] };
        const catalog: LoadedCatalog = {
          party,
          characters: chars.characters ?? [],
          races: races.races ?? [],
          classes: classes.character_classes ?? [],
          abilities: abilities.abilities ?? [],
        };
        setState({ kind: "ok", catalog });
        // Initial slot state: every roster id resolves to a module
        // slot. Refreshing the page resets to module defaults.
        setSlots(
          (catalog.party.roster ?? []).map((id) => ({
            kind: "module",
            characterId: id,
          })),
        );
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  // Map of module characters by id for O(1) slot resolution.
  const charactersById = useMemo(() => {
    if (state.kind !== "ok") return new Map<string, CharacterRecord>();
    return new Map(state.catalog.characters.map((c) => [c.id, c]));
  }, [state]);

  // Set of character ids currently in the party — used to filter
  // the Available pool so the same character can't be in two places.
  // Module slots resolve to their `characterId`; custom slots use
  // the embedded record's id (CharacterCreator guarantees unique
  // ids via `usedIds` collision avoidance).
  const inPartyIds = useMemo(() => {
    const s = new Set<string>();
    for (const slot of slots) {
      s.add(slot.kind === "module" ? slot.characterId : slot.character.id);
    }
    return s;
  }, [slots]);

  // Available pool: every character (module + custom) not currently
  // in the party. Module characters keep their kind so the slot type
  // round-trips correctly when added back.
  const availableModule = useMemo(() => {
    if (state.kind !== "ok") return [];
    return state.catalog.characters.filter((c) => !inPartyIds.has(c.id));
  }, [state, inPartyIds]);
  const availableCustom = useMemo(
    () => customChars.filter((c) => !inPartyIds.has(c.id)),
    [customChars, inPartyIds],
  );

  // Ids already in use — passed to CharacterCreator so a freshly
  // rolled character can't collide with a module character or with
  // an existing custom one (in or out of the party).
  const usedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of charactersById.values()) ids.add(c.id);
    for (const c of customChars) ids.add(c.id);
    return ids;
  }, [charactersById, customChars]);

  // Soft cap on party size: never less than four (so a tiny module
  // still lets the player build a real party), otherwise the
  // module's original roster size.
  const partyCap = useMemo(() => {
    if (state.kind !== "ok") return MIN_PARTY_CAP;
    return Math.max(MIN_PARTY_CAP, state.catalog.party.roster?.length ?? 0);
  }, [state]);

  const canAddMore = slots.length < partyCap;

  const onCreateComplete = (rec: CharacterRecord) => {
    // Add to the custom pool first; if there's room in the party,
    // auto-join so the player doesn't have to click Add as a second
    // step. They can drag the new character to any position
    // afterwards.
    setCustomChars((prev) => [...prev, rec]);
    setSlots((prev) =>
      prev.length < partyCap
        ? [...prev, { kind: "custom", character: rec }]
        : prev,
    );
    setCreating(false);
  };

  const onAddModule = (id: string) => {
    if (!canAddMore) return;
    setSlots((prev) => [...prev, { kind: "module", characterId: id }]);
  };

  const onAddCustom = (rec: CharacterRecord) => {
    if (!canAddMore) return;
    setSlots((prev) => [...prev, { kind: "custom", character: rec }]);
  };

  const onRemove = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  /** Move the slot at `from` so it lands AT `to` in the resulting
   *  array (insertion-style, not swap). No-op when from === to. */
  const onReorder = (from: number, to: number) => {
    if (from === to) return;
    setSlots((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const onBegin = () => {
    if (state.kind !== "ok") return;
    if (typeof window === "undefined") return;
    if (slots.length === 0) return;
    const draft = { moduleId, slots };
    try {
      window.sessionStorage.setItem(
        draftKey(moduleId),
        JSON.stringify(draft),
      );
    } catch {
      // Storage unavailable — fall through; the beginning screen will
      // detect the absent draft and route back here.
    }
    router.push(playBeginHref(moduleId));
  };

  if (state.kind === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-parchment/55">Loading module data…</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <p className="text-red-300">Failed to load module: {state.message}</p>
        <Link href="/play/new" className="text-parchment/70 underline">
          Pick a different module
        </Link>
      </main>
    );
  }

  const { catalog } = state;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl text-parchment">Form the Party</h1>
          <p className="mt-1 text-sm text-parchment/65">
            Build a roster of up to {partyCap}{" "}
            {partyCap === 1 ? "adventurer" : "adventurers"}. Create your own,
            pick from the module's heroes, and drag to set marching order — the
            first slot leads on the world map and acts first in combat.
          </p>
        </div>
        {/* Begin lives up here (next to the create CTA below) so it's
            obvious from the first screenful — players were missing it
            when it only sat in the footer below a long roster list.
            Same disabled rules + hint as before. */}
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <button
            type="button"
            onClick={onBegin}
            disabled={creating || slots.length === 0}
            className="rounded-md border border-parchment/40 bg-ember/90 px-8 py-2 text-parchment shadow transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-40"
          >
            Begin →
          </button>
          {slots.length === 0 ? (
            <span className="text-xs text-amber-200/85">
              Add at least one character to begin.
            </span>
          ) : null}
        </div>
      </header>

      {/* ── Prominent create CTA ────────────────────────────────────
          Sits above everything so a player who wants to roll their
          own party sees the option immediately. When the creator is
          open, the CTA card expands inline to host the wizard so
          the player keeps the rest of the page in view. */}
      {creating ? (
        <section className="rounded-md border border-ember/60 bg-ember/10 p-4">
          <h2 className="mb-3 font-display text-lg text-parchment">
            Create a new character
          </h2>
          <CharacterCreator
            existingIds={usedIds}
            races={catalog.races}
            classes={catalog.classes}
            abilities={catalog.abilities}
            onComplete={onCreateComplete}
            onCancel={() => setCreating(false)}
          />
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center justify-between gap-4 rounded-md border-2 border-dashed border-ember/60 bg-ember/10 p-4 text-left transition hover:border-ember hover:bg-ember/20"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-ember/60 bg-ember/20 text-2xl font-bold text-ember">
              +
            </div>
            <div>
              <div className="font-display text-lg text-parchment">
                Create a new character
              </div>
              <div className="text-xs text-parchment/65">
                Roll your own hero —{" "}
                {canAddMore
                  ? "they'll join the party automatically."
                  : "your party is full, so they'll land in the Available pool."}
              </div>
            </div>
          </div>
          <span className="rounded border border-ember/60 px-3 py-1 text-xs uppercase tracking-wide text-ember">
            Create
          </span>
        </button>
      )}

      {/* ── Your Party (ordered, drag-to-reorder) ──────────────────
          Each row is draggable; dragging shows a thin amber line at
          the would-be drop position so the player can see where the
          row is about to land. The "lead" badge on row 0 reinforces
          that order matters. Remove is a per-row button — removed
          members fall back into the Available pool. */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-xl text-parchment">
            Your Party
          </h2>
          <span className="text-xs text-parchment/55">
            {slots.length} / {partyCap}
            {slots.length > 0 ? " · drag to reorder" : ""}
          </span>
        </div>

        {slots.length === 0 ? (
          <div className="rounded-md border border-dashed border-parchment/20 bg-ink/30 p-6 text-center text-sm text-parchment/55">
            No characters in the party yet. Create one above, or add
            from Available Characters below.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {slots.map((slot, idx) => {
              const isDragging = dragIdx === idx;
              const showLineAbove =
                dragOverIdx === idx &&
                dragIdx !== null &&
                dragIdx !== idx &&
                dragIdx > idx;
              const showLineBelow =
                dragOverIdx === idx &&
                dragIdx !== null &&
                dragIdx !== idx &&
                dragIdx < idx;
              return (
                <li
                  key={
                    slot.kind === "module"
                      ? `m-${slot.characterId}`
                      : `c-${slot.character.id}`
                  }
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(idx);
                    // Required for Firefox to fire drag events.
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(idx));
                  }}
                  onDragOver={(e) => {
                    // Calling preventDefault here is what tells the
                    // browser this element is a valid drop target —
                    // without it, onDrop never fires.
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverIdx !== idx) setDragOverIdx(idx);
                  }}
                  onDragLeave={() => {
                    if (dragOverIdx === idx) setDragOverIdx(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) onReorder(dragIdx, idx);
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  className={`rounded-md border bg-ink/40 p-4 transition ${
                    isDragging
                      ? "border-ember/60 opacity-50"
                      : "border-parchment/20"
                  } ${showLineAbove ? "border-t-2 border-t-ember" : ""} ${
                    showLineBelow ? "border-b-2 border-b-ember" : ""
                  }`}
                >
                  <PartyMemberRow
                    slot={slot}
                    idx={idx}
                    charactersById={charactersById}
                    onRemove={() => onRemove(idx)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Available Characters pool ──────────────────────────────
          Module-supplied characters not currently in the party are
          listed first, then any custom characters the player rolled
          and later removed. "Add to party" puts them at the END of
          the party list; the player can then drag them anywhere. */}
      {(availableModule.length > 0 || availableCustom.length > 0) && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-xl text-parchment">
              Available Characters
            </h2>
            {!canAddMore ? (
              <span className="text-xs text-amber-200/85">
                Party full — remove a member to add another.
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {availableModule.map((c) => (
              <li
                key={`avail-m-${c.id}`}
                className="rounded-md border border-parchment/15 bg-ink/30 p-4"
              >
                <AvailableRow
                  character={c}
                  origin="module"
                  canAdd={canAddMore}
                  onAdd={() => onAddModule(c.id)}
                />
              </li>
            ))}
            {availableCustom.map((c) => (
              <li
                key={`avail-c-${c.id}`}
                className="rounded-md border border-parchment/15 bg-ink/30 p-4"
              >
                <AvailableRow
                  character={c}
                  origin="custom"
                  canAdd={canAddMore}
                  onAdd={() => onAddCustom(c)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-2 flex items-center justify-between gap-4">
        <Link
          href="/play/new"
          className="text-sm text-parchment/55 underline hover:text-parchment/80"
        >
          Back to module picker
        </Link>
        {/* Begin now lives in the header so it's visible without
            scrolling; a second copy here would be redundant. */}
      </footer>
    </main>
  );
}

/** A row inside the party list. Shows the drag handle, lead-position
 *  badge (for idx 0), portrait, summary, and a Remove button. The
 *  drag affordance is the entire row (`draggable` is on the <li>);
 *  the handle is a visual hint, not a separate event surface. */
function PartyMemberRow({
  slot,
  idx,
  charactersById,
  onRemove,
}: {
  slot: Slot;
  idx: number;
  charactersById: Map<string, CharacterRecord>;
  onRemove: () => void;
}) {
  const character: CharacterRecord | null =
    slot.kind === "custom"
      ? slot.character
      : charactersById.get(slot.characterId) ?? null;

  if (!character) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-red-300">
          Slot {idx + 1}: missing character{" "}
          <code className="text-xs">
            {slot.kind === "module" ? slot.characterId : "?"}
          </code>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/65 hover:bg-ink/50"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className="cursor-grab select-none text-parchment/40"
        title="Drag to reorder"
        aria-hidden
      >
        ⋮⋮
      </div>
      <SpritePortrait sprite={character.sprite} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg text-parchment">
            {character.name}
          </span>
          {idx === 0 ? (
            <span className="rounded border border-ember/60 bg-ember/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ember">
              Lead
            </span>
          ) : null}
          {slot.kind === "custom" ? (
            <span className="rounded border border-parchment/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/55">
              New
            </span>
          ) : null}
        </div>
        <div className="text-xs text-parchment/65">
          Lv {character.level} {character.race} {character.class}
        </div>
        <div className="mt-1 text-xs text-parchment/45">
          HP {character.hp} · MP {character.mp} · STR {character.strength} DEX{" "}
          {character.dexterity} CON {character.constitution} INT{" "}
          {character.intelligence} WIS {character.wisdom}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-parchment/20 px-3 py-1 text-xs text-parchment/65 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
      >
        Remove
      </button>
    </div>
  );
}

/** A row inside the Available Characters pool. Same portrait +
 *  summary footprint as a party row, but with an Add button instead
 *  of drag + Remove. The "Custom" badge differentiates player-rolled
 *  characters from the module's roster so the player remembers which
 *  ones they made. */
function AvailableRow({
  character,
  origin,
  canAdd,
  onAdd,
}: {
  character: CharacterRecord;
  origin: "module" | "custom";
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <SpritePortrait sprite={character.sprite} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg text-parchment">
            {character.name}
          </span>
          {origin === "custom" ? (
            <span className="rounded border border-parchment/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-parchment/55">
              Custom
            </span>
          ) : null}
        </div>
        <div className="text-xs text-parchment/65">
          Lv {character.level} {character.race} {character.class}
        </div>
        <div className="mt-1 text-xs text-parchment/45">
          HP {character.hp} · MP {character.mp} · STR {character.strength} DEX{" "}
          {character.dexterity} CON {character.constitution} INT{" "}
          {character.intelligence} WIS {character.wisdom}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="rounded border border-ember/60 bg-ember/15 px-3 py-1 text-xs text-parchment hover:bg-ember/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add to party
      </button>
    </div>
  );
}

function SpritePortrait({ sprite }: { sprite?: string }) {
  if (!sprite) {
    return (
      <div className="h-12 w-12 rounded border border-parchment/15 bg-ink/60" />
    );
  }
  // Sprites live under /sprites/. Bare keys ("person/foo.png") get
  // the prefix; anything starting with / passes through.
  const url = sprite.startsWith("/")
    ? withBasePath(sprite)
    : withBasePath(`/sprites/${sprite}`);
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      width={48}
      height={48}
      className="h-12 w-12 rounded border border-parchment/15 bg-ink/60"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
