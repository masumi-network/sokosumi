import type {
  MemberWithOrganization,
  NotificationItem,
  VendorGrant,
} from "@/lib/clients/generated/core";

export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";
export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

export const VENDOR_GRANT_REVIEW_HASH = "vendor-workspace-access";
export const COWORKER_ACCESS_REVIEW_HASH = "coworker-early-access";

export type WorkspaceApprovalStatus = VendorGrant["status"];

export interface WorkspaceApprovalNotificationTarget {
  requestId: string;
  organizationId: string | null;
  organizationSlug: string | null;
}

export interface VendorGrantEntry {
  vendorId: string;
  vendorName: string;
  vendorSlug: string;
  grant: VendorGrant | null;
}

export type WorkspaceApprovalStatusMessageKey =
  | "statusPending"
  | "statusGranted"
  | "statusDenied"
  | "statusRevoked";

export function isPendingWorkspaceApprovalNotification(
  notification: Pick<NotificationItem, "messageKey">,
  messageKey: string,
): boolean {
  return notification.messageKey === messageKey;
}

export function resolveWorkspaceApprovalNotificationTarget(
  notification: Pick<
    NotificationItem,
    "messageKey" | "referenceId" | "metadata"
  >,
  messageKey: string,
): WorkspaceApprovalNotificationTarget | null {
  if (!isPendingWorkspaceApprovalNotification(notification, messageKey)) {
    return null;
  }

  const requestId = notification.referenceId;
  if (!requestId) {
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

  return { requestId, organizationId, organizationSlug };
}

/**
 * Where a reader reviews a workspace-access request.
 *
 * Always a destination: no organization means a personal request, reviewed on
 * the account page.
 */
export function buildWorkspaceApprovalReviewHref(params: {
  organizationId: string | null;
  organizationSlug?: string | null;
  hash: string;
}): string {
  if (params.organizationId === null) {
    return `/account#${params.hash}`;
  }

  if (params.organizationSlug) {
    return `/organizations/${params.organizationSlug}#${params.hash}`;
  }

  return `/organizations/${params.organizationId}#${params.hash}`;
}

export function resolveViewerOrganizationMembership(
  organizationId: string | null,
  members: MemberWithOrganization[],
): MemberWithOrganization | undefined {
  if (organizationId === null) {
    return undefined;
  }

  return members.find((member) => member.organizationId === organizationId);
}

export function canApproveWorkspaceAccess(params: {
  organizationId: string | null;
  isAuthenticated: boolean;
  viewerMembership?: MemberWithOrganization;
  taskOwnerId?: string | null;
  sessionUserId?: string | null;
}): boolean {
  if (!params.isAuthenticated) {
    return false;
  }

  if (params.organizationId === null) {
    if (
      params.taskOwnerId != null &&
      params.sessionUserId != null &&
      params.taskOwnerId !== params.sessionUserId
    ) {
      return false;
    }
    return true;
  }

  const role = params.viewerMembership?.role;
  return role === "owner" || role === "admin";
}

export function isWorkspaceApprovalPending(
  status: WorkspaceApprovalStatus | null | undefined,
): boolean {
  return status === "PENDING";
}

export function isWorkspaceApprovalGranted(
  status: WorkspaceApprovalStatus | null | undefined,
): boolean {
  return status === "GRANTED";
}

export function isWorkspaceApprovalDeniedOrRevoked(
  status: WorkspaceApprovalStatus | null | undefined,
): boolean {
  return status === "DENIED" || status === "REVOKED";
}

export function workspaceApprovalStatusMessageKey(
  status: WorkspaceApprovalStatus,
): WorkspaceApprovalStatusMessageKey {
  switch (status) {
    case "PENDING":
      return "statusPending";
    case "GRANTED":
      return "statusGranted";
    case "DENIED":
      return "statusDenied";
    case "REVOKED":
      return "statusRevoked";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function getPendingVendorIds(entries: VendorGrantEntry[]): string[] {
  return entries
    .filter((entry) => isWorkspaceApprovalPending(entry.grant?.status))
    .map((entry) => entry.vendorId);
}

/**
 * One card per vendor. Vendors with PENDING grants sort first, then by name.
 */
export function groupVendorGrantsByVendor(
  grants: VendorGrant[],
): VendorGrantEntry[] {
  const byVendor = new Map<string, VendorGrant>();

  for (const grant of grants) {
    const existing = byVendor.get(grant.vendorId);
    if (!existing || preferGrantForDisplay(grant, existing) === grant) {
      byVendor.set(grant.vendorId, grant);
    }
  }

  const entries: VendorGrantEntry[] = [];

  for (const grant of byVendor.values()) {
    entries.push({
      vendorId: grant.vendorId,
      vendorName: grant.vendorName,
      vendorSlug: grant.vendorSlug,
      grant,
    });
  }

  return entries.toSorted((left, right) => {
    const leftPending = isWorkspaceApprovalPending(left.grant?.status);
    const rightPending = isWorkspaceApprovalPending(right.grant?.status);
    if (leftPending !== rightPending) {
      return leftPending ? -1 : 1;
    }
    return left.vendorName.localeCompare(right.vendorName);
  });
}

function preferGrantForDisplay(
  candidate: VendorGrant,
  current: VendorGrant,
): VendorGrant {
  const rank = (status: WorkspaceApprovalStatus) => {
    switch (status) {
      case "PENDING":
        return 0;
      case "GRANTED":
        return 1;
      case "DENIED":
        return 2;
      case "REVOKED":
        return 3;
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  return rank(candidate.status) < rank(current.status) ? candidate : current;
}
