import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default async function SeoLoading() {
  const t = await getTranslations("App.Seo");
  return (
    <WorkspacePageShell title={t("title")}>
      <div role="status" aria-label={t("loading")} className="space-y-6">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {["views", "users", "clicks", "impressions"].map((key) => (
            <Skeleton key={key} className="h-48 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </WorkspacePageShell>
  );
}
