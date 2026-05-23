/**
 * Module quest data + state.
 *
 * Mirrors the relevant subset of `src/quest_manager.py` from the
 * Python project — same status lifecycle, same kill/collect step
 * semantics, same location-matching rules. Quest definitions are
 * loaded from the active module's `quests.json`; per-quest progress
 * lives on `gameState.moduleQuestStates`.
 *
 * **Status lifecycle.**
 *   `available` → `active` (player accepted the quest)
 *                 → `completed` (every step's progress flag is true)
 *                                → `turned_in` (rewards claimed; terminal)
 *
 * **Step kinds.** v1 supports two:
 *   - `"kill"` — defeat the named encounter (from encounters.json)
 *               at `spawn_location`, `target_count` times.
 *   - `"collect"` — pick up `collect_item` at `spawn_location`.
 *
 * **Location matching** (`locationMatches`) accepts:
 *   - empty step location → any combat location credits
 *   - `"overview"` / `"Overview Map"` → overworld combat
 *   - exact case-insensitive match for `"town:X"`, `"interior:X/Y"`,
 *     `"space:X/Y"`, `"building:X"`
 *   - `"dungeon:X"` → matches `"dungeon:X"` and `"dungeon:X - Floor N"`
 *   - `"building:X"` → also matches `"space:X/Y"` for any sub-space
 *
 * v1 explicitly does NOT implement quest-tag verification (the Python
 * "this monster must be the quest's specific spawn" rule). That's a
 * fix-up to preserve the cinematic boss moment in localized steps;
 * for v1 a roster name + location match is the user-facing
 * simplification called out in the port plan.
 */

import { modulePath } from "./Module";
import { sampleEncounter, type EncounterTemplate } from "./Encounters";
import { tileDef } from "./Tiles";
import type { TileMap } from "./TileMap";

export type QuestStatus = "available" | "active" | "completed" | "turned_in";
export type QuestStepKind = "kill" | "collect" | "retrieve";

// ── World-unlock rewards ──────────────────────────────────────────
//
// A quest can declare a list of overworld tile mutations that fire
// when the quest is turned in — used in modules like Dragon of
// Dagorn to drop a Bridge across an impassable river once the
// Stolen Sealstone quest is delivered. The Python implementation
// lives in `src/module_editor_quest.py:apply_world_unlocks`; this
// is a faithful port.
//
// `kind` is preserved as a designer hint so the quest editor can
// re-open the right tile picker on a round-trip; at runtime the
// two kinds are identical (a single `set_tile`):
//   - "add_tile"        — paint any overworld tile id
//   - "remove_obstacle" — paint a passable tile (subset of add_tile)
//
// Out-of-bounds entries and ones missing required ints are skipped
// silently rather than crashing on a malformed quests.json.
export type WorldUnlockKind = "add_tile" | "remove_obstacle" | "";

export interface WorldUnlock {
  kind: WorldUnlockKind;
  col: number;
  row: number;
  tile: number;
}

/** Triple returned by `applyWorldUnlocks` — used by the reward-summary
 *  line so the player sees "World changed: Bridge at (5,13)" when a
 *  quest's world-unlock op completes. */
export type AppliedUnlock = readonly [col: number, row: number, tile: number];

/** Where a step plays out in the v2 structured form. Empty means
 *  "any location credits the step." */
export type QuestLocationKind = "dungeon" | "map" | "";

export interface QuestStep {
  // ── v2-native fields ───────────────────────────────────────────
  /** Stable per-step id, unique within the parent Quest's `steps[]`.
   *  In v2 JSON this is `step.id`. */
  id: string;
  /** Display name shown in the quest log for this step. */
  name: string;
  description: string;
  /** Editor-side organizational labels. Gameplay doesn't read them. */
  tags: string[];
  /** Discriminator for what the step is — `"kill"`, `"fetch"`, `"visit"`,
   *  `"talk"`, or any future kind. Open enum; the runtime branches on
   *  known values and skips unknown ones. */
  kind: QuestStepKind;
  /** Free-form params blob the v2 JSON carries. The fields below are
   *  typed projections of the common shapes (kill: encounter_id+count;
   *  fetch: item_id+count; visit: map_id+col+row; talk: npc_id). */
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
   *  the step wants cleared. Pulled from `params.encounter_id`. */
  encounterId: string;
  /** For `kind === "kill"` (or any countable step) — how many
   *  encounter clearings to credit. Pulled from `params.count`; defaults
   *  to 1 when absent. */
  count: number;
  /** For `kind === "fetch"` — item id from `params.item_id`. */
  itemId: string;

