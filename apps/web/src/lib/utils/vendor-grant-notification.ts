import type { NotificationItem } from "@/lib/clients/generated/core";

export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";

interface VendorGrantNotificationTarget {
  grantId: string;
  organizationId: string | null;
}

export function isPendingVendorGrantNotification(
  notification: Pick<NotificationItem, "messageKey">,
): boolean {
  return notification.messageKey === VENDOR_GRANT_PENDING_MESSAGE_KEY;
}

export function resolveVendorGrantNotificationTarget(
  notification: Pick<
    NotificationItem,
    "messageKey" | "referenceId" | "metadata"
  >,
): VendorGrantNotificationTarget | null {
  if (!isPendingVendorGrantNotification(notification)) {
    return null;
  }

  const grantId = notification.referenceId;
  if (!grantId) {
    return null;
  }

  const rawOrganizationId = notification.metadata?.organizationId;
  const organizationId =
    typeof rawOrganizationId === "string" ? rawOrganizationId : null;

  return { grantId, organizationId };
}
