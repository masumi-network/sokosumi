"use client";

import { FlaskConical, MessageSquare } from "lucide-react";
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
import type { SokoBotAvatar } from "@/lib/clients/generated/core";
import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";
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
import { ResetMemoryButton } from "../reset-memory-button.client";
import { ScheduleForm } from "../schedule-form.client";
import { ScheduleRowActions } from "../schedule-row-actions.client";

import { ActivityList } from "./activity-list.client";
import { ScenarioLab } from "./scenario-lab.client";

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
    <section className={cn("bg-background rounded-lg border", className)}>
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

const LAB_OPEN_KEY = "soko-bot-lab:open";

export interface SokoBotConsoleProps {
  initialState: SokoBotChatState;
  userName: string | null;
  userImageUrl: string | null;
  /** Turn to scroll to / highlight (from a chat "review approval" link). */
  focusTurnId: string | null;
  /** Platform admins see the behaviour lab. */
  isAdmin: boolean;
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
  isAdmin,
}: SokoBotConsoleProps) {
  const t = useTranslations("App.SokoBot");
  const format = useFormatter();
  const router = useRouter();
  const { state, refresh } = useSokoBotState(initialState);
  const { bot } = state;
  const botName = bot.name?.trim() || t("Chat.defaultName");
  // Same seed Core hands chat participants, so console and room match.
  const seed = bot.avatarSeed ?? `orb:${bot.userId}`;
  const [isOpeningChat, startOpeningChat] = useTransition();
  const [pickedAvatar, setPickedAvatar] = useState<SokoBotAvatar | null>(null);
  const [isSavingAvatar, startSavingAvatar] = useTransition();
  const [labOpen, setLabOpen] = useState(false);

  useEffect(() => {
    try {
      setLabOpen(localStorage.getItem(LAB_OPEN_KEY) === "1");
    } catch {
      // Storage unavailable: the lab just starts hidden.
    }
  }, []);

  function toggleLab() {
    const next = !labOpen;
    setLabOpen(next);
    try {
      localStorage.setItem(LAB_OPEN_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable.
    }
  }

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
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-4">
          <header className="flex flex-wrap items-center gap-4">
            <AssistantAvatar size="lg" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {botName}
                </h1>
                <SokoBotStatusBadge status={bot.status} />
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
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Lab.toggle")}
                aria-pressed={labOpen}
                onClick={toggleLab}
                className={cn(labOpen && "bg-muted")}
              >
                <FlaskConical aria-hidden className="size-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={openChat}
              disabled={!bot.coworkerId || isOpeningChat}
            >
              <MessageSquare aria-hidden className="size-4" />
              {isOpeningChat ? t("Console.openingChat") : t("Console.openChat")}
            </Button>
          </header>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-6">
              {isAdmin && labOpen ? (
                <Section
                  title={t("Lab.title")}
                  description={t("Lab.description")}
                >
                  <ScenarioLab
                    presetId={bot.presetId}
                    onTurnFinished={refresh}
                  />
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
                              <p className="truncate text-sm font-medium">
                                {schedule.name}
                              </p>
                              <p className="text-muted-foreground font-mono text-xs">
                                {schedule.cronExpression} · {schedule.timezone}
                              </p>
                            </div>
                            <ScheduleRowActions
                              scheduleId={schedule.id}
                              enabled={schedule.enabled}
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
                      <span className="ml-3">
                        {t("Memory.version")}{" "}
                        <span className="text-foreground tabular-nums">
                          {bot.memory.version}
                        </span>
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
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t("Settings.archiveTitle")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("Settings.archiveDescription")}
                  </p>
                  <ArchiveSokoBotButton />
                </div>
              </Section>
            </aside>
          </div>
        </div>
      </AssistantImageContext.Provider>
    </AssistantSeedContext.Provider>
  );
}