  // ── v1-shape compat fields ─────────────────────────────────────
  // Populated for backwards-compat with helpers ported from v1 (the
  // orphan `placeQuestInteriorMonsters` / `placeQuestInteriorItems`
  // path, the string-based `locationMatches`, the kill-credit
  // helpers). v2 quests don't carry data for these so they're
  // derived/empty; once the v1 helpers are deleted, these go too.
  /** @deprecated Use {@link kind} (alias for back-compat). */
  stepType: QuestStepKind;
  /** @deprecated Use {@link encounterId}. */
  encounter: string;
  /** @deprecated Use {@link itemId}. v2 quests don't author this. */
  collectItem: string;
  /** @deprecated v2 quests don't author this. */
  hasGuardian: boolean;
  /** @deprecated v2 quests don't author this. */
  guardianEncounter: string;
  /** @deprecated Use {@link locationKind} + {@link mapId} / {@link dungeonId}. */
  spawnLocation: string;
  /** @deprecated Use {@link count}. */
  targetCount: number;
  /** @deprecated v2 quests don't author this. */
  spawnCol?: number;
  /** @deprecated v2 quests don't author this. */
  spawnRow?: number;
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

export interface QuestDef {
  // ── v2-native fields ───────────────────────────────────────────
  /** Stable Quest id from quests.json (e.g. `"rats"`). v2's primary
   *  key for runtime state lookup. */
  id: string;
  name: string;
  description: string;
  /** Editor-side organizational labels. */
  tags: string[];
  steps: QuestStep[];
  questGiver: QuestGiver;
  rewards: QuestRewards;

