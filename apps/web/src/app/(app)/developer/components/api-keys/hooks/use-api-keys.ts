"use client";

import { useTranslations } from "next-intl";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

import { useApiKeysList } from "@/hooks/effects/use-api-keys-list";
import { authClient } from "@/lib/auth/auth.client";

import type {
  CreateApiKeyRequest,
  CreateApiKeyResult,
  DeleteApiKeyRequest,
  UpdateApiKeyRequest,
  UseApiKeysReturn,
} from "../types";
import { getToggleActionText } from "../utils";

export function useApiKeys(): UseApiKeysReturn {
  const t = useTranslations("App.Account.ApiKeys");
  const { apiKeys, setApiKeys, isInitialLoading, error, refresh } =
    useApiKeysList(t);
  // Keys with a toggle on the wire. A second click on one is dropped until
  // the first has its answer, so two requests for one key cannot cross.
  const updatingKeyIds = useRef(new Set<string>());

  const create = useCallback(
    async (data: CreateApiKeyRequest): Promise<CreateApiKeyResult> => {
      try {
        const result = await authClient.apiKey.create({
          name: data.name,
        });

        if (result.data) {
          toast.success(t("Messages.createSuccess"));
          // Reveal the one-time key immediately; list refresh is non-blocking.
          void refresh();
          return {
            ok: true,
            value: {
              key: result.data.key,
            },
          };
        } else {
          const errorMessage =
            result.error?.message ?? t("Messages.createError");
          toast.error(errorMessage);
          return {
            ok: false,
            error: {
              message: errorMessage,
            },
          };
        }
      } catch {
        const errorMessage = t("Messages.createError");
        toast.error(errorMessage);
        return {
          ok: false,
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
      if (updatingKeyIds.current.has(data.keyId)) {
        return false;
      }
      updatingKeyIds.current.add(data.keyId);
      const setEnabled = (enabled: boolean) =>
        setApiKeys((keys) =>
          keys.map((key) =>
            key.id === data.keyId ? { ...key, enabled } : key,
          ),
        );
      // Show the new status at once; a failure puts the old one back.
      setEnabled(data.enabled);
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
          setEnabled(!data.enabled);
          toast.error(result.error?.message ?? t("Messages.updateError"));
          return false;
        }
      } catch {
        setEnabled(!data.enabled);
        toast.error(t("Messages.updateError"));
        return false;
      } finally {
        updatingKeyIds.current.delete(data.keyId);
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
