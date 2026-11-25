"use client";

import type { TaskEvent } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { highlightListMessage } from "@/app/chat/utils/room-message-highlight";
import { TASK_ACTIVITY_MESSAGE_LIST } from "@/app/tasks/utils/task-activity-feed";
import { useListHighlightCleanup } from "@/hooks/effects/use-list-highlight-cleanup";

/**
 * Tracks a pending "Jump to latest" comment id in `TaskActivitySection` and
 * highlights the message once it is rendered in the activity feed.
 */
export function useTaskActivityJumpHighlight(
  localEvents: TaskEvent[],
  commentsExpanded: boolean,
  feedItems: readonly unknown[],
): (eventId: string) => void {
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  useListHighlightCleanup(TASK_ACTIVITY_MESSAGE_LIST);

  useEffect(() => {
    if (!pendingJumpId) {
      return;
    }
    if (highlightListMessage(TASK_ACTIVITY_MESSAGE_LIST, pendingJumpId)) {
      setPendingJumpId(null);
    }
  }, [pendingJumpId, localEvents, commentsExpanded, feedItems]);

  return setPendingJumpId;
}
