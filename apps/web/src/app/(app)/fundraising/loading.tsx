import { getTranslations } from "next-intl/server";
import { WorkspacePageShell } from "@/app/components/workspace-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default async function FundraisingLoading() {
  const t = await getTranslations("App.Fundraising");
  return (
    <WorkspacePageShell title={t("title")}>
      <div aria-busy="true" aria-live="polite" role="status" className="p-4">
        <span className="sr-only">{t("loading")}</span>
        <Skeleton aria-hidden className="mb-4 h-10 w-1/3" />
        <Skeleton aria-hidden className="mb-4 h-8 w-full" />
        <Skeleton aria-hidden className="h-80 w-full" />
      </div>
    </WorkspacePageShell>
  );
}
