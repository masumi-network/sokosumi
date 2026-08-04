export type NotificationHrefKind =
  | "TASK"
  | "JOB"
  | "CHAT"
  | "SYSTEM"
  | "BILLING";

export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";

export interface NotificationHrefItem {
  kind: NotificationHrefKind;
  referenceId: string;
  metadata: Record<string, unknown> | null;
  messageKey?: string;
}

function buildVendorGrantReviewHref(organizationId: string | null): string {
  if (organizationId === null) {
    return "/account#vendor-workspace-access";
  }

  return `/organizations/${encodeURIComponent(organizationId)}#vendor-workspace-access`;
}

function resolvePendingVendorGrantHref(
  notification: Pick<
    NotificationHrefItem,
    "messageKey" | "referenceId" | "metadata"
  >,
): string | null {
  if (notification.messageKey !== VENDOR_GRANT_PENDING_MESSAGE_KEY) {
    return null;
  }

  if (!notification.referenceId) {
    return null;
  }

  const rawOrganizationId = notification.metadata?.organizationId;
  const organizationId =
    typeof rawOrganizationId === "string" ? rawOrganizationId : null;

  return buildVendorGrantReviewHref(organizationId);
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

    case "SYSTEM": {
      const vendorGrantHref = resolvePendingVendorGrantHref(notification);
      if (vendorGrantHref) {
        return vendorGrantHref;
      }
      return `/`;
    }

    case "BILLING":
      return `/`;

    default: {
      const _exhaustive: never = notification.kind;
      void _exhaustive;
      return `/`;
    }
  }
}
