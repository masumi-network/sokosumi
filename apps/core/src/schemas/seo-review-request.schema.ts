import { z } from "@hono/zod-openapi";
import { seoWorkspaceQuerySchema } from "./project-seo.schema";
import { seoIdSchema } from "./seo-page.schema";

export const acknowledgeSeoReviewSchema = z
  .strictObject({
    pageId: seoIdSchema,
    view: seoWorkspaceQuerySchema.optional(),
    actionId: z.string().min(1).max(200),
    kind: z.enum(["rank_crosses", "demand_returns"]),
    period: z
      .string()
      .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
      .optional(),
    baselineObservationId: seoIdSchema,
    observationId: seoIdSchema,
  })
  .openapi("AcknowledgeProjectSeoReviewRequest");
