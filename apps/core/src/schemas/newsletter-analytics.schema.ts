import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import {
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
} from "@/schemas/pagination.schema";

// Calendar dates stay strings in the generated client; date format becomes Date.
const utcDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => z.iso.date().safeParse(value).success,
    "Use a valid YYYY-MM-DD date",
  );

export const newsletterAnalyticsQuerySchema =
  cursorPaginationQuerySchema.extend({
    cursor: z.uuid().optional(),
    limit: cursorPaginationQuerySchema.shape.limit.optional(),
    from: utcDateSchema.optional().openapi({
      description: "First UTC date, inclusive. Defaults to 29 days before to.",
    }),
    to: utcDateSchema.optional().openapi({
      description:
        "Last UTC date, inclusive. Defaults to today. Maximum range: 366 days.",
    }),
  });

export const newsletterAnalyticsTotalsSchema = z
  .object({
    sent: z.int().nonnegative(),
    delivered: z.int().nonnegative(),
    uniqueOpens: z.int().nonnegative(),
    uniqueClicks: z.int().nonnegative(),
    unsubscribes: z.int().nonnegative().nullable().openapi({
      description:
        "Distinct newsletter unsubscribers, including manual changes. Null for an individual issue because unsubscribe links do not identify an issue.",
    }),
    bounces: z.int().nonnegative(),
    complaints: z.int().nonnegative(),
    openRate: z.number().nonnegative().openapi({
      description:
        "Unique subscribers who opened / delivered sends; falls back to sent when delivered is zero. Fraction, not percentage.",
    }),
    clickRate: z.number().nonnegative().openapi({
      description:
        "Unique subscribers who clicked / delivered sends; falls back to sent when delivered is zero. Fraction, not percentage.",
    }),
    activeSubscribers: z.int().nonnegative().openapi({
      description:
        "Current active subscribers in this newsletter, independent of date range or issue.",
    }),
  })
  .openapi("NewsletterAnalyticsTotals");

export const newsletterAnalyticsSchema = z
  .object({
    from: utcDateSchema,
    to: utcDateSchema,
    totals: newsletterAnalyticsTotalsSchema,
    subscriberGrowth: z.array(
      z.object({
        date: utcDateSchema,
        newActive: z.int().nonnegative(),
        unsubscribed: z.int().nonnegative(),
        bounced: z.int().nonnegative(),
        net: z.int(),
        runningTotal: z.int().nonnegative(),
      }),
    ),
    engagement: z.array(
      z.object({
        date: utcDateSchema,
        uniqueOpens: z.int().nonnegative(),
        uniqueClicks: z.int().nonnegative(),
      }),
    ),
    issuesPagination: cursorPaginationMetaSchema,
    issues: z.array(
      z.object({
        id: z.uuid(),
        subject: z.string(),
        sentAt: dateTimeSchema.nullable(),
        sent: z.int().nonnegative(),
        uniqueOpens: z.int().nonnegative(),
        uniqueClicks: z.int().nonnegative(),
        unsubscribes: z.int().nonnegative().nullable(),
        openRate: z.number().nonnegative(),
        clickRate: z.number().nonnegative(),
      }),
    ),
  })
  .openapi("NewsletterAnalytics");

export const newsletterIssueAnalyticsSchema = z
  .object({
    totals: newsletterAnalyticsTotalsSchema,
    topLinks: z.array(
      z.object({ url: z.string(), uniqueClicks: z.int().nonnegative() }),
    ),
  })
  .openapi("NewsletterIssueAnalytics");

export type NewsletterAnalyticsQuery = z.infer<
  typeof newsletterAnalyticsQuerySchema
>;
