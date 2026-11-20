import { createTranslator, type Messages } from "next-intl";
import { expect, it } from "vitest";
import type { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import messages from "../../../../../messages/en.json";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";
import { seoWorklistEvidence } from "./seo-worklist-evidence";

const t: ReturnType<typeof useSeoResultTranslations<"App.Seo">> =
  createTranslator<Messages, "App.Seo">({
    locale: "en",
    messages,
    namespace: "App.Seo",
  });
it("prioritizes slow mobile lab paint once, including when a saved device-specific action covers it", () => {
  const data = seoTestWorkspace(),
    pageUrl = data.pages[0].url,
    audit = seoTestObservation(data);
  const lab = {
    status: "measured" as const,
    median: { lcp: 7350, cls: 0, tbt: 18, fcp: 1200, si: 2680 },
    lighthouse: "13.6.0",
    ok: 1,
    runs: 1,
    pageSpeed: { scores: { performance: 76 }, insights: [] },
  };
  data.observations = [
    {
      ...audit,
      kind: "audit_full",
      pageSpeed: [
        {
          device: "mobile",
          pageUrl,
          testedUrl: pageUrl,
          lab,
          field: { status: "not_checked" },
        },
        {
          device: "desktop",
          pageUrl,
          testedUrl: pageUrl,
          lab: { ...lab, median: { ...lab.median, lcp: 360 } },
          field: { status: "not_checked" },
        },
      ],
    },
  ];
  expect(seoWorklistEvidence(data, undefined, [], t)).toHaveLength(0);
  data.observations[0].checklistBreakdown = {
    passed: 0,
    flagged: 0,
    research: [],
    gaps: [
      {
        pageUrl,
        device: "mobile",
        rowId: "EX-01",
        reason:
          "Chrome UX Report field data was not collected by this public audit.",
      },
    ],
  };
  const [mobile, ...others] = seoWorklistEvidence(data, undefined, [], t);
  expect(others).toHaveLength(0);
  expect(mobile).toMatchObject({ bucket: "high", url: pageUrl });
  expect(mobile.title.toLowerCase()).toContain("mobile");
  expect(mobile.facts.join(" ")).toMatch(/7.35 s.*Repeat the Lighthouse test/);
  const finding = {
    id: "paint",
    observationId: audit.id,
    pageUrl,
    rowId: "EX-14",
    device: "mobile" as const,
    severity: "minor" as const,
    evidence: [],
    title: "Slow lab paint",
    sourceRef: "psi",
    observedAt: audit.observedAt,
  };
  const action = {
    id: "speed",
    observationId: audit.id,
    pageUrl,
    findingIds: [finding.id],
    kind: "fix" as const,
    title: "Reduce mobile LCP",
    why: "Slow paint",
    effort: "medium" as const,
    expectedEffect: "Faster paint",
    edit: null,
    taskId: null,
    status: "recommended" as const,
    evidence: [],
  };
  data.findings = [finding];
  expect(seoWorklistEvidence(data, undefined, [action], t)).toHaveLength(0);
  data.findings = [{ ...finding, device: "desktop" }];
  expect(seoWorklistEvidence(data, undefined, [action], t)).toHaveLength(1);
});
