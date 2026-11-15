import { TaskStatus } from "@sokosumi/core-client";
import { CalendarDays, Mail } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { GradientBackground } from "@/components/gradient-background";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

/**
 * `/` for a user without a personal Soko Bot: the orb the new bot starts
 * with, the way into its setup, and three small previews of what it does.
 */
export async function SokoBotSetup({ userId }: { userId: string }) {
  const t = await getTranslations("App.Chat.Landing.SokoBotSetup");
  const orbSeed = defaultOrbSeed(userId);

  return (
    <div className="relative isolate flex min-h-full w-full min-w-0 flex-1 flex-col items-center px-4">
      {/* Bleeds through main's p-4 to its edges, as on the Soko Bot Home. */}
      <GradientBackground className="absolute -inset-x-4 -top-4 -z-10 h-[42rem]" />
      <div className="flex w-full max-w-4xl flex-col items-center gap-8 pt-[10dvh] pb-10 md:pt-[16dvh]">
        <BotFace
          imageUrl={null}
          seed={orbSeed}
          orbSize={96}
          animate
          className="size-24"
        />
        <h1 className="text-foreground text-center text-3xl font-normal tracking-tight text-balance md:text-4xl">
          {t("title")}
        </h1>
        <Button asChild variant="primary" size="lg">
          <Link href={SOKO_BOT_ROUTE}>{t("cta")}</Link>
        </Button>

        <div className="grid w-full gap-4 pt-10 sm:grid-cols-3">
          <Preview caption={t("chat.caption")}>
            <p className="bg-muted text-foreground self-end rounded-2xl rounded-br-sm px-3 py-1.5 text-sm">
              {t("chat.ask")}
            </p>
            <div className="flex items-end gap-2">
              <BotFace
                imageUrl={null}
                seed={orbSeed}
                orbSize={24}
                className="size-6 shrink-0"
              />
              <p className="border-border text-foreground rounded-2xl rounded-bl-sm border px-3 py-1.5 text-sm">
                {t("chat.reply")}
              </p>
            </div>
          </Preview>

          <Preview caption={t("tasks.caption")}>
            <TaskRow status={TaskStatus.COMPLETED} name={t("tasks.brief")} />
            <TaskRow status={TaskStatus.RUNNING} name={t("tasks.research")} />
            <TaskRow status={TaskStatus.QUEUED} name={t("tasks.book")} />
          </Preview>

          <Preview caption={t("inbox.caption")}>
            <InboxRow
              icon={<Mail className="size-4" />}
              title={t("inbox.mail")}
              tag={t("inbox.needsYou")}
            />
            <InboxRow
              icon={<CalendarDays className="size-4" />}
              title={t("inbox.meeting")}
              tag={t("inbox.prepReady")}
            />
          </Preview>
        </div>
      </div>
    </div>
  );
}

/** A small card mocking one thing the bot does, with a caption under it. */
function Preview({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div
        aria-hidden
        className="bg-card border-border flex h-36 flex-col justify-center gap-2 rounded-xl border p-4 shadow-sm"
      >
        {children}
      </div>
      <figcaption className="text-foreground text-center text-sm font-medium">
        {caption}
      </figcaption>
    </figure>
  );
}

function TaskRow({ status, name }: { status: TaskStatus; name: string }) {
  const spec = getTaskStatusMarker(status);
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusMarker spec={spec} tone={getToneStyle(spec.tone).onSurface} />
      <span className="text-foreground truncate">{name}</span>
    </div>
  );
}

function InboxRow({
  icon,
  title,
  tag,
}: {
  icon: ReactNode;
  title: string;
  tag: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-foreground min-w-0 flex-1 truncate">{title}</span>
      <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
        {tag}
      </span>
    </div>
  );
}