  // ── v1-shape compat fields ─────────────────────────────────────
  // Populated from the v2 envelope so helpers ported from v1
  // (Towns.ts giver placement, applyTurnedInWorldUnlocks, etc.)
  // still compile. v2 doesn't author location/coords on the quest
  // record so those are empty/zero; v2 doesn't author world unlocks
  // or a final-quest flag yet so those are empty/false.
  /** @deprecated Use {@link questGiver}.npcName. */
  giverNpc: string;
  /** @deprecated Use {@link questGiver}.npcSprite. */
  giverSprite: string;
  /** @deprecated v2 doesn't author this. */
  giverLocation: string;
  /** @deprecated Use {@link questGiver}.startDialog. */
  giverDialogue: string;
  /** @deprecated v2 doesn't author this — giver position lives on a map cell. */
  giverCol: number;
  /** @deprecated v2 doesn't author this. */
  giverRow: number;
  /** @deprecated Use {@link rewards}.xp. */
  rewardXp: number;
  /** @deprecated Use {@link rewards}.gold. */
  rewardGold: number;
  /** @deprecated Use {@link rewards}.items. */
  rewardItems: string[];
  /** @deprecated v2 doesn't author this yet. */
  rewardWorldUnlocks: WorldUnlock[];
  /** @deprecated v2 doesn't author this yet. */
  isFinalQuest: boolean;
  /** @deprecated v2 doesn't author this yet. */
  victoryText: string;
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
  // v2 fields
  id?: string;
  name?: string;
  description?: string;
  tags?: unknown;
  kind?: string;
  /** First-class step attributes (kill steps). Replaces the legacy
   *  `params.encounter_id` / `params.count` nesting. The loader still
   *  reads `params` as a fallback so on-disk data from before the
   *  cleanup keeps hydrating; new editor output uses these top-level
   *  fields. */
  encounter_id?: string;
  count?: number | string;
  /** First-class step attribute for fetch steps. Same migration story
   *  as `encounter_id` — top-level now, `params.item_id` is a legacy
   *  read fallback. */
  item_id?: string;
  /** Legacy free-form params blob. Still read on load so existing
   *  on-disk data hydrates correctly, but no longer authored by the
   *  editor. Newly-saved steps drop this field entirely. */
  params?: Record<string, unknown> | null;
  location_kind?: string;
  map_id?: string;
  dungeon_id?: string;
  dungeon_level?: number | string;
  /** Specific cell on `map_id` — required for `retrieve` steps so the
   *  host knows where to drop the quest item. Coerced from string or
   *  number; defaults to 0 when absent. */
  col?: number | string;
  row?: number | string;
  // v1 legacy fields (kept so the loader can fall back to v1-shape
  // quests.json files during migration — strip once nothing in the
  // module catalog uses them)
  step_type?: string;
  encounter?: string;
  collect_item?: string;
  has_guardian?: string | boolean;
  guardian_encounter?: string;
  spawn_location?: string;
  target?: string;
  target_count?: number;
  optional?: string;
  spawn_col?: number | string;
  spawn_row?: number | string;
}

interface RawWorldUnlock {
  kind?: string;
  col?: number | string;
  row?: number | string;
  tile?: number | string;
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

interface RawQuest {
  // v2 fields
  id?: string;
  name?: string;
  description?: string;
  tags?: unknown;
  steps?: RawQuestStep[];
  quest_giver?: RawQuestGiver | null;
  rewards?: RawRewards | null;
  // v1 legacy fields (fallback during migration)
  giver_npc?: string;
  giver_sprite?: string;
  giver_location?: string;
  giver_dialogue?: string;
  giver_col?: number;
  giver_row?: number;
  reward_xp?: number;
  reward_gold?: number;
  reward_items?: string[];
  reward_world_unlocks?: RawWorldUnlock[];
  is_final_quest?: boolean;
  victory_text?: string;
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

function stepFromRaw(raw: RawQuestStep): QuestStep | null {
  // v2 `kind` is the discriminator; fall back to v1 `step_type` so a
  // module that still has v1-shape quests.json can hydrate without the
  // step collapsing to defaults. "kill" / "collect" stay as legacy
  // values; anything else passes through as the open enum.
  const kindRaw = raw.kind ?? raw.step_type ?? "kill";
  const kind = kindRaw as QuestStepKind;

  const params = (raw.params && typeof raw.params === "object")
    ? raw.params as Record<string, unknown>
    : {};

  // ── First-class step attributes ───────────────────────────────
  // Prefer the top-level `encounter_id` / `count` / `item_id`
  // (current editor output) and fall back through legacy shapes in
  // order: `params.<field>` (old quests.json from before the
  // editor refactor) → v1 flat fields (`raw.encounter`,
  // `raw.target_count`, `raw.collect_item`) so old hand-authored
  // data still hydrates. Once the modules are migrated and v1
  // fixtures are gone, both fallbacks can be deleted.
  const encounterIdFromParams = typeof params.encounter_id === "string"
    ? params.encounter_id
    : "";
  const encounterId =
    (raw.encounter_id ?? "") ||
    encounterIdFromParams ||
    (raw.encounter ?? "");

  const countTop = coerceInt(raw.count);
  const countFromParams = coerceInt(params.count);
  const count = Math.max(
    1,
    countTop ?? countFromParams ?? raw.target_count ?? 1,
  );

  const itemIdFromParams = typeof params.item_id === "string"
    ? params.item_id
    : "";
  const itemId =
    (raw.item_id ?? "") ||
    itemIdFromParams ||
    (raw.collect_item ?? "");

  // ── Location (v2 structured) ──────────────────────────────────
  const locationKind = coerceLocationKind(raw.location_kind);
  const mapId = typeof raw.map_id === "string" ? raw.map_id : "";
  const dungeonId = typeof raw.dungeon_id === "string" ? raw.dungeon_id : "";
  const dungeonLevel = coerceInt(raw.dungeon_level);
  // Specific-cell coords (retrieve steps). Defaults to 0/0 when absent
  // — non-retrieve steps don't read them.
  const col = coerceInt(raw.col) ?? 0;
  const row = coerceInt(raw.row) ?? 0;

  // ── v1-shape compat (derived) ─────────────────────────────────
  // `stepType` mirrors v1 with the union narrowed to "kill" | "collect";
  // anything else (visit/talk/...) maps to "kill" so the few v1 helpers
  // that branch on stepType don't crash. Once those helpers are
  // deleted this whole block goes too.
  const stepType: QuestStepKind = (kind === "collect" ? "collect" : "kill");
  // Synthesize a v1-style spawn_location string from the structured v2
  // form so the string-based `locationMatches` keeps returning sensible
  // results for legacy callers. Empty when no location_kind is set.
  const spawnLocation = synthesizeSpawnLocation(locationKind, mapId, dungeonId, dungeonLevel)
    || (raw.spawn_location ?? "");

  return {
    // v2-native
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
    // v1-shape compat
    stepType,
    encounter: encounterId,
    collectItem: itemId,
    hasGuardian: raw.has_guardian === "yes" || raw.has_guardian === true,
    guardianEncounter: raw.guardian_encounter ?? "",
    spawnLocation,
    targetCount: count,
    spawnCol: coerceInt(raw.spawn_col),
    spawnRow: coerceInt(raw.spawn_row),
  };
}

/** Build a v1-style location string from v2's structured fields so the
 *  legacy string-based `locationMatches` and any orphan helpers that
 *  read `step.spawnLocation` keep agreeing with the structured matcher.
 *  Empty `locationKind` → empty string (= "any location credits"). */
function synthesizeSpawnLocation(
  kind: QuestLocationKind,
  mapId: string,
  dungeonId: string,
  dungeonLevel?: number,
): string {
  if (kind === "map") {
    return mapId ? `map:${mapId}` : "";
  }
  if (kind === "dungeon") {
    if (!dungeonId) return "";
    if (typeof dungeonLevel === "number") {
      return `dungeon:${dungeonId} - Floor ${dungeonLevel}`;
    }
    return `dungeon:${dungeonId}`;
  }
  return "";
}

function unlockFromRaw(raw: RawWorldUnlock): WorldUnlock | null {
  if (!raw || typeof raw !== "object") return null;
  const c = coerceInt(raw.col);
  const r = coerceInt(raw.row);
  const t = coerceInt(raw.tile);
  if (c === undefined || r === undefined || t === undefined) return null;
  // Accept anything the editor might have written for `kind`, but only
  // round-trip the two values the editor surfaces; anything else
  // (including the empty string) collapses to "add_tile" so a hand-
  // edited entry without a kind still applies cleanly at runtime.
  let kind: WorldUnlockKind = "add_tile";
  if (raw.kind === "remove_obstacle") kind = "remove_obstacle";
  else if (raw.kind === "add_tile" || raw.kind === undefined || raw.kind === "") {
    kind = "add_tile";
  } else {
    // Unknown kinds still apply — preserve the string the editor wrote
    // so a future round-trip doesn't lose data, but TS narrows it to
    // the empty-string branch of the union for callers.
    kind = "";
  }
  return { kind, col: c, row: r, tile: t };
}

function fromRaw(raw: RawQuest): QuestDef | null {
  if (!raw || typeof raw !== "object") return null;
  // v2 keys quests by `id`. v1 keyed them by `name`. Accept either —
  // a quest must have at least one of the two to be addressable.
  const id = typeof raw.id === "string" && raw.id.length > 0
    ? raw.id
    : (typeof raw.name === "string" ? raw.name : "");
  if (!id) return null;
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : id;

  const steps = (raw.steps ?? [])
    .map(stepFromRaw)
    .filter((s): s is QuestStep => s !== null);

  // ── Quest giver (v2 nested envelope, v1 flat fallback) ────────
  const giverRaw = raw.quest_giver ?? null;
  const questGiver: QuestGiver = {
    npcName: giverRaw?.npc_name ?? raw.giver_npc ?? "",
    npcSprite: giverRaw?.npc_sprite ?? raw.giver_sprite ?? "",
    startDialog: giverRaw?.start_dialog ?? raw.giver_dialogue ?? "",
    endDialog: giverRaw?.end_dialog ?? "",
  };

  // ── Rewards (v2 nested envelope, v1 flat fallback) ────────────
  const rewardsRaw = raw.rewards ?? null;
  // Tile-mutation rewards (v2). Each entry must carry a real map id
  // and finite col/row; malformed entries are dropped so a bad
  // quests.json never crashes a load.
  const tileAdds: RewardTileAddOp[] = [];
  if (rewardsRaw && Array.isArray(rewardsRaw.tile_add)) {
    for (const op of rewardsRaw.tile_add) {
      if (!op || typeof op !== "object") continue;
      const map = typeof op.map === "string" ? op.map : "";
      const col = coerceInt(op.col);
      const row = coerceInt(op.row);
      const tile_id = typeof op.tile_id === "string" ? op.tile_id : "";
      if (!map || col === undefined || row === undefined || !tile_id) continue;
      tileAdds.push({ map, col, row, tile_id });
    }
  }
  const rewards: QuestRewards = {
    xp: coerceInt(rewardsRaw?.xp) ?? raw.reward_xp ?? 0,
    gold: coerceInt(rewardsRaw?.gold) ?? raw.reward_gold ?? 0,
    items: rewardsRaw && Array.isArray(rewardsRaw.items)
      ? rewardsRaw.items.filter((s): s is string => typeof s === "string")
      : (Array.isArray(raw.reward_items)
          ? raw.reward_items.filter((s): s is string => typeof s === "string")
          : []),
    tileAdds,
  };

  // v2 doesn't carry world unlocks yet; v1 fixtures might.
  const rewardWorldUnlocks = Array.isArray(raw.reward_world_unlocks)
    ? raw.reward_world_unlocks
        .map(unlockFromRaw)
        .filter((u): u is WorldUnlock => u !== null)
    : [];

  return {
    // v2-native
    id,
    name,
    description: raw.description ?? "",
    tags: coerceStringArray(raw.tags),
    steps,
    questGiver,
    rewards,
    // v1-shape compat (derived)
    giverNpc: questGiver.npcName || name,
    giverSprite: questGiver.npcSprite,
    giverLocation: raw.giver_location ?? "",
    giverDialogue: questGiver.startDialog,
    giverCol: raw.giver_col ?? 0,
    giverRow: raw.giver_row ?? 0,
    rewardXp: rewards.xp,
    rewardGold: rewards.gold,
    rewardItems: rewards.items,
    rewardWorldUnlocks,
    isFinalQuest: raw.is_final_quest === true,
    victoryText: raw.victory_text ?? "",
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

/** Parse a `quests.json` payload (either v2's `{ quests: [...] }`
 *  envelope or a bare v1 array) into the runtime QuestDef[]. Exposed
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
    // v2 keys state by `def.id` (the quests.json stable id). v1
    // fixtures whose `id` falls back to `name` still hit the same
    // bucket, so this isn't a breaking change for old data.
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

/**
 * Strip a trailing " - Floor N" from a `dungeon:` location so a step
 * targeting `"dungeon:Crypt"` credits combat on any floor.
 */
const FLOOR_SUFFIX = /\s*-\s*floor\s+\d+$/i;

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
 * Returns true when a v2 step's structured `locationKind` / `mapId`
 * / `dungeonId` / `dungeonLevel` is satisfied by the current
 * {@link CombatLocation}. Replaces the legacy string-based
 * {@link locationMatches}.
 *
 * Rules:
 *   - Empty `step.locationKind` → matches any location (the v1
 *     "no location requirement" semantic).
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

/**
 * Legacy v1 string-based matcher. Kept so the orphan v1 helpers in
 * this file (and the InteriorSpawn / Dungeon quest-placement code
 * that hasn't been re-wired yet) keep working.
 *
 * Returns true when a combat-location string satisfies a step's
 * spawn_location. Mirrors `_location_matches` in quest_manager.py.
 *
 * @deprecated Use {@link matchesLocation} for v2-structured matching.
 */
export function locationMatches(stepLocation: string, combatLocation: string): boolean {
  if (!stepLocation) return true;
  if (stepLocation === "overview" || stepLocation === "Overview Map") {
    return combatLocation === "overview" || combatLocation === "overworld" || combatLocation === "";
  }
  if (!combatLocation) return false;
  const sl = stepLocation.toLowerCase();
  const cl = combatLocation.toLowerCase();
  if (sl === cl) return true;
  if (sl.startsWith("building:")) {
    const bld = sl.slice("building:".length);
    if (cl.startsWith("space:") && cl.slice("space:".length).startsWith(bld + "/")) return true;
  }
  if (sl.startsWith("dungeon:")) {
    const base = sl.slice("dungeon:".length);
    if (cl.startsWith("dungeon:")) {
      const clBase = cl.slice("dungeon:".length).replace(FLOOR_SUFFIX, "");
      if (clBase === base) return true;
    }
  }
  return false;
}

// ── Monster-name normalisation ─────────────────────────────────

/**
 * Build the variant set the Python quest manager builds: original,
 * lowercase, snake_case, Title Case, lowercase-with-spaces. A roster
 * monster matches a killed monster if their variant sets intersect.
 */
function nameVariants(name: string): Set<string> {
  if (!name) return new Set();
  const out = new Set<string>();
  out.add(name);
  out.add(name.toLowerCase());
  out.add(name.replace(/\s+/g, "_").toLowerCase());
  // Title Case on the spaced form
  const spaced = name.replace(/_/g, " ");
  out.add(spaced.replace(/\b\w/g, (c) => c.toUpperCase()));
  out.add(spaced.toLowerCase());
  return out;
}

function variantsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

// ── Step credit ────────────────────────────────────────────────

export interface QuestStepCallout {
  questName: string;
  description: string;
  /** True when this credit completed the entire quest. */
  questComplete: boolean;
}

export interface KillCreditResult {
  /** Player-facing summary lines, one per progress event. */
  messages: string[];
  /** Quests that crossed into `completed` on this credit. */
  newlyCompleted: string[];
  /** Step-completion callouts to surface as banners. One per step
   *  that flipped from incomplete → done in this credit pass. */
  callouts: QuestStepCallout[];
}

/**
 * Credit any kill steps satisfied by the names of monsters killed in
 * a single combat at `combatLocation`. Mutates the relevant quest
 * states in place.
 *
 * `encounters` is the loaded encounters.json table — we look up each
 * step's `encounter` name to get its roster, then test whether any
 * killed monster name is in that roster (variant-fuzzy match).
 */
export function creditKills(
  defs: QuestDef[],
  states: Map<string, QuestState>,
  encounters: Record<string, EncounterTemplate[]>,
  killedNames: string[],
  combatLocation: string,
): KillCreditResult {
  const messages: string[] = [];
  const newlyCompleted: string[] = [];
  const callouts: QuestStepCallout[] = [];
  if (killedNames.length === 0) return { messages, newlyCompleted, callouts };

  const killedVariants = new Set<string>();
  for (const n of killedNames) for (const v of nameVariants(n)) killedVariants.add(v);

  // Flat map of encounter name → roster (across all areas).
  const rosterByName = new Map<string, string[]>();
  for (const list of Object.values(encounters)) {
    for (const e of list) {
      if (!rosterByName.has(e.name)) rosterByName.set(e.name, e.monsters);
    }
  }

  for (const def of defs) {
    const state = states.get(def.name);
    if (!state || state.status !== "active") continue;
    let stepCompleted = false;

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (state.stepProgress[i]) continue;
      if (step.stepType !== "kill") continue;
      if (!step.encounter) continue;
      if (!locationMatches(step.spawnLocation, combatLocation)) continue;
      const roster = rosterByName.get(step.encounter);
      if (!roster) continue;
      let rosterHit = false;
      for (const m of roster) {
        if (variantsOverlap(nameVariants(m), killedVariants)) { rosterHit = true; break; }
      }
      if (!rosterHit) continue;

      const prev = state.stepKills[i] ?? 0;
      const now = prev + 1;
      state.stepKills[i] = now;
      if (now >= step.targetCount) {
        state.stepProgress[i] = true;
        stepCompleted = true;
        messages.push(`Quest "${def.name}": ${step.description} — Complete!`);
        const willCompleteQuest = state.stepProgress.every((p) => p);
        callouts.push({
          questName: def.name,
          description: step.description,
          questComplete: willCompleteQuest,
        });
      } else {
        messages.push(`${step.encounter} defeated! (${now}/${step.targetCount})`);
      }
    }

    if (stepCompleted && state.stepProgress.every((p) => p)) {
      // status was "active" at the loop guard above; TS narrows it
      // here, so we can flip directly without re-checking.
      state.status = "completed";
      newlyCompleted.push(def.name);
      messages.push("All steps done! Return to the quest giver for your reward.");
    }
  }
  return { messages, newlyCompleted, callouts };
}

export interface CollectCreditResult {
  message: string;
  /** True when this credit completed the quest. */
  questNowCompleted: boolean;
  /** Banner payload for the credited step. Null only when the
   *  quest / step weren't found (the message becomes a generic
   *  pickup line in that case). */
  callout: QuestStepCallout | null;
}

/**
 * Credit a single collect step. Returns a UI message and a flag for
 * whether the quest just transitioned to `completed`. The caller is
 * responsible for removing the artifact from the world (mirrors the
 * Python `collect_quest_item` contract).
 */
export function creditCollect(
  defs: QuestDef[],
  states: Map<string, QuestState>,
  questName: string,
  stepIdx: number,
  itemName: string,
): CollectCreditResult {
  const def = findQuest(defs, questName);
  const state = states.get(questName);
  if (!def || !state) return { message: `Found ${itemName}!`, questNowCompleted: false, callout: null };
  if (stepIdx < 0 || stepIdx >= state.stepProgress.length) {
    return { message: `Found ${itemName}!`, questNowCompleted: false, callout: null };
  }
  state.stepProgress[stepIdx] = true;
  const stepDesc = def.steps[stepIdx]?.description ?? `Step ${stepIdx + 1}`;
  const allDone = state.stepProgress.every((p) => p);
  if (allDone && state.status === "active") {
    state.status = "completed";
    return {
      message: `Collected ${itemName}! Quest "${def.name}" complete — return to ${def.giverNpc}.`,
      questNowCompleted: true,
      callout: { questName: def.name, description: stepDesc, questComplete: true },
    };
  }
  return {
    message: `Collected ${itemName}! (${stepDesc})`,
    questNowCompleted: false,
    callout: { questName: def.name, description: stepDesc, questComplete: false },
  };
}

/**
 * Find the active quest + step that wants its `collect_item` placed
 * at the given `dungeonName`. Used by the dungeon generator to know
 * whether to paint a TILE_ARTIFACT and where.
 *
 * Returns the first match — modules are authored such that one
 * dungeon hosts at most one collect step at a time.
 */
export function activeCollectStepFor(
  defs: QuestDef[],
  states: Map<string, QuestState>,
  combatLocation: string,
): { questName: string; stepIdx: number; step: QuestStep } | null {
  for (const def of defs) {
    const state = states.get(def.name);
    if (!state || state.status !== "active") continue;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (step.stepType !== "collect") continue;
      if (state.stepProgress[i]) continue;
      if (!locationMatches(step.spawnLocation, combatLocation)) continue;
      return { questName: def.name, stepIdx: i, step };
    }
  }
  return null;
}

/**
 * Every active collect step whose `spawn_location` resolves to the
 * given `combatLocation` (per `locationMatches`). Companion to
 * `activeKillStepsForLocation` — TownScene calls this when entering a
 * building space (or interior) to figure out which artifacts to drop
 * on the floor. A single space hosts at most one collect step in v1,
 * but we return a list so a future module that pins two artifacts to
 * the same room (e.g. the binding-rite + the keystone) doesn't lose
 * one silently.
 */
export function activeCollectStepsForLocation(
  defs: QuestDef[],
  states: Map<string, QuestState>,
  combatLocation: string,
): Array<{ questName: string; stepIdx: number; step: QuestStep }> {
  const out: Array<{ questName: string; stepIdx: number; step: QuestStep }> = [];
  for (const def of defs) {
    const state = states.get(def.name);
    if (!state || state.status !== "active") continue;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (step.stepType !== "collect") continue;
      if (state.stepProgress[i]) continue;
      if (!locationMatches(step.spawnLocation, combatLocation)) continue;
      out.push({ questName: def.name, stepIdx: i, step });
    }
  }
  return out;
}

/**
 * Every active kill step whose `spawn_location` resolves to the given
 * `combatLocation` (per `locationMatches`). Used by TownScene on
 * interior entry to figure out which encounters to spawn — and how
 * many copies of each — so a player who accepted "Rat Problem" sees
 * the rats actually appear in the shop floor.
 */
export function activeKillStepsForLocation(
  defs: QuestDef[],
  states: Map<string, QuestState>,
  combatLocation: string,
): Array<{ questName: string; stepIdx: number; step: QuestStep; remaining: number }> {
  const out: Array<{ questName: string; stepIdx: number; step: QuestStep; remaining: number }> = [];
  for (const def of defs) {
    const state = states.get(def.name);
    if (!state || state.status !== "active") continue;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (step.stepType !== "kill") continue;
      if (state.stepProgress[i]) continue;
      if (!step.encounter) continue;
      if (!locationMatches(step.spawnLocation, combatLocation)) continue;
      const done = state.stepKills[i] ?? 0;
      const remaining = Math.max(0, step.targetCount - done);
      if (remaining <= 0) continue;
      out.push({ questName: def.name, stepIdx: i, step, remaining });
    }
  }
  return out;
}

/** One row per active kill step that wants encounters spawned at
 *  `loc`. Returned by {@link activeKillStepsAt} — the v2-structured
 *  successor to {@link activeKillStepsForLocation}. */
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
  /** Back-reference to the step itself, for callers that need
   *  additional fields (description, tags, etc.). */
  step: QuestStep;
}

