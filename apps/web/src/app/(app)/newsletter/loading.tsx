import { getTranslations } from "next-intl/server";

import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default async function NewsletterLoading() {
  const t = await getTranslations("App.Newsletter");

  return (
    <WorkspacePageShell title={t("title")}>
      <div className="min-w-0 space-y-6" aria-busy="true">
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-4 overflow-hidden" aria-hidden>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-5 w-20 shrink-0" />
          ))}
        </div>
        <div className={cn(HOLDER_CLASS, "space-y-2")} aria-hidden>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </WorkspacePageShell>
  );
}
