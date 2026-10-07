import type {
  ListAdMarketAdsResponse,
  ListAdMarketKeywordsResponse,
} from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense, use } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { adsService } from "@/lib/services/ads.service";

import { AdsErrorState } from "./ads-error-state";
import { type AdsLoad, settleAdsLoad } from "./ads-load-error";
import { AdsMarketAdGrid } from "./ads-market-ad-grid";
import { AdsMarketKeywordList } from "./ads-market-keyword-list";
import { AdsMarketPoller } from "./ads-market-poller";
import { AdsCardsSkeleton } from "./ads-skeleton";

interface AdsMarketResultsProps {
  projectId: string;
}

/**
 * The market's trending keywords and ads. Both are requested at once. Keywords
 * come first: when the data provider is not set up, that is said once for the
 * whole area. Otherwise the ads stream in under their own Suspense and each
 * section fails on its own.
 */
export async function AdsMarketResults({ projectId }: AdsMarketResultsProps) {
  const t = await getTranslations("App.Ads.market");
  const ads = settleAdsLoad(adsService.listMarketAds(projectId));
  const keywords = await settleAdsLoad(
    adsService.listMarketKeywords(projectId),
  );

  if (keywords.error === "unavailable") {
    // Nothing waits on the ads now; a rejection must not go unhandled.
    ads.catch(() => undefined);
    return (
      <AdsErrorState
        failedTitle={t("errors.failed.keywords")}
        kind="unavailable"
        unavailableTitle={t("errors.unavailable")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="ads-market-keywords-title"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="ads-market-keywords-title">
          {t("keywords.title")}
        </h2>
        <AdsMarketKeywords result={keywords} />
      </section>
      <section
        aria-labelledby="ads-market-ads-title"
        className="flex flex-col gap-4"
      >
        <h2 className="text-base font-semibold" id="ads-market-ads-title">
          {t("ads.title")}
        </h2>
        <Suspense fallback={<AdsCardsSkeleton />}>
          <AdsMarketAds result={ads} />
        </Suspense>
      </section>
    </div>
  );
}

/** The keywords as loaded: the list, or what to show instead. */
export function AdsMarketKeywords({
  result,
}: {
  result: AdsLoad<ListAdMarketKeywordsResponse>;
}) {
  const t = useTranslations("App.Ads.market");

  if (result.error) {
    return (
      <AdsErrorState
        failedTitle={t("errors.failed.keywords")}
        kind={result.error}
        unavailableTitle={t("errors.unavailable")}
      />
    );
  }
  if (result.data.keywords.length === 0) {
    return (
      <EmptyState
        description={t("keywords.emptyBody")}
        title={t("keywords.emptyTitle")}
      />
    );
  }
  return <AdsMarketKeywordList {...result.data} />;
}

/**
 * The ads as they load: the grid, or what to show instead. Core gathers them
 * in the background, so while it does the page asks again every 20 seconds and
 * the previous ads, if any, stay in view, with one muted line saying so. A
 * failed lookup keeps them too. Everything sits in one live region, so
 * screen readers hear the line and the arrival of the ads.
 */
export function AdsMarketAds({
  result,
}: {
  result: Promise<AdsLoad<ListAdMarketAdsResponse>>;
}) {
  const t = useTranslations("App.Ads.market");
  const loaded = use(result);

  if (loaded.error) {
    return (
      <AdsErrorState
        failedTitle={t("errors.failed.ads")}
        kind={loaded.error}
        unavailableTitle={t("errors.unavailable")}
      />
    );
  }

  const { status, ads, fetchedAt } = loaded.data;
  const gathering = status === "gathering";
  const notice = {
    ready: undefined,
    gathering: t("ads.refreshing"),
    failed: t("ads.failedNotice"),
  }[status];

  return (
    <div aria-busy={gathering} aria-live="polite" data-testid="ads-market-live">
      {gathering ? <AdsMarketPoller /> : null}
      {ads.length > 0 ? (
        <AdsMarketAdGrid ads={ads} fetchedAt={fetchedAt} notice={notice} />
      ) : (
        <AdsMarketNoAds status={status} />
      )}
    </div>
  );
}

function AdsMarketNoAds({
  status,
}: {
  status: ListAdMarketAdsResponse["status"];
}) {
  const t = useTranslations("App.Ads.market.ads");
  const copy = {
    ready: { title: t("emptyTitle"), description: t("emptyBody") },
    gathering: { title: t("gatheringTitle"), description: t("gatheringBody") },
    failed: { title: t("failedTitle"), description: t("failedBody") },
  }[status];

  return <EmptyState {...copy} />;
}
