"use client";

import { Check, Plug, RefreshCw, RotateCw, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
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
  /** The first connection's button text, where one step covers more than this provider. */
  connectLabel?: string;
};

export function SeoConnectionButton({
  provider,
  onConnected,
  onSync,
  variant = "outline",
  connectLabel,
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
    />
  );
}

function SeoConnectionControl({
  provider,
  onConnected,
  onSync,
  variant,
  connectLabel,
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
          {/* The two account actions wrap as one unit, so the icon never sits alone on a row. */}
          <div className="flex max-w-full min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(WRAP_CLASS, "min-w-0 shrink")}
              {...state("connect")}
              onClick={() => {
                void model.connect();
              }}
            >
              {t("connections.changeAccount", { provider: name })}
            </Button>
            {/* One press on a small icon must not remove the account: the reader confirms first.
                The icon is the trigger, so focus returns to it when the question closes. */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // The row's other buttons are 32px from md up; a phone keeps 40px.
                  className="size-10 shrink-0 md:size-8"
                  {...state("disconnect")}
                  aria-label={t("connections.disconnect", { provider: name })}
                  title={t("connections.disconnect", { provider: name })}
                >
                  <Unplug className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("connections.disconnectTitle", { provider: name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("connections.disconnectBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      void model.disconnect();
                    }}
                  >
                    {t("connections.disconnect", { provider: name })}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
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
