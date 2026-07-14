"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { VendorMark } from "@/components/agents/vendor-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  approveMyVendorGrant,
  denyMyVendorGrant,
  revokeMyVendorGrant,
} from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import {
  approveOrganizationVendorGrant,
  denyOrganizationVendorGrant,
  revokeOrganizationVendorGrant,
} from "@/lib/actions/organization";
import type { VendorGrant } from "@/lib/clients/generated/core";
import type { Result } from "@/lib/ts-res";
import type {
  VendorGrantGroup,
  VendorPermissionSlot,
} from "@/lib/utils/vendor-grant-display";

type VendorGrantsMode = "organization" | "personal";

type VendorGrantsNamespace =
  | "App.Organizations.OrganizationDetail.VendorGrants"
  | "App.Account.VendorGrants";

interface VendorGrantVendorListProps {
  groups: VendorGrantGroup[];
  mode: VendorGrantsMode;
  organizationId?: string;
  emptyLabel: string;
  namespace: VendorGrantsNamespace;
}

function permissionLabelKey(
  permission: VendorGrant["permission"],
): "taskRead" | "taskComment" | "taskCreate" {
  switch (permission) {
    case "task:read":
      return "taskRead";
    case "task:comment":
      return "taskComment";
    case "task:create":
      return "taskCreate";
    default: {
      const _exhaustive: never = permission;
      return _exhaustive;
    }
  }
}

function statusLabelKey(
  status: VendorGrant["status"],
): "statusPending" | "statusGranted" | "statusDenied" | "statusRevoked" {
  switch (status) {
    case "PENDING":
      return "statusPending";
    case "GRANTED":
      return "statusGranted";
    case "DENIED":
      return "statusDenied";
    case "REVOKED":
      return "statusRevoked";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function VendorGrantVendorList({
  groups,
  mode,
  organizationId,
  emptyLabel,
  namespace,
}: VendorGrantVendorListProps) {
  if (groups.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {groups.map((group) => (
        <li key={group.vendorId} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <VendorMark
              vendor={{
                name: group.vendorName,
                slug: group.vendorSlug,
                logos: { light: null, dark: null },
              }}
              className="text-sm font-medium"
            />
            {group.hasPending ? (
              <Badge variant="secondary">
                {
                  group.slots.filter((slot) => slot.grant?.status === "PENDING")
                    .length
                }
              </Badge>
            ) : null}
          </div>
          <ul className="space-y-2">
            {group.slots.map((slot) => (
              <PermissionSlotRow
                key={slot.permission}
                slot={slot}
                mode={mode}
                organizationId={organizationId}
                namespace={namespace}
                approveBundlesComment={
                  slot.permission === "task:read" &&
                  group.slots.some((s) => s.bundledWithPendingRead)
                }
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

interface PermissionSlotRowProps {
  slot: VendorPermissionSlot;
  mode: VendorGrantsMode;
  organizationId?: string;
  namespace: VendorGrantsNamespace;
  approveBundlesComment: boolean;
}

function PermissionSlotRow({
  slot,
  mode,
  organizationId,
  namespace,
  approveBundlesComment,
}: PermissionSlotRowProps) {
  const t = useTranslations(namespace);
  const tPermissions = useTranslations(`${namespace}.Permissions`);
  const tActions = useTranslations(`${namespace}.Actions`);
  const grant = slot.grant;

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {tPermissions(permissionLabelKey(slot.permission))}
        </span>
        {grant ? (
          <Badge variant={grant.status === "GRANTED" ? "default" : "secondary"}>
            {t(statusLabelKey(grant.status))}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">
            {t("statusNone")}
          </span>
        )}
        {slot.bundledWithPendingRead ? (
          <span className="text-muted-foreground text-xs">
            {t("bundledWithRead")}
          </span>
        ) : null}
      </div>

      {grant && !slot.bundledWithPendingRead ? (
        <SlotActions
          status={grant.status}
          grantId={grant.id}
          mode={mode}
          organizationId={organizationId}
          approveLabel={
            approveBundlesComment
              ? t("approveWithComment")
              : tActions("approve")
          }
        />
      ) : null}
    </li>
  );
}

interface SlotActionsProps {
  status: VendorGrant["status"];
  grantId: string;
  mode: VendorGrantsMode;
  organizationId?: string;
  approveLabel: string;
}

function SlotActions({
  status,
  grantId,
  mode,
  organizationId,
  approveLabel,
}: SlotActionsProps) {
  const tActions = useTranslations(
    mode === "organization"
      ? "App.Organizations.OrganizationDetail.VendorGrants.Actions"
      : "App.Account.VendorGrants.Actions",
  );
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<
    "approve" | "deny" | "revoke" | null
  >(null);

  async function runAction(
    action: "approve" | "deny" | "revoke",
    handler: () => Promise<Result<{ grantId: string }, ActionError>>,
  ) {
    setLoadingAction(action);
    try {
      const result = await handler();
      if (!result.ok) {
        toast.error(result.error?.message ?? tActions(`${action}Error`));
        return;
      }

      toast.success(tActions(`${action}Success`));
      router.refresh();
    } catch {
      toast.error(tActions(`${action}Error`));
    } finally {
      setLoadingAction(null);
    }
  }

  function requireOrganizationId(): string | null {
    if (mode !== "organization") {
      return null;
    }
    return organizationId ?? null;
  }

  function approveHandler() {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return approveOrganizationVendorGrant({
        organizationId: id,
        grantId,
      });
    }
    return approveMyVendorGrant({ grantId });
  }

  if (status === "PENDING") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={loadingAction !== null}
          onClick={() => runAction("approve", approveHandler)}
        >
          {loadingAction === "approve" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {approveLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction("deny", () => {
              if (mode === "organization") {
                const id = requireOrganizationId();
                if (!id) {
                  return Promise.reject(new Error("Missing organization"));
                }
                return denyOrganizationVendorGrant({
                  organizationId: id,
                  grantId,
                });
              }
              return denyMyVendorGrant({ grantId });
            })
          }
        >
          {loadingAction === "deny" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {tActions("deny")}
        </Button>
      </div>
    );
  }

  if (status === "GRANTED") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={loadingAction !== null}
        onClick={() =>
          runAction("revoke", () => {
            if (mode === "organization") {
              const id = requireOrganizationId();
              if (!id) {
                return Promise.reject(new Error("Missing organization"));
              }
              return revokeOrganizationVendorGrant({
                organizationId: id,
                grantId,
              });
            }
            return revokeMyVendorGrant({ grantId });
          })
        }
      >
        {loadingAction === "revoke" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : null}
        {tActions("revoke")}
      </Button>
    );
  }

  if (status === "DENIED" || status === "REVOKED") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={loadingAction !== null}
        onClick={() => runAction("approve", approveHandler)}
      >
        {loadingAction === "approve" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : null}
        {tActions("approve")}
      </Button>
    );
  }

  return null;
}
