import { expect, it } from "vitest";
import { failedPageRuns } from "./project-seo-public-report";
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
