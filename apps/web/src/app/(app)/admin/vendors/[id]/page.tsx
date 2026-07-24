import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { VendorForm } from "@/components/admin/vendors/vendor-form";
import { VendorLoadError } from "@/components/admin/vendors/vendor-load-error";
import { Button } from "@/components/ui/button";
import { adminVendorService } from "@/lib/services/admin-vendor.service";

export const metadata: Metadata = {
  title: "Edit vendor",
  description: "Edit vendor name and logos",
};

interface AdminVendorDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminVendorDetailPage({
  params,
}: AdminVendorDetailPageProps) {
  const { id } = await params;
  const t = await getTranslations("App.Admin.Vendors");

  let vendor: Awaited<ReturnType<typeof adminVendorService.getVendorById>>;
  try {
    vendor = await adminVendorService.getVendorById(id);
  } catch {
    return (
      <div className="min-h-full w-full">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
          <Button variant="outline" asChild>
            <Link href="/admin/vendors">{t("backToList")}</Link>
          </Button>
          <VendorLoadError />
        </div>
      </div>
    );
  }

  if (!vendor) {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {vendor.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/vendors">{t("backToList")}</Link>
          </Button>
        </div>

        <VendorForm mode="edit" vendor={vendor} />
      </div>
    </div>
  );
}
