import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

import { AvatarStudio } from "../components/avatar-studio.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBot.Avatar.Studio");
  return { title: t("metadata") };
}

export const instant = false;

/**
 * The avatar studio of the caller's own bot. Anyone who cannot change it (no
 * bot, Soko Bots unavailable) goes back to the console, which says why.
 */
export default async function AvatarStudioPage() {
  await connection();
  await getSessionOrRedirect();
  const [bot, t] = await Promise.all([
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.SokoBot.Chat"),
  ]);
  if (!bot?.viewerCanManage) redirect(SOKO_BOT_ROUTE);
  const studio = await sokoBotService.getAvatarStudio().catch(() => null);
  if (!studio) redirect(SOKO_BOT_ROUTE);

  return (
    <AvatarStudio
      botId={null}
      botName={bot.name?.trim() || t("defaultName")}
      consoleHref={SOKO_BOT_ROUTE}
      initial={studio}
    />
  );
}
