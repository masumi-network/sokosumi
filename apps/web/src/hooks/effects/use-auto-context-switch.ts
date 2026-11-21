"use client";

import { useEffect, useRef } from "react";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";

interface UseAutoContextSwitchOptions {
  activeOrganizationId: string | null;
  targetOrganizationId: string | null;
  successMessage: string;
}

/**
 * Triggers a one-shot organization workspace switch on mount when the initial
 * active organization differs from `targetOrganizationId`.
 */
export function useAutoContextSwitch({
  activeOrganizationId,
  targetOrganizationId,
  successMessage,
}: UseAutoContextSwitchOptions): void {
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const hasTriggeredRef = useRef(false);
  const initialSwitchRef = useRef({
    shouldSwitch: activeOrganizationId !== targetOrganizationId,
    successMessage,
    targetOrganizationId,
  });

  useEffect(() => {
    const initialSwitch = initialSwitchRef.current;

    if (!initialSwitch.shouldSwitch || hasTriggeredRef.current) {
      return;
    }

    hasTriggeredRef.current = true;
    void handleSelectWorkspace(initialSwitch.targetOrganizationId, {
      shouldRedirectAgentJobsBasePath: false,
      shouldRedirectTaskDetailPath: false,
      successMessage: initialSwitch.successMessage,
    });
  }, [handleSelectWorkspace]);
}
