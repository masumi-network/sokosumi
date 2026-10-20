import type { SocialAccountMetric } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/../messages/en.json";
import {
  SocialAccountMetrics,
  SocialMetricTiles,
} from "./social-account-metrics";

function renderMetrics(metrics: SocialAccountMetric[], showLifetime = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SocialAccountMetrics metrics={metrics} showLifetime={showLifetime} />
    </NextIntlClientProvider>,
  );
}

describe("SocialAccountMetrics", () => {
  it.each([
    ["quote_count", "Quotes"],
    ["dislikeCount", "Dislikes"],
    ["ig_reels_video_view_total_time", "Total watch time"],
    ["ig_reels_avg_watch_time", "Average watch time"],
    ["reels_skip_rate", "Skip rate"],
    ["facebook_views", "Facebook views"],
    ["crossposted_views", "Crossposted views"],
    ["post_activity_by_action_type", "Actions"],
    ["post_media_view", "Views"],
    ["post_total_media_view_unique", "Reach"],
    ["reach", "Reach"],
    ["total_interactions", "Interactions"],
    ["reposts", "Reposts"],
    ["url_clicks", "Link clicks"],
  ])("translates the imported post metric %s as %s", (key, label) => {
    renderMetrics(
      [{ key, value: 0, period: "lifetime", unit: "count" }],
      false,
    );
    expect(screen.getByText(label).closest("div")).toHaveTextContent("0");
    expect(screen.queryByText("Lifetime")).not.toBeInTheDocument();
  });

  it("retains period captions for account-level metrics", () => {
    const { container } = renderMetrics([
      { key: "followers_count", value: 10, period: "lifetime", unit: "count" },
      { key: "reach", value: 20, period: "days_28", unit: "count" },
    ]);
    expect(screen.getByText("Lifetime")).toBeVisible();
    expect(screen.getByText("Last 28 days")).toBeVisible();
    expect(container.querySelectorAll("dl")).toHaveLength(1);
    expect(screen.getByText("Followers").closest("dl")?.children).toHaveLength(
      2,
    );
  });

  it("exports only dt/dd tile groups for use inside another definition list", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <dl>
          <SocialMetricTiles
            metrics={[
              {
                key: "quote_count",
                value: 0,
                period: "lifetime",
                unit: "count",
              },
              { key: "reach", value: 20, period: "days_28", unit: "count" },
            ]}
            showLifetime={false}
          />
        </dl>
      </NextIntlClientProvider>,
    );
    expect(container.querySelectorAll("dl")).toHaveLength(1);
    const grid = screen.getByText("Quotes").closest("dl");
    expect(grid?.children).toHaveLength(2);
    expect(screen.getByText("Quotes").closest("div")).toHaveTextContent("0");
    for (const tile of grid?.children ?? []) {
      expect(tile.tagName).toBe("DIV");
      expect(tile.firstElementChild?.tagName).toBe("DT");
      expect(tile.lastElementChild?.tagName).toBe("DD");
    }
    expect(screen.queryByText("Lifetime")).not.toBeInTheDocument();
    expect(screen.getByText("Last 28 days")).toBeVisible();
  });

  it("converts milliseconds to readable seconds and percent to a symbol", () => {
    renderMetrics(
      [
        {
          key: "ig_reels_avg_watch_time",
          value: 12500,
          period: null,
          unit: "milliseconds",
        },
        { key: "reels_skip_rate", value: 12.5, period: null, unit: "percent" },
      ],
      false,
    );
    expect(
      screen.getByText("Average watch time").closest("div"),
    ).toHaveTextContent("12.5seconds");
    expect(screen.getByText("Skip rate").closest("div")).toHaveTextContent(
      "12.5%",
    );
    expect(screen.queryByText("milliseconds")).not.toBeInTheDocument();
    expect(screen.queryByText("percent")).not.toBeInTheDocument();
  });

  it("shows unavailable values without units", () => {
    renderMetrics([
      {
        key: "ig_reels_avg_watch_time",
        value: null,
        period: null,
        unit: "milliseconds",
      },
    ]);
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("seconds")).not.toBeInTheDocument();
  });

  it("capitalizes the humanized label for a genuinely unknown metric", () => {
    renderMetrics([
      { key: "new_metricCount", value: 5, period: null, unit: null },
    ]);
    expect(screen.getByText("New metric Count")).toBeVisible();
  });
});
