import { getTranslations } from "next-intl/server";

import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** The settings layout: card-grouped form beside a sticky preview. */
export default async function NewsletterSettingsLoading() {
  const t = await getTranslations("App.Newsletter");

  return (
    <WorkspacePageShell title={t("title")}>
      <div className="min-w-0 space-y-6" aria-busy="true">
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div
          className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
          aria-hidden
        >
          <div className={cn(HOLDER_CLASS, "space-y-3 p-3")}>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className={cn(HOLDER_CLASS, "space-y-3 p-3")}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-72 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </WorkspacePageShell>
  );
}
