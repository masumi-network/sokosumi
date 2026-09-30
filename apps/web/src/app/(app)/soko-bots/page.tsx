import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasSokoBotBetaAccess } from "@/lib/beta-access";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

import { TeamCarousel } from "./components/team-carousel";
import { YourAssistant } from "./components/your-assistant";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBots");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/** Your own assistant first, then everyone else's. */
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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 py-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("description")}
        </p>
      </header>
      <YourAssistant me={me} />
      {team ? (
        <TeamCarousel team={team} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
