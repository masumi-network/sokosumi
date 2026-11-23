import type {
  PostDriveTablesByIdQueryData,
  TableColumn,
} from "@sokosumi/core-client";
import { encodeTableCsv } from "@sokosumi/utils";
import { dataTableService } from "@/lib/services/data-table.client";

type TableQuery = Omit<
  NonNullable<PostDriveTablesByIdQueryData["body"]>,
  "limit" | "cursor"
>;

/** The most rows one CSV holds; the Table's own export says so. */
const TABLE_CSV_ROW_LIMIT = 10_000;

/** The CSV of a Table's rows in the given view, or null over the row limit. */
export async function tableCsv(
  tableId: string,
  columns: TableColumn[],
  query: TableQuery,
): Promise<string | null> {
  const output: unknown[][] = [columns.map((column) => column.name)];
  let cursor: string | undefined;
  do {
    const page = await dataTableService.query(tableId, {
      ...query,
      limit: 100,
      cursor,
    });
    output.push(
      ...page.rows.map((row) =>
        columns.map((column) =>
          column.type === "last_updated"
            ? new Date(row.updatedAt).toISOString()
            : row.values[column.id],
        ),
      ),
    );
    cursor = page.nextCursor ?? undefined;
    if (output.length > TABLE_CSV_ROW_LIMIT + 1) return null;
  } while (cursor);
  return encodeTableCsv(output);
}

/**
 * A snapshot of the whole Table (every live row and column, no view) as a CSV
 * file named with today's date, so a reader can tell it from the live Table.
 */
export async function tableCsvFile(
  tableId: string,
  now: Date,
): Promise<File | null> {
  const table = await dataTableService.get(tableId);
  const csv = await tableCsv(table.id, table.columns, { archived: false });
  if (csv === null) return null;
  // sv-SE formats a local date as YYYY-MM-DD.
  const day = now.toLocaleDateString("sv-SE");
  return new File([csv], `${table.title} (${day}).csv`, { type: "text/csv" });
}
