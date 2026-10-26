"use client";
import { useId, useState } from "react";
import type { GridCellProps, GridMove } from "./grid-keys";

interface Cell {
  rowId: string;
  columnId: string;
}

/**
 * The grid's roving selection. The grid is one tab stop: the selected cell,
 * or the first one when the selection scrolled off the page or its column
 * was hidden. Moving focuses the target cell, whose focus handler selects it.
 */
export function useGridFocus(rowIds: string[], columnIds: string[]) {
  const gridId = useId();
  const [activeCell, setActiveCell] = useState<Cell | null>(null);
  const cellId = (rowId: string, columnId: string) =>
    `${gridId}-${rowId}-${columnId}`;
  const tabStop =
    activeCell &&
    rowIds.includes(activeCell.rowId) &&
    columnIds.includes(activeCell.columnId)
      ? activeCell
      : rowIds[0] && columnIds[0]
        ? { rowId: rowIds[0], columnId: columnIds[0] }
        : null;

  function navigate(
    rowIndex: number,
    columnIndex: number,
    move: GridMove,
  ): boolean {
    const rowId =
      rowIds[rowIndex + (move === "up" ? -1 : move === "down" ? 1 : 0)];
    const columnId =
      columnIds[
        columnIndex + (move === "left" ? -1 : move === "right" ? 1 : 0)
      ];
    const target =
      rowId && columnId && document.getElementById(cellId(rowId, columnId));
    if (!target) return false;
    target.focus();
    return true;
  }

  /** The props a cell at this position needs to join the selection. */
  function cellProps(
    rowIndex: number,
    columnIndex: number,
  ): Omit<GridCellProps, "className"> {
    const rowId = rowIds[rowIndex];
    const columnId = columnIds[columnIndex];
    return {
      id: cellId(rowId, columnId),
      active: activeCell?.rowId === rowId && activeCell.columnId === columnId,
      tabbable: tabStop?.rowId === rowId && tabStop.columnId === columnId,
      onActivate: () => setActiveCell({ rowId, columnId }),
      onNavigate: (move) => navigate(rowIndex, columnIndex, move),
    };
  }

  return { gridId, cellProps };
}
