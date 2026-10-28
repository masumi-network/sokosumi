import { z } from "@hono/zod-openapi";
import { cmoStrategySchema } from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";

export const marketingStrategyParamsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
  strategyId: z
    .string()
    .uuid()
    .openapi({ param: { name: "strategyId", in: "path" } }),
});

/** One version of a Project's Marketing strategy, without its plan. */
export const marketingStrategyVersionSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    authorSokoBotId: z.union([z.string(), z.null()]),
    authorUserId: z.union([z.string(), z.null()]),
    approvedAt: z
      .union([dateTimeSchema, z.null()])
      .describe(
        "When an owner or admin approved this version; at most one version per Project is approved, and only it is carried out.",
      ),
    approvedByUserId: z.union([z.string(), z.null()]),
  })
  .openapi("MarketingStrategyVersion");

export const marketingStrategyRequestSchema = z
  .object({
    plan: cmoStrategySchema.describe(
      "The whole plan, with its calendar and any yes/no questions.",
    ),
  })
  .openapi("MarketingStrategyRequest");

export const marketingStrategySchema = marketingStrategyVersionSchema
  .extend({
    plan: cmoStrategySchema.describe(
      "The plan with its yes/no questions and their answers.",
    ),
  })
  .openapi("MarketingStrategy");
