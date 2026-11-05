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
 * tutorial module doesn't strand the player. Begin stays disabled
 * until every slot is filled (a hover popover says how many more are
 * needed); players can always create characters to make up the rest.
 *
 * On "Begin", the assembled party (slot resolution + custom-character
 * records for any non-module slots) is stashed in sessionStorage so
 * the beginning-screen page can read it. Refreshing the page resets
 * the draft on purpose — it's a short flow, no need for persistence
 * across a hard reload.
 */

import { playBeginHref } from "@/play/playRoutes";
import { getModuleSource } from "@/data_model/sourceConfig";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampPartyNav,
  initialPartyNav,
  samePartyNav,
  stepPartyNav,
  type PartyNavCursor,
} from "@/play/partyFormationNav";
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
import { spriteUrl } from "@/data_model/spriteUrl";

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
    if (slots.length < partyCap) return; // a full party is required
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

  // ── Keyboard control ────────────────────────────────────────────
  // ↑/↓ or W/S (and ←/→ or A/D) walk one list of targets: Begin →
  // Create → party rows → available rows. Enter / Space acts on the
  // highlighted target: Begin begins, Create opens the creator, a
  // party row is removed (deselect), an available row joins the party
  // (select). Shift+↑/↓ (or Shift+W/S) moves a party member within the
  // marching order. The highlight only shows once the keyboard is
  // used, and hides again on mouse use, so mouse players never see a
  // stray outline. Disabled while the character creator is open so
  // typing a name (W, A, S, D…) works normally.
  const navCounts = {
    party: slots.length,
    avail: availableModule.length + availableCustom.length,
  };
  const [navCursor, setNavCursor] = useState<PartyNavCursor | null>(null);
  const [kbdActive, setKbdActive] = useState(false);
  const liveCursor: PartyNavCursor = clampPartyNav(
    navCursor ?? initialPartyNav(navCounts),
    navCounts,
  );
  const navFocused = (section: PartyNavCursor["section"], index = 0) =>
    kbdActive && samePartyNav(liveCursor, { section, index });

  const navActRef = useRef<(e: KeyboardEvent) => void>(() => {});
  navActRef.current = (e: KeyboardEvent) => {
    if (state.kind !== "ok" || creating) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.tagName === "SELECT" ||
        t.isContentEditable)
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const up = k === "ArrowUp" || k === "w" || k === "W";
    const down = k === "ArrowDown" || k === "s" || k === "S";
    const back = k === "ArrowLeft" || k === "a" || k === "A";
    const fwd = k === "ArrowRight" || k === "d" || k === "D";
    const act = k === "Enter" || k === " ";
    if (!(up || down || back || fwd || act)) return;
    e.preventDefault();
    if (!kbdActive) {
      // First key press just reveals the highlight where it is, so a
      // keystroke never acts on a target the player can't see yet.
      setKbdActive(true);
      return;
    }
    const cur = liveCursor;
    if ((up || down) && e.shiftKey && cur.section === "party") {
      const to = cur.index + (up ? -1 : 1);
      if (to < 0 || to >= slots.length) return;
      onReorder(cur.index, to);
      setNavCursor({ section: "party", index: to });
      return;
    }
    if (up || back) {
      setNavCursor(stepPartyNav(cur, -1, navCounts));
      return;
    }
    if (down || fwd) {
      setNavCursor(stepPartyNav(cur, 1, navCounts));
      return;
    }
    // Enter / Space
    if (cur.section === "begin") {
      onBegin();
    } else if (cur.section === "create") {
      setCreating(true);
    } else if (cur.section === "party") {
      onRemove(cur.index);
      setNavCursor(cur);
    } else {
      const i = cur.index;
      if (i < availableModule.length) onAddModule(availableModule[i].id);
      else {
        const rec = availableCustom[i - availableModule.length];
        if (rec) onAddCustom(rec);
      }
      setNavCursor(cur);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => navActRef.current(e);
    const onMouse = () => setKbdActive(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  }, []);
  // Keep the highlighted target on screen. Begin sits at the very top
  // of the page, so it scrolls the page all the way up (title, intro
  // and popover included). Everything else scrolls just enough, but
  // must clear the site's sticky header: a plain `scrollIntoView`
  // stops at the viewport edge, which is UNDER that header.
  useEffect(() => {
    if (!kbdActive) return;
    if (liveCursor.section === "begin") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.querySelector<HTMLElement>(
      '[data-party-nav-focused="true"]',
    );
    if (!el) return;
    const header = document.querySelector<HTMLElement>("header.sticky");
    const topInset = (header?.getBoundingClientRect().bottom ?? 0) + 16;
    const bottomInset = 16;
    const r = el.getBoundingClientRect();
    if (r.top < topInset) {
      window.scrollBy({ top: r.top - topInset, behavior: "smooth" });
    } else if (r.bottom > window.innerHeight - bottomInset) {
      window.scrollBy({
        top: r.bottom - (window.innerHeight - bottomInset),
        behavior: "smooth",
      });
    }
  }, [kbdActive, liveCursor.section, liveCursor.index]);

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
  const missing = partyCap - slots.length;
  const beginBlockedReason: string | null = creating
    ? "Finish creating your character first."
    : missing > 0
      ? `Add ${missing} more ${missing === 1 ? "character" : "characters"} to begin (${slots.length} / ${partyCap}).`
      : null;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-4xl text-parchment">Form Thy Party</h1>
          <p className="mt-1 text-base text-parchment/85">
            It&apos;s time to build a group of adventurers to travel with. You
            may choose from the list of available characters or you can create
            your own. Keep in mind that races and classes all have different
            abilities, strengths and weaknesses. Click &ldquo;Begin&rdquo; when
            you are ready to venture forth.
          </p>
          <p className="mt-2 text-sm text-parchment/60">
            Keyboard: ↑ ↓ (or W S) to move · Enter to add or remove ·
            Shift + ↑ ↓ to change marching order
          </p>
        </div>
        {/* Begin lives up here (next to the create CTA below) so it's
            obvious from the first screenful — players were missing it
            when it only sat in the footer below a long roster list.
            Disabled until every party slot is filled; the reason lives
            in a hover popover rather than a permanent line of text.
            The hover is on the WRAPPER — disabled buttons don't get
            pointer events in every browser. */}
        <div
          data-party-nav-focused={navFocused("begin") ? "true" : undefined}
          className={`group relative shrink-0 self-start rounded-md sm:self-auto ${
            navFocused("begin") ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-ink" : ""
          }`}
        >
          <button
            type="button"
            onClick={onBegin}
            disabled={beginBlockedReason !== null}
            aria-describedby={beginBlockedReason ? "begin-blocked-hint" : undefined}
            className="rounded-md border border-parchment/40 bg-ember/90 px-8 py-2 text-parchment shadow transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-40"
          >
            Begin →
          </button>
          {beginBlockedReason ? (
            <div
              id="begin-blocked-hint"
              role="tooltip"
              className={`pointer-events-none absolute right-0 top-full z-20 ${
                navFocused("begin") ? "visible opacity-100" : "invisible opacity-0"
              } mt-2 w-max max-w-[16rem] rounded-md border border-amber-300/40 bg-ink px-3 py-2 text-sm text-amber-100 shadow-lg shadow-black/50 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 sm:right-0 max-sm:left-0 max-sm:right-auto`}
            >
              {/* Arrow nub pointing up at the button. */}
              <span className="absolute -top-1.5 right-6 h-3 w-3 rotate-45 border-l border-t border-amber-300/40 bg-ink max-sm:left-6 max-sm:right-auto" />
              {beginBlockedReason}
            </div>
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
          <h2 className="mb-3 font-display text-xl text-parchment">
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
          data-party-nav-focused={navFocused("create") ? "true" : undefined}
          className={`flex items-center justify-between gap-4 rounded-md border-2 border-dashed border-ember/60 bg-ember/10 p-4 text-left transition hover:border-ember hover:bg-ember/20 ${
            navFocused("create") ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-ink" : ""
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-ember/60 bg-ember/20 text-2xl font-bold text-ember">
              +
            </div>
            <div>
              <div className="font-display text-xl text-parchment">
                Create a new character
              </div>
              <div className="text-sm text-parchment/85">
                Roll your own hero —{" "}
                {canAddMore
                  ? "they'll join the party automatically."
                  : "your party is full, so they'll land in the Available pool."}
              </div>
            </div>
          </div>
          <span className="rounded border border-ember/60 px-3 py-1 text-sm uppercase tracking-wide text-ember">
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
          <h2 className="font-display text-2xl text-parchment">
            Your Party
          </h2>
          <span className="text-sm text-parchment/75">
            {slots.length} / {partyCap}
            {slots.length > 0 ? " · drag to reorder" : ""}
          </span>
        </div>

        {slots.length === 0 ? (
          <div className="rounded-md border border-dashed border-parchment/20 bg-ink/30 p-6 text-center text-base text-parchment/75">
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
                  data-party-nav-focused={
                    navFocused("party", idx) ? "true" : undefined
                  }
                  className={`rounded-md border bg-ink/40 p-4 transition ${
                    navFocused("party", idx) ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-ink" : ""
                  } ${
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
            <h2 className="font-display text-2xl text-parchment">
              Available Characters
            </h2>
            {!canAddMore ? (
              <span className="text-sm text-amber-200/85">
                Party full — remove a member to add another.
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {availableModule.map((c, i) => (
              <li
                key={`avail-m-${c.id}`}
                data-party-nav-focused={
                  navFocused("avail", i) ? "true" : undefined
                }
                className={`rounded-md border border-parchment/15 bg-ink/30 p-4 ${
                  navFocused("avail", i) ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-ink" : ""
                }`}
              >
                <AvailableRow
                  character={c}
                  origin="module"
                  canAdd={canAddMore}
                  onAdd={() => onAddModule(c.id)}
                />
              </li>
            ))}
            {availableCustom.map((c, i) => (
              <li
                key={`avail-c-${c.id}`}
                data-party-nav-focused={
                  navFocused("avail", availableModule.length + i)
                    ? "true"
                    : undefined
                }
                className={`rounded-md border border-parchment/15 bg-ink/30 p-4 ${
                  navFocused("avail", availableModule.length + i) ? "ring-2 ring-amber-200 ring-offset-2 ring-offset-ink" : ""
                }`}
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
        <div className="text-base text-red-300">
          Slot {idx + 1}: missing character{" "}
          <code className="text-sm">
            {slot.kind === "module" ? slot.characterId : "?"}
          </code>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:bg-ink/50"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className="cursor-grab select-none text-parchment/60"
        title="Drag to reorder"
        aria-hidden
      >
        ⋮⋮
      </div>
      <SpritePortrait sprite={character.sprite} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-xl text-parchment">
            {character.name}
          </span>
          {idx === 0 ? (
            <span className="rounded border border-ember/60 bg-ember/15 px-1.5 py-0.5 text-xs uppercase tracking-wide text-ember">
              Lead
            </span>
          ) : null}
          {slot.kind === "custom" ? (
            <span className="rounded border border-parchment/25 px-1.5 py-0.5 text-xs uppercase tracking-wide text-parchment/75">
              New
            </span>
          ) : null}
        </div>
        <div className="text-sm text-parchment/85">
          Lv {character.level} {character.race} {character.class}
        </div>
        <div className="mt-1 text-sm text-parchment/70">
          HP {character.hp} · MP {character.mp} · STR {character.strength} DEX{" "}
          {character.dexterity} CON {character.constitution} INT{" "}
          {character.intelligence} WIS {character.wisdom}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-parchment/20 px-3 py-1 text-sm text-parchment/85 hover:border-ember/60 hover:bg-ember/30 hover:text-parchment"
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
          <span className="font-display text-xl text-parchment">
            {character.name}
          </span>
          {origin === "custom" ? (
            <span className="rounded border border-parchment/25 px-1.5 py-0.5 text-xs uppercase tracking-wide text-parchment/75">
              Custom
            </span>
          ) : null}
        </div>
        <div className="text-sm text-parchment/85">
          Lv {character.level} {character.race} {character.class}
        </div>
        <div className="mt-1 text-sm text-parchment/70">
          HP {character.hp} · MP {character.mp} · STR {character.strength} DEX{" "}
          {character.dexterity} CON {character.constitution} INT{" "}
          {character.intelligence} WIS {character.wisdom}
        </div>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={!canAdd}
        className="rounded border border-ember/60 bg-ember/15 px-3 py-1 text-sm text-parchment hover:bg-ember/30 disabled:cursor-not-allowed disabled:opacity-40"
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
    : spriteUrl(sprite);
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
