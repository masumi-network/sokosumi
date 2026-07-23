import "server-only";

import { getSession } from "@/lib/auth/auth.server";
import { hasAdminRole } from "@/lib/auth/has-admin-role";
import type { VendorMembership } from "@/lib/clients/generated/core";
import { vendorService } from "@/lib/services/vendor.service";

export interface DeveloperVendorAdminAccess {
  showVendors: boolean;
  adminVendors: VendorMembership[];
}

/**
 * Platform admins manage vendors under /admin. Developer Vendors nav/page is
 * only for VendorMember admins (not user.role=admin).
 */
export async function getDeveloperVendorAdminAccess(): Promise<DeveloperVendorAdminAccess> {
  const session = await getSession();
  if (hasAdminRole(session?.user.role)) {
    return { showVendors: false, adminVendors: [] };
  }

  const adminVendors = await vendorService
    .listMyAdminVendorMemberships()
    .catch(() => []);

  return {
    showVendors: adminVendors.length > 0,
    adminVendors,
  };
}
