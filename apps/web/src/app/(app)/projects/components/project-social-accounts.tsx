"use client";

import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import type { ActionError } from "@/lib/actions/errors";
import {
  disconnectProjectSocialConnection,
  finalizeProjectSocialConnection,
  initiateProjectSocialConnection,
} from "@/lib/actions/project/action";
import type { ProjectSocialConnection } from "@/lib/clients/generated/core/types.gen";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";

interface ProjectSocialAccountsProps {
  connections: ProjectSocialConnection[];
  projectId: string;
}

interface PendingConfirmation {
  action: "replace" | "disconnect";
  connection: ProjectSocialConnection;
}

interface Feedback {
  kind: "error" | "success" | "warning";
  message: string;
}

type OAuthAction = "connect" | "reconnect" | "replace";

const STATUS_TRANSLATION_KEYS: Record<
  ProjectSocialConnection["status"],
  | "status.active"
  | "status.disconnected"
  | "status.pending"
  | "status.reauthorization_required"
> = {
  active: "status.active",
  pending: "status.pending",
  reauthorization_required: "status.reauthorization_required",
  disconnected: "status.disconnected",
};

function formatHandle(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function isExpiredIntentError(error: ActionError): boolean {
  return error.message?.toLowerCase().includes("unknown or expired") ?? false;
}

export function ProjectSocialAccounts({
  connections,
  projectId,
}: ProjectSocialAccountsProps) {
  const router = useRouter();
  const t = useTranslations("App.Projects.ProjectSocialAccounts");
  const { runPopupOAuth } = useComposioOAuthPopup();
  const disconnectInFlightRef = useRef(false);
  const isMountedRef = useRef(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "disconnect" | OAuthAction | null
  >(null);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const isBusy = pendingAction !== null;

  useMountEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  });

  function showFeedback(nextFeedback: Feedback): void {
    if (!isMountedRef.current) return;
    setFeedback(nextFeedback);
    if (nextFeedback.kind === "error") {
      toast.error(nextFeedback.message);
      return;
    }
    toast.success(nextFeedback.message);
  }

  function finishAction(): void {
    if (isMountedRef.current) {
      setPendingAction(null);
    }
  }

  function showActionError(error: ActionError, fallback: string): void {
    const message = error.message?.toLowerCase();
    showFeedback({
      kind: "error",
      message: isExpiredIntentError(error)
        ? t("errors.intent")
        : message?.includes("already connected")
          ? t("errors.duplicate")
          : message?.includes("reconnect must match")
            ? t("errors.reconnectMismatch")
            : fallback,
    });
  }

  async function startOAuth(
    action: OAuthAction,
    socialConnectionId?: string,
  ): Promise<void> {
    try {
      const popupRun = await runPopupOAuth(async (flow) => {
        setFeedback(null);
        setPendingAction(action);
        const refreshAfterReplace = action === "replace";
        let refreshed = false;

        try {
          const initiation = await initiateProjectSocialConnection({
            projectId,
            action,
            ...(socialConnectionId ? { socialConnectionId } : {}),
          });
          if (!initiation.ok) {
            showActionError(initiation.error, t("errors.intent"));
            return;
          }

          if (!isMountedRef.current) return;

          const { connectionId, redirectUrl } = initiation.value;
          flow.navigate(redirectUrl);
          const callback = await flow.waitForCallback();

          if (callback.kind === "cancelled") return;
          if (callback.kind === "closed") {
            showFeedback({ kind: "error", message: t("errors.popupClosed") });
            return;
          }
          if (callback.kind === "timeout") {
            showFeedback({ kind: "error", message: t("errors.timeout") });
            return;
          }

          const { payload } = callback;
          if (payload.status === "error") {
            showFeedback({
              kind: "error",
              message: t("errors.providerCallback"),
            });
            return;
          }
          if (payload.connectionId !== connectionId) {
            showFeedback({
              kind: "error",
              message: t("errors.legacyCallback"),
            });
            return;
          }
          if (!payload.sessionUri) {
            showFeedback({
              kind: "error",
              message: t("errors.legacyCallback"),
            });
            return;
          }

          const completion = await completeComposioAuthCallbackAction({
            connectionId,
            sessionUri: payload.sessionUri,
          });
          if (!completion.ok) {
            showActionError(completion.error, t("errors.verifier"));
            return;
          }

          const finalization = await finalizeProjectSocialConnection({
            projectId,
            connectionId,
          });
          if (!finalization.ok) {
            showActionError(finalization.error, t("errors.finalize"));
            return;
          }

          showFeedback({ kind: "success", message: t("success.connected") });
          router.refresh();
          refreshed = true;
        } catch {
          showFeedback({ kind: "error", message: t("errors.finalize") });
        } finally {
          if (refreshAfterReplace && !refreshed) {
            router.refresh();
          }
          finishAction();
        }
      });

      if (popupRun.kind === "in_flight") {
        showFeedback({ kind: "error", message: t("errors.inFlight") });
      }
      if (popupRun.kind === "popup_blocked") {
        showFeedback({ kind: "error", message: t("errors.popupBlocked") });
      }
    } catch {
      showFeedback({ kind: "error", message: t("errors.finalize") });
    }
  }

  async function handleDisconnect(
    connection: ProjectSocialConnection,
  ): Promise<void> {
    if (disconnectInFlightRef.current || isBusy) {
      showFeedback({ kind: "error", message: t("errors.inFlight") });
      return;
    }

    disconnectInFlightRef.current = true;
    setFeedback(null);
    setPendingAction("disconnect");
    try {
      const result = await disconnectProjectSocialConnection({
        projectId,
        socialConnectionId: connection.id,
      });
      if (!result.ok) {
        showActionError(result.error, t("errors.disconnect"));
        return;
      }

      showFeedback({ kind: "success", message: t("success.disconnected") });
      if (result.value.providerRevocation === "failed") {
        showFeedback({
          kind: "warning",
          message: t("warning.providerRevocationFailed"),
        });
      }
      router.refresh();
    } catch {
      showFeedback({ kind: "error", message: t("errors.disconnect") });
    } finally {
      disconnectInFlightRef.current = false;
      finishAction();
    }
  }

  function handleConfirmation(): void {
    const confirmation = pendingConfirmation;
    if (!confirmation) return;

    setPendingConfirmation(null);
    if (confirmation.action === "disconnect") {
      void handleDisconnect(confirmation.connection);
      return;
    }
    void startOAuth("replace", confirmation.connection.id);
  }

  const confirmationIsDisconnect = pendingConfirmation?.action === "disconnect";

  return (
    <section
      className="bg-muted/30 border-border/50 space-y-4 rounded-xl border p-4"
      data-testid="project-social-accounts"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      {feedback ? (
        <p
          className={
            feedback.kind === "error"
              ? "text-destructive text-sm"
              : feedback.kind === "warning"
                ? "text-semantic-warning text-sm"
                : "text-semantic-success text-sm"
          }
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      {connections.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {connections.map((connection) => {
            const handle = formatHandle(connection.externalHandle);
            const canReconnect =
              connection.status === "reauthorization_required";
            const canReplace =
              connection.status === "active" ||
              connection.status === "reauthorization_required";
            const canDisconnect = connection.status !== "disconnected";

            return (
              <div
                key={connection.id}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"
                data-testid={`project-social-connection-${connection.id}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden
                    className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold"
                  >
                    X
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {handle ?? t("unknownHandle")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("account")}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    connection.status === "reauthorization_required"
                      ? "destructive"
                      : "outline"
                  }
                >
                  {t(STATUS_TRANSLATION_KEYS[connection.status])}
                </Badge>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {canReconnect ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        void startOAuth("reconnect", connection.id);
                      }}
                    >
                      {pendingAction === "reconnect" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden />
                      )}
                      {t("reconnect")}
                    </Button>
                  ) : null}
                  {canReplace ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        setPendingConfirmation({
                          action: "replace",
                          connection,
                        });
                      }}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      {t("replace")}
                    </Button>
                  ) : null}
                  {canDisconnect ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => {
                        setPendingConfirmation({
                          action: "disconnect",
                          connection,
                        });
                      }}
                    >
                      {pendingAction === "disconnect" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                      {t("disconnect")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isBusy}
        onClick={() => {
          void startOAuth("connect");
        }}
      >
        {pendingAction === "connect" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        {pendingAction === "connect" ? t("connecting") : t("connect")}
      </Button>

      <AlertDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) setPendingConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmationIsDisconnect
                ? t("disconnectDialog.title")
                : t("replaceDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmationIsDisconnect
                ? t("disconnectDialog.description")
                : t("replaceDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction disabled={isBusy} onClick={handleConfirmation}>
              {confirmationIsDisconnect
                ? pendingAction === "disconnect"
                  ? t("disconnecting")
                  : t("disconnectDialog.confirm")
                : t("replaceDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
