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
});
