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
import { createOrganizationVendorGrant } from "@/lib/actions/organization";
import type { VendorGrantPermission } from "@/lib/services/vendor-grant.service";

interface OrganizationVendorGrantFormProps {
  organizationId: string;
  vendors: Array<{ id: string; name: string }>;
}

export function OrganizationVendorGrantForm({
  organizationId,
  vendors,
}: OrganizationVendorGrantFormProps) {
  const t = useTranslations(
    "App.Organizations.OrganizationDetail.VendorGrants.GrantForm",
  );
  const tPermissions = useTranslations(
    "App.Organizations.OrganizationDetail.VendorGrants.Permissions",
  );
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
      const result = await createOrganizationVendorGrant({
        organizationId,
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
      className="grid gap-5 rounded-lg border p-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
    >
      <label className="flex flex-col gap-3 text-sm">
        <span className="text-muted-foreground font-medium">
          {t("vendorLabel")}
        </span>
        <Select value={vendorId} onValueChange={setVendorId}>
          <SelectTrigger className="w-full min-w-0 px-3 [&_svg]:ml-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {vendors.map((vendor) => (
              <SelectItem key={vendor.id} value={vendor.id}>
                {vendor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-3 text-sm">
        <span className="text-muted-foreground font-medium">
          {t("permissionLabel")}
        </span>
        <Select
          value={permission}
          onValueChange={(value) =>
            setPermission(value as VendorGrantPermission)
          }
        >
          <SelectTrigger className="w-full min-w-0 px-3 [&_svg]:ml-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="task:read">
              {tPermissions("taskRead")}
            </SelectItem>
            <SelectItem value="task:comment">
              {tPermissions("taskComment")}
            </SelectItem>
            <SelectItem value="task:create">
              {tPermissions("taskCreate")}
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Button
        type="submit"
        size="default"
        className="w-full sm:w-auto"
        disabled={loading || !vendorId}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("submit")}
      </Button>
    </form>
  );
}
