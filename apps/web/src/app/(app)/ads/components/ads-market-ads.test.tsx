import type { AdMarketAd } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";

const { listMarketAdsMock } = vi.hoisted(() => ({
  listMarketAdsMock: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages,
      namespace: namespace as "App.Ads.market.ads",
    }),
  getFormatter: async () => createFormatter({ locale: "en" }),
}));

vi.mock("@/lib/services/ads.service", () => ({
  adsService: { listMarketAds: listMarketAdsMock },
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
import { AdsMarketAds } from "./ads-market-ads";

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000);

const IMAGE_AD: AdMarketAd = {
  creativeId: "c1",
  advertiserId: "a1",
  advertiserName: "Acme Shoes",
  format: "image",
  previewImage: {
    url: "https://tpc.googlesyndication.com/archive/c1.png",
    width: 400,
    height: 300,
  },
  previewUrl: "https://adstransparency.google.com/advertiser/a1/creative/c1",
  firstShown: hoursAgo(72),
  lastShown: hoursAgo(3),
  verified: true,
};
const TEXT_AD: AdMarketAd = {
  ...IMAGE_AD,
  creativeId: "c2",
  advertiserName: "Trail Co",
  format: "text",
  previewImage: null,
  previewUrl: null,
  lastShown: null,
};

async function renderAds(ads: AdMarketAd[] = [IMAGE_AD, TEXT_AD]) {
  listMarketAdsMock.mockResolvedValue({ ads, fetchedAt: hoursAgo(1) });
  render(await AdsMarketAds({ projectId: "project-1" }));
}

describe("AdsMarketAds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says when the data was fetched", async () => {
    await renderAds();

    expect(listMarketAdsMock).toHaveBeenCalledWith("project-1");
    expect(screen.getByText("Updated 1 hour ago")).toBeVisible();
  });

  it("shows an image ad with its advertiser, format and last shown", async () => {
    await renderAds();

    const [card] = screen.getAllByRole("listitem");
    const image = within(card).getByRole("img", { name: "Ad by Acme Shoes" });
    expect(image).toHaveAttribute(
      "src",
      "https://tpc.googlesyndication.com/archive/c1.png",
    );
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(card).toHaveTextContent("Acme Shoes");
    expect(card).toHaveTextContent("Image · Last shown 3 hours ago");
  });

  it("opens the ad in a new tab, safely", async () => {
    await renderAds();

    const link = screen.getByRole("link", { name: /View ad/ });
    expect(link).toHaveAttribute(
      "href",
      "https://adstransparency.google.com/advertiser/a1/creative/c1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a text ad as a quiet block, with no image or link", async () => {
    await renderAds();

    const [, card] = screen.getAllByRole("listitem");
    expect(within(card).getByText("Text ad")).toBeVisible();
    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).queryByRole("link")).toBeNull();
    // Never shown in the window: just the format.
    expect(card).toHaveTextContent(/^Text ad\s*Trail CoText$/);
  });

  it("says there is no preview for a non-text ad without an image", async () => {
    await renderAds([{ ...TEXT_AD, format: "video" }]);

    expect(screen.getByText("No preview")).toBeVisible();
  });

  it("is a calm empty state when no ads were found", async () => {
    await renderAds([]);

    expect(
      screen.getByText("No ads found for these advertisers yet"),
    ).toBeVisible();
  });

  it.each([
    [{ status: 503, kind: "integration_not_configured" }, "unavailable"],
    [{ status: 502 }, "failed"],
  ])("shows %o as its own %s state", async (details, kind) => {
    listMarketAdsMock.mockRejectedValue(new CoreApiRequestError("x", details));

    render(await AdsMarketAds({ projectId: "project-1" }));

    expect(screen.getByTestId("error")).toHaveTextContent(`ads:${kind}`);
  });
});
