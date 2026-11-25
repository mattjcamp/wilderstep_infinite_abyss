/**
 * Dungeon Master Mode navigation groups — one source of truth for the
 * editor sidebar and the module landing page, so both list the
 * editors in the same groups and order.
 *
 * An entry is either a data model (routes to /editor/model?k=<key>)
 * or one of the standalone pages (sprites, soundtrack, battle and
 * dungeon sims).
 * Every ModelKey must appear exactly once (pinned by editorNav.test).
 */

import { MODELS, type ModelKey } from "@/data_model/models";
import {
  editorBattleSimHref,
  editorDungeonSimHref,
  editorModelHref,
  editorSoundtrackHref,
  editorSpritesHref,
} from "./moduleRoutes";

export type NavPage = "sprites" | "soundtrack" | "battle" | "dungeon";

export type NavEntry =
  | { kind: "model"; key: ModelKey }
  | { kind: "page"; page: NavPage };

export interface NavGroup {
  label: string;
  entries: NavEntry[];
}

const m = (key: ModelKey): NavEntry => ({ kind: "model", key });
const p = (page: NavPage): NavEntry => ({ kind: "page", page });

export const EDITOR_NAV_GROUPS: NavGroup[] = [
  {
    label: "World",
    entries: [
      m("maps"),
      m("quests"),
      m("dungeons"),
      m("log_events"),
      m("lore"),
      m("npcs"),
      m("counters"),
      m("traps"),
    ],
  },
  {
    label: "Enemies",
    entries: [
      m("monsters"),
      m("monster_abilities"),
      m("encounters"),
      m("spawns"),
    ],
  },
  {
    label: "Assets",
    entries: [m("items"), m("map_tiles"), m("fx"), p("sprites"), p("soundtrack")],
  },
  {
    label: "Players",
    entries: [
      m("character_classes"),
      m("spells"),
      m("abilities"),
      m("effects"),
      m("recipes"),
      m("races"),
      m("characters"),
      m("party"),
    ],
  },
  {
    label: "Simulations",
    entries: [p("battle"), p("dungeon")],
  },
];

const PAGES: Record<
  NavPage,
  { label: string; blurb: string; pathname: string; href: (id: string) => string }
> = {
  sprites: {
    label: "Sprites",
    blurb:
      "PNG assets grouped by category — what art is available to reference from data records",
    pathname: "/editor/sprites",
    href: editorSpritesHref,
  },
  soundtrack: {
    label: "Soundtrack",
    blurb:
      "Audio tracks grouped by context (combat, dungeon, overworld, town) — what music is available to reference",
    pathname: "/editor/soundtrack",
    href: editorSoundtrackHref,
  },
  battle: {
    label: "Battle",
    blurb:
      "Pick an encounter + arena and run the ported combat scene end-to-end against the module's party.",
    pathname: "/editor/sim/battle",
    href: editorBattleSimHref,
  },
  dungeon: {
    label: "Dungeon",
    blurb:
      "Procedurally generate a floor from a Dungeon record and walk the party through it.",
    pathname: "/editor/sim/dungeon",
    href: (id) => editorDungeonSimHref(id),
  },
};

/** Display info for one entry: stable key, label, blurb and link. */
export function navEntryInfo(
  entry: NavEntry,
  moduleId: string,
): { id: string; label: string; blurb: string; href: string } {
  if (entry.kind === "model") {
    const def = MODELS[entry.key];
    return {
      id: entry.key,
      label: def.label,
      blurb: def.blurb,
      href: editorModelHref(moduleId, entry.key),
    };
  }
  const page = PAGES[entry.page];
  return {
    id: entry.page,
    label: page.label,
    blurb: page.blurb,
    href: page.href(moduleId),
  };
}

/** True when `entry` is the page currently shown. Models match on the
 *  /editor/model route's `k` param; pages match on pathname. */
export function isNavEntryActive(
  entry: NavEntry,
  pathname: string,
  modelKeyParam: string | null,
): boolean {
  if (entry.kind === "model") {
    return pathname === "/editor/model" && modelKeyParam === entry.key;
  }
  return pathname === PAGES[entry.page].pathname;
}
