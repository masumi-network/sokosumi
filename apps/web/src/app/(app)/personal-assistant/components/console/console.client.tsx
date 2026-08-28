"use client";

import { MessageSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import Markdown from "@/components/markdown";
import { SokoBotStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { Button } from "@/components/ui/button";
import { claimSokoBotAvatarAction } from "@/lib/actions/soko-bot/action";
import type {
  SokoBotAvatar,
  SokoBotDailyStats,
  SokoBotInstalledSkill,
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
  SokoBotVersion,
} from "@/lib/clients/generated/core";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { describeCron } from "@/lib/soko-bot/describe-cron";
import { cn } from "@/lib/utils";
import { ArchiveSokoBotButton } from "../archive-soko-bot-button.client";
import { AvatarPicker } from "../avatar-picker.client";
import {
  AssistantAvatar,
  AssistantImageContext,
  AssistantSeedContext,
} from "../chat/assistant-avatar";
import { orderedTurns } from "../chat/timeline";
import { useSokoBotState } from "../chat/use-soko-bot-state";
import { FollowBoardToggle } from "../follow-board-toggle.client";
import { HowItWorks } from "../how-it-works";
import { IntegrationsSection } from "../integrations-section.client";
import { ProactiveSettings } from "../proactive-settings.client";
import { ResetMemoryButton } from "../reset-memory-button.client";
import { ScheduleForm } from "../schedule-form.client";
import { ScheduleRowActions } from "../schedule-row-actions.client";
import { SkillsSection } from "../skills-section.client";

import { ActivityList } from "./activity-list.client";
import { DailyStats } from "./daily-stats";

function Section({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-background rounded-xl border", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export interface SokoBotConsoleProps {
  initialState: SokoBotChatState;
  userName: string | null;
  userImageUrl: string | null;
  /** Turn to scroll to / highlight (from a chat "review approval" link). */
  focusTurnId: string | null;
  /** The agent version this bot runs: skills and tool allowlist. */
  version: SokoBotVersion | null;
  installedSkills: SokoBotInstalledSkill[];
  stats: SokoBotDailyStats | null;
  integrations: SokoBotIntegrations | null;
  adminHref: string | null;
  catalog: SokoBotIntegrationCatalogEntry[];
  /** Outcome of an OAuth round-trip we just returned from, if any. */
  integrationOutcome: string | null;
}

/**
 * The assistant's console: what it is waiting on, what it did, what it runs
 * on a schedule, what it remembers, and how much it may do alone. Talking to
 * it happens in chat (its direct room), not here.
 */
export function SokoBotConsole({
  initialState,
  userName,
  userImageUrl,
  focusTurnId,
  version,
  installedSkills,
  stats,
  integrations,
  adminHref,
  catalog,
  integrationOutcome,
}: SokoBotConsoleProps) {
  const t = useTranslations("App.SokoBot");
  const format = useFormatter();
  const router = useRouter();
  const { state, refresh } = useSokoBotState(initialState);
  useEffect(() => {
    if (!integrationOutcome) return;
    if (integrationOutcome === "active")
      toast.success(t("Integrations.connected"));
    else toast.error(t("Integrations.connectFailed"));
    router.replace(SOKO_BOT_ROUTE);
  }, [integrationOutcome, router, t]);
  const { bot } = state;
  const botName = bot.name?.trim() || t("Chat.defaultName");
  // Same seed Core hands chat participants, so console and room match.
  const seed = bot.avatarSeed ?? `orb:${bot.userId}`;
  const [isOpeningChat, startOpeningChat] = useTransition();
  const [pickedAvatar, setPickedAvatar] = useState<SokoBotAvatar | null>(null);
  const [isSavingAvatar, startSavingAvatar] = useTransition();
  function saveAvatar() {
    if (!pickedAvatar) return;
    const avatarId = pickedAvatar.id;
    startSavingAvatar(async () => {
      const result = await claimSokoBotAvatarAction({ avatarId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Avatar.saveError"));
        return;
      }
      toast.success(t("Avatar.saved"));
      setPickedAvatar(null);
      await refresh();
      router.refresh();
    });
  }

  const turns = useMemo(() => orderedTurns(state).reverse(), [state]);

  function openChat() {
    if (!bot.coworkerId) return;
    const coworkerId = bot.coworkerId;
    startOpeningChat(async () => {
      const result = await ensureCoworkerDirectRoomAction(coworkerId);
      if (!result.ok || !result.value) {
        toast.error(t("Console.openChatError"));
        return;
      }
      router.push(`/chat/rooms/${encodeURIComponent(result.value.id)}`);
    });
  }

  return (
    <AssistantSeedContext.Provider value={seed}>
      <AssistantImageContext.Provider value={bot.avatarImageUrl}>
        <div className="w-full space-y-6 px-4 py-4 lg:px-6">
          <header className="flex flex-wrap items-center gap-5 py-2">
            <AssistantAvatar size="lg" className="ring-primary/25 ring-4" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-foreground truncate text-2xl font-light md:text-3xl">
                  {botName}
                </h1>
                <SokoBotStatusBadge status={bot.status} />
                {version ? (
                  <span
                    className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs tabular-nums"
                    title={`${version.name} · ${version.model}\n${version.summary}`}
                  >
                    <span className="text-foreground font-medium">
                      {version.id}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="max-w-[16rem] truncate">
                      {version.model.replace(/^[a-z]+\//, "")}
                    </span>
                    {version.inferenceRegion ? (
                      <span className="bg-primary/10 text-primary rounded px-1 uppercase">
                        {version.inferenceRegion}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-sm">
                {t("Console.tagline")}
                {bot.lastActivityAt ? (
                  <span className="ml-2 tabular-nums" suppressHydrationWarning>
                    ·{" "}
                    {t("Console.lastActivity", {
                      time: format.relativeTime(
                        new Date(bot.lastActivityAt),
                        new Date(),
                      ),
                    })}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
              {adminHref ? (
                <Button
                  variant="outline"
                  asChild
                  className="flex-1 sm:flex-none"
                >
                  <Link href={adminHref}>
                    <ShieldCheck aria-hidden className="size-4" />
                    {t("Console.adminView")}
                  </Link>
                </Button>
              ) : null}
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                onClick={openChat}
                disabled={!bot.coworkerId || isOpeningChat}
              >
                <MessageSquare aria-hidden className="size-4" />
                {isOpeningChat
                  ? t("Console.openingChat")
                  : t("Console.openChat")}
              </Button>
            </div>
          </header>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-6">
              {stats ? (
                <Section
                  title={t("Console.Stats.title")}
                  description={t("Console.Stats.description", {
                    days: stats.days,
                  })}
                >
                  <DailyStats stats={stats} />
                </Section>
              ) : null}
              <Section
                title={t("Console.activityTitle")}
                description={t("Console.activityDescription")}
              >
                {turns.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t("Console.activityEmpty")}
                  </p>
                ) : (
                  <ActivityList
                    turns={turns}
                    focusTurnId={focusTurnId}
                    userImageUrl={userImageUrl}
                    userName={userName}
                    onDecisionResolved={refresh}
                  />
                )}
              </Section>
              <Section
                title={t("HowItWorks.title")}
                description={t("HowItWorks.description")}
              >
                <HowItWorks schedules={bot.schedules} />
              </Section>
              <Section
                title={t("Console.skillsTitle")}
                description={t("Console.skillsDescription")}
              >
                <SkillsSection
                  version={version}
                  initialInstalled={installedSkills}
                />
              </Section>
              {integrations ? (
                <Section
                  title={t("Integrations.title")}
                  description={t("Integrations.description")}
                >
                  <IntegrationsSection
                    initial={integrations}
                    catalog={catalog}
                  />
                </Section>
              ) : null}
            </div>

            <aside className="space-y-6">
              <Section
                title={t("Schedules.title")}
                description={t("Schedules.description")}
                aside={
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("Schedules.count", { count: bot.schedules.length })}
                  </span>
                }
              >
                <div className="space-y-4">
                  {bot.schedules.length > 0 ? (
                    <ul className="divide-y rounded-md border">
                      {bot.schedules.map((schedule) => (
                        <li key={schedule.id} className="space-y-1.5 px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                                <span className="truncate">
                                  {schedule.name}
                                </span>
                                {schedule.systemKey ? (
                                  <span className="text-muted-foreground shrink-0 text-[0.6875rem] tracking-wide uppercase">
                                    {t("Schedules.builtIn")}
                                  </span>
                                ) : null}
                              </p>
                              <p
                                className="text-muted-foreground text-xs"
                                title={`${schedule.cronExpression} · ${schedule.timezone}`}
                              >
                                {describeCron(schedule.cronExpression)}
                              </p>
                            </div>
                            <ScheduleRowActions
                              scheduleId={schedule.id}
                              enabled={schedule.enabled}
                              deletable={!schedule.systemKey}
                            />
                          </div>
                          <p className="text-muted-foreground line-clamp-2 text-xs">
                            {schedule.prompt}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {t("Schedules.nextRun")}{" "}
                            <span className="text-foreground tabular-nums">
                              {schedule.enabled
                                ? format.dateTime(
                                    new Date(schedule.nextRunAt),
                                    {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    },
                                  )
                                : t("Schedules.disabled")}
                            </span>
                            {schedule.consecutiveFailures > 0 ? (
                              <span className="text-semantic-destructive ml-3 tabular-nums">
                                {t("Schedules.failures")}{" "}
                                {schedule.consecutiveFailures}
                              </span>
                            ) : null}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t("Schedules.empty")}
                    </p>
                  )}
                  <ScheduleForm />
                </div>
              </Section>

              <Section
                title={t("Memory.title")}
                description={t("Memory.description")}
                aside={<ResetMemoryButton />}
              >
                {bot.memory ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {t("Memory.updated")}{" "}
                      <span className="text-foreground tabular-nums">
                        {format.dateTime(new Date(bot.memory.createdAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </p>
                    <Markdown className="prose prose-sm dark:prose-invert max-h-80 max-w-none overflow-y-auto text-sm">
                      {bot.memory.markdown}
                    </Markdown>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("Memory.empty")}
                  </p>
                )}
              </Section>

              <Section
                title={t("Avatar.title")}
                description={t("Avatar.description")}
                aside={
                  pickedAvatar ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSavingAvatar}
                      onClick={saveAvatar}
                    >
                      {isSavingAvatar ? t("Avatar.saving") : t("Avatar.save")}
                    </Button>
                  ) : null
                }
              >
                <AvatarPicker
                  value={pickedAvatar?.id ?? null}
                  onChange={setPickedAvatar}
                  currentImageUrl={bot.avatarImageUrl}
                />
              </Section>

              <Section
                title={t("Settings.title")}
                description={t("Chat.chips.settingsDescription")}
              >
                <div className="space-y-5">
                  <ProactiveSettings
                    initial={{
                      paused: bot.proactivePaused,
                      dailyLimit: bot.proactiveDailyLimit,
                      timezone: bot.ingestTimezone,
                    }}
                    usedToday={stats?.proactive.usedToday ?? null}
                  />
                  <FollowBoardToggle initial={bot.followWholeBoard ?? false} />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {t("Settings.archiveTitle")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("Settings.archiveDescription")}
                    </p>
                    <ArchiveSokoBotButton />
                  </div>
                </div>
              </Section>
            </aside>
          </div>
        </div>
      </AssistantImageContext.Provider>
    </AssistantSeedContext.Provider>
  );
}
