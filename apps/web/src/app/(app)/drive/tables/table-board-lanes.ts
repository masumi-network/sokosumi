import type { TableColumn, TableRow } from "@sokosumi/core-client";

/** A lane's option; null is the lane of rows with no value. */
export type BoardValue = string | null;
export interface BoardLane {
  value: BoardValue;
  rows: TableRow[];
}

/** One lane per option in option order, then values no option names, then unset. */
export function boardLanes(
  rows: TableRow[],
  column: Pick<TableColumn, "id" | "options">,
): BoardLane[] {
  const lanes = new Map<BoardValue, TableRow[]>(
    (column.options ?? []).map((option) => [option, []]),
  );
  const unset: TableRow[] = [];
  for (const row of rows) {
    const value = row.values[column.id];
    if (typeof value !== "string" || !value) unset.push(row);
    else lanes.set(value, [...(lanes.get(value) ?? []), row]);
  }
  return [
    ...[...lanes].map(([value, rows]) => ({ value, rows })),
    { value: null, rows: unset },
  ];
}
