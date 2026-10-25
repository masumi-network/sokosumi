import type { TaskActivitySummary } from "@sokosumi/core-client";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { DRIVE_SURFACE_PANEL_CLASS } from "@/app/drive/components/drive-view-layout";
import { BotFace } from "@/app/soko-bots/components/bot-face";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { cn } from "@/lib/utils";

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
        className="px-3 pt-10 md:px-5"
      >
        {/* The Files and Schedules list: a soft panel of bordered rows. */}
        <div
          className={cn(DRIVE_SURFACE_PANEL_CLASS, "flex flex-col gap-2 p-2")}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 pt-1">
            <h2
              id="soko-bot-home-day"
              className="text-muted-foreground text-xs font-medium"
            >
              {tStats("recent")}
              {stats.length > 0 ? (
                <span className="text-foreground"> · {stats.join(" · ")}</span>
              ) : null}
            </h2>
            {awaitingInput > 0 ? (
              <Link
                href="/tasks"
                className="text-primary hover:text-foreground focus-visible:ring-ring rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2"
              >
                {tStats("awaiting", { count: awaitingInput })}
              </Link>
            ) : null}
          </div>
          {teamTasks.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {teamTasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/tasks/${encodeURIComponent(task.id)}`}
                    className="bg-background hover:bg-card-background-hover focus-visible:ring-ring flex min-w-0 items-center gap-4 rounded-lg border border-border px-4 py-3 outline-none transition-colors focus-visible:ring-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground line-clamp-1 text-sm font-medium">
                        {task.name}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {task.who ? `${task.who} · ` : null}
                        <time
                          dateTime={task.updatedAt.toISOString()}
                          title={format.dateTime(
                            task.updatedAt,
                            "dateTimeMedium",
                          )}
                        >
                          {format.relativeTime(task.updatedAt, { now })}
                        </time>
                      </span>
                    </div>
                    <TaskStatusBadge
                      status={task.status}
                      label={tStatus(task.status)}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {t("quietDay", { name: botName })}
            </p>
          )}
        </div>
      </section>
    </SokoBotHomeComposer>
  );
}
