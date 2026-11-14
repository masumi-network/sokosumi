"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { changeSokoBotNextRunAction } from "@/lib/actions/soko-bot/action";
import type { ChangeableBotRun } from "./feature-calendar-event";
import { useReportRunChangeFailure } from "./run-change";

type NextRunChange = { action: "skip" } | { action: "move"; scheduledAt: Date };

/**
 * Moves or skips a Soko Bot's next run, as the Calendar does a Task Schedule
 * Run. The action revalidates the Calendar, so the run shows at its new time
 * once Core accepted. A skip offers Undo, which moves the new next run back.
 */
export function useBotRunChanges() {
  const t = useTranslations("App.Calendar");
  const reportRunChangeFailure = useReportRunChangeFailure();

  async function send(
    item: ChangeableBotRun,
    expectedAt: Date,
    change: NextRunChange,
  ): Promise<Date | null> {
    try {
      const result = await changeSokoBotNextRunAction({
        botId: item.shared ? item.sokoBotId : undefined,
        input: { scheduleId: item.scheduleId, expectedAt, change },
      });
      if (result.ok) return result.value.nextRunAt;
      reportRunChangeFailure(result.error.kind);
    } catch {
      reportRunChangeFailure("failed");
    }
    return null;
  }

  async function skipBotRun(item: ChangeableBotRun) {
    const nextRunAt = await send(item, item.scheduledAt, { action: "skip" });
    if (!nextRunAt) return;
    toast.success(t("event.runSkipped", { name: item.name }), {
      action: {
        label: t("event.undo"),
        onClick: () =>
          void send(item, nextRunAt, {
            action: "move",
            scheduledAt: item.scheduledAt,
          }),
      },
    });
  }

  function moveBotRun(item: ChangeableBotRun, scheduledAt: Date) {
    void send(item, item.scheduledAt, { action: "move", scheduledAt });
  }

  return { moveBotRun, skipBotRun };
}
