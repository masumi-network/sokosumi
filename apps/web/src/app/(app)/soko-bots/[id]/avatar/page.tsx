import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { AvatarStudio } from "@/app/personal-assistant/components/avatar-studio.client";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { SOKO_BOT_ROUTE, sokoBotConsoleRoute } from "@/lib/soko-bot/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.SokoBot.Avatar.Studio");
  return { title: t("metadata") };
}

export const instant = false;

interface SharedAvatarStudioPageProps {
  params: Promise<{ id: string }>;
}

/**
 * The avatar studio of a project or workspace bot, for those who manage it.
 * Other members see the avatar on the console and cannot edit it, so they go
 * back there; an unknown bot goes to the assistant page, as the console does.
 */
export default async function SharedAvatarStudioPage({
  params,
}: SharedAvatarStudioPageProps) {
  await connection();
  const [, { id }] = await Promise.all([getSessionOrRedirect(), params]);
  const summaries = await sokoBotService.listShared().catch(() => null);
  const summary = summaries?.find((bot) => bot.id === id) ?? null;
  if (!summary) redirect(SOKO_BOT_ROUTE);
  const consoleHref = sokoBotConsoleRoute(id);
  if (!summary.viewerCanManage || summary.archivedAt) redirect(consoleHref);
  const [studio, t] = await Promise.all([
    sokoBotService.getAvatarStudio(id).catch(() => null),
    getTranslations("App.SokoBot.Chat"),
  ]);
  if (!studio) redirect(consoleHref);

  return (
    <AvatarStudio
      botId={id}
      botName={summary.name?.trim() || t("defaultName")}
      consoleHref={consoleHref}
      initial={studio}
    />
  );
}
