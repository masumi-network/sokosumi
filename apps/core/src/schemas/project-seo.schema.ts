import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";
import { SEO_SHARING_SCOPES } from "@/lib/seo/data-visibility";
import { SEO_STATS_MAX_DAYS } from "@/lib/seo/native-statistics";
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
} from "./project-seo-rankings.schema";
import { seoStrategySchema } from "./project-seo-strategy.schema";

export const SEO_MAX_PAGES = 10;
export const SEO_MAX_KEYWORDS = 20;
export const SEO_MAX_COMPETITORS = 10;
export const SEO_MAX_PROVIDER_CALLS = 100;
export { SEO_MAX_MONITOR_RUNS } from "./project-seo-monitor.schema";
export const SEO_PAGE_CHANGE_CLOCK_SKEW_MS = 5 * 60_000;
const SEO_SERP_LANGUAGES = new Set(
  "af ak am ar az be bg bn bs ca cs cy da de ee el en es et eu fa fi fo fr fy ga gl gu ha he hi hr ht hu hy id ig is it iw ja ka kg kk km kn ko ky lg ln lo lt lv mg mi mk ml mn mr ms mt my ne nl no ny om pa pl ps pt qu rm rn ro ru rw sd si sk sl sn so sq sr st sv sw ta te tg th ti tk tl tn to tr uk ur uz vi wo xh yo zu".split(
    " ",
  ),
);
export const seoIdSchema = z.string().uuid();
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
export const seoUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .refine((value) => {
    // A value that is no address already failed the check above; `new URL` would throw on it.
    if (!URL.canParse(value)) return true;
    const url = new URL(value);
    return !url.username && !url.password;
  }, "Page URLs cannot contain credentials");
export const seoDeviceSchema = z.enum(["mobile", "desktop"]);
export const seoAnalysisKindSchema = z.enum([
  "page_check",
  "rankings",
  "links",
  "audit_lite",
  "audit_full",
]);
export const seoSeveritySchema = z.enum([
  "critical",
  "major",
  "minor",
  "note",
  "test",
  "measure",
]);
export const seoAnalysisModuleSchema = z.enum([
  "page.inspect",
  "keyword.refresh",
  "links.refresh",
]);

export const seoPageSchema = z
  .object({
    id: seoIdSchema,
    url: seoUrlSchema,
    label: z.string(),
    relationship: z.enum(["primary", "related"]),
    relatedToPageId: z.union([seoIdSchema, z.null()]),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectSeoPage");
export const seoScopeSchema = z
  .object({
    id: seoIdSchema,
    name: z.string(),
    pageIds: z.array(seoIdSchema),
    version: z.number().int().positive(),
  })
  .openapi("ProjectSeoScope");
export const seoWorkspaceQuerySchema = z
  .object({
    scopeId: seoIdSchema.optional(),
    pageId: seoIdSchema.optional(),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES).optional(),
    from: seoDateSchema.optional(),
    to: seoDateSchema.optional(),
    channel: z.enum(["all", "organic"]).optional(),
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
export const addSeoPageSchema = z
  .object({
    url: seoUrlSchema,
    label: z.string().trim().max(200).optional(),
    relationship: z.enum(["primary", "related"]).default("primary"),
    relatedToPageId: seoIdSchema.optional(),
  })
  .strict()
  .openapi("AddProjectSeoPageRequest");
export const createSeoScopeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    pageIds: z.array(seoIdSchema).min(1).max(SEO_MAX_PAGES),
  })
  .strict()
  .openapi("CreateProjectSeoScopeRequest");
export const updateSeoScopeSchema = createSeoScopeSchema
  .extend({ expectedVersion: z.number().int().positive() })
  .openapi("UpdateProjectSeoScopeRequest");
export const importSeoAuditSchema = z
  .object({
    taskId: z.string().min(1).max(128),
    fileId: z.string().min(1).max(128),
  })
  .strict()
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
    fullAuditLimits: z
      .object({
        usd: z.number().min(0.3).max(50),
        seconds: z.number().int().min(60).max(3600),
      })
      .strict()
      .optional(),
    idempotencyKey: z.string().trim().min(8).max(128),
    coworkerId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    (input) => !(input.scopeId && input.pageIds),
    "Choose a saved scope or explicit pages",
  )
  .refine(
    (input) => !input.scopeId || input.expectedScopeVersion !== undefined,
    "Reload the page group before requesting an analysis",
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
    sourceRef: z.string(),
    observedAt: dateTimeSchema,
  })
  .openapi("ProjectSeoFinding");
