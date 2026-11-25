import { z } from "@hono/zod-openapi";
import { badRequest } from "@/helpers/error";
import {
  seoConversionSchema,
  seoDeviceSchema,
  seoEditorialKeywordSchema,
  seoIdeaRankSchema,
  seoModuleCoverageSchema,
  seoSeveritySchema,
  seoUrlSchema,
} from "@/schemas/project-seo.schema";
import {
  OPEN_STRATEGY,
  publicDecisionSourceSchema,
  publicPageSnapshotSchema,
  storedSeoDecisionsSchema,
} from "@/schemas/project-seo-action.schema";
import { seoSeasonalIdeaSchema } from "@/schemas/project-seo-seasonal.schema";
import { seoStrategyPayloadSchema } from "@/schemas/project-seo-strategy.schema";
import {
  seoPageMarketEvidence,
  seoResearchCoverage,
  storedSeoChecklist,
} from "@/schemas/seo-audit-coverage.schema";
import { seoPageSpeed } from "@/schemas/seo-page-speed.schema";
import { storedSiteSpeed } from "@/schemas/seo-site-speed.schema";
import * as seoDecisions from "./project-seo-decisions";
import { legacySeoReportSchema } from "./project-seo-legacy-report";
import { assertValidPartialSeoActions } from "./project-seo-partial-actions";
import {
  finiteReportNumber as numberAt,
  reportObject as object,
  omitUndefinedProperties,
  refusePrivateReport,
  skippedPages,
} from "./project-seo-public-report";
import {
  difficulty,
  FEATURE_CHARS,
  legacyReportKeywords,
} from "./project-seo-report-keywords";
import { seoReportPageScope } from "./project-seo-report-scope";
import {
  focusedSerpFields,
  seoAlertRowsSchema,
  seoSerpReadsSchema,
} from "./project-seo-report-serps";
import { readSeasonalInsight } from "./project-seo-seasonal";
import {
  auditedSeoPageKey,
  publicSiteFindings,
} from "./project-seo-site-findings";
import { publicSeoStrategy } from "./project-seo-strategy";
import { focusedRuleCoverage, readChecklist } from "./seo-checklist-breakdown";
import {
  articleDates,
  boundTopicLaunches,
  publicSiteArticles,
  seoArticleDates,
  seoTopicLaunch,
} from "./seo-content-history";
import { readPageMarketEvidence } from "./seo-page-market-evidence";
import { readableStoredPageSpeed, readPageSpeed } from "./seo-page-speed";
import { publicSitemapList, workerSitemaps } from "./seo-public-sitemaps";
import {
  readReviewSources,
  seoReviewSource,
} from "./seo-recommendation-evidence";
import {
  pageResearchCoverage,
  siteResearchCoverage,
} from "./seo-research-coverage";
import { readableStoredSiteSpeed, readSiteSpeed } from "./seo-site-speed";

