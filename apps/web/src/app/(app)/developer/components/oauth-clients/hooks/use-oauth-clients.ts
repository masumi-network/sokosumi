"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  CreateOAuthClientRequest,
  CreateOAuthClientResult,
  DeleteOAuthClientRequest,
  OAuthClientRecord,
  UpdateOAuthClientRequest,
  UseOAuthClientsReturn,
} from "@/app/developer/components/oauth-clients/types";
import { authClient } from "@/lib/auth/auth.client";

export function useOAuthClients(): UseOAuthClientsReturn {
  const t = useTranslations("App.Developer.OAuthClients");
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
        if (result.data) {
          setClients(result.data);
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
    async (
      data: CreateOAuthClientRequest,
    ): Promise<CreateOAuthClientResult> => {
      try {
        const result = await authClient.oauth2.createClient({
          redirect_uris: data.redirectUris,
          client_name: data.name,
          scope: "openid",
        });

        if (result.data) {
          toast.success(t("Messages.createSuccess"));
          await refresh();
          return {
            success: true,
            data: {
              clientId: result.data.client_id,
              clientSecret: result.data.client_secret ?? null,
            },
          };
        }

        const errorMessage = result.error?.message ?? t("Messages.createError");
        toast.error(errorMessage);
        return {
          success: false,
          error: {
            message: errorMessage,
          },
        };
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
    async (data: UpdateOAuthClientRequest): Promise<boolean> => {
      try {
        const result = await authClient.oauth2.updateClient({
          client_id: data.clientId,
          update: {
            client_name: data.name,
            redirect_uris: data.redirectUris,
          },
        });

        if (result.data) {
          toast.success(t("Messages.updateSuccess"));
          await refresh();
          return true;
        }

        toast.error(result.error?.message ?? t("Messages.updateError"));
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

        if (!result.error) {
          toast.success(t("Messages.deleteSuccess"));
          await refresh();
          return true;
        }

        toast.error(result.error?.message ?? t("Messages.deleteError"));
        return false;
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
    clients,
    isInitialLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteClient,
  };
}
