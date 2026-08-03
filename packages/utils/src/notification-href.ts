export type NotificationHrefKind =
  | "TASK"
  | "JOB"
  | "CHAT"
  | "SYSTEM"
  | "BILLING";

export interface NotificationHrefItem {
  kind: NotificationHrefKind;
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

    case "CHAT":
      return `/chat/rooms/${encodeURIComponent(notification.referenceId)}`;

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
