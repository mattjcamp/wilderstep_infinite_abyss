/**
 * Module quest data + runtime state.
 *
 * Authored quests live in the active module's `quests.json` (parsed
 * via {@link parseQuestsFile} / {@link loadQuests}); per-quest progress
 * lives on `gameState.moduleQuestStates`. The runtime surface here is
 * deliberately small — only the helpers the sim / scene / play host
 * actually call survive. The v1 string-keyed compat layer that used to
 * cover `quest_manager.py` shapes has been removed; modules now all
 * author the v2 structured form (`kind` + `location_kind` + per-kind
 * id fields).
 *
 * **Status lifecycle.**
 *   `available` → `active` (player accepted the quest)
 *                 → `completed` (every step's progress flag is true)
 *                                → `turned_in` (rewards claimed; terminal)
 *
 * **Step kinds.** The current runtime branches on four:
 *   - `"kill"` — defeat the named `encounter_id` at a location until
 *               the per-step `count` is reached.
 *   - `"retrieve"` — pick up `item_id` from the cell `(col, row)` on
 *               the step's `map_id`.
 *   - `"collect"` — legacy alias of retrieve kept on the enum so older
 *               quests.json that still uses `"collect"` hydrates; new
 *               authoring writes `"retrieve"`.
 *   - `"reach"` — credited simply by arriving on a dungeon floor that
 *               matches the step's `dungeon_id` + `dungeon_level`. The
 *               basis of "spelunking" quests: author ONE reach step
 *               with a `dungeon_id` and no level, and
 *               {@link expandSpelunkingQuests} fans it out into one
 *               reach step per floor of that dungeon.
 *
 *               **Instance scope (intentional):** a reach step targets
 *               the dungeon *record* (`dungeon_id`), NOT a specific
 *               placement. When a dungeon record is planted at two map
 *               entrances (two independent instances — own seed, layout,
 *               and explored state, keyed by entrance cell via
 *               `dungeonInstanceKey`), entering EITHER one credits the
 *               step. This matches the step's purpose ("get the party
 *               into a Grotto"), so it's by design rather than a gap.
 *               The schema has no per-instance reach target; if a quest
 *               ever needs "reach THIS Grotto specifically," that's a
 *               future schema addition (optional entrance map+cell on
 *               the step), not a behaviour the current model expresses.
 *
 * **Location matching.** Use {@link matchesLocation} — it consumes a
 * {@link CombatLocation} (`{ kind, mapId | dungeonId, dungeonLevel? }`)
 * and a step's structured fields. The legacy string matcher was
 * removed in the same cleanup pass that dropped the v1 surface.
 */

import { modulePath } from "./Module";
import { sampleEncounter, type EncounterTemplate } from "./Encounters";

export type QuestStatus = "available" | "active" | "completed" | "turned_in";
export type QuestStepKind = "kill" | "collect" | "retrieve" | "reach";

/** Where a step plays out in the v2 structured form. Empty means
 *  "any location credits the step." */
export type QuestLocationKind = "dungeon" | "map" | "";

export interface QuestStep {
  /** Stable per-step id, unique within the parent Quest's `steps[]`.
   *  In v2 JSON this is `step.id`. */
  id: string;
  /** Display name shown in the quest log for this step. */
  name: string;
  description: string;
  /** Editor-side organizational labels. Gameplay doesn't read them. */
  tags: string[];
  /** Discriminator for what the step is — `"kill"`, `"retrieve"`,
   *  `"collect"` (legacy alias of retrieve), or any future kind. Open
   *  enum; the runtime branches on known values and skips unknown ones. */
  kind: QuestStepKind;
  /** Free-form params blob the v2 JSON carries. The typed projections
   *  below (`encounterId`, `count`, `itemId`) cover the common shapes
   *  the kernel reads; `params` itself is preserved verbatim so
   *  per-step custom fields (e.g. `monster_id` on kill steps) can be
   *  consumed by call sites that cast through `as unknown`. */
  params: Record<string, unknown>;
  /** v2 structured location. Use {@link matchesLocation} to check
   *  whether a current combat location satisfies the step. */
  locationKind: QuestLocationKind;
  mapId: string;
  dungeonId: string;
  /** 1-based per the editor's "Level (1-based)" input. Undefined =
   *  any floor of the dungeon counts. */
  dungeonLevel?: number;
  /** Specific cell on the step's `mapId`. Required for `retrieve`
   *  steps (the cell the quest item appears on); ignored for other
   *  step kinds today. 0-based. JSON keys: `col`, `row`. */
  col: number;
  row: number;

  // ── Convenience projections of `params` for the common kinds ───
  /** For `kind === "kill"` — the encounter id (encounters.json `id`)
   *  the step wants cleared. */
  encounterId: string;
  /** For `kind === "kill"` (or any countable step) — how many
   *  encounter clearings to credit. Defaults to 1 when absent. */
  count: number;
  /** For `kind === "retrieve"` — item id to drop on the step's
   *  `(col, row)`. */
  itemId: string;

