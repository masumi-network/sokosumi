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
      className="pointer-events-none flex w-full items-start justify-center gap-4 overflow-hidden px-2 pb-8 text-left select-none"
      data-testid="ads-backdrop"
    >
      <DisplaySquareCard
        ad={linen}
        className="hidden w-52 shrink-0 -rotate-2 lg:block"
      />
      <SearchAdCard
        ad={roastery}
        className="w-80 shrink-0 translate-y-6 rotate-1"
      />
      <DisplayLandscapeCard
        ad={yoga}
        className="hidden w-80 shrink-0 -rotate-1 sm:block"
      />
      <SearchAdCard
        ad={studio}
        className="hidden w-72 shrink-0 translate-y-8 rotate-2 xl:flex"
      />
    </div>
  );
}
