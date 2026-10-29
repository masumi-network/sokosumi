import "server-only";

import type { NotificationItem } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

export const notificationService = (() => {
  /** The Notification Center's Needs you rows, newest first. */
  async function listNeedsYou(limit: number): Promise<NotificationItem[]> {
    const result = await coreClient.getNotifications({
      needsAction: "true",
      limit,
    });
    return result.data;
  }

  return { listNeedsYou };
})();
