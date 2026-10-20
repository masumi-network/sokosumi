import type { AdCampaignDetails } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

// The menu and the performance block have their own tests.
vi.mock("./ads-campaign-actions", () => ({
  AdsCampaignActions: ({ campaign }: { campaign: { name: string } }) => (
    <button type="button">{`menu ${campaign.name}`}</button>
  ),
}));
vi.mock("./ads-campaign-performance", () => ({
  AdsCampaignPerformance: ({ range }: { range: string }) => (
    <div data-testid="performance">{range}</div>
  ),
}));

import { AdsCampaignDetails as AdsCampaignDetailsView } from "./ads-campaign-details";

const SEARCH: AdCampaignDetails = {
  campaign: {
    id: "42",
    name: "Spring sale",
    status: "PAUSED",
    type: "SEARCH",
    channelType: "SEARCH",
    dailyBudget: 1,
    currency: "EUR",
    biddingStrategyType: "TARGET_SPEND",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    started: true,
    editable: true,
    notEditableReason: null,
  },
  targeting: {
    locations: [
      {
        id: "2276",
        name: "Germany",
        canonicalName: "Germany",
        targetType: "Country",
        countryCode: "DE",
      },
      {
        id: "1003854",
        name: "Berlin",
        canonicalName: "Berlin,Berlin,Germany",
        targetType: "City",
        countryCode: "DE",
      },
    ],
    languages: [{ id: "1001", code: "de", name: "German" }],
  },
  keywords: [
    {
      id: "1",
      text: "running shoes",
      matchType: "BROAD",
      status: "ENABLED",
      approvalStatus: "APPROVED",
    },
    {
      id: "2",
      text: "trail shoes",
      matchType: "PHRASE",
      status: "ENABLED",
      approvalStatus: "DISAPPROVED",
    },
    {
      id: "3",
      text: "buy shoes online",
      matchType: "EXACT",
      status: "ENABLED",
      approvalStatus: null,
    },
  ],
  ad: {
    id: "9",
    status: "ENABLED",
    approvalStatus: "APPROVED",
    reviewStatus: "REVIEWED",
    adStrength: "GOOD",
    finalUrl: "https://www.example.com/shoes",
    search: {
      headlines: ["Fast running shoes", "Free delivery", "Shop the sale"],
      descriptions: ["Find your next pair.", "Returns within 30 days."],
      path1: "shoes",
      path2: "sale",
    },
  },
  sitelinks: [],
  callouts: [],
  performance: {
    totals: {
      spend: 0,
      impressions: 0,
      clicks: 0,
      ctr: null,
      cpc: null,
      conversions: 0,
    },
    daily: [],
  },
};

const DISPLAY: AdCampaignDetails = {
  ...SEARCH,
  campaign: { ...SEARCH.campaign, type: "DISPLAY", channelType: "DISPLAY" },
  keywords: [],
  ad: {
    id: "10",
    status: "ENABLED",
    approvalStatus: "APPROVED",
    reviewStatus: null,
    adStrength: null,
    finalUrl: "https://www.example.com/shoes",
    display: {
      businessName: "Shoe Shop",
      headlines: ["Run further"],
      longHeadline: "Run further in shoes made for the trail",
      descriptions: ["Find your next pair."],
      images: [
        {
          assetId: "a1",
          role: "LANDSCAPE",
          url: "https://tpc.googlesyndication.com/landscape.png",
          width: 1200,
          height: 628,
        },
        {
          assetId: "a2",
          role: "LOGO",
          url: "https://tpc.googlesyndication.com/logo.png",
          width: 128,
          height: 128,
        },
      ],
    },
  },
};

function renderDetails(details: AdCampaignDetails = SEARCH) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsCampaignDetailsView
        accountId="account-1"
        details={details}
        projectId="project-1"
        range="7d"
      />
    </NextIntlClientProvider>,
  );
}

const section = (name: string) => within(screen.getByRole("region", { name }));

