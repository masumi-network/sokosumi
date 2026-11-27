import { z } from "@hono/zod-openapi";
import {
  SEO_FULL_AUDIT_CREDITS,
  SEO_FULL_AUDIT_MARKUP_PERCENT,
} from "@sokosumi/utils";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  seoArticleDates,
  seoPrivateTopicQuery,
  seoTopicLaunch,
} from "@/helpers/seo-content-history";
import { SEO_SHARING_SCOPES } from "@/lib/seo/data-visibility";
import { SEO_STATS_MAX_DAYS } from "@/lib/seo/native-statistics";
import {
  seoJobSchema,
  seoRunSchema,
  seoTimelineSchema,
} from "./project-seo-history.schema";
import {
  seoAnalysisKindSchema,
  seoSeveritySchema,
} from "./seo-analysis-enums.schema";
import { seoSnapshotIdSchema } from "./seo-site-crawl.schema";

export { seoSeveritySchema } from "./seo-analysis-enums.schema";

import {
  seoDeviceSchema,
  seoObservationSchema,
} from "./seo-audit-coverage.schema";
import { seoEditorialKeywordSchema } from "./seo-editorial-keyword.schema";
import { publicSitemapInputFields } from "./seo-sitemap-evidence.schema";

export {
  seoDeviceSchema,
  seoModuleCoverageSchema,
  seoObservationSchema,
} from "./seo-audit-coverage.schema";

import { seoActionSchema } from "./project-seo-action.schema";
import {
  seoConversionSchema,
  seoKeywordEstimateFields,
} from "./project-seo-keyword-estimate.schema";
import {
  seoMonitorChangeSchema,
  seoMonitorLastRunSchema,
  seoMonitorRuleSchema,
} from "./project-seo-monitor.schema";
import {
  SEO_RANK_HISTORY_POINTS,
  SEO_SERP_SERIES_MAX,
  seoPositionPointSchema,
  seoSerpSeriesSchema,
  seoShareOfVoiceSchema,
} from "./project-seo-rankings.schema";
import { seoWorkspaceSeasonalIdeaSchema } from "./project-seo-seasonal.schema";
import { seoStrategySchema } from "./project-seo-strategy.schema";
import {
  seoSearchQueryRowSchema,
  seoSearchTypeSchema,
  seoTrafficChannelSchema,
  seoWorkspaceSearchBreakdownSchema,
  workspaceLandingFields,
} from "./project-seo-traffic.schema";
import {
  auditSearchConsoleInputFields,
  seoAuditPerformanceSchema,
  validPrivateAuditScope,
} from "./seo-audit-performance.schema";
import {
  seoCostPlusPriceSchema,
  seoFullAuditLimitsSchema,
} from "./seo-audit-price.schema";
import { seoLandingEngagementChange } from "./seo-landing-engagement.schema";
import {
  SEO_MAX_PAGES,
  seoBriefAction,
  seoIdSchema,
  seoPageSchema,
  seoScopeSchema,
  seoUrlSchema,
} from "./seo-page.schema";
import { workspaceSiteEvidenceFields } from "./seo-site-evidence.schema";
import { workspaceSiteSpeedFields } from "./seo-site-speed.schema";

export {
  SEO_SEARCH_QUERY_ROW_LIMIT,
  seoSearchQueryRowSchema,
} from "./project-seo-traffic.schema";
export {
  SEO_MAX_PAGES,
  seoIdSchema,
  seoPageSchema,
  seoScopeSchema,
  seoUrlSchema,
} from "./seo-page.schema";

export const SEO_MAX_INDEX_ASSESSMENTS = SEO_MAX_PAGES * SEO_MAX_PAGES;
export const SEO_MAX_KEYWORDS = 20;
export const SEO_MAX_COMPETITORS = 10;
export const SEO_MAX_PROVIDER_CALLS = 100;
export const SEO_PAGE_CHANGE_CLOCK_SKEW_MS = 5 * 60_000;
const SEO_SERP_LANGUAGES = new Set(
  "af ak am ar az be bg bn bs ca cs cy da de ee el en es et eu fa fi fo fr fy ga gl gu ha he hi hr ht hu hy id ig is it iw ja ka kg kk km kn ko ky lg ln lo lt lv mg mi mk ml mn mr ms mt my ne nl no ny om pa pl ps pt qu rm rn ro ru rw sd si sk sl sn so sq sr st sv sw ta te tg th ti tk tl tn to tr uk ur uz vi wo xh yo zu".split(
    " ",
  ),
);
export const seoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Expected a calendar date");
export const seoAnalysisModuleSchema = z.enum([
  "page.inspect",
  "keyword.refresh",
  "links.refresh",
]);

