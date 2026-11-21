import type { ProjectSeoWorkspace, SeoAuditBrief } from "@sokosumi/core-client";
import { expect, it } from "vitest";
import { defaultPlanReport, seoReportPlan } from "./seo-report-plan-model";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";

type Candidate = NonNullable<
  ProjectSeoWorkspace["observations"][number]["planCandidates"]
>[number];
const data = seoTestWorkspace(),
  guide = data.pages[0]!;
const booking = { ...guide, id: "booking", url: guide.url + "book" };
data.pages.push(booking);
const copy: Candidate = {
  kind: "content",
  pageUrl: guide.url,
  title: "Compare battery replacement with an upgrade.",
  reason: "The sampled searches include both decisions.",
  evidence: ["MacBook battery replacement vs upgrade"],
};
const link: Candidate = {
  kind: "broken_link",
  pageUrl: guide.url,
  destinations: [booking.url],
  title: "Repair the booking link.",
  reason: "The booking page returned 404.",
  evidence: [booking.url + " → 404"],
};
const report = { ...seoTestObservation(data), planCandidates: [copy, link] };
const brief: SeoAuditBrief = {
  revision: 1,
  updatedAt: null,
  objective: "sales",
  outcome: null,
  audience: null,
  constraints: null,
  priorities: [],
  followUps: [],
  pages: [
    {
      pageId: booking.id,
      job: null,
      role: "product",
      action: "book",
      indexIntent: "index",
    },
  ],
};
const now = new Date("2026-11-20T12:00:00Z");

it("chooses a repair before promotion for bookings and a query test for traffic, using the same report", () => {
  const choose = (
    objective: SeoAuditBrief["objective"],
    items: Candidate[] = report.planCandidates,
  ) =>
    seoReportPlan(
      data,
      { ...report, planCandidates: items },
      { ...brief, objective },
      false,
      now,
    );
  expect(choose("sales")).toMatchObject({
    lead: link,
    basis: "goalPath",
    follow: copy,
  });
  expect(choose("traffic")).toMatchObject({
    lead: copy,
    runnerUp: { item: link },
  });
  expect(
    choose("sales", [copy, { ...link, destinations: [guide.url + "unused"] }])
      ?.lead,
  ).toEqual(copy);
});

it("reconsiders a sales edit when channel comparisons change and keeps later personal outcomes out of historical reports", () => {
  const sales = {
    ...brief,
    pages: [{ ...brief.pages[0]!, pageId: guide.id, action: "buy" as const }],
  };
  const period = {
    from: "2026-10-01",
    to: "2026-10-07",
    organic: { sessions: 100, rate: 0.1 },
    direct: { sessions: 100, rate: 0.1 },
  };
  function check(
    assessment: "both_declined" | "organic_declined" | "goal_held",
    historical = false,
  ) {
    const control = {
      pageUrl: guide.url,
      timeZone: "UTC",
      event: "purchase" as const,
      before: period,
      after: { ...period, from: "2026-11-01", to: "2026-11-07" },
      assessment,
    };
    return seoReportPlan(
      data,
      { ...report, planCandidates: [copy] },
      {
        ...sales,
        followUps: [
          {
            pageId: guide.id,
            changedAt: null,
            lastCrawlAt: null,
            status: "unknown",
            indexReview: "unknown",
            goalInvestigation: control,
          },
        ],
      },
      historical,
      now,
    );
  }
  expect(check("both_declined")).toMatchObject({
    basis: "checkTracking",
    reconsider: true,
    runnerUp: { item: copy },
  });
  expect(check("organic_declined")).toMatchObject({ basis: "checkIntent" });
  expect(check("goal_held")?.reconsider).toBe(false);
  expect(check("both_declined", true)?.control).toBeUndefined();
});

it("uses page impressions from the selected report to choose between traffic edits", () => {
  const period = { from: new Date("2026-10-01"), to: new Date("2026-10-28") };
  const search = {
    ...period,
    taskId: "matched",
    propertyId: "domain",
    measuredPages: [],
    pageUrls: [guide.url, booking.url],
    coverage: "complete" as const,
    opportunities: [],
    queries: null,
    previous: null,
    clicks: null,
    impressions: null,
    ctr: null,
    averagePosition: null,
    pageDiscovery: {
      recent: period,
      previous: period,
      pages: [],
      limited: true,
      topClickedPages: [{ pageUrl: booking.url, impressions: 90, clicks: 4 }],
    },
  };
  const candidate = {
    ...copy,
    pageUrl: booking.url,
    title: "Explain the booking options.",
  };
  function choose(task: string) {
    return seoReportPlan(
      { ...data, auditSearchConsole: [search] },
      { ...report, sourceTaskId: task, planCandidates: [copy, candidate] },
      { ...brief, objective: "traffic" },
      true,
      now,
    );
  }
  expect(choose("matched")).toMatchObject({
    lead: candidate,
    exposure: { impressions: 90 },
  });
  expect(choose("unrelated")).toMatchObject({
    lead: copy,
    exposure: undefined,
  });
  const opportunity = {
    pageUrl: guide.url,
    id: "snippet",
    title: "Test the battery guide snippet",
    why: "The guide appeared in search with few clicks.",
    expectedEffect: "Compare relevant clicks.",
    evidence: ["query: check battery health"],
  };
  const privateReport = {
    ...report,
    sourceTaskId: search.taskId,
    planCandidates: [],
  };
  const find = (scopeIds: string[]) =>
    seoReportPlan(
      {
        ...data,
        scope: { ...data.scope, pageIds: scopeIds },
        auditSearchConsole: [{ ...search, opportunities: [opportunity] }],
      },
      privateReport,
      brief,
      true,
      now,
    );
  expect(find(report.pageIds)?.lead.title).toBe(opportunity.title);
  expect(find([])).toBeNull();
});

