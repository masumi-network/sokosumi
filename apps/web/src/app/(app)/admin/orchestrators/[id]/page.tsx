import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { OrchestratorEditForm } from "@/components/admin/orchestrators/orchestrator-edit-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminOrchestratorService } from "@/lib/services/admin-orchestrator.service";

export const metadata: Metadata = {
  title: "Edit orchestrator",
  description: "Edit orchestrator display metadata",
};

interface AdminOrchestratorDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrchestratorDetailPage({
  params,
}: AdminOrchestratorDetailPageProps) {
  const { id } = await params;
  const [orchestrator, t] = await Promise.all([
    adminOrchestratorService.getOrchestrator(id),
    getTranslations("App.Admin.Orchestrators.Detail"),
  ]);

  if (!orchestrator) {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{orchestrator.name}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/orchestrators">{t("backToList")}</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{orchestrator.slug}</CardTitle>
          </CardHeader>
          <CardContent>
            <OrchestratorEditForm
              key={orchestrator.id}
              orchestrator={orchestrator}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
