import type { AdMarketAd } from "@sokosumi/core-client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdsMarketAdGrid } from "./ads-market-ad-grid";

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

function renderAds(ads: AdMarketAd[] = [IMAGE_AD, TEXT_AD], notice?: string) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsMarketAdGrid ads={ads} fetchedAt={hoursAgo(1)} notice={notice} />
    </NextIntlClientProvider>,
  );
}

describe("AdsMarketAdGrid", () => {
  it("says when the data was fetched", () => {
    renderAds();

    expect(screen.getByText("Updated 1 hour ago")).toBeVisible();
  });

  it("puts a notice on the same line as when it was fetched", () => {
    renderAds([IMAGE_AD], "Refreshing…");

    expect(screen.getByText("Updated 1 hour ago · Refreshing…")).toBeVisible();
  });

  it("never says an ad was last shown in the future", () => {
    renderAds([{ ...IMAGE_AD, lastShown: new Date(Date.now() + 25_000) }]);

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Image · Last shown now",
    );
  });

  it("shows an image ad with its advertiser, format and last shown", () => {
    renderAds();

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

  it("opens the ad in a new tab, safely", () => {
    renderAds();

    const link = screen.getByRole("link", { name: /View ad/ });
    expect(link).toHaveAttribute(
      "href",
      "https://adstransparency.google.com/advertiser/a1/creative/c1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a text ad as a quiet block, with no image or link", () => {
    renderAds();

    const [, card] = screen.getAllByRole("listitem");
    expect(within(card).getByText("Text ad")).toBeVisible();
    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).queryByRole("link")).toBeNull();
    // Never shown in the window: just the format.
    expect(card).toHaveTextContent(/^Text ad\s*Trail CoText$/);
  });

  it("falls back to the quiet block when the image fails to load", () => {
    renderAds();

    const [card] = screen.getAllByRole("listitem");
    fireEvent.error(
      within(card).getByRole("img", { name: "Ad by Acme Shoes" }),
    );

    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).getByText("No preview")).toBeVisible();
    expect(card).toHaveTextContent("Acme Shoes");
    expect(within(card).getByRole("link", { name: /View ad/ })).toBeVisible();
  });

  it("says there is no preview for a non-text ad without an image", () => {
    renderAds([{ ...TEXT_AD, format: "video" }]);

    expect(screen.getByText("No preview")).toBeVisible();
  });
});
