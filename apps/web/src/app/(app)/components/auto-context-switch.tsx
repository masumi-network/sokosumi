"use client";

import { useEffect, useRef } from "react";

import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";

interface AutoContextSwitchProps {
  activeOrganizationId: string | null;
  targetOrganizationId: string | null;
  successMessage: string;
}

export function AutoContextSwitch({
  activeOrganizationId,
  targetOrganizationId,
  successMessage,
}: AutoContextSwitchProps) {
  const { handleSelectWorkspace } = useWorkspaceSwitcher();
  const hasTriggeredRef = useRef(false);
  const shouldSwitch = activeOrganizationId !== targetOrganizationId;

  useEffect(() => {
    if (!shouldSwitch || hasTriggeredRef.current) {
      return;
    }

    hasTriggeredRef.current = true;
    handleSelectWorkspace(targetOrganizationId, {
      shouldRedirectAgentJobsBasePath: false,
      successMessage,
    });
  }, [
    handleSelectWorkspace,
    shouldSwitch,
    successMessage,
    targetOrganizationId,
  ]);

  return null;
}
