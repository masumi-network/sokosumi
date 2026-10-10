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
    consecutiveFailures: z.number().int().min(0).optional().default(0),
  })
  .openapi("SocialAccountStatistics");
export type SocialAccountStatistics = z.infer<
  typeof socialAccountStatisticsSchema
>;

export const socialSyncReadModelSchema = z
  .object({
    status: z.enum([
      "fresh",
      "stale",
      "queued",
      "running",
      "reauth_required",
      "partial",
    ]),
    dataFetchedAt: dateTimeSchema.nullable(),
    headFetchedAt: dateTimeSchema.nullable(),
    dataVersion: z.string(),
    mayAutoRequest: z.boolean(),
    lastError: z.string().nullable(),
    partialWarnings: z.array(z.string()),
  })
  .openapi("SocialSyncReadModel");

export const socialAccountStatisticsAccountSchema =
  projectSocialConnectionSchema
    .extend({
      // Optional nullable references let the generated date transformer skip empty snapshots.
      statistics: socialAccountStatisticsSchema.nullable().optional(),
      postCount: z.number().int().min(0),
      sync: socialSyncReadModelSchema.optional(),
    })
    .openapi("SocialAccountStatisticsAccount");

export const socialAccountPostContentTypeSchema = z
  .enum(["text", "image", "video", "carousel", "link", "unknown"])
  .openapi("SocialAccountPostContentType");
export const socialAccountPostKindSchema = z
  .enum(["post", "reply", "quote", "repost", "unknown"])
  .openapi("SocialAccountPostKind");

/** Provider-hosted media is a read-only preview, not an owned Drive attachment. */
export type SocialAccountPostMedia = {
  kind: "image" | "gif" | "video";
  url: string;
  thumbnailUrl: string | null;
};
export const socialAccountPostMediaSchema = z
  .object({
    kind: z.enum(["image", "gif", "video"]),
    url: z.url({ protocol: /^https?$/ }),
    thumbnailUrl: z.url({ protocol: /^https?$/ }).nullable(),
  })
  .openapi("SocialAccountPostMedia");

export const socialAccountPostSchema = z
  .object({
    id: z.uuid(),
    connectionId: z.uuid(),
    provider: projectSocialProviderSchema,
    externalId: z.string().min(1).max(500),
    text: z.string(),
    contentType: socialAccountPostContentTypeSchema.default("unknown"),
    postKind: socialAccountPostKindSchema.default("unknown"),
    media: z.array(socialAccountPostMediaSchema).max(20).default([]),
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

const headlineNumber = z.number().finite().nullable();
export const socialPerformanceHeadlineTotalsSchema = z.object({
  postCount: z.number().int().min(0),
  views: headlineNumber,
  impressions: headlineNumber,
  interactions: headlineNumber,
});
export const socialPerformanceHeadlineSchema = z
  .object({
    current: socialPerformanceHeadlineTotalsSchema,
    previous: socialPerformanceHeadlineTotalsSchema,
    deltas: z.object({
      postCount: headlineNumber,
      views: headlineNumber,
      impressions: headlineNumber,
      interactions: headlineNumber,
    }),
    daily: z
      .array(
        socialPerformanceHeadlineTotalsSchema.extend({
          date: z.iso.date(),
        }),
      )
      .max(366),
  })
  .openapi("SocialPerformanceHeadline");
export const socialPerformanceConsistencySchema = z
  .object({
    from: z.iso.date().nullable(),
    until: z.iso.date().nullable(),
    daily: z
      .array(
        z.object({
          date: z.iso.date(),
          postCount: z.number().int().min(0),
          interactions: z.number().finite().nullable(),
        }),
      )
      .max(368),
  })
  .openapi("SocialPerformanceConsistency");

export const socialAccountStatisticsPageSchema = z
  .object({
    accounts: z.array(socialAccountStatisticsAccountSchema),
    posts: z.array(socialAccountPostSchema),
    nextCursor: z.string().nullable(),
    headline: socialPerformanceHeadlineSchema,
    consistency: socialPerformanceConsistencySchema,
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
