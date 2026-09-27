import { z } from "@hono/zod-openapi";
import {
  tableColumnInputSchema,
  tableEvidenceSchema,
  tableValuesSchema,
  tableViewDefinitionSchema,
} from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
export const tableColumnSchema = tableColumnInputSchema
  .extend({
    id: z.uuid(),
    tableId: z.uuid(),
    position: z.int(),
    version: z.int(),
  })
  .openapi("TableColumn");
export const tableRowSchema = z
  .object({
    id: z.uuid(),
    tableId: z.uuid(),
    values: tableValuesSchema,
    evidence: tableEvidenceSchema,
    version: z.int(),
    archivedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("TableRow");
export const tableViewSchema = z
  .object({
    id: z.uuid(),
    tableId: z.uuid(),
    name: z.string(),
    version: z.int(),
    definition: tableViewDefinitionSchema,
  })
  .openapi("TableView");
export const dataTableSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid().nullable(),
    title: z.string(),
    description: z.string(),
    createdBy: z.string(),
    version: z.int(),
    archivedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    columns: z.array(tableColumnSchema),
    views: z.array(tableViewSchema),
  })
  .openapi("DataTable");
export const tableChangeSchema = z
  .object({
    id: z.uuid(),
    tableId: z.uuid(),
    batchId: z.uuid(),
    actorId: z.string(),
    actorKind: z.string(),
    actorName: z.string().nullable().optional(),
    taskId: z.string().nullable(),
    rowId: z.uuid().nullable(),
    columnId: z.uuid().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    evidence: z.unknown(),
    createdAt: dateTimeSchema,
  })
  .openapi("TableChange");
export const tableBatchResultSchema = z
  .object({ batchId: z.uuid(), rows: z.array(tableRowSchema) })
  .openapi("TableBatchResult");