/** The SEO bot's estimate of how likely a searcher takes the page's action. It is not a measured rate. */
export const seoConversionSchema = z.enum(["high", "medium", "low"]);
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
    conversion: seoConversionSchema.nullable(),
    /** The product feature the keyword is about, in the words of the check. */
    feature: z.string().nullable(),
    device: z.union([seoDeviceSchema, z.null()]),
    position: z.number().nullable(),
    positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
    checkedResults: z.number().int().nullable(),
    observedAt: z.union([dateTimeSchema, z.null()]),
    observationId: z.union([seoIdSchema, z.null()]),
    priority: z.enum(["low", "medium", "high"]),
    version: z.number().int(),
    /** Every loaded paid read of this keyword, page and device, newest last. GSC average positions are separate. */
    positionHistory: z
      .array(seoPositionPointSchema)
      .max(SEO_RANK_HISTORY_POINTS)
      .optional(),
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
export const seoActionSchema = z
  .object({
    id: z.string(),
    observationId: seoIdSchema,
    pageUrl: seoUrlSchema,
    findingIds: z.array(z.string()),
    title: z.string(),
    why: z.string(),
    effort: z.enum(["low", "medium", "high"]),
    expectedEffect: z.string(),
    edit: z.union([
      z.object({
        target: z.string(),
        before: z.string().nullable(),
        after: z.string(),
      }),
      z.null(),
    ]),
    taskId: z.string().nullable(),
    status: z.enum(["recommended", "task_created", "implemented", "verified"]),
    /** A fix comes from a confirmed check. An opportunity is a named heuristic over measured search data. */
    kind: z.enum(["fix", "opportunity"]),
    evidence: z.array(z.string()),
  })
  .openapi("ProjectSeoAction");
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
    channel: z.enum(["all", "organic"]),
    observedAt: dateTimeSchema,
    coverage: z.enum(["complete", "partial", "unavailable"]),
    points: z.array(
      z.object({ date: seoDateSchema, value: z.number().nullable() }),
    ),
    notes: z.array(z.string()),
    previous: seoPreviousPeriodSchema.optional(),
  })
  .openapi("ProjectSeoMetric");
export const SEO_SEARCH_QUERY_ROW_LIMIT = 250;
/** One Search Console row grouped by query and page. Average position is not a live rank. */
export const seoSearchQueryRowSchema = z.object({
  query: z.string().min(1).max(2048),
  pageUrl: seoUrlSchema,
  clicks: z.number().finite().nonnegative(),
  impressions: z.number().finite().nonnegative(),
  ctr: z.number().finite().min(0).max(1),
  averagePosition: z.number().finite().min(1),
});
export const SEO_KEYWORD_SERIES_ROW_LIMIT = 10_000;
export const SEO_KEYWORD_SERIES_MAX_KEYWORDS = 25;
/** One daily read per country; a sync reads at most this many. */
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
export const SEO_BREAKDOWN_ROW_LIMIT = 250;
/**
 * Search Console totals for the same pages and period, grouped by one
 * dimension. A country key is ISO alpha-2, or Google's alpha-3 code when it
 * has no alpha-2 twin. A device key is desktop, mobile or tablet.
 */
export const seoSearchBreakdownSchema = z
  .object({
    rowLimit: z.number().int().positive().max(SEO_BREAKDOWN_ROW_LIMIT),
    truncated: z.boolean(),
    rows: z
      .array(
        z
          .object({
            key: z.string().regex(/^(?:[A-Z]{2,3}|desktop|mobile|tablet)$/),
            clicks: z.number().finite().nonnegative(),
            impressions: z.number().finite().nonnegative(),
            ctr: z.number().finite().min(0).max(1),
            averagePosition: z.number().finite().min(1),
          })
          .strict(),
      )
      .max(SEO_BREAKDOWN_ROW_LIMIT),
  })
  .strict()
  .openapi("ProjectSeoSearchBreakdown");
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
    /** Daily positions of tracked keywords from the same observation. Absent when not requested. */
    keywordSeries: seoKeywordSeriesSchema.optional(),
    /** Totals by country and by device from the same observation. Absent when the read failed or on older observations. */
    countries: seoSearchBreakdownSchema.optional(),
    devices: seoSearchBreakdownSchema.optional(),
  })
  .openapi("ProjectSeoSearchQueries");
export const seoTimelineSchema = z
  .object({
    id: z.string(),
    kind: z.enum([
      "audit",
      "check",
      "metrics",
      "action",
      "scope",
      "page_change",
    ]),
    title: z.string(),
    at: dateTimeSchema,
    pageIds: z.array(seoIdSchema),
    observationId: z.union([seoIdSchema, z.null()]),
    taskId: z.string().nullable(),
    status: z.string(),
    detail: z.string(),
  })
  .openapi("ProjectSeoTimelineItem");
export const seoModuleCoverageSchema = z.object({
  notRequested: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  notRequestedNames: z.array(z.string().max(20_000)).optional(),
  failedNames: z.array(z.string().max(20_000)).optional(),
});
export const seoObservationSchema = z
  .object({
    id: seoIdSchema,
    kind: z.string(),
    source: z.string(),
    observedAt: dateTimeSchema,
    pageIds: z.array(seoIdSchema),
    scopeVersion: z.number().int(),
    sourceTaskId: z.string().nullable(),
    countryCode: z.string().nullable(),
    languageCode: z.string().nullable(),
    devices: z.array(seoDeviceSchema),
    rulebookVersion: z.string(),
    artifactHash: z.string(),
    /** Critical, major and minor findings this run saved for the selected pages. */
    issues: z.number().int().nonnegative(),
    coverage: z.object({
      checked: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
      modules: seoModuleCoverageSchema.optional(),
    }),
  })
  .openapi("ProjectSeoObservation");
