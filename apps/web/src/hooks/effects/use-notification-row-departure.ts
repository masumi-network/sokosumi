"use client";

import { useEffect } from "react";

/** How long the collapse takes, matched to the transition in `LeavingRow`. */
const LEAVE_DURATION_MS = 200;

/**
 * Delays hiding a read notification row in `NotificationCenterList`'s Unread
 * view until its 200ms fold finishes (or hides immediately under reduced
 * motion), cancelling the timer if the row stops collapsing.
 */
export function useNotificationRowDeparture(
  isCollapsed: boolean,
  notificationId: string,
  onDeparted: (id: string) => void,
  reduceMotion: boolean,
): void {
  // The hide waits for the fold to finish. A row put back to unread mid
  // fold is no longer collapsed, and the cleanup drops the pending hide.
  useEffect(() => {
    if (!isCollapsed) return;
    if (reduceMotion) {
      onDeparted(notificationId);
      return;
    }
    const timer = window.setTimeout(() => {
      onDeparted(notificationId);
    }, LEAVE_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [isCollapsed, notificationId, onDeparted, reduceMotion]);
}
