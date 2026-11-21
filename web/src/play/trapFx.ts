/**
 * Which FX a trap plays and where it comes from.
 *
 * A trap names an fx.json record by `fx_id` (picked in the Trap editor).
 * Traps without one fall back to a themed default by `damage_type`, and
 * finally to the old plain burst (the caller's fallback when this
 * returns "").
 *
 * Projectile visuals (darts, a jet of flame) need somewhere to come
 * FROM: `trapFxOrigin` picks the nearest wall in a random direction —
 * the hidden dart slot or flame vent — up to 4 cells away, so the shot
 * flies in from the wall and lands on the trap.
 */

/** Default FX by damage type for traps with no `fx_id`. */
const DEFAULT_TRAP_FX: Record<string, string> = {
  piercing: "trap_darts",
  slashing: "trap_darts",
  fire: "trap_fire",
  magic: "teleport_blink",
};

export function trapFxId(
  trap: { fx_id?: string | null; damage_type?: string; trap_type?: string } | null,
): string {
  if (!trap) return "";
  const own = (trap.fx_id ?? "").trim();
  if (own) return own === "none" ? "" : own;
  if (trap.trap_type === "teleport") return "teleport_blink";
  return DEFAULT_TRAP_FX[trap.damage_type ?? ""] ?? "";
}

type GridCell = { walkable?: boolean } | string | null | undefined;

/** Where a projectile trap shot starts: the first wall (non-walkable
 *  cell) found going out from the trap, in a random one of the
 *  directions that has one within `reach` cells. No wall nearby → a
 *  spot `reach - 1` cells to the left. */
export function trapFxOrigin(
  grid: ReadonlyArray<ReadonlyArray<GridCell>> | undefined,
  col: number,
  row: number,
  rng: () => number = Math.random,
  reach = 4,
): { col: number; row: number } {
  const found: Array<{ col: number; row: number }> = [];
  for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    for (let k = 1; k <= reach; k++) {
      const c = col + dc * k;
      const r = row + dr * k;
      const cell = grid?.[r]?.[c];
      if (cell === undefined || cell === null) break;
      if (typeof cell === "object" && cell.walkable === false) {
        found.push({ col: c, row: r });
        break;
      }
    }
  }
  if (found.length === 0) return { col: col - (reach - 1), row };
  return found[Math.floor(rng() * found.length)];
}
