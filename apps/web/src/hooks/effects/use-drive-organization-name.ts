"use client";

import { getUsersByIdOrganizations } from "@sokosumi/core-client";
import { useEffect, useRef, useState } from "react";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/**
 * Resolves the active organization's display name for `DrivePageWorkspace`
 * whenever the active organization or signed-in user changes.
 */
export function useDriveOrganizationName(
  activeOrganizationId: string | null,
  userId: string | undefined,
): string | null {
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const fetchOrgNameAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    async function fetchOrganizationName() {
      fetchOrgNameAbortRef.current?.abort();
      const controller = new AbortController();
      fetchOrgNameAbortRef.current = controller;

      if (!activeOrganizationId || !userId) {
        if (!controller.signal.aborted) {
          setOrganizationName(null);
        }
        return;
      }

      try {
        const response = await getUsersByIdOrganizations({
          client: getBrowserCoreClient(),
          path: { id: userId },
        });
        const orgs = response.data?.data || [];
        const activeOrg = orgs.find((org) => org.id === activeOrganizationId);
        if (!controller.signal.aborted) {
          setOrganizationName(activeOrg?.name ?? null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setOrganizationName(null);
        }
      }
    }

    void fetchOrganizationName();
  }, [activeOrganizationId, userId]);

  return organizationName;
}
