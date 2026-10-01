import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { marketOptions, marketSummary } from "@/lib/ads/market";
import { adsService } from "@/lib/services/ads.service";

import { AdsErrorState } from "./ads-error-state";
import { settleAdsLoad } from "./ads-load-error";
import { AdsMarketProfile } from "./ads-market-profile";
import { AdsMarketResults } from "./ads-market-results";
import { AdsRowsSkeleton } from "./ads-skeleton";

interface AdsMarketSectionProps {
  projectId: string;
}

/**
 * The Market tab: the project's profile and, once it has one, its trending
 * keywords and ads. The names of countries and languages, and the summary line,
 * are made here in the reader's language. Without a profile the form is all
 * there is, so nothing is requested from the data provider.
 */
export async function AdsMarketSection({ projectId }: AdsMarketSectionProps) {
  const t = await getTranslations("App.Ads.market");
  const locale = await getLocale();
  const loaded = await settleAdsLoad(adsService.getMarketProfile(projectId));

  if (loaded.error) {
    return (
      <AdsErrorState
        failedTitle={t("errors.failed.profile")}
        kind={loaded.error}
        unavailableTitle={t("errors.unavailable")}
      />
    );
  }

  const { profile } = loaded.data;
  return (
    <div className="flex flex-col gap-10">
      <AdsMarketProfile
        {...marketOptions(locale)}
        profile={profile}
        projectId={projectId}
        summary={profile ? marketSummary(profile, locale) : null}
      />
      {profile ? (
        <Suspense fallback={<AdsRowsSkeleton />}>
          <AdsMarketResults projectId={projectId} />
        </Suspense>
      ) : null}
    </div>
  );
}
