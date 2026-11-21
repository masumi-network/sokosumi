"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { NotificationCenterView } from "@/contexts/notification-state";
import {
  getNotificationViewPreference,
  setNotificationViewPreference,
} from "@/contexts/notification-view-storage";

/**
 * Restores the remembered Notification Center view in a layout effect before
 * paint and before the initial fetch runs, keeping a live ref synchronized with
 * committed switches.
 */
export function useNotificationViewPreference() {
  const [view, setViewState] = useState<NotificationCenterView>("all");
  // The view the next request asks for. A ref so the fetch callbacks keep
  // their identity across switches: the switch itself starts the refetch.
  const viewRef = useRef<NotificationCenterView>(view);

  // The view the reader last chose, restored before the first fetch below.
  // A seed, not a switch: there is no loaded list to tear down yet, and the
  // ref is what the first request reads, so that request already asks for
  // the remembered view instead of fetching All and replacing it.
  //
  // Before paint, not after, or the strip underlines All for one frame and
  // then jumps. The server's markup and the first client render still agree
  // on "all", so hydration is unaffected; only the commit that follows it
  // carries the remembered view. Same seam, and the same reason, as the
  // chat composer's own restore in RoomOpenLoadingView.
  useLayoutEffect(() => {
    const remembered = getNotificationViewPreference();
    if (remembered === null || remembered === viewRef.current) return;
    viewRef.current = remembered;
    setViewState(remembered);
  }, []);

  const commitView = useCallback((next: NotificationCenterView) => {
    viewRef.current = next;
    setViewState(next);
    setNotificationViewPreference(next);
  }, []);

  return { view, viewRef, commitView };
}
