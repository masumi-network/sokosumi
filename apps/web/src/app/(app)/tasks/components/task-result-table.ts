import { createDataTableSchema, tableInsertRowSchema } from "@sokosumi/utils";
import {
  isNumericCsvColumn,
  tableImportBatches,
} from "@/app/drive/tables/table-import";

const MAX_COLUMNS = 100;
const NAME_MAX = 100;
const TITLE_MAX = 160;
const CELL_MAX = 20000;

/**
 * A table from a Task's activity, as the reader sees it (header row first), planned as a new Files Table:
 * the create request and its rows in keyed batches, so a retry with the same plan saves nothing twice.
 * A column turns Number only when every value converts without loss; codes, amounts with symbols and
 * anything else ambiguous stay Text, exactly as written.
 */
export function taskResultTablePlan(
  cells: string[][],
  source: { title: string; description: string; projectId: string | null },
  untitled: (position: number) => string,
  key: string,
) {
  const [header = [], ...body] = cells;
  const rows = body.filter((row) => row.some((cell) => cell.trim()));
  const columns = header.slice(0, MAX_COLUMNS).map((raw, i) => {
    const name = raw.trim().slice(0, NAME_MAX) || untitled(i + 1);
    return {
      id: crypto.randomUUID(),
      name,
      type: isNumericCsvColumn(
        name,
        rows.map((row) => row[i] ?? ""),
      )
        ? ("number" as const)
        : ("text" as const),
    };
  });
  const table = createDataTableSchema.parse({
    key,
    ...source,
    title: source.title.slice(0, TITLE_MAX),
    columns,
  });
  const insert = rows.map((row) =>
    tableInsertRowSchema.parse({
      values: Object.fromEntries(
        columns.flatMap(({ id, type }, i) => {
          const value = row[i]?.trim() ?? "";
          if (!value) return [];
          return [
            [id, type === "number" ? Number(value) : value.slice(0, CELL_MAX)],
          ];
        }),
      ),
    }),
  );
  return { table, batches: tableImportBatches(key, insert) };
}
