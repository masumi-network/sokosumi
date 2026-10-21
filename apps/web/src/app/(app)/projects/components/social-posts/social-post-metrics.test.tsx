import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";

import { SocialMetricTiles } from "./social-account-metrics";
import { SocialPostMetrics } from "./social-post-metrics";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useFormatter: () => createTestFormatter(),
    useTranslations: () =>
      createTranslator({
        locale: "en",
        messages: en.App.Projects.SocialPosts.statistics,
      }),
  };
});

const metrics = {
  views: 0,
  impressions: 12,
  likes: null,
  comments: 3,
  shares: null,
  saves: null,
};

describe("SocialPostMetrics", () => {
  it("keeps a measured zero and hides empty counts on Performance cards", () => {
    render(
      <SocialPostMetrics
        statistics={{
          metrics,
          fetchedAt: new Date("2026-10-08T12:00:00.000Z"),
          refreshAttemptedAt: null,
          error: null,
        }}
      />,
    );
    expect(screen.getByText("Views").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("Impressions")).toBeVisible();
    expect(screen.queryByText("Likes / reactions")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("appends extra tiles to the same definition list as the key metrics", () => {
    const { container } = render(
      <SocialPostMetrics
        statistics={{
          metrics,
          fetchedAt: null,
          refreshAttemptedAt: null,
          error: null,
        }}
        extra={
          <SocialMetricTiles
            metrics={[
              {
                key: "quote_count",
                value: 0,
                period: "lifetime",
                unit: "count",
              },
            ]}
            showLifetime={false}
          />
        }
      />,
    );
    expect(container.querySelectorAll("dl")).toHaveLength(1);
    const quotes = screen.getByText("Quotes");
    expect(quotes.closest("dl")).toBe(screen.getByText("Views").closest("dl"));
    expect(quotes.closest("div")).toHaveTextContent("0");
    expect(quotes.parentElement).toBe(quotes.closest("dl")?.lastElementChild);
  });

  it("renders extra tiles when key metrics are missing", () => {
    render(
      <SocialPostMetrics
        statistics={null}
        extra={
          <SocialMetricTiles
            metrics={[
              { key: "quote_count", value: 4, period: null, unit: "count" },
            ]}
          />
        }
      />,
    );
    expect(screen.getByText("Quotes").closest("dl")).toHaveTextContent("4");
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
  });

  it.each([true, false])(
    "ignores extra tiles in compact mode (key metrics: %s)",
    (hasMetrics) => {
      const { container } = render(
        <SocialPostMetrics
          compact
          statistics={
            hasMetrics
              ? {
                  metrics,
                  fetchedAt: null,
                  refreshAttemptedAt: null,
                  error: null,
                }
              : null
          }
          extra={
            <SocialMetricTiles
              metrics={[
                { key: "quote_count", value: 4, period: null, unit: "count" },
              ]}
            />
          }
        />,
      );
      expect(screen.queryByText("Quotes")).not.toBeInTheDocument();
      if (hasMetrics) {
        expect(screen.getByText("Views")).toBeVisible();
      } else {
        expect(container).toBeEmptyDOMElement();
      }
    },
  );

  it("says when numbers have not been fetched and when stats failed to load", () => {
    render(
      <SocialPostMetrics
        statistics={{
          metrics,
          fetchedAt: null,
          refreshAttemptedAt: new Date("2026-10-08T12:00:00.000Z"),
          error: "rate limited",
        }}
      />,
    );
    expect(screen.getByText("Statistics have not been fetched.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      en.App.Projects.SocialPosts.statistics.loadFailed,
    );
  });

  it.each([null, new Date("2026-10-08T12:00:00.000Z")])(
    "can hide the update status while retaining metrics and refresh errors (%s)",
    (fetchedAt) => {
      render(
        <SocialPostMetrics
          hideUpdatedAt
          statistics={{
            metrics,
            fetchedAt,
            refreshAttemptedAt: null,
            error: "rate limited",
          }}
        />,
      );
      expect(screen.getByText("Views").closest("div")).toHaveTextContent("0");
      expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
      expect(
        screen.queryByText("Statistics have not been fetched."),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        en.App.Projects.SocialPosts.statistics.loadFailed,
      );
    },
  );

  it("hides missing compact counts and the not-fetched line", () => {
    render(
      <SocialPostMetrics
        compact
        statistics={{
          metrics,
          fetchedAt: null,
          refreshAttemptedAt: new Date("2026-10-08T12:00:00.000Z"),
          error: "rate limited",
        }}
      />,
    );
    expect(screen.getByText("Views").closest("div")).toHaveTextContent("0");
    expect(screen.getByText("Impressions").closest("div")).toHaveTextContent(
      "12",
    );
    expect(screen.queryByText("Likes / reactions")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Statistics have not been fetched."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      en.App.Projects.SocialPosts.statistics.loadFailed,
    );
  });

  it("shows compact refresh failures even when every count is missing", () => {
    render(
      <SocialPostMetrics
        compact
        statistics={{
          metrics: {
            ...metrics,
            views: null,
            impressions: null,
            comments: null,
          },
          fetchedAt: null,
          refreshAttemptedAt: new Date("2026-10-08T12:00:00.000Z"),
          error: "rate limited",
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      en.App.Projects.SocialPosts.statistics.loadFailed,
    );
    // The line wears a small decorative icon, like the other load errors.
    expect(status.querySelector("svg[aria-hidden]")).not.toBeNull();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("renders nothing compact when every count is missing", () => {
    const { container } = render(
      <SocialPostMetrics
        compact
        statistics={{
          metrics: {
            ...metrics,
            views: null,
            impressions: null,
            comments: null,
          },
          fetchedAt: null,
          refreshAttemptedAt: null,
          error: null,
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([null, undefined])(
    "renders nothing compact when statistics are %s",
    (statistics) => {
      const { container } = render(
        <SocialPostMetrics compact statistics={statistics} />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );
});
