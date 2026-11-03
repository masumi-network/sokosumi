"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { displayAdPreview, searchAdPreview } from "@/lib/ads/ad-preview";
import { EMPTY_SITELINK } from "@/lib/ads/google-search";

/**
 * What Ads looks like with campaigns in it, behind the project selector: a
 * horizontal marquee of sample Search and Display ads, with equal cards and
 * the same copy the campaign preview uses. Decoration only, so it is hidden
 * from readers and takes no clicks; the selector above it is where the page is used.
 * The samples stay in one row and repeat for the shared auth-logo marquee loop;
 * reduced motion shows one static horizontal track behind the required picker.
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
  const samples = [
    {
      id: "linen",
      imageSrc: "/images/ads/backdrop/linen-square.webp",
      name: linen.businessName,
      displayUrl: linen.domain,
      headline: linen.headline,
      description: linen.description,
      details: "",
    },
    {
      id: "roastery",
      imageSrc: "/images/ads/backdrop/coffee-beans.webp",
      name: roastery.domain,
      displayUrl: roastery.displayUrl,
      headline: roastery.headline,
      description: roastery.description,
      details: roastery.sitelinks.join(" · "),
    },
    {
      id: "yoga",
      imageSrc: "/images/ads/backdrop/yoga-landscape.webp",
      name: yoga.businessName,
      displayUrl: yoga.domain,
      headline: yoga.longHeadline,
      description: yoga.description,
      details: "",
    },
    {
      id: "studio",
      imageSrc: "/images/ads/backdrop/design-sprint.webp",
      name: studio.domain,
      displayUrl: studio.displayUrl,
      headline: studio.headline,
      description: studio.description,
      details: studio.callouts.join(" · "),
    },
  ];

  return (
    <div
      aria-hidden
      inert
      className="group pointer-events-none relative w-full min-w-0 overflow-hidden pt-3 pb-8 text-left select-none"
      data-testid="ads-backdrop"
    >
      <div
        className="@container relative w-full overflow-x-auto overflow-y-hidden motion-safe:overflow-x-hidden"
        data-testid="ads-backdrop-marquee-track"
      >
        <div
          className="-ml-4 flex w-max motion-safe:animate-ads-backdrop-marquee motion-safe:group-active:[animation-play-state:paused] motion-safe:group-focus-within:[animation-play-state:paused] motion-safe:[@media(hover:hover)]:group-hover:[animation-play-state:paused] motion-reduce:animate-none"
          data-testid="ads-backdrop-marquee"
        >
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden={copy === 1 || undefined}
              inert={copy === 1 || undefined}
              className={
                copy === 1
                  ? "flex shrink-0 motion-reduce:hidden"
                  : "flex shrink-0"
              }
            >
              {samples.map((sample) => (
                <li
                  key={sample.id}
                  className="w-[80cqw] shrink-0 pl-4 @xl:w-[calc(100cqw/2)] @5xl:w-[calc(100cqw/4)]"
                >
                  <figure className="bg-background flex h-[26rem] flex-col overflow-hidden rounded-xl border">
                    <div className="bg-muted relative aspect-[1.91/1] shrink-0">
                      <Image
                        alt=""
                        className="object-cover"
                        fill
                        sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 80vw"
                        src={sample.imageSrc}
                      />
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {sample.name}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {sample.displayUrl}
                        </p>
                      </div>
                      <p className="line-clamp-3 text-sm font-medium text-pretty">
                        {sample.headline}
                      </p>
                      <p className="text-muted-foreground line-clamp-3 text-sm text-pretty">
                        {sample.description}
                      </p>
                      <p className="text-muted-foreground mt-auto line-clamp-2 text-xs">
                        {sample.details}
                      </p>
                    </div>
                  </figure>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  );
}
