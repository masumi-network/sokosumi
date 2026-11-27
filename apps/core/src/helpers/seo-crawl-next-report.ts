import { z } from "@hono/zod-openapi";
import { badRequest } from "@/helpers/error";
import {
  SEO_CRAWL_NEXT_MAX_AUDITS,
  type SeoCrawlDeepAudit,
  type SeoSiteCrawl,
  seoSnapshotIdSchema,
} from "@/schemas/seo-site-crawl.schema";
import type { PublicSeoPayload } from "./project-seo-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";
import { readCrawlNext, storableUrl } from "./seo-site-crawl";

/** The stored findings of one audited page (seo-site-crawl.schema.ts). */
const MAX_AUDIT_FINDINGS = 50;
const MAX_REASON = 2000;
/** The rulebook of a continuation that audited no page: its crawl checks have no rulebook version. */
const CRAWL_ONLY_RULEBOOK = "crawl";
const UNREADABLE_PAGE = "Sokosumi could not read the page's audit report";
const UNCHECKED_PAGE =
  "The page's audit lists no issue, but not every check of the page passed";

const crawlNextReport = z.object({
  kind: z.literal("crawl_next"),
  request: z.object({ url: z.string(), continues: seoSnapshotIdSchema }),
  head: z.object({
    skipped: z
      .array(z.object({ url: z.string(), reason: z.string() }))
      .max(SEO_CRAWL_NEXT_MAX_AUDITS),
  }),
  pages: z
    .array(
      z.object({
        url: z.string(),
        pickedFor: z.array(z.string()).max(10),
        report: z.unknown(),
      }),
    )
    .max(SEO_CRAWL_NEXT_MAX_AUDITS),
});

/** The frozen request of a crawl continuation: the crawl it goes on from, and that crawl's start URL. */
const frozenCrawlNext = z.object({
  url: z.string(),
  continues: seoSnapshotIdSchema,
});

/** A deep-audit entry Sokosumi cannot store, also after storage cleanup: the crawl keeps its other entries. */
const storable = (entry: { url: string }) => storableUrl(entry.url);

const cut = (text: string) =>
  text.length > MAX_REASON
    ? `${text.slice(0, MAX_REASON - 1).toWellFormed()}…`
    : text;

/**
 * An SEO bot crawl_next Report as one observation: the crawl of the next pages, with the full audits of its problem
 * pages folded into the crawl. The audits' findings stay out of the observation's own findings, as their pages are no
 * pages of the scope. `parsePage` reads one page audit Report (parsePublicSeoArtifact).
 */
export function parseCrawlNextArtifact(
  raw: unknown,
  parsePage: (raw: unknown) => PublicSeoPayload,
): PublicSeoPayload {
  const parsed = crawlNextReport.safeParse(raw);
  if (!parsed.success)
    throw badRequest(
      "The crawl continuation does not match its supported format",
    );
  const report = parsed.data;
  const audited = report.pages.map(
    (
      page,
    ): { page: typeof page; payload?: PublicSeoPayload; reason?: string } => {
      try {
        const payload = parsePage(page.report);
        // One page's audit, of the page it is listed for: else its findings would show under another URL.
        if (
          payload.kind !== "audit_full" ||
          payload.pageUrls.length !== 1 ||
          auditedSeoPageKey(payload.pageUrls[0]!) !==
            auditedSeoPageKey(page.url)
        )
          return { page };
        // No finding is "No issues" only when each check of the page passed: a blocked or not checked one had no data.
        if (
          !payload.findings.length &&
          (!payload.checks.length ||
            payload.checks.some((check) => check.result !== "pass"))
        )
          return { page, reason: UNCHECKED_PAGE };
        return { page, payload };
      } catch {
        return { page };
      }
    },
  );
  const deepAudit: SeoCrawlDeepAudit = {
    pages: audited.flatMap(({ page, payload }) => {
      if (!payload || !storable(page)) return [];
      // A finding repeats per device: the crawl view lists each rule once.
      const findings = [
        ...new Map(payload.findings.map((row) => [row.rowId, row])).values(),
      ];
      return [
        {
          url: page.url,
          pickedFor: page.pickedFor.map(cut),
          findings: findings
            .slice(0, MAX_AUDIT_FINDINGS)
            .map((row) => ({ title: cut(row.title), severity: row.severity })),
          findingsTotal: findings.length,
        },
      ];
    }),
    skipped: [
      ...report.head.skipped.map((page) => ({
        url: page.url,
        reason: cut(page.reason),
      })),
      ...audited.flatMap(({ page, payload, reason }) =>
        payload ? [] : [{ url: page.url, reason: reason ?? UNREADABLE_PAGE }],
      ),
    ]
      .filter(storable)
      .slice(0, SEO_CRAWL_NEXT_MAX_AUDITS),
  };
  const siteCrawl = readCrawlNext(raw, deepAudit);
  // A continuation with no own Snapshot, or one that repeats its parent, would never join the chain.
  if (
    siteCrawl?.state !== "crawled" ||
    !siteCrawl.startUrl ||
    !siteCrawl.snapshotId ||
    siteCrawl.snapshotId === siteCrawl.continues
  )
    throw badRequest("The crawl continuation has no readable crawl");
  const pages = audited.flatMap(({ payload }) => (payload ? [payload] : []));
  const first = pages[0];
  const observed = pages.map((page) => Date.parse(page.observedAt));
  return {
    version: 1,
    kind: "crawl_next",
    requestId: null,
    pageUrls: [siteCrawl.startUrl],
    // The crawl Report holds no time: the newest page audit's, else the import's.
    observedAt: new Date(
      observed.length ? Math.max(...observed) : Date.now(),
    ).toISOString(),
    // Nobody chose a Market for a continuation: a page audit's own would become the next check's default Market.
    countryCode: "",
    languageCode: "",
    rulebookVersion: first?.rulebookVersion ?? CRAWL_ONLY_RULEBOOK,
    siteCrawl,
    checks: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    coverage: { checked: 0, skipped: 0, failed: 0 },
    notes: [],
  };
}

