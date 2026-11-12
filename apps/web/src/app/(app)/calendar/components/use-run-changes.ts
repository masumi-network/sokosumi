"use client";

import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { startTransition, useOptimistic, useRef } from "react";
import { toast } from "sonner";

import {
  type ChangeableRun,
  changeRun,
  isTaskEntry,
  useReportRunChangeFailure,
} from "./run-change";

interface ShownRunChange {
  runId: string;
  action: "skip" | "restore";
}

/**
 * The entries as they will be once Core accepts the change: a skipped Run is
 * off the Calendar, a restored one is back at the rule's time.
 */
export function applyRunChange(
  items: WorkspaceCalendarEntry[],
  { runId, action }: ShownRunChange,
): WorkspaceCalendarEntry[] {
  if (action === "skip") {
    return items.filter((item) => item.id !== runId);
  }
  return items.map((item) =>
    item.id === runId && isTaskEntry(item) && item.originalScheduledAt
      ? { ...item, scheduledAt: item.originalScheduledAt }
      : item,
  );
}

/**
 * Skip and restore show at once. React drops the shown change when the write
 * ends: with the revalidated entries, or alone when Core refused, so the Run
 * is back where it was. While another change is still open, React holds
 * the shown changes together, so the Run can come back after its error toast.
 */
export function useRunChanges(items: WorkspaceCalendarEntry[]) {
  const t = useTranslations("App.Calendar");
  const reportRunChangeFailure = useReportRunChangeFailure();
  const [shownItems, showRunChange] = useOptimistic(items, applyRunChange);
  // Per schedule, the last change sent and the revision it leaves. Core
  // raises the schedule revision on each Run change and refuses an old one,
  // and the shown entries keep the revision they were read with until every
  // write has ended. So a change waits for the one before it and sends the
  // newer of that revision and its own.
  const lastChangeBySchedule = useRef(new Map<string, Promise<number>>());

  /** Sends a change after the last one of its schedule. */
  function sendInOrder(
    item: ChangeableRun,
    change: Parameters<typeof changeRun>[1],
    onAccepted?: () => void,
  ) {
    const queue = lastChangeBySchedule.current;
    const sent = (queue.get(item.scheduleId) ?? Promise.resolve(0))
      .then(async (knownRevision) => {
        const scheduleRevision = Math.max(knownRevision, item.scheduleRevision);
        try {
          const result = await changeRun({ ...item, scheduleRevision }, change);
          if (result.ok) {
            onAccepted?.();
            return result.value.revision;
          }
          reportRunChangeFailure(result.error.kind);
        } catch {
          reportRunChangeFailure("failed");
        }
        // A refused change leaves the revision as it was.
        return scheduleRevision;
      })
      // A report that threw must not stop the changes after this one.
      .catch(() => item.scheduleRevision);
    queue.set(item.scheduleId, sent);
    return sent;
  }

  // A skipped Run leaves the calendar, so its Undo lives here: it moves
  // the Run back to its time before the skip, a moved Run included
  // (Restore would reset it to the rule's time). The skip bumped the
  // schedule's revision by one.
  function offerSkipUndo(item: ChangeableRun) {
    toast.success(t("event.runSkipped", { name: item.taskName }), {
      action: {
        label: t("event.undo"),
        onClick: () =>
          void sendInOrder(
            { ...item, scheduleRevision: item.scheduleRevision + 1 },
            { action: "move", scheduledAt: item.scheduledAt },
          ),
      },
    });
  }

  function changeShownRun(item: ChangeableRun, action: "skip" | "restore") {
    startTransition(async () => {
      showRunChange({ runId: item.id, action });
      await sendInOrder(
        item,
        { action },
        action === "skip" ? () => offerSkipUndo(item) : undefined,
      );
    });
  }

  return [shownItems, changeShownRun] as const;
}
