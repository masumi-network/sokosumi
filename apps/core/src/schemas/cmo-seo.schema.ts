import { z } from "@hono/zod-openapi";

const at = z.string().datetime();

/** One number behind a suggestion, with where and when it was measured. */
export const cmoSeoEvidenceSchema = z
  .object({
    metric: z.enum([
      "searchVolume",
      "difficulty",
      "intent",
      "position",
      "clicks",
      "impressions",
      "ctr",
      "auditIssue",
    ]),
    keyword: z.string().nullable(),
    pageUrl: z.string().nullable(),
    value: z.string(),
    source: z.enum(["keyword_research", "search_console", "weekly_audit"]),
    observedAt: at,
  })
  .openapi("CmoSeoEvidence");
export type CmoSeoEvidence = z.infer<typeof cmoSeoEvidenceSchema>;

export const cmoSeoSuggestionSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["article", "page_change", "landing_page"]),
    source: z.enum(["audit", "cuso"]),
    title: z.string(),
    keyword: z.string().nullable(),
    pageUrl: z.string().nullable(),
    why: z.string(),
    body: z.string(),
    newText: z.string().nullable(),
    draft: z.string().nullable(),
    /** A landing page: what it says about the competitor, each with the competitor's own words. */
    sources: z.array(
      z.object({ text: z.string(), sourceUrl: z.string(), quote: z.string() }),
    ),
    evidence: z.array(cmoSeoEvidenceSchema),
    status: z.enum(["open", "done", "verified", "dismissed"]),
    createdAt: at,
    doneAt: at.nullable(),
    verifiedAt: at.nullable(),
  })
  .openapi("CmoSeoSuggestion");
export type CmoSeoSuggestion = z.infer<typeof cmoSeoSuggestionSchema>;

export const cmoKeywordIdeaSchema = z
  .object({
    keyword: z.string(),
    searchVolume: z.number().nullable(),
    difficulty: z.number().nullable(),
    intent: z
      .enum(["informational", "navigational", "commercial", "transactional"])
      .nullable(),
    /** Where the site ranks for it today: Search Console's average, else the latest audit's read. */
    position: z.number().nullable(),
    positionSource: z.enum(["search_console", "weekly_audit"]).nullable(),
  })
  .openapi("CmoKeywordIdea");
export type CmoKeywordIdea = z.infer<typeof cmoKeywordIdeaSchema>;

export const cmoKeywordSearchSchema = z
  .object({
    topic: z.string(),
    countryCode: z.string(),
    languageCode: z.string(),
    observedAt: at,
    ideas: z.array(cmoKeywordIdeaSchema),
  })
  .openapi("CmoKeywordSearch");
export type CmoKeywordSearch = z.infer<typeof cmoKeywordSearchSchema>;

const searchRowSchema = z.object({
  query: z.string(),
  pageUrl: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
});

export const cmoSearchConsoleSchema = z
  .object({
    status: z.enum([
      "connected",
      "not_connected",
      "no_property",
      "unavailable",
    ]),
    property: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    observedAt: at.nullable(),
    totals: z
      .object({
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number().nullable(),
        position: z.number().nullable(),
      })
      .nullable(),
    /** Searches ranked 8 to 20: a better page can reach the first page. */
    nearFirstPage: z.array(searchRowSchema),
    /** Searches seen often near the top but rarely clicked. */
    lowClickRate: z.array(searchRowSchema),
  })
  .openapi("CmoSearchConsole");
export type CmoSearchConsole = z.infer<typeof cmoSearchConsoleSchema>;

export const cmoSeoAuditSchema = z
  .object({
    creditsPerAudit: z.number().int(),
    /** active: runs every week; paused: not paid for; unavailable: the audit service is off here. */
    status: z.enum(["active", "paused", "not_started", "unavailable"]),
    nextRunAt: at.nullable(),
    running: z.boolean(),
    /** Weeks left out because the credits could not cover the audit, newest first. */
    skipped: z.array(at),
    latest: z
      .object({
        observedAt: at,
        checked: z.number().int(),
        passed: z.number().int(),
        issues: z.array(
          z.object({
            title: z.string(),
            pageUrl: z.string(),
            severity: z.enum(["critical", "major", "minor"]),
            detail: z.string().nullable(),
          }),
        ),
        fixes: z.array(
          z.object({
            title: z.string(),
            why: z.string(),
            effort: z.string(),
            pageUrl: z.string(),
          }),
        ),
      })
      .nullable(),
    lastFailedAt: at.nullable(),
  })
  .openapi("CmoSeoAudit");
export type CmoSeoAudit = z.infer<typeof cmoSeoAuditSchema>;

export const cmoSeoSchema = z
  .object({
    websiteUrl: z.string(),
    countryCode: z.string(),
    languageCode: z.string(),
    audit: cmoSeoAuditSchema,
    searchConsole: cmoSearchConsoleSchema,
    articles: z.array(cmoSeoSuggestionSchema),
    pageChanges: z.array(cmoSeoSuggestionSchema),
    /** Pages for searches that name a competitor, for the owner to publish. */
    landingPages: z.array(cmoSeoSuggestionSchema),
    keywordSearches: z.array(cmoKeywordSearchSchema),
    /** Keyword searches left today. */
    keywordSearchesLeft: z.number().int(),
  })
  .openapi("CmoSeo");
export type CmoSeo = z.infer<typeof cmoSeoSchema>;

export const cmoKeywordSearchRequestSchema = z
  .object({ topic: z.string().trim().min(2).max(80) })
  .strict()
  .openapi("CmoKeywordSearchRequest");

export const cmoSeoSuggestionParamsSchema = z.object({
  projectId: z.string().uuid(),
  id: z.string().uuid(),
});

export const cmoSeoSuggestionStatusRequestSchema = z
  .object({ status: z.enum(["open", "done", "dismissed"]) })
  .strict()
  .openapi("CmoSeoSuggestionStatusRequest");

export const cmoLandingPageLiveRequestSchema = z
  .object({ url: z.string().trim().url().max(500) })
  .strict()
  .openapi("CmoLandingPageLiveRequest");

export const cmoLandingPageLiveSchema = z
  .object({
    page: cmoSeoSuggestionSchema,
    /** Search ads on this search that now send people to the page. */
    adsUpdated: z.number().int(),
    /** Launched search ads on this search, which keep their address. */
    adsLaunched: z.number().int(),
  })
  .openapi("CmoLandingPageLive");
