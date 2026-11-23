"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ApiKeyRecord } from "@/app/developer/components/api-keys/types";
import { authClient } from "@/lib/auth/auth.client";

/**
 * Loads the developer API keys list on mount and exposes refresh and state
 * updates for `useApiKeys`.
 */
export function useApiKeysList(t: (key: "Messages.loadError") => string) {
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (isInitial = false) => {
      if (isInitial) {
        setIsInitialLoading(true);
      }
      setError(null);

      try {
        const result = await authClient.apiKey.list();
        if (result.data) {
          setApiKeys(result.data.apiKeys);
        } else {
          const errorMessage = t("Messages.loadError");
          setError(errorMessage);
          toast.error(errorMessage);
        }
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
    refresh(true);
  }, [refresh]);

  return {
    apiKeys,
    setApiKeys,
    isInitialLoading,
    error,
    refresh,
  };
}
