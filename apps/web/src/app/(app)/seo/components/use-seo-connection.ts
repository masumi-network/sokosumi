"use client";

import type { SeoConnectionStatus } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { toActionRejectionError } from "@/lib/actions/errors/action-error";
import {
  connectSeoStatisticsAction,
  disconnectSeoStatisticsAction,
  finalizeSeoStatisticsAction,
} from "@/lib/actions/seo-connections/action";
import { useSession } from "@/lib/auth/auth.client";
import type { ComposioConnectionOutcome } from "@/lib/composio/use-composio-connection";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";
import {
  seoConnectionCallbackUrl,
  seoConnectionErrorKey,
} from "@/lib/seo/connection-callback";
import { seoViewerHeaders } from "@/lib/seo/owner";

export type SeoConnectionProvider = SeoConnectionStatus["provider"];
export type SeoConnectionAction = "connect" | "resume" | "disconnect";

/** The saved state of one Google connection. Every reader of a provider shares one request. */
export function useSeoConnectionStatus(
  provider: SeoConnectionProvider,
  enabled = true,
) {
  const { data: session } = useSession();
  const queryKey = [
    "seo-connection",
    session?.session.activeOrganizationId,
    session?.user.id,
    provider,
  ];
  const status = useQuery<SeoConnectionStatus>({
    queryKey,
    enabled: enabled && Boolean(session?.user.id),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/seo/connections/${provider}`, {
        signal,
        headers: seoViewerHeaders(
          session?.user.id,
          session?.session.activeOrganizationId,
        ),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("SEO connection unavailable");
      return response.json();
    },
    refetchOnWindowFocus: true,
  });
  return { status, queryKey };
}

export function useSeoConnection(
  provider: SeoConnectionProvider,
  onConnected?: () => void,
) {
  const t = useTranslations("App.Seo.connections");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { runPopupOAuth } = useComposioOAuthPopup();
  // The action in flight, so only the pressed button shows and announces progress.
  const [busy, setBusy] = useState<SeoConnectionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const actor = {
    viewerId: session?.user.id ?? "",
    organizationId: session?.session.activeOrganizationId ?? null,
  };
  const { status, queryKey } = useSeoConnectionStatus(provider);
  async function connect() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      const run = await runPopupOAuth(
        async (
          flow,
        ): Promise<ComposioConnectionOutcome<SeoConnectionStatus>> => {
          setBusy("connect");
          const initiation = await connectSeoStatisticsAction({
            ...actor,
            provider,
            callbackUrl: seoConnectionCallbackUrl({
              origin: window.location.origin,
              search: window.location.search,
              provider,
              ...actor,
              nonce: flow.nonce,
            }),
          });
          if (!alive.current) return { kind: "cancelled" };
          if (!initiation.ok)
            return {
              kind: "failed",
              stage: "initiate",
              error: initiation.error,
            };
          flow.navigate(initiation.value.redirectUrl);
          const callback = await flow.waitForCallback();
          if (!alive.current || callback.kind === "cancelled")
            return { kind: "cancelled" };
          if (callback.kind === "timeout") return { kind: "timeout" };
          if (
            callback.payload.status === "error" ||
            (callback.payload.connectionId &&
              callback.payload.connectionId !== initiation.value.connectionId)
          )
            return { kind: "failed", stage: "provider_callback", error: null };
          // The native callback completes consent. Recheck this exact owned account
          // before changing the opener's private cache or announcing success.
          const result = await finalizeSeoStatisticsAction({
            ...actor,
            provider,
            connectionId: initiation.value.connectionId,
          });
          return result.ok
            ? { kind: "connected", value: result.value }
            : { kind: "failed", stage: "finalize", error: result.error };
        },
      );
      if (!alive.current) return;
      const outcome = run.kind === "completed" ? run.value : { kind: run.kind };
      if (outcome.kind === "connected") {
        queryClient.setQueryData(queryKey, outcome.value);
        await queryClient.invalidateQueries({ queryKey: ["seo-properties"] });
        if (alive.current) onConnected?.();
      } else if (outcome.kind !== "cancelled") {
        const name =
          status.data?.name ??
          (provider === "ga4" ? "Google Analytics" : "Search Console");
        const key =
          outcome.kind === "popup_blocked"
            ? "popupBlocked"
            : outcome.kind === "in_flight"
              ? "inFlight"
              : outcome.kind === "timeout"
                ? "timeout"
                : "connectFailed";
        const detail =
          outcome.kind === "failed"
            ? seoConnectionErrorKey(outcome.error)
            : key;
        setError(t(detail, { provider: name }));
        await status.refetch();
      }
    } catch (error) {
      if (alive.current)
        setError(
          t(seoConnectionErrorKey(toActionRejectionError(error)), {
            provider: status.data?.name ?? provider,
          }),
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function resume() {
    const connectionId = status.data?.pendingConnectionId;
    if (!connectionId || busyRef.current) return;
    busyRef.current = true;
    setBusy("resume");
    setError(null);
    try {
      const result = await finalizeSeoStatisticsAction({
        ...actor,
        provider,
        connectionId,
      });
      if (!alive.current) return;
      if (!result.ok) {
        setError(
          t(seoConnectionErrorKey(result.error), {
            provider: status.data?.name ?? provider,
          }),
        );
        return;
      }
      queryClient.setQueryData(queryKey, result.value);
      await queryClient.invalidateQueries({ queryKey: ["seo-properties"] });
      if (alive.current) onConnected?.();
    } catch (error) {
      if (alive.current)
        setError(
          t(seoConnectionErrorKey(toActionRejectionError(error)), {
            provider: status.data?.name ?? provider,
          }),
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }
  async function disconnect() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("disconnect");
    setError(null);
    try {
      const result = await disconnectSeoStatisticsAction({
        ...actor,
        provider,
      });
      if (!alive.current) return;
      if (!result.ok) {
        setError(
          t("disconnectFailed", { provider: status.data?.name ?? provider }),
        );
        return;
      }
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ["seo-properties"] });
    } catch {
      if (alive.current)
        setError(
          t("disconnectFailed", { provider: status.data?.name ?? provider }),
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }
  return { status, busy, error, connect, resume, disconnect };
}
