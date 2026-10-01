import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { adsService } from "@/lib/services/ads.service";

import { toMarketLoadError } from "./ads-market";
import { AdsMarketAds } from "./ads-market-ads";
import { AdsMarketError } from "./ads-market-error";
import { AdsMarketKeywords } from "./ads-market-keywords";
import { AdsMarketProfile } from "./ads-market-profile";
import { AdsMarketSkeleton } from "./ads-market-skeleton";

interface AdsMarketSectionProps {
  projectId: string;
}

/**
 * The Market tab: the project's profile and, once it has one, its trending
 * keywords and ads. Each section loads in its own Suspense and fails on its
 * own. Without a profile the form is all there is, so nothing is requested
 * from the data provider.
 */
export async function AdsMarketSection({ projectId }: AdsMarketSectionProps) {
  let profile: Awaited<
    ReturnType<typeof adsService.getMarketProfile>
  >["profile"];
  try {
    ({ profile } = await adsService.getMarketProfile(projectId));
  } catch (error) {
    return <AdsMarketError kind={toMarketLoadError(error)} section="profile" />;
  }

  if (!profile) {
    return <AdsMarketProfile profile={null} projectId={projectId} />;
  }

  const t = await getTranslations("App.Ads.market");

  return (
    <div className="flex flex-col gap-10">
      <AdsMarketProfile profile={profile} projectId={projectId} />
      <section
        aria-labelledby="ads-market-keywords-title"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="ads-market-keywords-title">
          {t("keywords.title")}
        </h2>
        <Suspense fallback={<AdsMarketSkeleton />}>
          <AdsMarketKeywords projectId={projectId} />
        </Suspense>
      </section>
      <section
        aria-labelledby="ads-market-ads-title"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="ads-market-ads-title">
          {t("ads.title")}
        </h2>
        <Suspense fallback={<AdsMarketSkeleton variant="cards" />}>
          <AdsMarketAds projectId={projectId} />
        </Suspense>
      </section>
    </div>
  );
}
