import { TABLE_COLUMN_WIDTH } from "@sokosumi/utils";

/** The row-number column, which also holds each row's handle and checkbox. */
export const ROW_NUMBER_WIDTH = 64;
/** Arrow keys on a resize handle move the edge by this much. */
export const RESIZE_STEP = 16;
/** Fit-to-content never grows a column past this, so one long value cannot take the screen. */
const FIT_MAX = 480;

export function clampColumnWidth(width: number): number {
  return Math.min(
    TABLE_COLUMN_WIDTH.max,
    Math.max(TABLE_COLUMN_WIDTH.min, Math.round(width)),
  );
}

/** The width that shows the widest measured content, within the fit cap. */
export function fitColumnWidth(needs: number[]): number {
  return clampColumnWidth(Math.min(FIT_MAX, Math.ceil(Math.max(0, ...needs))));
}

/**
 * What each rendered cell of a column needs to show its `[data-fit]` content
 * on one line: the content's natural width (its longest line, for wrapped
 * text) plus the cell's inset on both sides.
 */
export function measureColumnNeeds(cells: Iterable<HTMLElement>): number[] {
  const canvas = document.createElement("canvas").getContext("2d");
  const needs: number[] = [];
  for (const cell of cells) {
    const content = cell.querySelector<HTMLElement>("[data-fit]");
    if (!content) continue;
    let natural = content.scrollWidth;
    if (canvas && content.textContent) {
      canvas.font = getComputedStyle(content).font;
      for (const line of content.textContent.split("\n"))
        natural = Math.max(natural, canvas.measureText(line).width);
    }
    const box = cell.getBoundingClientRect();
    const inner = content.getBoundingClientRect();
    const inset =
      getComputedStyle(cell).direction === "rtl"
        ? box.right - inner.right
        : inner.left - box.left;
    needs.push(natural + 2 * inset + 2);
  }
  return needs;
}

/** Fits a column to the widest `[data-fit]` content its rendered cells hold. */
export function fitGridColumn(
  grid: HTMLElement | null,
  columnId: string,
): number | null {
  const cells = grid?.querySelectorAll<HTMLElement>(
    `[data-column="${columnId}"]`,
  );
  return cells ? fitColumnWidth(measureColumnNeeds(cells)) : null;
}
