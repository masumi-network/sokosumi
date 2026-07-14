"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionError } from "@/lib/actions/errors";
import type { VendorGrantPermission } from "@/lib/services/vendor-grant.service";
import type { Result } from "@/lib/ts-res";
import { VENDOR_PERMISSION_ORDER } from "@/lib/utils/vendor-grant-display";

type VendorGrantFormNamespace =
  | "App.Account.VendorGrants"
  | "App.Organizations.OrganizationDetail.VendorGrants";

interface VendorGrantCreateFormProps {
  vendors: Array<{ id: string; name: string }>;
  /** Vendor IDs already shown in the grants list — grayed out, not selectable. */
  disabledVendorIds?: string[];
  namespace: VendorGrantFormNamespace;
  onCreate: (params: {
    vendorId: string;
    permissions: VendorGrantPermission[];
  }) => Promise<Result<{ grantIds: string[] }, ActionError>>;
}

function firstEnabledVendorId(
  vendors: Array<{ id: string }>,
  disabledVendorIds: ReadonlySet<string>,
): string {
  return vendors.find((vendor) => !disabledVendorIds.has(vendor.id))?.id ?? "";
}

export function VendorGrantCreateForm({
  vendors,
  disabledVendorIds = [],
  namespace,
  onCreate,
}: VendorGrantCreateFormProps) {
  const t = useTranslations(`${namespace}.GrantForm`);
  const router = useRouter();
  const disabledSet = new Set(disabledVendorIds);
  const [vendorId, setVendorId] = useState(() =>
    firstEnabledVendorId(vendors, disabledSet),
  );
  const [loading, setLoading] = useState(false);

  const resolvedVendorId =
    vendorId && !disabledSet.has(vendorId)
      ? vendorId
      : firstEnabledVendorId(vendors, disabledSet);

  const hasSelectableVendor = vendors.some(
    (vendor) => !disabledSet.has(vendor.id),
  );

  if (vendors.length === 0 || !hasSelectableVendor) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolvedVendorId) {
      return;
    }

    setLoading(true);
    try {
      const result = await onCreate({
        vendorId: resolvedVendorId,
        permissions: [...VENDOR_PERMISSION_ORDER],
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
      className="flex flex-col gap-5 rounded-lg border p-6 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <label className="flex max-w-md flex-col gap-3 text-sm">
          <span className="text-muted-foreground font-medium">
            {t("vendorLabel")}
          </span>
          <Select value={resolvedVendorId} onValueChange={setVendorId}>
            <SelectTrigger className="w-full min-w-0 px-3 [&_svg]:ml-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((vendor) => (
                <SelectItem
                  key={vendor.id}
                  value={vendor.id}
                  disabled={disabledSet.has(vendor.id)}
                >
                  {vendor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <span className="text-muted-foreground font-medium">
            {t("permissionLabel")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {VENDOR_PERMISSION_ORDER.map((permission) => (
              <code
                key={permission}
                className="bg-primary text-primary-foreground rounded px-1.5 py-0.5 font-mono text-xs"
              >
                {permission}
              </code>
            ))}
          </div>
        </div>
      </div>
      <Button
        type="submit"
        size="default"
        className="w-full shrink-0 sm:w-auto"
        disabled={loading || !resolvedVendorId}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("submit")}
      </Button>
    </form>
  );
}
