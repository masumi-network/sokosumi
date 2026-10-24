import type { TaskActivitySummary } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { BotFace } from "@/app/soko-bots/components/bot-face";
import { TaskStatusInline } from "@/app/tasks/components/task-status-badge";

import { SokoBotHomeComposer } from "./soko-bot-home-composer.client";
import type { SokoBotHomeTask } from "./soko-bot-home-data";

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
}

/**
 * `/` for a user with a personal Soko Bot: a composer that talks to the bot,
 * then what the team got done in the last day. The conversation itself lives
 * in the bot's Direct, which every send opens.
 */
export async function SokoBotHome({
  bot,
  ownerId,
  roomId,
  userName,
  summary,
  teamTasks,
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
        summary.workedMinutes > 0
          ? tStats("worked", { minutes: summary.workedMinutes })
          : null,
        summary.createdByOtherHumans > 0
          ? tStats("byTeammates", { count: summary.createdByOtherHumans })
          : null,
      ].filter((stat): stat is string => stat !== null)
    : [];
  const awaitingInput = summary?.awaitingInput ?? 0;

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
            {userName ? t("headingWithName", { name: userName }) : t("heading")}
          </h1>
        </div>
      }
    >
      <section
        aria-labelledby="soko-bot-home-day"
        className="flex flex-col gap-3 px-3 pt-10 md:px-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4">
          <h2
            id="soko-bot-home-day"
            className="text-muted-foreground text-sm font-medium"
          >
            {tStats("recent")}
          </h2>
          {awaitingInput > 0 ? (
            <Link
              href="/tasks"
              className="text-primary hover:text-foreground focus-visible:ring-ring rounded-md text-sm outline-none transition-colors focus-visible:ring-2"
            >
              {tStats("awaiting", { count: awaitingInput })}
            </Link>
          ) : null}
        </div>
        {stats.length > 0 ? (
          <p className="text-foreground px-4 text-sm">{stats.join(" · ")}</p>
        ) : null}
        {teamTasks.length > 0 ? (
          <ul>
            {teamTasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${encodeURIComponent(task.id)}`}
                  className="hover:bg-muted focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-md px-4 py-2 text-sm outline-none transition-colors focus-visible:ring-2"
                >
                  <TaskStatusInline
                    status={task.status}
                    label={tStatus(task.status)}
                    className="w-32 shrink-0"
                  />
                  <span className="text-foreground min-w-0 flex-1 truncate">
                    {task.name}
                  </span>
                  {task.who ? (
                    <span className="text-muted-foreground hidden shrink-0 truncate sm:block sm:max-w-40">
                      {task.who}
                    </span>
                  ) : null}
                  <time
                    dateTime={task.updatedAt.toISOString()}
                    title={format.dateTime(task.updatedAt, "dateTimeMedium")}
                    className="text-muted-foreground shrink-0 text-right whitespace-nowrap tabular-nums sm:w-16"
                  >
                    {format.relativeTime(task.updatedAt, {
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
            {t("quietDay", { name: botName })}
          </p>
        )}
      </section>
    </SokoBotHomeComposer>
  );
}
