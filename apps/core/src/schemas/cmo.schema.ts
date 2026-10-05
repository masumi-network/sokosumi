import { z } from "@hono/zod-openapi";
import {
  cmoBrandBrainSchema,
  cmoReportUpdateInputSchema,
  cmoStrategySchema,
} from "@sokosumi/soko-bot";

import { dateTimeSchema } from "@/helpers/datetime";

export const cmoOnboardingRequestSchema = z
  .object({
    websiteUrl: z.string().trim().url().max(500),
    goals: z.string().trim().min(3).max(2_000),
    businessName: z.string().trim().min(1).max(80).optional(),
  })
  .openapi("CmoOnboardingRequest");

export const cmoBrandBrainRequestSchema = z
  .object({ brandBrain: cmoBrandBrainSchema })
  .openapi("CmoBrandBrainRequest");

export const cmoStrategyRequestSchema = z
  .object({ note: z.string().trim().max(1_000).optional() })
  .openapi("CmoStrategyRequest");

export const cmoUpdateIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export const cmoUpdateSchema = cmoReportUpdateInputSchema
  .extend({
    id: z.string(),
    at: dateTimeSchema,
    revertible: z.boolean(),
    revertedAt: z.union([dateTimeSchema, z.null()]),
  })
  .openapi("CmoUpdate");

export const cmoChannelSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    handle: z.union([z.string(), z.null()]),
    displayName: z.union([z.string(), z.null()]),
    status: z.string(),
  })
  .openapi("CmoChannel");

export const cmoUpNextItemSchema = z
  .object({
    id: z.string(),
    date: z.string(),
    channel: z.string(),
    title: z.string(),
    status: z.string(),
  })
  .openapi("CmoUpNextItem");

export const cmoRoutineSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    when: z.string(),
    description: z.string(),
    nextRunAt: z.union([dateTimeSchema, z.null()]),
  })
  .openapi("CmoRoutine");

export const cmoOverviewSchema = z
  .object({
    id: z.string(),
    businessName: z.string(),
    websiteUrl: z.string(),
    goals: z.string(),
    organizationId: z.string(),
    organizationSlug: z.string(),
    workspaceId: z.string(),
    sokoBotId: z.string(),
    projectId: z.string(),
    roomId: z.string(),
    botStatus: z.string(),
    learning: z
      .enum(["running", "failed", "done"])
      .describe(
        "Cuso's first look at the business: still running, failed or stuck (offer a retry), or done.",
      ),
    subscriptionActive: z.boolean(),
    routines: z.array(cmoRoutineSchema),
    brandBrain: z.union([cmoBrandBrainSchema, z.null()]),
    brandBrainUpdatedAt: z.union([dateTimeSchema, z.null()]),
    strategy: z.union([cmoStrategySchema, z.null()]),
    strategyUpdatedAt: z.union([dateTimeSchema, z.null()]),
    strategyApprovedAt: z.union([dateTimeSchema, z.null()]),
    updates: z.array(cmoUpdateSchema),
    channels: z.array(cmoChannelSchema),
    upNext: z.array(cmoUpNextItemSchema),
    connectChannelUrl: z.string(),
    subscribeUrl: z.string(),
    billing: z.object({
      plan: z.union([z.string(), z.null()]),
      subscriptionStatus: z.union([z.string(), z.null()]),
      availableCredits: z.number(),
    }),
    posts: z.object({
      draft: z.number(),
      scheduled: z.number(),
      published: z.number(),
      failed: z.number(),
    }),
    createdAt: dateTimeSchema,
  })
  .openapi("CmoOverview");

export const cmoTurnStartedSchema = z
  .object({ turnId: z.string() })
  .openapi("CmoTurnStarted");
