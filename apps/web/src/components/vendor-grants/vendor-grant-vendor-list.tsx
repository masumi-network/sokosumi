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
  createMyVendorGrant,
  denyMyVendorGrant,
  revokeMyVendorGrant,
} from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import {
  approveOrganizationVendorGrant,
  createOrganizationVendorGrant,
  denyOrganizationVendorGrant,
  revokeOrganizationVendorGrant,
} from "@/lib/actions/organization";
import type { Result } from "@/lib/ts-res";
import { cn } from "@/lib/utils";
import {
  getActionablePendingGrants,
  getDeniedOrRevokedGrants,
  getGrantedGrants,
  getPermissionsToCreate,
  isFullyGranted,
  orderGrantsForBundledActions,
  VENDOR_PERMISSION_ORDER,
  type VendorGrantGroup,
  type VendorPermissionSlot,
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

type PermissionChipState = "granted" | "pending" | "inactive";

function getPermissionChipState(
  slot: VendorPermissionSlot,
): PermissionChipState {
  if (!slot.grant) {
    return "inactive";
  }
  switch (slot.grant.status) {
    case "GRANTED":
      return "granted";
    case "PENDING":
      return "pending";
    case "DENIED":
    case "REVOKED":
      return "inactive";
    default: {
      const _exhaustive: never = slot.grant.status;
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
        <VendorCard
          key={group.vendorId}
          group={group}
          mode={mode}
          organizationId={organizationId}
          namespace={namespace}
        />
      ))}
    </ul>
  );
}

interface VendorCardProps {
  group: VendorGrantGroup;
  mode: VendorGrantsMode;
  organizationId?: string;
  namespace: VendorGrantsNamespace;
}

function VendorCard({
  group,
  mode,
  organizationId,
  namespace,
}: VendorCardProps) {
  const pendingCount = getActionablePendingGrants(group).length;

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <VendorMark
            vendor={{
              name: group.vendorName,
              slug: group.vendorSlug,
              logos: { light: null, dark: null },
            }}
            className="text-sm font-medium"
          />
          {pendingCount > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {pendingCount}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {group.slots.map((slot) => {
            const chipState = getPermissionChipState(slot);
            return (
              <code
                key={slot.permission}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-xs",
                  chipState === "granted" &&
                    "bg-primary text-primary-foreground",
                  chipState === "pending" &&
                    "bg-secondary text-secondary-foreground",
                  chipState === "inactive" &&
                    "bg-muted text-muted-foreground opacity-60",
                )}
              >
                {slot.permission}
              </code>
            );
          })}
        </div>
      </div>

      <VendorCardActions
        group={group}
        mode={mode}
        organizationId={organizationId}
        namespace={namespace}
      />
    </li>
  );
}

type VendorCardAction = "approveAll" | "denyAll" | "revokeAll" | "complete";

interface VendorCardActionsProps {
  group: VendorGrantGroup;
  mode: VendorGrantsMode;
  organizationId?: string;
  namespace: VendorGrantsNamespace;
}

function VendorCardActions({
  group,
  mode,
  organizationId,
  namespace,
}: VendorCardActionsProps) {
  const tActions = useTranslations(`${namespace}.Actions`);
  const tGrantForm = useTranslations(`${namespace}.GrantForm`);
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<VendorCardAction | null>(
    null,
  );

  const pendingGrants = getActionablePendingGrants(group);
  const grantedGrants = getGrantedGrants(group);
  const fullyGranted = isFullyGranted(group);
  const permissionsToCreate = getPermissionsToCreate(group);
  const deniedOrRevokedGrants = getDeniedOrRevokedGrants(group);
  const canComplete =
    !fullyGranted &&
    pendingGrants.length === 0 &&
    (permissionsToCreate.length > 0 || deniedOrRevokedGrants.length > 0);

  function requireOrganizationId(): string | null {
    if (mode !== "organization") {
      return null;
    }
    return organizationId ?? null;
  }

  async function approveGrant(
    grantId: string,
  ): Promise<Result<{ grantId: string }, ActionError>> {
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

  async function denyGrant(
    grantId: string,
  ): Promise<Result<{ grantId: string }, ActionError>> {
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
  }

  async function revokeGrant(
    grantId: string,
  ): Promise<Result<{ grantId: string }, ActionError>> {
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
  }

  async function createGrants(
    permissions: (typeof VENDOR_PERMISSION_ORDER)[number][],
  ): Promise<Result<{ grantIds: string[] }, ActionError>> {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return createOrganizationVendorGrant({
        organizationId: id,
        vendorId: group.vendorId,
        permissions,
      });
    }
    return createMyVendorGrant({
      vendorId: group.vendorId,
      permissions,
    });
  }

  async function runSequential(
    action: VendorCardAction,
    steps: Array<() => Promise<Result<unknown, ActionError>>>,
    successKey:
      | "approveAllSuccess"
      | "denyAllSuccess"
      | "revokeAllSuccess"
      | "grantSuccess",
    errorKey:
      | "approveAllError"
      | "denyAllError"
      | "revokeAllError"
      | "grantError",
  ) {
    setLoadingAction(action);
    try {
      for (const step of steps) {
        const result = await step();
        if (!result.ok) {
          toast.error(result.error?.message ?? tActions(errorKey));
          return;
        }
      }
      toast.success(tActions(successKey));
      router.refresh();
    } catch {
      toast.error(tActions(errorKey));
    } finally {
      setLoadingAction(null);
    }
  }

  if (pendingGrants.length > 0) {
    const orderedPending = orderGrantsForBundledActions(pendingGrants);

    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runSequential(
              "approveAll",
              orderedPending.map((grant) => () => approveGrant(grant.id)),
              "approveAllSuccess",
              "approveAllError",
            )
          }
        >
          {loadingAction === "approveAll" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("approveAll")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runSequential(
              "denyAll",
              orderedPending.map((grant) => () => denyGrant(grant.id)),
              "denyAllSuccess",
              "denyAllError",
            )
          }
        >
          {loadingAction === "denyAll" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("denyAll")}
        </Button>
      </div>
    );
  }

  const completionSteps: Array<() => Promise<Result<unknown, ActionError>>> =
    [];

  if (permissionsToCreate.length > 0) {
    completionSteps.push(() => createGrants(permissionsToCreate));
  }

  for (const grant of orderGrantsForBundledActions(deniedOrRevokedGrants)) {
    completionSteps.push(() => approveGrant(grant.id));
  }

  const showComplete = canComplete && completionSteps.length > 0;
  const showRevokeAll = grantedGrants.length > 0;

  if (!showComplete && !showRevokeAll) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {showComplete ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runSequential(
              "complete",
              completionSteps,
              "grantSuccess",
              "grantError",
            )
          }
        >
          {loadingAction === "complete" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tGrantForm("submit")}
        </Button>
      ) : null}
      {showRevokeAll ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runSequential(
              "revokeAll",
              grantedGrants.map((grant) => () => revokeGrant(grant.id)),
              "revokeAllSuccess",
              "revokeAllError",
            )
          }
        >
          {loadingAction === "revokeAll" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tActions("revokeAll")}
        </Button>
      ) : null}
    </div>
  );
}
