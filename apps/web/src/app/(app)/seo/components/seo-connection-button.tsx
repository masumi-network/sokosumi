"use client";

import { Plug, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
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
  /** The view's one primary action passes "primary"; every other use stays outlined. */
  variant?: "primary" | "outline";
  /** The first connection's button text, where one step covers more than this provider. */
  connectLabel?: string;
  /** The control sits in a row of other buttons, not in a column of its own. */
  inRow?: boolean;
  /**
   * The view shows a failed action itself, in a place that does not move the
   * layout. The control then adds no line of its own. Pass a stable function.
   */
  onError?: (message: string | null) => void;
};

export function SeoConnectionButton({
  provider,
  onConnected,
  variant = "outline",
  connectLabel,
  inRow,
  onError,
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
      variant={variant}
      connectLabel={connectLabel}
      inRow={inRow}
      onError={onError}
    />
  );
}

function SeoConnectionControl({
  provider,
  onConnected,
  variant,
  connectLabel,
  inRow,
  onError,
}: ConnectionButtonProps) {
  const t = useTranslations("App.Seo");
  const model = useSeoConnection(provider, onConnected);
  const { data } = model.status;
  const { error } = model;
  // The view shows an error next to a button that can try again. A control
  // without that button, and a control that left the view, report none.
  const reported =
    data?.status === "unavailable" || (model.status.isError && !data)
      ? null
      : error;
  useEffect(() => {
    onError?.(reported);
    return () => onError?.(null);
  }, [onError, reported]);
  // The view that takes the error shows it; here it would add a line and move the layout.
  const ownError = onError ? null : error;
  const name = t(`statistics.${provider}`);
  // Only the pressed button loads; the others wait.
  const state = (action: SeoConnectionAction) => ({
    loading: model.busy === action,
    disabled: model.busy !== null && model.busy !== action,
  });
  // The state is not known yet, so no button can have the right label.
  if (model.status.isPending) return <Skeleton className="h-8 w-44" />;
  // A later read that fails keeps the state that the last good read gave.
  if (model.status.isError && !data)
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
        <SeoConnectedAccount name={name} model={model} inRow={inRow} />
        {ownError ? (
          <p role="alert" className="text-destructive text-sm">
            {ownError}
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
      {ownError ? (
        <p role="alert" className="text-destructive text-sm">
          {ownError}
        </p>
      ) : null}
    </div>
  );
}
