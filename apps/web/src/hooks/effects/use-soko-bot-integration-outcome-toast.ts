"use client";

import type { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

export interface UseSokoBotIntegrationOutcomeToastOptions {
  integrationOutcome: string | null | undefined;
  router: Pick<ReturnType<typeof useRouter>, "replace">;
  t: (key: "Integrations.connected" | "Integrations.connectFailed") => string;
  consoleRoute: string;
}

/**
 * Displays the integration outcome toast on the Soko Bot console and strips the
 * callback outcome by replacing the URL with `consoleRoute`.
 */
export function useSokoBotIntegrationOutcomeToast({
  integrationOutcome,
  router,
  t,
  consoleRoute,
}: UseSokoBotIntegrationOutcomeToastOptions): void {
  useEffect(() => {
    if (!integrationOutcome) return;
    if (integrationOutcome === "active")
      toast.success(t("Integrations.connected"));
    else toast.error(t("Integrations.connectFailed"));
    router.replace(consoleRoute);
  }, [integrationOutcome, router, t, consoleRoute]);
}
