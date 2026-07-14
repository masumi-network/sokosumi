"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  approveMyVendorGrant,
  createMyVendorGrant,
  denyMyVendorGrant,
  revokeMyVendorGrant,
} from "@/lib/actions/account/vendor-grant-action";
import type { ActionError } from "@/lib/actions/errors";
import type { VendorGrantPermission } from "@/lib/services/vendor-grant.service";
import type { Result } from "@/lib/ts-res";

interface PersonalVendorGrantMutationButtonsProps {
  grantId: string;
  variant: "pending" | "active";
}

export function PersonalVendorGrantMutationButtons({
  grantId,
  variant,
}: PersonalVendorGrantMutationButtonsProps) {
  const t = useTranslations("App.Account.VendorGrants.Actions");
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
        toast.error(result.error?.message ?? t(`${action}Error`));
        return;
      }

      toast.success(t(`${action}Success`));
      router.refresh();
    } catch {
      toast.error(t(`${action}Error`));
    } finally {
      setLoadingAction(null);
    }
  }

  if (variant === "pending") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction("approve", () => approveMyVendorGrant({ grantId }))
          }
        >
          {loadingAction === "approve" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("approve")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loadingAction !== null}
          onClick={() =>
            runAction("deny", () => denyMyVendorGrant({ grantId }))
          }
        >
          {loadingAction === "deny" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          {t("deny")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={loadingAction !== null}
      onClick={() =>
        runAction("revoke", () => revokeMyVendorGrant({ grantId }))
      }
    >
      {loadingAction === "revoke" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : null}
      {t("revoke")}
    </Button>
  );
}

interface PersonalVendorGrantFormProps {
  vendors: Array<{ id: string; name: string }>;
}

export function PersonalVendorGrantForm({
  vendors,
}: PersonalVendorGrantFormProps) {
  const t = useTranslations("App.Account.VendorGrants.GrantForm");
  const tPermissions = useTranslations("App.Account.VendorGrants.Permissions");
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [permission, setPermission] =
    useState<VendorGrantPermission>("task:read");
  const [loading, setLoading] = useState(false);

  if (vendors.length === 0) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vendorId) {
      return;
    }

    setLoading(true);
    try {
      const result = await createMyVendorGrant({
        vendorId,
        permission,
      });

      if (!result.ok) {
        toast.error(result.error?.message ?? t("error"));
        return;
      }

      toast.success(t("success"));
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end"
    >
      <div className="grid flex-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground font-medium">
            {t("vendorLabel")}
          </span>
          <select
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={vendorId}
            onChange={(event) => setVendorId(event.target.value)}
          >
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground font-medium">
            {t("permissionLabel")}
          </span>
          <select
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            value={permission}
            onChange={(event) =>
              setPermission(event.target.value as VendorGrantPermission)
            }
          >
            <option value="task:read">{tPermissions("taskRead")}</option>
            <option value="task:comment">{tPermissions("taskComment")}</option>
            <option value="task:create">{tPermissions("taskCreate")}</option>
          </select>
        </label>
      </div>
      <Button type="submit" size="sm" disabled={loading || !vendorId}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("submit")}
      </Button>
    </form>
  );
}
