import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { AdsNoProjectBackdrop } from "./ads-no-project-backdrop";

const SAMPLES = messages.App.Ads.backdrop;

function setup() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsNoProjectBackdrop />
    </NextIntlClientProvider>,
  );
}

describe("AdsNoProjectBackdrop", () => {
  it("lays out sample Search and Display ads with the campaign preview's cards", () => {
    setup();
    const backdrop = screen.getByTestId("ads-backdrop");

    // Search: the headlines joined as Google shows them, under the domain.
    expect(backdrop).toHaveTextContent(
      `${SAMPLES.roastery.headline1} | ${SAMPLES.roastery.headline2} | ${SAMPLES.roastery.headline3}`,
    );
    expect(backdrop).toHaveTextContent("northwind.coffee");
    expect(backdrop).toHaveTextContent(SAMPLES.roastery.sitelink1);
    expect(backdrop).toHaveTextContent(
      `${SAMPLES.studio.callout1} · ${SAMPLES.studio.callout2}`,
    );
    // Display: square and landscape.
    expect(backdrop).toHaveTextContent(SAMPLES.linen.headline);
    expect(backdrop).toHaveTextContent(SAMPLES.yoga.longHeadline);
    // Display creatives come from the static backdrop assets.
    expect(
      Array.from(backdrop.querySelectorAll("img"), (image) =>
        image.getAttribute("src"),
      ),
    ).toEqual([
      "/images/ads/backdrop/linen-square.webp",
      "/images/ads/backdrop/yoga-landscape.webp",
    ]);
    expect(backdrop).not.toHaveTextContent(
      messages.App.Ads.newCampaign.preview.noImage,
    );
  });

  it("is decoration only: hidden from readers and out of the tab order", () => {
    setup();
    const backdrop = screen.getByTestId("ads-backdrop");

    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).toHaveAttribute("inert");
    expect(backdrop).toHaveClass("pointer-events-none");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
