/**
 * Pure reducer for the Map Editor's multi-cell selection.
 *
 * The editor lets authors Cmd-click (macOS) / Ctrl-click (Windows /
 * Linux) in Inspect mode to select several cells at once and edit their
 * attributes together. This module holds the membership logic in one
 * testable place; the React component just feeds it pointer events.
 *
 * Selection is an ORDERED list — the last entry is the "anchor", the
 * cell whose attribute values the inspector displays. A plain click
 * replaces the selection with a single cell; additive interactions
 * extend it.
 */

export interface CellCoord {
  col: number;
  row: number;
}

export interface SelectOpts {
  /** True when the user held Cmd/Ctrl — extend instead of replace. */
  additive?: boolean;
  /** True when this came from a drag-over (pointermove) rather than an
   *  initial press. An additive drag only ADDS cells (so sweeping the
   *  cursor doesn't toggle a cell off as the pointer re-enters it); an
   *  additive single click toggles membership. */
  drag?: boolean;
}

const keyOf = (c: CellCoord): string => `${c.col},${c.row}`;

/**
 * Compute the next selection given the current one and a touched cell.
 *
 *  - Not additive → replace with just `[cell]`.
 *  - Additive + drag → union (add if absent, otherwise unchanged).
 *  - Additive + click → toggle (remove if present, else append).
 *
 * The returned array is always a fresh reference when it differs, and
 * the SAME reference when an additive drag re-touches an already-member
 * cell (so callers using it as React state avoid a needless update).
 */
export function nextCellSelection(
  prev: ReadonlyArray<CellCoord>,
  cell: CellCoord,
  opts: SelectOpts = {},
): CellCoord[] {
  const { additive = false, drag = false } = opts;
  if (!additive) {
    return [{ col: cell.col, row: cell.row }];
  }
  const key = keyOf(cell);
  const has = prev.some((s) => keyOf(s) === key);
  if (drag) {
    return has
      ? (prev as CellCoord[])
      : [...prev, { col: cell.col, row: cell.row }];
  }
  return has
    ? prev.filter((s) => keyOf(s) !== key)
    : [...prev, { col: cell.col, row: cell.row }];
}

/** The anchor cell (last selected) or null when nothing is selected. */
export function anchorCell(
  selection: ReadonlyArray<CellCoord>,
): CellCoord | null {
  return selection.length > 0 ? selection[selection.length - 1] : null;
}
