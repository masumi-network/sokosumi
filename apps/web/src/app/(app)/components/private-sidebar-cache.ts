import "server-only";

import { updateTag } from "next/cache";
import { cache } from "react";
import { coreClient } from "@/lib/clients/core.client";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core";

export function privateSidebarUserTag(userId: string): string {
  return `app-sidebar-user-${userId}`;
}

export function privateSidebarOrgTag(organizationId: string): string {
  return `app-sidebar-org-${organizationId}`;
}

/**
 * Request-scoped credits read shared by private sidebar + overlays so a cold
 * layout fill does not double-hit Core for the same session.
 */
export const getCachedMyCredits = cache(
  async (): Promise<GetUsersByIdCreditsResponse | null> => {
    try {
      return (await coreClient.getMyCredits()) as GetUsersByIdCreditsResponse;
    } catch {
      return null;
    }
  },
);

interface InvalidatePrivateSidebarChromeArgs {
  userId: string;
  organizationId?: string | null;
  previousOrganizationId?: string | null;
}

/**
 * Clears browser private-cache entries for personalized sidebar chrome.
 * Call from Server Actions after org switch, room list mutations, or credits.
 */
export function invalidatePrivateSidebarChrome({
  userId,
  organizationId,
  previousOrganizationId,
}: InvalidatePrivateSidebarChromeArgs): void {
  updateTag(privateSidebarUserTag(userId));
  if (organizationId) {
    updateTag(privateSidebarOrgTag(organizationId));
  }
  if (previousOrganizationId && previousOrganizationId !== organizationId) {
    updateTag(privateSidebarOrgTag(previousOrganizationId));
  }
}
