import { getTranslations } from "next-intl/server";

import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The edit page's shape while it loads: back link, title and the form's fields. */
export default async function AdsCampaignEditLoading() {
  const t = await getTranslations("App.Ads");

  return (
    <div className={cn(PROJECTS_WORKSPACE_SHELL_CLASS, "pt-2 md:pt-3")}>
      <div
        aria-busy="true"
        aria-live="polite"
        className="flex max-w-180 flex-col gap-10 pb-16"
        role="status"
      >
        <span className="sr-only">{t("loading")}</span>
        <div aria-hidden className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-72 max-w-full" />
          </div>
          {Array.from({ length: 3 }, (_, section) => (
            <div key={section} className="flex flex-col gap-6">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
