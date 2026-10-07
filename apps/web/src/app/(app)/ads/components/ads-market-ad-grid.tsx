import type { AdMarketAd } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";

import { AdsMarketAdPreview } from "./ads-market-ad-preview";
import { AdsUpdated } from "./ads-updated";

interface AdsMarketAdGridProps {
  ads: AdMarketAd[];
  fetchedAt: Date | null;
}

/**
 * Recent ads of the market's biggest advertisers: one calm card each, in a
 * grid of 1, 2 or 3 columns. Only the preview is client code, to fall back
 * when its image fails to load.
 */
export function AdsMarketAdGrid({ ads, fetchedAt }: AdsMarketAdGridProps) {
  const t = useTranslations("App.Ads.market.ads");
  const formatter = useFormatter();

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
      {fetchedAt && <AdsUpdated at={fetchedAt} />}
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {ads.map((ad) => (
          <li
            key={`${ad.advertiserId}:${ad.creativeId}`}
            className="flex flex-col gap-3"
          >
            <AdsMarketAdPreview ad={ad} />
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
