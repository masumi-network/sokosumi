"use client";

import { Check, Plug, RefreshCw, RotateCw, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import {
  type SeoConnectionAction,
  type SeoConnectionProvider,
  useSeoConnection,
} from "./use-seo-connection";

/** A long label wraps inside a narrow column; the app's buttons do not by default. */
const WRAP_CLASS =
  "h-auto min-h-8 max-w-full py-1.5 text-start whitespace-normal";

type ConnectionButtonProps = {
  provider: SeoConnectionProvider;
  /** Runs after approval. */
  onConnected?: () => void;
  /** Opens the property choice and the sync. A connected account then shows a sync button. */
  onSync?: () => void;
  /** The view's one primary action passes "primary"; every other use stays outlined. */
  variant?: "primary" | "outline";
};

export function SeoConnectionButton({
  provider,
  onConnected,
  onSync,
  variant = "outline",
}: ConnectionButtonProps) {
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
      onSync={onSync}
      variant={variant}
    />
  );
}

function SeoConnectionControl({
  provider,
  onConnected,
  onSync,
  variant,
}: ConnectionButtonProps) {
  const t = useTranslations("App.Seo");
  const model = useSeoConnection(provider, onConnected);
  const { data } = model.status;
  const name = t(`statistics.${provider}`);
  const connectedId = useId();
  // Only the pressed button loads; the others wait.
  const state = (action: SeoConnectionAction) => ({
    loading: model.busy === action,
    disabled: model.busy !== null && model.busy !== action,
  });
  // The state is not known yet, so no button can have the right label.
  if (model.status.isPending) return <Skeleton className="h-8 w-44" />;
  if (model.status.isError)
    return (
      <div className="min-w-0 space-y-2">
        <p role="alert" className="text-muted-foreground text-sm">
          {t("connections.loadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={model.status.isFetching}
          onClick={() => {
            void model.status.refetch();
          }}
        >
          <RotateCw />
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
      <div className="max-w-full min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            id={connectedId}
            className="inline-flex items-center gap-1.5 text-sm"
          >
            <Check className="size-4" />
            {t("connections.connected", { provider: name })}
          </span>
          {/* Connected is not the end: the property choice and the sync follow. */}
          {onSync ? (
            <Button
              type="button"
              variant={variant}
              size="sm"
              disabled={model.busy !== null}
              // Two accounts can sit side by side: this says which one syncs.
              aria-describedby={connectedId}
              onClick={onSync}
            >
              <RefreshCw />
              {t("syncStatistics")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={WRAP_CLASS}
            {...state("connect")}
            onClick={() => {
              void model.connect();
            }}
          >
            {t("connections.changeAccount", { provider: name })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // The row's other buttons are 32px from md up; a phone keeps 40px.
            className="size-10 md:size-8"
            {...state("disconnect")}
            aria-label={t("connections.disconnect", { provider: name })}
            title={t("connections.disconnect", { provider: name })}
            onClick={() => {
              void model.disconnect();
            }}
          >
            <Unplug className="size-4" />
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
    <div className="max-w-full min-w-0 space-y-2">
      {data?.canResume && data.pendingConnectionId ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={WRAP_CLASS}
          {...state("resume")}
          onClick={() => {
            void model.resume();
          }}
        >
          <RotateCw />
          {t("connections.resume", { provider: name })}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={WRAP_CLASS}
        {...state("connect")}
        onClick={() => {
          void model.connect();
        }}
      >
        <Plug />
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
