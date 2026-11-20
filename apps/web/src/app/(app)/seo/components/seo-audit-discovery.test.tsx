import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoAuditDiscovery } from "./seo-audit-discovery";
import { SeoAuditResearch } from "./seo-audit-research";
import { seoTestWorkspace } from "./seo-test-fixture";

afterEach(cleanup);

it("shows Google processing errors, the scoped inspection sample and its source separately", () => {
  const date = new Date("2026-11-20T00:00:00Z");
  const map = "https://example.test/sitemap.xml";
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoAuditDiscovery
        evidence={{
          checkedAt: date,
          status: "available",
          sitemaps: [
            {
              path: map,
              type: "sitemap",
              index: false,
              pending: false,
              submittedAt: null,
              downloadedAt: date,
              errors: 2,
              warnings: 0,
              webUrls: 41,
            },
          ],
          inspections: [
            {
              page: "https://example.test/a",
              reason: "Crawled - currently not indexed",
              verdict: "NEUTRAL",
              canonical: null,
              crawledAt: null,
              checkedAt: date,
              referringPages: ["https://example.test/guide"],
            },
          ],
          changes: [],
          publicSitemaps: [map],
          actions: [
            {
              url: map,
              action: "Fix entries Google could not read.",
              evidence: "Google reported 2 errors.",
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Inspected URLs in this audit (1)")).toBeDefined();
  expect(
    screen.getByText("Page URLs reported in this sitemap: 41."),
  ).toBeDefined();
  expect(screen.getByText("Fix entries Google could not read.")).toBeDefined();
  expect(screen.getByText("https://example.test/guide")).toBeDefined();
});

it("shows the evidence for a single Search Console action before expanding it", () => {
  const url = "https://example.test/sitemap.xml";
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoAuditResearch
        workspace={seoTestWorkspace()}
        discovery={{
          status: "available",
          checkedAt: new Date("2026-11-20"),
          sitemaps: [],
          inspections: [],
          changes: [],
          publicSitemaps: [url],
          actions: [
            {
              url,
              action: "Submit the existing sitemap.",
              evidence: "The public sitemap is absent from the submitted list.",
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
  const summary = screen.getByText(
    "The public sitemap is absent from the submitted list.",
    { selector: "summary span > span" },
  );
  expect(summary).toBeVisible();
  expect(screen.getByText("Submit the existing sitemap.")).not.toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByText("Submit the existing sitemap.")).toBeVisible();
});
