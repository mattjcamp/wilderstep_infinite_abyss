"use client";

/**
 * RecordPickerField — a trigger button + large centred dialog for
 * picking one record by id (item, NPC, counter, quest, dungeon, trap,
 * lore …). Replaces the Map editor inspector's plain <select>s with
 * the same dialog the Link map picker uses: search, collapsible
 * groups, sprite thumbnails, and a "(none)" row.
 */

import { useMemo, useState } from "react";
import {
  matchesQuery,
  PickerDialogFrame,
  PickerToolbarButton,
} from "./PickerDialog";

export interface RecordPickerOption {
  value: string;
  /** Display name (falls back to `label`, then `value`). */
  name?: string;
  /** Full label — still used for the "palette:" line elsewhere. */
  label: string;
  /** Sprite URL for the row thumbnail. */
  thumb?: string | null;
  /** Extra searchable / dim text (tags, kind …). */
  detail?: string;
}

export interface RecordPickerGroup {
  label: string;
  options: RecordPickerOption[];
}

export function RecordPickerField({
  title,
  value,
  options,
  groups,
  noun = "record",
  onChange,
}: {
  title: string;
  value: string;
  /** Ungrouped options. A "" option is treated as the "(none)" row. */
  options: RecordPickerOption[];
  groups?: RecordPickerGroup[];
  /** "item" → "12 items" in the header. */
  noun?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = useMemo(
    () => [...options, ...(groups?.flatMap((g) => g.options) ?? [])],
    [options, groups],
  );
  const current = value ? all.find((o) => o.value === value) ?? null : null;

  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={value ? `${title} — currently ${value}` : title}
        className="flex min-w-0 flex-1 items-center gap-2 rounded border border-parchment/20 bg-ink/50 px-2 py-1 text-left text-sm text-parchment/90 hover:border-parchment/50 hover:bg-ink/70 focus:border-parchment/60 focus:outline-none"
      >
        {current?.thumb ? <Thumb src={current.thumb} size={24} /> : null}
        {!value ? (
          <span className="truncate text-parchment/60">(none)</span>
        ) : current ? (
          <span className="min-w-0 flex-1 truncate">
            <span>{current.name ?? current.label}</span>
            {current.name ? (
              <span className="ml-1.5 font-mono text-[12px] text-parchment/60">
                {current.value}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ember/90">
            (missing) <span className="font-mono">{value}</span> ⚠
          </span>
        )}
        <span aria-hidden className="ml-auto shrink-0 text-parchment/50">
          ⋯
        </span>
      </button>
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 rounded border border-parchment/20 px-2 text-[13px] text-parchment/80 hover:bg-ink/40"
          title="Clear"
        >
          ✕
        </button>
      ) : null}
      {open ? (
        <RecordPickerDialog
          title={title}
          value={value}
          options={options}
          groups={groups}
          noun={noun}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function RecordPickerDialog({
  title,
  value,
  options,
  groups,
  noun,
  onPick,
  onClose,
}: {
  title: string;
  value: string;
  options: RecordPickerOption[];
  groups?: RecordPickerGroup[];
  noun: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const noneOpt = options.find((o) => o.value === "");
  const flat = options.filter((o) => o.value !== "");
  const total = flat.length + (groups?.reduce((n, g) => n + g.options.length, 0) ?? 0);
  const q = query.trim();
  const match = (o: RecordPickerOption) =>
    matchesQuery(`${o.name ?? ""} ${o.label} ${o.value} ${o.detail ?? ""}`, q);

  const shownFlat = flat.filter(match);
  const shownGroups = (groups ?? [])
    .map((g) => ({ ...g, options: g.options.filter(match) }))
    .filter((g) => g.options.length > 0);
  const shownCount =
    shownFlat.length + shownGroups.reduce((n, g) => n + g.options.length, 0);

  // Groups start collapsed except the one holding the current value.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const g = groups?.find((gr) => gr.options.some((o) => o.value === value));
    return new Set(g ? [g.label] : []);
  });
  const isOpen = (label: string) => q.length > 0 || openGroups.has(label);
  const toggle = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const single =
    shownCount === 1
      ? (shownFlat[0] ?? shownGroups[0]?.options[0])?.value
      : undefined;
  const plural = total === 1 ? noun : `${noun}s`;

  return (
    <PickerDialogFrame
      title={title}
      count={q ? `${shownCount} of ${total} ${plural}` : `${total} ${plural}`}
      search={query}
      onSearch={setQuery}
      searchPlaceholder={`Search ${noun} name or id…`}
      onSearchEnter={single !== undefined ? () => onPick(single) : undefined}
      onClose={onClose}
      toolbar={
        groups && groups.length > 0 ? (
          <>
            <PickerToolbarButton
              onClick={() => setOpenGroups(new Set(groups.map((g) => g.label)))}
              disabled={q.length > 0}
            >
              Expand all
            </PickerToolbarButton>
            <PickerToolbarButton
              onClick={() => setOpenGroups(new Set())}
              disabled={q.length > 0}
            >
              Collapse all
            </PickerToolbarButton>
          </>
        ) : null
      }
    >
      {noneOpt ? (
        <button
          type="button"
          onClick={() => onPick("")}
          className={`mb-3 flex w-full items-baseline gap-2 rounded border px-3 py-2 text-left text-sm ${
            value === ""
              ? "border-ember/60 bg-ember/25 text-parchment"
              : "border-parchment/10 bg-ink/20 text-parchment/85 hover:border-parchment/40 hover:bg-ink/50"
          }`}
        >
          <span className="font-mono">{noneOpt.label}</span>
        </button>
      ) : null}
      {value && !options.concat(groups?.flatMap((g) => g.options) ?? []).some((o) => o.value === value) ? (
        <p className="mb-3 rounded border border-ember/40 bg-ember/10 px-3 py-2 text-[13px] text-parchment/85">
          Current value <span className="font-mono">{value}</span> isn&apos;t in
          this module.
        </p>
      ) : null}
      {shownCount === 0 ? (
        <p className="text-sm text-parchment/65">
          {q ? `No ${plural} match “${q}”.` : `No ${plural} in this module.`}
        </p>
      ) : (
        <div className="space-y-2">
          {shownFlat.length > 0 ? (
            <Rows options={shownFlat} value={value} onPick={onPick} />
          ) : null}
          {shownGroups.map((g) => {
            const open = isOpen(g.label);
            const holdsCurrent = g.options.some((o) => o.value === value);
            return (
              <section key={g.label}>
                <button
                  type="button"
                  onClick={() => toggle(g.label)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[13px] uppercase tracking-wide text-parchment/70 hover:bg-ink/40 hover:text-parchment/90"
                >
                  <span className="text-parchment/75">{open ? "▾" : "▸"}</span>
                  <span className="truncate">{g.label}</span>
                  <span className="normal-case tracking-normal text-parchment/55">
                    ({g.options.length})
                  </span>
                  {holdsCurrent && !open ? (
                    <span className="normal-case tracking-normal text-ember/80">
                      · current
                    </span>
                  ) : null}
                </button>
                {open ? (
                  <div className="mt-1">
                    <Rows options={g.options} value={value} onPick={onPick} />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </PickerDialogFrame>
  );
}

function Rows({
  options,
  value,
  onPick,
}: {
  options: RecordPickerOption[];
  value: string;
  onPick: (v: string) => void;
}) {
  const hasThumbs = options.some((o) => o.thumb);
  return (
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded border border-parchment/10 bg-parchment/5 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <li key={o.value} className="bg-ink">
            <button
              type="button"
              onClick={() => onPick(o.value)}
              className={`flex h-full w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                active ? "bg-ember/25 text-parchment" : "text-parchment hover:bg-ink/60"
              }`}
              title={o.value}
            >
              {hasThumbs ? (
                o.thumb ? (
                  <Thumb src={o.thumb} size={32} />
                ) : (
                  <span className="inline-block h-8 w-8 shrink-0 rounded border border-dashed border-parchment/15" />
                )
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display">
                  {o.name ?? o.label}
                </span>
                <span className="block truncate font-mono text-[12px] text-parchment/55">
                  {o.value}
                  {o.detail ? (
                    <span className="ml-2 font-sans text-parchment/50">
                      {o.detail}
                    </span>
                  ) : null}
                </span>
              </span>
              {active ? (
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-ember/90">
                  current
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thumb({ src, size }: { src: string; size: 24 | 32 }) {
  const cls = size === 32 ? "h-8 w-8" : "h-6 w-6";
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ imageRendering: "pixelated" }}
      className={`${cls} shrink-0 rounded border border-parchment/15 bg-ink/40 object-contain`}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
