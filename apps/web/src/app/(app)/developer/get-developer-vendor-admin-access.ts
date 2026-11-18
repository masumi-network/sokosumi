import "server-only";

import type { VendorMembership } from "@sokosumi/core-client";
import { cache } from "react";

import { vendorService } from "@/lib/services/vendor.service";

export interface DeveloperVendorAdminAccess {
  showVendors: boolean;
  adminVendors: VendorMembership[];
}

/**
 * Developer Vendors is for VendorMember admins. Platform user.role=admin alone
 * does not grant it (use /admin/vendors); being platform admin does not block
 * it when the user is also a VendorMember admin.
 *
 * Cached per request: the sidebar, the Developer section row and the Vendors
 * pages all ask on the same render.
 */
export const getDeveloperVendorAdminAccess = cache(
  async (): Promise<DeveloperVendorAdminAccess> => {
    const adminVendors = await vendorService
      .listMyAdminVendorMemberships()
      .catch(() => []);

    return {
      showVendors: adminVendors.length > 0,
      adminVendors,
    };
  },
);
