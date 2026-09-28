"use client";

import {
  Loader2,
  MoreHorizontal,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useRef, useState } from "react";
import { SiX } from "react-icons/si";
import { toast } from "sonner";

import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/social-icons";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  disconnectProjectSocialConnection,
  finalizeProjectSocialConnection,
  initiateProjectSocialConnection,
} from "@/lib/actions/project/action";
import type { ProjectSocialConnection } from "@/lib/clients/generated/core/types.gen";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";
import { cn } from "@/lib/utils";

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

const SOCIAL_PROVIDERS = [
  { id: "x", name: "X", Icon: SiX },
  { id: "tiktok", name: "TikTok", Icon: TikTokIcon },
  { id: "instagram", name: "Instagram", Icon: InstagramIcon },
  { id: "linkedin", name: "LinkedIn", Icon: LinkedInIcon },
  { id: "facebook", name: "Facebook", Icon: FacebookIcon },
  { id: "youtube", name: "YouTube", Icon: YouTubeIcon },
] as const satisfies readonly {
  id: ProjectSocialConnection["provider"];
  name: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[];

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

function formatHandle(
  handle: string | null,
  provider: ProjectSocialConnection["provider"],
): string | null {
  if (!handle) return null;
  if (provider !== "x" && provider !== "instagram") return handle;
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
  // Replace and Disconnect open from a row menu that is gone by the time the
  // dialog closes, so focus goes back to that row's menu trigger by hand.
  const actionTriggersRef = useRef(new Map<string, HTMLButtonElement>());
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The provider being connected, or the connection being changed.
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
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
    if (nextFeedback.kind === "warning") {
      toast.warning(nextFeedback.message);
      return;
    }
    toast.success(nextFeedback.message);
  }

  function finishAction(): void {
    if (isMountedRef.current) {
      setPendingAction(null);
      setPendingTarget(null);
    }
  }

  function showActionError(error: ActionError, fallback: string): void {
    const message = error.message?.toLowerCase();
    showFeedback({
      kind: "error",
      message: message?.includes("not configured")
        ? t("errors.notConfigured")
        : isExpiredIntentError(error)
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
    provider?: ProjectSocialConnection["provider"],
  ): Promise<void> {
    try {
      const popupRun = await runPopupOAuth(async (flow) => {
        setFeedback(null);
        setPendingAction(action);
        setPendingTarget(provider ?? socialConnectionId ?? null);
        const refreshAfterReplace = action === "replace";
        let refreshed = false;

        try {
          const initiation = await initiateProjectSocialConnection({
            projectId,
            action,
            ...(provider ? { provider } : {}),
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
          if (payload.connectionId && payload.connectionId !== connectionId) {
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
    setPendingTarget(connection.id);
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

  function requestConfirmation(
    action: PendingConfirmation["action"],
    connection: ProjectSocialConnection,
  ): void {
    confirmationTriggerRef.current =
      actionTriggersRef.current.get(connection.id) ?? null;
    setPendingConfirmation({ action, connection });
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
      aria-labelledby="social-accounts-heading"
      className="space-y-4"
      data-testid="project-social-accounts"
      id="social-accounts"
    >
      <div className="space-y-1">
        <h2 id="social-accounts-heading" className="text-base font-semibold">
          {t("title")}
        </h2>
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
        <ul className="divide-y rounded-lg border">
          {connections.map((connection) => {
            const provider = SOCIAL_PROVIDERS.find(
              ({ id }) => id === connection.provider,
            );
            const providerName = provider?.name ?? connection.provider;
            const handle =
              formatHandle(connection.externalHandle, connection.provider) ??
              t("unknownHandle");
            const canReconnect =
              connection.status === "reauthorization_required";
            const canReplace = connection.status === "active" || canReconnect;
            const canDisconnect = connection.status !== "disconnected";
            const isRowPending =
              pendingAction !== "connect" && pendingTarget === connection.id;

            return (
              <li
                key={connection.id}
                className="flex flex-wrap items-center gap-3 p-3"
                data-testid={`project-social-connection-${connection.id}`}
              >
                <span
                  aria-hidden
                  className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold"
                >
                  {provider ? (
                    <provider.Icon className="size-5" />
                  ) : (
                    providerName.slice(0, 1)
                  )}
                </span>
                <div className="min-w-40 flex-1">
                  <p className="truncate text-sm font-medium">{handle}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
                    <span>{t("account", { provider: providerName })}</span>
                    <span aria-hidden>·</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        canReconnect && "text-semantic-warning-label",
                      )}
                    >
                      {canReconnect ? (
                        <TriangleAlert className="size-3" aria-hidden />
                      ) : (
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            connection.status === "active"
                              ? "bg-semantic-success"
                              : "bg-muted-foreground",
                          )}
                        />
                      )}
                      {t(STATUS_TRANSLATION_KEYS[connection.status])}
                    </span>
                  </p>
                </div>
                <div className="ms-auto flex items-center gap-2">
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
                      {isRowPending && pendingAction === "reconnect" ? (
                        <Loader2
                          className="size-4 animate-spin motion-reduce:animate-pulse"
                          aria-hidden
                        />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden />
                      )}
                      {t("reconnect")}
                    </Button>
                  ) : null}
                  {canDisconnect ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          ref={(node) => {
                            if (node) {
                              actionTriggersRef.current.set(
                                connection.id,
                                node,
                              );
                            } else {
                              actionTriggersRef.current.delete(connection.id);
                            }
                          }}
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isBusy}
                          aria-busy={isRowPending}
                          aria-label={t("actions", { account: handle })}
                        >
                          {isRowPending && pendingAction !== "reconnect" ? (
                            <Loader2
                              className="size-4 animate-spin motion-reduce:animate-pulse"
                              aria-hidden
                            />
                          ) : (
                            <MoreHorizontal className="size-4" aria-hidden />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canReplace ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              requestConfirmation("replace", connection);
                            }}
                          >
                            {t("replace")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            requestConfirmation("disconnect", connection);
                          }}
                        >
                          {t("disconnect")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-muted-foreground text-xs font-medium">
          {t("connectHeading")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {SOCIAL_PROVIDERS.map(({ id, name, Icon }) => {
            const isConnecting =
              pendingAction === "connect" && pendingTarget === id;

            return (
              <Button
                key={id}
                aria-busy={isConnecting}
                aria-label={t("connect", { provider: name })}
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => {
                  void startOAuth("connect", undefined, id);
                }}
              >
                {isConnecting ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : (
                  <Icon className="size-4" aria-hidden />
                )}
                {name}
              </Button>
            );
          })}
        </div>
      </div>

      <AlertDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) setPendingConfirmation(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            confirmationTriggerRef.current?.focus();
          }}
        >
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