  /** For `kind === "kill"` — authored anchor cells the spawn pass
   *  uses for placement, in order. The kernel consumes
   *  `positions[0]` for the first copy, `positions[1]` for the second,
   *  and so on; copies beyond `positions.length` fall back to random
   *  walkable cells (the historical behaviour). A position is also
   *  skipped (and replaced by a random pick) when its cell isn't
   *  walkable at spawn time — defensive against the map evolving
   *  after the quest was authored. Empty array = pure random
   *  placement, matching how quests behaved before the field
   *  existed. Always populated; absent JSON hydrates as `[]`. */
  positions: ReadonlyArray<{ col: number; row: number }>;

  /** Per-step rewards. Always populated — absent JSON authors as
   *  `{ items: [], tileAdds: [] }` so callers don't need an
   *  undefined-guard. Applied IMMEDIATELY when the step's
   *  `stepProgress` flips true (see {@link QuestKillCredit.stepRewards}
   *  / {@link QuestRetrieveCredit.stepRewards}), which is the lever
   *  authors use to gate later steps on a map change or an item
   *  drop. */
  rewards: QuestStepRewards;
}

/** The v2 `quest_giver` envelope. The giver's *placement* lives on a
 *  map cell (via `cell.quest`) — not in the quest record. */
export interface QuestGiver {
  npcName: string;
  npcSprite: string;
  startDialog: string;
  endDialog: string;
}

/** A `tileAdds` reward — fully specifies a cell on a map and the
 *  palette tile that should occupy it after the quest is turned in.
 *
 *  This is the only tile-mutation reward shape: "set cell at (map,
 *  col, row) to `tile_id`". It covers both adding new tiles to empty
 *  cells AND replacing existing tiles, since both operations are
 *  mechanically identical — the cell becomes whatever the palette
 *  tile says it is, with the previous contents overwritten. */
export interface RewardTileAddOp {
  /** Target map id (maps.json). */
  map: string;
  col: number;
  row: number;
  /** Palette tile id (map_tiles.json) to copy into the cell. */
  tile_id: string;
}

/** The v2 `rewards` envelope. */
export interface QuestRewards {
  xp: number;
  gold: number;
  items: string[];
  /** Cells on named maps that should be painted with the named
   *  palette tile when this quest is turned in. Authors a "build the
   *  bridge after the quest" / "remove the rockslide" style mutation.
   *  Applied immediately if the player is on the affected map;
   *  persisted into save.maps[mapId].tileOverrides so the mutation
   *  survives reload + re-entry. */
  tileAdds: RewardTileAddOp[];
}

/** A step-scoped rewards envelope. Mirrors {@link QuestRewards} but
 *  intentionally narrowed: steps grant **items** and **tile mutations**
 *  only — XP and gold stay on the quest-level rewards so the bigger
 *  numerical payoff still arrives at turn-in. The runtime applies
 *  these IMMEDIATELY when the step's `stepProgress` flips from false
 *  to true (in contrast to {@link QuestRewards}, which only land at
 *  turn-in). That's the whole point of step rewards — they let the
 *  next step depend on a map change ("a bridge appears so the player
 *  can reach the next dungeon") or on an item the quest just handed
 *  out ("here's the key for the door the next step opens"). Always
 *  populated on a {@link QuestStep}; absent JSON authors as
 *  `{ items: [], tileAdds: [] }`. */
export interface QuestStepRewards {
  /** Item catalog ids granted to the party on step completion.
   *  Hosts merge into existing inventory stacks where stackable
   *  (same `addToInventory` path quest-level rewards use). */
  items: string[];
  /** Cells on named maps to paint with the named palette tile when
   *  the step completes. Same semantics as {@link QuestRewards.tileAdds}
   *  — recorded into `save.maps[mapId].tileOverrides` so the mutation
   *  survives reload + re-entry, and applied to the live grid when
   *  the player is on the affected map at completion time. */
  tileAdds: RewardTileAddOp[];
}

/** Builder for an empty {@link QuestStepRewards} payload. Used as the
 *  default when a step's JSON doesn't author a `rewards` block, so
 *  callers can read `step.rewards.items` / `step.rewards.tileAdds`
 *  without an undefined guard. */
function emptyStepRewards(): QuestStepRewards {
  return { items: [], tileAdds: [] };
}

export interface QuestDef {
  /** Stable Quest id from quests.json (e.g. `"rats"`). Primary key
   *  for runtime state lookup. */
  id: string;
  name: string;
  description: string;
  /** Editor-side organizational labels. */
  tags: string[];
  steps: QuestStep[];
  questGiver: QuestGiver;
  rewards: QuestRewards;
}

export interface QuestState {
  status: QuestStatus;
  /** One bool per step in the original definition. Auto-extended on
   *  load if the JSON gained extra steps after the save was written
   *  (matches the Python guard against mismatched step_progress). */
  stepProgress: boolean[];
  /** Per-kill-step counter so multi-target steps (e.g. "Wolves and
   *  Goblins ×3") report progress and complete on the right roll. */
  stepKills: Record<number, number>;
  /** Per-collect-step flag — true once the guardian protecting a
   *  collect step's artifact has been defeated. The interior /
   *  building-space spawn pass reads this to avoid re-spawning the
   *  guardian on every re-entry, which would otherwise leave the
   *  player in an endless-encounter loop the moment they killed the
   *  Cursed Battalion and walked back into the Abandoned Building.
   *  Indices not in the map default to "guardian still alive". */
  guardianDefeated: Record<number, boolean>;
}

