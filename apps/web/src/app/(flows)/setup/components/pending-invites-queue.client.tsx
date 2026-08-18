"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useCollectUserName } from "@/components/auth/collect-user-name";
import { Button } from "@/components/ui/button";
import { acceptOrganizationInviteLink } from "@/lib/actions";
import { clearPendingOrganizationJoinCookieAction } from "@/lib/actions/workspace-gate";
import { activateOrganizationWorkspaceWithRetry } from "@/lib/activate-organization-workspace";
import { authClient } from "@/lib/auth/auth.client";

export interface WorkspaceGateQueueInvitation {
  kind: "invitation";
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}

export interface WorkspaceGateQueueJoinLink {
  kind: "join";
  token: string;
  organizationName: string;
  organizationSlug: string;
}

export type WorkspaceGateQueueItem =
  | WorkspaceGateQueueInvitation
  | WorkspaceGateQueueJoinLink;

interface PendingInvitesQueueProps {
  items: WorkspaceGateQueueItem[];
  initialName: string;
}

export function PendingInvitesQueue({
  items,
  initialName,
}: PendingInvitesQueueProps) {
  const t = useTranslations("WorkspaceGate.Pending");
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [retryOrganizationId, setRetryOrganizationId] = useState<string | null>(
    null,
  );
  const { persistIfNeeded, NameFields } = useCollectUserName(initialName);

  async function leaveGateAfterOrganization(organizationId: string) {
    const activated =
      await activateOrganizationWorkspaceWithRetry(organizationId);
    if (!activated) {
      toast.error(t("activateError"));
      setRetryOrganizationId(organizationId);
      return;
    }
    setRetryOrganizationId(null);
    await clearPendingOrganizationJoinCookieAction({});
    router.replace("/");
    router.refresh();
  }

  async function handleRetryActivation() {
    if (busyKey || !retryOrganizationId) {
      return;
    }
    setBusyKey("retry-activation");
    try {
      await leaveGateAfterOrganization(retryOrganizationId);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAcceptInvitation(item: WorkspaceGateQueueInvitation) {
    if (busyKey) {
      return;
    }
    setBusyKey(item.id);
    try {
      if (!(await persistIfNeeded())) {
        return;
      }
      const result = await authClient.organization.acceptInvitation({
        invitationId: item.id,
      });
      if (result.error) {
        toast.error(result.error.message ?? t("acceptError"));
        return;
      }
      const organizationId =
        result.data?.member.organizationId ?? item.organizationId;
      await leaveGateAfterOrganization(organizationId);
    } catch (error) {
      console.error("Workspace gate accept invitation failed", error);
      toast.error(t("acceptError"));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleJoin(item: WorkspaceGateQueueJoinLink) {
    if (busyKey) {
      return;
    }
    setBusyKey(item.token);
    try {
      if (!(await persistIfNeeded())) {
        return;
      }
      const result = await acceptOrganizationInviteLink({ token: item.token });
      if (!result.ok) {
        toast.error(result.error.message ?? t("joinError"));
        return;
      }
      await leaveGateAfterOrganization(result.value.organizationId);
    } catch (error) {
      console.error("Workspace gate join failed", error);
      toast.error(t("joinError"));
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
  const awaitingActivationRetry = retryOrganizationId !== null;

  return (
    <div className="space-y-4" data-testid="workspace-gate-pending-queue">
      <NameFields disabled={busy || awaitingActivationRetry} />
      <ul className="space-y-3">
        {items.map((item) => {
          const key = item.kind === "invitation" ? item.id : item.token;
          const itemBusy = busyKey === key;
          return (
            <li
              key={`${item.kind}:${key}`}
              className="border-input flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.organizationName}</p>
                <p className="text-muted-foreground truncate text-sm">
                  {item.organizationSlug}
                </p>
              </div>
              <Button
                type="button"
                disabled={busy || awaitingActivationRetry}
                onClick={() => {
                  if (item.kind === "invitation") {
                    void handleAcceptInvitation(item);
                    return;
                  }
                  void handleJoin(item);
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
      {retryOrganizationId ? (
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
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">{t("rejectAllHint")}</p>
        <Button
          type="button"
          variant="outline"
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
