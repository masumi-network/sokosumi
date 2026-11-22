"use client";

import { type Coworker, getCoworkers } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";

/**
 * Loads available task-capable coworkers for `DriveTasksFilters` whenever the
 * active organization changes.
 */
export function useDriveTasksFilterCoworkers(
  activeOrganizationId: string | null,
): Coworker[] {
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCoworkers() {
      try {
        const response = await getCoworkers({
          client: getBrowserCoreClient(),
          query: { scope: "available", capability: ["tasks"] },
        });
        if (!controller.signal.aborted) {
          setCoworkers(response.data?.data ?? []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setCoworkers([]);
        }
      }
    }
    void loadCoworkers();
    return () => {
      controller.abort();
    };
  }, [activeOrganizationId]);

  return coworkers;
}
