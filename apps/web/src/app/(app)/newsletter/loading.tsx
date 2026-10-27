import { getTranslations } from "next-intl/server";

import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default async function NewsletterLoading() {
  const t = await getTranslations("App.Newsletter");

  return (
    <WorkspacePageShell title={t("title")}>
      <div className="min-w-0 space-y-6" aria-busy="true">
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </WorkspacePageShell>
  );
}