export const seoRunSchema = z
  .object({
    observationId: seoIdSchema,
    kind: z.string(),
    observedAt: dateTimeSchema,
    /** Critical, major and minor findings on the selected pages. Null where the run read only some of them. */
    issues: z.union([z.number().int().nonnegative(), z.null()]),
    /** Seconds from the request to the saved result. Null where no request of this workspace started the run. */
    seconds: z.union([z.number().int().nonnegative(), z.null()]),
    /** The SEO monitor whose scheduled Run made this result. Null for a one-off check. */
    monitorId: z.union([seoIdSchema, z.null()]).optional(),
  })
  .openapi("ProjectSeoRun");
export const seoJobSchema = z
  .object({
    id: seoIdSchema,
    kind: seoAnalysisKindSchema,
    status: z.enum(["requested", "running", "completed", "failed"]),
    taskId: z.string().nullable(),
    pageIds: z.array(seoIdSchema),
    scopeVersion: z.number().int(),
    createdAt: dateTimeSchema,
  })
  .openapi("ProjectSeoAnalysis");
export const projectSeoWorkspaceSchema = z
  .object({
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
      limit: z.number().int().positive(),
      limited: z.boolean(),
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
    /** Google's index verdict per page from the newest Search Console sync that inspected them. */
    indexStatus: z.union([seoIndexStatusSchema, z.null()]).optional(),
    /** The newest site audit's strategy results in the period: verdict, keyword groups, actions off the site. */
    strategy: z.union([seoStrategySchema, z.null()]).optional(),
    /** SERP features, featured snippet, People also ask and AI Overview per keyword and device over time. */
    serpHistory: z
      .array(seoSerpSeriesSchema)
      .max(SEO_SERP_SERIES_MAX)
      .optional(),
    timeline: z.array(seoTimelineSchema),
    /** Every check of the selected pages. The period does not cut this list. */
    runs: z.array(seoRunSchema).optional(),
    analyses: z.array(seoJobSchema),
    monitors: z.array(seoMonitorSchema),
    availableActions: z.object({
      canEdit: z.boolean(),
      canRequestAnalysis: z.boolean(),
      canUsePaidSearchData: z.boolean().optional(),
      canCreateMonitor: z.boolean().optional(),
      canSyncMetrics: z.boolean(),
    }),
  })
  .openapi("ProjectSeoWorkspace");

/** Native metrics are owner-only, never part of a public Coworker result. */
export const nativeSeoMetricsSchema = z
  .object({
    provider: z.enum(["ga4", "search_console"]),
    propertyId: z.string().min(1).max(500),
    pageUrls: z.array(seoUrlSchema).min(1).max(SEO_MAX_PAGES),
    channel: z.enum(["all", "organic"]),
    from: seoDateSchema,
    to: seoDateSchema,
    timeZone: z.string().min(1).max(100),
    observedAt: dateTimeSchema,
    coverage: z.enum(["complete", "partial", "unavailable"]),
    notes: z.array(z.string().max(2000)).max(50),
    metrics: z
      .array(
        z.object({
          key: z.string().min(1).max(100),
          label: z.string().min(1).max(200),
          unit: z.enum(["count", "ratio", "seconds", "position"]),
          value: z.number().finite().nullable(),
          points: z
            .array(
              z.object({
                date: seoDateSchema,
                value: z.number().finite().nullable(),
              }),
            )
            .max(400),
          previous: seoPreviousPeriodSchema.optional(),
        }),
      )
      .max(20),
    /** Search Console query/page rows for the same pages and period. Absent on older observations. */
    queries: z
      .object({
        rowLimit: z.number().int().positive().max(SEO_SEARCH_QUERY_ROW_LIMIT),
        truncated: z.boolean(),
        rows: z.array(seoSearchQueryRowSchema).max(SEO_SEARCH_QUERY_ROW_LIMIT),
      })
      .strict()
      .optional(),
    /** Daily positions of tracked keywords for the same pages and period. Absent when none were requested. */
    keywordSeries: seoKeywordSeriesSchema.optional(),
    /** Search Console totals by country and by device. Absent when the read failed. */
    countries: seoSearchBreakdownSchema.optional(),
    devices: seoSearchBreakdownSchema.optional(),
    /** URL Inspection results for the selected pages Google answered for. Absent when none answered. */
    indexedPages: z.array(seoIndexedPageSchema).max(SEO_MAX_PAGES).optional(),
  })
  .strict()
  .refine((input) => input.from <= input.to, "Period ends before it starts")
  .openapi("NativeSeoMetrics");

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
export type NativeSeoMetrics = z.infer<typeof nativeSeoMetricsSchema>;
export type SeoSearchBreakdown = z.infer<typeof seoSearchBreakdownSchema>;
export type SeoIndexedPage = z.infer<typeof seoIndexedPageSchema>;
export type SeoWorkspaceQuery = z.infer<typeof seoWorkspaceQuerySchema>;
export type RequestSeoAnalysis = z.infer<typeof requestSeoAnalysisSchema>;
