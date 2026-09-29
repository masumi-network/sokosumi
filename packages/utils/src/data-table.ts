import { z } from "zod";

export const tableColumnTypeSchema = z.enum([
  "text",
  "long_text",
  "number",
  "date",
  "checkbox",
  "url",
  "email",
  "single_select",
  "multiple_select",
]);
export const tableValueSchema = z.union([
  z.string().max(20000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.null(),
]);
export const tableValuesSchema = z.record(z.uuid(), tableValueSchema);
export const tableEvidenceSchema = z.record(
  z.uuid(),
  z
    .array(
      z.object({
        url: z
          .url()
          .max(2000)
          .refine(
            (value) => /^https?:\/\//.test(value),
            "Use an HTTP or HTTPS source URL",
          ),
        note: z.string().max(2000).optional(),
      }),
    )
    .max(20),
);
export const tableColumnInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(""),
  type: tableColumnTypeSchema,
  options: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});
export const tableFilterSchema = z.object({
  columnId: z.uuid(),
  operator: z.enum(["equals", "contains", "empty"]),
  value: tableValueSchema.optional(),
});
export const tableViewDefinitionSchema = z.object({
  filters: z.array(tableFilterSchema).max(10).default([]),
  sort: z
    .object({ columnId: z.uuid(), direction: z.enum(["asc", "desc"]) })
    .nullable()
    .default(null),
  visibleColumnIds: z.array(z.uuid()).max(100).default([]),
});
export const tableInsertRowSchema = z.object({
  id: z.uuid().optional(),
  values: tableValuesSchema,
  evidence: tableEvidenceSchema.default({}),
});
export const createDataTableSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(""),
  projectId: z.uuid().nullable().optional(),
  columns: z.array(tableColumnInputSchema).min(1).max(100),
  rows: z.array(tableInsertRowSchema).max(100).default([]),
});
export const tableQuerySchema = tableViewDefinitionSchema.extend({
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100).default(50),
  archived: z.boolean().default(false),
  rowIds: z.array(z.uuid()).max(100).optional(),
});
export const tableBatchSchema = z
  .object({
    key: z.string().min(1).max(200),
    taskId: z.string().optional(),
    insert: z.array(tableInsertRowSchema).max(100).default([]),
    patch: z
      .array(
        z.object({
          id: z.uuid(),
          version: z.int().positive(),
          values: tableValuesSchema.default({}),
          evidence: tableEvidenceSchema.default({}),
          archived: z.boolean().optional(),
        }),
      )
      .max(100)
      .default([]),
  })
  .refine(
    (value) =>
      value.insert.length + value.patch.length > 0 &&
      value.insert.length + value.patch.length <= 100,
    "A batch must contain 1–100 rows",
  );
export const tableMutationSchema = z.object({
  key: z.string().min(1).max(200),
  version: z.int().positive(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(4000).optional(),
  archived: z.boolean().optional(),
  columns: z.array(tableColumnInputSchema).min(1).max(100).optional(),
});
