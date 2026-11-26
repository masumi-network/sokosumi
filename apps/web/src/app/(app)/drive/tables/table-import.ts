import type { TableColumn, TableRow } from "@sokosumi/core-client";
import {
  tableBatchSchema,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import type { z } from "zod";
import type { SpreadsheetCell } from "@/lib/spreadsheet-file";
import { parseTableInput } from "./table-value";

/**
 * A workbook sheet as import rows, shaped like a parsed CSV: blank rows go, as
 * they do in a CSV, every row is as wide as the widest, and a blank header is
 * named by its position so no column is left out for want of a name.
 */
export function sheetTableRows(
  sheet: SpreadsheetCell[][],
  blankHeader: (number: number) => string,
): string[][] {
  const rows = sheet
    .map((row) => row.map((cell) => cell.text))
    .filter((row) => row.some((text) => text.trim()));
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row, r) =>
    Array.from({ length: width }, (_, i) =>
      r === 0 && !row[i]?.trim() ? blankHeader(i + 1) : (row[i] ?? ""),
    ),
  );
}

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

/** Header words that name codes, not quantities: digits there are an identifier. */
const IDENTIFIER_HEADER =
  /(^|[^a-z])(id|ids|phone|tel|mobile|fax|zip|postal|postcode|plz|code|sku|ean|upc|isbn|iban|account|ssn|pin|ref|reference)($|[^a-z])/;
/** Plain decimal only: no sign `+`, exponent, hex, grouping or leading zero. */
/** Smallest normal double, 2^-1022; JavaScript has no constant for it. */
const MIN_NORMAL = 2.2250738585072014e-308;
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * A CSV column starts as Number only when that loses nothing: every filled
 * cell is a plain decimal of at most 15 significant digits (a float's exact
 * range) and, unless zero, no smaller than the smallest normal double, and
 * the header does not name an identifier. Blank cells are
 * ignored; an all-blank column stays Text.
 */
export function isNumericCsvColumn(header: string, values: string[]): boolean {
  const name = header.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (IDENTIFIER_HEADER.test(name)) return false;
  const filled = values.map((value) => value.trim()).filter(Boolean);
  return (
    filled.length > 0 &&
    filled.every(
      (value) =>
        PLAIN_NUMBER.test(value) &&
        value.replace(/^-?0*|\./g, "").replace(/^0+/, "").length <= 15 &&
        // A nonzero value below the smallest normal double underflows to
        // zero or loses digits as a subnormal.
        (!/[1-9]/.test(value) || Math.abs(Number(value)) >= MIN_NORMAL),
    )
  );
}

/**
 * Plans adding CSV rows to an existing Table: headers match Text column
 * names ignoring case and outer spaces; every other header is skipped, so
 * other column types stay empty and no value is converted. A header that
 * names two columns, or two headers that name one column, are `ambiguous`;
 * then, or when no header names a Text column, it plans no rows. `newRows` leaves out
 * the rows whose matched cells equal an existing row's, so overlapping
 * exports can skip them.
 */
export function planCsvAppend(
  columns: Pick<TableColumn, "id" | "name" | "type" | "options">[],
  csv: string[][],
  existing: Pick<TableRow, "values">[],
  describe: (row: number, error: unknown) => string = (_, error) =>
    error instanceof Error ? error.message : String(error),
) {
  const normal = (text: string) => text.trim().toLowerCase();
  const fillable = columns.filter((column) => column.type === "text");
  const found = csv[0].map((header) =>
    fillable.filter((column) => normal(column.name) === normal(header)),
  );
  const ambiguous = csv[0].filter(
    (_, i) =>
      found[i].length > 1 ||
      (found[i].length === 1 &&
        found.filter((other) => other.length === 1 && other[0] === found[i][0])
          .length > 1),
  );
  const unclear = new Set(ambiguous);
  const pairs = found.flatMap((match, index) =>
    match.length === 1 && !unclear.has(csv[0][index])
      ? [{ column: match[0], index }]
      : [],
  );
  const skipped = csv[0].filter(
    (header, i) => !found[i].length && !unclear.has(header),
  );
  const key = (values: TableRow["values"]) =>
    JSON.stringify(pairs.map(({ column }) => values[column.id] ?? null));
  const rows =
    ambiguous.length || !pairs.length
      ? []
      : csv.slice(1).map((cells, i) => {
          try {
            const row = tableInsertRowSchema.parse({
              values: Object.fromEntries(
                pairs.map(({ column, index }) => [
                  column.id,
                  parseTableInput(column, cells[index]),
                ]),
              ),
            });
            validateTableValues(
              pairs.map(({ column }) => ({
                ...column,
                options: column.options ?? [],
                description: "",
              })),
              row.values,
              row.evidence,
            );
            return row;
          } catch (error) {
            throw new Error(describe(i + 2, error));
          }
        });
  const held = new Set(existing.map((row) => key(row.values)));
  return {
    matched: pairs.map(({ column }) => column.name),
    skipped,
    ambiguous,
    rows,
    newRows: rows.filter((row) => !held.has(key(row.values))),
  };
}
