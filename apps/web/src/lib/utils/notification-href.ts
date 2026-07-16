import {
  CHAT_APP_ROUTE_PREFIX,
  FALLBACK_BUCKET_SEGMENT,
} from "@/app/chat-ui/utils/chat-route-base";
import type { NotificationKind } from "@/lib/clients/generated/core";

interface NotificationHrefItem {
  kind: NotificationKind;
  referenceId: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Get the href for a notification based on its kind and metadata.
 * Uses the same routing logic as History for consistency.
 */
export function getNotificationHref(
  notification: NotificationHrefItem,
): string {
  switch (notification.kind) {
    case "TASK":
      return `/tasks/${encodeURIComponent(notification.referenceId)}`;

    case "JOB": {
      const agentId = notification.metadata?.agentId;
      if (!agentId || typeof agentId !== "string") {
        return "/tasks";
      }
      return `/agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(notification.referenceId)}`;
    }

    case "CONVERSATION": {
      const bucketSlug = notification.metadata?.bucketSlug;
      const bucketSegment =
        typeof bucketSlug === "string" ? bucketSlug : FALLBACK_BUCKET_SEGMENT;
      return `${CHAT_APP_ROUTE_PREFIX}/${encodeURIComponent(bucketSegment)}/conversation/${encodeURIComponent(notification.referenceId)}?open=1`;
    }

    default:
      return `/`;
  }
}
