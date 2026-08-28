import type { ReactNode } from "react";

import { OrganizationProductLayout } from "@/lib/auth/organization-product-layout";

export default function DriveLayout({ children }: { children: ReactNode }) {
  return <OrganizationProductLayout>{children}</OrganizationProductLayout>;
}
