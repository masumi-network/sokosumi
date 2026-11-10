import type { TaskActivitySummary } from "@sokosumi/core-client";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { BotFace, botFaceSeed } from "@/components/soko-bot/bot-face";
import { chatRoomMessageHref } from "@/lib/utils/notification-href";
import { SokoBotHomeComposer } from "./soko-bot-home-composer.client";
import type { SokoBotHomeChat, SokoBotHomeTask } from "./soko-bot-home-data";

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
  /** Tasks the team moved in the last 24 hours, newest first. */
  teamTasks: SokoBotHomeTask[];
  /** Chats with a Soko Bot the reader took part in during the last 24 hours. */
  chats?: SokoBotHomeChat[];
  /** The reader's Tasks due today or overdue, first; nothing when none are. */
  myDay?: ReactNode;
  /** What waits on the reader, above the team's day; one line when nothing
   * does. */
  needsYou?: ReactNode;
}

/**
 * `/` for a user with a personal Soko Bot, laid out as an entry page: the bot
 * and a greeting over a centered composer, a few things to ask, and a quiet
 * list of what the team moved in the last day, with the reader's chats with
 * a Soko Bot among it. What needs the reader sits
 * above that list, in the same quiet style. The conversation itself lives
 * in the bot's Direct, which every send opens.
 */
export async function SokoBotHome({
  bot,
  ownerId,
  roomId,
  userName,
  summary,
  teamTasks,
  chats = [],
  myDay,
  needsYou,
}: SokoBotHomeProps) {
  const [t, tStats, tStatus, format] = await Promise.all([
    getTranslations("App.Chat.Landing.SokoBotHome"),
    getTranslations("App.Chat.Landing.stats"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getFormatter(),
  ]);
  const botName = bot.name?.trim() || t("defaultName");
  const now = new Date();
  const stats = summary
    ? [
        summary.completed > 0
          ? tStats("completed", { count: summary.completed })
          : null,
        summary.workedMinutes >= 60
          ? tStats("workedHours", {
              hours: Math.round(summary.workedMinutes / 60),
            })
          : summary.workedMinutes > 0
            ? tStats("worked", { minutes: summary.workedMinutes })
            : null,
        summary.createdByOtherHumans > 0
          ? tStats("byTeammates", { count: summary.createdByOtherHumans })
          : null,
      ].filter((stat): stat is string => stat !== null)
    : [];
  const awaitingInput = summary?.awaitingInput ?? 0;
  // One list, newest first: a chat sits among the Tasks by its last activity.
  const rows = [
    ...teamTasks.map((task) => ({
      kind: "task" as const,
      at: task.updatedAt,
      task,
    })),
    ...chats.map((chat) => ({ kind: "chat" as const, at: chat.at, chat })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const rowClassName =
    "hover:bg-accent focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2";
  const timeOf = (at: Date) => (
    <time
      dateTime={at.toISOString()}
      title={format.dateTime(at, "dateTimeMedium")}
      className="text-muted-foreground shrink-0 text-end text-sm whitespace-nowrap tabular-nums"
    >
      {format.relativeTime(at, { now })}
    </time>
  );

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
          <BotFace
            imageUrl={bot.avatarImageUrl}
            seed={botFaceSeed(bot, ownerId)}
            className="size-12"
          />
          <h1 className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-4xl">
            {userName ? t("headingWithName", { name: userName }) : t("heading")}
          </h1>
        </div>
      }
      attention={
        awaitingInput > 0 ? (
          <Link
            href="/tasks"
            className="bg-muted text-foreground hover:bg-quinary focus-visible:ring-ring inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2"
          >
            <span aria-hidden className="bg-foreground size-1.5 rounded-full" />
            {tStats("awaiting", { count: awaitingInput })}
          </Link>
        ) : null
      }
    >
      <div className="flex flex-col gap-10">
        {myDay}
        {needsYou}
        <section aria-labelledby="soko-bot-home-day">
          <h2
            id="soko-bot-home-day"
            className="text-foreground px-3 pb-2 text-sm font-medium"
          >
            {tStats("recent")}
            {stats.length > 0 ? (
              <span className="text-muted-foreground font-normal">
                {" "}
                · {stats.join(" · ")}
              </span>
            ) : null}
          </h2>
          {rows.length > 0 ? (
            <ul className="flex flex-col">
              {rows.map((row) =>
                row.kind === "chat" ? (
                  <li key={`chat:${row.chat.roomId}`}>
                    <Link
                      href={chatRoomMessageHref(
                        row.chat.roomId,
                        row.chat.messageId,
                      )}
                      className={rowClassName}
                    >
                      <MessageCircle
                        aria-hidden
                        className="text-muted-foreground size-4 shrink-0"
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {row.chat.title}
                      </span>
                      <span className="text-muted-foreground hidden shrink-0 text-sm sm:inline">
                        {t("chatKind")}
                      </span>
                      {timeOf(row.at)}
                      <span className="text-foreground shrink-0 text-sm font-medium">
                        {t("open")}
                      </span>
                    </Link>
                  </li>
                ) : (
                  <li key={row.task.id}>
                    <Link
                      href={`/tasks/${encodeURIComponent(row.task.id)}`}
                      className={rowClassName}
                    >
                      <TaskStatusBadge
                        status={row.task.status}
                        label={tStatus(row.task.status)}
                        showLabel={false}
                        className="border-0 bg-transparent p-0"
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {row.task.name}
                      </span>
                      <span className="text-muted-foreground hidden shrink-0 truncate text-sm sm:inline">
                        {row.task.who}
                      </span>
                      {timeOf(row.at)}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="text-muted-foreground px-3 py-2 text-sm">
              {t("quietDay", { name: botName })}
            </p>
          )}
        </section>
      </div>
    </SokoBotHomeComposer>
  );
}
