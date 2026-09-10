"use client";

import { useEffectEvent } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import type { NotificationTarget } from "@/lib/utils/notification-service-worker";
import { takeNotificationTargetFromUrl } from "@/lib/utils/notification-service-worker";

import { useOpenNotification } from "./use-open-notification";

interface NotificationUrlTargetOpenerProps {
  markRead: (id: string) => Promise<void>;
}

/**
 * Open the notification this window was opened for.
 *
 * A click no tab could take opens a window and leaves the target on its URL,
 * because there is no page yet to post one to. This reads it on mount.
 *
 * Mounted outside the realtime provider on purpose. The toast listener sits
 * inside it and does not exist until the Ably chunk has loaded and its client
 * has been built, which on a cold start is all ahead of the routing; a chunk
 * that 404s after a redeploy, or an Ably that will not start, would leave the
 * reader on the page that opened with nothing said. Spending a parameter that
 * is already in hand needs none of that.
 *
 * The two never race for the same target: this one takes it off the URL, and
 * the worker posts to a tab it focused rather than to one it opened.
 */
export function NotificationUrlTargetOpener({
  markRead,
}: NotificationUrlTargetOpenerProps) {
  const openNotification = useOpenNotification(markRead);

  /**
   * `handleSelectWorkspace` inside the hook is a new function on every render,
   * so the mount effect must not close over this render's copy. This keeps one
   * stable identity that runs the current one.
   */
  const openUrlTarget = useEffectEvent((target: NotificationTarget) => {
    // A banner whose click opened a window was unread when it was rendered.
    openNotification(target, false);
  });

  useMountEffect(() => {
    const target = takeNotificationTargetFromUrl();
    if (target) {
      openUrlTarget(target);
    }
  });

  return null;
}
