"use client";

/**
 * Party-specific browse view. Dispatched to from
 * /editor/[moduleId]/[modelKey] when modelKey === "party".
 *
 * The in-game <PartyScreen> preview is the *primary* view — same
 * component the map simulator pops up with `P` — and it doubles as the
 * editor: with the `editor` handlers wired, the roster pane gets add /
 * remove controls for characters and the inventory pane gets add /
 * remove / quantity controls for the shared stash. Roster cards can
 * still be dragged to reorder. Below it, <PartyAttributesEditor> covers
 * the rest of the singleton (start position, avatar, gold, light
 * steps, starting party effects). The raw JSON <ModelView> stays one
 * click away behind "Edit JSON".
 *
 * Persistence: every edit patches the module's OWN party file (not the
 * merged view) and writes it as the module's party draft — the same
 * localStorage draft the JSON editor reads and Export publishes. In a
 * module that extends another, untouched fields keep inheriting.
 *
 * The EFFECTS pane's toggles stay a preview (they also cover item
 * actions like Light Torch / Camp); they start from the party's
 * `party_effects`. The persisted starting effects are edited in the
 * attributes panel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadDraft, saveDraft } from "@/data_model/draft";
import { mergeModel } from "@/data_model/merge";
import { getEditorModuleSource } from "@/data_model/sourceConfig";
import { ModelView } from "./ModelView";
import {
  PartyAttributesEditor,
  type PartyMapRef,
} from "./PartyAttributesEditor";
import {
  PartyScreen,
  type PartyAbilityRef,
  type PartyCharacterRef,
  type PartyClassRef,
  type PartyItemRef,
  type PartyRaceRef,
  type PartyRecord,
  type PartyScreenEditorHandlers,
  type PartySpellRef,
} from "./PartyScreen";

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      /** Inherited party (from the module this one extends), or null. */
      inherited: PartyRecord | null;
      /** This module's own party file (draft if one exists), or null. */
      own: PartyRecord | null;
      characters: PartyCharacterRef[];
      races: PartyRaceRef[];
      classes: PartyClassRef[];
      abilities: PartyAbilityRef[];
      items: PartyItemRef[];
      spells: PartySpellRef[];
      maps: PartyMapRef[];
    }
  | { kind: "error"; message: string };

/** Party is a singleton: shallow field-level merge (collectionKey null). */
function effectiveParty(
  inherited: PartyRecord | null,
  own: PartyRecord | null,
): PartyRecord {
  return (mergeModel(null, inherited, own) as PartyRecord | null) ?? {};
}

