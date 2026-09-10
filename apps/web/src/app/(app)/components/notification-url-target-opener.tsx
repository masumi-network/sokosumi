"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useNotifications } from "@/contexts/notification-provider";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { NotificationTarget } from "@/lib/utils/notification-service-worker";
import {
  clearNotificationTargetFromUrl,
  readNotificationTargetFromUrl,
} from "@/lib/utils/notification-service-worker";

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
  const { isLoading } = useNotifications();
  const openNotification = useOpenNotification(markRead);
  const [pending, setPending] = useState<NotificationTarget | null>(null);
  const taken = useRef(false);

  /**
   * `handleSelectWorkspace` inside the hook is a new function on every render,
   * so the effect must not close over one render's copy. This keeps a stable
   * identity that runs the current one.
   */
  const openUrlTarget = useEffectEvent((target: NotificationTarget) => {
    // A banner whose click opened a window was unread when it was rendered.
    openNotification(target, false);
  });

  // Read on mount and left on the URL. Guarded because a mount effect does not
  // run only once: Strict Mode runs it twice, and a second `setPending` for a
  // target already opened would open it again.
  useMountEffect(() => {
    if (taken.current) {
      return;
    }

    taken.current = true;
    setPending(readNotificationTargetFromUrl());
  });

  useEffect(() => {
    // Held until the first list read settles. Marking a row read before the
    // list holds it leaves the optimistic update nothing to change, and the
    // snapshot that lands after it carries the row still unread: the reader
    // opens the notification and watches its badge stay. Core publishes
    // nothing for a mention read, so nothing would come along to correct it.
    //
    // `isLoading` falls on a failed read too, so a feed that will not load
    // delays the click rather than swallowing it.
    if (!pending || isLoading) {
      return;
    }

    // Spent here rather than on mount, so that the URL still carries the
    // target for the whole wait. `AuthSessionGuard` renders above the Suspense
    // boundary this component sits under (`app/(app)/layout.tsx:35`), probes
    // the session with the cookie cache disabled, and on a null answer
    // redirects to `/signin?returnUrl=` plus `window.location.pathname` and
    // `search` (`lib/utils/url.ts:39`). A push click arrives after a long
    // idle, which is when that probe is most likely to find the session gone.
    // Spending the parameter before it would sign the reader back in on `/`
    // with the notification lost, because nothing but this component's state
    // held it and that state does not survive the redirect.
    clearNotificationTargetFromUrl();
    setPending(null);
    openUrlTarget(pending);
  }, [pending, isLoading]);

  return null;
}
