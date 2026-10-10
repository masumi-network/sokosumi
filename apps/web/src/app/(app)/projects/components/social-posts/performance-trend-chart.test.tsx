import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import {
  PerformanceTrendChart,
  type TrendDay,
  visibleTrendMetrics,
} from "./performance-trend-chart";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const { createTranslator } =
    await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useFormatter: () => createTestFormatter({ timeZone: "UTC" }),
    useTranslations: () =>
      createTranslator({
        locale: "en",
        messages: en.App.Projects.SocialPosts.statistics,
      }),
  };
});

const days: TrendDay[] = [
  {
    date: "2026-10-01",
    postCount: 1,
    views: null,
    impressions: 40,
    interactions: 6,
  },
  {
    date: "2026-10-02",
    postCount: 0,
    views: null,
    impressions: null,
    interactions: 2,
  },
];

describe("visibleTrendMetrics", () => {
  it("keeps impressions on X and LinkedIn and drops views until a day has one", () => {
    expect(visibleTrendMetrics(days, true)).toEqual([
      "interactions",
      "impressions",
      "postCount",
    ]);
  });

  it("keeps views on other platforms and drops impressions until a day has one", () => {
    expect(
      visibleTrendMetrics(
        [
          {
            date: "2026-10-01",
            postCount: 1,
            views: 12,
            impressions: null,
            interactions: 3,
          },
        ],
        false,
      ),
    ).toEqual(["interactions", "views", "postCount"]);
  });
});

describe("PerformanceTrendChart", () => {
  it("renders the selected-period bars and metric picker", () => {
    render(<PerformanceTrendChart days={days} impressionBased />);
    expect(
      screen.getByRole("heading", { name: "Performance over time" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Chart metric" }),
    ).toBeVisible();
    expect(screen.getByRole("figure", { name: "Interactions" })).toBeVisible();
  });
});
