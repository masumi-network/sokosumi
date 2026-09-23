"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/contexts/notification-provider";
import type { ActionResultDto } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  approveMyCoworkerAccess,
  approveOrganizationCoworkerAccess,
  denyMyCoworkerAccess,
  denyOrganizationCoworkerAccess,
  revokeMyCoworkerAccess,
  revokeOrganizationCoworkerAccess,
} from "@/lib/actions/workspace-approval-action";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";
import {
  isWorkspaceApprovalGranted,
  isWorkspaceApprovalPending,
  workspaceApprovalStatusMessageKey,
} from "@/lib/utils/workspace-approval";

interface CoworkerAccessModeMap {
  organization: true;
  personal: true;
}

type CoworkerAccessMode = keyof CoworkerAccessModeMap;

interface CoworkerAccessNamespaceMap {
  "App.Organizations.OrganizationDetail.CoworkerAccess": true;
  "App.Account.CoworkerAccess": true;
}

type CoworkerAccessNamespace = keyof CoworkerAccessNamespaceMap;

interface CoworkerAccessListProps {
  rows: CoworkerWorkspaceAccess[];
  mode: CoworkerAccessMode;
  organizationId?: string;
  emptyLabel: string;
  namespace: CoworkerAccessNamespace;
}

export function CoworkerAccessList({
  rows,
  mode,
  organizationId,
  emptyLabel,
  namespace,
}: CoworkerAccessListProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {rows.map((row) => (
        <CoworkerAccessCard
          key={row.id}
          row={row}
          mode={mode}
          organizationId={organizationId}
          namespace={namespace}
        />
      ))}
    </ul>
  );
}

interface CoworkerAccessCardProps {
  row: CoworkerWorkspaceAccess;
  mode: CoworkerAccessMode;
  organizationId?: string;
  namespace: CoworkerAccessNamespace;
}

function CoworkerAccessCard({
  row,
  mode,
  organizationId,
  namespace,
}: CoworkerAccessCardProps) {
  const t = useTranslations(namespace);

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.coworkerName}</span>
          {row.coworkerSlug ? (
            <span className="text-muted-foreground font-mono text-xs">
              {row.coworkerSlug}
            </span>
          ) : null}
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">
            {t(workspaceApprovalStatusMessageKey(row.status))}
          </Badge>
        </div>
      </div>

      <CoworkerAccessCardActions
        row={row}
        mode={mode}
        organizationId={organizationId}
        namespace={namespace}
      />
    </li>
  );
}

type CoworkerAccessCardAction = "approve" | "deny" | "revoke";

interface CoworkerAccessCardActionsProps {
  row: CoworkerWorkspaceAccess;
  mode: CoworkerAccessMode;
  organizationId?: string;
  namespace: CoworkerAccessNamespace;
}

function CoworkerAccessCardActions({
  row,
  mode,
  organizationId,
  namespace,
}: CoworkerAccessCardActionsProps) {
  const tActions = useTranslations(`${namespace}.Actions`);
  const router = useRouter();
  const { refetch: refetchNotifications } = useNotifications();
  const [loadingAction, setLoadingAction] =
    useState<CoworkerAccessCardAction | null>(null);

  function requireOrganizationId(): string | null {
    if (mode !== "organization") {
      return null;
    }
    return organizationId ?? null;
  }

  async function approveAccess(
    accessId: string,
  ): Promise<ActionResultDto<{ accessId: string }, ActionError>> {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return approveOrganizationCoworkerAccess({
        organizationId: id,
        accessId,
      });
    }
    return approveMyCoworkerAccess({ accessId });
  }

  async function denyAccess(
    accessId: string,
  ): Promise<ActionResultDto<{ accessId: string }, ActionError>> {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return denyOrganizationCoworkerAccess({
        organizationId: id,
        accessId,
      });
    }
    return denyMyCoworkerAccess({ accessId });
  }

  async function revokeAccess(
    accessId: string,
  ): Promise<ActionResultDto<{ accessId: string }, ActionError>> {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return revokeOrganizationCoworkerAccess({
        organizationId: id,
        accessId,
      });
    }
    return revokeMyCoworkerAccess({ accessId });
  }

  async function runAction(
    action: CoworkerAccessCardAction,
    step: () => Promise<ActionResultDto<unknown, ActionError>>,
    successKey: "approveSuccess" | "denySuccess" | "revokeSuccess",
    errorKey: "approveError" | "denyError" | "revokeError",
  ) {
    setLoadingAction(action);
    let shouldRefetchNotifications = false;
    try {
      const result = await step();
      if (!result.ok) {
        toast.error(result.error?.message ?? tActions(errorKey));
        return;
      }
      toast.success(tActions(successKey));
      shouldRefetchNotifications = action === "approve" || action === "deny";
      router.refresh();
    } catch {
      toast.error(tActions(errorKey));
    } finally {
      setLoadingAction(null);
      if (shouldRefetchNotifications) {
        void refetchNotifications().catch(() => {
          // Feed will catch up on next open/poll.
        });
      }
    }
  }

  if (isWorkspaceApprovalPending(row.status)) {
    const accessId = row.id;

    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction(
              "approve",
              () => approveAccess(accessId),
              "approveSuccess",
              "approveError",
            )
          }
        >
          {loadingAction === "approve" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("approve")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction(
              "deny",
              () => denyAccess(accessId),
              "denySuccess",
              "denyError",
            )
          }
        >
          {loadingAction === "deny" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("deny")}
        </Button>
      </div>
    );
  }

  if (isWorkspaceApprovalGranted(row.status)) {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction(
              "revoke",
              () => revokeAccess(row.id),
              "revokeSuccess",
              "revokeError",
            )
          }
        >
          {loadingAction === "revoke" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("revoke")}
        </Button>
      </div>
    );
  }

  return null;
}
