import {
  type Prisma,
  type Vendor,
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

export function mapVendor(vendor: Vendor) {
  return vendorSchema.parse({
    id: vendor.id,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
    name: vendor.name,
    slug: vendor.slug,
    logos: {
      light: vendor.logoLight,
      dark: vendor.logoDark,
    },
  });
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

export function vendorLogoCreateData(
  logos: { light?: string | null; dark?: string | null } | undefined,
): Pick<Vendor, "logoLight" | "logoDark"> {
  return {
    logoLight: logos?.light ?? null,
    logoDark: logos?.dark ?? null,
  };
}

export function vendorLogoPatchData(
  logos: { light?: string | null; dark?: string | null } | undefined,
): Partial<Pick<Vendor, "logoLight" | "logoDark">> {
  if (logos === undefined) {
    return {};
  }

  return {
    ...(logos.light !== undefined ? { logoLight: logos.light } : {}),
    ...(logos.dark !== undefined ? { logoDark: logos.dark } : {}),
  };
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