export const seoWorkspaceQuerySchema = z
  .object({
    scopeId: seoIdSchema.optional(),
    pageId: seoIdSchema.optional(),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES).optional(),
    from: seoDateSchema.optional(),
    to: seoDateSchema.optional(),
    channel: seoTrafficChannelSchema.optional(),
    /** Search Console rows of this search type. Absent reads web search. */
    searchType: seoSearchTypeSchema.optional(),
  })
  .refine(
    (input) =>
      [input.scopeId, input.pageId, input.pageIds].filter(Boolean).length <= 1,
    "Choose a saved scope, page or explicit pages",
  )
  .refine(
    (input) => !input.from || !input.to || input.from <= input.to,
    "Period ends before it starts",
  );
export const seoProjectParamsSchema = z.object({ id: seoIdSchema });
export const seoScopeParamsSchema = seoProjectParamsSchema.extend({
  scopeId: seoIdSchema,
});
export {
  addSeoPageSchema,
  createSeoScopeSchema,
  updateSeoScopeSchema,
} from "./seo-page.schema";
export const importSeoAuditSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    fileId: z.string().min(1).max(128),
    recoverMarkets: z.boolean().optional(),
    recoverPageSpeed: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (input) => !(input.recoverPageSpeed && input.recoverMarkets),
    "Choose one report section to recover",
  )
  .openapi("ImportProjectSeoAuditRequest");
export const requestSeoAnalysisSchema = z
  .object({
    kind: seoAnalysisKindSchema,
    scopeId: seoIdSchema.optional(),
    expectedScopeVersion: z.number().int().positive().optional(),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES).optional(),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((value) => !/["\p{Cc}]/u.test(value), "Unsupported keyword"),
      )
      .max(SEO_MAX_KEYWORDS)
      .default([]),
    countryCode: z.enum([
      "US",
      "GB",
      "DE",
      "AT",
      "CH",
      "FR",
      "ES",
      "IT",
      "NL",
      "BR",
      "PT",
    ]),
    languageCode: z
      .string()
      .regex(/^[a-z]{2}$/)
      .refine(
        (value) => SEO_SERP_LANGUAGES.has(value),
        "Unsupported search language",
      ),
    devices: z
      .array(seoDeviceSchema)
      .min(1)
      .max(2)
      .default(["mobile", "desktop"]),
    competitorUrls: z.array(seoUrlSchema).max(SEO_MAX_COMPETITORS).default([]),
    analyses: z.array(seoAnalysisModuleSchema).min(1).max(3).optional(),
    maxProviderCalls: z
      .number()
      .int()
      .min(0)
      .max(SEO_MAX_PROVIDER_CALLS)
      .default(20),
    fullAuditCredits: z.literal(SEO_FULL_AUDIT_CREDITS).optional(),
    fullAuditPrice: seoCostPlusPriceSchema.optional().openapi({
      description: `Required for \`kind: "audit_full"\`: \`{kind: "cost_plus", version: 1, minimumCredits: ${SEO_FULL_AUDIT_CREDITS}, markupPercent: ${SEO_FULL_AUDIT_MARKUP_PERCENT}}\`. The audit costs its provider cost plus ${SEO_FULL_AUDIT_MARKUP_PERCENT}%, at least ${SEO_FULL_AUDIT_CREDITS} credits. It has no credit cap: \`fullAuditLimits.usd\` bounds the provider cost. Leave out \`maxCredits\`. Confirm the price with the person first.`,
    }),
    ...auditSearchConsoleInputFields,
    ...publicSitemapInputFields,
    setupGoal: z
      .strictObject({
        pageId: seoIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        action: seoBriefAction.nullable(),
      })
      .optional(),
    sharedBrief: z
      .strictObject({
        revision: z.number().int().nonnegative(),
        pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES),
      })
      .optional(),
    fullAuditLimits: seoFullAuditLimitsSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(128),
    coworkerId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.fullAuditPrice ||
      (input.kind === "audit_full" && input.fullAuditCredits === undefined),
    "Choose one full-audit price for a full audit only",
  )
  .refine(
    (input) => !(input.scopeId && input.pageIds),
    "Choose a saved scope or explicit pages",
  )
  .refine(
    (input) => !input.scopeId || input.expectedScopeVersion !== undefined,
    "Reload the page group before requesting an analysis",
  )
  .refine(
    (input) =>
      !input.setupGoal ||
      input.kind === "audit_full" ||
      input.kind === "page_check",
    "Set a page goal with a full audit or page check",
  )
  .refine(
    (input) =>
      !input.sharedBrief ||
      (input.kind === "audit_full" &&
        (input.setupGoal
          ? input.sharedBrief.revision === input.setupGoal.expectedRevision
          : input.sharedBrief.revision > 0)),
    "Share goals from the reviewed brief revision in a full audit",
  )
  .refine(
    validPrivateAuditScope,
    "Property data requires a full audit with Search Console access",
  )
  .openapi("RequestProjectSeoAnalysisRequest");
