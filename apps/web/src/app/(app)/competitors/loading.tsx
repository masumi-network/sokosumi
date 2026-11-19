import { getTranslations } from "next-intl/server";

import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default async function CompetitorsLoading() {
  const t = await getTranslations("App.Competitors");

  return (
    <WorkspacePageShell title={t("title")}>
      <div aria-busy="true" aria-live="polite" role="status">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton aria-hidden className="mb-4 h-16 w-full rounded-xl" />
        <div aria-hidden className="grid items-start gap-4 xl:grid-cols-3">
          <div
            className={cn(HOLDER_CLASS, "flex flex-col gap-2 xl:col-span-2")}
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        </div>
      </div>
    </WorkspacePageShell>
  );
}
