import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  projectSocialConnectionSchema,
  projectSocialProviderSchema,
} from "@/schemas/project-social-connection.schema";
import {
  socialPostMetricsSchema,
  socialPostStatisticsQuerySchema,
} from "@/schemas/social-post-statistics.schema";

export const socialAccountMetricSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z
      .number()
      .finite()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    period: z.string().max(100).nullable(),
    unit: z.string().max(100).nullable(),
  })
  .openapi("SocialAccountMetric");
export type SocialAccountMetric = z.infer<typeof socialAccountMetricSchema>;

export const socialAccountStatisticsSchema = z
  .object({
    metrics: z.array(socialAccountMetricSchema).max(100),
    fetchedAt: dateTimeSchema.nullable(),
    refreshAttemptedAt: dateTimeSchema.nullable(),
    error: z.string().nullable(),
    historyNextCursor: z.string().max(10000).nullable(),
    historyComplete: z.boolean(),
    historyFetchedAt: dateTimeSchema.nullable(),
    historyError: z.string().nullable(),
    metricWarning: z.string().nullable().default(null),
  })
  .openapi("SocialAccountStatistics");
export type SocialAccountStatistics = z.infer<
  typeof socialAccountStatisticsSchema
>;

export const socialAccountStatisticsAccountSchema =
  projectSocialConnectionSchema
    .extend({
      // Optional nullable references let the generated date transformer skip empty snapshots.
      statistics: socialAccountStatisticsSchema.nullable().optional(),
      postCount: z.number().int().min(0),
    })
    .openapi("SocialAccountStatisticsAccount");

export const socialAccountPostSchema = z
  .object({
    id: z.uuid(),
    connectionId: z.uuid(),
    provider: projectSocialProviderSchema,
    externalId: z.string().min(1).max(500),
    text: z.string(),
    publishedAt: dateTimeSchema.nullable(),
    url: z.url({ protocol: /^https?$/ }).nullable(),
    metrics: socialPostMetricsSchema,
    additionalMetrics: z.array(socialAccountMetricSchema).max(100),
    fetchedAt: dateTimeSchema,
  })
  .openapi("SocialAccountPost");

export const socialAccountStatisticsQuerySchema =
  socialPostStatisticsQuerySchema.safeExtend({
    connectionId: z.uuid().optional(),
    cursor: z.uuid().optional(),
  });
export const socialAccountStatisticsPageSchema = z
  .object({
    accounts: z.array(socialAccountStatisticsAccountSchema),
    posts: z.array(socialAccountPostSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("SocialAccountStatisticsPage");
export const refreshSocialAccountStatisticsRequestSchema = z
  .object({
    continueHistory: z.boolean().optional(),
  })
  .strict()
  .openapi("RefreshSocialAccountStatisticsRequest");
export const refreshSocialAccountStatisticsResponseSchema = z
  .object({
    account: socialAccountStatisticsAccountSchema,
    importedPostCount: z.number().int().min(0),
  })
  .openapi("RefreshSocialAccountStatisticsResponse");

/** Provider results are validated before any cache write. */
export const socialAccountStatisticsProviderPageSchema = z.object({
  accountMetrics: z.array(socialAccountMetricSchema).max(100).nullable(),
  accountError: z.string().nullable(),
  posts: z
    .array(
      socialAccountPostSchema.omit({
        id: true,
        connectionId: true,
        provider: true,
        fetchedAt: true,
      }),
    )
    .max(1000),
  nextCursor: z.string().max(10000).nullable(),
  historyError: z.string().nullable(),
  metricWarning: z.string().nullable().default(null),
});
