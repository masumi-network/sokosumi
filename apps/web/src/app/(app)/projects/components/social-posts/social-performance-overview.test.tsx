import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import { SocialPerformanceOverview } from "./social-performance-overview";

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

describe("SocialPerformanceOverview", () => {
  it("renders a compact 2x2 metric grid with period deltas", () => {
    render(
      <SocialPerformanceOverview
        impressionBased
        headline={{
          current: {
            postCount: 12,
            views: null,
            impressions: 400,
            interactions: 18,
          },
          deltas: {
            postCount: 2,
            views: null,
            impressions: -20,
            interactions: 3,
          },
          daily: [
            {
              date: "2026-10-01",
              postCount: 4,
              views: null,
              impressions: 100,
              interactions: 6,
            },
            {
              date: "2026-10-02",
              postCount: 8,
              views: null,
              impressions: 300,
              interactions: 12,
            },
          ],
        }}
      />,
    );
    const overview = screen.getByTestId("social-performance-overview");
    expect(overview.querySelector(".grid-cols-2")).not.toBeNull();
    expect(screen.getByText("Posts")).toBeVisible();
    expect(screen.getByText("Impressions")).toBeVisible();
    expect(screen.getByText("Interactions")).toBeVisible();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.getByText("12")).toBeVisible();
    expect(
      screen.getAllByTitle("Change from the previous publication period")
        .length,
    ).toBeGreaterThan(0);
  });
});
