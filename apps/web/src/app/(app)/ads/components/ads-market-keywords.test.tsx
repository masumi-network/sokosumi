import type { AdMarketKeyword } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { listMarketKeywordsMock } = vi.hoisted(() => ({
  listMarketKeywordsMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages,
      namespace: namespace as "App.Ads.market.keywords",
    }),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));

vi.mock("@/lib/services/ads.service", () => ({
  adsService: { listMarketKeywords: listMarketKeywordsMock },
}));

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

vi.mock("./ads-market-error", () => ({
  AdsMarketError: ({ kind, section }: { kind: string; section: string }) => (
    <div data-testid="error">{`${section}:${kind}`}</div>
  ),
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { AdsMarketKeywords } from "./ads-market-keywords";

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

async function renderKeywords(keywords: AdMarketKeyword[] = [RUNNING, SPARSE]) {
  listMarketKeywordsMock.mockResolvedValue({
    keywords,
    fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
  });
  render(await AdsMarketKeywords({ projectId: "project-1" }));
}

const table = () => within(screen.getByTestId("ads-market-keywords-table"));
const rows = () => within(screen.getByTestId("ads-market-keywords-rows"));

describe("AdsMarketKeywords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says when the data was fetched", async () => {
    await renderKeywords();

    expect(listMarketKeywordsMock).toHaveBeenCalledWith("project-1");
    expect(screen.getByText("Updated 2 hours ago")).toBeVisible();
  });

  it("lists searches, competition and a USD bid range in the table", async () => {
    await renderKeywords();

    const [, running, sparse] = table().getAllByRole("row");
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

  it("stacks keyword, searches and trend in rows on mobile", async () => {
    await renderKeywords();

    const [running, sparse] = rows().getAllByRole("listitem");
    expect(running).toHaveTextContent("running shoes");
    expect(running).toHaveTextContent("12,100 searches a month");
    expect(within(running).getByRole("img")).toBeVisible();
    expect(sparse).toHaveTextContent("— searches a month");
    expect(within(sparse).queryByRole("img")).toBeNull();
  });

  it("is a calm empty state when the market has no keywords", async () => {
    await renderKeywords([]);

    expect(
      screen.getByText("No trending keywords found for this market"),
    ).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it.each([
    [{ status: 503, kind: "integration_not_configured" }, "unavailable"],
    [{ status: 502 }, "failed"],
    [{ status: 404 }, "failed"],
  ])("shows %o as its own %s state", async (details, kind) => {
    listMarketKeywordsMock.mockRejectedValue(
      new CoreApiRequestError("x", details),
    );

    render(await AdsMarketKeywords({ projectId: "project-1" }));

    expect(screen.getByTestId("error")).toHaveTextContent(`keywords:${kind}`);
  });

  it("lets a failure that is not Core's reach the route's error boundary", async () => {
    listMarketKeywordsMock.mockRejectedValue(new Error("session lost"));

    await expect(AdsMarketKeywords({ projectId: "project-1" })).rejects.toThrow(
      "session lost",
    );
  });
});
