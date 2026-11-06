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
        <Skeleton className="h-9 w-96 max-w-full rounded-lg" aria-hidden />
        <div className={cn(HOLDER_CLASS, "space-y-2")} aria-hidden>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </WorkspacePageShell>
  );
}
