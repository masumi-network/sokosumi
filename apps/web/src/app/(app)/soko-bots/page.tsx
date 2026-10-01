import { Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasSokoBotBetaAccess } from "@/lib/beta-access";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { SokoBotBoard } from "./components/soko-bot-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBots");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/** The workspace's assistants, laid out like the Task board. */
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
  const myBot = team?.members.find((member) => member.isYou)?.bot ?? null;
  const stats = myBot
    ? await sokoBotService.getStats().catch(() => null)
    : null;
  const others = team?.members.filter((member) => !member.isYou) ?? [];

  return (
    <div className="flex w-full flex-col gap-5 py-2">
      <h1 className="sr-only">{t("title")}</h1>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs tabular-nums">
          {team?.workspace.kind === "personal"
            ? t("teamDescriptionPersonal")
            : t("teamSummary", {
                bots: others.filter((member) => member.bot).length,
                people: others.length,
              })}
        </p>
        {myBot ? (
          <Button asChild size="sm" variant="outline">
            <Link href={SOKO_BOT_ROUTE}>
              <Settings aria-hidden className="size-3.5" />
              {t("manage")}
            </Link>
          </Button>
        ) : null}
      </div>
      {team ? (
        <SokoBotBoard team={team} stats={stats} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
    </div>
  );
}
