import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentList } from "@/components/admin/agents/agent-list";
import { adminAgentService } from "@/lib/services/admin-agent.service";

export const metadata: Metadata = {
  title: "Agents",
  description: "Manage marketplace agent metadata overrides",
};

export default async function AdminAgentsPage() {
  const t = await getTranslations("App.Admin.Agents");
  const initialPage = await adminAgentService.listAgents();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <AgentList initialPage={initialPage} />
      </div>
    </div>
  );
}
