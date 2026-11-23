import type { TableColumn, TableRow, TableView } from "@sokosumi/core-client";

/** One summary group's value. `[]` is a multiple select stored with no options. */
type Value = string | number | boolean | null | [];
/** A number column's total, or null when no row in it holds a number. */
type Sums = (number | null)[];
export type TableSummaryGroup = { value: Value; count: number; sums: Sums };
export type TableSummary = {
  groups: TableSummaryGroup[];
  total: { count: number; sums: Sums };
};

/** Column types a summary groups by; free text and timestamps rarely repeat. */
export const SUMMARY_GROUP_TYPES = new Set<TableColumn["type"]>([
  "single_select",
  "multiple_select",
  "checkbox",
  "text",
  "number",
  "date",
  "email",
  "url",
]);

function add(sums: Sums, row: TableRow, numbers: TableColumn[]) {
  numbers.forEach((column, index) => {
    const value = row.values[column.id];
    if (typeof value === "number") sums[index] = (sums[index] ?? 0) + value;
  });
}

/**
 * Rows counted per value of one column, with every number column totalled
 * per value. A multiple-select row counts under each of its options, so the
 * groups can add up to more than the total. Largest group first, empty last.
 */
export function summarizeTableRows(
  rows: TableRow[],
  column: TableColumn,
  numbers: TableColumn[],
): TableSummary {
  const groups = new Map<string, TableSummaryGroup>();
  const total = { count: rows.length, sums: numbers.map(() => null) as Sums };
  for (const row of rows) {
    const cell = row.values[column.id] ?? null;
    // Missing, `[]` and `""` stay apart: Core's empty filter matches only
    // missing and null, so each group must be one filter's exact rows.
    const values: Value[] = Array.isArray(cell)
      ? cell.length
        ? cell
        : [[]]
      : [cell];
    for (const value of values) {
      const key = JSON.stringify(value);
      let group = groups.get(key);
      if (!group) {
        group = { value, count: 0, sums: numbers.map(() => null) };
        groups.set(key, group);
      }
      group.count += 1;
      add(group.sums, row, numbers);
    }
    add(total.sums, row, numbers);
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        Number(a.value === null) - Number(b.value === null) ||
        b.count - a.count ||
        String(a.value).localeCompare(String(b.value)),
    ),
    total,
  };
}

type TableFilter = NonNullable<TableView["definition"]["filters"]>[number];

/** The view filter that shows exactly the rows one summary group counted. */
export function summaryFilter(column: TableColumn, value: Value): TableFilter {
  if (value === null) return { columnId: column.id, operator: "empty" };
  if (column.type === "multiple_select" && typeof value === "string")
    return { columnId: column.id, operator: "contains", value: [value] };
  return { columnId: column.id, operator: "equals", value };
}