const text = z.string().max(20_000);
const nullableNumber = z.number().finite().nullable();
const observedAt = z.string().datetime();
const source = z.object({ sourceRef: text, observedAt });
const finding = source.extend({
  id: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  rowId: text,
  title: text,
  severity: seoSeveritySchema,
  evidence: z.array(text).max(100),
});
const keyword = source.extend({
  keyword: text,
  pageUrl: seoUrlSchema,
  device: seoDeviceSchema.nullable(),
  position: nullableNumber,
  positionStatus: z.enum(["ranked", "not_in_range", "unavailable"]),
  checkedResults: z.number().int().nullable(),
  volume: nullableNumber.optional(),
  difficulty,
  intent: text.nullable().optional(),
  editorial: seoEditorialKeywordSchema.optional(),
  ideaRank: seoIdeaRankSchema,
  conversion: seoConversionSchema.nullable().optional(),
  feature: z.string().max(FEATURE_CHARS).nullable().optional(),
  source: text.optional(),
});
const competitor = source.extend({
  pageUrl: seoUrlSchema,
  scopePageUrls: z.array(seoUrlSchema).max(10).optional(),
  role: z.enum(["page", "competitor"]),
  backlinks: nullableNumber,
  referringDomains: nullableNumber,
  rank: nullableNumber.optional(),
  source: text.optional(),
});
const action = z.object({
  id: text,
  pageUrl: seoUrlSchema,
  findingIds: z.array(text),
  title: text,
  why: text,
  effort: z.enum(["low", "medium", "high"]),
  expectedEffect: text,
  edit: z
    .object({ target: text, before: text.nullable(), after: text })
    .nullable(),
});
const publicSeoPayload = z.object({
  version: z.literal(1),
  kind: z.string().max(100),
  requestId: z.string().uuid().nullable(),
  pageUrls: z.array(seoUrlSchema).min(1).max(10),
  observedAt,
  countryCode: z.string().max(10),
  languageCode: z.string().max(20),
  rulebookVersion: text,
  researchCoverage: z.array(seoResearchCoverage).max(11).optional(),
  pageMarketEvidence: seoPageMarketEvidence.optional(),
  publicSitemaps: publicSitemapList.optional().catch(undefined),
  pageSpeed: z.preprocess(readableStoredPageSpeed, seoPageSpeed.optional()),
  /** A site audit's speed table. A stored row Core cannot read is dropped and counted; an unreadable table goes, not the audit. */
  siteSpeed: z.preprocess(
    readableStoredSiteSpeed,
    storedSiteSpeed.optional().catch(undefined),
  ),
  checks: storedSeoChecklist,
  keywords: z.array(keyword).max(5000),
  competitors: z.array(competitor).max(1000),
  findings: z.array(finding).max(5000),
  actions: z.array(action).max(100),
  coverage: z.object({
    checked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    modules: seoModuleCoverageSchema.optional(),
  }),
  notes: z.array(text).max(500),
  /** A site audit's strategy results. Older rows and focused checks have none. */
  strategy: seoStrategyPayloadSchema.optional(),
  strategyDecisions: storedSeoDecisionsSchema.optional(),
  plan: z.json().optional(), // readAuditPlan writes it, scopedAuditPlan reads it
  articleDates: z.array(seoArticleDates).max(10).optional(),
  topicLaunches: z.array(seoTopicLaunch).max(10).optional(),
  reviewSources: z.array(seoReviewSource).max(10).optional(),
  seasonalIdeas: z.array(seoSeasonalIdeaSchema).max(100).optional(),
  decisionSources: z
    .array(publicDecisionSourceSchema)
    .max(10)
    .optional()
    .catch(undefined),
  /** A focused result's SERP reads per keyword and device. Older results and audits have none. */
  serps: seoSerpReadsSchema.optional(),
  /** Monitor rule ids that fired in a focused result's Run. */
  alertRows: seoAlertRowsSchema.optional(),
});
export const publicSeoPayloadSchema = publicSeoPayload.transform(
  omitUndefinedProperties,
);
export type PublicSeoPayload = z.infer<typeof publicSeoPayloadSchema>;

const frozenRequest = z.object({
  pageUrls: z.array(seoUrlSchema).min(1),
  autoPages: z.number().int().min(1).optional(),
  countryCode: text,
  languageCode: text,
  keywords: z.array(text).optional(),
  devices: z.array(seoDeviceSchema).optional(),
  competitorUrls: z.array(seoUrlSchema).optional(),
});
const sameSet = (a: string[], b: string[]) =>
  a.length === new Set(a).size &&
  a.length === b.length &&
  a.every((value) => b.includes(value));

const SKIPPED_REASON_CHARS = 300;

