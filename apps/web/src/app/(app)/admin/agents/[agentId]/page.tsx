import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AgentMetadataForm } from "@/components/admin/agents/agent-metadata-form";
import { Button } from "@/components/ui/button";
import { adminAgentService } from "@/lib/services/admin-agent.service";

export const metadata: Metadata = {
  title: "Agent overrides",
  description: "Edit marketplace metadata overrides for an agent",
};

interface AdminAgentDetailPageProps {
  params: Promise<{ agentId: string }>;
}

export default async function AdminAgentDetailPage({
  params,
}: AdminAgentDetailPageProps) {
  const { agentId } = await params;
  const [detail, t] = await Promise.all([
    adminAgentService.getAgent(agentId),
    getTranslations("App.Admin.Agents.AgentDetail"),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {detail.resolved.name}
            </h1>
            <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/agents">{t("backToList")}</Link>
          </Button>
        </div>

        <AgentMetadataForm agentId={agentId} detail={detail} />
      </div>
    </div>
  );
}
