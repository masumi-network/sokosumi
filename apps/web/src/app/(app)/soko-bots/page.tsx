import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { SokoBotsHero } from "./components/soko-bots-hero";
import { TeamChart } from "./components/team-chart";

export const metadata: Metadata = { title: "Soko Bots" };

/**
 * What a Soko Bot is and the one action that matters, then the workspace:
 * every person and the Soko Bot they built.
 */
export default async function SokoBotsPage() {
  const session = await getSessionOrRedirect();
  // Same beta gate as the assistant route: while Soko Bot is limited to the
  // whitelisted domains, this page must not exist for anyone else either.
  if (!isBetaAccessEmail(session.user.email)) {
    notFound();
  }
  const [t, team, avatars] = await Promise.all([
    getTranslations("App.SokoBots"),
    sokoBotService.getTeam().catch((error) => {
      if (error instanceof CoreApiRequestError) return null;
      throw error;
    }),
    sokoBotService.listAvatars(5, []).catch(() => []),
  ]);
  const me = team?.members.find((member) => member.isYou) ?? null;

  return (
    <div className="w-full space-y-10 px-4 py-4 lg:px-6">
      <SokoBotsHero me={me} avatars={avatars} />
      {team ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3">
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
            <p className="text-muted-foreground text-xs tabular-nums">
              {t("peopleCount", { count: team.members.length })}
            </p>
          </div>
          <TeamChart team={team} />
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