export const saveSeoKeywordSchema = z
  .object({
    keyword: z.string().trim().min(1).max(200),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    pageId: seoIdSchema.nullable().optional(),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    saved: z.boolean().default(true),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .openapi("SaveProjectSeoKeywordRequest");
export const saveSeoCompetitorSchema = z
  .object({
    url: seoUrlSchema,
    confirmed: z.boolean(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .openapi("SaveProjectSeoCompetitorRequest");
export const createSeoActionTaskSchema = z
  .object({
    observationId: seoIdSchema,
    actionId: z.string().min(1).max(200),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict()
  .openapi("CreateProjectSeoActionTaskRequest");

export const createSeoMonitorSchema = z
  .object({
    operationId: seoIdSchema,
    rule: seoMonitorRuleSchema,
    analysis: requestSeoAnalysisSchema,
  })
  .strict()
  .openapi("CreateProjectSeoMonitorRequest");
export const recordSeoPageChangeSchema = z
  .object({
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES),
    occurredAt: dateTimeSchema,
    title: z.string().trim().min(1).max(200),
    note: z.string().trim().max(2000).default(""),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict()
  .openapi("RecordProjectSeoPageChangeRequest");
export const seoPageChangePayloadSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("page_change"),
    title: z.string().min(1).max(200),
    note: z.string().max(2000),
    occurredAt: dateTimeSchema,
    recordedBy: z.string().min(1).max(128),
  })
  .strict();
export const seoMonitorSchema = z
  .object({
    id: seoIdSchema,
    name: z.string(),
    state: z.string(),
    /** The schedule revision. Edits and Run now send it back. */
    revision: z.number().int(),
    createdAt: dateTimeSchema,
    nextRunAt: dateTimeSchema.nullable(),
    rule: seoMonitorRuleSchema,
    /** Scheduled Runs released so far. Run now Runs do not count. */
    releasedCount: z.number().int(),
    pageIds: z.array(seoIdSchema),
    scopeVersion: z.number().int(),
    countryCode: z.string(),
    languageCode: z.string(),
    devices: z.array(seoDeviceSchema),
    kind: seoAnalysisKindSchema,
    maxProviderCalls: z.number().int(),
    /** The viewer owns the monitor. Only the owner may run it now or change its rule. */
    isOwner: z.boolean(),
    lastRun: z.union([seoMonitorLastRunSchema, z.null()]),
    change: z.union([seoMonitorChangeSchema, z.null()]),
  })
  .openapi("ProjectSeoMonitor");

export const seoFindingSchema = z
  .object({
    id: z.string(),
    observationId: seoIdSchema,
    pageUrl: seoUrlSchema,
    device: z.union([seoDeviceSchema, z.null()]),
    rowId: z.string(),
    title: z.string(),
    severity: seoSeveritySchema,
    evidence: z.array(z.string()),
    suggestedFix: z.string().max(2000).nullable().optional(),
    relatedPageUrl: seoUrlSchema.optional(),
    visibility: z.literal("PRIVATE").optional(),
    sourceRef: z.string(),
    observedAt: dateTimeSchema,
  })
  .openapi("ProjectSeoFinding");
export { seoConversionSchema, seoEditorialKeywordSchema };
export const SEO_AUDIT_IDEA_LIMIT = 50;
export const seoIdeaRankSchema = z
  .number()
  .int()
  .min(1)
  .max(SEO_AUDIT_IDEA_LIMIT)
  .nullable()
  .optional();
export const seoKeywordSchema = z
  .object({
    id: z.string(),
    keyword: z.string(),
    pageUrl: z.union([seoUrlSchema, z.null()]),
    targetPageId: seoIdSchema.nullable(),
    saved: z.boolean(),
    countryCode: z.string(),
    languageCode: z.string(),
    source: z.string(),
    volume: z.number().nullable(),
    editorial: seoEditorialKeywordSchema.optional(),
    ideaRank: seoIdeaRankSchema,
    /** DataForSEO keyword difficulty, 0 to 100: how hard a top 10 place is, from the link profiles of the top 10. */
    difficulty: z.number().nullable(),
    /**
     * Estimated organic clicks a month now and at places 10, 3 and 1: volume times a published click-through
     * rate per place (AWR, July 2026). An estimate, not a measurement. Null without a volume.
     */
    clicks: z
      .object({
        now: z.number().int(),
        top10: z.number().int(),
        top3: z.number().int(),
        top1: z.number().int(),
      })
      .nullable(),
    intent: z.string().nullable(),
    ...seoKeywordEstimateFields,
    device: z.union([seoDeviceSchema, z.null()]),
    position: z.number().nullable(),
    positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
    checkedResults: z.number().int().nullable(),
    observedAt: z.union([dateTimeSchema, z.null()]),
    observationId: z.union([seoIdSchema, z.null()]),
    priority: z.enum(["low", "medium", "high"]),
    version: z.number().int(),
    /**
     * The loaded paid reads of this keyword, page and device from rankings checks (full audits left out), newest
     * last. GSC average positions are separate.
     */
    positionHistory: z
      .array(seoPositionPointSchema)
      .max(SEO_RANK_HISTORY_POINTS)
      .optional(),
    /** True: older reads of the period can exist that `positionHistory` does not hold (a load or point limit). */
    positionHistoryCut: z.boolean().optional(),
  })
  .openapi("ProjectSeoKeyword");
export const seoCompetitorSchema = z
  .object({
    id: z.string(),
    url: seoUrlSchema,
    role: z.enum(["page", "competitor"]),
    confirmed: z.boolean(),
    source: z.string(),
    rank: z.number().nullable(),
    backlinks: z.number().nullable(),
    referringDomains: z.number().nullable(),
    observedAt: z.union([dateTimeSchema, z.null()]),
    observationId: z.union([seoIdSchema, z.null()]),
    version: z.number().int(),
    canConfirm: z.boolean(),
    exclusionReason: z.string().nullable(),
  })
  .openapi("ProjectSeoCompetitor");
/** The same read over the equal-length window just before the period. Absent when it failed or on older observations. */
export const seoPreviousPeriodSchema = z
  .object({
    from: seoDateSchema,
    to: seoDateSchema,
    value: z.number().finite().nullable(),
  })
  .strict()
  .openapi("ProjectSeoPreviousPeriod");
export const seoMetricSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
    unit: z.enum(["count", "ratio", "seconds", "position"]),
    source: z.string(),
    propertyId: z.string(),
    value: z.number().nullable(),
    from: seoDateSchema,
    to: seoDateSchema,
    timeZone: z.string(),
    channel: seoTrafficChannelSchema,
    observedAt: dateTimeSchema,
    selectedAt: dateTimeSchema.optional(),
    coverage: z.enum(["complete", "partial", "unavailable"]),
    points: z.array(
      z.object({ date: seoDateSchema, value: z.number().nullable() }),
    ),
    notes: z.array(z.string()),
    previous: seoPreviousPeriodSchema.optional(),
    /** The Search Console search type. Absent for Google Analytics. */
    searchType: seoSearchTypeSchema.optional(),
  })
  .openapi("ProjectSeoMetric");
export const SEO_KEYWORD_SERIES_ROW_LIMIT = 10_000;
export const SEO_KEYWORD_SERIES_MAX_KEYWORDS = 50;
/** A sync reads tracked keyword days for at most this many countries. */
export const SEO_KEYWORD_SERIES_MAX_COUNTRIES = 3;
/**
 * Daily Search Console rows for tracked keywords, grouped by normalized query
 * and date over every selected page, from searchers in each keyword's country. A day without rows has no point. A
 * requested keyword without rows has no points. Position is null at 0 impressions.
 */
export const seoKeywordSeriesSchema = z
  .object({
    rowLimit: z.number().int().positive().max(SEO_KEYWORD_SERIES_ROW_LIMIT),
    truncated: z.boolean(),
    keywords: z
      .array(
        z.object({
          keyword: z.string().min(1).max(2048),
          /** Searchers' country the read was filtered to. Absent on older observations, which read every country. */
          countryCode: z
            .string()
            .regex(/^[A-Z]{2}$/)
            .optional(),
          /** First day read, where the workspace added days of earlier syncs. Never stored. */
          from: seoDateSchema.optional(),
          points: z
            .array(
              z.object({
                date: seoDateSchema,
                clicks: z.number().finite().nonnegative(),
                impressions: z.number().finite().nonnegative(),
                position: z.number().finite().nullable(),
              }),
            )
            .max(SEO_STATS_MAX_DAYS),
        }),
      )
      .max(SEO_KEYWORD_SERIES_MAX_KEYWORDS),
  })
  .strict()
  .openapi("ProjectSeoKeywordSeries");
/** Google's index verdict for one page from Search Console URL Inspection. */
export const seoIndexedPageSchema = z
  .object({
    pageUrl: seoUrlSchema,
    verdict: z.enum([
      "PASS",
      "PARTIAL",
      "FAIL",
      "NEUTRAL",
      "VERDICT_UNSPECIFIED",
    ]),
    /** Google's own words, for example "Submitted and indexed". */
    coverageState: z.string().max(500).nullable(),
    robotsTxtState: z.string().max(100).nullable(),
    lastCrawlTime: z.string().datetime({ offset: true }).nullable(),
    googleCanonical: z.string().max(2048).nullable(),
    userCanonical: z.string().max(2048).nullable(),
    indexingState: z.string().max(100).nullable().optional(),
  })
  .strict()
  .openapi("ProjectSeoIndexedPage");
export const seoIndexStatusSchema = z
  .object({
    /** The newest verdict per selected page, each with the time its sync ran. */
    pages: z
      .array(seoIndexedPageSchema.extend({ checkedAt: dateTimeSchema }))
      .max(SEO_MAX_PAGES),
  })
  .openapi("ProjectSeoIndexStatus");
/** The SEO worker's private assessment, separate from the public audit artifact. */
export const seoIndexAssessmentSchema = z
  .object({
    pageUrl: seoUrlSchema,
    status: z.enum([
      "indexed",
      "issue",
      "review",
      "expected_exclusion",
      "unavailable",
    ]),
    report: z.boolean(),
    reason: z.string().min(1).max(2000),
    suggestedFix: z.string().min(1).max(2000).nullable(),
    evidence: z.array(z.string().max(2000)).max(20),
  })
  .strict()
  .refine((value) => value.report === (value.status === "issue"));
export const seoIndexTriageSchema = z
  .object({
    assessments: z
      .array(
        seoIndexAssessmentSchema
          .safeExtend({
            taskId: z.string(),
            checkedAt: dateTimeSchema,
            googleReturnedUnknown: z.literal(true).optional(),
            auditPageUrl: seoUrlSchema.optional(),
          })
          .openapi("ProjectSeoIndexAssessedPage"),
      )
      .max(SEO_MAX_INDEX_ASSESSMENTS),
  })
  .openapi("ProjectSeoIndexTriage");
export const seoSearchQueriesSchema = z
  .object({
    observationId: seoIdSchema,
    propertyId: z.string(),
    from: seoDateSchema,
    to: seoDateSchema,
    timeZone: z.string(),
    observedAt: dateTimeSchema,
    rowLimit: z.number().int().positive(),
    truncated: z.boolean(),
    rows: z.array(seoSearchQueryRowSchema.extend({ id: z.string() })),
    /** Daily positions of tracked keywords from the same observation, with older days of earlier syncs. Absent when not requested. */
    keywordSeries: seoKeywordSeriesSchema.optional(),
    /** The Search Console search type of these rows. Absent reads web search. */
    searchType: seoSearchTypeSchema.optional(),
  })
  .openapi("ProjectSeoSearchQueries");
export const projectSeoWorkspaceSchema = z
  .object({
    searchConsolePropertyId: z.string().nullable().optional(),
    sharing: z.enum(SEO_SHARING_SCOPES).optional(),
    projectId: seoIdSchema.nullable(),
    auditId: seoIdSchema.nullable(),
    auditName: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    scope: z.object({
      id: z.union([seoIdSchema, z.null()]),
      name: z.string(),
      version: z.number().int(),
      pageIds: z.array(seoIdSchema),
      from: seoDateSchema.nullable(),
      to: seoDateSchema.nullable(),
    }),
    pages: z.array(seoPageSchema),
    scopes: z.array(seoScopeSchema),
    observations: z.array(seoObservationSchema),
    history: z.object({
      /** The row cap of each load: the checks and page changes, and the syncs apart. */
      limit: z.number().int().positive(),
      /** One of the two loads reached its cap. */
      limited: z.boolean(),
      /** The checks and page changes load reached its cap: an older check can be cut. */
      evidenceLimited: z.boolean(),
    }),
    keywords: z.array(seoKeywordSchema),
    competitors: z.array(seoCompetitorSchema),
    findings: z.array(seoFindingSchema),
    actions: z.array(seoActionSchema),
    metricsStatus: z.enum([
      "not_connected",
      "available",
      "partial",
      "unavailable",
    ]),
    metrics: z.array(seoMetricSchema),
    searchQueries: z.union([seoSearchQueriesSchema, z.null()]),
    /** Totals by country and by device from the newest Search Console sync that has them, with or without query rows. */
    searchBreakdown: z
      .union([seoWorkspaceSearchBreakdownSchema, z.null()])
      .optional(),
    /** Owner-chosen brand terms that split Search Console queries. Absent before any was saved. */
    brandTerms: z.array(z.string()).optional(),
    ...workspaceLandingFields,
    /** Google's index verdict per page from the newest Search Console sync that inspected them. */
    indexStatus: z.union([seoIndexStatusSchema, z.null()]).optional(),
    /** Private indexing assessment for the current viewer's audit and selected pages. */
    indexTriage: z.union([seoIndexTriageSchema, z.null()]).optional(),
    ...workspaceSiteEvidenceFields,
    /** The newest site audit's strategy results in the period: verdict, keyword groups, actions off the site. */
    strategy: z.union([seoStrategySchema, z.null()]).optional(),
    ...workspaceSiteSpeedFields,
    landingEngagementChange: seoLandingEngagementChange.optional(),
    articleDates: z.array(seoArticleDates).optional(),
    topicLaunches: z.array(seoTopicLaunch).optional(),
    privateTopicQueries: z.array(seoPrivateTopicQuery).optional(),
    seasonalIdeas: z.array(seoWorkspaceSeasonalIdeaSchema).optional(),
    /** SERP features, featured snippet, People also ask and AI Overview per keyword and device over time. */
    serpHistory: z
      .array(seoSerpSeriesSchema)
      .max(SEO_SERP_SERIES_MAX)
      .optional(),
    /** The site's and the confirmed competitors' estimated share of clicks per week. Null without SERP reads. */
    shareOfVoice: z.union([seoShareOfVoiceSchema, z.null()]).optional(),
    timeline: z.array(seoTimelineSchema),
    /** Every check of the selected pages. The period does not cut this list. */
    runs: z.array(seoRunSchema).optional(),
    analyses: z.array(seoJobSchema),
    auditSearchConsole: z.array(seoAuditPerformanceSchema).optional(),
    auditSearchConsoleRetryTaskIds: z.array(z.string()).optional(),
    monitors: z.array(seoMonitorSchema),
    availableActions: z.object({
      canEdit: z.boolean(),
      canRequestAnalysis: z.boolean(),
      canUsePaidSearchData: z.boolean().optional(),
      canCreateMonitor: z.boolean().optional(),
      /** The crawl a crawl continuation would go on from, as its `continues`: null when none can start. */
      continueCrawlFrom: seoSnapshotIdSchema.nullable().optional(),
      canSyncMetrics: z.boolean(),
    }),
  })
  .openapi("ProjectSeoWorkspace");

export type ProjectSeoWorkspace = z.infer<typeof projectSeoWorkspaceSchema>;
export type SeoOwner =
  | { kind: "project"; id: string }
  | { kind: "audit"; id: string };
export type SeoActor = {
  owner: SeoOwner;
  workspaceId: string;
  userId: string;
  organizationId: string | null;
  sokoBotId?: string;
  privateMetricsAllowed?: boolean;
};
export type SeoIndexedPage = z.infer<typeof seoIndexedPageSchema>;
export type SeoWorkspaceQuery = z.infer<typeof seoWorkspaceQuerySchema>;
export type RequestSeoAnalysis = z.infer<typeof requestSeoAnalysisSchema>;
