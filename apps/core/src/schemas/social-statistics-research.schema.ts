import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { errorResponseWithExtensionsSchema } from "@/helpers/error";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  socialAccountPostKindSchema,
  socialAccountPostSchema,
  socialPerformanceHeadlineTotalsSchema,
} from "@/schemas/social-account-statistics.schema";

const nullableCount = z.number().int().nonnegative().nullable();
export const socialStatisticsResearchErrorCodeSchema = z.enum([
  "x_access_denied",
  "x_rate_limited",
  "x_reconnect_required",
  "x_upstream_error",
  "x_upstream_unavailable",
]);
export const socialStatisticsResearchErrorResponseSchema =
  errorResponseWithExtensionsSchema(
    { code: socialStatisticsResearchErrorCodeSchema.optional() },
    "SocialStatisticsResearchError",
  );
const audienceKindSchema = z.enum([
  "followers",
  "mentions",
  "likers",
  "reposters",
]);
export const socialStatisticsResearchCursorSchema = z
  .string()
  .max(9000)
  .regex(/^[A-Za-z0-9_=.~+\/-]+$/)
  .optional();

export const socialPerformanceAudienceQuerySchema = cursorPaginationQuerySchema
  .extend({
    kind: audienceKindSchema.default("mentions"),
    postId: z.uuid().optional(),
    cursor: socialStatisticsResearchCursorSchema,
    limit: z.coerce.number().int().min(5).max(100).default(100),
  })
  .superRefine((value, context) => {
    if (
      (value.kind === "likers" || value.kind === "reposters") &&
      !value.postId
    )
      context.addIssue({
        code: "custom",
        path: ["postId"],
        message: "Choose a cached post for its likers or reposters",
      });
  });

export const socialPerformanceContactSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    avatarUrl: z.url({ protocol: /^https?$/ }).nullable(),
    followersCount: nullableCount,
    interactions: nullableCount,
    replies: nullableCount,
    quotes: nullableCount,
    mentions: nullableCount,
    likes: nullableCount.default(null),
    reposts: nullableCount.default(null),
  })
  .openapi("SocialPerformanceContact");

export const socialStatisticsResearchPostSchema = socialAccountPostSchema
  .extend({
    postKind: socialAccountPostKindSchema.default("post"),
  })
  .openapi("SocialStatisticsResearchPost");

export const socialPerformancePublicPostSchema = z
  .object({
    author: z.union([socialPerformanceContactSchema, z.null()]),
    post: socialStatisticsResearchPostSchema,
    interactionType: z
      .enum(["reply", "quote", "mention"])
      .nullable()
      .default(null),
  })
  .openapi("SocialPerformancePublicPost");

export const socialPerformanceAudienceResponseSchema = z
  .object({
    kind: audienceKindSchema,
    postId: z.uuid().nullable().default(null),
    contacts: z.array(socialPerformanceContactSchema),
    posts: z.array(socialPerformancePublicPostSchema).max(100).default([]),
    nextCursor: z.string().nullable(),
    observedAt: dateTimeSchema,
    samplePostCount: z.number().int().nonnegative(),
    oldestPostAt: dateTimeSchema.nullable(),
    newestPostAt: dateTimeSchema.nullable(),
    coverage: z.string(),
  })
  .openapi("SocialPerformanceAudienceResponse");

const threshold = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional();

export const socialPerformanceDiscoveryQuerySchema = z
  .object({
    topic: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\p{L}\p{N} #@.,!?'’-]+$/u)
      .optional(),
    username: z
      .string()
      .min(1)
      .max(15)
      .regex(/^[A-Za-z0-9_]+$/)
      .optional(),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/)
      .optional(),
    format: z
      .enum(["any", "text", "image", "video", "carousel", "link"])
      .default("any"),
    publishedFrom: z.iso.datetime({ offset: true }).optional(),
    publishedUntil: z.iso.datetime({ offset: true }).optional(),
    cursor: socialStatisticsResearchCursorSchema,
    limit: z.coerce.number().int().min(10).max(100).default(100),
    sort: z.enum(["recency", "likes", "impressions"]).default("recency"),
    minLikes: threshold,
    minComments: threshold,
    minShares: threshold,
    minImpressions: threshold,
    minFollowers: threshold,
    maxFollowers: threshold,
  })
  .superRefine((value, context) => {
    if (!value.topic && !value.username)
      context.addIssue({
        code: "custom",
        path: ["topic"],
        message: "Enter a topic or public account handle",
      });
    if (
      value.minFollowers !== undefined &&
      value.maxFollowers !== undefined &&
      value.minFollowers > value.maxFollowers
    )
      context.addIssue({
        code: "custom",
        path: ["maxFollowers"],
        message: "Maximum followers must be at least the minimum",
      });
    if (
      value.publishedFrom &&
      value.publishedUntil &&
      new Date(value.publishedFrom) >= new Date(value.publishedUntil)
    )
      context.addIssue({
        code: "custom",
        path: ["publishedUntil"],
        message: "End time must be after start time",
      });
  });

export const socialPerformanceDiscoveryResponseSchema = z
  .object({
    posts: z.array(socialPerformancePublicPostSchema).max(100),
    nextCursor: z.string().nullable(),
    observedAt: dateTimeSchema,
    publishedFrom: dateTimeSchema,
    publishedUntil: dateTimeSchema,
    samplePostCount: z.number().int().nonnegative(),
    matchedPostCount: z.number().int().nonnegative(),
    missingCounterPostCount: z.number().int().nonnegative(),
    coverage: z.string(),
  })
  .openapi("SocialPerformanceDiscoveryResponse");

export const socialPerformanceBenchmarkQuerySchema = z.object({
  username: z
    .string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/),
});

export const socialPerformanceBenchmarkResponseSchema = z
  .object({
    profile: z.object({
      id: z.string(),
      name: z.string(),
      username: z.string(),
      avatarUrl: z.url({ protocol: /^https?$/ }).nullable(),
      followersCount: nullableCount,
    }),
    observedAt: dateTimeSchema,
    summary: socialPerformanceHeadlineTotalsSchema,
    posts: z.array(socialStatisticsResearchPostSchema),
    meanImpressionsToFollowers: z.number().finite().nullable(),
    coverage: z.string(),
  })
  .openapi("SocialPerformanceBenchmarkResponse");
