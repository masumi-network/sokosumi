import "server-only";

import type { NotificationItem } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";

export const notificationService = (() => {
  /**
   * The Notification Center's Needs you rows, newest first; with `projectId`,
   * only the requests about that project's tasks and jobs.
   */
  async function listNeedsYou(
    limit: number,
    projectId?: string,
  ): Promise<NotificationItem[]> {
    const result = await coreClient.getNotifications({
      needsAction: "true",
      limit,
      projectId,
    });
    return result.data;
  }

  return { listNeedsYou };
})();
