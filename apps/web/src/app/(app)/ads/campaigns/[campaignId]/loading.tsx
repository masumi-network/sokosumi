import { getTranslations } from "next-intl/server";

import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The details page's shape while it loads: title, totals and the chart. */
export default async function AdsCampaignDetailsLoading() {
  const t = await getTranslations("App.Ads");

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div
        aria-busy="true"
        aria-live="polite"
        className="flex max-w-180 flex-col gap-3 pb-16"
        role="status"
      >
        <span className="sr-only">{t("loading")}</span>
        <div aria-hidden className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-72 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
