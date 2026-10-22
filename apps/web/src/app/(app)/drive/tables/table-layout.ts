import type { TableColumn } from "@sokosumi/core-client";

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

export function columnWidth(column: Pick<TableColumn, "type" | "width">) {
  return column.width ?? DEFAULT_WIDTH[column.type];
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