interface RawQuestStep {
  id?: string;
  name?: string;
  description?: string;
  tags?: unknown;
  kind?: string;
  /** First-class step attribute for kill steps. */
  encounter_id?: string;
  count?: number | string;
  /** First-class step attribute for retrieve steps. */
  item_id?: string;
  /** Free-form params blob — preserved verbatim onto QuestStep.params
   *  for call sites that read kind-specific fields beyond what the
   *  parser projects. */
  params?: Record<string, unknown> | null;
  /** Per-step rewards block. Mirrors the quest-level `rewards`
   *  envelope but only honors `items` and `tile_add` — XP/gold are
   *  not authored at the step level (see {@link QuestStepRewards}).
   *  Optional; absent in fixtures that predate the step-rewards
   *  feature. */
  rewards?: RawStepRewards | null;
  /** Authored anchor cells for `kind === "kill"` placement. Each
   *  entry is `{ col, row }` on the step's `map_id`. Optional;
   *  absent or empty leaves the spawn pass on its historical random
   *  walkable-cell selection. See {@link QuestStep.positions}. */
  positions?: Array<{ col?: number | string; row?: number | string }>;
  location_kind?: string;
  map_id?: string;
  dungeon_id?: string;
  dungeon_level?: number | string;
  /** Specific cell on `map_id` — required for `retrieve` steps so the
   *  host knows where to drop the quest item. Coerced from string or
   *  number; defaults to 0 when absent. */
  col?: number | string;
  row?: number | string;
}

interface RawQuestGiver {
  npc_name?: string;
  npc_sprite?: string;
  start_dialog?: string;
  end_dialog?: string;
}

interface RawRewardTileAddOp {
  map?: string;
  col?: number | string;
  row?: number | string;
  tile_id?: string;
}

interface RawRewards {
  xp?: number | string;
  gold?: number | string;
  items?: unknown;
  /** v2 quests.json: list of cells to paint with a named palette
   *  tile on quest turn-in. */
  tile_add?: RawRewardTileAddOp[];
}

/** Raw shape of a step-level `rewards` block. Same key conventions
 *  as the quest-level {@link RawRewards} but only `items` and
 *  `tile_add` are honored — see {@link QuestStepRewards}. */
interface RawStepRewards {
  items?: unknown;
  tile_add?: RawRewardTileAddOp[];
}

interface RawQuest {
  id?: string;
  name?: string;
  description?: string;
  tags?: unknown;
  steps?: RawQuestStep[];
  quest_giver?: RawQuestGiver | null;
  rewards?: RawRewards | null;
}

/** Top-level envelope. v2 quests.json wraps the list as
 *  `{ quests: [...] }`. Older fixtures may still be a bare array;
 *  the loader handles both. */
interface RawQuestsFile {
  quests?: RawQuest[];
}

function coerceInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim().length > 0) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Coerce arbitrary `tags` JSON to a clean string[]. */
function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** Coerce v2's `location_kind` to the typed union. Anything other than
 *  the known values collapses to empty (= "any location credits"). */
function coerceLocationKind(v: unknown): QuestLocationKind {
  if (v === "dungeon" || v === "map") return v;
  return "";
}

/** Parse a `tile_add` array out of a raw rewards block (quest- or
 *  step-scoped). Malformed entries (missing map id, non-finite coords,
 *  empty `tile_id`) are dropped silently so a bad quests.json never
 *  crashes a load. Returns an empty array when the input isn't an
 *  array. */
function parseTileAdds(raw: unknown): RewardTileAddOp[] {
  if (!Array.isArray(raw)) return [];
  const out: RewardTileAddOp[] = [];
  for (const op of raw) {
    if (!op || typeof op !== "object") continue;
    const o = op as RawRewardTileAddOp;
    const map = typeof o.map === "string" ? o.map : "";
    const col = coerceInt(o.col);
    const row = coerceInt(o.row);
    const tile_id = typeof o.tile_id === "string" ? o.tile_id : "";
    if (!map || col === undefined || row === undefined || !tile_id) continue;
    out.push({ map, col, row, tile_id });
  }
  return out;
}

/** Parse an authored `positions` array out of raw step JSON. Entries
 *  missing finite col/row coerce out silently — a hand-edited typo
 *  shouldn't crash the load — and the result is always a fresh,
 *  mutation-safe array. Returns `[]` when the input isn't an array. */
function parsePositions(
  raw: unknown,
): Array<{ col: number; row: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ col: number; row: number }> = [];
  for (const op of raw) {
    if (!op || typeof op !== "object") continue;
    const o = op as { col?: unknown; row?: unknown };
    const col = coerceInt(o.col);
    const row = coerceInt(o.row);
    if (col === undefined || row === undefined) continue;
    out.push({ col, row });
  }
  return out;
}

