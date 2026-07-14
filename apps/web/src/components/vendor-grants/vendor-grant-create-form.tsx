"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

function permissionLabelKey(
  permission: VendorGrantPermission,
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
  const tPermissions = useTranslations(`${namespace}.Permissions`);
  const router = useRouter();
  const disabledSet = new Set(disabledVendorIds);
  const [vendorId, setVendorId] = useState(() =>
    firstEnabledVendorId(vendors, disabledSet),
  );
  const [permissions, setPermissions] = useState<VendorGrantPermission[]>([
    ...VENDOR_PERMISSION_ORDER,
  ]);
  const [loading, setLoading] = useState(false);

  const resolvedVendorId =
    vendorId && !disabledSet.has(vendorId)
      ? vendorId
      : firstEnabledVendorId(vendors, disabledSet);

  if (resolvedVendorId !== vendorId) {
    setVendorId(resolvedVendorId);
  }

  const hasSelectableVendor = vendors.some(
    (vendor) => !disabledSet.has(vendor.id),
  );

  if (vendors.length === 0 || !hasSelectableVendor) {
    return null;
  }

  function togglePermission(
    permission: VendorGrantPermission,
    checked: boolean,
  ) {
    setPermissions((current) => {
      if (checked) {
        if (current.includes(permission)) {
          return current;
        }
        return VENDOR_PERMISSION_ORDER.filter(
          (item) => item === permission || current.includes(item),
        );
      }
      return current.filter((item) => item !== permission);
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resolvedVendorId || permissions.length === 0) {
      return;
    }

    setLoading(true);
    try {
      const result = await onCreate({
        vendorId: resolvedVendorId,
        permissions,
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
      className="flex flex-col gap-5 rounded-lg border p-6"
    >
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
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 text-sm">
        <legend className="text-muted-foreground float-left w-full p-0 font-medium">
          {t("permissionLabel")}
        </legend>
        <div className="flex clear-both flex-col gap-2">
          {VENDOR_PERMISSION_ORDER.map((permission) => (
            <label
              key={permission}
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                checked={permissions.includes(permission)}
                onCheckedChange={(checked) =>
                  togglePermission(permission, checked === true)
                }
              />
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span>{tPermissions(permissionLabelKey(permission))}</span>
                <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs">
                  {permission}
                </code>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="default"
          className="w-full sm:w-auto"
          disabled={loading || !resolvedVendorId || permissions.length === 0}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
