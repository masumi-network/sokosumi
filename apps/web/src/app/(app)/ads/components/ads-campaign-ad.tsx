import type { AdCampaignDetails } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import {
  AD_STRENGTHS,
  APPROVAL_STATUSES,
  enumLabel,
  meaningfulStatus,
  REVIEW_STATUSES,
} from "@/lib/ads/campaign-details";
import { adDisplayUrl } from "@/lib/ads/google-search";
import { cn } from "@/lib/utils";

import { AdsFact, AdsFactList, AdsFacts } from "./ads-fact";
import { AdsSection } from "./ads-section";

type Ad = NonNullable<AdCampaignDetails["ad"]>;

/** A finished review adds nothing next to the approval, so it is not shown. */
const SETTLED_REVIEWS: readonly string[] = ["REVIEWED", "ELIGIBLE_MAY_SERVE"];

/** Image shapes by role, so a logo never stretches to a landscape. */
const IMAGE_SIZE = {
  LANDSCAPE: "h-24 aspect-[1.91/1]",
  SQUARE: "size-24",
  LOGO: "size-16",
} as const;

interface AdsCampaignAdProps {
  ad: Ad;
}

/**
 * The campaign's only ad as Google has it: its status on one line, then the
 * text (and for Display the images) in the order the create form asks for it.
 */
export function AdsCampaignAd({ ad }: AdsCampaignAdProps) {
  const t = useTranslations("App.Ads.campaignDetails");
  const tNew = useTranslations("App.Ads.newCampaign");

  const approval = meaningfulStatus(ad.approvalStatus);
  const review = meaningfulStatus(ad.reviewStatus);
  const strength = meaningfulStatus(ad.adStrength);
  const status: string[] = [];
  if (approval) {
    status.push(
      enumLabel(approval, APPROVAL_STATUSES, (key) => t(`approval.${key}`)),
    );
  }
  if (review && !SETTLED_REVIEWS.includes(review)) {
    status.push(
      enumLabel(review, REVIEW_STATUSES, (key) => t(`ad.review.${key}`)),
    );
  }
  if (strength) {
    status.push(
      t("ad.strength", {
        strength: enumLabel(strength, AD_STRENGTHS, (key) =>
          t(`ad.strengths.${key}`),
        ),
      }),
    );
  }

  const { search, display } = ad;

  return (
    <AdsSection id="campaign-ad" title={tNew("sections.ad")}>
      {status.length > 0 ? (
        <p className="text-muted-foreground text-sm">{status.join(" · ")}</p>
      ) : null}
      <AdsFacts>
        {ad.finalUrl ? (
          <AdsFact label={tNew("ad.finalUrl")}>{ad.finalUrl}</AdsFact>
        ) : null}
        {search ? (
          <>
            {ad.finalUrl ? (
              <AdsFact label={t("ad.displayUrl")}>
                {adDisplayUrl(
                  ad.finalUrl,
                  search.path1 ?? "",
                  search.path2 ?? "",
                )}
              </AdsFact>
            ) : null}
            <AdsFact label={tNew("ad.headlines.label")}>
              <AdsFactList items={search.headlines} />
            </AdsFact>
            <AdsFact label={tNew("ad.descriptions.label")}>
              <AdsFactList items={search.descriptions} />
            </AdsFact>
          </>
        ) : null}
        {display ? (
          <>
            <AdsFact label={tNew("ad.businessName")}>
              {display.businessName}
            </AdsFact>
            <AdsFact label={tNew("ad.headlines.label")}>
              <AdsFactList items={display.headlines} />
            </AdsFact>
            <AdsFact label={tNew("ad.longHeadline")}>
              {display.longHeadline}
            </AdsFact>
            <AdsFact label={tNew("ad.descriptions.label")}>
              <AdsFactList items={display.descriptions} />
            </AdsFact>
            {display.images.length > 0 ? (
              <AdsFact label={tNew("ad.images.label")}>
                <ul className="flex flex-wrap items-end gap-4">
                  {display.images.map((image, index) => (
                    <li key={image.assetId}>
                      <figure className="flex flex-col gap-1">
                        <div
                          className={cn(
                            "bg-muted overflow-hidden rounded-md",
                            IMAGE_SIZE[image.role],
                          )}
                        >
                          {/* Google-hosted, so a plain `<img>` that sends no referrer, as in `ads-market-ad-preview.tsx`. */}
                          <img
                            alt={t("ad.imageAlt", {
                              role: tNew(`ad.images.roles.${image.role}`),
                              number: index + 1,
                            })}
                            className="size-full object-contain"
                            decoding="async"
                            height={image.height}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            src={image.url}
                            width={image.width}
                          />
                        </div>
                        <figcaption className="text-muted-foreground text-xs">
                          {tNew(`ad.images.roles.${image.role}`)}
                        </figcaption>
                      </figure>
                    </li>
                  ))}
                </ul>
              </AdsFact>
            ) : null}
          </>
        ) : null}
      </AdsFacts>
    </AdsSection>
  );
}
