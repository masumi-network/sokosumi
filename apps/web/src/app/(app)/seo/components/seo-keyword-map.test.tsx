import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoKeywordMap } from "./seo-keyword-map";
import { keywordGroups } from "./seo-keyword-rows-model";

type Keyword = ProjectSeoWorkspace["keywords"][number];

afterEach(cleanup);

let next = 0;
function row(patch: Partial<Keyword>): Keyword {
  next += 1;
  return {
    id: `k${next}`,
    keyword: `keyword ${next}`,
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: false,
    countryCode: "US",
    languageCode: "en",
    source: "focus",
    volume: null,
    difficulty: null,
    clicks: null,
    intent: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: "medium",
    version: 0,
    ...patch,
  };
}

function renderMap(rows: Keyword[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoKeywordMap groups={keywordGroups(rows)} />
    </NextIntlClientProvider>,
  );
}

describe("SEO keyword map", () => {
  it("gives a keyword's numbers from the keyboard, and the same numbers in the table", async () => {
    const user = userEvent.setup();
    renderMap([
      row({
        keyword: "battery app",
        volume: 1000,
        difficulty: 12.4,
        position: 15,
        positionStatus: "ranked",
        observationId: "o1",
        observedAt: new Date("2026-11-01T00:00:00.000Z"),
        clicks: { now: 7, top10: 8, top3: 60, top1: 194 },
      }),
      row({
        keyword: "battery health",
        source: "gap",
        volume: 5000,
        difficulty: 70,
        clicks: { now: 0, top10: 41, top3: 301, top1: 969 },
      }),
    ]);
    const map = screen.getByRole("group", { name: "Keyword opportunities" });
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    map.focus();
    await user.keyboard("{ArrowRight}");
    // The easiest keyword comes first.
    const card = screen.getByTestId("seo-keyword-card");
    expect(card.textContent).toContain("battery app");
    expect(card.textContent).toContain("1,000 searches a month");
    expect(card.textContent).toContain("Difficulty 12 of 100");
    expect(card.textContent).toContain("Position 15");
    expect(card.textContent).toContain("Top 10: +1 click a month");
    expect(card.textContent).toContain("Top 3: +53 clicks a month");
    expect(screen.getByRole("status").textContent).toContain("battery app");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("seo-keyword-card").textContent).toContain(
      "Top 3: +301 clicks a month",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("seo-keyword-card")).toBeNull();
    // The table gives every number without a pointer, the most extra clicks first.
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((item) => item.textContent)).toEqual([
      "KeywordSearches a monthDifficultyExtra clicks at top 3",
      "battery health · Idea5,00070301",
      "battery app1,0001253",
    ]);
  });

  it("is not there without difficulty, as for a check from before it", () => {
    const { container } = renderMap([
      row({ volume: 1000 }),
      row({ volume: 2000 }),
    ]);
    expect(container.textContent).toBe("");
  });
});
