"use client";

import { useEffect } from "react";

import { recordProjectVisit } from "@/hooks/use-recent-projects";

/**
 * Writes `projectId` to the reader's per-user/per-workspace visit log in
 * `localStorage` once the session user is known.
 */
export function useRecordProjectVisit(
  projectId: string,
  userId: string | undefined,
  organizationId: string | null,
): void {
  useEffect(() => {
    if (!userId) return;
    recordProjectVisit(projectId, { userId, organizationId });
  }, [projectId, userId, organizationId]);
}
