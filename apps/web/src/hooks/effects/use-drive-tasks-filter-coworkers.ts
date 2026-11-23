"use client";

import { type Coworker, getCoworkers } from "@sokosumi/core-client";
import { useEffect, useRef, useState } from "react";
import { getBrowserCoreClient } from "@/lib/clients/core.browser.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";

function driveStoreKey(activeOrganizationId: string | null): string {
  const store = driveStoreForActiveWorkspace(activeOrganizationId);
  return store.scope === "org" ? `org:${store.organizationId}` : "me";
}

/**
 * Loads available task-capable coworkers for `DriveTasksFilters` whenever the
 * active workspace store changes, dropping any response whose store is no
 * longer current.
 */
export function useDriveTasksFilterCoworkers(
  activeOrganizationId: string | null,
): Coworker[] {
  const storeKey = driveStoreKey(activeOrganizationId);
  const [state, setState] = useState<{
    storeKey: string;
    coworkers: Coworker[];
  }>({ storeKey, coworkers: [] });
  const currentStoreKeyRef = useRef(storeKey);
  currentStoreKeyRef.current = storeKey;

  useEffect(() => {
    const controller = new AbortController();
    const requestStoreKey = storeKey;

    async function loadCoworkers() {
      try {
        const response = await getCoworkers({
          client: getBrowserCoreClient(),
          query: { scope: "available", capability: ["tasks"] },
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          currentStoreKeyRef.current === requestStoreKey
        ) {
          setState({
            storeKey: requestStoreKey,
            coworkers: response.data?.data ?? [],
          });
        }
      } catch {
        if (
          !controller.signal.aborted &&
          currentStoreKeyRef.current === requestStoreKey
        ) {
          setState({ storeKey: requestStoreKey, coworkers: [] });
        }
      }
    }
    void loadCoworkers();
    return () => {
      controller.abort();
    };
  }, [storeKey]);

  return state.storeKey === storeKey ? state.coworkers : [];
}
