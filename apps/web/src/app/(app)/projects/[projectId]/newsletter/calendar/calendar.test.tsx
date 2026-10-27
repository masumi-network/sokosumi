import type { NewsletterIssue } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";
import { NewsletterCalendar } from "./calendar";
import { getMonthGridDays, getMonthGridRange, resolveMonth } from "./month";

const url = vi.fn();
const COPY = en.App.Projects.Newsletter.Calendar;
const BASE = `/projects/${NEWSLETTER_PROJECT_ID}/newsletter`;

const SCHEDULED: NewsletterIssue = {
  ...NEWSLETTER_ISSUE,
  status: "SCHEDULED",
  // 23:30 UTC is already the next day in Berlin.
  scheduledAt: new Date("2026-10-24T23:30:00Z"),
};
const SENT: NewsletterIssue = {
  ...NEWSLETTER_ISSUE,
  id: "55555555-5555-4555-8555-555555555555",
  subject: "Launch recap",
  status: "SENT",
  scheduledAt: null,
  sentAt: new Date("2026-10-05T08:00:00Z"),
};

function renderCalendar(
  issues: NewsletterIssue[] = [SCHEDULED, SENT],
  { month = "2026-10", searchParams = "?timezone=Europe/Berlin" } = {},
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      formats={{ dateTime: { time: { hour: "2-digit", minute: "2-digit" } } }}
    >
      <NuqsTestingAdapter
        searchParams={searchParams}
        onUrlUpdate={url}
        hasMemory
      >
        <NewsletterCalendar
          projectId={NEWSLETTER_PROJECT_ID}
          month={month}
          timeZone="Europe/Berlin"
          today="2026-10-27"
          issues={issues}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => url.mockReset());

describe("newsletter calendar", () => {
  it("shows each issue on its local delivery day with time, subject, status and link", () => {
    renderCalendar();
    const day = screen.getByTestId("newsletter-calendar-day-2026-10-25");
    const link = within(day).getByRole("link");
    expect(link).toHaveAttribute("href", `${BASE}/issues/${SCHEDULED.id}`);
    expect(link).toHaveTextContent("01:30");
    expect(link).toHaveTextContent("Weekly news");
    expect(link).toHaveTextContent("Scheduled");
    expect(
      within(
        screen.getByTestId("newsletter-calendar-day-2026-10-24"),
      ).queryByRole("link"),
    ).toBeNull();
    const sent = screen.getByTestId("newsletter-calendar-day-2026-10-05");
    expect(sent).toHaveTextContent("Launch recap");
    expect(sent).toHaveTextContent("Sent");
    expect(sent).toHaveTextContent("10:00");
    expect(
      screen.getByTestId("newsletter-calendar-day-2026-10-27"),
    ).toHaveAttribute("aria-current", "date");
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeVisible();
  });

  it("shows a friendly empty state that points to the issues", () => {
    renderCalendar([]);
    expect(screen.getByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: COPY.viewIssues })).toHaveAttribute(
      "href",
      `${BASE}/issues`,
    );
    expect(screen.queryByTestId(/newsletter-calendar-day-/)).toBeNull();
  });

  it("navigates months across year boundaries and back to today", () => {
    renderCalendar([], { month: "2027-01" });
    const nav = screen.getByRole("navigation", { name: COPY.navigation });
    expect(
      within(nav).getByRole("link", { name: COPY.previous }),
    ).toHaveAttribute(
      "href",
      `${BASE}/calendar?month=2026-12&timezone=Europe%2FBerlin`,
    );
    expect(within(nav).getByRole("link", { name: COPY.next })).toHaveAttribute(
      "href",
      `${BASE}/calendar?month=2027-02&timezone=Europe%2FBerlin`,
    );
    expect(within(nav).getByRole("link", { name: COPY.today })).toHaveAttribute(
      "href",
      `${BASE}/calendar?timezone=Europe%2FBerlin`,
    );
  });

  it("asks the server for the browser's time zone when the URL has none", async () => {
    renderCalendar([], { searchParams: "" });
    await waitFor(() =>
      expect(url.mock.lastCall?.[0].searchParams.get("timezone")).toBeTruthy(),
    );
  });
});

describe("newsletter calendar month", () => {
  it("covers whole Sunday-first weeks and their local midnights", () => {
    const days = getMonthGridDays("2026-10");
    expect(days[0]).toBe("2026-09-27");
    expect(days.at(-1)).toBe("2026-10-31");
    expect(days).toHaveLength(35);
    expect(getMonthGridRange("2026-10", "Europe/Berlin")).toEqual({
      from: new Date("2026-09-26T22:00:00Z"),
      to: new Date("2026-10-31T23:00:00Z"),
    });
  });

  it("accepts only YYYY-MM and otherwise opens the current month", () => {
    expect(resolveMonth("2026-02", "UTC")).toBe("2026-02");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T23:30:00Z"));
    expect(resolveMonth("2026-13", "UTC")).toBe("2026-10");
    expect(resolveMonth(null, "Europe/Berlin")).toBe("2026-11");
    vi.useRealTimers();
  });
});