/** Parse a step-level rewards block. Always returns a well-formed
 *  {@link QuestStepRewards} — an absent or malformed block collapses
 *  to `{ items: [], tileAdds: [] }`. */
function parseStepRewards(raw: RawStepRewards | null | undefined): QuestStepRewards {
  if (!raw || typeof raw !== "object") return emptyStepRewards();
  const items = Array.isArray(raw.items)
    ? raw.items.filter((s): s is string => typeof s === "string")
    : [];
  return { items, tileAdds: parseTileAdds(raw.tile_add) };
}

function stepFromRaw(raw: RawQuestStep): QuestStep | null {
  const kind = (raw.kind ?? "kill") as QuestStepKind;

  const params = (raw.params && typeof raw.params === "object")
    ? raw.params as Record<string, unknown>
    : {};

  // Prefer the top-level `encounter_id` / `count` / `item_id` (current
  // editor output) and fall back to `params.<field>` so quests.json
  // authored before the editor's top-level migration still hydrates.
  // The truly v1 flat fields (`raw.encounter`, `raw.target_count`,
  // `raw.collect_item`) were removed in the same cleanup that dropped
  // the v1 derived view — no production module ever shipped them.
  const encounterIdFromParams = typeof params.encounter_id === "string"
    ? params.encounter_id
    : "";
  const encounterId = (raw.encounter_id ?? "") || encounterIdFromParams;

  const countTop = coerceInt(raw.count);
  const countFromParams = coerceInt(params.count);
  const count = Math.max(1, countTop ?? countFromParams ?? 1);

  const itemIdFromParams = typeof params.item_id === "string"
    ? params.item_id
    : "";
  const itemId = (raw.item_id ?? "") || itemIdFromParams;

  const locationKind = coerceLocationKind(raw.location_kind);
  const mapId = typeof raw.map_id === "string" ? raw.map_id : "";
  const dungeonId = typeof raw.dungeon_id === "string" ? raw.dungeon_id : "";
  const dungeonLevel = coerceInt(raw.dungeon_level);
  // Specific-cell coords (retrieve steps). Defaults to 0/0 when absent
  // — non-retrieve steps don't read them.
  const col = coerceInt(raw.col) ?? 0;
  const row = coerceInt(raw.row) ?? 0;

  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    description: raw.description ?? "",
    tags: coerceStringArray(raw.tags),
    kind,
    params,
    locationKind,
    mapId,
    dungeonId,
    dungeonLevel,
    col,
    row,
    encounterId,
    count,
    itemId,
    positions: parsePositions(raw.positions),
    rewards: parseStepRewards(raw.rewards),
  };
}

function fromRaw(raw: RawQuest): QuestDef | null {
  if (!raw || typeof raw !== "object") return null;
  // Stable id is the primary key for state lookup; name falls back to
  // id when the JSON only set one of the two. A quest with neither
  // is unaddressable and gets dropped.
  const id = typeof raw.id === "string" && raw.id.length > 0
    ? raw.id
    : (typeof raw.name === "string" ? raw.name : "");
  if (!id) return null;
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id;

  const steps = (raw.steps ?? [])
    .map(stepFromRaw)
    .filter((s): s is QuestStep => s !== null);

  const giverRaw = raw.quest_giver ?? null;
  const questGiver: QuestGiver = {
    npcName: giverRaw?.npc_name ?? "",
    npcSprite: giverRaw?.npc_sprite ?? "",
    startDialog: giverRaw?.start_dialog ?? "",
    endDialog: giverRaw?.end_dialog ?? "",
  };

  const rewardsRaw = raw.rewards ?? null;
  const tileAdds = parseTileAdds(rewardsRaw?.tile_add);
  const rewards: QuestRewards = {
    xp: coerceInt(rewardsRaw?.xp) ?? 0,
    gold: coerceInt(rewardsRaw?.gold) ?? 0,
    items: rewardsRaw && Array.isArray(rewardsRaw.items)
      ? rewardsRaw.items.filter((s): s is string => typeof s === "string")
      : [],
    tileAdds,
  };

  return {
    id,
    name,
    description: raw.description ?? "",
    tags: coerceStringArray(raw.tags),
    steps,
    questGiver,
    rewards,
  };
}

let _cache: QuestDef[] | null = null;

export async function loadQuests(url = modulePath("quests.json")): Promise<QuestDef[]> {
  if (_cache) return _cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const raw = await res.json();
  _cache = parseQuestsFile(raw);
  return _cache;
}

/** Parse a `quests.json` payload (either the v2 `{ quests: [...] }`
 *  envelope or a bare array) into the runtime QuestDef[]. Exposed
 *  for tests so the loader can be exercised without a fetch. */
export function parseQuestsFile(raw: unknown): QuestDef[] {
  const list: RawQuest[] = Array.isArray(raw)
    ? (raw as RawQuest[])
    : Array.isArray((raw as RawQuestsFile | null)?.quests)
      ? ((raw as RawQuestsFile).quests as RawQuest[])
      : [];
  return list
    .map(fromRaw)
    .filter((q): q is QuestDef => q !== null);
}

