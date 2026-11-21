/**
 * Room furnishings → palette tiles. The generator's room-roles pass
 * (src/battle/world/dungeonRooms.ts) records props by kind; this table
 * says which Tile Palette entry draws each kind and how the cell
 * behaves. The furnishings are shared art (the palette's `objects`,
 * the Shop tables, the Manor rugs, the town statue and gravestones),
 * so every dungeon style uses the same ids.
 */

import type { PropKind } from "@/battle/world/dungeonRooms";

export interface PropInfo {
  paletteId: string;
  name: string;
  /** Blocks sight (tall things: statues, lanterns on posts). */
  obstructs?: boolean;
  /** Light it gives off, in cells. */
  light?: number;
  animation?: "torch";
}

export const PROP_INFO: Record<PropKind, PropInfo> = {
  crate: { paletteId: "object_crate", name: "Crate" },
  crates_stack: { paletteId: "shop_crates", name: "Stacked Crates" },
  barrel: { paletteId: "object_barrel", name: "Barrel" },
  barrel_large: { paletteId: "object_barrel_1", name: "Large Barrel" },
  barrel_small: { paletteId: "object_barrel_small", name: "Small Barrel" },
  pots: { paletteId: "object_pots", name: "Clay Pots" },
  table_l: { paletteId: "shop_table_h_left", name: "Table" },
  table_m: { paletteId: "shop_table_h_mid", name: "Table" },
  table_r: { paletteId: "shop_table_h_right", name: "Table" },
  table: { paletteId: "shop_table_single", name: "Table" },
  bench: { paletteId: "object_bench_2", name: "Bench" },
  trough: { paletteId: "object_trough", name: "Trough" },
  lantern: { paletteId: "object_lantern", name: "Lantern", obstructs: true, light: 3 },
  brazier: { paletteId: "object_brazier", name: "Brazier", light: 4, animation: "torch" },
  book: { paletteId: "object_book", name: "Open Book" },
  book_closed: { paletteId: "object_book_closed", name: "Book" },
  bones: { paletteId: "object_bones", name: "Bones" },
  statue_top: { paletteId: "town_statue_r0c0", name: "Statue", obstructs: true },
  statue_base: { paletteId: "town_statue_r1c0", name: "Statue", obstructs: true },
  gravestone: { paletteId: "town_gravestone", name: "Gravestone" },
  plant: { paletteId: "manor_potted_plant", name: "Potted Plant" },
  armchair: { paletteId: "manor_grand_chair", name: "Armchair" },
  rug_tl: { paletteId: "manor_rug_corner_tl", name: "Rug" },
  rug_t: { paletteId: "manor_rug_top", name: "Rug" },
  rug_tr: { paletteId: "manor_rug_corner_tr", name: "Rug" },
  rug_l: { paletteId: "manor_rug_left", name: "Rug" },
  rug_c: { paletteId: "manor_rug_centre", name: "Rug" },
  rug_r: { paletteId: "manor_rug_right", name: "Rug" },
  rug_bl: { paletteId: "manor_rug_corner_bl", name: "Rug" },
  rug_b: { paletteId: "manor_rug_bottom", name: "Rug" },
  rug_br: { paletteId: "manor_rug_corner_br", name: "Rug" },
  rug_runner: { paletteId: "manor_rug_runner", name: "Rug" },
};

/** Every palette id a furnished room can use (for sprite preloading). */
export const PROP_PALETTE_IDS: readonly string[] = [
  ...new Set(Object.values(PROP_INFO).map((p) => p.paletteId)),
];