/** Bind a crawl continuation's Report to its frozen request: the same start URL and the same parent crawl. */
export function assertCrawlNextMatchesRequest(
  payload: PublicSeoPayload,
  expected: { kind: string; request: unknown } | null,
): void {
  const request = frozenCrawlNext.safeParse(expected?.request);
  const crawl = payload.siteCrawl;
  if (
    expected?.kind !== "crawl_next" ||
    payload.kind !== "crawl_next" ||
    !request.success ||
    crawl?.state !== "crawled" ||
    !crawl.startUrl ||
    pageKey(crawl.startUrl) !== pageKey(request.data.url) ||
    crawl.continues !== request.data.continues
  )
    throw badRequest(
      "The crawl continuation does not match its requested crawl",
    );
}

/** A page's key, or null for a URL that is not one: a stored crawl may name any text. */
const pageKey = (url: string) =>
  URL.canParse(url) ? auditedSeoPageKey(url) : null;

/** The stops after which the SEO bot can go on with a crawl (its crawl-resume.ts `continuable`). */
const CONTINUABLE_STOPS: ReadonlySet<string> = new Set(["page cap", "time"]);

/**
 * The crawl a continuation goes on from: the end of the chain that starts at the newest full audit's crawl.
 * Null when that audit has no crawl Sokosumi can continue, or the chain's last crawl stopped for good.
 * `rows` come newest first.
 */
export function crawlContinuationTip(
  rows: readonly {
    kind: string;
    siteCrawl?: SeoSiteCrawl;
    pageUrls: readonly string[];
  }[],
): { snapshotId: string; startUrl: string } | null {
  const root = rows.find((row) => row.kind === "audit_full");
  const audit = root?.siteCrawl;
  if (audit?.state !== "crawled" || !audit.snapshotId || !audit.startUrl)
    return null;
  // Every continuation crawls from this URL: it must be a page the audit was approved for.
  const start = pageKey(audit.startUrl);
  if (!start || !root?.pageUrls.some((url) => pageKey(url) === start))
    return null;
  const children = new Map<string, SeoSiteCrawl & { state: "crawled" }>();
  for (const row of rows) {
    const crawl = row.siteCrawl;
    if (crawl?.state !== "crawled") continue;
    // Newest first: the oldest continuation of a parent is the chain's.
    if (crawl.continues && crawl.snapshotId)
      children.set(crawl.continues, crawl);
  }
  let tip = audit;
  const seen = new Set<string>();
  while (tip.snapshotId) {
    seen.add(tip.snapshotId);
    const child = children.get(tip.snapshotId);
    if (!child) break;
    // A crawl that reports an earlier crawl's Snapshot as its own loops the chain: its end is unknown.
    if (seen.has(child.snapshotId!)) return null;
    tip = child;
  }
  if (!tip.snapshotId || !tip.startUrl || !CONTINUABLE_STOPS.has(tip.stop))
    return null;
  return { snapshotId: tip.snapshotId, startUrl: tip.startUrl };
}
