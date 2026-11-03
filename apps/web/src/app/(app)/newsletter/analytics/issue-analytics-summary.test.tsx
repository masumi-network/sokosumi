import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { NEWSLETTER_ANALYTICS } from "@/test/newsletter";
import { IssueAnalyticsSummary } from "./issue-analytics-summary";

describe("sent issue analytics summary", () => {
  it("shows compact rates and per-link unique clicks, treating URLs as text", () => {
    const url = "https://example.com/news";
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <IssueAnalyticsSummary
          analytics={{
            totals: NEWSLETTER_ANALYTICS.totals,
            topLinks: [{ url, uniqueClicks: 2 }],
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Issue analytics" }),
    ).toBeVisible();
    expect(screen.getByText("50%")).toBeVisible();
    const row = screen.getByText(url).closest("tr");
    expect(row).not.toBeNull();
    if (row) expect(within(row).getByText("2")).toBeVisible();
    expect(
      screen.getByText(en.App.Projects.Newsletter.Analytics.opensNote),
    ).toBeVisible();
  });
  it("explains an issue with no recorded clicks", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <IssueAnalyticsSummary
          analytics={{ totals: NEWSLETTER_ANALYTICS.totals, topLinks: [] }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No link clicks recorded yet.")).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
