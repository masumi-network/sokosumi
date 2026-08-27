import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminSokoBotHeader } from "@/components/admin/soko-bots/admin-soko-bot-header";
import { AdminSokoBotOverview } from "@/components/admin/soko-bots/admin-soko-bot-overview";
import { AdminTurnsPanel } from "@/components/admin/soko-bots/admin-turns-panel";
import { QualityOverview } from "@/components/admin/soko-bots/quality-overview";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const metadata: Metadata = {
  title: "Soko Bot",
  description: "Soko Bot operator status",
};

interface AdminSokoBotDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ versionId?: string }>;
}

/**
 * Status: what this bot is doing and how well. Operator controls that are
 * rarely needed — decisions, schedules, memory, audit, deletion — live on the
 * Advanced view so this page stays readable at a glance.
 */
export default async function AdminSokoBotDetailPage({
  params,
  searchParams,
}: AdminSokoBotDetailPageProps) {
  const [{ id }, { versionId }] = await Promise.all([params, searchParams]);
  const bot = await adminSokoBotService.get(id);
  if (!bot) notFound();

  const selectedVersionId = versionId?.trim() ? versionId.trim() : null;
  const quality = await adminSokoBotService.quality({
    sokoBotId: bot.id,
    ...(selectedVersionId ? { versionId: selectedVersionId } : {}),
  });

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <AdminSokoBotHeader bot={bot} active="status" />
        <AdminSokoBotOverview bot={bot} />
        <QualityOverview
          quality={quality}
          selectedVersionId={selectedVersionId}
        />
        <AdminTurnsPanel turns={bot.turns} />
      </div>
    </div>
  );
}
