"use client";

import { useTranslations } from "next-intl";
import { displayAdPreview, searchAdPreview } from "@/lib/ads/ad-preview";
import { EMPTY_SITELINK } from "@/lib/ads/google-search";

import {
  DisplayLandscapeCard,
  DisplaySquareCard,
  SearchAdCard,
} from "./ads-ad-preview";

/**
 * What Ads looks like with campaigns in it, behind the project selector: a
 * staggered row of sample Search and Display ads, drawn by the same cards the
 * campaign preview uses. Decoration only, so it is hidden from readers and
 * takes no clicks; the selector above it is where the page is used.
 * The samples wrap into a right-aligned grid to leave room for the picker.
 */
export function AdsNoProjectBackdrop() {
  const t = useTranslations("App.Ads.backdrop");

  const roastery = searchAdPreview(
    {
      finalUrl: "https://northwind.coffee",
      path1: "beans",
      path2: "",
      headlines: [
        t("roastery.headline1"),
        t("roastery.headline2"),
        t("roastery.headline3"),
      ],
      descriptions: [t("roastery.description")],
      sitelinks: [
        { ...EMPTY_SITELINK, text: t("roastery.sitelink1") },
        { ...EMPTY_SITELINK, text: t("roastery.sitelink2") },
        { ...EMPTY_SITELINK, text: t("roastery.sitelink3") },
      ],
      callouts: [],
    },
    0,
  );
  const studio = searchAdPreview(
    {
      finalUrl: "https://fieldnotes.studio",
      path1: "sprints",
      path2: "",
      headlines: [t("studio.headline1"), t("studio.headline2")],
      descriptions: [t("studio.description")],
      sitelinks: [],
      callouts: [t("studio.callout1"), t("studio.callout2")],
    },
    0,
  );
  const display = (key: "linen" | "yoga", finalUrl: string) =>
    displayAdPreview(
      {
        finalUrl,
        businessName: t(`${key}.businessName`),
        displayHeadlines: [t(`${key}.headline`)],
        longHeadline: t(`${key}.longHeadline`),
        displayDescriptions: [t(`${key}.description`)],
        images:
          key === "linen"
            ? [
                {
                  role: "SQUARE",
                  url: "/images/ads/backdrop/linen-square.webp",
                },
              ]
            : [
                {
                  role: "LANDSCAPE",
                  url: "/images/ads/backdrop/yoga-landscape.webp",
                },
              ],
      },
      0,
    );
  const linen = display("linen", "https://atelierlune.com");
  const yoga = display("yoga", "https://harbor.yoga");

  return (
    <div
      aria-hidden
      inert
      className="pointer-events-none grid w-full max-w-2xl grid-cols-1 items-start gap-6 self-end overflow-hidden px-2 pt-3 pb-8 text-left select-none sm:grid-cols-2"
      data-testid="ads-backdrop"
    >
      <DisplaySquareCard ad={linen} className="-rotate-2" />
      <SearchAdCard
        ad={roastery}
        className="rotate-1"
        imageSrc="/images/ads/backdrop/coffee-beans.webp"
      />
      <DisplayLandscapeCard ad={yoga} className="-rotate-1" />
      <SearchAdCard
        ad={studio}
        className="rotate-2"
        imageSrc="/images/ads/backdrop/design-sprint.webp"
      />
    </div>
  );
}
