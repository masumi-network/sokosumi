import { expect, it } from "vitest";
import { requestSeoAnalysisSchema } from "@/schemas/project-seo.schema";
import {
  type SeoBriefContent,
  saveSeoAuditBriefRequestSchema,
} from "@/schemas/seo-audit-brief.schema";
import { seoTaskPacket } from "./project-seo-operations.service";
import { publicPageGoals } from "./seo-audit-brief-dispatch";
import { briefFollowUp } from "./seo-audit-brief-follow-up";
import { briefPriorities } from "./seo-audit-brief-priorities";

const priceId = "01908b31-bb63-7f0e-83bd-f0ad9f095240";
const supportId = "01908b31-bb63-7f0e-83bd-f0ad9f095241";
const scope = [
  { id: priceId, url: "https://example.test/pricing" },
  { id: supportId, url: "https://example.test/help" },
];
const brief: SeoBriefContent = {
  objective: "sales",
  audience: "private audience",
  constraints: "private constraint",
  outcome: "private target",
  pages: [
    {
      pageId: priceId,
      role: "pricing",
      action: "buy",
      job: "private pricing job",
      indexIntent: "index",
    },
    {
      pageId: supportId,
      role: "support",
      action: "read",
      job: "private support job",
      indexIntent: "unknown",
    },
  ],
};
const input = requestSeoAnalysisSchema.parse({
  kind: "audit_full",
  countryCode: "US",
  languageCode: "en",
  idempotencyKey: "test-audit-brief",
});

it("accepts edits for a first brief and binds sharing consent to the same base revision", () => {
  const setupGoal = { pageId: priceId, expectedRevision: 0, action: "buy" };
  const sharedBrief = { revision: 0, pageIds: [priceId] };
  expect(
    requestSeoAnalysisSchema.safeParse({ ...input, setupGoal, sharedBrief })
      .success,
  ).toBe(true);
  expect(
    requestSeoAnalysisSchema.safeParse({ ...input, sharedBrief }).success,
  ).toBe(false);
  expect(
    requestSeoAnalysisSchema.safeParse({
      ...input,
      setupGoal,
      sharedBrief: { ...sharedBrief, revision: 1 },
    }).success,
  ).toBe(false);
  expect(
    requestSeoAnalysisSchema.safeParse({
      ...input,
      kind: "page_check",
      setupGoal,
    }).success,
  ).toBe(true);
  expect(
    requestSeoAnalysisSchema.safeParse({
      ...input,
      kind: "page_check",
      setupGoal,
      sharedBrief,
    }).success,
  ).toBe(false);
  expect(
    requestSeoAnalysisSchema.safeParse({
      ...input,
      kind: "rankings",
      setupGoal,
    }).success,
  ).toBe(false);
});

it("shares only the explicitly selected public enum values, leaves a legacy packet identical, and refuses unbound consent", () => {
  const context = publicPageGoals(brief, scope, [supportId]);
  const urls = scope.map((p) => p.url);
  const v1 = seoTaskPacket(input, urls, "one");
  expect(
    seoTaskPacket(
      {
        ...input,
        setupGoal: { pageId: priceId, expectedRevision: 0, action: "buy" },
      },
      urls,
      "one",
    ),
  ).toEqual(v1);
  expect(v1).toEqual({
    version: 1,
    requestId: "one",
    pageUrls: urls,
    countryCode: "US",
    languageCode: "en",
  });
  expect(
    seoTaskPacket(
      { ...input, sharedBrief: { revision: 1, pageIds: [supportId] } },
      urls,
      "one",
      context,
    ),
  ).toEqual({
    ...v1,
    version: 2,
    context: {
      pages: [{ url: scope[1].url, role: "support", action: "read" }],
    },
  });
  expect(() => seoTaskPacket(input, urls, "one", context)).toThrow();
  expect(() =>
    publicPageGoals(brief, scope.slice(0, 1), [supportId]),
  ).toThrow();
  expect(() => publicPageGoals(brief, scope, [supportId, supportId])).toThrow();
  expect(() =>
    publicPageGoals({ ...brief, pages: [] }, scope, [priceId]),
  ).toThrow();
  expect(
    saveSeoAuditBriefRequestSchema.safeParse({
      ...brief,
      expectedRevision: 0,
      pages: [brief.pages[0], brief.pages[0]],
    }).success,
  ).toBe(false);
});

it("keeps an intended exclusion private and withholds stale index advice after a change", () => {
  const crawl = "2026-09-08T00:00:00.000Z";
  const inspection = {
    pageUrl: scope[0].url,
    verdict: "NEUTRAL" as const,
    lastCrawlTime: crawl,
    indexingState: "BLOCKED_BY_META_TAG",
  };
  expect(briefFollowUp(brief.pages[0], null, inspection).indexReview).toBe(
    "review_indexing",
  );
  expect(
    briefFollowUp(
      { ...brief.pages[0], indexIntent: "exclude" },
      null,
      inspection,
    ).indexReview,
  ).toBe("expected_exclusion");
  expect(
    briefFollowUp(brief.pages[0], new Date(crawl), inspection),
  ).toMatchObject({ status: "awaiting_recrawl", indexReview: "unknown" });
  expect(
    briefFollowUp(brief.pages[0], new Date("2026-09-07T00:00:00Z"), inspection),
  ).toMatchObject({ status: "recrawled", indexReview: "review_indexing" });
  expect(briefFollowUp(brief.pages[0], new Date(crawl), null)).toMatchObject({
    status: "unknown",
    indexReview: "unknown",
  });
});

it("changes discretionary priorities on the same pages when the owner switches from sales to support; a genuine index issue still leads", () => {
  const future = new Map();
  const follow = brief.pages.map((p) => briefFollowUp(p, null, null));
  const sales = briefPriorities(brief, follow, future)[0];
  expect(sales.pageId).toBe(priceId);
  expect(sales.nextStep).toContain(brief.pages[0].job!);
  expect(sales.nextStep).toContain(brief.outcome!);
  expect(
    briefPriorities({ ...brief, objective: "support" }, follow, future)[0]
      .pageId,
  ).toBe(supportId);
  expect(
    briefPriorities(
      { ...brief, objective: "support" },
      [{ ...follow[0], indexReview: "review_indexing" }, follow[1]],
      future,
    )[0].pageId,
  ).toBe(priceId);
});

it("uses comparable landing sessions for a traffic objective without assigning key events to individual queries", () => {
  const observed = new Map([
    [
      supportId,
      { sessions: 100, keyEvents: 1, from: "2026-09-01", to: "2026-09-28" },
    ],
    [
      priceId,
      { sessions: 15, keyEvents: 4, from: "2026-09-01", to: "2026-09-28" },
    ],
  ]);
  const content = {
    ...brief,
    objective: "traffic" as const,
    pages: brief.pages.map((p) => ({ ...p, indexIntent: "index" as const })),
  };
  expect(briefPriorities(content, [], observed)[0]).toMatchObject({
    pageId: supportId,
    why: expect.arrayContaining([
      expect.stringContaining("100 sessions and 1 GA4 key events"),
    ]),
  });
});
