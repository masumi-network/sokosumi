"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { OAuthClientRecord } from "@/app/developer/components/oauth-clients/types";
import { authClient } from "@/lib/auth/auth.client";

/**
 * Loads the developer OAuth clients list on mount and exposes refresh for
 * `useOAuthClients`.
 */
export function useOAuthClientsList(t: (key: "Messages.loadError") => string) {
  const [clients, setClients] = useState<OAuthClientRecord[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (isInitial = false) => {
      if (isInitial) {
        setIsInitialLoading(true);
      }
      setError(null);

      try {
        const result = await authClient.oauth2.getClients();
        if (result.error) {
          const errorMessage = result.error.message ?? t("Messages.loadError");
          setError(errorMessage);
          toast.error(errorMessage);
          return;
        }

        setClients(result.data ?? []);
      } catch {
        const errorMessage = t("Messages.loadError");
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        if (isInitial) {
          setIsInitialLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  return {
    clients,
    isInitialLoading,
    error,
    refresh,
  };
}
