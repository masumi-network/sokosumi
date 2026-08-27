import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminActionsLog } from "@/components/admin/soko-bots/admin-actions-log";
import { AdminDecisionsPanel } from "@/components/admin/soko-bots/admin-decisions-panel";
import { AdminLegacyHistoryPanel } from "@/components/admin/soko-bots/admin-legacy-history-panel";
import { AdminMemoryPanel } from "@/components/admin/soko-bots/admin-memory-panel";
import { AdminSchedulesPanel } from "@/components/admin/soko-bots/admin-schedules-panel";
import { AdminSokoBotDangerZone } from "@/components/admin/soko-bots/admin-soko-bot-danger-zone.client";
import { AdminSokoBotHeader } from "@/components/admin/soko-bots/admin-soko-bot-header";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const metadata: Metadata = {
  title: "Soko Bot · Advanced",
  description: "Soko Bot operator controls",
};

interface AdminSokoBotAdvancedPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminSokoBotAdvancedPage({
  params,
}: AdminSokoBotAdvancedPageProps) {
  const { id } = await params;
  const bot = await adminSokoBotService.get(id);
  if (!bot) notFound();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <AdminSokoBotHeader bot={bot} active="advanced" />
        <AdminDecisionsPanel decisions={bot.pendingDecisions ?? []} />
        <AdminSchedulesPanel sokoBotId={bot.id} schedules={bot.schedules} />
        <AdminMemoryPanel bot={bot} />
        <AdminLegacyHistoryPanel messages={bot.legacyMessages ?? []} />
        <AdminActionsLog actions={bot.adminActions} />
        <AdminSokoBotDangerZone
          sokoBotId={bot.id}
          botName={bot.name ?? null}
          ownerEmail={bot.owner.email}
        />
      </div>
    </div>
  );
}