export function PartyBrowse({ moduleId }: { moduleId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  /** Which effects the preview shows as active. Seeded from the
   *  party's `party_effects` on load; toggling in the pane is preview
   *  only (see file header). */
  const [activeEffectIds, setActiveEffectIds] = useState<
    ReadonlyArray<string>
  >([]);
  /** True when the raw JSON / inheritance editor is expanded. */
  const [editing, setEditing] = useState(false);
  /** Bumped on every visual edit so the JSON editor remounts and
   *  re-reads the draft instead of showing a stale copy. */
  const [draftVersion, setDraftVersion] = useState(0);
  /** Bumped when the JSON editor closes so the preview re-reads any
   *  edits made there. */
  const [reloadKey, setReloadKey] = useState(0);

  /** Apply `fn` to the module's own party record, persist it as the
   *  draft, and update the preview in place.
   *
   *  `saveDraft` is async (gzip). We compute the next state inside the
   *  updater, fire-and-forget the persist, and return synchronously —
   *  in-memory state is the UI's source of truth; the draft is for
   *  navigation survival and Export. */
  const updateOwn = useCallback(
    (fn: (own: PartyRecord, effective: PartyRecord) => PartyRecord) => {
      setState((prev) => {
        if (prev.kind !== "ok") return prev;
        const effective = effectiveParty(prev.inherited, prev.own);
        const nextOwn = fn({ ...(prev.own ?? {}) }, effective);
        void saveDraft(
          moduleId,
          "party",
          nextOwn as unknown as Record<string, unknown>,
        );
        return { ...prev, own: nextOwn };
      });
      setDraftVersion((v) => v + 1);
    },
    [moduleId],
  );

  const onReorderRoster = useCallback(
    (newOrder: string[]) => updateOwn((own) => ({ ...own, roster: newOrder })),
    [updateOwn],
  );

  const editorHandlers = useMemo<PartyScreenEditorHandlers>(() => {
    const itemById = new Map(
      (state.kind === "ok" ? state.items : []).map((i) => [i.id, i]),
    );
    return {
      onAddRosterMember: (id) =>
        updateOwn((own, eff) => {
          const roster = eff.roster ?? [];
          return roster.includes(id) ? own : { ...own, roster: [...roster, id] };
        }),
      onRemoveRosterMember: (id) =>
        updateOwn((own, eff) => ({
          ...own,
          roster: (eff.roster ?? []).filter((r) => r !== id),
        })),
      onAddStashItem: (itemId) =>
        updateOwn((own, eff) => {
          const inv = [...(eff.inventory ?? [])];
          const cat = itemById.get(itemId);
          // Stackable items merge into an existing stack.
          const existing = cat?.stackable
            ? inv.findIndex((e) => e.item === itemId)
            : -1;
          if (existing >= 0) {
            const e = inv[existing];
            inv[existing] = {
              ...e,
              charges: (typeof e.charges === "number" ? e.charges : 1) + 1,
            };
          } else {
            inv.push(
              cat?.stackable
                ? { item: itemId, charges: 1 }
                : typeof cat?.charges === "number"
                  ? { item: itemId, charges: cat.charges }
                  : { item: itemId },
            );
          }
          return { ...own, inventory: inv };
        }),
      onRemoveStashItem: (invIdx) =>
        updateOwn((own, eff) => ({
          ...own,
          inventory: (eff.inventory ?? []).filter((_, i) => i !== invIdx),
        })),
      onSetStashCharges: (invIdx, charges) =>
        updateOwn((own, eff) => ({
          ...own,
          inventory: (eff.inventory ?? []).map((e, i) =>
            i === invIdx ? { ...e, charges } : e,
          ),
        })),
    };
  }, [state, updateOwn]);

  const onSetAttribute = useCallback(
    (key: string, value: unknown) => {
      updateOwn((own) => ({ ...own, [key]: value }));
      if (key === "party_effects" && Array.isArray(value)) {
        setActiveEffectIds(value as string[]);
      }
    },
    [updateOwn],
  );
  const onResetAttribute = useCallback(
    (key: string) => {
      updateOwn((own) => {
        const next = { ...own };
        delete next[key];
        return next;
      });
    },
    [updateOwn],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = getEditorModuleSource();
        const [
          partyLayers,
          charactersLayers,
          racesLayers,
          classesLayers,
          abilitiesLayers,
          itemsLayers,
          spellsLayers,
          mapsLayers,
        ] = await Promise.all([
          src.loadModelLayers(moduleId, "party"),
          src.loadModelLayers(moduleId, "characters"),
          src.loadModelLayers(moduleId, "races"),
          src.loadModelLayers(moduleId, "character_classes"),
          src.loadModelLayers(moduleId, "abilities"),
          src.loadModelLayers(moduleId, "items"),
          src.loadModelLayers(moduleId, "spells"),
          src.loadModelLayers(moduleId, "maps"),
        ]);
        if (cancelled) return;

        // Draft overrides the on-disk own file, so in-screen edits
        // survive navigation until the user exports.
        const partyDraft = await loadDraft<Record<string, unknown>>(
          moduleId,
          "party",
        );
        const own = ((partyDraft ?? partyLayers.ownFile) ??
          null) as PartyRecord | null;
        const inherited = (partyLayers.inherited ?? null) as PartyRecord | null;
        const list = <T,>(
          key: string,
          layers: { inherited: unknown; ownFile: unknown },
        ): T[] =>
          ((mergeModel(key, layers.inherited, layers.ownFile) as Record<
            string,
            unknown
          > | null)?.[key] as T[] | undefined) ?? [];

        const maps = list<PartyMapRef>("maps", mapsLayers).map((m) => ({
          id: m.id,
          name: m.name,
          tags: m.tags,
          width: m.width,
          height: m.height,
        }));

        setState({
          kind: "ok",
          inherited,
          own,
          characters: list<PartyCharacterRef>("characters", charactersLayers),
          races: list<PartyRaceRef>("races", racesLayers),
          classes: list<PartyClassRef>("character_classes", classesLayers),
          abilities: list<PartyAbilityRef>("abilities", abilitiesLayers),
          items: list<PartyItemRef>("items", itemsLayers),
          spells: list<PartySpellRef>("spells", spellsLayers),
          maps,
        });
        setActiveEffectIds(
          effectiveParty(inherited, own).party_effects ?? [],
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
  }, [moduleId, reloadKey]);

  const party =
    state.kind === "ok" ? effectiveParty(state.inherited, state.own) : null;
  const ownKeys = useMemo(
    () => new Set(state.kind === "ok" ? Object.keys(state.own ?? {}) : []),
    [state],
  );

  return (
    <div className="space-y-4 p-4">
      {/* PRIMARY — in-game P screen, editable in place. */}
      <section>
        <header className="mb-2 flex items-center justify-between gap-3 px-1">
          <h2 className="font-display text-lg text-parchment">
            In-Game Party Screen{" "}
            <span className="text-[13px] text-parchment/70">
              (same component the map simulator pops up with{" "}
              <kbd className="rounded border border-parchment/30 px-1">
                P
              </kbd>
              ) — add, remove, and drag to edit
            </span>
          </h2>
          <button
            type="button"
            onClick={() => {
              // Closing the JSON editor: re-read the draft so edits
              // made there show up in the preview.
              if (editing) setReloadKey((k) => k + 1);
              setEditing((v) => !v);
            }}
            aria-expanded={editing}
            className={[
              "rounded border px-3 py-1 text-sm",
              editing
                ? "border-ember/60 bg-ember/30 text-parchment hover:bg-ember/50"
                : "border-parchment/30 text-parchment/85 hover:bg-ink/40",
            ].join(" ")}
            title="Open the raw JSON / inheritance editor"
          >
            {editing ? "Close Edit" : "Edit JSON"}
          </button>
        </header>
        {state.kind === "loading" ? (
          <p className="px-1 text-sm text-parchment/75">Loading party…</p>
        ) : state.kind === "error" ? (
          <p className="px-1 text-sm text-ember">
            Failed to load party preview: {state.message}
          </p>
        ) : (
          <div className="space-y-3">
            <PartyScreen
              party={party!}
              characters={state.characters}
              races={state.races}
              classes={state.classes}
              abilities={state.abilities}
              items={state.items}
              spells={state.spells}
              activeEffectIds={activeEffectIds}
              onActiveEffectsChange={setActiveEffectIds}
              onReorderRoster={onReorderRoster}
              editor={editorHandlers}
            />
            <PartyAttributesEditor
              party={party!}
              ownKeys={ownKeys}
              hasParent={state.inherited !== null}
              maps={state.maps}
              abilities={state.abilities}
              onSet={onSetAttribute}
              onReset={onResetAttribute}
            />
          </div>
        )}
      </section>

      {/* SECONDARY — raw JSON / inheritance editor. Remounted after
          each visual edit so it shows the current draft. */}
      {editing ? (
        <section className="rounded border border-parchment/15 bg-ink/30">
          <ModelView
            key={draftVersion}
            moduleId={moduleId}
            modelKey="party"
          />
        </section>
      ) : null}
    </div>
  );
}
