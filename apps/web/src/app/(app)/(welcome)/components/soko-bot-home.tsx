import type { TaskActivitySummary } from "@sokosumi/core-client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BotFace } from "@/app/soko-bots/components/bot-face";

import { SokoBotHomeComposer } from "./soko-bot-home-composer.client";

export interface SokoBotHomeBot {
  id: string;
  name: string | null;
  avatarSeed: string | null;
  avatarImageUrl: string | null;
}

interface SokoBotHomeProps {
  bot: SokoBotHomeBot;
  ownerId: string;
  roomId: string | null;
  /** First name for the greeting; none when the account has no name. */
  userName: string | null;
  summary: TaskActivitySummary | null;
}

/**
 * The top of `/` for a user with a personal Soko Bot: the bot and a greeting
 * over a centered composer and a few things to ask. The conversation itself
 * lives in the bot's Direct, which every send opens. What the team moved in
 * the last day sits below, in Home's team day panel.
 */
export async function SokoBotHome({
  bot,
  ownerId,
  roomId,
  userName,
  summary,
}: SokoBotHomeProps) {
  const [t, tStats] = await Promise.all([
    getTranslations("App.Chat.Landing.SokoBotHome"),
    getTranslations("App.Chat.Landing.stats"),
  ]);
  const botName = bot.name?.trim() || t("defaultName");
  const awaitingInput = summary?.awaitingInput ?? 0;

  const suggestions = [
    t("suggestions.catchUp"),
    t("suggestions.teamWins"),
    t("suggestions.planTomorrow"),
  ];

  return (
    <SokoBotHomeComposer
      sokoBotId={bot.id}
      botName={botName}
      roomId={roomId}
      suggestions={suggestions}
      header={
        <div className="flex flex-col items-center gap-5 text-center">
          <BotFace bot={bot} ownerId={ownerId} className="size-12" />
          <h1 className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-4xl">
            {userName ? t("headingWithName", { name: userName }) : t("heading")}
          </h1>
        </div>
      }
      attention={
        awaitingInput > 0 ? (
          <Link
            href="/tasks"
            className="bg-primary-quinary text-primary hover:bg-primary-quaternary focus-visible:ring-ring inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2"
          >
            <span aria-hidden className="bg-primary size-1.5 rounded-full" />
            {tStats("awaiting", { count: awaitingInput })}
          </Link>
        ) : null
      }
    />
  );
}
