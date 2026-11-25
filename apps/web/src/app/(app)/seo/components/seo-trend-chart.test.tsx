import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import german from "../../../../../messages/de.json";
import messages from "../../../../../messages/en.json";
import { SeoTrendChart } from "./seo-trend-chart";

describe("SEO trend chart Google updates", () => {
  it.each([true, false])(
    "uses the chart's report language for its table and dates (report=%s)",
    (report) => {
      const catalog = report ? messages : german;
      render(
        <NextIntlClientProvider locale="de" messages={german} timeZone="UTC">
          <SeoResultMessagesProvider messages={messages.App.Seo}>
            <SeoTrendChart
              report={report}
              points={[
                { date: "2026-12-03", value: 7 },
                { date: "2026-12-04", value: 8 },
              ]}
              series={{ source: "serp", key: "position" }}
              unit="position"
              label="SERP"
              formatValue={String}
              unavailable="?"
            />
          </SeoResultMessagesProvider>
        </NextIntlClientProvider>,
      );
      expect(
        screen.getByRole("columnheader", {
          name: catalog.App.Seo.overview.day,
        }),
      ).toBeInTheDocument();
      const date = new Intl.DateTimeFormat(report ? "en" : "de", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date("2026-12-03T12:00:00Z"));
      expect(screen.getByRole("cell", { name: date })).toBeInTheDocument();
    },
  );
  it("marks a read outside the results and names it in the table", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SeoResultMessagesProvider messages={messages.App.Seo}>
          <SeoTrendChart
            points={[
              { date: "2026-12-03", value: 7 },
              { date: "2026-12-10", value: null, outside: { top: 20 } },
              { date: "2026-12-17", value: null },
            ]}
            series={{ source: "serp", key: "position" }}
            unit="position"
            label="SERP"
            formatValue={String}
            unavailable="No read"
            outsideLabel={(top) => `Not in the top ${top}`}
            joinReads
          />
        </SeoResultMessagesProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByTestId("seo-trend-outside")).toHaveLength(1);
    // The line sits where the band starts, over the mark, not through it.
    const line = screen.getByTestId("seo-trend-outside-line");
    expect(line).toHaveAttribute("y1", "85");
    expect(line).toHaveAttribute("y2", "85");
    // Chosen with the keyboard, the mark stays hollow and the readout names the read.
    const plot = screen.getByRole("group", { name: "SERP" });
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("status")).toHaveTextContent("Not in the top 20");
    expect(screen.getAllByTestId("seo-trend-outside")).toHaveLength(1);
    expect(screen.queryAllByTestId("seo-trend-dot")).toHaveLength(1);
    expect(
      screen.getByRole("cell", { name: "Not in the top 20" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "No read" })).toBeInTheDocument();
  });
  it("says an update that has no end on the as-of day is still rolling out", () => {
    // 2026-11-08 to 2026-11-15: the November 2026 core update started on 2026-11-10, with no end on 2026-11-13.
    const points = Array.from({ length: 8 }, (_, index) => ({
      date: `2026-11-${String(8 + index).padStart(2, "0")}`,
      value: 1,
    }));
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTrendChart
          points={points}
          unit="count"
          label="Search clicks"
          formatValue={String}
          unavailable="No data"
          series={{ source: "search_console", key: "clicks" }}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("November 2026 core update: since Nov 10"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Google updates known until Nov 13, 2026"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/to Nov 13/)).toBeNull();
  });

  it("keeps both years for an update that crosses a year boundary", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTrendChart
          points={[
            { date: "2025-05-13", value: 1 },
            { date: "2026-04-27", value: 1 },
          ]}
          unit="count"
          label="Search impressions"
          formatValue={String}
          unavailable="No data"
          series={{ source: "search_console", key: "impressions" }}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        "Impressions logging error: May 13, 2025 to Apr 27, 2026",
      ),
    ).toBeInTheDocument();
  });
});

describe("SEO trend chart site events", () => {
  it("names an event after the newest reported day in words, and every day in the table", () => {
    render(
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <SeoTrendChart
          points={[
            { date: "2026-03-01", value: 2 },
            { date: "2026-03-02", value: 3 },
          ]}
          unit="count"
          label="Search clicks"
          formatValue={String}
          unavailable="No data"
          series={{ source: "ga4", key: "sessions" }}
          markers={[
            { date: "2026-03-02", kind: "task", label: "Shorten the title" },
            { date: "2026-03-02", kind: "audit", label: "" },
            {
              date: "2026-03-04",
              kind: "verified",
              label: "Shorten the title",
            },
          ]}
        />
      </NextIntlClientProvider>,
    );
    // Google has not reported Mar 4 yet: no icon, but the confirmation is still named.
    expect(screen.getAllByTestId("seo-trend-marker")).toHaveLength(1);
    // Mar 2 draws the Task icon, so the key names the Task and not the audit of that day.
    expect(screen.getByText("Task done")).toBeVisible();
    expect(screen.queryByText("Audit")).toBeNull();
    expect(
      screen.getByText(
        "Mar 4 (no search data yet): Fix confirmed: Shorten the title",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("row", {
        name: "Mar 2 3 Task done: Shorten the title and Audit",
      }),
    ).toBeInTheDocument();
  });
});
