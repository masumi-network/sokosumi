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
    return (await readNeedsYou(limit, projectId)).notifications;
  }

  /**
   * {@link listNeedsYou}'s rows plus how many requests the view holds in all:
   * open asks about Tasks, Jobs, grants and access, from every workspace.
   */
  async function readNeedsYou(
    limit: number,
    projectId?: string,
  ): Promise<{ notifications: NotificationItem[]; total: number }> {
    const result = await coreClient.getNotifications({
      needsAction: "true",
      limit,
      projectId,
    });
    return {
      notifications: result.data,
      total: result.meta?.pagination?.total ?? result.data.length,
    };
  }

  return { listNeedsYou, readNeedsYou };
})();
