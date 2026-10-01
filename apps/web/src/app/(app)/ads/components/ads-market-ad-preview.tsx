"use client";

import type { AdMarketAd } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * An ad's preview box. The image is Google-hosted, so it is a plain `<img>`
 * that sends no referrer, and a URL that has expired (it fails to load) gives
 * way to the same quiet block as an ad with no image.
 */
export function AdsMarketAdPreview({ ad }: { ad: AdMarketAd }) {
  const t = useTranslations("App.Ads.market.ads");
  const [failed, setFailed] = useState(false);

  return (
    <div className="bg-muted flex aspect-4/3 items-center justify-center overflow-hidden rounded-lg">
      {ad.previewImage && !failed ? (
        <img
          alt={t("previewAlt", { advertiser: ad.advertiserName })}
          className="size-full object-contain"
          decoding="async"
          height={ad.previewImage.height ?? undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          src={ad.previewImage.url}
          width={ad.previewImage.width ?? undefined}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-muted-foreground text-sm">
          {ad.format === "text" ? t("textAd") : t("noPreview")}
        </span>
      )}
    </div>
  );
}
