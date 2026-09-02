import { FlaskConical, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { FleetHealthSummary } from "@/components/admin/soko-bots/fleet-health-summary";
import { QualityOverview } from "@/components/admin/soko-bots/quality-overview";
import { SokoBotFleetTable } from "@/components/admin/soko-bots/soko-bot-fleet-table.client";
import { SokoBotKillSwitch } from "@/components/admin/soko-bots/soko-bot-kill-switch.client";
import { SokoBotVersionMigration } from "@/components/admin/soko-bots/soko-bot-version-migration.client";
import { Button } from "@/components/ui/button";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const metadata: Metadata = {
  title: "Soko Bots",
  description: "Soko Bot fleet health and operator controls",
};

const FLEET_PAGE_LIMIT = 100;

interface AdminSokoBotsPageProps {
  searchParams: Promise<{
    qualityVersion?: string | string[];
  }>;
}

export default async function AdminSokoBotsPage({
  searchParams,
}: AdminSokoBotsPageProps) {
  const params = await searchParams;
  const qualityVersion =
    typeof params.qualityVersion === "string"
      ? params.qualityVersion.trim() || undefined
      : undefined;
  const [t, list, quality, availability, versionList] = await Promise.all([
    getTranslations("App.Admin.SokoBots"),
    adminSokoBotService.list({ limit: FLEET_PAGE_LIMIT }),
    adminSokoBotService.quality({ versionId: qualityVersion }),
    adminSokoBotService.getAvailability().catch(() => ({
      disabled: false,
      disabledAt: null,
      disabledReason: null,
    })),
    adminSokoBotService.listVersions(),
  ]);
  // What the fleet actually runs today, counted from this page's own list, so
  // the migration control can say how many bots a choice would move before it
  // moves them. Bots with no version sit on the code default already.
  const inUse = [
    ...list.items
      .filter((item) => item.versionId && !item.archivedAt)
      .reduce((counts, item) => {
        const versionId = item.versionId as string;
        return counts.set(versionId, (counts.get(versionId) ?? 0) + 1);
      }, new Map<string, number>()),
  ]
    .map(([versionId, count]) => ({ versionId, count }))
    .sort((a, b) => b.count - a.count);
  const selectedVersionId = quality.versions.some(
    (version) => version.versionId === qualityVersion,
  )
    ? qualityVersion
    : null;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/soko-bots/versions">
                <GitBranch aria-hidden className="size-4" />
                {t("versionsLink")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/soko-bots/lab">
                <FlaskConical aria-hidden className="size-4" />
                {t("labLink")}
              </Link>
            </Button>
          </div>
        </div>

        <SokoBotKillSwitch initial={availability} />
        <FleetHealthSummary items={list.items} total={list.total} />
        <QualityOverview
          quality={quality}
          selectedVersionId={selectedVersionId}
        />
        <SokoBotVersionMigration
          versions={versionList.versions.map((version) => ({
            id: version.id,
            name: version.name,
          }))}
          defaultVersionId={versionList.defaultVersionId}
          inUse={inUse}
        />
        <SokoBotFleetTable initialList={list} limit={FLEET_PAGE_LIMIT} />
      </div>
    </div>
  );
}
