"use client";

import type { ProjectSocialConnection } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  Loader2,
  MoreHorizontal,
  Plus,
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
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  disconnectProjectSocialConnection,
  finalizeProjectSocialConnection,
  initiateProjectSocialConnection,
} from "@/lib/actions/project/action";
import {
  type ComposioConnectionStage,
  useComposioConnection,
} from "@/lib/composio/use-composio-connection";
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
  // Not offered yet: publishing needs TikTok's app review first.
  { id: "tiktok", name: "TikTok", Icon: TikTokIcon, comingSoon: true },
  { id: "instagram", name: "Instagram", Icon: InstagramIcon },
  { id: "linkedin", name: "LinkedIn", Icon: LinkedInIcon },
  { id: "facebook", name: "Facebook", Icon: FacebookIcon },
  { id: "youtube", name: "YouTube", Icon: YouTubeIcon },
] as const satisfies readonly {
  id: ProjectSocialConnection["provider"];
  name: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  comingSoon?: boolean;
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
  const { connect } = useComposioConnection();
  const disconnectInFlightRef = useRef(false);
  const isMountedRef = useRef(false);
  // Replace and Disconnect open from a row menu that is gone by the time the
  // dialog closes, so focus goes back to that row's menu trigger by hand.
  const actionTriggersRef = useRef(new Map<string, HTMLButtonElement>());
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
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

  function showActionError(error: ActionError | null, fallback: string): void {
    if (!error) {
      showFeedback({ kind: "error", message: fallback });
      return;
    }
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
              : error.kind ===
                  CORE_API_ERROR_KINDS.SOCIAL_FACEBOOK_PAGE_REQUIRED
                ? t("errors.facebookPage")
                : fallback,
    });
  }

  async function startOAuth(
    action: OAuthAction,
    socialConnectionId?: string,
    provider?: ProjectSocialConnection["provider"],
  ): Promise<void> {
    const outcome = await connect({
      onStart: () => {
        setFeedback(null);
        setPendingAction(action);
        setPendingTarget(provider ?? socialConnectionId ?? null);
      },
      initiate: () =>
        initiateProjectSocialConnection({
          projectId,
          action,
          ...(provider ? { provider } : {}),
          ...(socialConnectionId ? { socialConnectionId } : {}),
        }),
      finalize: (connectionId) =>
        finalizeProjectSocialConnection({ projectId, connectionId }),
    });

    if (outcome.kind === "in_flight") {
      showFeedback({ kind: "error", message: t("errors.inFlight") });
      return;
    }
    if (outcome.kind === "popup_blocked") {
      showFeedback({ kind: "error", message: t("errors.popupBlocked") });
      return;
    }

    if (outcome.kind === "connected") {
      showFeedback({ kind: "success", message: t("success.connected") });
    } else if (outcome.kind === "timeout") {
      showFeedback({ kind: "error", message: t("errors.timeout") });
    } else if (outcome.kind === "failed") {
      showFailure(outcome.stage, outcome.error);
    }
    // Replacing disconnects the old account when it starts, so the list is
    // stale however the flow ended.
    if (action === "replace" || outcome.kind === "connected") {
      router.refresh();
    }
    finishAction();
  }

  function showFailure(
    stage: ComposioConnectionStage,
    error: ActionError | null,
  ): void {
    switch (stage) {
      case "provider_callback":
        showFeedback({ kind: "error", message: t("errors.providerCallback") });
        return;
      case "legacy_callback":
        showFeedback({ kind: "error", message: t("errors.legacyCallback") });
        return;
      case "initiate":
        showActionError(error, t("errors.intent"));
        return;
      case "verify":
        showActionError(error, t("errors.verifier"));
        return;
      default:
        showActionError(error, t("errors.finalize"));
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
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="social-accounts-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {t("title")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={isBusy}
              aria-busy={pendingAction === "connect"}
            >
              {pendingAction === "connect" ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              {t("connectAccount")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SOCIAL_PROVIDERS.map((provider) => {
              const { id, name, Icon } = provider;
              const comingSoon = "comingSoon" in provider;
              return (
                <DropdownMenuItem
                  key={id}
                  aria-label={
                    comingSoon
                      ? t("connectComingSoon", { provider: name })
                      : t("connect", { provider: name })
                  }
                  disabled={comingSoon}
                  onSelect={() => {
                    void startOAuth("connect", undefined, id);
                  }}
                >
                  <Icon
                    className={cn("size-4", comingSoon && "grayscale")}
                    aria-hidden
                  />
                  {name}
                  {comingSoon ? (
                    <span className="text-muted-foreground ml-auto pl-4 text-xs">
                      {t("comingSoon")}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                    <span>{t("account", { provider: providerName })}</span>
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

      <AlertDialog
        open={pendingConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isBusy) setPendingConfirmation(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = confirmationTriggerRef.current;
            (trigger?.isConnected && !trigger.disabled
              ? trigger
              : headingRef.current
            )?.focus();
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
