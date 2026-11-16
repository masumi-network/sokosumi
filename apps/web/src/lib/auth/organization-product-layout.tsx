import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { OrganizationProductSeatRequired } from "@/components/billing/organization-product-seat-required";
import { isOrganizationProductLocked } from "@/lib/auth/is-organization-product-locked";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";

// Cached for the browser only, so a link prefetch from another section can
// carry the page under this layout.
async function isPrivateCachedProductLocked(): Promise<boolean> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return isOrganizationProductLocked();
}

export async function OrganizationProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locked = await isPrivateCachedProductLocked().catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      // A Core outage must not be kept in a prefetch as the error page, so
      // the click renders the layout fresh.
      await connection();
      return isOrganizationProductLocked();
    },
  );
  if (locked) {
    return <OrganizationProductSeatRequired />;
  }

  return children;
}
