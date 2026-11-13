import { z } from "@hono/zod-openapi";

import {
  SEO_STATS_MAX_DAYS,
  SEO_STATS_PROVIDERS,
} from "@/lib/seo/native-statistics";
import {
  SEO_MAX_PAGES,
  seoDateSchema,
  seoIdSchema,
} from "./project-seo.schema";
import {
  seoSearchTypeSchema,
  seoTrafficChannelSchema,
} from "./project-seo-traffic.schema";

export const seoStatisticsProviderQuerySchema = z.object({
  provider: z.enum(SEO_STATS_PROVIDERS),
});
export const syncProjectSeoStatisticsSchema = z
  .object({
    provider: z.enum(SEO_STATS_PROVIDERS),
    propertyId: z.string().trim().min(1).max(500),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES).optional(),
    scopeId: seoIdSchema.optional(),
    expectedScopeVersion: z.number().int().positive().optional(),
    from: seoDateSchema,
    to: seoDateSchema,
    channel: seoTrafficChannelSchema.default("all"),
    searchType: seoSearchTypeSchema.default("web"),
  })
  .strict()
  .refine(
    (input) =>
      input.searchType === "web" || input.provider === "search_console",
    "Only Search Console reads a search type",
  )
  .refine(
    (input) => input.channel !== "ai_assistant" || input.provider === "ga4",
    "Only Google Analytics reads the AI Assistant channel",
  )
  .refine(
    (input) => !(input.pageIds && input.scopeId),
    "Choose pages or a saved scope",
  )
  .refine(
    (input) =>
      input.scopeId
        ? input.expectedScopeVersion !== undefined
        : input.expectedScopeVersion === undefined,
    "A saved scope requires its last-read expectedScopeVersion",
  )
  .refine(
    (input) =>
      input.from <= input.to &&
      Date.parse(input.to) - Date.parse(input.from) <
        SEO_STATS_MAX_DAYS * 86_400_000,
    "Choose a period of at most one year",
  )
  .openapi("SyncProjectSeoStatisticsRequest");
export const projectSeoStatisticsPropertiesSchema = z
  .object({
    provider: z.enum(SEO_STATS_PROVIDERS),
    properties: z.array(z.object({ id: z.string(), name: z.string() })),
    status: z.enum(["available", "partial", "not_connected", "unavailable"]),
    reason: z.string().nullable(),
  })
  .openapi("ProjectSeoStatisticsProperties");
/** The request as callers send it: defaulted fields may be left out. */
export type SyncProjectSeoStatistics = z.input<
  typeof syncProjectSeoStatisticsSchema
>;
export type ProjectSeoStatisticsProperties = z.infer<
  typeof projectSeoStatisticsPropertiesSchema
>;