/**
 * Every active kill step whose v2-structured `locationKind` /
 * `mapId` / `dungeonId` / `dungeonLevel` matches the current
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
      out.push({
        questId: def.id,
        stepIdx: i,
        encounterId: step.encounterId,
        remaining,
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
  return { questId, stepIdx, step, killsSoFar, stepCompleted, questCompleted };
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
  return { questId, stepIdx, step, stepCompleted: true, questCompleted };
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
 *
 * Combined with {@link applyWorldUnlocks} (which runs on map load
 * for already-turned-in quests), this is the complete turn-in
 * surface: claimQuestRewards handles the one-shot grants;
 * applyWorldUnlocks handles the persistent tile mutations.
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

// ── World-unlock application ───────────────────────────────────

/**
 * Display name for a tile id — falls back to "Tile <id>" when the
 * runtime def table doesn't recognise it. Mirrors the Python
 * `world_unlock_tile_name` so reward summary text reads identically
 * across the two ports ("World changed: Bridge at (5,13)").
 */
export function worldUnlockTileName(tileId: number): string {
  const name = tileDef(tileId).name;
  return name && name !== "Unknown" ? name : `Tile ${tileId}`;
}

/**
 * Apply a list of world-unlock ops to *tileMap* in place. Returns
 * the entries that actually landed — useful for the reward summary
 * the turn-in dialog shows. Bad / out-of-bounds entries are skipped
 * silently so a malformed quests.json never crashes a run.
 *
 * Mirrors `apply_world_unlocks` in `src/module_editor_quest.py`.
 */
