import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const metricSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();

export const socialPostMetricsSchema = z
  .object({
    views: metricSchema,
    impressions: metricSchema,
    likes: metricSchema,
    comments: metricSchema,
    shares: metricSchema,
    saves: metricSchema,
  })
  .openapi("SocialPostMetrics");

export type SocialPostMetrics = z.infer<typeof socialPostMetricsSchema>;

export const socialPostStatisticsSchema = z
  .object({
    metrics: socialPostMetricsSchema,
    fetchedAt: dateTimeSchema.nullable(),
    refreshAttemptedAt: dateTimeSchema.nullable(),
    error: z.string().nullable(),
  })
  .openapi("SocialPostStatistics");

export type SocialPostStatistics = z.infer<typeof socialPostStatisticsSchema>;

export const socialPostStatisticsQuerySchema = cursorPaginationQuerySchema
  .extend({
    provider: z
      .enum(["x", "linkedin", "facebook", "instagram", "tiktok", "youtube"])
      .optional(),
    publishedFrom: z.iso.datetime({ offset: true }).optional(),
    publishedUntil: z.iso.datetime({ offset: true }).optional(),
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

export const socialPostStatisticsSummarySchema = z
  .object({
    provider: z.string(),
    postCount: z.number().int().min(0),
    measuredPostCount: z.number().int().min(0),
    metrics: socialPostMetricsSchema,
  })
  .openapi("SocialPostStatisticsSummary");
