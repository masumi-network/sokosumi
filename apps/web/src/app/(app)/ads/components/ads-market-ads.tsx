import type { AdMarketAd } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/common/empty-state";
import { adsService } from "@/lib/services/ads.service";

import { toMarketLoadError } from "./ads-market";
import { AdsMarketError } from "./ads-market-error";

interface AdsMarketAdsProps {
  projectId: string;
}

/**
 * Recent ads of the market's biggest advertisers, loaded on the server inside
 * the section's Suspense: one calm card each, in a grid of 1, 2 or 3 columns.
 * The preview is Google-hosted, so it is a plain `<img>` that sends no
 * referrer. Text ads have no image and show a quiet block instead.
 */
export async function AdsMarketAds({ projectId }: AdsMarketAdsProps) {
  const t = await getTranslations("App.Ads.market.ads");
  const formatter = await getFormatter();

  let result: Awaited<ReturnType<typeof adsService.listMarketAds>>;
  try {
    result = await adsService.listMarketAds(projectId);
  } catch (error) {
    return <AdsMarketError kind={toMarketLoadError(error)} section="ads" />;
  }

  const { ads, fetchedAt } = result;
  if (ads.length === 0) {
    return <EmptyState description={t("emptyBody")} title={t("emptyTitle")} />;
  }

  const details = ({ format, lastShown }: AdMarketAd) =>
    [
      t(`format.${format}`),
      lastShown
        ? t("lastShown", { time: formatter.relativeTime(lastShown) })
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex flex-col gap-4" data-testid="ads-market-ads">
      <p className="text-muted-foreground text-xs">
        {t("updated", { time: formatter.relativeTime(fetchedAt) })}
      </p>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ads.map((ad) => (
          <li
            key={`${ad.advertiserId}:${ad.creativeId}`}
            className="flex flex-col gap-3"
          >
            <div className="bg-muted flex aspect-4/3 items-center justify-center overflow-hidden rounded-lg">
              {ad.previewImage ? (
                // Google-hosted: not `next/image`, and no referrer sent.
                <img
                  alt={t("previewAlt", { advertiser: ad.advertiserName })}
                  className="size-full object-contain"
                  decoding="async"
                  height={ad.previewImage.height ?? undefined}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  src={ad.previewImage.url}
                  width={ad.previewImage.width ?? undefined}
                />
              ) : (
                <span className="text-muted-foreground text-sm">
                  {ad.format === "text" ? t("textAd") : t("noPreview")}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {ad.advertiserName}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {details(ad)}
              </p>
            </div>
            {ad.previewUrl ? (
              <a
                className="text-primary w-fit text-sm underline-offset-4 hover:underline"
                href={ad.previewUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("viewAd")}
                <span className="sr-only">{` — ${ad.advertiserName}`}</span>
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
