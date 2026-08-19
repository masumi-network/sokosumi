"use client";

import { Loader2 } from "lucide-react";
import { err, ok, type Result } from "neverthrow";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useCollectUserName } from "@/components/auth/collect-user-name";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { acceptOrganizationInviteLink } from "@/lib/actions";
import { clearPendingOrganizationJoinCookieAction } from "@/lib/actions/workspace-gate";
import { activateOrganizationWorkspaceWithRetry } from "@/lib/activate-organization-workspace";
import { authClient } from "@/lib/auth/auth.client";
import {
  itemsForBatchAccept,
  type PendingInvitesBatchMode,
  queueItemKey,
  shouldShowPendingInvitesBatchActions,
  type WorkspaceGateQueueItem,
} from "@/lib/workspace-gate-queue";

interface PendingInvitesQueueProps {
  items: WorkspaceGateQueueItem[];
  initialName: string;
}

interface AcceptedQueueOrganization {
  organizationId: string;
  organizationSlug: string;
  acceptedJoinToken?: string;
}

function failedQueueItemLabel(
  organizationName: string,
  reason: string,
): string {
  return `${organizationName} (${reason})`;
}

export function PendingInvitesQueue({
  items,
  initialName,
}: PendingInvitesQueueProps) {
  const t = useTranslations("WorkspaceGate.Pending");
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [retryTarget, setRetryTarget] =
    useState<AcceptedQueueOrganization | null>(null);
  const { persistIfNeeded, NameFields } = useCollectUserName(initialName);
  const showBatchActions = shouldShowPendingInvitesBatchActions(items.length);

  async function leaveGateAfterOrganization(input: {
    organizationId: string;
    organizationSlug: string;
    acceptedJoinToken?: string;
  }) {
    const activated = await activateOrganizationWorkspaceWithRetry(
      input.organizationId,
    );
    if (!activated) {
      toast.error(t("activateError"));
      setRetryTarget(input);
      return;
    }
    setRetryTarget(null);
    await clearPendingOrganizationJoinCookieAction({
      organizationSlug: input.organizationSlug,
      acceptedJoinToken: input.acceptedJoinToken,
    });
    router.replace("/");
    router.refresh();
  }

  async function handleRetryActivation() {
    if (busyKey || !retryTarget) {
      return;
    }
    setBusyKey("retry-activation");
    try {
      await leaveGateAfterOrganization(retryTarget);
    } finally {
      setBusyKey(null);
    }
  }

  async function acceptQueueItem(
    item: WorkspaceGateQueueItem,
  ): Promise<Result<AcceptedQueueOrganization, string>> {
    if (item.kind === "invitation") {
      const result = await authClient.organization.acceptInvitation({
        invitationId: item.id,
      });
      if (result.error) {
        return err(result.error.message ?? t("acceptError"));
      }
      return ok({
        organizationId:
          result.data?.member.organizationId ?? item.organizationId,
        organizationSlug: item.organizationSlug,
      });
    }

    const result = await acceptOrganizationInviteLink({ token: item.token });
    if (!result.ok) {
      return err(result.error.message ?? t("joinError"));
    }
    return ok({
      organizationId: result.value.organizationId,
      organizationSlug: result.value.organizationSlug ?? item.organizationSlug,
      acceptedJoinToken: item.token,
    });
  }

  async function handleAcceptItem(item: WorkspaceGateQueueItem) {
    if (busyKey) {
      return;
    }
    setBusyKey(queueItemKey(item));
    try {
      if (!(await persistIfNeeded())) {
        return;
      }
      const accepted = await acceptQueueItem(item);
      if (accepted.isErr()) {
        toast.error(accepted.error);
        return;
      }
      await leaveGateAfterOrganization(accepted.value);
    } catch (error) {
      console.error("Workspace gate accept item failed", error);
      toast.error(item.kind === "join" ? t("joinError") : t("acceptError"));
    } finally {
      setBusyKey(null);
    }
  }

  function handleToggleSelected(key: string, checked: boolean) {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  async function handleAcceptBatch(mode: PendingInvitesBatchMode) {
    if (busyKey) {
      return;
    }
    const targets = itemsForBatchAccept(items, mode, selectedKeys);
    if (targets.length === 0) {
      return;
    }
    setBusyKey(mode === "all" ? "accept-all" : "accept-selected");
    try {
      if (!(await persistIfNeeded())) {
        return;
      }
      const successes: AcceptedQueueOrganization[] = [];
      const failedNames: string[] = [];

      for (const item of targets) {
        try {
          const accepted = await acceptQueueItem(item);
          if (accepted.isErr()) {
            failedNames.push(
              failedQueueItemLabel(item.organizationName, accepted.error),
            );
            continue;
          }
          successes.push(accepted.value);
        } catch (error) {
          console.error("Workspace gate accept item failed", error);
          failedNames.push(
            failedQueueItemLabel(
              item.organizationName,
              item.kind === "join" ? t("joinError") : t("acceptError"),
            ),
          );
        }
      }

      if (failedNames.length > 0) {
        toast.error(t("batchError", { names: failedNames.join(", ") }));
      }

      const firstSuccess = successes[0];
      if (!firstSuccess) {
        router.refresh();
        return;
      }

      await leaveGateAfterOrganization({
        organizationId: firstSuccess.organizationId,
        organizationSlug: firstSuccess.organizationSlug,
        acceptedJoinToken: successes.find(
          (success) => success.acceptedJoinToken,
        )?.acceptedJoinToken,
      });
    } catch (error) {
      console.error("Workspace gate accept batch failed", error);
      toast.error(t("acceptError"));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRejectAll() {
    if (busyKey) {
      return;
    }
    setBusyKey("reject-all");
    try {
      for (const item of items) {
        if (item.kind !== "invitation") {
          continue;
        }
        const result = await authClient.organization.rejectInvitation({
          invitationId: item.id,
        });
        if (result.error) {
          toast.error(result.error.message ?? t("rejectError"));
          router.refresh();
          return;
        }
      }
      await clearPendingOrganizationJoinCookieAction({});
      router.refresh();
    } catch (error) {
      console.error("Workspace gate reject all failed", error);
      toast.error(t("rejectError"));
    } finally {
      setBusyKey(null);
    }
  }

  const busy = busyKey !== null;
  const awaitingActivationRetry = retryTarget !== null;
  const selectedCount = itemsForBatchAccept(
    items,
    "selected",
    selectedKeys,
  ).length;

  return (
    <div className="space-y-4" data-testid="workspace-gate-pending-queue">
      <NameFields disabled={busy || awaitingActivationRetry} />
      <ul className="space-y-3">
        {items.map((item) => {
          const key = queueItemKey(item);
          const itemBusy = busyKey === key;
          return (
            <li
              key={`${item.kind}:${key}`}
              className="border-input flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                {showBatchActions ? (
                  <Checkbox
                    checked={selectedKeys.has(key)}
                    disabled={busy || awaitingActivationRetry}
                    onCheckedChange={(checked) => {
                      handleToggleSelected(key, checked === true);
                    }}
                    aria-label={t("selectItem", {
                      organizationName: item.organizationName,
                    })}
                    data-testid={`workspace-gate-select-${item.kind}-${key}`}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.organizationName}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {item.organizationSlug}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                disabled={busy || awaitingActivationRetry}
                onClick={() => {
                  void handleAcceptItem(item);
                }}
                data-testid={`workspace-gate-accept-${item.kind}-${key}`}
              >
                {itemBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                {item.kind === "join" ? t("join") : t("accept")}
              </Button>
            </li>
          );
        })}
      </ul>
      {retryTarget ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleRetryActivation();
          }}
          data-testid="workspace-gate-retry-activation"
        >
          {busyKey === "retry-activation" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("activateRetry")}
        </Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {showBatchActions ? (
          <>
            <Button
              type="button"
              disabled={busy || awaitingActivationRetry}
              onClick={() => {
                void handleAcceptBatch("all");
              }}
              data-testid="workspace-gate-accept-all"
            >
              {busyKey === "accept-all" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("acceptAll")}
            </Button>
            <Button
              type="button"
              disabled={busy || awaitingActivationRetry || selectedCount === 0}
              onClick={() => {
                void handleAcceptBatch("selected");
              }}
              data-testid="workspace-gate-accept-selected"
            >
              {busyKey === "accept-selected" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("acceptSelected")}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className={showBatchActions ? "ml-auto" : undefined}
          disabled={busy || awaitingActivationRetry}
          onClick={() => {
            void handleRejectAll();
          }}
          data-testid="workspace-gate-reject-all"
        >
          {busyKey === "reject-all" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("rejectAll")}
        </Button>
      </div>
    </div>
  );
}
