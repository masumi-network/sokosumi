import {
  type Prisma,
  VendorGrantScope,
  VendorGrantStatus,
} from "@sokosumi/database";

import { mapWorkspaceSummary } from "@/helpers/workspace";
import { vendorGrantSchema, vendorSchema } from "@/schemas/vendor.schema";

type VendorGrantWithRelations = Prisma.VendorGrantGetPayload<{
  include: {
    vendor: true;
    workspace: {
      include: {
        user: { select: { id: true; name: true } };
        organization: { select: { id: true; name: true; slug: true } };
      };
    };
    _count: { select: { tasksAwaitingVendorApproval: true } };
  };
}>;

export function mapVendor(vendor: VendorGrantWithRelations["vendor"]) {
  return vendorSchema.parse(vendor);
}

export function mapVendorGrant(grant: VendorGrantWithRelations) {
  return vendorGrantSchema.parse({
    id: grant.id,
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
    scope: grant.scope,
    status: grant.status,
    vendorId: grant.vendorId,
    vendor: mapVendor(grant.vendor),
    userId: grant.userId,
    workspaceId: grant.workspaceId,
    workspace: mapWorkspaceSummary(grant.workspace),
    resolvedAt: grant.resolvedAt,
    awaitingVendorApprovalTaskCount: grant._count.tasksAwaitingVendorApproval,
  });
}

export const vendorGrantInclude = {
  vendor: true,
  workspace: {
    include: {
      user: { select: { id: true, name: true } },
      organization: { select: { id: true, name: true, slug: true } },
    },
  },
  _count: {
    select: {
      tasksAwaitingVendorApproval: true,
    },
  },
} as const satisfies Prisma.VendorGrantInclude;

export function canApproveGrant(status: VendorGrantStatus): boolean {
  return (
    status === VendorGrantStatus.PENDING ||
    status === VendorGrantStatus.DENIED ||
    status === VendorGrantStatus.REVOKED
  );
}

export function canDenyGrant(status: VendorGrantStatus): boolean {
  return status === VendorGrantStatus.PENDING;
}

export function resolveGrantScopeLabel(scope: VendorGrantScope): string {
  switch (scope) {
    case VendorGrantScope.VENDOR:
      return "vendor";
    case VendorGrantScope.WORKSPACE:
      return "workspace";
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}
