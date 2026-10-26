import { z } from "@hono/zod-openapi";
import { isValidTimezone } from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  projectSocialConnectionSchema,
  projectSocialProviderSchema,
} from "@/schemas/project-social-connection.schema";
import { socialPostProjectParamsSchema } from "@/schemas/social-post.schema";
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
    strong: z.boolean().default(false),
    canRecycle: z.boolean().default(false),
  })
  .openapi("SocialAccountPost");
export type SocialAccountPost = z.infer<typeof socialAccountPostSchema>;

export const socialAccountStatisticsQuerySchema =
  socialPostStatisticsQuerySchema.safeExtend({
    connectionId: z.uuid().optional(),
    cursor: z.uuid().optional(),
  });
export const socialAccountStatisticsExportQuerySchema = z
  .object({
    provider: projectSocialProviderSchema.optional(),
    connectionId: z.uuid().optional(),
    publishedFrom: z.iso.datetime({ offset: true }).optional(),
    publishedUntil: z.iso.datetime({ offset: true }).optional(),
    format: z.enum(["csv", "xlsx"]).default("csv"),
  })
  .refine(
    (query) =>
      !query.publishedFrom ||
      !query.publishedUntil ||
      new Date(query.publishedFrom) <= new Date(query.publishedUntil),
    {
      message: "Publication start must precede publication end",
      path: ["publishedUntil"],
    },
  );

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

export const socialConnectionSuggestedTimesQuerySchema = z.object({
  timezone: z
    .string()
    .min(1)
    .refine((value) => isValidTimezone(value), {
      message: "timezone must be a valid IANA time zone",
    })
    .openapi({
      param: { name: "timezone", in: "query" },
      example: "Europe/Zurich",
    }),
});

export const socialConnectionSuggestedTimesSchema = z
  .object({
    hours: z.array(z.number().int().min(0).max(23)).max(3),
  })
  .openapi("SocialConnectionSuggestedTimes");

/** Provider results are validated before any cache write. */
export const socialAccountStatisticsProviderPageSchema = z.object({
  accountMetrics: z.array(socialAccountMetricSchema).max(100).nullable(),
  subscriptionType: z.string().nullable().default(null),
  accountError: z.string().nullable(),
  posts: z
    .array(
      socialAccountPostSchema.omit({
        id: true,
        connectionId: true,
        provider: true,
        fetchedAt: true,
        strong: true,
        canRecycle: true,
      }),
    )
    .max(1000),
  nextCursor: z.string().max(10000).nullable(),
  historyError: z.string().nullable(),
  metricWarning: z.string().nullable().default(null),
});

export const socialAccountPostParamsSchema =
  socialPostProjectParamsSchema.extend({
    accountPostId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "accountPostId", in: "path" },
        example: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
  });

export const recycleSocialAccountPostRequestSchema = z
  .object({
    delayDays: z
      .union([z.literal(7), z.literal(14), z.literal(30)])
      .optional()
      .openapi({ example: 7 }),
    timezone: z
      .string()
      .refine((value) => isValidTimezone(value), {
        message: "timezone must be a valid IANA time zone",
      })
      .optional()
      .openapi({ example: "Europe/Zurich" }),
  })
  .refine((value) => !value.delayDays || Boolean(value.timezone), {
    message: "timezone is required when scheduling",
  })
  .openapi("RecycleSocialAccountPostRequest");
