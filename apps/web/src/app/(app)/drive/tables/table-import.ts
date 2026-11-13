import type { TableColumn } from "@sokosumi/core-client";
import {
  readCsvRows,
  tableBatchSchema,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import type { z } from "zod";
import { parseTableInput } from "./table-value";

type ImportColumn = Pick<TableColumn, "id" | "name" | "type"> & {
  options?: string[];
};

/** Deterministic chunks leave headroom for the Core operation envelope as well as HTTP JSON. */
export function tableImportBatches(
  key: string,
  rows: z.infer<typeof tableInsertRowSchema>[],
) {
  const batches: z.infer<typeof tableBatchSchema>[] = [];
  let offset = 0;
  while (offset < rows.length) {
    const batch: z.infer<typeof tableBatchSchema> = {
      key: `${key}:${offset}`,
      insert: [],
      patch: [],
    };
    while (offset < rows.length && batch.insert.length < 100) {
      batch.insert.push(rows[offset]);
      if (
        new TextEncoder().encode(JSON.stringify(batch)).byteLength > 990_000
      ) {
        batch.insert.pop();
        if (!batch.insert.length)
          throw new Error("Table requests are limited to 1 MB");
        break;
      }
      offset++;
    }
    batches.push(tableBatchSchema.parse(batch));
  }
  return batches;
}

/**
 * Text rows as rows to insert, one text cell per column in order. A Last
 * updated column fills itself, so its cells are dropped. `rowError` names the
 * row a value fails in.
 */
export function tableInsertRows(
  columns: ImportColumn[],
  rows: string[][],
  rowError: (index: number, error: unknown) => Error,
) {
  const definitions = columns.map((column) => ({
    ...column,
    description: "",
    options: column.options ?? [],
  }));
  return rows.map((row, index) => {
    try {
      const parsed = tableInsertRowSchema.parse({
        values: Object.fromEntries(
          definitions.flatMap((column, i) =>
            column.type === "last_updated"
              ? []
              : [[column.id, parseTableInput(column, row[i] ?? "")]],
          ),
        ),
      });
      validateTableValues(definitions, parsed.values, parsed.evidence);
      return parsed;
    } catch (error) {
      throw rowError(index, error);
    }
  });
}

/** Clipboard text that holds more than one spreadsheet cell. */
export function isPastedRange(text: string, column: Pick<TableColumn, "type">) {
  const range = text.replace(/\r?\n$/, "");
  // One long text value may hold its own line breaks.
  return (
    range.includes("\t") || (column.type !== "long_text" && /\n/.test(range))
  );
}

/**
 * Cells copied from a spreadsheet, laid onto `columns` from the left. A first
 * row that repeats the column names is a header and is left out.
 */
export function pastedTableRows(columns: ImportColumn[], text: string) {
  const rows = readCsvRows(text, { delimiter: "\t" });
  const names = columns.map((column) => column.name.trim().toLowerCase());
  const header =
    rows.length > 1 &&
    rows[0].every((cell, i) => cell.trim().toLowerCase() === names[i]);
  const body = header ? rows.slice(1) : rows;
  if (body.some((row) => row.length > columns.length))
    throw new Error("Pasted cells are wider than the table");
  return { rows: body, header };
}
