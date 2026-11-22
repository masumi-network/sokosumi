import { describe, expect, it } from "vitest";
import { SEO_AUDIT_PLAN_LIMITS } from "@/schemas/seo-audit-plan.schema";
import {
  legacyReport,
  SEO_TEST_PAGE,
  SEO_TEST_SECOND_PAGE,
} from "@/test-fixtures/project-seo";
import {
  parsePublicSeoArtifact,
  publicSeoPayloadSchema,
} from "./project-seo-report";
import { readAuditPlan, scopedAuditPlan } from "./seo-audit-plan";
import { scopedReportEvidence } from "./seo-report-plan";

const step = (over: Record<string, unknown> = {}) => ({
  pageUrl: SEO_TEST_PAGE,
  kind: "fix",
  action: "Add a title to the page",
  why: "The page has no title, so a search result shows its address.",
  nextCheck: "The next audit reads a title on the page.",
  ...over,
});
const workerPlan = (over: Record<string, unknown> = {}) => ({
  ...step({
    order: "Search engines read the title first.",
    links: [{ pageUrl: SEO_TEST_PAGE, findings: ["finding"] }],
  }),
  summary: "The audit found one issue on the page.",
  strategy: "Name the page before any other work.",
  nextSteps: [step({ action: "Check the result", pageUrl: undefined })],
  alternative: { option: "Rewrite the page", whyNot: "It costs more." },
  revisit: "A title that search engines replace.",
  source: "anthropic/claude-opus-5.5",
  ...over,
});
const page = (plan: unknown) => ({ ...legacyReport(), recommendedPlan: plan });
const read = (raw: unknown) => readAuditPlan(raw, parsePublicSeoArtifact(raw));
/** A site audit of two pages. Each page holds the finding "finding" and the action 1 that cites it. */
const site = (plan: unknown) => ({
  kind: "site",
  rulebookVersion: "test-rulebook",
  pages: [
    legacyReport(),
    { ...legacyReport(), request: { url: SEO_TEST_SECOND_PAGE } },
  ],
  selection: {
    pages: [
      { n: 1, url: SEO_TEST_PAGE, role: "start" },
      { n: 2, url: SEO_TEST_SECOND_PAGE, role: "feature" },
    ],
    skipped: [],
    picked: [],
  },
  recommendedPlan: plan,
});

