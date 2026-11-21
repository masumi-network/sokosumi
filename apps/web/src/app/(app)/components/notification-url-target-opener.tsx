"use client";

import { useNotificationUrlTargetOpener } from "@/hooks/effects/use-notification-url-target-opener";

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
  useNotificationUrlTargetOpener(markRead);

  return null;
}
