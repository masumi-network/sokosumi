import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { TeamChart } from "./components/team-chart";

export const metadata: Metadata = { title: "Soko Bots" };

/**
 * The org chart of the current workspace: every person and the Soko Bot
 * they built. Today that is one Personal Assistant per person; more kinds
 * of Soko Bots will hang off the same tree.
 */
export default async function SokoBotsPage() {
  await getSessionOrRedirect();
  const [t, team] = await Promise.all([
    getTranslations("App.SokoBots"),
    sokoBotService.getTeam().catch((error) => {
      if (error instanceof CoreApiRequestError) return null;
      throw error;
    }),
  ]);

  return (
    <div className="w-full space-y-6 px-4 py-4 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("description")}
        </p>
      </div>
      {team ? (
        <TeamChart team={team} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
