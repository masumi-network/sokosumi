import type { NotificationKind } from "@/lib/clients/generated/core";

interface NotificationHrefItem {
  kind: NotificationKind;
  referenceId: string;
  metadata: Record<string, unknown> | null;
}

function getRoomHrefFromMetadata(
  metadata: Record<string, unknown> | null,
): string | null {
  const roomId = metadata?.roomId;
  if (typeof roomId !== "string" || roomId.length === 0) {
    return null;
  }
  return `/chat/rooms/${encodeURIComponent(roomId)}`;
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

    case "SYSTEM":
    case "BILLING": {
      return getRoomHrefFromMetadata(notification.metadata) ?? `/`;
    }

    default: {
      const _exhaustive: never = notification.kind;
      void _exhaustive;
      return `/`;
    }
  }
}
