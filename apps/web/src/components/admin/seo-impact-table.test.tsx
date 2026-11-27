import type { AdminSeoImpactVerdicts } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import en from "@/messages/en.json";

import { SeoImpactTable } from "./seo-impact-table";

vi.mock("next-intl/server", () => ({
  getTranslations: async (
    namespace: "App.Admin.SeoImpact" | "App.Seo.breakdown.devices",
  ) => createTranslator({ locale: "en", messages: en, namespace }),
  getFormatter: async () =>
    createFormatter({
      locale: "en",
      timeZone: "UTC",
      formats: createFormats(),
    }),
}));

const row = (
  overrides: Partial<AdminSeoImpactVerdicts["rows"][number]>,
): AdminSeoImpactVerdicts["rows"][number] => ({
  id: "row_1",
  organizationSlug: "nmkr",
  projectId: "proj_1",
  projectName: "NMKR",
  pageUrl: "https://nmkr.io/stake",
  suggestionTitle: null,
  changeSource: "audit_recheck",
  changedAt: new Date("2026-10-01T00:00:00.000Z"),
  closingEvidence: null,
  crawledAt: null,
  windowStart: null,
  windowEnd: null,
  windowReadyOn: null,
  state: "waiting_crawl",
  reason: null,
  ...overrides,
});

const table = (rows: AdminSeoImpactVerdicts["rows"]) =>
  SeoImpactTable({
    verdicts: { total: rows.length, rows },
    period: "90",
    periods: ["90", "365", "all"],
  });

describe("SeoImpactTable", () => {
  it("lists each closing evidence entry under the page URL", async () => {
    render(
      await table([
        row({
          closingEvidence: [
            {
              rowId: "audit_row_1",
              device: "mobile",
              baselineObservedAt: new Date("2026-10-01T00:00:00.000Z"),
              checkedObservedAt: new Date("2026-10-29T00:00:00.000Z"),
            },
          ],
        }),
      ]),
    );

    expect(
      screen.getByText(
        /^audit_row_1 · Mobile: baseline Oct 1, 2026.*rechecked Oct 29, 2026/,
      ),
    ).toBeTruthy();
  });
});
