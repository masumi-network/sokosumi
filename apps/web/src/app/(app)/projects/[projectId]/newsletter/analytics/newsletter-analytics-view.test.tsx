import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER_ANALYTICS, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";
import { NewsletterAnalyticsView } from "./newsletter-analytics-view";

function setup(
  analytics: typeof NEWSLETTER_ANALYTICS | null = NEWSLETTER_ANALYTICS,
  searchParams = "",
) {
  const onUrlUpdate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        <NewsletterAnalyticsView
          projectId={NEWSLETTER_PROJECT_ID}
          analytics={analytics}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
  return { onUrlUpdate };
}

describe("newsletter analytics", () => {
  it("renders metrics, daily charts, limitations and links to scoped issue details", () => {
    setup();
    const metrics = screen.getByRole("region", { name: "Newsletter metrics" });
    expect(within(metrics).getByText("50%", { exact: true })).toBeVisible();
    expect(within(metrics).getByText("25%", { exact: true })).toBeVisible();
    expect(
      screen.getByRole("figure", { name: "Active subscriber total" }),
    ).toBeVisible();
    expect(screen.getByRole("figure", { name: "Unique opens" })).toBeVisible();
    expect(
      screen.getByText(en.App.Projects.Newsletter.Analytics.opensNote),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Weekly news" })).toHaveAttribute(
      "href",
      `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues/${NEWSLETTER_ANALYTICS.issues[0]?.id}`,
    );
    const row = screen.getByRole("link", { name: "Weekly news" }).closest("tr");
    expect(row).not.toBeNull();
    if (row) expect(within(row).getAllByRole("cell")[5]).toHaveTextContent("—");
    expect(
      screen.getByText(
        en.App.Projects.Newsletter.Analytics.issueUnsubscribesNote,
      ),
    ).toBeVisible();
  });
  it("updates the URL when dates or a preset change and resets the range", async () => {
    const { onUrlUpdate } = setup();
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-09-01" },
    });
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: "?from=2026-09-01" }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ searchParams: expect.any(URLSearchParams) }),
      ),
    );
    const update = onUrlUpdate.mock.lastCall?.[0];
    expect(update.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(update.searchParams.get("to")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.click(screen.getByRole("button", { name: "Reset dates" }));
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: "" }),
      ),
    );
  });
  it("shows a useful empty state and preserves subscriber growth before a first send", () => {
    setup({
      ...NEWSLETTER_ANALYTICS,
      issues: [],
      totals: { ...NEWSLETTER_ANALYTICS.totals, sent: 0 },
      issuesPagination: { cursor: null, nextCursor: null, total: 0, limit: 20 },
    });
    expect(screen.getByText("No sends in this period")).toBeVisible();
    expect(screen.getByRole("link", { name: "View issues" })).toHaveAttribute(
      "href",
      `/projects/${NEWSLETTER_PROJECT_ID}/newsletter/issues`,
    );
    expect(
      screen.getByRole("figure", { name: "Active subscriber total" }),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("allows recovery from an invalid range without showing stale metrics", () => {
    setup(null, "?from=bad&to=2026-10-01");
    expect(screen.getByRole("alert")).toHaveTextContent("Choose valid dates");
    expect(
      screen.queryByRole("region", { name: "Newsletter metrics" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset dates" })).toBeEnabled();
  });
  it("pages issues in the URL and clears the cursor when the date range changes", async () => {
    const cursor = NEWSLETTER_ANALYTICS.issues[0]!.id;
    const { onUrlUpdate } = setup({
      ...NEWSLETTER_ANALYTICS,
      issuesPagination: {
        cursor: null,
        nextCursor: cursor,
        total: 25,
        limit: 20,
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: `?cursor=${cursor}` }),
      ),
    );
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-09-01" },
    });
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: "?from=2026-09-01" }),
      ),
    );
  });
  it("allows returning to the first page when a stale issue cursor has no rows", async () => {
    const cursor = NEWSLETTER_PROJECT_ID;
    const { onUrlUpdate } = setup(
      {
        ...NEWSLETTER_ANALYTICS,
        issues: [],
        issuesPagination: { cursor, nextCursor: null, total: 1, limit: 20 },
      },
      `?cursor=${cursor}`,
    );
    expect(
      screen.queryByText("No sends in this period"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "First page" }));
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: "" }),
      ),
    );
  });
  it("keeps analytics message paths in parity and supplies real German and Spanish translations", () => {
    const english = en.App.Projects.Newsletter.Analytics;
    function flatten(object: object, prefix = ""): Record<string, string> {
      return Object.fromEntries(
        Object.entries(object).flatMap(([key, value]) =>
          typeof value === "string"
            ? [[`${prefix}${key}`, value]]
            : Object.entries(flatten(value, `${prefix}${key}.`)),
        ),
      );
    }
    const keys = flatten(english);
    for (const locale of [de, es]) {
      const translated = flatten(locale.App.Projects.Newsletter.Analytics);
      expect(Object.keys(translated)).toEqual(Object.keys(keys));
      for (const [key, value] of Object.entries(translated)) {
        if (key === "unavailable" || key === "url") continue;
        expect(value, key).not.toBe(keys[key]);
      }
    }
  });
});
