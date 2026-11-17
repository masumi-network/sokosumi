import { type ReactNode, Suspense } from "react";

import { DeveloperSectionsHeader } from "@/app/developer/components/developer-sections-header";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";

async function DeveloperSectionsHeaderWithAccess() {
  const { showVendors } = await getDeveloperVendorAdminAccess();
  return <DeveloperSectionsHeader showVendors={showVendors} />;
}

/**
 * In the layout, not each page, so the heading and section row stay put while
 * a section loads. Vendors joins the row once the admin lookup resolves.
 */
export default function DeveloperLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<DeveloperSectionsHeader showVendors={false} />}>
        <DeveloperSectionsHeaderWithAccess />
      </Suspense>
      {children}
    </>
  );
}