describe("AdsCampaignDetails", () => {
  it("heads the page with the name, one line of facts and the menu", () => {
    renderDetails();

    expect(
      screen.getByRole("heading", { level: 1, name: "Spring sale" }),
    ).toBeVisible();
    expect(screen.getByText("Search · Paused · €1.00 a day")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "menu Spring sale" }),
    ).toBeVisible();
  });

  it("offers Edit for an editable campaign, keeping the project, account and range", () => {
    renderDetails();

    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/ads/campaigns/42/edit?projectId=project-1&accountId=account-1&range=7d",
    );
  });

  it("offers no Edit for a campaign that is not editable", () => {
    renderDetails({
      ...SEARCH,
      campaign: {
        ...SEARCH.campaign,
        editable: false,
        notEditableReason: "AD_GROUPS",
      },
    });

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("names the channel of a campaign type Sokosumi does not build", () => {
    renderDetails({
      ...SEARCH,
      campaign: {
        ...SEARCH.campaign,
        type: "OTHER",
        channelType: "PERFORMANCE_MAX",
      },
    });

    expect(
      screen.getByText("Performance max · Paused · €1.00 a day"),
    ).toBeVisible();
  });

  it("passes the range to the performance block", () => {
    renderDetails();

    expect(screen.getByTestId("performance")).toHaveTextContent("7d");
  });

  it("lists the settings without repeating the header", () => {
    renderDetails();

    const settings = section("Settings");
    expect(settings.getByText("Maximize clicks")).toBeVisible();
    expect(settings.getByText("Google Search")).toBeVisible();
    expect(settings.getByText("Nov 1, 2026")).toBeVisible();
    expect(settings.getByText("Nov 30, 2026")).toBeVisible();
    expect(settings.queryByText("Type")).toBeNull();
    expect(settings.queryByText("Daily budget")).toBeNull();
  });

  it("names the Display Network for a Display campaign", () => {
    renderDetails(DISPLAY);

    expect(section("Settings").getByText("Display Network")).toBeVisible();
  });

  it("has no networks for a type it cannot name them for", () => {
    renderDetails({
      ...SEARCH,
      campaign: { ...SEARCH.campaign, type: "OTHER", channelType: "SHOPPING" },
    });

    expect(section("Settings").queryByText("Networks")).toBeNull();
  });

  it("humanizes a bidding strategy it has no copy for", () => {
    renderDetails({
      ...SEARCH,
      campaign: {
        ...SEARCH.campaign,
        biddingStrategyType: "PAGE_ONE_PROMOTED",
        endDate: null,
      },
    });

    const settings = section("Settings");
    expect(settings.getByText("Page one promoted")).toBeVisible();
    expect(settings.getByText("No end date")).toBeVisible();
  });

  it("names the locations and languages, or all of them", () => {
    renderDetails();

    const targeting = section("Targeting");
    expect(targeting.getByText("Berlin,Berlin,Germany")).toBeVisible();
    expect(targeting.getByText("German")).toBeVisible();
  });

  it("says all countries and all languages without targeting", () => {
    renderDetails({
      ...SEARCH,
      targeting: { locations: [], languages: [] },
    });

    const targeting = section("Targeting");
    expect(targeting.getByText("All countries")).toBeVisible();
    expect(targeting.getByText("All languages")).toBeVisible();
  });

  it("writes keywords in Google syntax with their match type", () => {
    renderDetails();

    const keywords = section("Keywords");
    expect(keywords.getByText("running shoes")).toBeVisible();
    expect(keywords.getByText('"trail shoes"')).toBeVisible();
    expect(keywords.getByText("[buy shoes online]")).toBeVisible();
    expect(keywords.getByText(/Broad match/)).toBeVisible();
    expect(keywords.getByText(/Phrase match/)).toBeVisible();
    expect(keywords.getByText(/Exact match/)).toBeVisible();
  });

  it("shows a keyword's approval only when it is not approved", () => {
    renderDetails();

    const keywords = section("Keywords");
    expect(keywords.getByText(/Disapproved/)).toBeVisible();
    expect(keywords.queryByText(/Approved/)).toBeNull();
  });

  it("has no Keywords for a Display campaign", () => {
    renderDetails(DISPLAY);

    expect(screen.queryByRole("region", { name: "Keywords" })).toBeNull();
  });

  it("shows a Search ad's address, headlines and descriptions", () => {
    renderDetails();

    const ad = section("Ad");
    expect(ad.getByText("Approved · Ad strength: Good")).toBeVisible();
    expect(ad.getByText("example.com/shoes/sale")).toBeVisible();
    expect(ad.getByText("Fast running shoes")).toBeVisible();
    expect(ad.getByText("Shop the sale")).toBeVisible();
    expect(ad.getByText("Returns within 30 days.")).toBeVisible();
  });

  it("humanizes an ad strength and a review it has no copy for", () => {
    renderDetails({
      ...SEARCH,
      ad: {
        ...SEARCH.ad!,
        approvalStatus: "APPROVED_LIMITED",
        reviewStatus: "UNDER_APPEAL",
        adStrength: "VERY_STRONG",
      },
    });

    expect(
      section("Ad").getByText(
        "Approved (limited) · Under appeal · Ad strength: Very strong",
      ),
    ).toBeVisible();
  });

  it("leaves out the statuses Google has no value for", () => {
    renderDetails({
      ...SEARCH,
      ad: {
        ...SEARCH.ad!,
        approvalStatus: "UNKNOWN",
        reviewStatus: "UNSPECIFIED",
        adStrength: null,
      },
    });

    expect(
      section("Ad").queryByText(/Unknown|Unspecified|strength/),
    ).toBeNull();
  });

  it("shows a Display ad's images with their roles, name and text", () => {
    renderDetails(DISPLAY);

    const ad = section("Ad");
    expect(ad.getByAltText("Landscape image 1")).toHaveAttribute(
      "src",
      "https://tpc.googlesyndication.com/landscape.png",
    );
    expect(ad.getByAltText("Logo image 2")).toBeVisible();
    expect(ad.getByText("Landscape")).toBeVisible();
    expect(ad.getByText("Logo")).toBeVisible();
    expect(ad.getByText("Shoe Shop")).toBeVisible();
    expect(ad.getByText("Run further")).toBeVisible();
    expect(
      ad.getByText("Run further in shoes made for the trail"),
    ).toBeVisible();
  });

  it("hides empty Sitelinks and Callouts", () => {
    renderDetails();

    expect(screen.queryByRole("region", { name: "Sitelinks" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Callouts" })).toBeNull();
  });

  it("lists Sitelinks and Callouts, with approval only when not approved", () => {
    renderDetails({
      ...SEARCH,
      sitelinks: [
        {
          assetId: "s1",
          text: "Sale",
          finalUrl: "https://example.com/sale",
          description1: "Up to 50% off",
          description2: null,
          approvalStatus: "APPROVED",
        },
        {
          assetId: "s2",
          text: "Kids",
          finalUrl: "https://example.com/kids",
          description1: null,
          description2: null,
          approvalStatus: "UNDER_REVIEW",
        },
      ],
      callouts: [
        { assetId: "c1", text: "Free delivery", approvalStatus: "APPROVED" },
        { assetId: "c2", text: "Free returns", approvalStatus: "DISAPPROVED" },
      ],
    });

    const sitelinks = section("Sitelinks");
    expect(sitelinks.getByText("Sale")).toBeVisible();
    expect(sitelinks.getByText("https://example.com/sale")).toBeVisible();
    expect(sitelinks.getByText("Up to 50% off")).toBeVisible();
    expect(sitelinks.getByText("Under review")).toBeVisible();
    expect(sitelinks.queryByText("Approved")).toBeNull();

    const callouts = section("Callouts");
    expect(callouts.getByText("Free delivery")).toBeVisible();
    expect(callouts.getByText("Disapproved")).toBeVisible();
    expect(callouts.queryByText("Approved")).toBeNull();
  });

  it.each([
    [
      "TYPE",
      "Sokosumi doesn't build this campaign type; manage it in Google Ads.",
    ],
    [
      "AD_GROUPS",
      "This campaign has several ad groups; manage them in Google Ads.",
    ],
    [
      "AD_TYPE",
      "This campaign doesn't have a single responsive ad; manage its ads in Google Ads.",
    ],
  ] as const)(
    "points to Google Ads when the campaign is not editable (%s)",
    (reason, note) => {
      renderDetails({
        ...SEARCH,
        ad: null,
        campaign: {
          ...SEARCH.campaign,
          editable: false,
          notEditableReason: reason,
        },
      });

      expect(screen.queryByRole("region", { name: "Ad" })).toBeNull();
      expect(screen.getByText(note)).toBeVisible();
    },
  );

  it("keeps the ad and adds the note when a campaign with an ad is not editable", () => {
    renderDetails({
      ...SEARCH,
      campaign: {
        ...SEARCH.campaign,
        editable: false,
        notEditableReason: "AD_GROUPS",
      },
    });

    expect(screen.getByRole("region", { name: "Ad" })).toBeVisible();
    expect(screen.getByText(/several ad groups/)).toBeVisible();
  });

  it("has no note for an editable campaign, even without an ad", () => {
    renderDetails({ ...SEARCH, ad: null });

    expect(screen.queryByText(/manage/)).toBeNull();
  });
});
