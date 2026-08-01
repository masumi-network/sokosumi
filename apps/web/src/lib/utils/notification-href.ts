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
): string | null {
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

    case "CHAT": {
      const roomIdFromMetadata = notification.metadata?.roomId;
      const roomId =
        typeof roomIdFromMetadata === "string" && roomIdFromMetadata.length > 0
          ? roomIdFromMetadata
          : notification.referenceId;
      if (!roomId) {
        return `/`;
      }
      return `/chat/rooms/${encodeURIComponent(roomId)}`;
    }

    case "SYSTEM":
    case "BILLING":
      return `/`;

    default: {
      const _exhaustive: never = notification.kind;
      void _exhaustive;
      return `/`;
    }
  }
}
