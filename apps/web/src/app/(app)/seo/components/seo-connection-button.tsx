"use client";

import { Check, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/auth.client";
import {
  type SeoConnectionProvider,
  useSeoConnection,
} from "./use-seo-connection";

export function SeoConnectionButton({
  provider,
  onConnected,
}: {
  provider: SeoConnectionProvider;
  onConnected?: () => void;
}) {
  const { data: session } = useSession();
  const identity = JSON.stringify([
    session?.user.id,
    session?.session.activeOrganizationId,
    provider,
  ]);
  return (
    <SeoConnectionControl
      key={identity}
      provider={provider}
      onConnected={onConnected}
    />
  );
}

function SeoConnectionControl({
  provider,
  onConnected,
}: {
  provider: SeoConnectionProvider;
  onConnected?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const model = useSeoConnection(provider, onConnected);
  const { data } = model.status;
  const name = t(`statistics.${provider}`);
  if (model.status.isError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-muted-foreground text-sm">
          {t("connections.loadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void model.status.refetch();
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  if (data?.status === "unavailable")
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("connections.unavailable")}
      </p>
    );
  if (data?.status === "connected")
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Check aria-hidden className="size-4" />
            {t("connections.connected", { provider: name })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={model.busy}
            onClick={() => {
              void model.connect();
            }}
          >
            {t("connections.changeAccount")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            loading={model.busy}
            aria-label={t("connections.disconnect", { provider: name })}
            title={t("connections.disconnect", { provider: name })}
            onClick={() => {
              void model.disconnect();
            }}
          >
            <Unplug aria-hidden className="size-4" />
          </Button>
        </div>
        {model.error ? (
          <p role="alert" className="text-destructive text-sm">
            {model.error}
          </p>
        ) : null}
      </div>
    );
  return (
    <div className="space-y-2">
      {data?.canResume && data.pendingConnectionId ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={model.busy}
          onClick={() => {
            void model.resume();
          }}
        >
          {t("connections.resume")}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={model.busy || model.status.isPending}
        disabled={model.status.isPending}
        onClick={() => {
          void model.connect();
        }}
      >
        {t(
          data?.status === "pending"
            ? "connections.restart"
            : data?.status === "needs_reconnect"
              ? "connections.reconnect"
              : "connections.connect",
          { provider: name },
        )}
      </Button>
      {data?.status === "pending" ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("connections.pending")}
        </p>
      ) : null}
      {data?.status === "needs_reconnect" ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("connections.needsReconnect", { provider: name })}
        </p>
      ) : null}
      {model.error ? (
        <p role="alert" className="text-destructive text-sm">
          {model.error}
        </p>
      ) : null}
    </div>
  );
}
