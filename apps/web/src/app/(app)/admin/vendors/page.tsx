import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { VendorsTable } from "@/components/admin/vendors/vendors-table";
import { Button } from "@/components/ui/button";
import { adminVendorService } from "@/lib/services/admin-vendor.service";

export const metadata: Metadata = {
  title: "Vendors",
  description: "Manage marketplace vendors",
};

export default async function AdminVendorsPage() {
  const t = await getTranslations("App.Admin.Vendors");

  let vendors: Awaited<ReturnType<typeof adminVendorService.listVendors>>;
  try {
    vendors = await adminVendorService.listVendors();
  } catch {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <p className="text-destructive text-sm">{t("loadFailed")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">{t("description")}</p>
          </div>
          <Button asChild>
            <Link href="/admin/vendors/new">{t("createVendor")}</Link>
          </Button>
        </div>

        <VendorsTable vendors={vendors} />
      </div>
    </div>
  );
}