describe("the SEO worker's audit plan", () => {
  it("keeps the plan of a page audit as ordered steps with the action each step cites", () => {
    expect(read(page(workerPlan()))).toStrictEqual({
      summary: "The audit found one issue on the page.",
      strategy: "Name the page before any other work.",
      alternative: { option: "Rewrite the page", whyNot: "It costs more." },
      revisit: "A title that search engines replace.",
      source: "anthropic/claude-opus-5.5",
      steps: [
        {
          kind: "fix",
          action: "Add a title to the page",
          why: "The page has no title, so a search result shows its address.",
          nextCheck: "The next audit reads a title on the page.",
          order: "Search engines read the title first.",
          pageUrl: SEO_TEST_PAGE,
          actionIds: ["1"],
        },
        {
          kind: "fix",
          action: "Check the result",
          why: "The page has no title, so a search result shows its address.",
          nextCheck: "The next audit reads a title on the page.",
          actionIds: [],
        },
      ],
    });
  });

  it("binds a link of a site audit to the action of the cited page only", () => {
    const plan = read(
      site(
        workerPlan({
          links: [{ pageUrl: SEO_TEST_SECOND_PAGE, findings: ["finding"] }],
        }),
      ),
    );
    // Both pages hold the same finding id. The page of the link decides: "1:1" is action 1 of the second page.
    expect(plan?.steps[0]?.actionIds).toEqual(["1:1"]);
  });

  it("keeps a step without an action when no action of the page cites the findings", () => {
    const plan = read(
      page(
        workerPlan({
          links: [
            { pageUrl: SEO_TEST_PAGE, findings: ["other"] },
            { pageUrl: "https://outside.test/", findings: ["finding"] },
          ],
        }),
      ),
    );
    expect(plan?.steps[0]).toMatchObject({
      action: "Add a title to the page",
      actionIds: [],
    });
  });

  it("names one action once when two links cite it", () => {
    const link = { pageUrl: SEO_TEST_PAGE, findings: ["finding"] };
    expect(
      read(page(workerPlan({ links: [link, link] })))?.steps[0]?.actionIds,
    ).toEqual(["1"]);
  });

  it.each([
    ["no plan", undefined],
    ["a plan that is no object", "Fix the title"],
    ["a first step without a reason", workerPlan({ why: "" })],
    [
      "a first step over its length limit",
      workerPlan({ action: "a".repeat(SEO_AUDIT_PLAN_LIMITS.action + 1) }),
    ],
    [
      "a first step on a page outside the audit",
      workerPlan({ pageUrl: SEO_TEST_SECOND_PAGE }),
    ],
    ["a first step without a page", workerPlan({ pageUrl: undefined })],
  ])("leaves out %s and still reads the audit", (_name, plan) => {
    const raw = page(plan);
    const payload = parsePublicSeoArtifact(raw);
    expect(payload.actions).toHaveLength(1);
    expect(readAuditPlan(raw, payload)).toBeUndefined();
  });

  it("keeps a later step without the page when the audit does not hold that page", () => {
    const plan = read(
      page(
        workerPlan({
          nextSteps: [step({ pageUrl: SEO_TEST_SECOND_PAGE })],
        }),
      ),
    );
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[1]).not.toHaveProperty("pageUrl");
  });

  it("ends the plan before the first later step that is not readable", () => {
    const plan = read(
      page(
        workerPlan({
          nextSteps: [
            step({ action: "Second" }),
            step({ action: "Third", nextCheck: 7 }),
            step({ action: "Fourth" }),
          ],
        }),
      ),
    );
    expect(plan?.steps.map((row) => row.action)).toEqual([
      "Add a title to the page",
      "Second",
    ]);
  });

  it("holds at most the step limit", () => {
    const plan = read(
      page(
        workerPlan({
          nextSteps: Array.from({ length: 12 }, (_, i) =>
            step({ action: `Step ${i + 2}` }),
          ),
        }),
      ),
    );
    expect(plan?.steps).toHaveLength(SEO_AUDIT_PLAN_LIMITS.steps);
  });

  it("leaves out an optional part that is not readable and keeps the step", () => {
    const plan = read(
      page(
        workerPlan({
          order: "o".repeat(SEO_AUDIT_PLAN_LIMITS.order + 1),
          window: "next month",
          kind: "rewrite",
          summary: 5,
        }),
      ),
    );
    expect(plan).not.toHaveProperty("summary");
    expect(plan?.steps[0]).not.toHaveProperty("order");
    expect(plan?.steps[0]).not.toHaveProperty("window");
    expect(plan?.steps[0]).not.toHaveProperty("kind");
    expect(plan?.steps[0]?.actionIds).toEqual(["1"]);
  });

  it("reads no plan from a result that is no full audit", () => {
    const raw = page(workerPlan());
    const payload = { ...parsePublicSeoArtifact(raw), kind: "page_check" };
    expect(readAuditPlan(raw, payload)).toBeUndefined();
  });

  it("still refuses a report with private search data, with or without a plan", () => {
    expect(() =>
      parsePublicSeoArtifact({ ...page(workerPlan()), searchConsole: {} }),
    ).toThrow("Only public SEO evidence can be imported");
  });
});

describe("the audit plan of a view", () => {
  const raw = page(
    workerPlan({ nextSteps: [step({ pageUrl: SEO_TEST_PAGE })] }),
  );
  const stored = () => {
    const payload = parsePublicSeoArtifact(raw);
    // As the stored JSON reads back.
    return publicSeoPayloadSchema.parse(
      JSON.parse(
        JSON.stringify({ ...payload, plan: readAuditPlan(raw, payload) }),
      ),
    );
  };

  it("shows the stored plan when the view holds each page a step names", () => {
    const evidence = scopedReportEvidence(stored(), new Set([SEO_TEST_PAGE]));
    expect(evidence.auditPlan?.steps.map((row) => row.actionIds)).toEqual([
      ["1"],
      [],
    ]);
  });

  it("shows no plan when the view lacks a page of a step", () => {
    expect(
      scopedReportEvidence(stored(), new Set([SEO_TEST_SECOND_PAGE])),
    ).not.toHaveProperty("auditPlan");
  });

  it("shows no plan when the stored plan is not readable", () => {
    expect(
      scopedAuditPlan({ steps: [{ action: "Fix" }] }, () => true),
    ).toBeUndefined();
    expect(
      scopedReportEvidence(
        { ...stored(), plan: { steps: [] } },
        new Set([SEO_TEST_PAGE]),
      ),
    ).not.toHaveProperty("auditPlan");
  });
});
