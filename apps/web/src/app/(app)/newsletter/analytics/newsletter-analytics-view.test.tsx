import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NEWSLETTER_ANALYTICS, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";
import { NewsletterAnalyticsView } from "./newsletter-analytics-view";

function setup(
  analytics: typeof NEWSLETTER_ANALYTICS | null = NEWSLETTER_ANALYTICS,
  searchParams = "",
  locale: "en" | "de" | "es" = "en",
) {
  const onUrlUpdate = vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ en, de, es }[locale]}
      timeZone="UTC"
      formats={{
        dateTime: { dateTime: { dateStyle: "medium", timeStyle: "short" } },
      }}
    >
      <NuqsTestingAdapter
        searchParams={searchParams}
        onUrlUpdate={onUrlUpdate}
        hasMemory
      >
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T00:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["en", "de", "es"] as const)(
    "labels unavailable and zero metrics in phone cards in %s",
    (locale) => {
      const copy = { en, de, es }[locale].App.Projects.Newsletter.Analytics;
      const issue = NEWSLETTER_ANALYTICS.issues[0]!;
      const subject = "A long campaign subject ".repeat(8);
      setup(
        {
          ...NEWSLETTER_ANALYTICS,
          issues: [
            {
              ...issue,
              subject,
              sentAt: null,
              uniqueOpens: 0,
              openRate: 0,
              uniqueClicks: 0,
              clickRate: 0,
            },
          ],
        },
        "",
        locale,
      );
      const cards = within(
        screen.getByRole("list", { name: copy.issuePerformance }),
      );
      const card = within(cards.getByRole("listitem"));
      expect(card.getByRole("link", { name: subject.trim() })).toHaveAttribute(
        "href",
        `/newsletter/issues/${issue.id}?projectId=${NEWSLETTER_PROJECT_ID}`,
      );
      expect(card.getByText(copy.sentAt).nextElementSibling).toHaveTextContent(
        copy.unavailable,
      );
      expect(
        card.getByText(copy.metrics.uniqueOpens).nextElementSibling,
      ).toHaveTextContent(/^0$/);
      expect(
        card.getByText(copy.metrics.openRate).nextElementSibling,
      ).toHaveTextContent(/^0\s?%$/);
      expect(
        card.getByText(copy.metrics.uniqueClicks).nextElementSibling,
      ).toHaveTextContent(/^0$/);
      expect(
        card.getByText(copy.metrics.unsubscribes).nextElementSibling,
      ).toHaveTextContent(copy.unavailable);
      expect(
        card.getByText(copy.metrics.clickRate).nextElementSibling,
      ).toHaveTextContent(/^0\s?%$/);
    },
  );

  it("renders metrics, daily charts and links to scoped issue details", () => {
    setup();
    const metrics = screen.getByRole("region", { name: "Newsletter metrics" });
    expect(within(metrics).getByText("50%", { exact: true })).toBeVisible();
    expect(within(metrics).getByText("25%", { exact: true })).toBeVisible();
    expect(
      screen.getByRole("figure", { name: "Active subscriber total" }),
    ).toBeVisible();
    expect(screen.getByRole("figure", { name: "Unique opens" })).toBeVisible();
    expect(
      screen.queryByText(en.App.Projects.Newsletter.Analytics.opensNote),
    ).not.toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("link", { name: "Weekly news" })).toHaveAttribute(
      "href",
      `/newsletter/issues/${NEWSLETTER_ANALYTICS.issues[0]?.id}?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    const row = table.getByRole("link", { name: "Weekly news" }).closest("tr");
    expect(row).not.toBeNull();
    if (row) expect(within(row).getAllByRole("cell")[5]).toHaveTextContent("—");
    expect(
      screen.getByText(
        en.App.Projects.Newsletter.Analytics.issueUnsubscribesNote,
      ),
    ).toBeVisible();
  });
  it("keeps the calendar and period explanation behind compact controls", async () => {
    setup();
    expect(screen.getByRole("button", { name: /^Date range/ })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(
      screen.queryByText(en.App.Projects.Newsletter.Analytics.periodNote),
    ).not.toBeInTheDocument();

    await userEvent.hover(
      screen.getByRole("button", {
        name: en.App.Projects.Newsletter.Analytics.notesAria,
      }),
    );
    const tooltip = await screen.findByRole("tooltip");
    const copy = en.App.Projects.Newsletter.Analytics;
    expect(tooltip).toHaveTextContent(copy.periodNote);
    expect(tooltip).toHaveTextContent(copy.ratesNote);
    expect(tooltip).toHaveTextContent(copy.opensNote);
  });
  it("opens the analytics notes on a phone tap", async () => {
    setup();
    await userEvent.pointer([
      {
        keys: "[TouchA]",
        target: screen.getByRole("button", {
          name: en.App.Projects.Newsletter.Analytics.notesAria,
        }),
      },
    ]);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      en.App.Projects.Newsletter.Analytics.opensNote,
    );
  });
  it.each([
    {
      locale: "de",
      range: "Zeitraum",
      previous: "Zum vorherigen Monat",
      next: "Zum nächsten Monat",
      preset: "7 Tage",
      clear: "Zeitraum löschen",
    },
    {
      locale: "es",
      range: "Intervalo de fechas",
      previous: "Ir al mes anterior",
      next: "Ir al mes siguiente",
      preset: "7 días",
      clear: "Borrar intervalo de fechas",
    },
  ] as const)(
    "localizes calendar navigation and range controls in $locale",
    async ({ locale, range, previous, next, preset, clear }) => {
      setup(NEWSLETTER_ANALYTICS, "", locale);
      await userEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${range}`) }),
      );
      const calendar = within(screen.getByRole("dialog", { name: range }));
      expect(calendar.getByRole("button", { name: previous })).toBeVisible();
      expect(calendar.getByRole("button", { name: next })).toBeVisible();
      expect(calendar.getByRole("button", { name: preset })).toBeVisible();
      expect(calendar.getByRole("button", { name: clear })).toBeVisible();
    },
  );
  it.each([
    [7, "2026-10-28"],
    [30, "2026-10-05"],
    [90, "2026-08-06"],
  ])(
    "sets the %i day preset in UTC and clears the cursor",
    async (days, from) => {
      const { onUrlUpdate } = setup(
        NEWSLETTER_ANALYTICS,
        "?from=2026-10-01&to=2026-10-02&cursor=old-page",
      );
      await userEvent.click(
        screen.getByRole("button", { name: /^Date range/ }),
      );
      await userEvent.click(
        within(screen.getByRole("dialog", { name: "Date range" })).getByRole(
          "button",
          { name: `${days} days` },
        ),
      );
      await waitFor(() =>
        expect(onUrlUpdate).toHaveBeenLastCalledWith(
          expect.objectContaining({
            queryString: `?from=${from}&to=2026-11-03`,
          }),
        ),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Date range/ }),
        ).toHaveTextContent(`Last ${days} days`),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
  it("clears both dates and the issue cursor", async () => {
    const { onUrlUpdate } = setup(
      NEWSLETTER_ANALYTICS,
      "?from=2026-10-01&to=2026-10-02&cursor=old-page",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Clear date range" }),
    );
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryString: "" }),
      ),
    );
  });
  const NO_SENDS = {
    ...NEWSLETTER_ANALYTICS,
    issues: [],
    totals: {
      ...NEWSLETTER_ANALYTICS.totals,
      sent: 0,
      delivered: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      complaints: 0,
      openRate: 0,
      clickRate: 0,
    },
    engagement: NEWSLETTER_ANALYTICS.engagement.map((day) => ({
      ...day,
      uniqueOpens: 0,
      uniqueClicks: 0,
    })),
    issuesPagination: { cursor: null, nextCursor: null, total: 0, limit: 20 },
  };
  it("leads a period with no sends with the empty state and audience metrics only", () => {
    setup(NO_SENDS);
    const title = screen.getByText("No sends in this period");
    expect(title).toBeVisible();
    expect(screen.getByRole("link", { name: "View issues" })).toHaveAttribute(
      "href",
      `/newsletter/issues?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    const metrics = screen.getByRole("region", { name: "Newsletter metrics" });
    expect(
      title.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(metrics)
        .getAllByRole("article")
        .map((metric) => metric.firstChild?.textContent),
    ).toEqual(["Active subscribers", "Unsubscribes", "Bounces"]);
    expect(
      screen.getByRole("figure", { name: "Active subscriber total" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("figure", { name: "Unique opens" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("keeps late events on older issues visible in a period with no sends", () => {
    setup({
      ...NO_SENDS,
      totals: { ...NO_SENDS.totals, uniqueOpens: 3, complaints: 1 },
      engagement: NEWSLETTER_ANALYTICS.engagement,
    });
    const metrics = screen.getByRole("region", { name: "Newsletter metrics" });
    expect(
      within(metrics)
        .getAllByRole("article")
        .map((metric) => metric.firstChild?.textContent),
    ).toEqual([
      "Active subscribers",
      "Unsubscribes",
      "Bounces",
      "Unique opens",
      "Complaints",
    ]);
    expect(screen.getByRole("figure", { name: "Unique opens" })).toBeVisible();
  });
  it.each([
    "?from=bad&to=2026-10-01&cursor=old-page",
    "?from=2026-10-02&to=2026-10-01&cursor=old-page",
    "?from=2026-02-30&to=2026-10-01&cursor=old-page",
  ])(
    "allows clearing an invalid range without showing stale metrics: %s",
    async (searchParams) => {
      const { onUrlUpdate } = setup(null, searchParams);
      expect(screen.getByRole("alert")).toHaveTextContent(
        en.App.Projects.Newsletter.Analytics.invalidRange,
      );
      expect(
        screen.queryByRole("region", { name: "Newsletter metrics" }),
      ).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: /^Date range/ }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Clear date range" }),
      );
      await waitFor(() =>
        expect(onUrlUpdate).toHaveBeenLastCalledWith(
          expect.objectContaining({ queryString: "" }),
        ),
      );
    },
  );
  it("writes a completed custom calendar range and clears the cursor", async () => {
    const { onUrlUpdate } = setup(
      NEWSLETTER_ANALYTICS,
      "?from=2026-10-01&to=2026-10-02&cursor=old-page",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    const calendar = within(screen.getByRole("dialog", { name: "Date range" }));
    await userEvent.click(
      calendar.getByRole("button", { name: /October 10th, 2026/ }),
    );
    expect(onUrlUpdate).not.toHaveBeenCalled();
    await userEvent.click(
      calendar.getByRole("button", { name: /October 14th, 2026/ }),
    );
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryString: "?from=2026-10-10&to=2026-10-14",
        }),
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("allows selecting a same-day custom range", async () => {
    const { onUrlUpdate } = setup();
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    const calendar = within(screen.getByRole("dialog", { name: "Date range" }));
    await userEvent.click(
      calendar.getByRole("button", { name: /October 10th, 2026/ }),
    );
    await userEvent.click(
      calendar.getByRole("button", { name: /October 10th, 2026/ }),
    );
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryString: "?from=2026-10-10&to=2026-10-10",
        }),
      ),
    );
  });
  it("selects a custom range with the keyboard and restores trigger focus", async () => {
    const { onUrlUpdate } = setup();
    const trigger = screen.getByRole("button", { name: /^Date range/ });
    await userEvent.click(trigger);
    const calendar = within(screen.getByRole("dialog", { name: "Date range" }));
    calendar.getByRole("button", { name: /October 10th, 2026/ }).focus();
    await userEvent.keyboard("{Enter}{ArrowRight}{ArrowRight}{Enter}");
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryString: "?from=2026-10-10&to=2026-10-12",
        }),
      ),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
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
    await userEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryString: "?from=2026-10-28&to=2026-11-03",
        }),
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
