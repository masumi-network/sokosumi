import type { TableColumn } from "@sokosumi/core-client";
import { TABLE_COLUMN_WIDTH } from "@sokosumi/utils";

/** The row-number column, which also holds each row's drag handle and checkbox. */
export const ROW_NUMBER_WIDTH = 64;
/** Arrow keys on a resize handle move the edge by this much. */
export const RESIZE_STEP = 16;
/** Fit-to-content never grows a column past this, so one long value cannot take the screen. */
const FIT_MAX = 480;

const DEFAULT_WIDTH: Record<TableColumn["type"], number> = {
  text: 200,
  long_text: 320,
  number: 120,
  date: 140,
  checkbox: 100,
  url: 220,
  email: 220,
  single_select: 160,
  multiple_select: 220,
  last_updated: 176,
};

export type ColumnLayout = Partial<Pick<TableColumn, "width" | "wrap">>;

export function clampColumnWidth(width: number): number {
  return Math.min(
    TABLE_COLUMN_WIDTH.max,
    Math.max(TABLE_COLUMN_WIDTH.min, Math.round(width)),
  );
}

export function columnWidth(column: Pick<TableColumn, "type" | "width">) {
  return column.width ?? DEFAULT_WIDTH[column.type];
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

/**
 * How a cell lays out a value too long for its width. `clamp` is the default
 * for long text: two lines, so a row stays scannable. An explicit choice wins:
 * wrap shows the whole value, clip keeps one line with an ellipsis.
 */
export type CellWrap = "clip" | "clamp" | "wrap";
export function cellWrap(column: Pick<TableColumn, "type" | "wrap">): CellWrap {
  if (column.wrap === true) return "wrap";
  if (column.wrap === false) return "clip";
  return column.type === "long_text" ? "clamp" : "clip";
}
