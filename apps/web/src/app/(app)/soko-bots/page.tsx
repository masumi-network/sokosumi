import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { TeamChart } from "./components/team-chart";
import { YourSokoBots } from "./components/your-soko-bots";

export const metadata: Metadata = { title: "Soko Bots" };

/**
 * Your own Soko Bots first (create or open), then the team chart: every
 * person in the workspace and the Soko Bot they built.
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
  const me = team?.members.find((member) => member.isYou) ?? null;

  return (
    <div className="w-full space-y-8 px-4 py-4 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-foreground text-2xl font-light md:text-3xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("description")}
        </p>
      </div>
      {team ? (
        <>
          <YourSokoBots me={me} />
          <section className="space-y-3">
            <div>
              <h2 className="text-foreground text-lg font-medium">
                {t("teamTitle")}
              </h2>
              <p className="text-muted-foreground text-sm">
                {team.workspace.kind === "organization"
                  ? t("teamDescription")
                  : t("teamDescriptionPersonal")}
              </p>
            </div>
            <TeamChart team={team} />
          </section>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
