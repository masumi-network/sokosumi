"use client";

import type { MarkNotificationsReadByReferenceRequest } from "@sokosumi/core-client";
import { useEffect, useRef } from "react";

import { useOptionalNotifications } from "@/contexts/notification-provider";
import { notificationsBrowserClient } from "@/lib/clients/core.notifications.browser.client";

/**
 * Marks a task's or a job's notifications read when opened and refreshes the
 * notification bell if any rows were cleared.
 */
export function useMarkNotificationsRead(
  kind: MarkNotificationsReadByReferenceRequest["kind"],
  referenceId: string,
): void {
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
          await notificationsBrowserClient.patchNotificationsRead({
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
}
