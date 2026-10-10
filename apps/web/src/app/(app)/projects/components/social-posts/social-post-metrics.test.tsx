import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";

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
  it("keeps a measured zero distinct from an unavailable count", () => {
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
    expect(
      screen.getByText("Likes / reactions").closest("div"),
    ).toHaveTextContent("Unavailable");
  });

  it("says when numbers have not been fetched and when a refresh failed", () => {
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
      "Failed to refresh statistics",
    );
  });

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
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing compact when every count is missing", () => {
    const { container } = render(
      <SocialPostMetrics compact statistics={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
