"use client";

import { useFormatter, useTranslations } from "next-intl";

import Markdown from "@/components/markdown";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ChatBot } from "@/lib/soko-bot/chat-state";

import { ArchiveSokoBotButton } from "../archive-soko-bot-button.client";
import { AutonomySettings } from "../autonomy-settings.client";
import { ResetMemoryButton } from "../reset-memory-button.client";
import { ScheduleForm } from "../schedule-form.client";
import { ScheduleRowActions } from "../schedule-row-actions.client";
import type { PanelKey } from "./header-chips";

function PanelSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function BotPanels({
  bot,
  openPanel,
  onOpenChange,
}: {
  bot: ChatBot;
  openPanel: PanelKey | null;
  onOpenChange: (panel: PanelKey | null) => void;
}) {
  const t = useTranslations("App.SokoBot");
  const format = useFormatter();
  const close = (open: boolean) => {
    if (!open) onOpenChange(null);
  };

  return (
    <>
      <PanelSheet
        open={openPanel === "autonomy"}
        onOpenChange={close}
        title={t("Chat.chips.autonomy")}
        description={t("Chat.chips.autonomyDescription")}
      >
        <AutonomySettings current={bot.autonomyLevel} />
      </PanelSheet>

      <PanelSheet
        open={openPanel === "schedules"}
        onOpenChange={close}
        title={t("Schedules.title")}
        description={t("Schedules.description")}
      >
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
                      ? format.dateTime(new Date(schedule.nextRunAt), {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : t("Schedules.disabled")}
                  </span>
                  {schedule.consecutiveFailures > 0 ? (
                    <span className="text-semantic-destructive ml-3 tabular-nums">
                      {t("Schedules.failures")} {schedule.consecutiveFailures}
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
      </PanelSheet>

      <PanelSheet
        open={openPanel === "memory"}
        onOpenChange={close}
        title={t("Memory.title")}
        description={t("Memory.description")}
      >
        {bot.memory ? (
          <>
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
            <Markdown className="prose prose-sm dark:prose-invert max-w-none text-sm">
              {bot.memory.markdown}
            </Markdown>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("Memory.empty")}</p>
        )}
        <div className="border-t pt-4">
          <ResetMemoryButton />
        </div>
      </PanelSheet>

      <PanelSheet
        open={openPanel === "settings"}
        onOpenChange={close}
        title={t("Settings.title")}
        description={t("Chat.chips.settingsDescription")}
      >
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("Settings.archiveTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t("Settings.archiveDescription")}
          </p>
          <ArchiveSokoBotButton />
        </div>
      </PanelSheet>
    </>
  );
}
