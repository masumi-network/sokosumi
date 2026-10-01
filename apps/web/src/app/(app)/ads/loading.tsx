import { getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";

import { AdsPageShell } from "./components/ads-page-shell";

/** Ads' shape while the project loads: the tab row and one empty-state block. */
export default async function AdsLoading() {
  const t = await getTranslations("App.Ads");

  return (
    <AdsPageShell title={t("title")}>
      <div
        aria-busy="true"
        aria-live="polite"
        className="space-y-6"
        role="status"
      >
        <span className="sr-only">{t("loading")}</span>
        {/* The tab row and one empty-state block, as on the page. */}
        <div aria-hidden className="space-y-6">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="mx-auto h-40 w-full max-w-md" />
        </div>
      </div>
    </AdsPageShell>
  );
}