export function applyWorldUnlocks(
  tileMap: TileMap | null | undefined,
  unlocks: readonly WorldUnlock[] | null | undefined,
): AppliedUnlock[] {
  const applied: AppliedUnlock[] = [];
  if (!tileMap || !unlocks || unlocks.length === 0) return applied;
  for (const op of unlocks) {
    if (!op || typeof op !== "object") continue;
    const c = op.col;
    const r = op.row;
    const t = op.tile;
    if (!Number.isFinite(c) || !Number.isFinite(r) || !Number.isFinite(t)) continue;
    if (c < 0 || c >= tileMap.width || r < 0 || r >= tileMap.height) continue;
    tileMap.setTile(c, r, t);
    applied.push([c, r, t]);
  }
  return applied;
}

/**
 * Re-apply every turned-in quest's world unlocks to the overworld
 * tile map. Called by OverworldScene after `loadTileMap()` so the
 * reward survives the natural "fetch fresh JSON on every scene
 * boot" lifecycle of the web port — same idempotent design the
 * Python game's save/load path uses (see
 * `_apply_turned_in_world_unlocks` in `src/save_load.py`).
 *
 * Returns the flat list of applied triples in the order they were
 * walked, mainly for tests and the resume-time reward log.
 */
export function applyTurnedInWorldUnlocks(
  tileMap: TileMap | null | undefined,
  defs: QuestDef[],
  states: Map<string, QuestState>,
): AppliedUnlock[] {
  const applied: AppliedUnlock[] = [];
  if (!tileMap) return applied;
  for (const def of defs) {
    if (def.rewardWorldUnlocks.length === 0) continue;
    const state = states.get(def.name);
    if (!state || state.status !== "turned_in") continue;
    for (const a of applyWorldUnlocks(tileMap, def.rewardWorldUnlocks)) {
      applied.push(a);
    }
  }
  return applied;
}

