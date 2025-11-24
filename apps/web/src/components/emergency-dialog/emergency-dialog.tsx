import { Suspense } from "react";

import { getEnvPublicConfig } from "@/config/env.public";

import { EmergencyDialogClient } from "./emergency-dialog.client";

export function EmergencyDialog() {
  const shouldShowEmergencyDialog =
    getEnvPublicConfig().NEXT_PUBLIC_SHOW_EMERGENCY_DIALOG;

  if (!shouldShowEmergencyDialog) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <EmergencyDialogClient />
    </Suspense>
  );
}

