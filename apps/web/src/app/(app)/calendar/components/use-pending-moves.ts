import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { useState } from "react";

interface PendingMove {
  item: WorkspaceCalendarEntry;
  scheduledAt: Date;
}

/**
 * Optimistic overlay for in-flight drops: a moved entry renders at the time it
 * was dropped at until Core confirms it or the caller rolls it back.
 * Unchanged server snapshots retain the move until its time or revision
 * changes.
 */
export function usePendingMoves(items: WorkspaceCalendarEntry[]) {
  const [pendingMoves, setPendingMoves] = useState<Record<string, PendingMove>>(
    {},
  );
  const retainedMoves = Object.entries(pendingMoves).filter(([, move]) => {
    const current = items.find((item) => item.id === move.item.id);
    if (
      !current ||
      current.scheduledAt.getTime() !== move.item.scheduledAt.getTime()
    ) {
      return false;
    }
    return current.kind === "socialPost"
      ? move.item.kind === "socialPost" &&
          current.revision === move.item.revision
      : move.item.kind !== "socialPost" &&
          current.scheduleRevision === move.item.scheduleRevision;
  });
  if (retainedMoves.length !== Object.keys(pendingMoves).length) {
    setPendingMoves(Object.fromEntries(retainedMoves));
  }

  return {
    pendingMoves,
    addPendingMove(item: WorkspaceCalendarEntry, scheduledAt: Date) {
      setPendingMoves((moves) => ({
        ...moves,
        [item.id]: { item, scheduledAt },
      }));
    },
    clearPendingMove(id: string) {
      setPendingMoves((moves) => {
        const { [id]: _dropped, ...rest } = moves;
        return rest;
      });
    },
  };
}