/** Bind evidence to the durable request, including Market, devices and approved external targets. */
export function assertSeoArtifactMatchesRequest(
  raw: unknown,
  payload: PublicSeoPayload,
  expected: { id: string; kind: string; request: unknown },
): void {
  const parsed = frozenRequest.safeParse(expected.request);
  if (!parsed.success)
    throw badRequest("The frozen SEO request is not readable");
  const request = parsed.data;
  if (
    payload.kind !== expected.kind ||
    payload.countryCode !== request.countryCode ||
    payload.languageCode !== request.languageCode
  )
    throw badRequest(
      "The report does not match its frozen page scope or Market",
    );
  const { scope: pageUrls, reported } = seoReportPageScope(
    raw,
    payload.pageUrls,
    request,
    expected.kind === "audit_full",
  );
  if (
    payload.checks.some(
      (row) => !pageUrls.includes(auditedSeoPageKey(row.pageUrl)),
    ) ||
    payload.findings.some(
      (row) => !pageUrls.includes(auditedSeoPageKey(row.pageUrl)),
    ) ||
    payload.strategyDecisions?.some(
      (row) => !reported.includes(auditedSeoPageKey(row.targetUrl)),
    ) ||
    payload.actions.some(
      (row) => !pageUrls.includes(auditedSeoPageKey(row.pageUrl)),
    ) ||
    payload.keywords.some(
      (row) => !pageUrls.includes(auditedSeoPageKey(row.pageUrl)),
    )
  )
    throw badRequest(
      "The report contains evidence outside its frozen page scope",
    );
  if (expected.kind === "audit_full") return;
  const result = partial.safeParse(raw);
  if (
    !result.success ||
    payload.requestId !== expected.id ||
    !sameSet(result.data.scope.keywords, request.keywords ?? []) ||
    !sameSet(result.data.scope.devices, request.devices ?? [])
  )
    throw badRequest(
      "The result does not match its frozen keywords or devices",
    );
  if (
    payload.keywords.some(
      (row) =>
        !request.keywords?.includes(row.keyword) ||
        (row.device && !request.devices?.includes(row.device)),
    ) ||
    payload.serps?.some(
      (row) =>
        !request.keywords?.includes(row.keyword) ||
        !request.devices?.includes(row.device),
    ) ||
    payload.checks.some((row) => !request.devices?.includes(row.device)) ||
    payload.findings.some(
      (row) => row.device && !request.devices?.includes(row.device),
    )
  )
    throw badRequest("The result contains unrequested keywords or devices");
  const competitors = request.competitorUrls?.map(auditedSeoPageKey) ?? [];
  if (
    payload.competitors.some(
      (row) =>
        !(row.role === "page" ? pageUrls : competitors).includes(
          auditedSeoPageKey(row.pageUrl),
        ),
    )
  )
    throw badRequest("The result contains an unapproved link target");
}

const partial = z
  .object({
    schema: z.literal("sokosumi.seo-result/1"),
    requestId: z.string().uuid(),
    kind: z.enum(["page_check", "rankings", "links", "audit_lite"]),
    scope: z.object({
      pageUrls: z.array(seoUrlSchema).min(1).max(10),
      keywords: z.array(text).max(50),
      countryCode: text,
      languageCode: text,
      devices: z.array(seoDeviceSchema),
    }),
    observedAt,
    rulebookVersion: text,
    checks: z
      .array(
        z
          .object({
            rowId: text,
            pageUrl: seoUrlSchema,
            device: seoDeviceSchema,
            result: z.enum(["pass", "fired", "blocked", "not_checked"]),
          })
          .passthrough(),
      )
      .max(10000),
    // A focused result carries no estimate: only a page Report does. One sent all the same is not read.
    keywords: z
      .array(
        keyword.omit({
          conversion: true,
          feature: true,
          editorial: true,
          ideaRank: true,
        }),
      )
      .max(5000),
    competitors: z.array(competitor).max(1000),
    findings: z.array(finding).max(5000),
    actions: z.array(action).max(100),
    coverage: z.object({
      requested: z.array(text),
      completed: z.array(text),
      failed: z.array(text),
      skipped: z.array(text),
    }),
    gaps: z.array(z.object({ reason: text }).passthrough()).max(500),
  })
  .passthrough();
