import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FleetHealthSummary } from "@/components/admin/soko-bots/fleet-health-summary";
import { SokoBotFleetTable } from "@/components/admin/soko-bots/soko-bot-fleet-table.client";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const metadata: Metadata = {
  title: "Soko Bots",
  description: "Soko Bot fleet health and operator controls",
};

const FLEET_PAGE_LIMIT = 100;

export default async function AdminSokoBotsPage() {
  const [t, list] = await Promise.all([
    getTranslations("App.Admin.SokoBots"),
    adminSokoBotService.list({ limit: FLEET_PAGE_LIMIT }),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>

        <FleetHealthSummary items={list.items} total={list.total} />
        <SokoBotFleetTable initialList={list} limit={FLEET_PAGE_LIMIT} />
      </div>
    </div>
  );
}
