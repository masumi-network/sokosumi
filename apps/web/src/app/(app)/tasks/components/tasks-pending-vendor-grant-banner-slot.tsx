import { getSession } from "@/lib/auth/auth.server";
import type { VendorGrant } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services/user.service";
import { vendorGrantService } from "@/lib/services/vendor-grant.service";
import {
  buildVendorGrantReviewHref,
  canApproveVendorGrants,
  resolveViewerOrganizationMembership,
} from "@/lib/utils/vendor-grant-approval";
import {
  getActionablePendingGrants,
  groupVendorGrantsByVendor,
  orderGrantsForBundledActions,
} from "@/lib/utils/vendor-grant-display";

import { TasksPendingVendorGrantBanner } from "./tasks-pending-vendor-grant-banner";

interface TasksPendingVendorGrantBannerSlotProps {
  activeOrganizationId: string | null;
  parkedTaskCount: number;
}

export async function TasksPendingVendorGrantBannerSlot({
  activeOrganizationId,
  parkedTaskCount,
}: TasksPendingVendorGrantBannerSlotProps) {
  const [session, members] = await Promise.all([
    getSession(),
    userService.getMyMembersWithOrganizations(),
  ]);

  if (!session?.user.id) {
    return null;
  }

  const organizationId = activeOrganizationId;
  const viewerMembership = resolveViewerOrganizationMembership(
    organizationId,
    members,
  );
  const canApprove = canApproveVendorGrants({
    organizationId,
    isAuthenticated: true,
    viewerMembership,
  });

  let pendingGrants: VendorGrant[] = [];
  try {
    pendingGrants =
      organizationId === null
        ? await vendorGrantService.listMyVendorGrants({ status: "PENDING" })
        : await vendorGrantService.listVendorGrants(organizationId, {
            status: "PENDING",
          });
  } catch (error) {
    console.error(
      "Failed to load pending vendor grants for tasks banner",
      error,
    );
    return null;
  }

  const pendingGroups = groupVendorGrantsByVendor(pendingGrants).filter(
    (group) => group.hasPending,
  );

  if (pendingGroups.length === 0) {
    return null;
  }

  const grantIdsToApprove = canApprove
    ? orderGrantsForBundledActions(
        pendingGroups.flatMap((group) => getActionablePendingGrants(group)),
      ).map((grant) => grant.id)
    : [];

  const reviewHref = buildVendorGrantReviewHref({
    organizationId,
    organizationSlug: viewerMembership?.organization.slug,
  });

  if (!reviewHref) {
    return null;
  }

  return (
    <TasksPendingVendorGrantBanner
      canApprove={canApprove}
      organizationId={organizationId}
      reviewHref={reviewHref}
      vendorName={
        pendingGroups.length === 1
          ? (pendingGroups[0]?.vendorName ?? null)
          : null
      }
      pendingVendorCount={pendingGroups.length}
      grantIdsToApprove={grantIdsToApprove}
      parkedTaskCount={parkedTaskCount}
    />
  );
}
