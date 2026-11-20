"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  openProjectScope,
  openScopeCreate,
  type ProjectScopeRequest,
  resetScopeDialogs,
  setScopeCreateOpen,
} from "@/app/components/project-scope/sidebar-project-scope-state";

/**
 * Resets the module-scoped project scope dialogs when their host (the mobile
 * header chip) unmounts, e.g. when the reader leaves the app shell.
 */
export function useResetScopeDialogsOnUnmount(): void {
  useEffect(() => resetScopeDialogs, []);
}

/**
 * Opens the main project selector as required on mount and closes it on
 * unmount while the selector is still answering this request.
 */
export function useRequiredProjectScope(
  request: Omit<ProjectScopeRequest, "required">,
): void {
  const initialRequestRef = useRef(request);

  useEffect(
    () => openProjectScope({ ...initialRequestRef.current, required: true }),
    [],
  );
}

/**
 * Returns an imperative handler for project-required prompts that opens the
 * selector (and optionally Create project) and cleans up both on unmount only
 * when this prompt opened a request.
 */
export function useProjectScopePromptAction(): (
  request: Omit<ProjectScopeRequest, "required">,
  options?: { create?: boolean; opener?: HTMLElement | null },
) => void {
  const cancelRequestRef = useRef<ReturnType<typeof openProjectScope> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (cancelRequestRef.current) {
        cancelRequestRef.current();
        setScopeCreateOpen(false);
      }
    };
  }, []);

  return useCallback(
    (
      request: Omit<ProjectScopeRequest, "required">,
      options?: { create?: boolean; opener?: HTMLElement | null },
    ) => {
      cancelRequestRef.current = openProjectScope({
        ...request,
        required: true,
      });
      if (options?.create) {
        openScopeCreate(options.opener ?? null);
      }
    },
    [],
  );
}
