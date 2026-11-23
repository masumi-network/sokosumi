"use client";

import { type RefObject, useEffect } from "react";

import {
  type openProjectScope,
  setScopeCreateOpen,
} from "@/app/components/project-scope/sidebar-project-scope-state";

/**
 * Cancels an open required project scope request and closes the create dialog
 * when `ProjectScopeRequired` unmounts or hides.
 */
export function useProjectScopeRequiredCleanup(
  cancelRequest: RefObject<ReturnType<typeof openProjectScope> | null>,
): void {
  useEffect(
    () => () => {
      if (cancelRequest.current) {
        cancelRequest.current();
        setScopeCreateOpen(false);
      }
    },
    [],
  );
}
