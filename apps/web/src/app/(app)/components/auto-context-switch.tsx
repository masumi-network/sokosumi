"use client";

import { useAutoContextSwitch } from "@/hooks/effects/use-auto-context-switch";

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
  useAutoContextSwitch({
    activeOrganizationId,
    targetOrganizationId,
    successMessage,
  });

  return null;
}
