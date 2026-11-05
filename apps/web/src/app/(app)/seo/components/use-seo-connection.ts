"use client";

import type { SeoConnectionStatus } from "@sokosumi/core-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  connectSeoStatisticsAction,
  disconnectSeoStatisticsAction,
  finalizeSeoStatisticsAction,
} from "@/lib/actions/seo-connections/action";
import { useSession } from "@/lib/auth/auth.client";
import { useComposioConnection } from "@/lib/composio/use-composio-connection";
import { seoViewerHeaders } from "@/lib/seo/owner";

export type SeoConnectionProvider = SeoConnectionStatus["provider"];

export function useSeoConnection(
  provider: SeoConnectionProvider,
  onConnected?: () => void,
) {
  const t = useTranslations("App.Seo.connections");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { connect: connectPopup } = useComposioConnection();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const queryKey = [
    "seo-connection",
    session?.session.activeOrganizationId,
    session?.user.id,
    provider,
  ];
  const status = useQuery<SeoConnectionStatus>({
    queryKey,
    enabled: Boolean(session?.user.id),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/seo/connections/${provider}`, {
        signal,
        headers: seoViewerHeaders(session?.user.id),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("SEO connection unavailable");
      return response.json();
    },
    refetchOnWindowFocus: true,
  });
  async function connect() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const outcome = await connectPopup({
        onStart: () => setBusy(true),
        initiate: () =>
          connectSeoStatisticsAction({
            provider,
            callbackUrl: `${window.location.origin}/composio/callback`,
          }),
        finalize: (connectionId) =>
          finalizeSeoStatisticsAction({ provider, connectionId }),
      });
      if (outcome.kind === "connected") {
        queryClient.setQueryData(queryKey, outcome.value);
        await queryClient.invalidateQueries({ queryKey: ["seo-properties"] });
        onConnected?.();
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
        toast.error(t(key, { provider: name }));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function disconnect() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await disconnectSeoStatisticsAction({ provider });
      if (!result.ok) {
        toast.error(
          t("disconnectFailed", { provider: status.data?.name ?? provider }),
        );
        return;
      }
      await status.refetch();
      await queryClient.invalidateQueries({ queryKey: ["seo-properties"] });
    } catch {
      toast.error(
        t("disconnectFailed", { provider: status.data?.name ?? provider }),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { status, busy, connect, disconnect };
}
