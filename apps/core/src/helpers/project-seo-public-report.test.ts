import { expect, it } from "vitest";
import {
  failedPageRuns,
  failedSeoSources,
  failedSeoSpecialists,
} from "./project-seo-public-report";
import { skippedPages } from "./project-seo-report";

it("counts failed page runs once and excludes deliberate skips from the stored incident count", () => {
  const exception = {
    url: "https://example.test/a",
    reason: "the page Run failed: upstream response",
  };
  expect(
    failedPageRuns(
      skippedPages({
        kind: "site",
        selection: {
          skipped: [
            exception,
            exception,
            { url: "https://example.test/b", reason: "budget reached" },
          ],
        },
      }),
    ),
  ).toBe(1);
  expect(
    failedPageRuns(
      skippedPages({ kind: "page", selection: { skipped: [exception] } }),
    ),
  ).toBe(0);
});

it("retains only typed failed specialist stages from a bound report and counts one seasonal incident per audit", () => {
  const good = {
    seasonalReview: {
      status: { demand: "completed", audience: "completed" },
      insights: [],
    },
  };
  const bad = {
    seasonalReview: {
      status: { demand: "failed", audience: "invalid" },
      insights: [],
    },
  };
  expect(
    failedSeoSpecialists({
      kind: "site",
      pages: [good, bad, bad],
      specialistFailures: [
        "exploration",
        "sensitive error",
        "searchInvestigation",
        "speedPages",
      ],
    }),
  ).toEqual(["seasonal", "exploration", "searchInvestigation", "speedPages"]);
  expect(
    failedSeoSpecialists({ ...good, notes: ["exploration failed"] }),
  ).toEqual([]);
  expect(
    failedSeoSpecialists({
      seasonalReview: {
        status: { demand: "unrecorded", audience: "unrecorded" },
      },
    }),
  ).toEqual(["seasonal"]);
  expect(
    failedSeoSpecialists({
      kind: "site",
      pages: [good],
      specialistFailures: "exploration",
    }),
  ).toEqual([]);
});

it("records the standalone exploration failure as an admin issue", () => {
  expect(
    failedSeoSpecialists({
      specialistFailures: [
        "exploration",
        "searchInvestigation",
        "speedPages",
        "provider details",
      ],
    }),
  ).toEqual(["exploration"]);
});

it("keeps distinct editorial stage failures from eligible site pages and standalone audits", () => {
  const page = {
    specialistFailures: [
      "editorialGemini",
      "editorialValidation",
      "private vendor details",
    ],
  };
  expect(failedSeoSpecialists(page)).toEqual([
    "editorialGemini",
    "editorialValidation",
  ]);
  expect(
    failedSeoSpecialists({
      kind: "site",
      pages: [page, page, { specialistFailures: ["editorialCodex"] }],
    }),
  ).toEqual(["editorialGemini", "editorialCodex", "editorialValidation"]);
});

it("keeps only known source failure codes from a page or any page of a site report", () => {
  expect(
    failedSeoSources({
      sourceFailures: [
        "lighthouseFailed",
        "Web Risk HTTP 403",
        "webRiskFailed",
      ],
    }),
  ).toEqual(["webRiskFailed", "lighthouseFailed"]);
  expect(
    failedSeoSources({
      kind: "site",
      sourceFailures: ["lighthouseFailed"],
      pages: [{}, { sourceFailures: ["webRiskNotRun"] }],
    }),
  ).toEqual(["webRiskNotRun"]);
  expect(failedSeoSources({ sourceFailures: "webRiskNotRun" })).toEqual([]);
  expect(failedSeoSources(null)).toEqual([]);
});