/** Test-only: clear the cache. */
export function _clearQuestsCache(): void {
  _cache = null;
}

// ── Spelunking auto-expansion ───────────────────────────────────

/** Loose raw-step shape the expansion pass reads/writes. Kept
 *  structural (not the typed {@link QuestStep}) because expansion
 *  runs on the catalog's raw JSON quest records BEFORE
 *  {@link parseQuestsFile} narrows them — it must preserve every
 *  field it doesn't touch. */
interface RawStepLike {
  id?: string;
  name?: string;
  kind?: string;
  dungeon_id?: string;
  dungeon_level?: number | string | null;
  location_kind?: string;
  [k: string]: unknown;
}

/** Loose raw-quest shape — only `steps` is read; everything else is
 *  passed through untouched. */
interface RawQuestLike {
  id?: string;
  steps?: RawStepLike[];
  [k: string]: unknown;
}

/** Minimal dungeon info the expansion needs: the record id + its
 *  ordered floor list (only `name` / `depth` are read). Mirrors the
 *  fields {@link DungeonRecord.levels} carries. */
export interface DungeonFloorInfo {
  id: string;
  levels?: ReadonlyArray<{ name?: string; depth?: number }>;
}

/**
 * Fan out "spelunking template" steps into one `reach` step per
 * dungeon floor.
 *
 * A template step is `kind: "reach"` with a `dungeon_id` set and NO
 * concrete `dungeon_level`. For each one, this pass looks up the
 * named dungeon's floor count (`levels.length`) and replaces the
 * single template with N reach steps — `dungeon_level` 1..N (using
 * each level's `depth`), `location_kind: "dungeon"`, and a name
 * derived from the level's authored name (falling back to
 * "Floor N"). The party credits each step just by arriving on the
 * matching floor (see PlayHost's `creditReachStep`); since floors are
 * reached in order, the sequential progress model advances one step
 * per descent.
 *
 * Untouched: reach steps that already pin a `dungeon_level` (explicit
 * single-floor steps), every non-reach step, and any template whose
 * `dungeon_id` doesn't resolve to a dungeon with floors (left as-is so
 * a bad id doesn't silently delete the step).
 *
 * Pure + idempotent: expanded steps carry concrete levels, so a
 * second pass finds nothing left to expand. Returns a new array;
 * inputs are not mutated.
 */
export function expandSpelunkingQuests<Q>(
  quests: ReadonlyArray<Q>,
  dungeons: ReadonlyArray<DungeonFloorInfo>,
): Q[] {
  const floorsById = new Map<
    string,
    ReadonlyArray<{ name?: string; depth?: number }>
  >();
  for (const d of dungeons) {
    if (d && typeof d.id === "string" && d.id.length > 0) {
      floorsById.set(d.id, d.levels ?? []);
    }
  }
  return quests.map((q) => {
    const qq = q as RawQuestLike;
    const steps = Array.isArray(qq.steps) ? qq.steps : null;
    if (!steps) return q;
    let touched = false;
    const out: RawStepLike[] = [];
    for (const step of steps) {
      const lvlRaw = step?.dungeon_level;
      const hasConcreteLevel =
        typeof lvlRaw === "number"
          ? lvlRaw > 0
          : typeof lvlRaw === "string"
            ? lvlRaw.trim().length > 0 && lvlRaw.trim() !== "0"
            : false;
      const isTemplate =
        !!step &&
        step.kind === "reach" &&
        typeof step.dungeon_id === "string" &&
        step.dungeon_id.length > 0 &&
        !hasConcreteLevel;
      if (!isTemplate) {
        out.push(step);
        continue;
      }
      const levels = floorsById.get(step.dungeon_id as string);
      if (!levels || levels.length === 0) {
        // Unknown dungeon / no floors — leave the template intact so
        // the author can see (and fix) the dangling reference.
        out.push(step);
        continue;
      }
      touched = true;
      const baseId = step.id && step.id.length > 0 ? step.id : "reach";
      const baseName = typeof step.name === "string" ? step.name : "";
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        const depth =
          typeof lvl?.depth === "number" && lvl.depth > 0 ? lvl.depth : i + 1;
        const floorName =
          typeof lvl?.name === "string" && lvl.name.length > 0
            ? lvl.name
            : `Floor ${depth}`;
        out.push({
          ...step,
          id: `${baseId}_f${depth}`,
          name: baseName ? `${baseName}: ${floorName}` : floorName,
          kind: "reach",
          location_kind: "dungeon",
          dungeon_id: step.dungeon_id,
          dungeon_level: depth,
        });
      }
    }
    if (!touched) return q;
    return { ...(q as Record<string, unknown>), steps: out } as Q;
  });
}

export function findQuest(defs: QuestDef[], name: string): QuestDef | null {
  return defs.find((q) => q.name === name) ?? null;
}

