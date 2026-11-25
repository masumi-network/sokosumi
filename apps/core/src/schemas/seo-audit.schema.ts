import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "./pagination.schema";
import {
  addSeoPageSchema,
  seoAnalysisKindSchema,
  seoIdSchema,
} from "./project-seo.schema";

/** The newest check of an Audit, so the list can say whether it runs, failed or when it last finished. */
export const seoAuditLastCheckSchema = z
  .object({
    kind: seoAnalysisKindSchema,
    status: z.enum(["requested", "running", "completed", "failed"]),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SeoAuditLastCheck");

export const seoAuditSummarySchema = z
  .object({
    id: seoIdSchema,
    name: z.string(),
    projectId: seoIdSchema.nullable(),
    pageCount: z.number().int().nonnegative(),
    // The union, not `.nullable()`: the generated transformer then skips a null instead of reading its dates.
    lastCheck: z.union([seoAuditLastCheckSchema, z.null()]),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SeoAuditSummary");

/** Where an Audit lives, for a link opened in another workspace of the same reader. */
export const seoAuditWorkspaceMappingSchema = z
  .object({
    name: z.string(),
    workspaceId: seoIdSchema,
    organizationId: z.string().nullable().openapi({
      description:
        "Organization id for the workspace, or null for a personal workspace",
    }),
  })
  .openapi("SeoAuditWorkspaceMapping");

export const createSeoAuditSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    firstPage: addSeoPageSchema.omit({ relatedToPageId: true }),
    projectId: seoIdSchema.optional(),
  })
  .strict()
  .openapi("CreateSeoAuditRequest");

export const seoAuditListQuerySchema = cursorPaginationQuerySchema
  .extend({
    cursor: seoIdSchema.optional(),
    status: z.enum(["active", "archived"]).optional(),
    // The header's Project scope: only the Audits linked to this Project.
    projectId: seoIdSchema.optional(),
  })
  .openapi("SeoAuditListQuery");

export const setSeoAuditArchivedSchema = z
  .object({ archived: z.boolean() })
  .strict()
  .openapi("SetSeoAuditArchivedRequest");
