/** One cell of an exported table. A missing value is an empty cell, never "null" or "0". */
export type SeoCsvCell = string | number | null;

/**
 * A spreadsheet reads a text cell that starts with one of these as a formula (CSV injection), also after
 * leading spaces and in the fullwidth forms (U+FF1D, U+FF0B, U+FF0D, U+FF20) that some spreadsheets fold.
 */
const FORMULA_START = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/;
/** A field with one of these needs quotes (RFC 4180 section 2). */
const NEEDS_QUOTES = /[",\r\n]/;

function cell(value: SeoCsvCell) {
  if (value === null) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  // Text only: a negative number is a number, not a formula.
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 text: a header row, then one line per row, CRLF line ends. */
export function seoCsv(
  header: readonly string[],
  rows: readonly (readonly SeoCsvCell[])[],
) {
  return `${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
