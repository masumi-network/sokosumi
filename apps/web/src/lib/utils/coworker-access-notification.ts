import type { NotificationItem } from "@/lib/clients/generated/core";

export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

interface CoworkerAccessNotificationTarget {
  accessId: string;
  organizationId: string | null;
}

export function isPendingCoworkerAccessNotification(
  notification: Pick<NotificationItem, "messageKey">,
): boolean {
  return notification.messageKey === COWORKER_ACCESS_PENDING_MESSAGE_KEY;
}

export function resolveCoworkerAccessNotificationTarget(
  notification: Pick<
    NotificationItem,
    "messageKey" | "referenceId" | "metadata"
  >,
): CoworkerAccessNotificationTarget | null {
  if (!isPendingCoworkerAccessNotification(notification)) {
    return null;
  }

  const accessId = notification.referenceId;
  if (!accessId) {
    return null;
  }

  const rawOrganizationId = notification.metadata?.organizationId;
  const organizationId =
    typeof rawOrganizationId === "string" ? rawOrganizationId : null;

  return { accessId, organizationId };
}

export function buildCoworkerAccessReviewHref(params: {
  organizationId: string | null;
  organizationSlug?: string | null;
}): string | null {
  if (params.organizationId === null) {
    return "/account#coworker-early-access";
  }

  if (params.organizationSlug) {
    return `/organizations/${params.organizationSlug}#coworker-early-access`;
  }

  return `/organizations/${params.organizationId}#coworker-early-access`;
}
