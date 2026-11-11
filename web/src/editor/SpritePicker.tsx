"use client";

/**
 * Sprite picker — embedded into RecordForm fields whose key matches
 * a known sprite-field (Characters.sprite, Monsters.sprite,
 * MapTiles.sprite, Items.icon, Encounters.monster_party_tile,
 * Party.avatar, Quest.quest_giver.npc_sprite). Also usable as a
 * standalone component by passing `config` explicitly — that's how
 * QuestsBrowse renders the npc_sprite field outside of RecordForm.
 *
 * Layout:
 *   [ thumb ] [ text input ] [ Pick… / Done ] [ ✕ clear ]
 *   (expands when open) ┌─ filter bar + collapsible sprite folder tree ─┐
 *
 * Click a sprite tile → field value becomes the canonical form
 * (category/file.png for "path" fields, just the stem for "icon").
 * Existing legacy values stay editable; the picker just makes new
 * choices easy and consistent.
 */

import { useEffect, useState } from "react";
import {
  formatPickedValue,
  resolveSpritePath,
  type SpriteFieldConfig,
} from "./spriteFields";
import { spriteUrl, fetchSpriteCatalog } from "@/data_model/spriteUrl";
import {
  SpriteFolderTree,
  TreeToggleAll,
  useCollapsedFolders,
} from "./SpriteFolderTree";
import { allFolderPaths, buildSpriteTree } from "./spriteTree";
import {
  SPRITE_TAG_CATEGORIES,
  spriteDisplayName,
  spriteTags,
} from "@/data_model/spriteTags";

interface SpriteIndex {
  _comment?: string;
  categories: Record<string, string[]>;
}

type IndexState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; index: SpriteIndex }
  | { kind: "error"; message: string };

