import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SokoBotVersionDetail } from "@/components/admin/soko-bots/soko-bot-version-detail";
import { SokoBotVersionForm } from "@/components/admin/soko-bots/soko-bot-version-form.client";
import { Button } from "@/components/ui/button";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { ADMIN_SOKO_BOT_VERSIONS_ROUTE } from "@/lib/soko-bot/constants";

import { loadVersionDetailSearchParams } from "../search-params";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Admin.SokoBots.Versions");
  return {
    title: t("detailMetadataTitle"),
    description: t("detailMetadataDescription"),
  };
}

interface SokoBotVersionDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SokoBotVersionDetailPage({
  params,
  searchParams,
}: SokoBotVersionDetailPageProps) {
  const [{ slug }, { mode }, t, catalog] = await Promise.all([
    params,
    loadVersionDetailSearchParams(searchParams),
    getTranslations("App.Admin.SokoBots.Versions"),
    adminSokoBotService.listVersions(),
  ]);
  const version = catalog.versions.find((item) => item.id === slug);
  if (!version) notFound();

  if (mode === "edit" && version.authored) {
    const gatewayModels = await adminSokoBotService.listGatewayModels();
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
          <header className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link
                href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(version.id)}`}
              >
                <ArrowLeft aria-hidden className="size-4" />
                {t("backToVersion")}
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("editTitle", { version: version.name })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
          </header>
          <SokoBotVersionForm
            mode="edit"
            initialVersion={version}
            gatewayModels={gatewayModels.models}
            availableSkills={catalog.availableSkills}
            availableCapabilities={catalog.availableCapabilities}
          />
        </div>
      </div>
    );
  }

  const [quality, labRuns] = await Promise.all([
    adminSokoBotService.quality({ versionId: version.id }),
    sokoBotService.listLabRuns(version.id),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={ADMIN_SOKO_BOT_VERSIONS_ROUTE}>
            <ArrowLeft aria-hidden className="size-4" />
            {t("backToVersions")}
          </Link>
        </Button>
        <SokoBotVersionDetail
          version={version}
          quality={quality}
          labRuns={labRuns}
        />
      </div>
    </div>
  );
}
