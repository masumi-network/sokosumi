import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { dateTimeMock } = vi.hoisted(() => ({
  dateTimeMock: vi.fn((value: Date) => value.toISOString().slice(5, 10)),
}));

vi.mock("next-intl/server", () => ({
  getFormatter: vi.fn(async () => ({ dateTime: dateTimeMock })),
  getTranslations: vi.fn(async () => {
    const messages: Record<string, string> = {
      avgScore: "Avg score",
      chartLabel: "Quality over time",
      description: "Quality description",
      labJudge: "Lab judge",
      labPassRate: "Lab pass",
      labRuns: "Lab runs",
      legendScore: "Judge score (1–5)",
      legendThumbsDown: "Thumbs down (count)",
      legendThumbsUp: "Thumbs up (count)",
      overall: "Overall",
      proactive: "Proactive",
      realRunsByVersion: "Real usage by version",
      thumbs: "Thumbs",
      title: "Quality",
      turns: "Turns",
      version: "Version",
    };
    return (key: string) => messages[key] ?? key;
  }),
}));

vi.mock("@/components/admin/soko-bots/quality-version-filter.client", () => ({
  QualityVersionFilter: () => null,
}));

import { QualityOverview } from "@/components/admin/soko-bots/quality-overview";
import type { AdminSokoBotQuality } from "@/lib/clients/generated/core";

function qualityFixture(): AdminSokoBotQuality {
  return {
    overall: { turns: 30, judged: 30, avgScore: 4 },
    proactive: { sent: 8, actedOn: 3, thumbsUp: 4, thumbsDown: 2 },
    daily: Array.from({ length: 30 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      turns: 1,
      avgScore: index % 2 === 0 ? 4 : 3,
      thumbsUp: index === 5 ? 4 : 0,
      thumbsDown: index === 10 ? 3 : 0,
    })),
    versions: [
      {
        versionId: "test-v1",
        name: "Test one",
        turns: 20,
        avgScore: 4,
      },
      {
        versionId: "test-v2",
        name: "Test two",
        turns: 10,
        avgScore: 3,
      },
    ],
  };
}

describe("QualityOverview", () => {
  it("renders localized date ticks and distinct score, thumbs-up, and thumbs-down series", async () => {
    const { container } = render(
      await QualityOverview({ quality: qualityFixture() }),
    );

    expect(
      screen.getByRole("img", { name: "Quality over time" }),
    ).toBeInTheDocument();
    expect(screen.getByText("08-01")).toBeInTheDocument();
    expect(screen.getByText("08-30")).toBeInTheDocument();
    expect(screen.getByText("Judge score (1–5)")).toBeInTheDocument();
    expect(screen.getByText("Thumbs up (count)")).toBeInTheDocument();
    expect(screen.getByText("Thumbs down (count)")).toBeInTheDocument();

    expect(container.querySelectorAll("polyline")).toHaveLength(3);
    expect(container.querySelector('[data-series="thumbs-up"]')).toHaveClass(
      "stroke-semantic-success",
    );
    expect(container.querySelector('[data-series="thumbs-down"]')).toHaveClass(
      "stroke-semantic-destructive",
    );
  });

  it("shows only the selected version in the quality table", async () => {
    render(
      await QualityOverview({
        quality: qualityFixture(),
        selectedVersionId: "test-v2",
      }),
    );

    expect(screen.getByText("Test two")).toBeInTheDocument();
    expect(screen.queryByText("Test one")).not.toBeInTheDocument();
  });

  it("keeps the version table focused on real usage", async () => {
    render(await QualityOverview({ quality: qualityFixture() }));

    expect(screen.getByText("Real usage by version")).toBeInTheDocument();
    expect(screen.queryByText("Lab runs")).not.toBeInTheDocument();
    expect(screen.queryByText("Lab pass")).not.toBeInTheDocument();
    expect(screen.queryByText("Lab judge")).not.toBeInTheDocument();
  });
});
