import type { AdCampaign } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

// The real translator and formatter, so these tests see the shipped copy.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages,
      namespace: namespace as "App.Ads.campaigns",
    }),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));

// The row menu has its own tests; here it only has to be the row's menu.
vi.mock("./ads-campaign-actions", () => ({
  AdsCampaignActions: ({ campaign }: { campaign: AdCampaign }) => (
    <button type="button">{`menu ${campaign.name}`}</button>
  ),
}));

import { AdsCampaigns, formatObjective } from "./ads-campaigns";

const ACTIVE: AdCampaign = {
  id: "1",
  name: "Spring sale",
  status: "ACTIVE",
  objective: "SEARCH",
  dailyBudget: 25,
  spend: 1234.5,
  impressions: 12000,
  clicks: 340,
  ctr: 0.0283,
  cpc: 3.63,
  conversions: 12,
};
const PAUSED: AdCampaign = {
  ...ACTIVE,
  id: "2",
  name: "Winter promo",
  status: "PAUSED",
  objective: null,
  dailyBudget: null,
  ctr: null,
  cpc: null,
  conversions: null,
};

async function renderCampaigns(
  campaigns: AdCampaign[] = [ACTIVE, PAUSED],
  currency = "USD",
) {
  render(
    await AdsCampaigns({
      accountId: "account-1",
      campaigns,
      currency,
      projectId: "project-1",
      provider: "google_ads",
    }),
  );
}

const table = () => within(screen.getByTestId("ads-campaigns-table"));
const rows = () => within(screen.getByTestId("ads-campaigns-rows"));

describe("AdsCampaigns", () => {
  it("shows an empty state for an account without campaigns", async () => {
    await renderCampaigns([]);

    expect(screen.getByText("No campaigns in this account yet")).toBeVisible();
  });

  it("draws every column", async () => {
    await renderCampaigns();

    for (const column of [
      "Campaign",
      "Status",
      "Daily budget",
      "Spend",
      "Impressions",
      "Clicks",
      "CTR",
      "CPC",
      "Conversions",
    ]) {
      expect(
        table().getByRole("columnheader", { name: column }),
      ).toBeInTheDocument();
    }
  });

  it("formats money and CTR, with a dash for what the provider lacks", async () => {
    await renderCampaigns();

    const [, active, paused] = table().getAllByRole("row");
    expect(
      within(active)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Spring saleSearch",
      "Active",
      "$25.00",
      "$1,234.50",
      "12,000",
      "340",
      "2.83%",
      "$3.63",
      "12",
      "menu Spring sale",
    ]);
    expect(
      within(paused)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "Winter promo",
      "Paused",
      "—",
      "$1,234.50",
      "12,000",
      "340",
      "—",
      "—",
      "—",
      "menu Winter promo",
    ]);
  });

  it("hides Impressions and CPC below xl so the table fits", async () => {
    await renderCampaigns();

    for (const name of ["Impressions", "CPC"]) {
      expect(table().getByRole("columnheader", { name }).className).toContain(
        "hidden xl:table-cell",
      );
    }
    expect(
      table().getByRole("columnheader", { name: "Clicks" }).className,
    ).not.toContain("hidden");
  });

  it("formats money without decimals for JPY", async () => {
    await renderCampaigns([ACTIVE], "JPY");

    expect(table().getByText("¥1,235")).toBeInTheDocument();
  });

  it("stacks name, status, spend and clicks on small screens", async () => {
    await renderCampaigns();

    const [first] = rows().getAllByRole("listitem");
    expect(within(first).getByText("Spring sale")).toBeInTheDocument();
    expect(within(first).getByText("Active")).toBeInTheDocument();
    expect(
      within(first).getByText("Spend $1,234.50 · Clicks 340"),
    ).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "menu Spring sale" }),
    ).toBeInTheDocument();
  });
});

describe("formatObjective", () => {
  it.each([
    ["SEARCH", "Search"],
    ["OUTCOME_TRAFFIC", "Traffic"],
    ["OUTCOME_APP_PROMOTION", "App promotion"],
    ["PERFORMANCE_MAX", "Performance max"],
    ["Something new", "Something new"],
  ])("shows %s as %s", (objective, expected) => {
    expect(formatObjective(objective)).toBe(expected);
  });
});
