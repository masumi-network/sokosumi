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
import {
  isGrantDeniedOrRevoked,
  isGrantGranted,
  isGrantPending,
  type VendorGrantEntry,
} from "@/lib/utils/vendor-grant-display";

type VendorGrantsMode = "organization" | "personal";

type VendorGrantsNamespace =
  | "App.Organizations.OrganizationDetail.VendorGrants"
  | "App.Account.VendorGrants";

interface VendorGrantVendorListProps {
  entries: VendorGrantEntry[];
  mode: VendorGrantsMode;
  organizationId?: string;
  emptyLabel: string;
  namespace: VendorGrantsNamespace;
}

export function VendorGrantVendorList({
  entries,
  mode,
  organizationId,
  emptyLabel,
  namespace,
}: VendorGrantVendorListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {entries.map((entry) => (
        <VendorCard
          key={entry.vendorId}
          entry={entry}
          mode={mode}
          organizationId={organizationId}
          namespace={namespace}
        />
      ))}
    </ul>
  );
}

interface VendorCardProps {
  entry: VendorGrantEntry;
  mode: VendorGrantsMode;
  organizationId?: string;
  namespace: VendorGrantsNamespace;
}

function VendorCard({
  entry,
  mode,
  organizationId,
  namespace,
}: VendorCardProps) {
  const t = useTranslations(namespace);
  const status = entry.grant?.status;

  function statusLabel(): string | null {
    if (!status) {
      return null;
    }
    switch (status) {
      case "PENDING":
        return t("statusPending");
      case "GRANTED":
        return t("statusGranted");
      case "DENIED":
        return t("statusDenied");
      case "REVOKED":
        return t("statusRevoked");
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <VendorMark
            vendor={{
              name: entry.vendorName,
              slug: entry.vendorSlug,
              logos: { light: null, dark: null },
            }}
            className="text-sm font-medium"
          />
          {status ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {statusLabel()}
            </Badge>
          ) : null}
        </div>
      </div>

      <VendorCardActions
        entry={entry}
        mode={mode}
        organizationId={organizationId}
        namespace={namespace}
      />
    </li>
  );
}

type VendorCardAction = "approve" | "deny" | "revoke" | "grant";

interface VendorCardActionsProps {
  entry: VendorGrantEntry;
  mode: VendorGrantsMode;
  organizationId?: string;
  namespace: VendorGrantsNamespace;
}

function VendorCardActions({
  entry,
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

  async function createGrant(): Promise<
    Result<{ grantId: string }, ActionError>
  > {
    if (mode === "organization") {
      const id = requireOrganizationId();
      if (!id) {
        return Promise.reject(new Error("Missing organization"));
      }
      return createOrganizationVendorGrant({
        organizationId: id,
        vendorId: entry.vendorId,
      });
    }
    return createMyVendorGrant({ vendorId: entry.vendorId });
  }

  async function runAction(
    action: VendorCardAction,
    step: () => Promise<Result<unknown, ActionError>>,
    successKey:
      | "approveSuccess"
      | "denySuccess"
      | "revokeSuccess"
      | "grantSuccess",
    errorKey: "approveError" | "denyError" | "revokeError" | "grantError",
  ) {
    setLoadingAction(action);
    try {
      const result = await step();
      if (!result.ok) {
        toast.error(result.error?.message ?? tActions(errorKey));
        return;
      }
      toast.success(tActions(successKey));
      router.refresh();
    } catch {
      toast.error(tActions(errorKey));
    } finally {
      setLoadingAction(null);
    }
  }

  if (isGrantPending(entry) && entry.grant) {
    const grantId = entry.grant.id;

    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction(
              "approve",
              () => approveGrant(grantId),
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
              () => denyGrant(grantId),
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

  if (isGrantGranted(entry) && entry.grant) {
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
              () => revokeGrant(entry.grant!.id),
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

  if (!entry.grant || isGrantDeniedOrRevoked(entry)) {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction(
              "grant",
              () => createGrant(),
              "grantSuccess",
              "grantError",
            )
          }
        >
          {loadingAction === "grant" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {tGrantForm("submit")}
        </Button>
      </div>
    );
  }

  return null;
}
