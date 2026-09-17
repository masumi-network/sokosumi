import type { TableColumn, TableRow } from "@/lib/clients/generated/core";

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
export function tableError(error: unknown): string {
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
