import { readCsvRows } from "@sokosumi/utils";
import JSZip from "jszip";

/**
 * A spreadsheet read for display: `.xlsx` and `.csv` as tabs of cell text.
 *
 * Only what a reader sees is kept — each cell's value as Excel would show it
 * under its number format, whether it is a number (to align it), and whether
 * it is bold. No formulas run: a formula cell shows the value Excel cached
 * when the file was saved.
 *
 * The workbook is parsed in the browser that opens it, so a hostile file can
 * only cost the tab of the person who chose to open it. Sheets, rows and
 * columns are capped so an ordinary large export still opens quickly.
 */
export const MAX_SHEETS = 20;
export const MAX_ROWS = 1000;
export const MAX_COLUMNS = 50;

export interface SpreadsheetCell {
  text: string;
  numeric: boolean;
  bold: boolean;
}

export interface Spreadsheet {
  name: string;
  rows: SpreadsheetCell[][];
  /** Rows or columns past the caps were left out. */
  truncated: boolean;
}

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function spreadsheetKind(
  type: string,
  name: string,
): "xlsx" | "csv" | null {
  const lower = name.toLowerCase();
  if (type === XLSX_TYPE || lower.endsWith(".xlsx")) return "xlsx";
  if (type === "text/csv" || lower.endsWith(".csv")) return "csv";
  return null;
}

export async function readSpreadsheet(
  kind: "xlsx" | "csv",
  bytes: ArrayBuffer,
): Promise<Spreadsheet[]> {
  if (kind === "csv") {
    const rows = readCsvRows(new TextDecoder().decode(bytes), {
      maxRows: 100_000,
    }).map((row) =>
      row.map((text) => ({ text, numeric: isNumberText(text), bold: false })),
    );
    return [capped("", rows)];
  }
  return readXlsx(bytes);
}

function isNumberText(text: string): boolean {
  return /^[-+(]?[$€£¥]?\s?[\d.,]+%?\)?$/.test(text.trim());
}

function capped(name: string, rows: SpreadsheetCell[][]): Spreadsheet {
  const wide = rows.some((row) => row.length > MAX_COLUMNS);
  return {
    name,
    rows: rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLUMNS)),
    truncated: wide || rows.length > MAX_ROWS,
  };
}

function xml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** `x:sheet` and `sheet` alike: workbooks are written with and without prefixes. */
function localName(node: { nodeName: string }): string {
  return node.nodeName.split(":").pop() ?? "";
}

function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName("*")).filter(
    (node) => localName(node) === name,
  );
}

function child(parent: Element, name: string): Element | undefined {
  return Array.from(parent.children).find((node) => localName(node) === name);
}

async function part(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  return file ? xml(await file.async("string")) : null;
}

interface CellStyle {
  format: string;
  bold: boolean;
}

async function readXlsx(bytes: ArrayBuffer): Promise<Spreadsheet[]> {
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await part(zip, "xl/workbook.xml");
  if (!workbook) throw new Error("Not an Excel workbook");
  const date1904 = elements(workbook, "workbookPr").some(
    (node) => node.getAttribute("date1904") === "1",
  );

  const rels = await part(zip, "xl/_rels/workbook.xml.rels");
  const targets = new Map(
    (rels ? elements(rels, "Relationship") : []).map((rel) => [
      rel.getAttribute("Id") ?? "",
      rel.getAttribute("Target") ?? "",
    ]),
  );

  const shared = await part(zip, "xl/sharedStrings.xml");
  const strings = (shared ? elements(shared, "si") : []).map((item) =>
    elements(item, "t")
      .filter((t) => t.parentElement && localName(t.parentElement) !== "rPh")
      .map((t) => t.textContent ?? "")
      .join(""),
  );

  const styles = await readStyles(zip);
  const sheets = elements(workbook, "sheet")
    .filter((sheet) => (sheet.getAttribute("state") ?? "visible") === "visible")
    .slice(0, MAX_SHEETS);

  const out: Spreadsheet[] = [];
  for (const sheet of sheets) {
    // `r:id`, whatever the relationships namespace is prefixed as.
    const id = Array.from(sheet.attributes).find((attribute) =>
      /^[^:]+:id$/.test(attribute.name),
    )?.value;
    const target = targets.get(id ?? "");
    if (!target) continue;
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    const doc = await part(zip, path);
    if (!doc) continue;
    out.push(
      readSheet(sheet.getAttribute("name") ?? "", doc, {
        strings,
        styles,
        date1904,
      }),
    );
  }
  return out;
}

async function readStyles(zip: JSZip): Promise<CellStyle[]> {
  const doc = await part(zip, "xl/styles.xml");
  if (!doc) return [];
  const formats = new Map(
    elements(doc, "numFmt").map((node) => [
      Number(node.getAttribute("numFmtId")),
      node.getAttribute("formatCode") ?? "General",
    ]),
  );
  const fonts = elements(doc, "font").map((font) => {
    const b = child(font, "b");
    return b !== undefined && b.getAttribute("val") !== "0";
  });
  const xfs = elements(doc, "cellXfs")[0];
  return (xfs ? Array.from(xfs.children) : []).map((xf) => {
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    return {
      format: formats.get(id) ?? BUILT_IN_FORMATS[id] ?? "General",
      bold: fonts[Number(xf.getAttribute("fontId") ?? 0)] ?? false,
    };
  });
}

