import { expect, it } from "vitest";
import { parsePublicSeoArtifact } from "@/helpers/project-seo-report";
import { legacyReport, SEO_TEST_PAGE } from "@/test-fixtures/project-seo";
import { SeoAuditDecisions } from "./seo-audit-decisions";

const keyword = "printed manuals";
const page = SEO_TEST_PAGE;
const oldDate = "2026-09-01T00:00:00.000Z";
const newDate = "2026-11-01T00:00:00.000Z";
const oldId = "a".repeat(64),
  newId = "b".repeat(64);
function report(position: number, at: string, snapshotId: string, url = page) {
  const raw = legacyReport();
  return {
    ...raw,
    snapshotId,
    header: { ...raw.header, capturedAt: at },
    rankingData: {
      ...raw.rankingData,
      source: "DataForSEO Labs and Backlinks API",
      page: {
        ...raw.rankingData.page,
        rankedResult: "ok",
        ranked: {
          rows: [{ keyword, position, volume: 100, intent: null, url }],
        },
      },
    },
    rankReviewTriggers:
      at === oldDate
        ? [
            {
              decisionId: "example",
              kind: "rank_crosses",
              keyword,
              position,
              boundary: 10,
            },
          ]
        : [],
    strategyDecisions:
      at === oldDate
        ? [
            {
              id: "example",
              kind: "content_opportunity",
              targetUrl: page,
              action: "Review the page for this keyword.",
              reason: "The page ranked near the top ten.",
              alternative: "Keep the existing answer.",
              nextCheck: "Compare the next observed rank.",
              evidence: [snapshotId, "rankingData.page.ranked"],
            },
          ]
        : [],
  };
}
const scope = {
  projectId: "project",
  auditId: null,
  ownerId: null,
  scopeVersion: 1,
};
function reviews(
  later = report(8, newDate, newId),
  changes = {},
  earlier = report(12, oldDate, oldId),
) {
  const rows = new SeoAuditDecisions(
    new Set([page]),
    [],
    new Map(),
    new Date(newDate),
  );
  rows.append(
    {
      ...scope,
      ...changes,
      id: "later",
      observedAt: new Date(later.header.capturedAt),
    },
    parsePublicSeoArtifact(later),
    true,
  );
  rows.append(
    { ...scope, id: "earlier", observedAt: new Date(oldDate) },
    parsePublicSeoArtifact(earlier),
    false,
  );
  return rows.actions.filter((a) => a.followUpReview);
}
it("reopens a dated recommendation once on a later independent top-ten crossing", () => {
  expect(reviews()).toMatchObject([
    {
      observationId: "earlier",
      taskId: null,
      followUpReview: {
        kind: "rank_crosses",
        keyword,
        before: 12,
        after: 8,
        observationId: "later",
        observedAt: newDate,
      },
    },
  ]);
});
it("requires the same owner, scope, market, page, keyword, distinct snapshot and later day", () => {
  const fresh = report(8, newDate, newId);
  for (const later of [
    report(11, newDate, newId),
    report(8, newDate, oldId),
    report(8, oldDate, newId),
    report(8, newDate, newId, page + "?other=1"),
    {
      ...fresh,
      header: { ...fresh.header, market: { country: "GB", language: "en" } },
    },
    {
      ...fresh,
      header: {
        ...fresh.header,
        market: { ...fresh.header.market, doubt: "unconfirmed" },
      },
    },
    { ...fresh, rulebookVersion: "changed" },
  ])
    expect(reviews(later)).toHaveLength(0);
  for (const changes of [
    { projectId: "other" },
    { ownerId: "other" },
    { auditId: "other" },
    { scopeVersion: 2 },
  ])
    expect(reviews(fresh, changes)).toHaveLength(0);
});

it("ignores malformed or ambiguous trigger metadata without dropping the public action", () => {
  const raw = report(12, oldDate, oldId),
    t = raw.rankReviewTriggers[0];
  for (const rankReviewTriggers of [
    [t, t],
    [{ ...t, position: 2 }],
    [{ ...t, keyword: "different query" }],
    [{ ...t, decisionId: "other" }],
    [{ ...t, boundary: 20 }],
  ]) {
    expect(
      parsePublicSeoArtifact({ ...raw, rankReviewTriggers }).strategyDecisions,
    ).toEqual(raw.strategyDecisions);
  }
  expect(
    parsePublicSeoArtifact({
      ...raw,
      rankReviewTriggers: [],
      strategyDecisions: raw.strategyDecisions.map((d) => ({
        ...d,
        reviewTrigger: t,
      })),
    }).strategyDecisions,
  ).toEqual(raw.strategyDecisions);
});
