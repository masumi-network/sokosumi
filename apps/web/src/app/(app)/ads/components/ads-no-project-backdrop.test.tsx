import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import messages from "@/../messages/en.json";

import { AdsNoProjectBackdrop } from "./ads-no-project-backdrop";

const SAMPLES = messages.App.Ads.backdrop;
const here = dirname(fileURLToPath(import.meta.url));

function setup() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AdsNoProjectBackdrop />
    </NextIntlClientProvider>,
  );
}

describe("AdsNoProjectBackdrop", () => {
  it("keeps the sample Search and Display copy and all four generated images", () => {
    setup();
    const backdrop = screen.getByTestId("ads-backdrop");
    const primary = backdrop.querySelector("ul");
    if (!primary) throw new Error("Primary ad track is missing");

    // Search: the headlines joined as Google shows them, under the domain.
    expect(backdrop).toHaveTextContent(
      `${SAMPLES.roastery.headline1} | ${SAMPLES.roastery.headline2} | ${SAMPLES.roastery.headline3}`,
    );
    expect(backdrop).toHaveTextContent("northwind.coffee");
    expect(backdrop).toHaveTextContent("northwind.coffee/beans");
    expect(backdrop).toHaveTextContent(SAMPLES.roastery.description);
    expect(backdrop).toHaveTextContent(SAMPLES.roastery.sitelink1);
    expect(backdrop).toHaveTextContent(SAMPLES.roastery.sitelink2);
    expect(backdrop).toHaveTextContent(SAMPLES.roastery.sitelink3);
    expect(backdrop).toHaveTextContent(
      `${SAMPLES.studio.headline1} | ${SAMPLES.studio.headline2}`,
    );
    expect(backdrop).toHaveTextContent("fieldnotes.studio");
    expect(backdrop).toHaveTextContent("fieldnotes.studio/sprints");
    expect(backdrop).toHaveTextContent(SAMPLES.studio.description);
    expect(backdrop).toHaveTextContent(
      `${SAMPLES.studio.callout1} · ${SAMPLES.studio.callout2}`,
    );
    // Display: square and landscape.
    expect(backdrop).toHaveTextContent(SAMPLES.linen.headline);
    expect(backdrop).toHaveTextContent(SAMPLES.linen.businessName);
    expect(backdrop).toHaveTextContent(SAMPLES.linen.description);
    expect(backdrop).toHaveTextContent(SAMPLES.yoga.longHeadline);
    expect(backdrop).toHaveTextContent(SAMPLES.yoga.description);
    // Display creatives come from the static backdrop assets.
    expect(
      Array.from(primary.querySelectorAll("img"), (image) => {
        const source = new URL(
          image.getAttribute("src") ?? "",
          "https://sokosumi.test",
        );
        return source.searchParams.get("url") ?? source.pathname;
      }),
    ).toEqual([
      "/images/ads/backdrop/linen-square.webp",
      "/images/ads/backdrop/coffee-beans.webp",
      "/images/ads/backdrop/yoga-landscape.webp",
      "/images/ads/backdrop/design-sprint.webp",
    ]);
    expect(backdrop).not.toHaveTextContent(
      messages.App.Ads.newCampaign.preview.noImage,
    );
  });

  it("loops equal cards in one row and leaves a static row under reduced motion", () => {
    setup();
    const backdrop = screen.getByTestId("ads-backdrop");
    const marquee = screen.getByTestId("ads-backdrop-marquee");
    const tracks = marquee.querySelectorAll("ul");

    expect(backdrop).toHaveClass("group");
    expect(tracks).toHaveLength(2);
    for (const track of tracks) {
      expect(track).toHaveClass("flex", "shrink-0");
      expect(track.children).toHaveLength(4);
      for (const card of track.children) {
        expect(card).toHaveClass(
          "w-[80cqw]",
          "shrink-0",
          "@xl:w-[calc(100cqw/2)]",
          "@5xl:w-[calc(100cqw/4)]",
        );
        expect(card.querySelector("figure")).toHaveClass(
          "flex",
          "h-[26rem]",
          "flex-col",
          "overflow-hidden",
        );
        expect(card.querySelector("img")).toHaveClass("object-cover");
      }
    }
    expect(tracks[1]?.textContent).toBe(tracks[0]?.textContent);
    expect(tracks[1]).toHaveAttribute("aria-hidden", "true");
    expect(tracks[1]).toHaveAttribute("inert");
    expect(tracks[1]).toHaveClass("motion-reduce:hidden");
    expect(backdrop.querySelector('[class*="rotate-"]')).toBeNull();

    expect(marquee).toHaveClass(
      "flex",
      "w-max",
      "motion-safe:animate-ads-backdrop-marquee",
      "motion-reduce:animate-none",
      "motion-safe:[@media(hover:hover)]:group-hover:[animation-play-state:paused]",
      "motion-safe:group-focus-within:[animation-play-state:paused]",
      "motion-safe:group-active:[animation-play-state:paused]",
    );

    const scroller = screen.getByTestId("ads-backdrop-marquee-track");
    expect(scroller).toHaveClass(
      "overflow-x-auto",
      "motion-safe:overflow-x-hidden",
    );

    const globals = readFileSync(
      join(here, "../../../../app/globals.css"),
      "utf8",
    );
    expect(globals).toMatch(
      /--animate-ads-backdrop-marquee:\s*auth-logo-marquee 40s linear infinite/,
    );
    expect(globals).toMatch(
      /@keyframes auth-logo-marquee\s*{[\s\S]*?translate3d\(-50%,\s*0,\s*0\)/,
    );
  });

  it("is decoration only: hidden from readers and out of the tab order", () => {
    setup();
    const backdrop = screen.getByTestId("ads-backdrop");

    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).toHaveAttribute("inert");
    expect(backdrop).toHaveClass("pointer-events-none");
    expect(
      backdrop.querySelector("a, button, input, select, textarea, [tabindex]"),
    ).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