/** Bring the quest-state map up to date with the loaded definitions.
 *  Adds a fresh `available` entry for any quest the state hasn't seen
 *  yet, and pads `stepProgress` if the JSON gained steps since the
 *  state was last written. Idempotent — safe to call on every scene
 *  boot. */
export function ensureQuestStates(
  defs: QuestDef[],
  states: Map<string, QuestState>,
): void {
  for (const def of defs) {
    let state = states.get(def.id);
    if (!state) {
      state = {
        status: "available",
        stepProgress: def.steps.map(() => false),
        stepKills: {},
        guardianDefeated: {},
      };
      states.set(def.id, state);
      continue;
    }
    while (state.stepProgress.length < def.steps.length) {
      state.stepProgress.push(false);
    }
    // Saves written before the guardian-defeated tracking landed
    // arrive without the field — patch it in so the spawn pass can
    // read it without an undefined-property guard everywhere.
    if (!state.guardianDefeated) state.guardianDefeated = {};
  }
}

// ── Location matching ───────────────────────────────────────────

/** Where the party currently is when combat resolves — the input to
 *  the structured location matcher. Mirrors v2's `location_kind` +
 *  the relevant ids (`map_id` for "map" locations; `dungeon_id` plus
 *  optional `dungeonLevel` for "dungeon" locations).
 *
 *  Use {@link matchesLocation} to check whether a step is satisfied
 *  by a given location. */
export interface CombatLocation {
  kind: "map" | "dungeon";
  /** Required when `kind === "map"`. */
  mapId?: string;
  /** Required when `kind === "dungeon"`. */
  dungeonId?: string;
  /** 1-based floor index. Optional — when absent the matcher treats
   *  the step as "any floor of the dungeon credits." */
  dungeonLevel?: number;
}

/**
 * Returns true when a step's structured `locationKind` / `mapId` /
 * `dungeonId` / `dungeonLevel` is satisfied by the current
 * {@link CombatLocation}.
 *
 * Rules:
 *   - Empty `step.locationKind` → matches any location ("no location
 *     requirement").
 *   - `step.locationKind === "map"` → satisfied when `loc.kind ===
 *     "map"` AND (step.mapId is empty OR matches loc.mapId).
 *   - `step.locationKind === "dungeon"` → satisfied when `loc.kind
 *     === "dungeon"` AND (step.dungeonId empty OR matches), AND
 *     (step.dungeonLevel undefined OR matches loc.dungeonLevel).
 */
export function matchesLocation(step: QuestStep, loc: CombatLocation): boolean {
  if (!step.locationKind) return true;
  if (step.locationKind !== loc.kind) return false;
  if (loc.kind === "map") {
    return !step.mapId || step.mapId === loc.mapId;
  }
  // dungeon
  if (step.dungeonId && step.dungeonId !== loc.dungeonId) return false;
  if (typeof step.dungeonLevel === "number") {
    return step.dungeonLevel === loc.dungeonLevel;
  }
  return true;
}

// ── Active-step queries ─────────────────────────────────────────

export interface QuestStepCallout {
  questName: string;
  description: string;
  /** True when this credit completed the entire quest. */
  questComplete: boolean;
}

/** One row per active kill step that wants encounters spawned at
 *  `loc`. Returned by {@link activeKillStepsAt}. */
export interface ActiveKillStepRow {
  /** Stable quest id (matches the key in `moduleQuestStates`). */
  questId: string;
  /** Step index inside the quest's `steps[]`. */
  stepIdx: number;
  /** Encounter id (encounters.json) the step wants cleared. */
  encounterId: string;
  /** How many more clearings still need to credit this step
   *  (`step.count - already-killed`). Always ≥ 1 in returned rows;
   *  zero-remaining steps are dropped. */
  remaining: number;
  /** Author-anchored cells the spawn pass should prefer when placing
   *  this step's encounter copies. Slice of `step.positions` that
   *  skips any already-credited copies (the first `kills_so_far`
   *  entries are dropped so a partial-progress step on map re-entry
   *  doesn't re-anchor copies the player already cleared). May be
   *  empty when the step didn't author positions or all authored
   *  cells have already been consumed — placement then falls back to
   *  random walkable selection. */
  positions: ReadonlyArray<{ col: number; row: number }>;
  /** Back-reference to the step itself, for callers that need
   *  additional fields (description, tags, etc.). */
  step: QuestStep;
}

/**
 * Every active kill step whose structured `locationKind` / `mapId` /
 * `dungeonId` / `dungeonLevel` matches the current
 * {@link CombatLocation}. The caller (MapSimulation, the dungeon
 * scene, etc.) uses the returned rows to drive placement.
 *
 * Rules:
 *   - The quest's state must be `active`.
 *   - The step must be `kind: "kill"` and not already marked
 *     complete in `stepProgress`.
 *   - The step must declare an `encounterId` (empty = "not
 *     authored yet", skipped).
 *   - The step's location must satisfy {@link matchesLocation}.
 *   - At least one clearing must still be needed
 *     (`step.count - kills_so_far > 0`).
 */
