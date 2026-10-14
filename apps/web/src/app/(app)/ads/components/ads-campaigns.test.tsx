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
  provider: "google_ads" | "meta_ads" = "google_ads",
) {
  render(
    await AdsCampaigns({
      accountId: "account-1",
      campaigns,
      currency,
      projectId: "project-1",
      provider,
      range: "7d",
    }),
  );
}

const table = () => within(screen.getByTestId("ads-campaigns-table"));
const rows = () => within(screen.getByTestId("ads-campaigns-rows"));

describe("AdsCampaigns", () => {
  it("shows an empty state for an account without campaigns", async () => {
    await renderCampaigns([]);

    expect(screen.getByText("No campaigns in this account yet")).toBeVisible();
    expect(
      screen.getByText("Create one with New campaign. It starts paused."),
    ).toBeVisible();
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
      "Actions",
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
      within(first).getByText("Spend $1,234.50 · clicks 340"),
    ).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "menu Spring sale" }),
    ).toBeInTheDocument();
  });
});

describe("AdsCampaigns names", () => {
  it("link a Google campaign to its details, keeping project, account and range", async () => {
    await renderCampaigns();

    expect(table().getByRole("link", { name: "Spring sale" })).toHaveAttribute(
      "href",
      "/ads/campaigns/1?projectId=project-1&accountId=account-1&range=7d",
    );
    expect(rows().getByRole("link", { name: "Winter promo" })).toHaveAttribute(
      "href",
      "/ads/campaigns/2?projectId=project-1&accountId=account-1&range=7d",
    );
  });

  it("stay plain text for a Meta campaign", async () => {
    await renderCampaigns([ACTIVE], "USD", "meta_ads");

    expect(screen.queryByRole("link")).toBeNull();
    expect(table().getByText("Spring sale")).toBeInTheDocument();
  });
});

describe("formatObjective", () => {
  const tObjectives = createTranslator({
    locale: "en",
    messages,
    namespace: "App.Ads.newCampaign.objectives",
  });

  it.each([
    ["SEARCH", "Search"],
    ["OUTCOME_TRAFFIC", "Traffic"],
    ["OUTCOME_APP_PROMOTION", "App promotion"],
    ["PERFORMANCE_MAX", "Performance max"],
    ["Something new", "Something new"],
  ])("shows %s as %s", (objective, expected) => {
    expect(formatObjective(objective, (key) => tObjectives(key))).toBe(
      expected,
    );
  });
});