/** "C12" → [11, 2]. */
function position(ref: string): [number, number] | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1])
    column = column * 26 + letter.charCodeAt(0) - 64;
  return [Number(match[2]) - 1, column - 1];
}

function readSheet(
  name: string,
  doc: Document,
  context: { strings: string[]; styles: CellStyle[]; date1904: boolean },
): Spreadsheet {
  const hiddenColumns = new Set<number>();
  for (const col of elements(doc, "col")) {
    if (col.getAttribute("hidden") !== "1") continue;
    const min = Number(col.getAttribute("min"));
    const max = Math.min(Number(col.getAttribute("max")), MAX_COLUMNS + 1);
    for (let index = min; index <= max; index++) hiddenColumns.add(index - 1);
  }

  const grid: SpreadsheetCell[][] = [];
  let truncated = false;
  let width = 0;
  for (const row of elements(doc, "row")) {
    if (row.getAttribute("hidden") === "1") continue;
    if (grid.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const cells: SpreadsheetCell[] = [];
    for (const cell of Array.from(row.children)) {
      if (localName(cell) !== "c") continue;
      const at = position(cell.getAttribute("r") ?? "");
      const column = at ? at[1] : cells.length;
      if (hiddenColumns.has(column)) continue;
      if (column >= MAX_COLUMNS) {
        truncated = true;
        continue;
      }
      const value = readCell(cell, context);
      if (!value.text) continue;
      while (cells.length < column) cells.push(EMPTY);
      cells[column] = value;
    }
    grid.push(cells);
    width = Math.max(width, cells.length);
  }

  while (grid.length && grid[grid.length - 1].length === 0) grid.pop();
  const visible = Array.from({ length: width }, (_, index) => index).filter(
    (index) => !hiddenColumns.has(index),
  );
  return {
    name,
    rows: grid.map((cells) => visible.map((index) => cells[index] ?? EMPTY)),
    truncated,
  };
}

const EMPTY: SpreadsheetCell = { text: "", numeric: false, bold: false };

function readCell(
  cell: Element,
  context: { strings: string[]; styles: CellStyle[]; date1904: boolean },
): SpreadsheetCell {
  const style = context.styles[Number(cell.getAttribute("s") ?? 0)];
  const bold = style?.bold ?? false;
  const type = cell.getAttribute("t") ?? "n";
  const raw = child(cell, "v")?.textContent ?? "";

  if (type === "s")
    return { text: context.strings[Number(raw)] ?? "", numeric: false, bold };
  if (type === "inlineStr") {
    const inline = child(cell, "is");
    const text = inline
      ? elements(inline, "t")
          .map((t) => t.textContent ?? "")
          .join("")
      : "";
    return { text, numeric: false, bold };
  }
  if (type === "b")
    return { text: raw === "1" ? "TRUE" : "FALSE", numeric: false, bold };
  if (type === "str" || type === "e" || raw === "")
    return { text: raw, numeric: false, bold };

  const value = Number(raw);
  if (!Number.isFinite(value)) return { text: raw, numeric: false, bold };
  return {
    text: formatNumber(value, style?.format ?? "General", context.date1904),
    numeric: true,
    bold,
  };
}

/** Excel's built-in number formats, by id. */
const BUILT_IN_FORMATS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;(#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;(#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

/** Splits on `;` outside quotes and escapes. */
function sections(format: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < format.length; index++) {
    const char = format[index];
    if (char === "\\" && !quoted) {
      current += char + (format[index + 1] ?? "");
      index++;
    } else if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (char === ";" && !quoted) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out;
}

type Token = { literal: string } | { code: string };

/** Literal text and format codes, with colours, fills and padding gone. */
function tokens(section: string): Token[] {
  const out: Token[] = [];
  for (let index = 0; index < section.length; index++) {
    const char = section[index];
    if (char === '"') {
      const end = section.indexOf('"', index + 1);
      const stop = end === -1 ? section.length : end;
      out.push({ literal: section.slice(index + 1, stop) });
      index = stop;
    } else if (char === "\\") {
      out.push({ literal: section[index + 1] ?? "" });
      index++;
    } else if (char === "_") {
      out.push({ literal: " " });
      index++;
    } else if (char === "*") {
      index++;
    } else if (char === "[") {
      const end = section.indexOf("]", index);
      const stop = end === -1 ? section.length : end;
      const inner = section.slice(index + 1, stop);
      // `[$€-407]` is a currency symbol; `[h]` is elapsed hours; colours
      // and conditions are dropped.
      if (inner.startsWith("$"))
        out.push({ literal: inner.slice(1).split("-")[0] });
      else if (/^[hms]+$/i.test(inner)) out.push({ code: inner.toLowerCase() });
      index = stop;
    } else out.push({ code: char });
  }
  return out;
}

function codeText(parts: Token[]): string {
  return parts.map((part) => ("code" in part ? part.code : "")).join("");
}

export function formatNumber(
  value: number,
  format: string,
  date1904 = false,
): string {
  const all = sections(format);
  let section = all[0] ?? "General";
  let number = value;
  if (value < 0 && all.length > 1) {
    section = all[1];
    number = Math.abs(value);
  } else if (value === 0 && all.length > 2) section = all[2];

  const parts = tokens(section);
  const codes = codeText(parts);
  if (/general/i.test(codes) || codes.trim() === "" || codes === "@") {
    const literals = parts
      .filter((part) => "literal" in part)
      .map((part) => ("literal" in part ? part.literal : ""))
      .join("");
    return codes.trim() === "" && literals ? literals : general(number);
  }
  if (/[dy]|[hs]|m/i.test(codes.replace(/E[+-]/gi, "")) && !/[0#?]/.test(codes))
    return formatDate(number, parts, date1904);
  return formatDigits(number, parts);
}

function general(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e11) return String(value);
  const text = String(Number(value.toPrecision(10)));
  return text;
}

function formatDigits(value: number, parts: Token[]): string {
  const codes = codeText(parts);
  const percent = (codes.match(/%/g) ?? []).length;
  let number = value * 100 ** percent;

  const pattern = /[0#?][0#?,.]*(E[+-][0#]+)?/i.exec(codes);
  if (!pattern) return general(number);
  const digits = pattern[0];
  const mantissa = digits.split(/E/i)[0];
  // Commas after the last digit scale by a thousand each: `0.0,,` is millions.
  const scaleCommas = /,+$/.exec(mantissa)?.[0].length ?? 0;
  number /= 1000 ** scaleCommas;
  const [integer = "", fraction = ""] = mantissa
    .slice(0, mantissa.length - scaleCommas)
    .split(".");
  const decimals = (fraction.match(/[0#?]/g) ?? []).length;
  const minDecimals = (fraction.match(/0/g) ?? []).length;

  let formatted: string;
  if (/E/i.test(digits))
    formatted = number.toExponential(decimals).toUpperCase();
  else
    formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: decimals,
      minimumIntegerDigits: Math.max(1, (integer.match(/0/g) ?? []).length),
      useGrouping: integer.includes(","),
    }).format(number);

  // Rebuild around the number: literals and codes before and after it stay.
  let out = "";
  let placed = false;
  let consumed = 0;
  const start = pattern.index;
  const end = start + digits.length;
  for (const part of parts) {
    if ("literal" in part) {
      out += part.literal;
      continue;
    }
    const at = consumed;
    consumed += part.code.length;
    if (at >= start && at < end) {
      if (!placed) out += formatted;
      placed = true;
    } else if (part.code !== "%") out += part.code === " " ? " " : part.code;
    else out += "%";
  }
  return out.replace(/\s+$/, "");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatDate(serial: number, parts: Token[], date1904: boolean): string {
  const days = date1904 ? serial + 1462 : serial;
  const date = new Date(Math.round((days - 25569) * 86_400_000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const twelveHour = parts.some(
    (part) => "code" in part && /^a$/i.test(part.code),
  );
  const hours = date.getUTCHours();

  const text = parts
    .map((part) => ("code" in part ? part.code : `\u0000${part.literal}\u0000`))
    .join("");
  const pieces = text.split("\u0000");
  return pieces
    .map((piece, index) => {
      if (index % 2 === 1) return piece;
      return piece.replace(
        /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|A\/P|a\/p/g,
        (token, offset: number, whole: string) => {
          const before = whole.slice(0, offset);
          const after = whole.slice(offset + token.length);
          const minutes =
            token.startsWith("m") &&
            token.length <= 2 &&
            (/h+[^a-z]*$/i.test(before) || /^[^a-z]*s/i.test(after));
          switch (token) {
            case "yyyy":
              return String(date.getUTCFullYear());
            case "yy":
              return pad(date.getUTCFullYear() % 100);
            case "mmmm":
              return MONTHS[date.getUTCMonth()];
            case "mmm":
              return MONTHS[date.getUTCMonth()].slice(0, 3);
            case "mm":
              return minutes
                ? pad(date.getUTCMinutes())
                : pad(date.getUTCMonth() + 1);
            case "m":
              return minutes
                ? String(date.getUTCMinutes())
                : String(date.getUTCMonth() + 1);
            case "dddd":
              return DAYS[date.getUTCDay()];
            case "ddd":
              return DAYS[date.getUTCDay()].slice(0, 3);
            case "dd":
              return pad(date.getUTCDate());
            case "d":
              return String(date.getUTCDate());
            case "hh":
              return pad(twelveHour ? hours % 12 || 12 : hours);
            case "h":
              return String(twelveHour ? hours % 12 || 12 : hours);
            case "ss":
              return pad(date.getUTCSeconds());
            case "s":
              return String(date.getUTCSeconds());
            default:
              return hours < 12
                ? token.length > 3
                  ? "AM"
                  : "A"
                : token.length > 3
                  ? "PM"
                  : "P";
          }
        },
      );
    })
    .join("");
}
