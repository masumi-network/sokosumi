"use client";

import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { startTransition, useOptimistic, useRef } from "react";

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
  const reportRunChangeFailure = useReportRunChangeFailure();
  const [shownItems, showRunChange] = useOptimistic(items, applyRunChange);
  // Per schedule, the last change sent and the revision it leaves. Core
  // raises the schedule revision on each Run change and refuses an old one,
  // and the shown entries keep the revision they were read with until every
  // write has ended. So a change waits for the one before it and sends the
  // newer of that revision and its own.
  const lastChangeBySchedule = useRef(new Map<string, Promise<number>>());

  function changeShownRun(item: ChangeableRun, action: "skip" | "restore") {
    startTransition(async () => {
      showRunChange({ runId: item.id, action });
      const queue = lastChangeBySchedule.current;
      const change = (queue.get(item.scheduleId) ?? Promise.resolve(0))
        .then(async (knownRevision) => {
          const scheduleRevision = Math.max(
            knownRevision,
            item.scheduleRevision,
          );
          try {
            const result = await changeRun(
              { ...item, scheduleRevision },
              { action },
            );
            if (result.ok) return result.value.revision;
            reportRunChangeFailure(result.error.kind);
          } catch {
            reportRunChangeFailure("failed");
          }
          // A refused change leaves the revision as it was.
          return scheduleRevision;
        })
        // A report that threw must not stop the changes after this one.
        .catch(() => item.scheduleRevision);
      queue.set(item.scheduleId, change);
      await change;
    });
  }

  return [shownItems, changeShownRun] as const;
}