export function SpritePicker({
  value,
  config,
  onChange,
}: {
  value: string;
  config: SpriteFieldConfig;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [indexState, setIndexState] = useState<IndexState>({ kind: "idle" });
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open || indexState.kind !== "idle") return;
    setIndexState({ kind: "loading" });
    fetchSpriteCatalog()
      .then((index) => setIndexState({ kind: "ok", index }))
      .catch((e: unknown) =>
        setIndexState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [open, indexState.kind]);

  const thumbSrc = resolveSpritePath(value, config);
  const [thumbBroken, setThumbBroken] = useState(false);
  useEffect(() => {
    setThumbBroken(false);
  }, [thumbSrc]);

  const handlePick = (category: string, filename: string) => {
    onChange(formatPickedValue(category, filename, config));
    setOpen(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative h-9 w-9 shrink-0 rounded border border-parchment/20 bg-ink/80">
          {thumbSrc && !thumbBroken ? (
            <img
              src={thumbSrc}
              alt=""
              width={36}
              height={36}
              style={{ imageRendering: "pixelated" }}
              className="h-9 w-9 object-contain"
              onError={() => setThumbBroken(true)}
            />
          ) : null}
        </div>
        {thumbSrc ? (
          <CurrentSpriteName value={value} />
        ) : null}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            config.format === "stem"
              ? `e.g., ${config.category}/<stem>`
              : `${config.category}/<file>.png`
          }
          className="flex-1 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment placeholder:text-parchment/50 focus:border-parchment/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/30 px-2 py-1 text-[13px] text-parchment/85 hover:bg-ink/40"
        >
          {open ? "Done" : "Pick…"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-[13px] text-parchment/80 hover:bg-ink/40"
            title="Clear this sprite reference"
          >
            ✕
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 rounded border border-parchment/15 bg-ink/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter by name…"
              className="flex-1 rounded border border-parchment/20 bg-ink/60 px-2 py-1 text-[13px] text-parchment placeholder:text-parchment/50 focus:border-parchment/60 focus:outline-none"
            />
            <span className="text-xs uppercase tracking-wide text-parchment/65">
              default: {config.category}
            </span>
          </div>

          {indexState.kind === "loading" ? (
            <p className="text-[13px] text-parchment/75">Loading sprites…</p>
          ) : indexState.kind === "error" ? (
            <p className="text-[13px] text-ember/80">
              Failed to load sprite index: {indexState.message}
            </p>
          ) : indexState.kind === "ok" ? (
            <SpriteGrid
              index={indexState.index}
              filter={filter.trim().toLowerCase()}
              preferredCategory={config.category}
              currentValue={value}
              onPick={handlePick}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Readable name of the currently chosen sprite ("Villager (Noble)" /
 *  "Elf · Male") so the author can tell what's picked without decoding
 *  the path in the text box. Hidden for names with no descriptors. */
function CurrentSpriteName({ value }: { value: string }) {
  if (spriteTags(value).length === 0) return null;
  const { label, sublabel } = spriteDisplayName(value);
  return (
    <div className="shrink-0 leading-tight" title={value}>
      <div className="text-[13px] text-parchment/90">{label}</div>
      {sublabel ? (
        <div className="text-xs text-parchment/60">{sublabel}</div>
      ) : null}
    </div>
  );
}

function SpriteGrid({
  index,
  filter,
  preferredCategory,
  currentValue,
  onPick,
}: {
  index: SpriteIndex;
  filter: string;
  preferredCategory: string;
  currentValue: string;
  onPick: (category: string, filename: string) => void;
}) {
  const collapsed = useCollapsedFolders("wilderstep.spritePicker.collapsed");
  /** Selected tag values per category ("Race" → {"Elf","Dwarf"}).
   *  OR within a category, AND across categories. */
  const [tagSel, setTagSel] = useState<Record<string, string[]>>({});
  /** Sprite under the pointer — shown in full in the detail bar. */
  const [hovered, setHovered] = useState<string | null>(null);
  const names = Object.keys(index.categories);
  // Reorder so the preferred category appears first; below that the
  // tree follows the sprites/ folder structure exactly.
  const ordered: Record<string, string[]> = {};
  for (const c of [
    ...(names.includes(preferredCategory) ? [preferredCategory] : []),
    ...names.filter((c) => c !== preferredCategory),
  ]) {
    ordered[c] = index.categories[c];
  }

  // Tag values available per category across every sprite.
  const available: [string, string[]][] = (() => {
    const by = new Map<string, Set<string>>();
    for (const [cat, files] of Object.entries(ordered)) {
      for (const f of files) {
        for (const t of spriteTags(`${cat}/${f}`)) {
          if (!by.has(t.category)) by.set(t.category, new Set());
          by.get(t.category)!.add(t.value);
        }
      }
    }
    return SPRITE_TAG_CATEGORIES.filter((c) => by.has(c)).map(
      (c): [string, string[]] => [c, [...by.get(c)!].sort()],
    );
  })();
  const activeTags = Object.entries(tagSel).filter(([, v]) => v.length > 0);
  const matchesTags = (path: string) => {
    if (activeTags.length === 0) return true;
    const tags = spriteTags(path);
    return activeTags.every(([cat, vals]) =>
      tags.some((t) => t.category === cat && vals.includes(t.value)),
    );
  };
  const matchesText = (path: string) => {
    if (!filter) return true;
    const { label, sublabel } = spriteDisplayName(path);
    return `${path} ${label} ${sublabel}`.toLowerCase().includes(filter);
  };
  const toggleTag = (cat: string, val: string) =>
    setTagSel((prev) => {
      const cur = prev[cat] ?? [];
      return {
        ...prev,
        [cat]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val],
      };
    });

  const fullTree = buildSpriteTree(ordered);
  const tree = buildSpriteTree(
    ordered,
    (path) => matchesText(path) && matchesTags(path),
  );
  const hoveredName = hovered ? spriteDisplayName(hovered) : null;

  return (
    <div>
      {available.length > 0 ? (
        <div className="mb-2 space-y-1 rounded border border-parchment/10 bg-ink/30 p-2">
          {available.map(([cat, vals]) => (
            <div key={cat} className="flex flex-wrap items-center gap-1">
              <span className="w-14 shrink-0 text-xs uppercase tracking-wide text-parchment/60">
                {cat}
              </span>
              {vals.map((v) => {
                const on = (tagSel[cat] ?? []).includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleTag(cat, v)}
                    aria-pressed={on}
                    className={`rounded border px-1.5 py-0.5 text-xs transition ${
                      on
                        ? "border-ember/60 bg-ember/25 text-parchment"
                        : "border-parchment/15 text-parchment/75 hover:border-parchment/40 hover:text-parchment"
                    }`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          ))}
          {activeTags.length > 0 ? (
            <button
              type="button"
              onClick={() => setTagSel({})}
              className="text-xs text-parchment/70 underline hover:text-parchment"
            >
              Clear tag filters
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs text-parchment/80" aria-live="polite">
          {hovered && hoveredName ? (
            <>
              <span className="text-parchment">{hoveredName.label}</span>
              {hoveredName.sublabel ? (
                <span className="text-parchment/60"> · {hoveredName.sublabel}</span>
              ) : null}
              <span className="ml-2 font-mono text-parchment/50">{hovered}</span>
            </>
          ) : (
            <span className="text-parchment/45">Hover a sprite to see its full name</span>
          )}
        </div>
        <TreeToggleAll
          onExpand={() => collapsed.setMany(allFolderPaths(fullTree), false)}
          onCollapse={() => collapsed.setMany(allFolderPaths(fullTree), true)}
        />
      </div>
      <div className="max-h-[28rem] overflow-auto pr-1" onMouseLeave={() => setHovered(null)}>
        <SpriteFolderTree
          root={tree}
          totals={fullTree}
          collapsed={collapsed}
          forceOpen={filter.length > 0 || activeTags.length > 0}
          compact
          gridClassName="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5"
          renderSprite={(path) => {
            const slash = path.indexOf("/");
            const cat = path.slice(0, slash);
            const file = path.slice(slash + 1);
            const stem = file
              .slice(file.lastIndexOf("/") + 1)
              .replace(/\.[a-z]+$/i, "");
            const { label, sublabel } = spriteDisplayName(path);
            // Mark the current selection if either format matches.
            const isCurrent =
              currentValue === path ||
              currentValue === stem ||
              currentValue === `game/${path}` ||
              (currentValue.includes("/") && currentValue.endsWith(`/${file}`));
            return (
              <button
                type="button"
                onClick={() => onPick(cat, file)}
                onMouseEnter={() => setHovered(path)}
                onFocus={() => setHovered(path)}
                className={`flex h-full w-full flex-col items-center gap-0.5 rounded border p-1 transition ${
                  isCurrent
                    ? "border-ember/60 bg-ember/15"
                    : "border-parchment/10 bg-ink/40 hover:border-parchment/40 hover:bg-ink/60"
                }`}
                title={path}
              >
                <img
                  src={spriteUrl(path)}
                  alt={file}
                  width={40}
                  height={40}
                  style={{ imageRendering: "pixelated" }}
                  className="h-10 w-10 object-contain"
                />
                <span className="line-clamp-2 w-full break-words text-center text-xs leading-tight text-parchment/85">
                  {label}
                </span>
                {sublabel ? (
                  <span className="w-full truncate text-center text-[11px] leading-tight text-parchment/55">
                    {sublabel}
                  </span>
                ) : null}
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}
