import type { AdCampaignPerformance } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsCampaignPerformance } from "./ads-campaign-performance";

const DAYS = [3.5, 0, 1, 0, 0, 2, 0].map((spend, index) => ({
  date: `2026-11-0${index + 1}`,
  spend,
  impressions: spend * 100,
  clicks: spend * 10,
  conversions: index === 0 ? 1.5 : 0,
}));

const PERFORMANCE: AdCampaignPerformance = {
  totals: {
    spend: 6.5,
    impressions: 650,
    clicks: 65,
    ctr: 0.1,
    cpc: 0.1,
    conversions: 1.5,
  },
  daily: DAYS,
};

function renderPerformance(
  performance: AdCampaignPerformance = PERFORMANCE,
  range: "7d" | "30d" = "7d",
) {
  const onUrlUpdate = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <AdsCampaignPerformance
          currency="EUR"
          performance={performance}
          range={range}
        />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
  return onUrlUpdate;
}

const bars = () => screen.queryAllByTestId("daily-bar");

describe("AdsCampaignPerformance", () => {
  it("shows the totals under quiet labels", () => {
    renderPerformance();

    const totals = within(screen.getByTestId("performance-totals"));
    expect(totals.getByText("Spend").nextSibling).toHaveTextContent("€6.50");
    expect(totals.getByText("Impressions").nextSibling).toHaveTextContent(
      "650",
    );
    expect(totals.getByText("Clicks").nextSibling).toHaveTextContent("65");
    expect(totals.getByText("CTR").nextSibling).toHaveTextContent("10%");
    expect(totals.getByText("CPC").nextSibling).toHaveTextContent("€0.10");
    expect(totals.getByText("Conversions").nextSibling).toHaveTextContent(
      "1.5",
    );
  });

  it("shows a dash for a CTR and CPC without clicks", () => {
    renderPerformance({
      ...PERFORMANCE,
      totals: { ...PERFORMANCE.totals, ctr: null, cpc: null },
    });

    const totals = within(screen.getByTestId("performance-totals"));
    expect(totals.getByText("CTR").nextSibling).toHaveTextContent("—");
    expect(totals.getByText("CPC").nextSibling).toHaveTextContent("—");
  });

  it("draws one bar per day", () => {
    renderPerformance();

    expect(bars()).toHaveLength(7);
  });

  it("lists every day in a table for screen readers", () => {
    renderPerformance();

    const table = screen.getByRole("table", { name: "Daily performance" });
    // A header row and a row per day.
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getByText("Nov 1")).toBeInTheDocument();
  });

  it("says so instead of drawing a chart when nothing happened", () => {
    renderPerformance({
      totals: {
        spend: 0,
        impressions: 0,
        clicks: 0,
        ctr: null,
        cpc: null,
        conversions: 0,
      },
      daily: DAYS.map((day) => ({
        ...day,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      })),
    });

    expect(screen.getByText("No activity in this period")).toBeVisible();
    expect(bars()).toHaveLength(0);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("charts spend first and switches the metric", async () => {
    const user = userEvent.setup();
    renderPerformance();

    expect(screen.getByRole("radio", { name: "Spend" })).toBeChecked();
    expect(
      screen.getByRole("group", { name: "Spend per day" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Clicks" }));

    expect(screen.getByRole("radio", { name: "Clicks" })).toBeChecked();
    expect(
      screen.getByRole("group", { name: "Clicks per day" }),
    ).toBeInTheDocument();
    expect(bars()).toHaveLength(7);
  });

  it("keeps the metric when the reader clicks it again", async () => {
    const user = userEvent.setup();
    renderPerformance();

    await user.click(screen.getByRole("radio", { name: "Spend" }));

    expect(screen.getByRole("radio", { name: "Spend" })).toBeChecked();
  });

  it("shows a day's value on hover", async () => {
    const user = userEvent.setup();
    renderPerformance();

    await user.hover(bars()[0]);

    expect(screen.getByTestId("daily-readout")).toHaveTextContent(
      "Nov 1 · €3.50",
    );
  });

  it("announces only what the keyboard picks, not the pointer's hover", async () => {
    const user = userEvent.setup();
    renderPerformance();

    await user.hover(bars()[2]);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("tells the group how the arrow keys move between days", () => {
    renderPerformance();

    expect(
      screen.getByRole("group", { name: "Spend per day" }),
    ).toHaveAccessibleDescription(
      "Use the left and right arrow keys to move between days.",
    );
  });

  it("walks the days with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPerformance();

    await user.click(screen.getByRole("group", { name: "Spend per day" }));
    expect(screen.getByRole("status")).toHaveTextContent("Nov 7 · €0.00");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");

    expect(screen.getByRole("status")).toHaveTextContent("Nov 5 · €0.00");
  });

  it("writes a new range to the URL", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = renderPerformance(PERFORMANCE, "30d");

    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "7 days" }));

    expect(onUrlUpdate.mock.calls[0][0].searchParams.get("range")).toBe("7d");
  });
});
