"use client";

import { Plug, RefreshCw, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import { SeoConnectedAccount } from "./seo-connected-account";
import { SEO_WRAP_CLASS } from "./seo-shared";
import {
  type SeoConnectionAction,
  type SeoConnectionProvider,
  useSeoConnection,
} from "./use-seo-connection";

/** One control under the other, each at its own width, in every state. */
const STACK_CLASS = "flex max-w-full min-w-0 flex-col items-start gap-2";

type ConnectionButtonProps = {
  provider: SeoConnectionProvider;
  /** Runs after approval. */
  onConnected?: () => void;
  /** Opens the property choice and the sync. A connected account then has a sync button on its own row. */
  onSync?: () => void;
  /** The view's one primary action passes "primary"; every other use stays outlined. */
  variant?: "primary" | "outline";
  /** The first connection's button text, where one step covers more than this provider. */
  connectLabel?: string;
  /** The control sits in a row of other buttons, not in a column of its own. */
  inRow?: boolean;
};

export function SeoConnectionButton({
  provider,
  onConnected,
  onSync,
  variant = "outline",
  connectLabel,
  inRow,
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
      connectLabel={connectLabel}
      inRow={inRow}
    />
  );
}

function SeoConnectionControl({
  provider,
  onConnected,
  onSync,
  variant,
  connectLabel,
  inRow,
}: ConnectionButtonProps) {
  const t = useTranslations("App.Seo");
  const model = useSeoConnection(provider, onConnected);
  const { data } = model.status;
  const name = t(`statistics.${provider}`);
  // Only the pressed button loads; the others wait.
  const state = (action: SeoConnectionAction) => ({
    loading: model.busy === action,
    disabled: model.busy !== null && model.busy !== action,
  });
  // The state is not known yet, so no button can have the right label.
  if (model.status.isPending) return <Skeleton className="h-8 w-44" />;
  if (model.status.isError)
    return (
      <div className={STACK_CLASS}>
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
      <div className={STACK_CLASS}>
        {/* Connected is not the end: the property choice and the sync follow. */}
        {onSync ? (
          <Button
            type="button"
            variant={variant}
            size="sm"
            disabled={model.busy !== null}
            onClick={onSync}
          >
            <RefreshCw />
            {t("syncStatistics")}
          </Button>
        ) : null}
        <SeoConnectedAccount name={name} model={model} inRow={inRow} />
        {model.error ? (
          <p role="alert" className="text-destructive text-sm">
            {model.error}
          </p>
        ) : null}
      </div>
    );
  return (
    <div className={STACK_CLASS}>
      {data?.canResume && data.pendingConnectionId ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={SEO_WRAP_CLASS}
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
        className={SEO_WRAP_CLASS}
        {...state("connect")}
        onClick={() => {
          void model.connect();
        }}
      >
        <Plug />
        {data?.status === "pending"
          ? t("connections.restart", { provider: name })
          : data?.status === "needs_reconnect"
            ? t("connections.reconnect", { provider: name })
            : (connectLabel ?? t("connections.connect", { provider: name }))}
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
