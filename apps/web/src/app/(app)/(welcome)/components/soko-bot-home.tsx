import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { BotFace } from "@/app/soko-bots/components/bot-face";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";

import { SokoBotHomeComposer } from "./soko-bot-home-composer.client";
import type { SokoBotHomeChat } from "./soko-bot-home-data";

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
  recentChats: SokoBotHomeChat[];
  /** Tasks blocked on the user right now; the link hides at zero. */
  awaitingInput: number;
}

/**
 * `/` for a user with a personal Soko Bot: a composer that talks to the bot,
 * four action cards that prefill it, and the user's recent requests. The conversation
 * itself lives in the bot's Direct, which every send and row opens.
 */
export async function SokoBotHome({
  bot,
  ownerId,
  roomId,
  recentChats,
  awaitingInput,
}: SokoBotHomeProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Chat.Landing.SokoBotHome"),
    getFormatter(),
  ]);
  const botName = bot.name?.trim() || t("defaultName");
  const now = new Date();

  return (
    <SokoBotHomeComposer
      sokoBotId={bot.id}
      botName={botName}
      roomId={roomId}
      header={
        <div className="flex flex-col gap-4 px-4 pb-5 md:px-5">
          <div className="flex items-center gap-2.5">
            <BotFace bot={bot} ownerId={ownerId} className="size-7" />
            <span className="text-muted-foreground text-sm font-medium">
              {botName}
            </span>
          </div>
          <h1 className="text-foreground text-2xl font-light tracking-tight text-balance md:text-4xl">
            {t("heading")}
          </h1>
        </div>
      }
    >
      <div className="flex flex-col gap-6 px-3 pt-8 md:px-5">
        <section aria-labelledby="soko-bot-home-recent">
          <div className="flex items-baseline justify-between gap-4 px-4 pb-1">
            <h2
              id="soko-bot-home-recent"
              className="text-muted-foreground text-sm font-medium"
            >
              {t("recentTitle")}
            </h2>
            {awaitingInput > 0 ? (
              <Link
                href="/tasks"
                className="text-primary hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-md text-sm outline-none transition-colors focus-visible:ring-2"
              >
                {t("awaitingInput", { count: awaitingInput })}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </div>
          {recentChats.length > 0 && roomId ? (
            <ul>
              {recentChats.map((chat) => (
                <li key={chat.messageId}>
                  <Link
                    href={chatRoomMessageHref(roomId, chat.messageId)}
                    className="hover:bg-muted focus-visible:ring-ring flex min-w-0 items-baseline justify-between gap-4 rounded-md px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2"
                  >
                    <span className="text-foreground min-w-0 truncate">
                      {chat.title}
                    </span>
                    <time
                      dateTime={chat.createdAt.toISOString()}
                      title={format.dateTime(chat.createdAt, "dateTimeMedium")}
                      className="text-muted-foreground shrink-0 tabular-nums"
                    >
                      {format.relativeTime(chat.createdAt, {
                        now,
                        style: "narrow",
                      })}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-4 py-2 text-sm">
              {t("recentEmpty", { name: botName })}
            </p>
          )}
        </section>
      </div>
    </SokoBotHomeComposer>
  );
}
