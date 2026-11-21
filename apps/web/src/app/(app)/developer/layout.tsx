import type { ReactNode } from "react";

import { DeveloperSectionsHeader } from "@/app/developer/components/developer-sections-header";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";

/**
 * In the layout, not each page, so the heading and section row stay put while
 * a section loads. The admin lookup streams in and only adds Vendors.
 */
export default function DeveloperLayout({ children }: { children: ReactNode }) {
  const showVendors = getDeveloperVendorAdminAccess().then(
    (access) => access.showVendors,
  );
  return (
    <>
      <DeveloperSectionsHeader showVendors={showVendors} />
      {children}
    </>
  );
}
