import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "./pagination.schema";
import { addSeoPageSchema, seoIdSchema } from "./project-seo.schema";

export const seoAuditSummarySchema = z
  .object({
    id: seoIdSchema,
    name: z.string(),
    projectId: seoIdSchema.nullable(),
    pageCount: z.number().int().nonnegative(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SeoAuditSummary");

export const createSeoAuditSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    firstPage: addSeoPageSchema.omit({ relatedToPageId: true }),
    projectId: seoIdSchema.optional(),
  })
  .strict()
  .openapi("CreateSeoAuditRequest");

export const seoAuditListQuerySchema = cursorPaginationQuerySchema
  .extend({ cursor: seoIdSchema.optional() })
  .openapi("SeoAuditListQuery");
