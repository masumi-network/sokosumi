import { z } from "zod";
import {
  tableColumnInputSchema,
  tableEvidenceSchema,
  tableValuesSchema,
} from "./data-table.js";

export function validateTableValues(
  columns: Array<z.infer<typeof tableColumnInputSchema> & { id: string }>,
  values: z.infer<typeof tableValuesSchema>,
  evidence: z.infer<typeof tableEvidenceSchema>,
): void {
  if (
    new TextEncoder().encode(JSON.stringify({ values, evidence })).byteLength >
    64000
  )
    throw new Error("A row is limited to 64 KB of values and sources");
  const byId = new Map(columns.map((column) => [column.id, column]));
  for (const id of Object.keys(evidence)) {
    if (!byId.has(id) || !(id in values))
      throw new Error("Evidence must accompany a value in an existing column");
  }
  for (const [id, value] of Object.entries(values)) {
    const column = byId.get(id);
    if (!column) throw new Error("Unknown column ID");
    if (value === null) continue;
    let valid = false;
    switch (column.type) {
      case "text":
        valid = typeof value === "string" && value.length <= 2000;
        break;
      case "long_text":
        valid = typeof value === "string";
        break;
      case "number":
        valid = typeof value === "number" && Number.isFinite(value);
        break;
      case "checkbox":
        valid = typeof value === "boolean";
        break;
      case "date":
        valid =
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value;
        break;
      case "url":
        valid =
          typeof value === "string" &&
          z.url().safeParse(value).success &&
          /^https?:\/\//.test(value);
        break;
      case "email":
        valid = typeof value === "string" && z.email().safeParse(value).success;
        break;
      case "single_select":
        valid = typeof value === "string" && column.options.includes(value);
        break;
      case "multiple_select":
        valid =
          Array.isArray(value) &&
          new Set(value).size === value.length &&
          value.every((item) => column.options.includes(item));
        break;
    }
    if (!valid)
      throw new Error(`Invalid ${column.type} value for ${column.name}`);
  }
}
