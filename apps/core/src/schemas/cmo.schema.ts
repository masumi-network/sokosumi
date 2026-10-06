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

export const cmoMockPlanRequestSchema = z
  .object({
    plan: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .describe("A CMO tier id from CMO's own plan config."),
  })
  .openapi("CmoMockPlanRequest");

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

export const cmoWorkStepSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["search", "read", "study", "brain", "strategy", "other"]),
    label: z.string(),
    url: z.union([z.string(), z.null()]),
    status: z.enum(["running", "done", "failed"]),
    at: dateTimeSchema,
  })
  .openapi("CmoWorkStep");

export const cmoWorkSchema = z
  .object({
    kind: z.enum(["research", "strategy"]),
    status: z.enum(["running", "failed", "done"]),
    startedAt: dateTimeSchema,
    steps: z.array(cmoWorkStepSchema),
  })
  .openapi("CmoWork");

export const cmoBrandVisualSchema = z
  .object({
    logoUrl: z.union([z.string(), z.null()]),
    colors: z.array(z.string()),
    fonts: z.array(z.string()),
    siteName: z.union([z.string(), z.null()]),
    designMdUrl: z.union([z.string(), z.null()]),
  })
  .openapi("CmoBrandVisual");

export const cmoRoutineSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    when: z.string(),
    description: z.string(),
    nextRunAt: z.union([dateTimeSchema, z.null()]),
    timezone: z.union([z.string(), z.null()]),
  })
  .openapi("CmoRoutine");

export const cmoOverviewSchema = z
  .object({
    id: z.string(),
    businessName: z.string(),
    websiteUrl: z.string(),
    goals: z.string(),
    /** Set when Cuso works in an organization's workspace, not a personal one. */
    organizationSlug: z.union([z.string(), z.null()]),
    projectName: z.string(),
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
    work: z.union([cmoWorkSchema, z.null()]),
    brandVisual: z.union([cmoBrandVisualSchema, z.null()]),
    projectLogo: z.union([z.string(), z.null()]),
    accountsDoneAt: z.union([dateTimeSchema, z.null()]),
    onboardedAt: z.union([dateTimeSchema, z.null()]),
    mockBilling: z
      .boolean()
      .describe("CMO offers its own mock tiers instead of Sokosumi checkout."),
    mockPlan: z.union([z.string(), z.null()]),
    mockPlanActivatedAt: z.union([dateTimeSchema, z.null()]),
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
