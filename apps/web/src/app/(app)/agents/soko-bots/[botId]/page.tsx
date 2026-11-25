import type { SokoBotDailyStats } from "@sokosumi/core-client";
import { MessageSquare, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  botBelongsTo,
  botName,
  botOwnerLabel,
  botPurpose,
  botStatusLabel,
} from "@/app/agents/bot-labels";
import {
  type DirectoryBot,
  loadBotDirectory,
} from "@/app/agents/soko-bot-directory";
import { ChatWithBotButton } from "@/app/soko-bots/components/open-bot-chat.client";
import {
  AboutList,
  AgentProfile,
  AgentProfileSkeleton,
} from "@/components/agents/directory/agent-profile";
import { AgentStatus } from "@/components/agents/directory/agent-status";
import { BotFace } from "@/components/soko-bot/bot-face";
import { Button } from "@/components/ui/button";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Directory");
  return { title: t("sokoBotsTitle") };
}

/** Stats are the owner's (or, for a shared bot, every member's) to read. */
function readStats(bot: DirectoryBot): Promise<SokoBotDailyStats | null> {
  if (bot.owner.kind === "person") return Promise.resolve(null);
  return sokoBotService
    .getStats(bot.owner.kind === "you" ? undefined : bot.id)
    .catch(() => null);
}

function consoleHref(bot: DirectoryBot): string {
  return bot.owner.kind === "you"
    ? sokoBotConsoleRoute()
    : sokoBotConsoleRoute(bot.id);
}

/** The shell reads no URL data; the profile streams in under it. */
export default function SokoBotProfilePage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  return (
    <Suspense fallback={<AgentProfileSkeleton />}>
      <SokoBotProfile params={params} />
    </Suspense>
  );
}

async function SokoBotProfile({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  await getSessionOrRedirect();
  const [{ botId }, t, format, directory] = await Promise.all([
    params,
    getTranslations("App.Agents.Directory"),
    getFormatter(),
    loadBotDirectory().catch(() => null),
  ]);
  const bot = directory?.bots.find((entry) => entry.id === botId);
  if (!directory || !bot) notFound();

  const stats = await readStats(bot);
  const name = botName(bot, t);
  const lastActive = bot.lastActivityAt
    ? format.relativeTime(bot.lastActivityAt)
    : null;

  const message = bot.sharedRoomId ? (
    <Button asChild variant="primary">
      <Link href={`/chat/rooms/${encodeURIComponent(bot.sharedRoomId)}`}>
        <MessageSquare aria-hidden className="size-4" />
        {t("message")}
      </Link>
    </Button>
  ) : (
    <ChatWithBotButton
      sokoBotId={bot.id}
      label={t("message")}
      errorLabel={t("messageError")}
      variant="primary"
    />
  );

  return (
    <AgentProfile
      backLabel={t("backToAgents")}
      avatar={
        <BotFace
          imageUrl={bot.avatarImageUrl}
          seed={bot.seed}
          alt={name}
          className="size-20"
        />
      }
      name={name}
      byline={botOwnerLabel(bot, t)}
      status={
        <AgentStatus status={bot.status} label={botStatusLabel(bot, t)} />
      }
      actions={message}
      sections={[
        {
          id: "what",
          title: t("sectionWhat"),
          content: (
            <p className="text-foreground text-sm leading-relaxed text-pretty">
              {t(`botDoes.${bot.owner.kind}`)}
            </p>
          ),
        },
        stats && {
          id: "work",
          title: t("sectionWork"),
          content: (
            <AboutList
              rows={[
                {
                  label: t("statTasks"),
                  value: t("statCount", {
                    count: stats.totals.tasks,
                    days: stats.days,
                  }),
                },
                {
                  label: t("statMessages"),
                  value: t("statCount", {
                    count: stats.totals.messages,
                    days: stats.days,
                  }),
                },
                {
                  label: t("statBackground"),
                  value: t("statCount", {
                    count: stats.totals.background,
                    days: stats.days,
                  }),
                },
              ]}
            />
          ),
        },
        bot.canConfigure && {
          id: "settings",
          title: t("sectionSettings"),
          content: (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted-foreground text-sm text-pretty">
                {t("botSettingsNote")}
              </p>
              <Button asChild variant="outline">
                <Link href={consoleHref(bot)}>
                  <Settings aria-hidden className="size-4" />
                  {t("openSettings")}
                </Link>
              </Button>
            </div>
          ),
        },
        {
          id: "about",
          title: t("sectionAbout"),
          content: (
            <AboutList
              rows={[
                { label: t("aboutBelongsTo"), value: botBelongsTo(bot, t) },
                { label: t("aboutKind"), value: botPurpose(bot, t) },
                { label: t("aboutWorkspace"), value: directory.workspaceName },
                ...(lastActive
                  ? [{ label: t("aboutLastActive"), value: lastActive }]
                  : []),
              ]}
            />
          ),
        },
      ]}
    />
  );
}