/**
 * Build a short description of an applied world-unlock list — used
 * by the turn-in reward summary line. Single-tile unlocks name the
 * tile and coords ("Bridge at (5,13)"); multi-tile unlocks roll up
 * to a count to keep the dialog from overflowing.
 */
export function summariseUnlocks(applied: readonly AppliedUnlock[]): string {
  if (applied.length === 0) return "";
  if (applied.length === 1) {
    const [c, r, t] = applied[0];
    return `World changed: ${worldUnlockTileName(t)} at (${c},${r})`;
  }
  return `World changed: ${applied.length} tiles updated`;
}

// ── Misc helpers ────────────────────────────────────────────────

/**
 * Build a short adventurer's-note line listing the dungeons referenced
 * by a quest's steps + a hint when a guardian fight is coming. Empty
 * string when the quest doesn't go into any dungeon.
 *
 * Mirrors `build_quest_location_hint` in quest_manager.py.
 */
export function locationHint(def: QuestDef): string {
  const dungeons: string[] = [];
  let hasGuardian = false;
  for (const step of def.steps) {
    if (step.spawnLocation.startsWith("dungeon:")) {
      const name = step.spawnLocation.slice("dungeon:".length).trim();
      if (name && !dungeons.includes(name)) dungeons.push(name);
    }
    if (step.hasGuardian) hasGuardian = true;
  }
  if (dungeons.length === 0) return "";
  let line: string;
  if (dungeons.length === 1) {
    line = `[Adventurer's Note: This quest will take you into the ${dungeons[0]} dungeon — tread carefully.]`;
  } else {
    const head = dungeons.slice(0, -1).join(", ");
    const tail = dungeons[dungeons.length - 1];
    line = `[Adventurer's Note: This quest will take you into the following dungeons: ${head} and ${tail}.]`;
  }
  if (hasGuardian) {
    line = line.slice(0, -1) + " A powerful guardian is said to watch over what you seek.]";
  }
  return line;
}

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