export function activeKillStepsAt(
  defs: ReadonlyArray<QuestDef>,
  states: ReadonlyMap<string, QuestState>,
  loc: CombatLocation,
): ActiveKillStepRow[] {
  const out: ActiveKillStepRow[] = [];
  for (const def of defs) {
    const state = states.get(def.id);
    if (!state || state.status !== "active") continue;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (step.kind !== "kill") continue;
      if (state.stepProgress[i]) continue;
      if (!step.encounterId) continue;
      if (!matchesLocation(step, loc)) continue;
      const done = state.stepKills[i] ?? 0;
      const remaining = Math.max(0, step.count - done);
      if (remaining <= 0) continue;
      // Skip the first `done` authored positions — they belong to
      // the copies the party has already cleared. Without this slice,
      // re-entering the map at 1/3 kills would re-anchor the first
      // copy at positions[0] (already used) rather than honouring
      // positions[1] for the second copy.
      const positions = step.positions.slice(done);
      out.push({
        questId: def.id,
        stepIdx: i,
        encounterId: step.encounterId,
        remaining,
        positions,
        step,
      });
    }
  }
  return out;
}

// ── Kill credit ────────────────────────────────────────────────

/** Result of {@link creditQuestKill} — describes what changed so the
 *  host can render banners ("Step complete!", "Quest complete!") and
 *  decide whether to re-fetch dialog text. */
export interface QuestKillCredit {
  /** Quest the credit was applied to. */
  questId: string;
  /** Step index inside the quest. */
  stepIdx: number;
  /** Reference to the step record (`description`, `name`, `count`). */
  step: QuestStep;
  /** `state.stepKills[i]` after the increment. */
  killsSoFar: number;
  /** True when this credit flipped `stepProgress[i]` from false to
   *  true (i.e. `killsSoFar >= step.count`). */
  stepCompleted: boolean;
  /** True when this credit was the LAST step's completion → the
   *  quest's status flipped from "active" to "completed" and the
   *  player can now return to the giver for the end-dialog. */
  questCompleted: boolean;
  /** Step-scoped rewards the host should apply immediately when
   *  `stepCompleted` is true — items to grant, map cells to mutate.
   *  Null when this credit didn't complete the step (so the host
   *  doesn't accidentally re-grant on every kill in a multi-count
   *  step). Always a shallow copy of `step.rewards`, never the live
   *  reference, so the caller can mutate it freely. */
  stepRewards: QuestStepRewards | null;
}

/**
 * Credit one clearing of a quest's kill step. Idempotent in the
 * "already-complete" sense — calling this for a step whose
 * `stepProgress` is already true returns null without mutating.
 *
 * Mutates `state.stepKills[stepIdx]` (incrementing it), then —
 * if the new total reaches the step's `count` — sets
 * `state.stepProgress[stepIdx] = true`. If that completion makes
 * `stepProgress` all true, the status flips to "completed".
 *
 * Returns null when the quest doesn't exist, the step doesn't exist,
 * the step isn't a `kill` kind, or the step is already complete.
 */
export function creditQuestKill(
  defs: ReadonlyArray<QuestDef>,
  states: ReadonlyMap<string, QuestState>,
  questId: string,
  stepIdx: number,
): QuestKillCredit | null {
  const def = defs.find((d) => d.id === questId);
  if (!def) return null;
  const state = states.get(questId);
  if (!state) return null;
  if (state.status !== "active") return null;
  const step = def.steps[stepIdx];
  if (!step) return null;
  if (step.kind !== "kill") return null;
  if (state.stepProgress[stepIdx]) return null;
  const killsSoFar = (state.stepKills[stepIdx] ?? 0) + 1;
  state.stepKills[stepIdx] = killsSoFar;
  let stepCompleted = false;
  let questCompleted = false;
  if (killsSoFar >= step.count) {
    state.stepProgress[stepIdx] = true;
    stepCompleted = true;
    if (state.stepProgress.length > 0 && state.stepProgress.every((p) => p)) {
      state.status = "completed";
      questCompleted = true;
    }
  }
  return {
    questId,
    stepIdx,
    step,
    killsSoFar,
    stepCompleted,
    questCompleted,
    stepRewards: stepCompleted ? snapshotStepRewards(step.rewards) : null,
  };
}

/** Shallow-copy a step's rewards so callers can read / mutate the
 *  payload without affecting the underlying QuestStep. Mirrors what
 *  {@link claimQuestRewards} does for the quest-level envelope —
 *  defensive copying keeps the credit result a stable snapshot even
 *  if the quest def is reloaded mid-flight. */
function snapshotStepRewards(rewards: QuestStepRewards): QuestStepRewards {
  return {
    items: [...rewards.items],
    tileAdds: rewards.tileAdds.map((op) => ({ ...op })),
  };
}

// ── Retrieve credit ────────────────────────────────────────────

/** Result of {@link creditQuestRetrieve}. Mirrors {@link QuestKillCredit}
 *  but without the per-step counter (retrieve is single-pickup — one
 *  step-on credits it in full). */
