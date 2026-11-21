import { z } from "@hono/zod-openapi";
import { SEO_SEARCH_TYPES } from "@sokosumi/utils";

import { seoUrlSchema } from "./project-seo.schema";

/** Google's documented searchAnalytics.query limits. Out-of-range values are refused, never clamped. */
export const GSC_TASK_ROW_LIMIT_MAX = 25_000;
export const GSC_TASK_START_ROW_MAX = 975_000;
export const GSC_TASK_FILTER_EXPRESSION_MAX = 4096;
const GSC_TASK_FILTER_GROUPS_MAX = 4;
const GSC_TASK_FILTERS_PER_GROUP_MAX = 16;
const PROPERTY_MAX = 500;

export const SEO_TASK_SEARCH_CONSOLE_STATUSES = [
  "NOT_CONNECTED",
  "PENDING",
  "CONNECTED",
  "UNAVAILABLE",
] as const;
export const SEO_TASK_SEARCH_CONSOLE_REASONS = [
  "not_connected",
  "reconnect",
  "property",
  "unavailable",
  "limited_audit",
] as const;

export const seoTaskSearchConsoleStatusSchema = z
  .strictObject({
    provider: z.literal("search-console"),
    status: z.enum(SEO_TASK_SEARCH_CONSOLE_STATUSES),
    reason: z.enum(SEO_TASK_SEARCH_CONSOLE_REASONS).optional(),
    authenticationUrl: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi("SeoTaskSearchConsoleStatus");
export type SeoTaskSearchConsoleStatus = z.infer<
  typeof seoTaskSearchConsoleStatusSchema
>;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    "Use a real calendar date",
  );
const filterDimension = z.enum([
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);

/** A subset of Google's searchAnalytics.query body, in Google's own field names. */
export const gscTaskSearchAnalyticsQuerySchema = z
  .strictObject({
    startDate: date,
    endDate: date,
    dimensions: z
      .array(
        z.enum([
          "query",
          "page",
          "country",
          "device",
          "date",
          "searchAppearance",
        ]),
      )
      .max(6)
      .refine((items) => new Set(items).size === items.length)
      .optional(),
    type: z.enum(SEO_SEARCH_TYPES).optional(),
    dimensionFilterGroups: z
      .array(
        z.strictObject({
          groupType: z.literal("and").optional(),
          filters: z
            .array(
              z.strictObject({
                dimension: filterDimension,
                operator: z
                  .enum([
                    "contains",
                    "equals",
                    "notContains",
                    "notEquals",
                    "includingRegex",
                    "excludingRegex",
                  ])
                  .optional(),
                expression: z
                  .string()
                  .min(1)
                  .max(GSC_TASK_FILTER_EXPRESSION_MAX),
              }),
            )
            .min(1)
            .max(GSC_TASK_FILTERS_PER_GROUP_MAX),
        }),
      )
      .max(GSC_TASK_FILTER_GROUPS_MAX)
      .optional(),
    aggregationType: z
      .enum(["auto", "byPage", "byProperty", "byNewsShowcasePanel"])
      .optional(),
    dataState: z.enum(["final", "all"]).optional(),
    rowLimit: z.number().int().min(1).max(GSC_TASK_ROW_LIMIT_MAX),
    startRow: z.number().int().min(0).max(GSC_TASK_START_ROW_MAX),
  })
  .refine((query) => query.startDate <= query.endDate, {
    message: "startDate must not be after endDate",
    path: ["startDate"],
  })
  .openapi("SeoTaskSearchAnalyticsQuery");
export type GscTaskSearchAnalyticsQuery = z.infer<
  typeof gscTaskSearchAnalyticsQuerySchema
>;

/** Stale-context assertions only. They never select an owner, account or property. */
const expected = {
  expectedOwnerId: z.string().min(1).max(128),
  expectedOrganizationId: z.string().min(1).max(128).nullable(),
};
const siteUrl = z.string().min(1).max(PROPERTY_MAX);

export const seoTaskSearchConsoleReadSchema = z
  .discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("sites.list"), ...expected }),
    z.strictObject({
      operation: z.literal("searchAnalytics.query"),
      siteUrl,
      query: gscTaskSearchAnalyticsQuerySchema,
      ...expected,
    }),
    z.strictObject({
      operation: z.literal("urlInspection.inspect"),
      siteUrl,
      inspectionUrl: seoUrlSchema,
      ...expected,
    }),
  ])
  .openapi("SeoTaskSearchConsoleRead");
export type SeoTaskSearchConsoleRead = z.infer<
  typeof seoTaskSearchConsoleReadSchema
>;

export const seoTaskSearchConsoleReplySchema = z
  .strictObject({
    status: z.number().int().min(200).max(599),
    body: z
      .record(z.string(), z.unknown())
      .openapi({ description: "Google's native JSON body for the operation" }),
  })
  .openapi("SeoTaskSearchConsoleReply");
export type SeoTaskSearchConsoleReply = z.infer<
  typeof seoTaskSearchConsoleReplySchema
>;
