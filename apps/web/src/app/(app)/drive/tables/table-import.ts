import type { TableColumn, TableRow } from "@sokosumi/core-client";
import {
  tableBatchSchema,
  tableInsertRowSchema,
  validateTableValues,
} from "@sokosumi/utils";
import type { z } from "zod";
import { parseTableInput } from "./table-value";

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
 * Plans adding CSV rows to an existing Table: headers match column names
 * ignoring case and outer spaces, other headers are skipped, and a Last
 * updated column fills itself. `newRows` leaves out the rows whose matched
 * cells equal an existing row's, so overlapping exports can skip them.
 */
export function planCsvAppend(
  columns: Pick<TableColumn, "id" | "name" | "type" | "options">[],
  csv: string[][],
  existing: Pick<TableRow, "values">[],
  describe: (row: number, error: unknown) => string = (_, error) =>
    error instanceof Error ? error.message : String(error),
) {
  const byName = new Map(
    columns
      .filter((column) => column.type !== "last_updated")
      .map((column) => [column.name.trim().toLowerCase(), column]),
  );
  const pairs: Array<{ column: (typeof columns)[number]; index: number }> = [];
  const skipped: string[] = [];
  csv[0].forEach((header, index) => {
    const column = byName.get(header.trim().toLowerCase());
    if (column && !pairs.some((pair) => pair.column === column))
      pairs.push({ column, index });
    else skipped.push(header);
  });
  const key = (values: TableRow["values"]) =>
    JSON.stringify(pairs.map(({ column }) => values[column.id] ?? null));
  const rows = csv.slice(1).map((cells, i) => {
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
    rows,
    newRows: rows.filter((row) => !held.has(key(row.values))),
  };
}