export interface QuestRetrieveCredit {
  questId: string;
  stepIdx: number;
  step: QuestStep;
  /** Always true on a successful credit — retrieve has no multi-count
   *  middle state. Exposed for parity with QuestKillCredit so the host
   *  can use one celebration code path. */
  stepCompleted: true;
  /** True when this credit was the LAST step's completion — quest
   *  status flipped from "active" to "completed". */
  questCompleted: boolean;
  /** Step-scoped rewards the host should apply on this credit. Always
   *  populated (retrieve credits are single-shot — a successful
   *  return implies the step completed), so unlike
   *  {@link QuestKillCredit.stepRewards} this is never null. Shallow
   *  copy of `step.rewards`, safe for callers to mutate. */
  stepRewards: QuestStepRewards;
}

/**
 * Credit the party for retrieving a quest item. Returns null when the
 * quest doesn't exist / isn't active / the step doesn't exist / the
 * step isn't a `retrieve` kind / the step is already complete.
 *
 * On a successful credit, flips `stepProgress[stepIdx]` to true and
 * bumps `state.status` to "completed" when that was the last
 * outstanding step.
 */
export function creditQuestRetrieve(
  defs: ReadonlyArray<QuestDef>,
  states: ReadonlyMap<string, QuestState>,
  questId: string,
  stepIdx: number,
): QuestRetrieveCredit | null {
  const def = defs.find((d) => d.id === questId);
  if (!def) return null;
  const state = states.get(questId);
  if (!state) return null;
  if (state.status !== "active") return null;
  const step = def.steps[stepIdx];
  if (!step) return null;
  if (step.kind !== "retrieve") return null;
  if (state.stepProgress[stepIdx]) return null;
  state.stepProgress[stepIdx] = true;
  let questCompleted = false;
  if (state.stepProgress.length > 0 && state.stepProgress.every((p) => p)) {
    state.status = "completed";
    questCompleted = true;
  }
  return {
    questId,
    stepIdx,
    step,
    stepCompleted: true,
    questCompleted,
    stepRewards: snapshotStepRewards(step.rewards),
  };
}

// ── Acceptance / turn-in ───────────────────────────────────────

export function acceptQuest(states: Map<string, QuestState>, questName: string): boolean {
  const state = states.get(questName);
  if (!state || state.status !== "available") return false;
  state.status = "active";
  return true;
}

export function markTurnedIn(states: Map<string, QuestState>, questName: string): boolean {
  const state = states.get(questName);
  if (!state || state.status !== "completed") return false;
  state.status = "turned_in";
  return true;
}

/** Result of {@link claimQuestRewards} — a snapshot of what the host
 *  should grant the party on turn-in. Empty for already-claimed or
 *  not-yet-completed quests (the helper returns null in those cases
 *  instead of returning a zeroed payload). */
export interface QuestRewardClaim {
  questId: string;
  /** Display name of the quest, for log/banner copy. */
  questName: string;
  xp: number;
  gold: number;
  /** Catalog ids — host loops these and calls `addToStash` (or the
   *  equivalent per-item granter) for each. */
  items: ReadonlyArray<string>;
  /** Cells the host must paint with the named palette tile on the
   *  named map. Empty when the quest didn't author any. */
  tileAdds: ReadonlyArray<RewardTileAddOp>;
}

/**
 * Single-shot turn-in helper. When `questId` is "completed", flips
 * the status to "turned_in" and returns the reward payload. Returns
 * null when the quest doesn't exist, isn't in the right state, or
 * has already been turned in — so callers can safely call this from
 * a button handler without their own idempotency guard.
 *
 * The helper does NOT apply the rewards itself — granting xp /
 * gold / items lives on the host side because the runtime party
 * shape varies (in-combat PartyMember, save-side SavedPartyState).
 * The host calls this, reads `xp` / `gold` / `items`, and routes
 * each through the right kernel call (`awardXp`, `party.gold +=`,
 * `addToStash`).
 */
export function claimQuestRewards(
  defs: ReadonlyArray<QuestDef>,
  states: ReadonlyMap<string, QuestState>,
  questId: string,
): QuestRewardClaim | null {
  const def = defs.find((d) => d.id === questId);
  if (!def) return null;
  const state = states.get(questId);
  if (!state) return null;
  if (state.status !== "completed") return null;
  state.status = "turned_in";
  return {
    questId: def.id,
    questName: def.name,
    xp: def.rewards.xp,
    gold: def.rewards.gold,
    items: [...def.rewards.items],
    tileAdds: [...def.rewards.tileAdds],
  };
}

// ── Encounter sampling helpers ─────────────────────────────────

/** Sample roster for a kill step's encounter — surfaces the monster
 *  catalog so the dungeon scene's combat dispatch builds the right
 *  encounter rather than rolling a random one. Returns null if the
 *  encounter name isn't found. */
export function rosterFor(
  encounters: Record<string, EncounterTemplate[]>,
  encounterName: string,
): EncounterTemplate | null {
  for (const list of Object.values(encounters)) {
    for (const e of list) if (e.name === encounterName) return e;
  }
  return null;
}

// Re-export a small typed alias for the sampler so consumers don't
// need to reach into Encounters.ts directly.
export { sampleEncounter };