it("moves a recurring topic ahead of an evergreen edit when an earlier competitor report corroborates its query", () => {
  const topic = "macbook battery health";
  const anchor = {
    ...report,
    observedAt: new Date("2027-02-05"),
    planCandidates: [
      copy,
      {
        ...copy,
        title: "Add a battery condition comparison.",
        queries: [topic],
        season: {
          country: "US",
          through: new Date("2027-03-31"),
          windows: [{ month: "2027-03", peaks: ["2025-03", "2026-03"] }],
          pageGap: true,
        },
      },
    ],
  };
  const other = {
    ...report,
    id: "prior",
    artifactHash: "older-artifact",
    observedAt: new Date("2026-12-01"),
    planCandidates: [copy],
    planSignals: [
      {
        pageUrl: guide.url,
        query: topic,
        source: "gap" as const,
        evidence:
          "Competitor research identified a gap for macbook battery health.",
      },
    ],
  };
  const choose = (earlier: typeof other) =>
    seoReportPlan(
      { ...data, observations: [anchor, earlier] },
      anchor,
      { ...brief, objective: "traffic" },
      false,
      new Date("2027-02-05T12:00Z"),
    );
  expect(choose(other)).toMatchObject({
    lead: { title: "Add a battery condition comparison." },
    timing: { month: "2027-03" },
    sources: [{ reportId: "prior" }],
  });
  expect(choose({ ...other, countryCode: "DE" })?.sources).toEqual([]);
  expect(
    choose({ ...other, observedAt: new Date("2027-02-06") })?.sources,
  ).toEqual([]);
  const ranked = {
    ...other,
    id: "rank",
    artifactHash: "ranked",
    observedAt: new Date("2027-02-08"),
    planCandidates: [],
    planSignals: [
      {
        pageUrl: guide.url,
        query: topic,
        source: "rank" as const,
        evidence: "Position 14 on desktop.",
      },
    ],
  };
  const resumed = seoReportPlan(
    { ...data, observations: [ranked, anchor, other] },
    ranked,
    { ...brief, objective: "traffic" },
    false,
    new Date("2027-02-08T12:00Z"),
  );
  expect(resumed).toMatchObject({
    lead: { title: "Add a battery condition comparison." },
    originId: anchor.id,
    sources: expect.arrayContaining([
      expect.objectContaining({ reportId: ranked.id }),
      expect.objectContaining({ reportId: anchor.id }),
    ]),
  });
  const onePeak = {
    ...anchor,
    planCandidates: anchor.planCandidates.map((c) =>
      c.season
        ? {
            ...c,
            season: {
              ...c.season,
              windows: [{ month: "2027-03", peaks: ["2026-03"] }],
            },
          }
        : c,
    ),
  };
  const olderPeak = {
    ...other,
    planSignals: [
      {
        pageUrl: guide.url,
        query: topic,
        source: "season" as const,
        evidence: "Earlier March peak",
        peaks: ["2025-03"],
      },
    ],
  };
  expect(
    seoReportPlan(
      { ...data, observations: [onePeak, olderPeak] },
      onePeak,
      { ...brief, objective: "traffic" },
      false,
      new Date("2027-02-05T12:00Z"),
    )?.timing?.peaks,
  ).toEqual(["2025-03", "2026-03"]);
});

it("uses a booking event chosen for this page and calls out missing booking evidence", () => {
  const pages = [
    {
      ...brief.pages[0]!,
      pageId: guide.id,
      completionEvent: "appointment_confirmed",
    },
  ];
  const period = {
    from: "2026-10-01",
    to: "2026-10-07",
    organic: { sessions: 100, rate: 0.1 },
    direct: { sessions: 100, rate: 0.1 },
  };
  const goalInvestigation = {
    event: "appointment_confirmed",
    pageUrl: guide.url,
    timeZone: "UTC",
    before: period,
    after: { ...period, from: "2026-11-01", to: "2026-11-07" },
    assessment: "both_declined" as const,
  };
  const follow = {
    ...{
      pageId: guide.id,
      changedAt: null,
      lastCrawlAt: null,
      status: "unknown" as const,
      indexReview: "unknown" as const,
    },
    goalInvestigation,
  };
  const choose = (followUps: SeoAuditBrief["followUps"]) =>
    seoReportPlan(
      data,
      { ...report, planCandidates: [copy] },
      { ...brief, pages, followUps },
      false,
      now,
    );
  expect(choose([follow])?.basis).toBe("checkTracking");
  expect(choose([])?.missingOutcome).toBe("book");
});

it("starts on the newest report that can hold a plan", () => {
  const audit = { ...report, id: "audit", kind: "audit_full" };
  const rankings = {
    ...report,
    id: "rankings",
    kind: "rankings",
    planCandidates: [],
  };
  const clean = { ...rankings, id: "clean", kind: "audit_full" };
  // Newest first, as seoPlanReports gives them.
  expect(defaultPlanReport([rankings, audit])).toBe(audit);
  // A full audit with nothing to do replaces the earlier plan.
  expect(defaultPlanReport([clean, rankings, audit])).toBe(clean);
  expect(defaultPlanReport([rankings])).toBe(rankings);
});
