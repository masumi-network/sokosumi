import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { OrchestratorList } from "@/components/admin/orchestrators/orchestrator-list";
import { adminOrchestratorService } from "@/lib/services/admin-orchestrator.service";

export const metadata: Metadata = {
  title: "Orchestrators",
  description: "Manage orchestrator display metadata",
};

export default async function AdminOrchestratorsPage() {
  const t = await getTranslations("App.Admin.Orchestrators");
  const orchestrators = await adminOrchestratorService.listOrchestrators();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <OrchestratorList orchestrators={orchestrators} />
      </div>
    </div>
  );
}
