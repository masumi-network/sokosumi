import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoMarkets } from "./seo-markets";
import { seoTestCheckedAudit, seoTestStrategy } from "./seo-test-fixture";

afterEach(cleanup);

it("shows a regional version without claiming rival demand or recommending translation", () => {
  const data = seoTestCheckedAudit();
  data.observations[0].pageMarketEvidence = {
    regionalVersions: [
      { country: "DE", language: "de", url: "https://example.com/de/" },
    ],
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoMarkets data={data} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText("Germany · German")).toBeDefined();
  expect(screen.getByText(/no competitor comparison/i)).toBeDefined();
  expect(screen.queryByText(/check local queries/i)).toBeNull();
});

it("explains a skipped comparison when the audit has no keyword rows", () => {
  const data = seoTestCheckedAudit();
  data.strategy = { ...seoTestStrategy(), marketNote: "local_business" };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoMarkets data={data} />
    </NextIntlClientProvider>,
  );
  expect(screen.getByText(/local business/i)).toBeDefined();
});

it("shows competitor estimates, the qualifying set and next check for a candidate", () => {
  const data = seoTestCheckedAudit();
  data.strategy = {
    ...seoTestStrategy(),
    markets: {
      rows: [
        {
          country: "DE",
          language: "de",
          start: false,
          rivals: 2,
          of: 3,
          etv: 125,
          share: 0.15,
          ownShare: 0.01,
          hasLanguage: false,
          regionVersion: null,
          candidate: true,
        },
        {
          country: "US",
          language: "en",
          start: true,
          rivals: 3,
          of: 3,
          etv: 300,
          share: 0.4,
          ownShare: 0.8,
          hasLanguage: true,
          regionVersion: "en-US",
          candidate: false,
        },
      ],
      hosts: [
        {
          host: "example.com",
          role: "site",
          etv: 200,
          fetchedAt: new Date("2026-01-02T10:00:00Z"),
          unavailable: false,
        },
        {
          host: "competitor.example",
          role: "product",
          etv: 400,
          fetchedAt: new Date("2026-01-02T10:00:00Z"),
          unavailable: false,
        },
      ],
      siteVisits: true,
      outside: 0.45,
    },
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoMarkets data={data} />
    </NextIntlClientProvider>,
  );
  const candidate = screen.getByRole("table", {
    name: "Markets to investigate",
  });
  for (const value of ["Germany · German", "1%", "15%", "2 of 3", "125"]) {
    expect(within(candidate).getByRole("cell", { name: value })).toBeVisible();
  }
  expect(screen.getByText(/Check local queries/).textContent).toContain(
    "Germany · German",
  );
  expect(
    screen.getByText("United States · English").closest("details")?.open,
  ).toBe(false);
});
