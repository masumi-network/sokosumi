"use client";

import type { ReadonlyURLSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type DriveRouter = Pick<ReturnType<typeof useRouter>, "replace">;

/**
 * Clears workspace-scoped Drive URL params (`folder`, `view`, `projectId`,
 * `taskId`, `assigneeId`, plus legacy/tab params) when switching workspaces.
 */
export function useDriveWorkspaceSwitchUrlReset(
  activeOrganizationId: string | null | undefined,
  router: DriveRouter,
  searchParams: ReadonlyURLSearchParams | URLSearchParams,
): void {
  const previousWorkspaceIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (activeOrganizationId === undefined) {
      return;
    }
    if (previousWorkspaceIdRef.current === undefined) {
      previousWorkspaceIdRef.current = activeOrganizationId;
      return;
    }
    if (previousWorkspaceIdRef.current === activeOrganizationId) {
      return;
    }
    previousWorkspaceIdRef.current = activeOrganizationId;
    if (
      !searchParams.get("folder") &&
      !searchParams.get("view") &&
      !searchParams.get("projectId") &&
      !searchParams.get("taskId") &&
      !searchParams.get("assigneeId")
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("scope");
    params.delete("archived");
    params.delete("tags");
    params.delete("folder");
    params.delete("view");
    params.delete("projectId");
    params.delete("taskId");
    params.delete("assigneeId");
    const query = params.toString();
    router.replace(query ? `/drive?${query}` : "/drive");
  }, [activeOrganizationId, router, searchParams]);
}
