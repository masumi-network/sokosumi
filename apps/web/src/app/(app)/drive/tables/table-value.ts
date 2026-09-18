import type { TableColumn, TableRow } from "@/lib/clients/generated/core";

const INPUT_ERRORS = {
  "A row is limited to 64 KB of values and sources": "errors.rowSize",
  "Table requests are limited to 1 MB": "errors.requestSize",
  "Evidence must accompany a value in an existing column": "errors.invalid",
  "Unknown column ID": "errors.invalid",
  "CSV exceeds 5 MB": "errors.csvLimit",
  "CSV exceeds 100 columns": "errors.csvColumns",
  "CSV exceeds 10,000 rows": "errors.csvRows",
  "Unexpected CSV quote": "errors.csv",
  "Unexpected text after CSV quote": "errors.csv",
  "Unclosed CSV quote": "errors.csv",
  "CSV needs non-empty column headers": "errors.csvHeaders",
  "CSV rows have different column counts": "errors.csvWidth",
  "Invalid number": "errors.number",
  "Use true or false": "errors.checkbox",
  "Unknown option": "errors.option",
  "Use YYYY-MM-DD": "errors.date",
  "Use HTTP or HTTPS": "errors.url",
  "Invalid URL": "errors.url",
  "Invalid email": "errors.email",
  "Resolve the previous request before changing its input": "errors.unresolved",
} as const;
type TableErrorKey =
  | (typeof INPUT_ERRORS)[keyof typeof INPUT_ERRORS]
  | "errors.request"
  | "errors.conflict"
  | "errors.invalid"
  | "errors.forbidden"
  | "errors.missing";

export function tableValueText(value: TableRow["values"][string]): string {
  return value == null
    ? ""
    : Array.isArray(value)
      ? value.join("; ")
      : String(value);
}
export function parseTableInput(
  column: Pick<TableColumn, "type" | "options">,
  text: string,
): TableRow["values"][string] {
  if (!text.trim()) return null;
  switch (column.type) {
    case "number": {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error("Invalid number");
      return value;
    }
    case "checkbox":
      if (text === "true") return true;
      if (text === "false") return false;
      throw new Error("Use true or false");
    case "multiple_select": {
      const values = text
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.some((value) => !column.options?.includes(value)))
        throw new Error("Unknown option");
      return values;
    }
    case "single_select":
      if (!column.options?.includes(text)) throw new Error("Unknown option");
      return text;
    case "date":
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        Number.isNaN(Date.parse(text)) ||
        new Date(text).toISOString().slice(0, 10) !== text
      )
        throw new Error("Use YYYY-MM-DD");
      return text;
    case "url": {
      const url = new URL(text);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Use HTTP or HTTPS");
      return text;
    }
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
        throw new Error("Invalid email");
      return text;
    default:
      return text;
  }
}
export function tableError(
  error: unknown,
  translate?: (key: TableErrorKey) => string,
): string {
  if (translate) {
    const message = error instanceof Error ? error.message : "";
    if (
      (error instanceof Error && error.name === "ZodError") ||
      /^Invalid \w+ value for /.test(message)
    )
      return translate("errors.invalid");
    for (const [text, key] of Object.entries(INPUT_ERRORS))
      if (message === text) return translate(key);
    if (error && typeof error === "object" && "error" in error) {
      switch (error.error) {
        case "Conflict":
          return translate("errors.conflict");
        case "Forbidden":
        case "Unauthorized":
          return translate("errors.forbidden");
        case "NotFound":
          return translate("errors.missing");
        case "UnprocessableEntity":
        case "BadRequest":
          return translate("errors.invalid");
        default:
          return translate("errors.request");
      }
    }
  }
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Request failed";
}

/** History envelopes are data, never markup or instructions. */
export function tableHistoryText(
  input: unknown,
  labels: {
    archived: string;
    active: string;
    row: string;
    unknown: string;
    yes: string;
    no: string;
  },
): string {
  if (input === null || input === undefined) return labels.unknown;
  if (typeof input === "object" && "value" in input)
    return tableHistoryText(input.value, labels);
  if (typeof input === "object" && "archived" in input)
    return input.archived ? labels.archived : labels.active;
  if (typeof input === "object" && "values" in input) return labels.row;
  if (Array.isArray(input))
    return input.map((value) => tableHistoryText(value, labels)).join("; ");
  if (typeof input === "boolean") return input ? labels.yes : labels.no;
  if (typeof input === "string" || typeof input === "number")
    return String(input);
  return "—";
}
