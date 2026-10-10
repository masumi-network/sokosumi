import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/../messages/en.json";
import { PostingConsistency } from "./posting-consistency";

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

function yearDays() {
  const days = [];
  for (
    let time = Date.parse("2025-10-12T00:00:00Z");
    time <= Date.parse("2026-10-10T00:00:00Z");
    time += 86_400_000
  ) {
    const date = new Date(time).toISOString().slice(0, 10);
    days.push({ date, posts: 1, engagement: 2 });
  }
  return days;
}

describe("PostingConsistency", () => {
  it("draws a GitHub-style week grid with month and weekday labels", () => {
    render(
      <PostingConsistency
        days={yearDays()}
        selectedFrom="2026-09-10"
        selectedUntil="2026-10-10"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Posting consistency" }),
    ).toBeVisible();
    expect(screen.getByText("Posts per day")).toBeVisible();
    expect(screen.getByText("Engagement per day")).toBeVisible();
    expect(screen.getByText("Current streak")).toBeVisible();
    expect(screen.getByText("Longest streak")).toBeVisible();
    expect(screen.getByText("None")).toBeVisible();
    expect(screen.getByText("More")).toBeVisible();
    expect(screen.getByText("Mon")).toBeVisible();
    expect(screen.getByText("Wed")).toBeVisible();
    expect(screen.getByText("Fri")).toBeVisible();
    expect(screen.getByText("Nov")).toBeVisible();
    expect(screen.getByText("Oct")).toBeVisible();
  });
});
