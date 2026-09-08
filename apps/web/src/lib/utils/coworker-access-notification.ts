import type { NotificationItem } from "@/lib/clients/generated/core";

export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

interface CoworkerAccessNotificationTarget {
  accessId: string;
  organizationId: string | null;
  organizationSlug: string | null;
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

  const rawOrganizationSlug = notification.metadata?.organizationSlug;
  const organizationSlug =
    typeof rawOrganizationSlug === "string" &&
    rawOrganizationSlug.trim().length > 0
      ? rawOrganizationSlug
      : null;

  return { accessId, organizationId, organizationSlug };
}

/**
 * Where a reader reviews a coworker's request for early access.
 *
 * Always a destination, for the same reason as the vendor-grant href it sits
 * beside: no organization means a personal request, reviewed on the account
 * page.
 */
export function buildCoworkerAccessReviewHref(params: {
  organizationId: string | null;
  organizationSlug?: string | null;
}): string {
  if (params.organizationId === null) {
    return "/account#coworker-early-access";
  }

  if (params.organizationSlug) {
    return `/organizations/${params.organizationSlug}#coworker-early-access`;
  }

  return `/organizations/${params.organizationId}#coworker-early-access`;
}
