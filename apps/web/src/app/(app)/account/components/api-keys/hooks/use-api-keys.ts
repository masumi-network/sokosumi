"use client";

import { Apikey } from "@sokosumi/database";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CreateApiKeyRequest,
  CreateApiKeyResult,
  DeleteApiKeyRequest,
  UpdateApiKeyRequest,
  UseApiKeysReturn,
} from "@/app/account/components/api-keys/types";
import { getToggleActionText } from "@/app/account/components/api-keys/utils";
import { authClient } from "@/lib/auth/auth.client";

/**
 * Custom hook for managing API keys CRUD operations
 * Handles all API interactions, loading states, and error handling
 */
export function useApiKeys(): UseApiKeysReturn {
  const t = useTranslations("App.Account.ApiKeys");
  const [apiKeys, setApiKeys] = useState<Apikey[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Loads API keys from the server
   */
  const refresh = useCallback(
    async (isInitial = false) => {
      if (isInitial) {
        setIsInitialLoading(true);
      }
      setError(null);

      try {
        const result = await authClient.apiKey.list();
        if (result.data) {
          setApiKeys(result.data as Apikey[]);
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

  /**
   * Creates a new API key
   */
  const create = useCallback(
    async (data: CreateApiKeyRequest): Promise<CreateApiKeyResult> => {
      try {
        // Prepare metadata for organization-scoped API keys
        const metadata =
          data.scope === "organization" && data.organizationId
            ? { organizationId: data.organizationId }
            : undefined;

        const result = await authClient.apiKey.create({
          name: data.name,
          metadata,
        });

        if (result.data) {
          toast.success(t("Messages.createSuccess"));
          // Refresh the list to show the new key
          await refresh();
          return {
            success: true,
            data: {
              key: result.data.key,
              apiKey: result.data as Apikey,
            },
          };
        } else {
          const errorMessage =
            result.error?.message ?? t("Messages.createError");
          toast.error(errorMessage);
          return {
            success: false,
            error: {
              message: errorMessage,
            },
          };
        }
      } catch {
        const errorMessage = t("Messages.createError");
        toast.error(errorMessage);
        return {
          success: false,
          error: {
            message: errorMessage,
          },
        };
      }
    },
    [t, refresh],
  );

  /**
   * Updates an API key (currently only supports enabling/disabling)
   */
  const update = useCallback(
    async (data: UpdateApiKeyRequest): Promise<boolean> => {
      try {
        const result = await authClient.apiKey.update({
          keyId: data.keyId,
          enabled: data.enabled,
        });

        if (result.data) {
          const action = getToggleActionText(!data.enabled);
          toast.success(t("Messages.updateSuccess", { action }));
          // Refresh the list to show updated status
          await refresh();
          return true;
        } else {
          toast.error(result.error?.message ?? t("Messages.updateError"));
          return false;
        }
      } catch {
        toast.error(t("Messages.updateError"));
        return false;
      }
    },
    [t, refresh],
  );

  /**
   * Deletes an API key
   */
  const deleteApiKey = useCallback(
    async (data: DeleteApiKeyRequest): Promise<boolean> => {
      try {
        const result = await authClient.apiKey.delete({
          keyId: data.keyId,
        });

        if (result.data) {
          toast.success(t("Messages.deleteSuccess"));
          // Refresh the list to remove deleted key
          await refresh();
          return true;
        } else {
          toast.error(result.error?.message ?? t("Messages.deleteError"));
          return false;
        }
      } catch {
        toast.error(t("Messages.deleteError"));
        return false;
      }
    },
    [t, refresh],
  );

  // Effect is necessary: Initial data load when component mounts
  // This is synchronizing with external system (API) on mount
  useEffect(() => {
    refresh(true);
  }, [refresh]);

  return {
    apiKeys,
    isInitialLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteApiKey,
  };
}