/** Parse trusted artifact bytes, keeping an explicit projection rather than arbitrary report fields. */
export function parsePublicSeoArtifact(raw: unknown): PublicSeoPayload {
  refusePrivateReport(raw);
  if (object(raw)?.kind === "site") {
    const site = z
      .object({
        pages: z.array(z.unknown()).min(1).max(10),
        rulebookVersion: text,
      })
      .safeParse(raw);
    if (!site.success)
      throw badRequest("The site report does not match its supported format");
    const pages = site.data.pages.map(parsePublicSeoArtifact),
      {
        strategy: _firstPageStrategy,
        pageMarketEvidence: _standaloneMarkets,
        ...first
      } = pages[0],
      pageUrls = pages.flatMap((page) => page.pageUrls),
      { strategy, note } = publicSeoStrategy(raw, pageUrls),
      siteFindings = publicSiteFindings(raw, pageUrls, first.observedAt);
    const eligible = pages.flatMap((page, i) => {
      if (
        page.kind !== "audit_full" ||
        page.countryCode !== first.countryCode ||
        page.languageCode !== first.languageCode
      )
        return [];
      const child = object(site.data.pages[i]);
      const sourceUrl = child?.kind !== "site" && object(child?.request)?.url;
      return page.pageUrls.map((url) => ({
        url,
        snapshotId: url === sourceUrl ? child?.snapshotId : undefined,
      }));
    });
    const articles = publicSiteArticles(raw, pages);
    const sources = seoDecisions.bindMarketSource(
      object(raw),
      eligible.flatMap((item) => {
        const result = publicPageSnapshotSchema.safeParse(item);
        return result.success ? [result.data] : [];
      }),
    );
    const ranks = pages.flatMap((p) => p.reviewSources ?? []);
    const pageSpeed = pages.flatMap((page) => page.pageSpeed ?? []);
    const decisions = seoDecisions.readWorkerDecisions(
      raw,
      eligible.map((page) => page.url),
      sources,
      ranks,
    );
    return publicSeoPayloadSchema.parse({
      ...first,
      kind: "audit_full",
      pageUrls,
      pageSpeed,
      siteSpeed: readSiteSpeed(raw, pageUrls, pageSpeed),
      strategyDecisions: decisions,
      decisionSources: decisions?.some((d) => d.kind === OPEN_STRATEGY)
        ? sources
        : undefined,
      articleDates: articles.length ? articles : undefined,
      topicLaunches: boundTopicLaunches(
        raw,
        articles,
        Math.max(...pages.map((p) => Date.parse(p.observedAt))),
      ),
      reviewSources: ranks,
      researchCoverage: siteResearchCoverage(
        raw,
        first.pageUrls[0]!,
        pages.flatMap((p) => p.researchCoverage ?? []),
      ),
      checks: pages.flatMap((page) => page.checks),
      keywords: pages.flatMap((page) => page.keywords),
      competitors: pages.flatMap((page) => page.competitors),
      ...(pages.some((page) => page.seasonalIdeas) && {
        seasonalIdeas: pages
          .filter(
            (page) =>
              page.countryCode === first.countryCode &&
              page.languageCode === first.languageCode,
          )
          .flatMap((page) => page.seasonalIdeas ?? []),
      }),
      findings: [
        ...pages.flatMap((page, index) =>
          page.findings.map((row) => ({ ...row, id: `${index}:${row.id}` })),
        ),
        ...siteFindings.findings,
      ],
      actions: pages.flatMap((page, index) =>
        page.actions.map((row) => ({
          ...row,
          id: `${index}:${row.id}`,
          findingIds: row.findingIds.map((id) => `${index}:${id}`),
        })),
      ),
      coverage: {
        checked: pages.reduce((sum, page) => sum + page.coverage.checked, 0),
        skipped: pages.reduce((sum, page) => sum + page.coverage.skipped, 0),
        failed: pages.reduce((sum, page) => sum + page.coverage.failed, 0),
      },
      notes: [
        ...pages.flatMap((page) => page.notes),
        ...siteFindings.notes,
        ...skippedPages(raw).map(
          (page) =>
            `Page not audited: ${page.url} (${page.reason.slice(0, SKIPPED_REASON_CHARS)})`,
        ),
        ...(note ? [note] : []),
      ],
      ...(strategy !== undefined ? { strategy } : {}),
    });
  }
  if (object(raw)?.schema === "sokosumi.seo-result/1") {
    const parsed = partial.safeParse(raw);
    if (!parsed.success)
      throw badRequest("The SEO result does not match its supported format");
    const result = parsed.data,
      { notes: serpNotes, ...serpFields } = focusedSerpFields(result);
    assertValidPartialSeoActions(result);
    return publicSeoPayloadSchema.parse({
      version: 1,
      kind: result.kind,
      requestId: result.requestId,
      pageUrls: result.scope.pageUrls,
      observedAt: result.observedAt,
      countryCode: result.scope.countryCode,
      languageCode: result.scope.languageCode,
      rulebookVersion: result.rulebookVersion,
      checks: result.checks,
      keywords: result.keywords,
      competitors: result.competitors.map((row) => ({
        ...row,
        scopePageUrls: result.scope.pageUrls,
      })),
      findings: result.findings,
      actions: result.actions,
      coverage: focusedRuleCoverage(result.checks, {
        notRequested: result.coverage.skipped.length,
        failed: result.coverage.failed.length,
        notRequestedNames: result.coverage.skipped,
        failedNames: result.coverage.failed,
      }),
      notes: [...result.gaps.map((gap) => gap.reason), ...serpNotes],
      ...serpFields,
    });
  }
  const parsed = legacySeoReportSchema.safeParse(raw);
  if (!parsed.success)
    throw badRequest("The SEO report does not match its supported format");
  const result = parsed.data,
    pageUrl = result.request.url,
    at = result.header.capturedAt;
  const publicTargets = [
    pageUrl,
    ...Object.values(result.header.finalUrl ?? {}),
  ].flatMap((value) => (value ? [auditedSeoPageKey(value)] : []));
  const seasonalIdeas = result.seasonalReview?.insights
    .flatMap((row) => readSeasonalInsight(row) ?? [])
    .filter(
      (idea) =>
        publicTargets.includes(auditedSeoPageKey(idea.url)) &&
        idea.country === result.header.market?.country &&
        idea.language === result.header.market?.language,
    )
    .map((idea) => ({ ...idea, url: pageUrl }));
  const findings = result.findings.flatMap((row) =>
    row.devices.map((device) => ({
      id: `${row.id}:${device}`,
      pageUrl,
      device,
      rowId: row.row,
      title: row.name,
      severity: row.level,
      evidence: row.evidence,
      sourceRef: result.snapshotId,
      observedAt: at,
    })),
  );
  const keywords = legacyReportKeywords(result, pageUrl, at),
    ranks = readReviewSources(raw);
  const competitors: z.infer<typeof competitor>[] = (
    result.rankingData?.competitors ?? []
  ).map((row) => ({
    pageUrl: row.url,
    role: "competitor" as const,
    scopePageUrls: [pageUrl],
    rank: row.rank,
    backlinks: null,
    referringDomains: row.referringDomains ?? null,
    source: row.source,
    sourceRef: result.snapshotId,
    observedAt: at,
  }));
  if (result.rankingData)
    competitors.push({
      pageUrl,
      role: "page",
      scopePageUrls: [pageUrl],
      rank: null,
      backlinks: numberAt(result.rankingData, ["page", "summary", "backlinks"]),
      referringDomains: numberAt(result.rankingData, [
        "page",
        "referringDomains",
      ]),
      source: "backlinks",
      sourceRef: result.snapshotId,
      observedAt: at,
    });
  return publicSeoPayloadSchema.parse({
    version: 1,
    kind: "audit_full",
    requestId: null,
    pageUrls: [pageUrl],
    publicSitemaps: workerSitemaps(raw, result),
    pageSpeed: readPageSpeed(
      object(raw)?.speed,
      pageUrl,
      result.header.finalUrl,
    ),
    pageMarketEvidence: readPageMarketEvidence(
      object(raw)?.pageMarketEvidence,
      pageUrl,
      Object.values(result.header.finalUrl ?? {}),
    ),
    reviewSources: ranks,
    articleDates: articleDates(raw, pageUrl, at),
    observedAt: at,
    countryCode: result.header.market?.country ?? "",
    languageCode: result.header.market?.language ?? "",
    rulebookVersion: result.rulebookVersion,
    ...seoDecisions.singlePageDecisions(raw, result, ranks),
    ...(seasonalIdeas && { seasonalIdeas }),
    researchCoverage: [
      {
        ...pageResearchCoverage(raw, pageUrl),
        ...(result.keywordOpportunities?.editorialResearch && {
          rankedKeywordIdeas: true,
        }),
      },
    ],
    checks: readChecklist(result.checklist, result.couldNotSee, pageUrl),
    keywords,
    competitors,
    findings,
    actions: result.actions.map((row) => ({
      id: String(row.n),
      pageUrl,
      findingIds: result.findings
        .filter((item) => row.findings.includes(item.id))
        .flatMap((item) =>
          item.devices.map((device) => `${item.id}:${device}`),
        ),
      title: row.title,
      why: row.why,
      effort: row.effort,
      expectedEffect: row.whatToExpect,
      edit: row.edit ? { ...row.edit, before: row.edit.before ?? null } : null,
    })),
    coverage: {
      checked: result.checklist.filter(
        (row) => row.result === "pass" || row.result === "fired",
      ).length,
      skipped: result.checklist.filter((row) => row.result === "not checked")
        .length,
      failed: result.checklist.filter((row) => row.result === "blocked").length,
    },
    notes: result.couldNotSee.map((row) => `${row.item}: ${row.reason}`),
  });
}
