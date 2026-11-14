/** One cell of an exported table. A missing value is an empty cell, never "null" or "0". */
export type SeoCsvCell = string | number | null;

/**
 * A spreadsheet reads a text cell that starts with one of these as a formula (CSV injection), also after
 * leading spaces and in the fullwidth forms (U+FF1D, U+FF0B, U+FF0D, U+FF20) that some spreadsheets fold.
 */
const FORMULA_START = /^\s*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/;
/**
 * Excel in these languages splits a CSV line at ";" and reads "," as the decimal sign. Excel follows the
 * computer's region, which a web page cannot read, so the app language stands in for it: a German app on an
 * English-region computer gets ";" that Excel there does not split. A "sep=" line would fix Excel but shows
 * as a first row in other spreadsheets, so the file has none.
 */
const SEMICOLON_LOCALES = new Set(["de", "es"]);
/** A field with one of these, or with the list separator, needs quotes (RFC 4180 section 2). */
const NEEDS_QUOTES = /["\r\n]/;

function cell(value: SeoCsvCell, separator: string, decimal: string) {
  if (value === null) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value).replace(".", decimal) : "";
  // Text only: a negative number is a number, not a formula.
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) || text.includes(separator)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

/**
 * RFC 4180 text: a header row, then one line per row, CRLF line ends. For a German or Spanish locale the
 * list separator is ";" and numbers use a decimal comma, so Excel there opens the file in columns.
 */
export function seoCsv(
  header: readonly string[],
  rows: readonly (readonly SeoCsvCell[])[],
  locale = "en",
) {
  const semicolon = SEMICOLON_LOCALES.has(locale.split("-")[0] ?? "");
  const separator = semicolon ? ";" : ",";
  const decimal = semicolon ? "," : ".";
  return `${[header, ...rows].map((row) => row.map((value) => cell(value, separator, decimal)).join(separator)).join("\r\n")}\r\n`;
}
