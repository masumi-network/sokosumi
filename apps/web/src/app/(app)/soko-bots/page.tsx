import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasSokoBotBetaAccess } from "@/lib/beta-access";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { TeamRoster, YourAssistantCard } from "./components/roster";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBots");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/** Your assistant first, then everyone else's, paired with its person. */
export default async function SokoBotsPage() {
  const session = await getSessionOrRedirect();
  // Same beta gate as the assistant route.
  if (!hasSokoBotBetaAccess(session.user)) {
    notFound();
  }
  const [t, team] = await Promise.all([
    getTranslations("App.SokoBots"),
    sokoBotService.getTeam().catch((error) => {
      if (error instanceof CoreApiRequestError) return null;
      throw error;
    }),
  ]);
  const me = team?.members.find((member) => member.isYou) ?? null;
  const stats = me?.bot
    ? await sokoBotService.getStats().catch(() => null)
    : null;
  const others = team?.members.filter((member) => !member.isYou) ?? [];

  return (
    <div className="flex w-full flex-col gap-6 py-2">
      <header className="flex items-baseline gap-2">
        <h1 className="text-foreground text-sm font-semibold">{t("title")}</h1>
        {team ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("teamSummary", {
              bots: others.filter((member) => member.bot).length,
              people: others.length,
            })}
          </span>
        ) : null}
      </header>
      <YourAssistantCard me={me} stats={stats} />
      {team ? (
        <TeamRoster team={team} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
