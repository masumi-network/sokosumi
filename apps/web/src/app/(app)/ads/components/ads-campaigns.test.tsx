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

const rows = () => screen.getAllByTestId("ads-campaign-row");

/** A row's figures as label → value, in the order shown. */
function figures(row: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(row)
      .getAllByRole("term")
      .map((term) => [
        term.textContent,
        term.nextElementSibling?.textContent ?? "",
      ]),
  );
}

describe("AdsCampaigns", () => {
  it("shows an empty state for an account without campaigns", async () => {
    await renderCampaigns([]);

    expect(screen.getByText("No campaigns in this account yet")).toBeVisible();
    expect(
      screen.getByText("Create one with New campaign. It starts paused."),
    ).toBeVisible();
  });

  it("draws one row card per campaign with its name, status and menu", async () => {
    await renderCampaigns();

    const [active, paused] = rows();
    expect(rows()).toHaveLength(2);
    expect(within(active).getByText("Spring sale")).toBeInTheDocument();
    expect(within(active).getByText("Active")).toBeInTheDocument();
    expect(within(paused).getByText("Paused")).toBeInTheDocument();
    // One menu per row, at every width.
    expect(
      within(active).getAllByRole("button", { name: "menu Spring sale" }),
    ).toHaveLength(1);
  });

  it("says what kind of campaign it is and its budget per day", async () => {
    await renderCampaigns();

    const [active, paused] = rows();
    expect(within(active).getByText("Search · $25.00/day")).toBeInTheDocument();
    // Neither an objective nor a budget: no line at all.
    expect(within(paused).queryByText(/\/day/)).toBeNull();
  });

  it("formats money and CTR, with a dash for what the provider lacks", async () => {
    await renderCampaigns();

    const [active, paused] = rows();
    expect(figures(active)).toEqual({
      Spend: "$1,234.50",
      Impressions: "12,000",
      Clicks: "340",
      CTR: "2.83%",
      CPC: "$3.63",
      Conversions: "12",
    });
    expect(figures(paused)).toEqual({
      Spend: "$1,234.50",
      Impressions: "12,000",
      Clicks: "340",
      CTR: "—",
      CPC: "—",
      Conversions: "—",
    });
  });

  it("keeps spend, clicks and CTR on a phone and the rest from sm", async () => {
    await renderCampaigns();

    const [row] = rows();
    for (const label of ["Impressions", "CPC", "Conversions"]) {
      expect(within(row).getByText(label).parentElement?.className).toContain(
        "hidden sm:flex",
      );
    }
    for (const label of ["Spend", "Clicks", "CTR"]) {
      expect(
        within(row).getByText(label).parentElement?.className,
      ).not.toContain("hidden");
    }
  });

  it("formats money without decimals for JPY", async () => {
    await renderCampaigns([ACTIVE], "JPY");

    expect(figures(rows()[0]).Spend).toBe("¥1,235");
  });
});

describe("AdsCampaigns names", () => {
  it("link a Google campaign to its details, keeping project, account and range", async () => {
    await renderCampaigns();

    expect(screen.getByRole("link", { name: "Spring sale" })).toHaveAttribute(
      "href",
      "/ads/campaigns/1?projectId=project-1&accountId=account-1&range=7d",
    );
    expect(screen.getByRole("link", { name: "Winter promo" })).toHaveAttribute(
      "href",
      "/ads/campaigns/2?projectId=project-1&accountId=account-1&range=7d",
    );
  });

  it("stay plain text for a Meta campaign", async () => {
    await renderCampaigns([ACTIVE], "USD", "meta_ads");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Spring sale")).toBeInTheDocument();
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
