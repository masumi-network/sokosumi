import "server-only";

import type { VendorMembership } from "@/lib/clients/generated/core";
import { vendorService } from "@/lib/services/vendor.service";

export interface DeveloperVendorAdminAccess {
  showVendors: boolean;
  adminVendors: VendorMembership[];
}

/**
 * Developer Vendors is for VendorMember admins. Platform user.role=admin alone
 * does not grant it (use /admin/vendors); being platform admin does not block
 * it when the user is also a VendorMember admin.
 */
export async function getDeveloperVendorAdminAccess(): Promise<DeveloperVendorAdminAccess> {
  const adminVendors = await vendorService
    .listMyAdminVendorMemberships()
    .catch(() => []);

  return {
    showVendors: adminVendors.length > 0,
    adminVendors,
  };
}
