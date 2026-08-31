import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SokoBotVersionForm } from "@/components/admin/soko-bots/soko-bot-version-form.client";
import { Button } from "@/components/ui/button";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import { ADMIN_SOKO_BOT_VERSIONS_ROUTE } from "@/lib/soko-bot/constants";

import { loadCreateVersionSearchParams } from "../search-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Admin.SokoBots.Versions");
  return {
    title: t("createTitle"),
    description: t("createDescription"),
  };
}

interface CreateSokoBotVersionPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CreateSokoBotVersionPage({
  searchParams,
}: CreateSokoBotVersionPageProps) {
  const [{ from }, t, catalog, gatewayModels] = await Promise.all([
    loadCreateVersionSearchParams(searchParams),
    getTranslations("App.Admin.SokoBots.Versions"),
    adminSokoBotService.listVersions(),
    adminSokoBotService.listGatewayModels(),
  ]);
  const sourceVersion = from
    ? catalog.versions.find((version) => version.id === from)
    : null;
  if (from && !sourceVersion) notFound();

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <header className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={ADMIN_SOKO_BOT_VERSIONS_ROUTE}>
              <ArrowLeft aria-hidden className="size-4" />
              {t("backToVersions")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {sourceVersion ? t("duplicateTitle") : t("createTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {sourceVersion ? t("duplicateDescription") : t("createDescription")}
          </p>
        </header>

        <SokoBotVersionForm
          mode="create"
          initialVersion={sourceVersion}
          gatewayModels={gatewayModels.models}
          availableSkills={catalog.availableSkills}
          availableCapabilities={catalog.availableCapabilities}
        />
      </div>
    </div>
  );
}
