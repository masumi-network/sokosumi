"use client";

import { buildOAuthClientScopeParam } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";

import type {
  CreateOAuthClientRequest,
  CreateOAuthClientResult,
  DeleteOAuthClientRequest,
  OAuthClientRecord,
  RotateOAuthClientRequest,
  RotateOAuthClientResult,
  UpdateOAuthClientRequest,
  UseOAuthClientsReturn,
} from "../types";

export function useOAuthClients(): UseOAuthClientsReturn {
  const t = useTranslations("App.Account.OAuthClients");
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

  const create = useCallback(
    async (
      data: CreateOAuthClientRequest,
    ): Promise<CreateOAuthClientResult> => {
      try {
        const result = await authClient.oauth2.createClient({
          redirect_uris: data.redirectUris,
          client_name: data.name,
          scope: buildOAuthClientScopeParam(data.includeCoreApi ?? false),
        });

        if (result.error) {
          const errorMessage =
            result.error.message ?? t("Messages.createError");
          toast.error(errorMessage);
          return {
            success: false,
            error: { message: errorMessage },
          };
        }

        if (result.data) {
          toast.success(t("Messages.createSuccess"));
          // Reveal credentials immediately; list refresh is non-blocking.
          void refresh();
          return {
            success: true,
            data: {
              clientId: result.data.client_id,
              clientSecret: result.data.client_secret ?? null,
            },
          };
        }

        const errorMessage = t("Messages.createError");
        toast.error(errorMessage);
        return {
          success: false,
          error: { message: errorMessage },
        };
      } catch {
        const errorMessage = t("Messages.createError");
        toast.error(errorMessage);
        return {
          success: false,
          error: { message: errorMessage },
        };
      }
    },
    [refresh, t],
  );

  const update = useCallback(
    async (data: UpdateOAuthClientRequest): Promise<boolean> => {
      try {
        const result = await authClient.oauth2.updateClient({
          client_id: data.clientId,
          update: {
            client_name: data.name,
            redirect_uris: data.redirectUris,
          },
        });

        if (result.error) {
          toast.error(result.error.message ?? t("Messages.updateError"));
          return false;
        }

        if (result.data) {
          toast.success(t("Messages.updateSuccess"));
          await refresh();
          return true;
        }

        toast.error(t("Messages.updateError"));
        return false;
      } catch {
        toast.error(t("Messages.updateError"));
        return false;
      }
    },
    [refresh, t],
  );

  const deleteClient = useCallback(
    async (data: DeleteOAuthClientRequest): Promise<boolean> => {
      try {
        const result = await authClient.oauth2.deleteClient({
          client_id: data.clientId,
        });

        if (result.error) {
          toast.error(result.error.message ?? t("Messages.deleteError"));
          return false;
        }

        toast.success(t("Messages.deleteSuccess"));
        await refresh();
        return true;
      } catch {
        toast.error(t("Messages.deleteError"));
        return false;
      }
    },
    [refresh, t],
  );

  const rotateSecret = useCallback(
    async (
      data: RotateOAuthClientRequest,
    ): Promise<RotateOAuthClientResult> => {
      try {
        const result = await authClient.oauth2.client.rotateSecret({
          client_id: data.clientId,
        });

        if (result.error) {
          const errorMessage =
            result.error.message ?? t("Messages.rotateError");
          toast.error(errorMessage);
          return {
            success: false,
            error: { message: errorMessage },
          };
        }

        if (result.data) {
          toast.success(t("Messages.rotateSuccess"));
          // Reveal secret immediately; list refresh is non-blocking.
          void refresh();
          return {
            success: true,
            data: {
              clientId: result.data.client_id,
              clientSecret: result.data.client_secret ?? null,
            },
          };
        }

        const errorMessage = t("Messages.rotateError");
        toast.error(errorMessage);
        return {
          success: false,
          error: { message: errorMessage },
        };
      } catch {
        const errorMessage = t("Messages.rotateError");
        toast.error(errorMessage);
        return {
          success: false,
          error: { message: errorMessage },
        };
      }
    },
    [refresh, t],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  return {
    clients,
    isInitialLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteClient,
    rotateSecret,
  };
}
