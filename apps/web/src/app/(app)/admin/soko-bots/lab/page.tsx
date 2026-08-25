import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ScenarioLab } from "@/components/admin/soko-bots/scenario-lab.client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { sokoBotService } from "@/lib/services/soko-bot.service";

export const instant = false;

export const metadata: Metadata = {
  title: "Soko Bot behaviour lab",
  description: "Score agent versions against fixed scenarios",
};

/**
 * Runs the scenario suite against the admin's own Soko Bot: every run is a
 * real turn, scored deterministically and by the judge model, and recorded
 * per version for the quality overview.
 */
export default async function AdminSokoBotLabPage() {
  const [t, bot] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Lab"),
    sokoBotService.getMine(),
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
        {bot ? (
          <section className="bg-background rounded-lg border p-4">
            <ScenarioLab versionId={bot.versionId ?? null} />
          </section>
        ) : (
          <Alert>
            <AlertTitle>{t("noBotTitle")}</AlertTitle>
            <AlertDescription>
              {t("noBotDescription")}{" "}
              <Link
                href="/personal-assistant"
                className="underline underline-offset-4"
              >
                {t("noBotLink")}
              </Link>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
