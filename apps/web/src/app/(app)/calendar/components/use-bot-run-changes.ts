"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { changeSokoBotScheduleRunAction } from "@/lib/actions/soko-bot/action";
import type { ChangeableBotRun } from "./feature-calendar-event";
import { useReportRunChangeFailure } from "./run-change";

type BotRunChange =
  | { action: "skip" | "restore" }
  | { action: "move"; scheduledAt: Date };

/**
 * Skips, moves or restores one Soko Bot run, as the Calendar does a Task
 * Schedule Run. The action revalidates the Calendar, so the run shows where
 * it now fires once Core accepted. A skip offers Undo.
 */
export function useBotRunChanges() {
  const t = useTranslations("App.Calendar");
  const reportRunChangeFailure = useReportRunChangeFailure();

  async function send(
    item: ChangeableBotRun,
    expectedAt: Date | null,
    change: BotRunChange,
  ): Promise<boolean> {
    try {
      const result = await changeSokoBotScheduleRunAction({
        botId: item.shared ? item.sokoBotId : undefined,
        input: {
          scheduleId: item.scheduleId,
          originalAt: item.originalAt,
          expectedAt,
          change,
        },
      });
      if (result.ok) return true;
      reportRunChangeFailure(result.error.kind);
    } catch {
      reportRunChangeFailure("failed");
    }
    return false;
  }

  async function skipBotRun(item: ChangeableBotRun) {
    if (!(await send(item, item.scheduledAt, { action: "skip" }))) return;
    toast.success(t("event.runSkipped", { name: item.name }), {
      action: {
        label: t("event.undo"),
        // A skipped run is shown nowhere (expected: null). Undo puts it back
        // where it was before the skip, a moved run included.
        onClick: () =>
          void send(
            item,
            null,
            item.originalAt.getTime() === item.scheduledAt.getTime()
              ? { action: "restore" }
              : { action: "move", scheduledAt: item.scheduledAt },
          ),
      },
    });
  }

  function moveBotRun(item: ChangeableBotRun, scheduledAt: Date) {
    void send(item, item.scheduledAt, { action: "move", scheduledAt });
  }

  function restoreBotRun(item: ChangeableBotRun) {
    void send(item, item.scheduledAt, { action: "restore" });
  }

  return { moveBotRun, restoreBotRun, skipBotRun };
}
