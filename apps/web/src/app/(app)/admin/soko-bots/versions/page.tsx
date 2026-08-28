import { ArrowLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SokoBotVersionList } from "@/components/admin/soko-bots/soko-bot-version-list";
import { Button } from "@/components/ui/button";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import {
  ADMIN_SOKO_BOT_VERSIONS_ROUTE,
  ADMIN_SOKO_BOTS_ROUTE,
} from "@/lib/soko-bot/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Admin.SokoBots.Versions");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function AdminSokoBotVersionsPage() {
  const [t, catalog] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Versions"),
    adminSokoBotService.listVersions(),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={ADMIN_SOKO_BOTS_ROUTE}>
                <ArrowLeft aria-hidden className="size-4" />
                {t("backToSokoBots")}
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button asChild variant="primary" size="sm">
            <Link href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/new`}>
              <Plus aria-hidden className="size-4" />
              {t("create")}
            </Link>
          </Button>
        </div>

        <SokoBotVersionList versions={catalog.versions} />
      </div>
    </div>
  );
}
