import type { ReactNode } from "react";

import { OrganizationProductSeatRequired } from "@/components/billing/organization-product-seat-required";
import { isOrganizationProductLocked } from "@/lib/auth/is-organization-product-locked";

export async function OrganizationProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (await isOrganizationProductLocked()) {
    return <OrganizationProductSeatRequired />;
  }

  return children;
}
