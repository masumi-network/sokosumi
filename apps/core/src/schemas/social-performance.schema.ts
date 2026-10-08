import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { projectSocialProviderSchema } from "@/schemas/project-social-connection.schema";
import {
  socialAccountPostContentTypeSchema,
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
} from "@/schemas/social-account-statistics.schema";

const nullableNumber = z.number().finite().nullable();
const count = z.number().int().min(0);
const date = z.iso.date();

export const socialPerformanceQuerySchema = z
  .object({
    provider: projectSocialProviderSchema.optional(),
    connectionId: z.uuid().optional(),
    publishedFrom: z.iso.datetime({ offset: true }).optional(),
    publishedUntil: z.iso.datetime({ offset: true }).optional(),
    timezone: z
      .string()
      .max(100)
      .default("UTC")
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "A valid IANA timezone is required"),
    search: z.string().max(200).optional(),
    contentType: socialAccountPostContentTypeSchema.optional(),
    postKind: z
      .enum(["posts", "replies", "quotes", "reposts", "all"])
      .default("posts"),
    sort: z
      .enum([
        "publishedAt",
        "views",
        "impressions",
        "likes",
        "interactions",
        "engagementRate",
        "baselineMultiplier",
      ])
      .default("interactions"),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .refine(
    (query) => {
      if (!query.publishedFrom || !query.publishedUntil) return true;
      const duration =
        new Date(query.publishedUntil).getTime() -
        new Date(query.publishedFrom).getTime();
      return duration >= 0 && duration < 366 * 86_400_000;
    },
    {
      message: "Publication range must be ordered and shorter than 366 days",
      path: ["publishedUntil"],
    },
  );
export type SocialPerformanceQuery = z.infer<
  typeof socialPerformanceQuerySchema
>;

export const socialPerformanceMetricSchema = z
  .object({
    total: nullableNumber,
    mean: nullableNumber,
    median: nullableNumber,
    measuredPostCount: count,
  })
  .openapi("SocialPerformanceMetric");

const metricFields = {
  views: socialPerformanceMetricSchema,
  impressions: socialPerformanceMetricSchema,
  likes: socialPerformanceMetricSchema,
  comments: socialPerformanceMetricSchema,
  shares: socialPerformanceMetricSchema,
  saves: socialPerformanceMetricSchema,
};
export const socialPerformanceRateSchema = z
  .object({
    provider: projectSocialProviderSchema,
    denominator: z.enum(["views", "impressions"]),
    numeratorMetrics: z.array(z.string()),
    interactions: nullableNumber,
    exposure: nullableNumber,
    rate: nullableNumber,
    mean: nullableNumber,
    median: nullableNumber,
    measuredPostCount: count,
  })
  .openapi("SocialPerformanceRate");

export const socialPerformanceSummarySchema = z
  .object({
    postCount: count,
    measuredPostCount: count,
    metrics: z.object(metricFields),
    interactions: socialPerformanceMetricSchema,
    engagementRates: z.array(socialPerformanceRateSchema),
    additionalMetrics: z.array(
      z.object({
        key: z.string(),
        period: z.string().nullable(),
        unit: z.string().nullable(),
        aggregate: socialPerformanceMetricSchema,
      }),
    ),
  })
  .openapi("SocialPerformanceSummary");
export type SocialPerformanceSummary = z.infer<
  typeof socialPerformanceSummarySchema
>;

export const socialPerformancePostSchema = socialAccountPostSchema
  .extend({
    interactions: nullableNumber,
    engagementRate: nullableNumber,
    engagementDenominator: z.enum(["views", "impressions"]).nullable(),
    baselineMultiplier: nullableNumber,
    baselineSampleSize: count,
  })
  .openapi("SocialPerformancePost");

export const socialPerformanceResponseSchema = z
  .object({
    range: z.object({
      publishedFrom: dateTimeSchema,
      publishedUntil: dateTimeSchema,
      previousFrom: dateTimeSchema,
      previousUntil: dateTimeSchema,
      timezone: z.string(),
      semantics: z.literal("lifetime_metrics_by_publication_cohort"),
    }),
    accounts: z.array(socialAccountStatisticsAccountSchema),
    summary: z.object({
      current: socialPerformanceSummarySchema,
      previous: socialPerformanceSummarySchema,
      deltas: z.object({
        postCount: nullableNumber,
        views: nullableNumber,
        impressions: nullableNumber,
        likes: nullableNumber,
        comments: nullableNumber,
        shares: nullableNumber,
        saves: nullableNumber,
        interactions: nullableNumber,
      }),
    }),
    daily: z.array(z.object({ date, summary: socialPerformanceSummarySchema })),
    comparisons: z.object({
      accounts: z.array(
        z.object({
          connectionId: z.uuid(),
          provider: projectSocialProviderSchema,
          summary: socialPerformanceSummarySchema,
        }),
      ),
      providers: z.array(
        z.object({
          provider: projectSocialProviderSchema,
          summary: socialPerformanceSummarySchema,
        }),
      ),
      formats: z.array(
        z.object({
          contentType: socialAccountPostContentTypeSchema,
          summary: socialPerformanceSummarySchema,
        }),
      ),
    }),
    heatmap: z.object({
      timezone: z.string(),
      comparisonProvider: projectSocialProviderSchema.nullable(),
      postCount: count,
      minimumSampleSize: count,
      cells: z.array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          hour: z.number().int().min(0).max(23),
          postCount: count,
          measuredPostCount: count,
          meanInteractions: nullableNumber,
          meanEngagementRate: nullableNumber,
        }),
      ),
    }),
    followers: z.array(
      z.object({
        connectionId: z.uuid(),
        provider: projectSocialProviderSchema,
        change: nullableNumber,
        points: z.array(
          z.object({ date, fetchedAt: dateTimeSchema, value: nullableNumber }),
        ),
      }),
    ),
    observations: z.array(
      z.object({
        connectionId: z.uuid(),
        date,
        fetchedAt: dateTimeSchema,
        summary: socialPerformanceSummarySchema,
      }),
    ),
    baseline: z.object({
      windowDays: count,
      excludeRecentDays: count,
      minimumSampleSize: count,
      metric: z.literal("interactions"),
      comparison: z.literal("same_account_median"),
    }),
    posts: z.array(socialPerformancePostSchema),
    pagination: z.object({
      limit: count,
      offset: count,
      nextOffset: count.nullable(),
      total: count,
      truncated: z.boolean(),
    }),
    coverage: z.object({
      historyComplete: z.boolean(),
      lastFetchedAt: dateTimeSchema.nullable(),
      missingPublicationDateCount: count,
      historicalSnapshotsAvailable: z.boolean(),
      unknownPostKindCount: count,
      unknownContentTypeCount: count,
    }),
  })
  .openapi("SocialPerformanceResponse");
export type SocialPerformanceResponse = z.infer<
  typeof socialPerformanceResponseSchema
>;

export const workspaceSocialPerformanceQuerySchema =
  socialPerformanceQuerySchema.safeExtend({
    projectId: z.uuid().optional(),
  });
export const workspaceSocialPerformanceResponseSchema = z
  .object({
    ...socialPerformanceResponseSchema.shape,
    workspaceId: z.uuid(),
    posts: z.array(
      z.object({
        ...socialPerformancePostSchema.shape,
        projectIds: z.array(z.uuid()),
      }),
    ),
    coverage: socialPerformanceResponseSchema.shape.coverage.extend({
      duplicatePostCopiesExcluded: count,
      deduplicationBasis: z.literal("provider_external_post_id"),
    }),
    projects: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        connectionIds: z.array(z.uuid()),
      }),
    ),
    comparisons: socialPerformanceResponseSchema.shape.comparisons.extend({
      projects: z.array(
        z.object({
          projectId: z.uuid(),
          summary: socialPerformanceSummarySchema,
        }),
      ),
    }),
  })
  .openapi("WorkspaceSocialPerformanceResponse");
export type WorkspaceSocialPerformanceResponse = z.infer<
  typeof workspaceSocialPerformanceResponseSchema
>;
