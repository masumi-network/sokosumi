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
  const [t, list, quality, availability, versionList, usage] =
    await Promise.all([
      getTranslations("App.Admin.SokoBots"),
      adminSokoBotService.list({ limit: FLEET_PAGE_LIMIT }),
      adminSokoBotService.quality({ versionId: qualityVersion }),
      adminSokoBotService.getAvailability().catch(() => ({
        disabled: false,
        disabledAt: null,
        disabledReason: null,
      })),
      adminSokoBotService.listVersions(),
      // Counted in Core across every live bot. Deriving this from `list.items`
      // would tell an operator they are moving twenty when the migration moves
      // every matching bot in the database.
      adminSokoBotService.versionUsage(),
    ]);
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
          inUse={usage.versions}
        />
        <SokoBotFleetTable initialList={list} limit={FLEET_PAGE_LIMIT} />
      </div>
    </div>
  );
}
