"use client";

import { useEffect, useRef } from "react";

import { useOptionalNotifications } from "@/contexts/notification-provider";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";
import type { MarkReadForReferenceRequest } from "@/lib/clients/generated/core/types.gen";

interface MarkNotificationsReadProps {
  /**
   * Only kinds whose own page can stand for reading them. Chat is not one.
   *
   * Taken from the Core contract rather than written out again here, so a kind
   * added to or removed from the route cannot leave this page offering one the
   * route refuses.
   */
  kind: MarkReadForReferenceRequest["kind"];
  /** The task or job this page is showing. */
  referenceId: string;
}

/**
 * Marks a task's or a job's notifications read because the reader opened it.
 *
 * Renders nothing. A chat room already does this, in the same write that moves
 * its `lastReadAt`, so a room still unread is one nothing has happened to. A
 * task or a job had no such signal: the row stayed unread until the reader
 * opened the notification itself, so someone who fixed a stalled task from the
 * task page left it unread and the follow-up sync reminded them a day later
 * about work they had already finished (SOK-916).
 *
 * An Effect, deliberately. Telling the server what the reader has seen is
 * synchronisation with an external system, which is what Effects are for. It
 * is keyed on the reference so that moving between two tasks clears both,
 * rather than only whichever one happened to mount the component.
 */
export function MarkNotificationsRead({
  kind,
  referenceId,
}: MarkNotificationsReadProps): null {
  // Optional on purpose. Clearing the rows is the job; refreshing the bell is
  // a courtesy, and a surface that renders this outside the provider must not
  // lose its whole page over a courtesy.
  const notifications = useOptionalNotifications();

  // Held in a ref so the Effect depends on the page, not on the identity of a
  // callback the provider re-creates. In the dependency array it would re-run
  // the write on unrelated provider state changes.
  const refetchRef = useRef(notifications?.refetch);
  refetchRef.current = notifications?.refetch;

  useEffect(() => {
    void (async () => {
      try {
        const response =
          await notificationsBrowserClient.patchNotificationsReadForReference({
            kind,
            referenceId,
          });

        // Most opens clear nothing, and a refetch costs a request. Only a page
        // that actually read something makes the bell's badge wrong.
        //
        // Not skipped when this component has gone. The provider outlives it,
        // so a reader who opens a task and moves on before the write lands
        // would otherwise keep a badge counting rows that are now read.
        if (response.data.count === 0) {
          return;
        }

        await refetchRef.current?.();
      } catch {
        // Housekeeping. The reader came for the task, and a failure here costs
        // them one stale row rather than the page they asked for. The next
        // open tries again.
      }
    })();
  }, [kind, referenceId]);

  return null;
}
