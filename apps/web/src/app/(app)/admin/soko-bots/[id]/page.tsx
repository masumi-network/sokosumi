import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AdminActionsLog } from "@/components/admin/soko-bots/admin-actions-log";
import { AdminDecisionsPanel } from "@/components/admin/soko-bots/admin-decisions-panel";
import { AdminLegacyHistoryPanel } from "@/components/admin/soko-bots/admin-legacy-history-panel";
import { AdminMemoryPanel } from "@/components/admin/soko-bots/admin-memory-panel";
import { AdminSchedulesPanel } from "@/components/admin/soko-bots/admin-schedules-panel";
import { AdminSokoBotActions } from "@/components/admin/soko-bots/admin-soko-bot-actions.client";
import { AdminSokoBotOverview } from "@/components/admin/soko-bots/admin-soko-bot-overview";
import { AdminTurnsPanel } from "@/components/admin/soko-bots/admin-turns-panel";
import {
  AutonomyBadge,
  SokoBotStatusBadge,
} from "@/components/soko-bot/soko-bot-badges";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import { Button } from "@/components/ui/button";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import { ADMIN_SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

export const metadata: Metadata = {
  title: "Soko Bot",
  description: "Soko Bot operator detail",
};

interface AdminSokoBotDetailPageProps {
  params: Promise<{ id: string }>;
}

const SECTIONS = [
  "overview",
  "turns",
  "decisions",
  "schedules",
  "memory",
  "legacy",
  "audit",
] as const;

export default async function AdminSokoBotDetailPage({
  params,
}: AdminSokoBotDetailPageProps) {
  const { id } = await params;
  const [bot, t] = await Promise.all([
    adminSokoBotService.get(id),
    getTranslations("App.Admin.SokoBots.Detail"),
  ]);

  if (!bot) notFound();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <div className="min-w-0">
            <span className="font-medium">{bot.owner.name ?? "—"}</span>
            <span className="text-muted-foreground"> · {bot.owner.email}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {" · "}
              {bot.owner.id}
            </span>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href={ADMIN_SOKO_BOTS_ROUTE}>{t("backToList")}</Link>
          </Button>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {bot.name ?? t("unnamed")}
              </h1>
              <SokoBotStatusBadge status={bot.status} />
              <AutonomyBadge level={bot.autonomyLevel} />
              {bot.archivedAt ? (
                <StatusBadge tone="neutral">{t("archived")}</StatusBadge>
              ) : null}
            </div>
            <p className="text-muted-foreground font-mono text-xs">{bot.id}</p>
          </div>
          <AdminSokoBotActions
            sokoBotId={bot.id}
            status={bot.status}
            adminPausedAt={bot.adminPausedAt}
            hasFailedTurn={bot.turns.some((turn) => turn.status === "FAILED")}
          />
        </header>

        <nav aria-label={t("sectionsNav")} className="-mx-1 overflow-x-auto">
          <ul className="flex gap-1 px-1 text-sm">
            {SECTIONS.map((section) => (
              <li key={section}>
                <a
                  href={`#${section}`}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted block rounded px-2 py-1 whitespace-nowrap"
                >
                  {t(`sections.${section}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <AdminSokoBotOverview bot={bot} />
        <AdminTurnsPanel turns={bot.turns} />
        <AdminDecisionsPanel decisions={bot.pendingDecisions ?? []} />
        <AdminSchedulesPanel sokoBotId={bot.id} schedules={bot.schedules} />
        <AdminMemoryPanel bot={bot} />
        <AdminLegacyHistoryPanel messages={bot.legacyMessages ?? []} />
        <AdminActionsLog actions={bot.adminActions} />
      </div>
    </div>
  );
}
