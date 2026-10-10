import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  SocialLoadingFallback,
  SocialLoadingSkeleton,
} from "./components/social-loading-skeleton";
import { SocialPageShell } from "./components/social-page-shell";

/**
 * Social's shape while a destination tab loads. The tab row stays; the pane
 * matches `?tab=` so Accounts or Drafts do not flash a calendar week.
 */
export default async function SocialLoading() {
  const t = await getTranslations("App.Social");

  return (
    <SocialPageShell title={t("title")}>
      <Suspense fallback={<SocialLoadingFallback label={t("loading")} />}>
        <SocialLoadingSkeleton label={t("loading")} />
      </Suspense>
    </SocialPageShell>
  );
}
