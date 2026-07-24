import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DEVELOPER_DEFAULT_HREF } from "@/app/components/sidebar/components/developer-menu-config";
import { VendorAdminDetail } from "@/app/developer/components/vendors/vendor-admin-detail";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Developer.tabs");
  return { title: t("vendors") };
}

interface DeveloperVendorDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function DeveloperVendorDetailPage({
  params,
}: DeveloperVendorDetailPageProps) {
  const { id } = await params;
  const t = await getTranslations("App.Developer.Vendors");
  const { showVendors, adminVendors } = await getDeveloperVendorAdminAccess();

  if (!showVendors) {
    redirect(DEVELOPER_DEFAULT_HREF);
  }

  const vendor = adminVendors.find((membership) => membership.id === id);
  if (!vendor) {
    notFound();
  }

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {vendor.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("editDescription")}
            </p>
            <p className="text-muted-foreground font-mono text-xs">
              {vendor.slug}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/developer/vendors">{t("backToList")}</Link>
          </Button>
        </div>

        <VendorAdminDetail vendor={vendor} />
      </div>
    </div>
  );
}
