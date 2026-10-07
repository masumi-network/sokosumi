import type { AdMarketKeyword } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsMarketKeywordList } from "./ads-market-keyword-list";

const trend = (volumes: (number | null)[]) =>
  volumes.map((searchVolume, index) => ({
    year: 2026,
    month: index + 1,
    searchVolume,
  }));

const RUNNING: AdMarketKeyword = {
  keyword: "running shoes",
  searchVolume: 12100,
  trend: trend([
    1000, 1200, 1100, 1300, 1250, 1400, 1500, 1450, 1600, 1700, 1650, 1800,
  ]),
  competition: "HIGH",
  competitionIndex: 87,
  cpc: 0.8,
  lowTopOfPageBid: 0.4,
  highTopOfPageBid: 1.2,
};
const SPARSE: AdMarketKeyword = {
  keyword: "trail shoes",
  searchVolume: null,
  trend: trend(Array.from({ length: 12 }, () => null)),
  competition: null,
  competitionIndex: null,
  cpc: null,
  lowTopOfPageBid: 0.5,
  highTopOfPageBid: null,
};

function renderKeywords(keywords: AdMarketKeyword[] = [RUNNING, SPARSE]) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsMarketKeywordList
        fetchedAt={new Date(Date.now() - 2 * 60 * 60 * 1000)}
        keywords={keywords}
      />
    </NextIntlClientProvider>,
  );
}

const table = () => within(screen.getByTestId("ads-market-keywords-table"));
const rows = () => within(screen.getByTestId("ads-market-keywords-rows"));

describe("AdsMarketKeywordList", () => {
  it("says when the data was fetched", () => {
    renderKeywords();

    expect(screen.getByText("Updated 2 hours ago")).toBeVisible();
  });

  it("lists searches, competition and a USD bid range in the table", () => {
    renderKeywords();

    const [header, running, sparse] = table().getAllByRole("row");
    // The dollar sign is on the amounts, so the header does not say USD.
    expect(header).toHaveTextContent("Top-of-page bid");
    expect(header).not.toHaveTextContent("USD");
    expect(
      within(running)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["running shoes", "12,100", "", "High", "$0.40–$1.20"]);
    expect(within(running).getByRole("img")).toHaveAccessibleName(
      "Monthly searches over 12 months, from 1,000 to 1,800",
    );
    // No volume, trend, competition or complete bid: a dash each.
    expect(
      within(sparse)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["trail shoes", "—", "—", "—", "—"]);
  });

  it("stacks keyword, searches, competition, bid and trend in rows on mobile", () => {
    renderKeywords();

    const [running, sparse] = rows().getAllByRole("listitem");
    expect(running).toHaveTextContent("running shoes");
    expect(running).toHaveTextContent("12,100 searches a month");
    expect(running).toHaveTextContent("High · $0.40–$1.20");
    expect(within(running).getByRole("img")).toBeVisible();
    expect(sparse).toHaveTextContent("— searches a month");
    expect(within(sparse).queryByRole("img")).toBeNull();
  });

  it("shows whichever of competition and bid there is on mobile, and no empty line", () => {
    renderKeywords([
      { ...SPARSE, keyword: "bid only" },
      {
        ...SPARSE,
        keyword: "competition only",
        competition: "MEDIUM",
        lowTopOfPageBid: null,
      },
      { ...SPARSE, keyword: "neither", lowTopOfPageBid: null },
    ]);

    const [bidOnly, competitionOnly, neither] = rows().getAllByRole("listitem");
    expect(bidOnly.querySelectorAll("p")).toHaveLength(2);
    expect(competitionOnly).toHaveTextContent("Medium");
    expect(competitionOnly).not.toHaveTextContent("·");
    expect(neither.querySelectorAll("p")).toHaveLength(2);
  });
});
