"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";

import type {
  ApiKeyRecord,
  CreateApiKeyRequest,
  CreateApiKeyResult,
  DeleteApiKeyRequest,
  UpdateApiKeyRequest,
  UseApiKeysReturn,
} from "../types";
import { getToggleActionText } from "../utils";

export function useApiKeys(): UseApiKeysReturn {
  const t = useTranslations("App.Account.ApiKeys");
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

  const create = useCallback(
    async (data: CreateApiKeyRequest): Promise<CreateApiKeyResult> => {
      try {
        const result = await authClient.apiKey.create({
          name: data.name,
        });

        if (result.data) {
          toast.success(t("Messages.createSuccess"));
          await refresh();
          return {
            success: true,
            data: {
              key: result.data.key,
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
    [refresh, t],
  );

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
    [refresh, t],
  );

  const deleteApiKey = useCallback(
    async (data: DeleteApiKeyRequest): Promise<boolean> => {
      try {
        const result = await authClient.apiKey.delete({
          keyId: data.keyId,
        });

        if (result.data) {
          toast.success(t("Messages.deleteSuccess"));
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
    [refresh, t],
  );

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
