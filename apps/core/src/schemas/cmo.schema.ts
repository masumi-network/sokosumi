import { z } from "@hono/zod-openapi";
import {
  CMO_AUTONOMY_LEVELS,
  cmoBrandBrainSchema,
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

export const cmoStrategySettingsRequestSchema = z
  .object({
    channels: z
      .array(
        z.object({
          channel: z.string().trim().min(1).max(40),
          autonomy: z.enum(CMO_AUTONOMY_LEVELS),
        }),
      )
      .max(10)
      .optional(),
    reviewMode: z.enum(["suggest", "auto"]).optional(),
  })
  .openapi("CmoStrategySettingsRequest");

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
    subscriptionActive: z.boolean(),
    brandBrain: z.union([cmoBrandBrainSchema, z.null()]),
    brandBrainUpdatedAt: z.union([dateTimeSchema, z.null()]),
    strategy: z.union([cmoStrategySchema, z.null()]),
    strategyUpdatedAt: z.union([dateTimeSchema, z.null()]),
    createdAt: dateTimeSchema,
  })
  .openapi("CmoOverview");

export const cmoTurnStartedSchema = z
  .object({ turnId: z.string() })
  .openapi("CmoTurnStarted");
