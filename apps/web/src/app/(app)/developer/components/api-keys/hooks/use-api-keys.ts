"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
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

const API_KEYS_QUERY_KEY = ["developer", "api-keys"] as const;

export function useApiKeys(): UseApiKeysReturn {
  const t = useTranslations("App.Account.ApiKeys");
  const queryClient = useQueryClient();
  const [isManualInitialRefresh, setIsManualInitialRefresh] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<
    Record<string, boolean>
  >({});
  // Keys with a toggle on the wire. A second click on one is dropped until
  // the first has its answer, so two requests for one key cannot cross.
  const updatingKeyIds = useRef(new Set<string>());

  const apiKeysQuery = useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ApiKeyRecord[]> => {
      try {
        const result = await authClient.apiKey.list();
        if (result.data) {
          return result.data.apiKeys;
        }
        const errorMessage = t("Messages.loadError");
        toast.error(errorMessage);
        throw new Error(errorMessage);
      } catch (err) {
        if (err instanceof Error && err.message === t("Messages.loadError")) {
          throw err;
        }
        const errorMessage = t("Messages.loadError");
        toast.error(errorMessage);
        throw new Error(errorMessage);
      }
    },
  });

  const apiKeys = useMemo(
    () =>
      (apiKeysQuery.data ?? []).map((key) =>
        key.id in optimisticEnabled
          ? { ...key, enabled: optimisticEnabled[key.id] }
          : key,
      ),
    [apiKeysQuery.data, optimisticEnabled],
  );
  const isInitialLoading = apiKeysQuery.isPending || isManualInitialRefresh;
  const error = apiKeysQuery.isFetching
    ? null
    : apiKeysQuery.isError
      ? apiKeysQuery.error instanceof Error
        ? apiKeysQuery.error.message
        : t("Messages.loadError")
      : null;

  const { refetch: refetchApiKeys } = apiKeysQuery;

  const refresh = useCallback(
    async (isInitial = false) => {
      if (isInitial) {
        setIsManualInitialRefresh(true);
      }
      try {
        await queryClient.cancelQueries({ queryKey: API_KEYS_QUERY_KEY });
        await refetchApiKeys();
      } finally {
        if (isInitial) {
          setIsManualInitialRefresh(false);
        }
      }
    },
    [queryClient, refetchApiKeys],
  );

  const create = useCallback(
    async (data: CreateApiKeyRequest): Promise<CreateApiKeyResult> => {
      try {
        const result = await authClient.apiKey.create({
          name: data.name,
        });

        if (result.data) {
          const { key: createdKey, ...createdRecord } = result.data;
          await queryClient.cancelQueries({ queryKey: API_KEYS_QUERY_KEY });
          queryClient.setQueryData<ApiKeyRecord[]>(
            API_KEYS_QUERY_KEY,
            (current) => {
              const existing = current ?? [];
              return existing.some((item) => item.id === createdRecord.id)
                ? existing
                : [...existing, createdRecord];
            },
          );
          toast.success(t("Messages.createSuccess"));
          // Reveal the one-time key immediately; list refresh is non-blocking.
          void refresh();
          return {
            ok: true,
            value: {
              key: createdKey,
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
    [queryClient, refresh, t],
  );

  const update = useCallback(
    async (data: UpdateApiKeyRequest): Promise<boolean> => {
      if (updatingKeyIds.current.has(data.keyId)) {
        return false;
      }
      updatingKeyIds.current.add(data.keyId);
      const setEnabled = (enabled: boolean) =>
        setOptimisticEnabled((current) => ({
          ...current,
          [data.keyId]: enabled,
        }));
      const clearOptimistic = () =>
        setOptimisticEnabled((current) => {
          const { [data.keyId]: _dropped, ...rest } = current;
          return rest;
        });
      // Show the new status at once; a failure puts the old one back.
      setEnabled(data.enabled);
      try {
        const result = await authClient.apiKey.update({
          keyId: data.keyId,
          enabled: data.enabled,
        });

        if (result.data) {
          const action = getToggleActionText(!data.enabled);
          await queryClient.cancelQueries({ queryKey: API_KEYS_QUERY_KEY });
          queryClient.setQueryData<ApiKeyRecord[]>(
            API_KEYS_QUERY_KEY,
            (current) =>
              (current ?? []).map((key) =>
                key.id === data.keyId ? { ...key, enabled: data.enabled } : key,
              ),
          );
          clearOptimistic();
          toast.success(t("Messages.updateSuccess", { action }));
          await refresh();
          return true;
        } else {
          clearOptimistic();
          toast.error(result.error?.message ?? t("Messages.updateError"));
          return false;
        }
      } catch {
        clearOptimistic();
        toast.error(t("Messages.updateError"));
        return false;
      } finally {
        updatingKeyIds.current.delete(data.keyId);
      }
    },
    [queryClient, refresh, t],
  );

  const deleteApiKey = useCallback(
    async (data: DeleteApiKeyRequest): Promise<boolean> => {
      try {
        const result = await authClient.apiKey.delete({
          keyId: data.keyId,
        });

        if (result.data) {
          await queryClient.cancelQueries({ queryKey: API_KEYS_QUERY_KEY });
          queryClient.setQueryData<ApiKeyRecord[]>(
            API_KEYS_QUERY_KEY,
            (current) => (current ?? []).filter((key) => key.id !== data.keyId),
          );
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
    [queryClient, refresh, t],
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
