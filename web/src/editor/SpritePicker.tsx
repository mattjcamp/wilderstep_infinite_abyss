"use client";

/**
 * Sprite picker — embedded into RecordForm fields whose key matches
 * a known sprite-field (Characters.sprite, Monsters.sprite,
 * MapTiles.sprite, Items.icon, Encounters.monster_party_tile, Party.avatar).
 *
 * Layout:
 *   [ thumb ] [ text input ] [ Pick… / Done ] [ ✕ clear ]
 *   (expands when open) ┌─ filter bar + sprite grid grouped by category ─┐
 *
 * Click a sprite tile → field value becomes the canonical form
 * (category/file.png for "path" fields, just the stem for "icon").
 * Existing legacy values stay editable; the picker just makes new
 * choices easy and consistent.
 */

import { useEffect, useState } from "react";
import { withBasePath } from "@/util/basePath";
import {
  formatPickedValue,
  resolveSpritePath,
  type SpriteFieldConfig,
} from "./spriteFields";

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
    fetch(withBasePath("/sprites/index.json"))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SpriteIndex>;
      })
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
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            config.format === "stem"
              ? `e.g., ${config.category}/<stem>`
              : `${config.category}/<file>.png`
          }
          className="flex-1 rounded border border-parchment/20 bg-ink/40 px-2 py-1 text-sm text-parchment placeholder:text-parchment/30 focus:border-parchment/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded border border-parchment/30 px-2 py-1 text-xs text-parchment/85 hover:bg-ink/40"
        >
          {open ? "Done" : "Pick…"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-parchment/20 px-2 py-1 text-xs text-parchment/60 hover:bg-ink/40"
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
              className="flex-1 rounded border border-parchment/20 bg-ink/60 px-2 py-1 text-xs text-parchment placeholder:text-parchment/30 focus:border-parchment/60 focus:outline-none"
            />
            <span className="text-[10px] uppercase tracking-wide text-parchment/45">
              default: {config.category}
            </span>
          </div>

          {indexState.kind === "loading" ? (
            <p className="text-xs text-parchment/55">Loading sprites…</p>
          ) : indexState.kind === "error" ? (
            <p className="text-xs text-ember/80">
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
  const categories = Object.keys(index.categories);
  // Reorder so the preferred category appears first.
  const ordered = [
    ...(categories.includes(preferredCategory) ? [preferredCategory] : []),
    ...categories.filter((c) => c !== preferredCategory),
  ];

  return (
    <div className="max-h-96 overflow-auto pr-1">
      <div className="space-y-3">
        {ordered.map((cat) => {
          const files = index.categories[cat];
          const filtered = filter
            ? files.filter((f) => f.toLowerCase().includes(filter))
            : files;
          if (filtered.length === 0) return null;
          return (
            <section key={cat}>
              <h3 className="mb-1 text-[10px] uppercase tracking-wide text-parchment/45">
                {cat} · {filtered.length}
                {filtered.length !== files.length ? ` of ${files.length}` : ""}
              </h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
                {filtered.map((file) => {
                  const path = `${cat}/${file}`;
                  const stem = file.replace(/\.[a-z]+$/i, "");
                  // Mark the current selection if either format matches.
                  const isCurrent =
                    currentValue === path ||
                    currentValue === stem ||
                    currentValue === `game/${path}` ||
                    (currentValue.includes("/") &&
                      currentValue.endsWith(`/${file}`));
                  return (
                    <li key={path}>
                      <button
                        type="button"
                        onClick={() => onPick(cat, file)}
                        className={`flex w-full flex-col items-center gap-0.5 rounded border p-1 transition ${
                          isCurrent
                            ? "border-ember/60 bg-ember/15"
                            : "border-parchment/10 bg-ink/40 hover:border-parchment/40 hover:bg-ink/60"
                        }`}
                        title={`${cat}/${file}`}
                      >
                        <img
                          src={withBasePath(`/sprites/${cat}/${file}`)}
                          alt={file}
                          width={40}
                          height={40}
                          style={{ imageRendering: "pixelated" }}
                          className="h-10 w-10 object-contain"
                        />
                        <span className="w-full truncate text-[10px] text-parchment/65">
                          {stem}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
