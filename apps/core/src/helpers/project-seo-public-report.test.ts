import { expect, it } from "vitest";
import {
  failedPageRuns,
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
      ],
    }),
  ).toEqual(["seasonal", "exploration", "searchInvestigation"]);
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
